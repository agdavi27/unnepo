import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { repo } from "@/lib/db/file-store";
import { login, signUp, verifyEmail } from "@/lib/services/auth";
import { saveStructuredProfile } from "@/lib/services/workspace";
import { setContactFetcher } from "@/lib/providers/contacts/http";
import { assertPublicUrl, setJobPageFetcherForTests } from "@/lib/apply/safe-fetch";
import { extractJob, extractRequirements, findPostedRecruiter, jobKeyFor, parseJobUrl } from "@/lib/apply/extract";
import { acceptAiAnswer, classifyQuestion, headlineAnswer, missingAnswers, planAnswers, policyAnswer, RECRUITER_NOTE, toolExperienceAnswer } from "@/lib/apply/questions";
import { applicationProfiles, applications, applicationContacts } from "@/lib/apply/store";
import { coreTitle } from "@/lib/apply/contacts";
import { coverLetterPdf } from "@/lib/apply/cover-letter";
import { acceptFixes } from "@/lib/apply/fast/fields";
import { degreeAnswer, formatDate, keepStated, resumeFieldAnswer } from "@/lib/apply/resume-profile";
import { supportedBy } from "@/lib/apply/questions";
import { applyState, saveApplicationProfile, createApplication, markApplied, runContactDiscovery, setDeferForTests, setOutcome, updateAnswers } from "@/lib/apply/service";
import { applicationStats, stageOf } from "@/lib/apply/stats";
import type { ApplicationProfile, ApplicationQuestion } from "@/lib/apply/types";
import { useTempDb } from "./helpers";

const model = vi.hoisted(() => ({ replies: [] as string[], calls: [] as string[] }));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: async (input: { messages: Array<{ content: string }> }) => {
        model.calls.push(input.messages[0].content);
        const text = model.replies.shift() ?? "{}";
        return { content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10 } };
      },
    };
  },
}));

const form = {
  school: "Colby College", major: "Economics; Computer Science", graduationYear: "2027", interests: ["Technology"], otherInterests: "",
  targetRoles: "Product analyst", dreamCompanies: "Acme", locations: "Boston", workPreference: "hybrid", goals: [], contactTypes: [],
  seniority: "manager", bio: "I build data tools.", accomplishments: "Led the Colby Data Club and built a dashboard used by 40 students.", excludedTopics: "", emailTone: "friendly",
};

async function student(email = "pat.doe@colby.edu") {
  const signed = await signUp({ email, password: "password123", name: "Pat Doe" });
  await verifyEmail(signed.verifyToken!);
  const userId = (await login(email, "password123")).user.id;
  await saveStructuredProfile(userId, form, "Pat Doe");
  return userId;
}

function q(key: string, label: string, kind: ApplicationQuestion["kind"] = "text", options: string[] = [], required = true): ApplicationQuestion {
  return { key, label, kind, required, options, sensitive: classifyQuestion(label).sensitive, answer: null, source: null, evidence: null };
}

const profile: ApplicationProfile = { firstName: "Pat", lastName: "Doe", email: "pat@colby.edu", phone: "207-555-0100", linkedin: "", website: "", github: "", city: "Waterville, ME", saved: {} };
const context = { profile, school: "Colby College", majors: ["Economics"], graduationYear: "2027", resumeFileName: "Pat Doe Resume.pdf" };

const GREENHOUSE_JOB = {
  title: "Product Analyst Intern",
  absolute_url: "https://job-boards.greenhouse.io/acme/jobs/123",
  location: { name: "Boston, MA" },
  departments: [{ name: "Product" }],
  content: "&lt;p&gt;Join us.&lt;/p&gt;&lt;p&gt;&lt;strong&gt;Qualifications&lt;/strong&gt;&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Comfort with SQL&lt;/li&gt;&lt;li&gt;Clear writing&lt;/li&gt;&lt;/ul&gt;&lt;p&gt;Your recruiter: Jordan Smith (jordan.smith@acme.com)&lt;/p&gt;",
  questions: [
    { label: "First Name", required: true, fields: [{ name: "first_name", type: "input_text" }] },
    { label: "Last Name", required: true, fields: [{ name: "last_name", type: "input_text" }] },
    { label: "Email", required: true, fields: [{ name: "email", type: "input_text" }] },
    { label: "Resume/CV", required: true, fields: [{ name: "resume", type: "input_file" }, { name: "resume_text", type: "textarea" }] },
    { label: "Why are you interested in Acme?", required: true, fields: [{ name: "question_1", type: "textarea" }] },
    { label: "Will you require visa sponsorship?", required: true, fields: [{ name: "question_2", type: "multi_value_single_select", values: [{ label: "Yes", value: 1 }, { label: "No", value: 0 }] }] },
    { label: "How did you hear about us?", required: false, fields: [{ name: "question_3", type: "input_text" }] },
  ],
};

function greenhouseFetcher(url: string) {
  if (url.endsWith("/boards/acme")) return Promise.resolve(Response.json({ name: "Acme Corp" }));
  if (url.includes("/boards/acme/jobs/123")) return Promise.resolve(Response.json(GREENHOUSE_JOB));
  return Promise.resolve(new Response("not found", { status: 404 }));
}

beforeEach(() => {
  useTempDb();
  model.replies = [];
  model.calls = [];
  setJobPageFetcherForTests(greenhouseFetcher);
  setDeferForTests(() => undefined);
  delete process.env.BROWSERBASE_API_KEY;
  delete process.env.BROWSERBASE_PROJECT_ID;
});

afterEach(() => {
  setJobPageFetcherForTests(null);
  setDeferForTests(null);
});

describe("reading job links", () => {
  it("recognizes job boards, blocks sites that forbid automation, and keys duplicates", () => {
    expect(parseJobUrl("https://job-boards.greenhouse.io/acme/jobs/123?gh_src=x")).toMatchObject({ ats: "greenhouse", board: "acme", jobId: "123" });
    expect(parseJobUrl("https://boards.greenhouse.io/embed/job_app?for=acme&token=123")).toMatchObject({ ats: "greenhouse", board: "acme", jobId: "123" });
    expect(parseJobUrl("https://jobs.lever.co/acme/abc-123/apply")).toMatchObject({ ats: "lever", board: "acme", jobId: "abc-123" });
    expect(parseJobUrl("https://jobs.ashbyhq.com/acme/xyz")).toMatchObject({ ats: "ashby", board: "acme", jobId: "xyz" });
    expect(() => parseJobUrl("https://www.linkedin.com/jobs/view/1")).toThrow(/LinkedIn doesn't allow/);
    expect(() => parseJobUrl("https://www.indeed.com/viewjob?jk=1")).toThrow(/Indeed/);
    expect(jobKeyFor(parseJobUrl("https://acme.com/careers/role?utm_source=x&gh_jid=55"))).toBe("gh_jid:acme.com:55");
    expect(jobKeyFor(parseJobUrl("https://acme.com/careers/role/?utm_source=x#top"))).toBe("url:acme.com/careers/role");
  });

  it("reads Workday links through Workday's job API and keys them by requisition", async () => {
    const wd = parseJobUrl("https://acme.wd5.myworkdayjobs.com/en-US/AcmeCareers/job/US-ME-Portland/Marketing-Analyst_JR123/apply");
    expect(wd).toMatchObject({ ats: "workday", board: "acme.wd5.myworkdayjobs.com|acme|AcmeCareers", jobId: "US-ME-Portland/Marketing-Analyst_JR123" });
    expect(jobKeyFor(wd)).toBe("workday:acme:jr123");
    expect(jobKeyFor(parseJobUrl("https://acme.wd5.myworkdayjobs.com/AcmeCareers/job/Remote/Marketing-Analyst_JR123"))).toBe("workday:acme:jr123");
    setJobPageFetcherForTests(async (url) => {
      expect(url).toBe("https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/AcmeCareers/job/US-ME-Portland/Marketing-Analyst_JR123");
      return Response.json({
        jobPostingInfo: { title: "Marketing Analyst", location: "US, ME, Portland", canApply: true, externalUrl: "https://acme.wd5.myworkdayjobs.com/AcmeCareers/job/US-ME-Portland/Marketing-Analyst_JR123",
          jobDescription: "<p>Join us.</p><p><b>What we need to see:</b></p><ul><li>Excel</li><li>Clear writing</li></ul>" },
        hiringOrganization: { name: "1000 Acme Holdings" },
      });
    });
    const job = await extractJob("https://acme.wd5.myworkdayjobs.com/en-US/AcmeCareers/job/US-ME-Portland/Marketing-Analyst_JR123/apply");
    expect(job).toMatchObject({ ats: "workday", title: "Marketing Analyst", company: "Acme", location: "US, ME, Portland", requirements: ["Excel", "Clear writing"] });
    expect(job.applicationUrl).toBe("https://acme.wd5.myworkdayjobs.com/AcmeCareers/job/US-ME-Portland/Marketing-Analyst_JR123/apply");
  });

  it("refuses links to private addresses", async () => {
    await expect(assertPublicUrl("http://localhost:3000/x")).rejects.toThrow(/private/);
    await expect(assertPublicUrl("http://127.0.0.1/x")).rejects.toThrow(/private/);
    await expect(assertPublicUrl("http://169.254.169.254/latest")).rejects.toThrow(/private/);
    await expect(assertPublicUrl("file:///etc/passwd")).rejects.toThrow(/https/);
  });

  it("reads a Greenhouse job with its questions, requirements, and the recruiter it names", async () => {
    const job = await extractJob("https://job-boards.greenhouse.io/acme/jobs/123");
    expect(job).toMatchObject({ ats: "greenhouse", title: "Product Analyst Intern", company: "Acme Corp", department: "Product", location: "Boston, MA" });
    expect(job.requirements).toEqual(["Comfort with SQL", "Clear writing"]);
    expect(job.postedRecruiter).toEqual({ name: "Jordan Smith", title: "Recruiter", email: "jordan.smith@acme.com" });
    // The paste-your-resume box is dropped in favor of the file upload.
    expect(job.questions.map((item) => item.key)).not.toContain("resume_text");
    expect(job.questions.find((item) => item.key === "question_2")?.sensitive).toBe(true);
  });

  it("only names a recruiter when the posting does", () => {
    expect(findPostedRecruiter("We are hiring. Apply today.")).toBeNull();
    expect(findPostedRecruiter("Questions? Contact Maria Lopez, our recruiter, at careers@acme.com")).toEqual({ name: "Maria Lopez", title: "Recruiter", email: null });
    expect(extractRequirements("About\n• Fun team\nWhat you'll bring\n• Python\n• SQL\nBenefits\n• Snacks")).toEqual(["Python", "SQL"]);
  });
});

describe("answers", () => {
  it("fills known fields, leaves sensitive ones for the student, and uses saved answers", () => {
    const questions = [
      q("first_name", "First Name"), q("email", "Email"), q("resume", "Resume/CV", "file"),
      q("grad", "Graduation Year", "select", ["2026", "2027"]),
      q("visa", "Will you now or in the future require sponsorship?", "select", ["Yes", "No"]),
      q("gender", "Gender", "select", ["Male", "Female", "Decline"] , false),
      q("hear", "How did you hear about us?"),
    ];
    const planned = planAnswers(questions, context);
    const by = Object.fromEntries(planned.map((item) => [item.key, item]));
    expect(by.first_name).toMatchObject({ answer: "Pat", source: "profile" });
    expect(by.resume).toMatchObject({ answer: "Pat Doe Resume.pdf", source: "resume_file" });
    expect(by.grad.answer).toBe("2027");
    expect(by.visa).toMatchObject({ answer: null, sensitive: true });
    // Voluntary self-identification declines when the form offers that; nothing else about it is guessed.
    expect(by.gender).toMatchObject({ answer: "Decline", source: "default" });
    expect(planAnswers([q("g2", "Gender", "select", ["Male", "Female"], false)], context)[0]).toMatchObject({ answer: null, sensitive: true });
    expect(by.hear).toMatchObject({ answer: "Company website", source: "default" });
    expect(missingAnswers(planned).map((item) => item.key)).toEqual(["visa"]);

    const withSaved = planAnswers(questions, { ...context, profile: { ...profile, saved: { "will you now or in the future require sponsorship": { label: "x", answer: "No", updatedAt: "" } } } });
    expect(withSaved.find((item) => item.key === "visa")).toMatchObject({ answer: "No", source: "saved" });
  });

  it("answers the phone type as mobile and never types the number into it", () => {
    const planned = planAnswers([
      q("type", "Phone Device Type", "select", ["Landline", "Mobile"]),
      q("type2", "Phone Type", "select", ["Home", "Cell", "Work"]),
      q("ext", "Phone Extension", "text", [], false),
      q("phone", "Phone Number"),
    ], context);
    expect(planned.map((item) => item.answer)).toEqual(["Mobile", "Cell", null, "207-555-0100"]);
  });

  it("uses the student's eligibility answers however the form words them, and never without them", () => {
    const withAnswers = { ...context, profile: { ...profile, eligibility: { workAuthorized: "Yes", needsSponsorship: "No", over18: "Yes" } } };
    const questions = [
      q("a", "Are you legally authorized to work in the United States?", "select", ["Yes", "No"]),
      q("b", "Will you now or in the future require sponsorship for employment visa status?", "select", ["Yes", "No"]),
      q("c", "Are you 18 years of age or older?", "select", ["Yes", "No"]),
      q("hear", "How did you hear about us?", "select", ["LinkedIn", "Careers Site", "Referral"]),
    ];
    expect(planAnswers(questions, withAnswers).map((item) => item.answer)).toEqual(["Yes", "No", "Yes", "Careers Site"]);
    expect(planAnswers(questions, context).map((item) => item.answer)).toEqual([null, null, null, "Careers Site"]);
  });

  it("keeps a worked-out answer only with a real source", () => {
    const field = (label: string, options: string[] = [], section = "") => ({ selector: "x", label, section, control: options.length ? "select" as const : "text" as const, options, format: null });
    const fields = [
      field("Gender", ["Male", "Female", "I don't wish to answer"]),
      field("Gender", ["Male", "Female"]),
      field("Are you authorized to work in the US?", ["Yes", "No"]),
      field("Job title", [], "Work Experience"),
      field("GPA"),
      field("I have read the Applicant Privacy Notice and agree", ["Yes"]),
    ];
    const resume = "Data Analyst Intern, Maine Credit Union";
    const kept = acceptFixes(fields, [
      { index: 0, value: "I don't wish to answer", source: "default" },
      { index: 1, value: "Female", source: "default" },
      { index: 2, value: "Yes", source: "resume", evidence: "Data Analyst Intern" },
      { index: 3, value: "Data Analyst Intern", source: "resume", evidence: "Data Analyst Intern" },
      { index: 4, value: "3.8", source: "resume", evidence: "GPA 3.8" },
      { index: 5, value: "Yes", source: "default" },
    ], { facts: "First name: Pat", sources: resume, consent: false });
    expect(kept.map((item) => [item.index, item.value])).toEqual([[0, "I don't wish to answer"], [3, "Data Analyst Intern"]]);
    expect(acceptFixes(fields, [{ index: 5, value: "Yes", source: "default" }], { facts: "", sources: "", consent: true }).map((item) => item.index)).toEqual([5]);
  });

  it("reads the resume into schools and jobs, keeping only what the resume says", () => {
    const text = "Pat Doe | Waterville, ME 04901 | 207-555-0100\nColby College, Waterville, ME — B.A. Economics, Expected May 2027, GPA 3.7\nData Analyst Intern, Maine Credit Union — May 2024 – August 2024\n- Built loan dashboards in Tableau\nResearch Assistant, Colby College — Sept 2023 – Present";
    const parsed = keepStated({
      contact: { phone: "207-555-0100", city: "Waterville", state: "ME", postalCode: "04901", email: "pat@gmail.com" },
      education: [{ school: "Colby College", degree: "B.A.", field: "Economics", gpa: "3.7", start: "", end: "Expected May 2027" }, { school: "Harvard University", degree: "M.S." }],
      experience: [
        { title: "Data Analyst Intern", company: "Maine Credit Union", start: "May 2024", end: "August 2024", summary: "Built loan dashboards in Tableau" },
        { title: "Research Assistant", company: "Colby College", start: "Sept 2023", end: "Present" },
        { title: "Software Engineer", company: "Google", start: "2022" },
      ],
      skills: ["Tableau", "Rust"],
    }, text, "h");
    expect(parsed.contact).toMatchObject({ phone: "207-555-0100", city: "Waterville", state: "ME", postalCode: "04901", email: "" });
    expect(parsed.education.map((item) => item.school)).toEqual(["Colby College"]);
    expect(parsed.experience.map((item) => [item.title, item.current])).toEqual([["Data Analyst Intern", false], ["Research Assistant", true]]);
    expect(parsed.skills).toEqual(["Tableau"]);

    const field = (label: string, section: string, options: string[] = [], format: string | null = null) => resumeFieldAnswer(parsed, { label, section, kind: options.length ? "select" : "text", options, format });
    expect(field("Job Title", "Work Experience 1")).toBe("Data Analyst Intern");
    expect(field("Company", "Work Experience 2")).toBe("Colby College");
    expect(field("From", "Work Experience 1", [], "MM/YYYY")).toBe("05/2024");
    expect(field("To", "Work Experience 2", [], "MM/YYYY")).toBeNull();
    expect(field("I currently work here", "Work Experience 2")).toBe("Yes");
    expect(field("School or University", "Education")).toBe("Colby College");
    expect(field("Degree", "Education", ["High School", "Bachelor's Degree", "Master's Degree"])).toBe("Bachelor's Degree");
    expect(field("Field of Study", "Education")).toBe("Economics");
    expect(field("Graduation Date", "Education", [], "MM/YYYY")).toBe("05/2027");
    expect(field("Job Title", "Work Experience 3")).toBeNull();
    expect(formatDate("Sept 2023", "MM/DD/YYYY")).toBe("09/01/2023");
    expect(formatDate("2024", "MM/YYYY")).toBeNull();
    expect(degreeAnswer("Bachelor of Science", ["Associate", "Bachelors", "Masters"])).toBe("Bachelors");
  });

  it("accepts a quote that differs only in punctuation, never one that isn't there", () => {
    const resume = "Led the Colby Data Club — built a dashboard used by 40 students.";
    expect(supportedBy("Led the Colby Data Club, built a dashboard used by 40 students", resume)).toBe(true);
    expect(supportedBy("interned at Google", resume)).toBe(false);
    expect(supportedBy("Led a team of 400 engineers at Colby", resume)).toBe(false);
  });

  it("doesn't hold up autofill for a cover letter, which autofill writes", () => {
    expect(missingAnswers([q("cl", "Cover Letter", "file"), q("cl2", "Cover letter", "textarea")])).toEqual([]);
  });

  it("makes a readable cover letter PDF, even with curly quotes and dashes", async () => {
    const pdf = await coverLetterPdf("Dear Hiring Team,\n\nI\u2019m a junior at Colby \u2014 and I built a dashboard used by 40 students. ".repeat(3) + "\n\nSincerely,\nPat Doe", { name: "Pat Doe", contact: ["pat@colby.edu", "207-555-0100"] });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const { extractText, getDocumentProxy } = await import("unpdf");
    const { text } = await extractText(await getDocumentProxy(new Uint8Array(pdf)), { mergePages: true });
    expect(text).toContain("Pat Doe");
    expect(text).toContain("pat@colby.edu");
    expect(text).toContain("I'm a junior at Colby - and I built a dashboard");
  });

  it("keeps an AI answer only with evidence quoted from the student's own text", () => {
    const sources = "Led the Colby Data Club and built a dashboard used by 40 students.";
    const essay = q("why", "Why this role?", "textarea");
    expect(acceptAiAnswer(essay, "I led the Colby Data Club.", "Led the Colby Data Club", sources)).toBe("I led the Colby Data Club.");
    expect(acceptAiAnswer(essay, "I interned at Google.", "interned at Google", sources)).toBeNull();
    expect(acceptAiAnswer(q("visa", "Do you require visa sponsorship?", "select", ["Yes", "No"]), "No", "Colby Data Club", sources)).toBeNull();
    expect(acceptAiAnswer(q("club", "Club member?", "select", ["Yes", "No"]), "Maybe", "Colby Data Club", sources)).toBeNull();
  });
});

describe("applications", () => {
  it("in fast mode, maps a whole Greenhouse form at once with one AI call and records the timings", async () => {
    const userId = await student();
    await saveApplicationProfile(userId, { fastApply: true, eligibility: { workAuthorized: "Yes", needsSponsorship: "No", over18: "Yes" } });
    process.env.ANTHROPIC_API_KEY = "anthropic";
    model.replies.push(JSON.stringify({ answers: [
      { id: "question_1", value: "I led the Colby Data Club and built a dashboard used by 40 students, and I want to build tools like Acme's.", source: "resume", evidence: "Led the Colby Data Club and built a dashboard used by 40 students." },
      { id: "question_2", value: "Yes", source: "resume", evidence: "Led the Colby Data Club" },
    ] }));
    const { application } = await createApplication(userId, { url: "https://job-boards.greenhouse.io/acme/jobs/123" });
    const by = Object.fromEntries(application.questions.map((item) => [item.key, item]));
    expect(model.calls).toHaveLength(1);
    expect(by.first_name).toMatchObject({ answer: "Pat" });
    expect(by.question_1).toMatchObject({ source: "ai", kind: "textarea" });
    // Sponsorship comes only from the student's own answer; the model's guess is ignored.
    expect(by.question_2).toMatchObject({ answer: "No", sensitive: true });
    expect(by.question_3.answer).toBe("Company website");
    expect(by["school--0"]).toMatchObject({ answer: "Colby College", required: false });
    expect(by.resume_text).toBeUndefined();
    expect(application.fillReport?.timings).toMatchObject({ pipeline: "fast", llmCalls: 1 });
    expect(application.statusMessage).toMatch(/1 AI call/);
  });

  it("adds a job once, drafts grounded answers, and saves the student's answers for next time", async () => {
    const userId = await student();
    process.env.ANTHROPIC_API_KEY = "anthropic";
    model.replies.push(JSON.stringify({ answers: [
      { key: "question_1", answer: "I led the Colby Data Club and want to build tools like Acme's.", evidence: "Led the Colby Data Club" },
      { key: "question_3", answer: "LinkedIn", evidence: "saw it on LinkedIn" },
    ] }));
    const first = await createApplication(userId, { url: "https://job-boards.greenhouse.io/acme/jobs/123" });
    expect(first.duplicate).toBe(false);
    const by = Object.fromEntries(first.application.questions.map((item) => [item.key, item]));
    expect(by.question_1).toMatchObject({ source: "ai", evidence: "Led the Colby Data Club" });
    // The AI's unsupported "LinkedIn" is dropped; the company's own site is the honest default.
    expect(by.question_3).toMatchObject({ answer: "Company website", source: "default" });
    expect(by.question_2.answer).toBeNull();
    expect(model.calls[0]).not.toContain("visa sponsorship");
    // No resume uploaded in this test, so the required resume stays missing rather than faked.
    expect(first.application.missing).toEqual(["resume", "question_2"]);

    const again = await createApplication(userId, { url: "https://job-boards.greenhouse.io/acme/jobs/123?utm=1" });
    expect(again).toMatchObject({ duplicate: true });
    expect((await applications.list(userId)).length).toBe(1);

    await expect(updateAnswers(userId, { applicationId: first.application.id, answers: { question_2: "Maybe" } })).rejects.toThrow(/Pick one/);
    const updated = await updateAnswers(userId, { applicationId: first.application.id, answers: { question_2: "No" }, save: ["question_2"] });
    expect(updated.application.missing).toEqual(["resume"]);
    const state = await applyState(userId);
    expect(state.profile.saved["will you require visa sponsorship"]).toMatchObject({ answer: "No" });
  });

  it("needs a finished profile before reading jobs", async () => {
    const signed = await signUp({ email: "new.student@colby.edu", password: "password123", name: "New Student" });
    await verifyEmail(signed.verifyToken!);
    const userId = (await login("new.student@colby.edu", "password123")).user.id;
    await expect(createApplication(userId, { url: "https://job-boards.greenhouse.io/acme/jobs/123" })).rejects.toThrow(/Finish your profile/);
  });

  it("spends a credit when it prepares a new job's answers, and not again for the same job", async () => {
    const userId = await student();
    const before = (await repo.getAccount(userId))!.balance;
    await createApplication(userId, { url: "https://job-boards.greenhouse.io/acme/jobs/123" });
    expect((await repo.getAccount(userId))!.balance).toBe(before - 1);
    const again = await createApplication(userId, { url: "https://job-boards.greenhouse.io/acme/jobs/123" });
    expect(again.duplicate).toBe(true);
    expect((await repo.getAccount(userId))!.balance).toBe(before - 1);
  });

  it("charges 1 credit per 15 applications and stops when credits run out", async () => {
    const userId = await student();
    await repo.setAccountForTests(userId, { balance: 1, allowanceBalance: 1, purchasedBalance: 0 });
    const ids: string[] = [];
    for (let index = 0; index < 16; index += 1) {
      const { app } = await applications.insert({
        userId, jobKey: `url:acme.com/job/${index}`, jobUrl: `https://acme.com/job/${index}`, ats: "other", title: `Role ${index}`, company: "Acme", companyDomain: null, department: null, location: null,
        description: "", requirements: [], applicationUrl: null, postedRecruiter: null, status: "extracted", statusMessage: "", questions: [], browserSessionId: null, fillReport: null,
        confirmation: null, submittedAt: null, contactsStatus: "idle", contactsMessage: "", charged: false, attempts: 0,
      });
      ids.push(app.id);
    }
    for (const applicationId of ids.slice(0, 15)) await markApplied(userId, { applicationId });
    expect((await repo.getAccount(userId))?.balance).toBe(0);
    await expect(markApplied(userId, { applicationId: ids[15] })).rejects.toThrow(/out of credits/);
    expect((await applications.get(userId, ids[15]))?.status).toBe("extracted");
    // Marking the same job again never charges twice.
    await markApplied(userId, { applicationId: ids[0] });
    expect((await repo.listLedger(userId)).filter((entry) => entry.entryType === "application_debit").length).toBe(1);
  });
});

describe("standard answers", () => {
  const p = (accountConsentAt: string | null = "default") => ({ ...profile, accountConsentAt });
  it("says no relatives or contacts at the company", () => {
    expect(policyAnswer("Do you have any relatives currently employed by Bonduelle?", "select", ["Yes", "No"], p())).toBe("No");
    expect(policyAnswer("Do you know anyone who works here?", "select", ["Yes", "No"], p())).toBe("No");
    expect(policyAnswer("Are you related to any current employees?", "text", [], p())).toBe("No");
  });

  it("writes a short thank-you in a message to the recruiter, never in the cover letter box", () => {
    expect(policyAnswer("Message to the recruiter", "textarea", [], p())).toBe(RECRUITER_NOTE);
    expect(policyAnswer("Is there anything else you'd like us to know?", "textarea", [], p())).toBe(RECRUITER_NOTE);
    expect(policyAnswer("Additional information", "textarea", [], p())).toBe(RECRUITER_NOTE);
    expect(policyAnswer("Let the company know about your interest", "textarea", [], p())).toBe(RECRUITER_NOTE);
    expect(policyAnswer("Cover letter", "textarea", [], p())).toBeNull();
  });

  it("says yes to texts about the application, no to marketing texts", () => {
    expect(policyAnswer("I agree to receive text messages from Bonduelle Americas regarding my job application, interview scheduling, and related updates.", "checkbox", ["Yes"], p())).toBe("Yes");
    expect(policyAnswer("Opt in for texts to this number", "select", ["Yes", "No"], p())).toBe("Yes");
    expect(policyAnswer("I agree to receive marketing text messages and promotional offers", "select", ["Yes", "No"], p())).toBe("No");
    expect(classifyQuestion("Primary Phone Number").field).toBe("phone");
  });

  it("accepts terms and acknowledgements unless the student turned that off, and never signs away rights", () => {
    expect(policyAnswer("I acknowledge that I have read the Applicant Privacy Notice", "checkbox", ["Yes"], p())).toBe("Yes");
    expect(policyAnswer("Do you accept the terms and conditions?", "select", ["I accept", "I do not accept"], p())).toBe("I accept");
    expect(policyAnswer("I certify that the information provided is true and complete", "checkbox", ["Yes"], p())).toBe("Yes");
    expect(policyAnswer("Do you accept the terms and conditions?", "select", ["Yes", "No"], p(null))).toBeNull();
    expect(policyAnswer("I agree to the arbitration agreement", "checkbox", ["Yes"], p())).toBeNull();
  });
});

describe("Workday questions students hit", () => {
  it("says yes to light travel, leaves heavy travel to the student", () => {
    const p = { ...profile, accountConsentAt: "default" };
    expect(policyAnswer("Are you able to travel, up to 10%", "select", ["Yes", "No"], p)).toBe("Yes");
    expect(policyAnswer("Are you willing to travel?", "select", ["Yes", "No"], p)).toBe("Yes");
    expect(policyAnswer("This role requires travel up to 75%. Are you able to travel?", "select", ["Yes", "No"], p)).toBeNull();
  });

  it("answers tool experience from the resume, yes only when the resume names a tool", () => {
    const question = "Do you have hands-on administration experience with online booking tools such as Concur or Atriis?";
    expect(toolExperienceAnswer(question, "select", ["Yes", "No"], "Managed travel bookings in SAP Concur for a 40-person team.")).toBe("Yes");
    expect(toolExperienceAnswer(question, "select", ["Yes", "No"], "Led the Colby Data Club; built dashboards in Tableau.")).toBe("No");
    expect(toolExperienceAnswer("Why do you want this job?", "textarea", [], "Concur")).toBeNull();
  });

  it("writes a headline from the profile", () => {
    const year = String(new Date().getFullYear() + 1);
    expect(headlineAnswer("Headline", { ...context, graduationYear: year })).toBe("Economics student at Colby College");
    expect(headlineAnswer("Headline", { ...context, graduationYear: "2019" }, { title: "Data Analyst", company: "Acme" })).toBe("Data Analyst at Acme");
    expect(headlineAnswer("Summary", context)).toBeNull();
  });
});

describe("tracking outcomes and goals", () => {
  const job = (userId: string, index: number) => ({
    userId, jobKey: `url:acme.com/job/${index}`, jobUrl: `https://acme.com/job/${index}`, ats: "other" as const, title: `Role ${index}`, company: "Acme", companyDomain: null, department: null, location: null,
    description: "", requirements: [], applicationUrl: null, postedRecruiter: null, status: "extracted" as const, statusMessage: "", questions: [], browserSessionId: null, fillReport: null,
    confirmation: null, submittedAt: null, contactsStatus: "idle" as const, contactsMessage: "", charged: false, attempts: 0,
  });

  it("sets an outcome only on applied jobs, and clears it back to submitted", async () => {
    const userId = await student();
    const { app } = await applications.insert(job(userId, 1));
    await expect(setOutcome(userId, { applicationId: app.id, outcome: "interviewing" })).rejects.toThrow(/applied first/);
    await markApplied(userId, { applicationId: app.id });
    await expect(setOutcome(userId, { applicationId: app.id, outcome: "hired" })).rejects.toThrow(/interviewing, offer, or rejected/);
    const set = await setOutcome(userId, { applicationId: app.id, outcome: "offer" });
    expect(stageOf(set.application)).toBe("offer");
    const cleared = await setOutcome(userId, { applicationId: app.id, outcome: null });
    expect(stageOf(cleared.application)).toBe("submitted");
  });

  it("keeps a weekly goal between 1 and 200 without touching other settings", async () => {
    const userId = await student();
    await saveApplicationProfile(userId, { accountConsent: true });
    await expect(saveApplicationProfile(userId, { weeklyGoal: 0 })).rejects.toThrow(/between 1 and 200/);
    await saveApplicationProfile(userId, { weeklyGoal: 12 });
    const state = await applyState(userId);
    expect(state.profile.weeklyGoal).toBe(12);
    expect(state.profile.accountConsentAt).toBeTruthy();
  });

  it("counts the week, streak, responses, and time per application", () => {
    const now = new Date(2026, 9, 29, 15); // a Thursday
    const at = (day: number, hour = 12) => new Date(2026, 9, day, hour).toISOString();
    const base = { ats: "greenhouse" as const, fillReport: null, contacts: [] };
    const items = [
      { ...base, status: "submitted" as const, createdAt: at(29, 11), submittedAt: at(29, 11) },
      { ...base, status: "submitted" as const, createdAt: new Date(2026, 9, 28, 12, 0).toISOString(), submittedAt: new Date(2026, 9, 28, 12, 4).toISOString(), fillReport: { filled: [], failed: [], liveViewUrl: null, screenshotAt: null, outcome: "interviewing" as const } },
      { ...base, ats: "lever" as const, status: "applied_manual" as const, createdAt: at(27), submittedAt: at(27), contacts: [{ outreachStatus: "emailed" as const }, { outreachStatus: "not_contacted" as const }] },
      { ...base, status: "submitted" as const, createdAt: at(20), submittedAt: at(20), fillReport: { filled: [], failed: [], liveViewUrl: null, screenshotAt: null, outcome: "rejected" as const } },
      { ...base, status: "extracted" as const, createdAt: at(29), submittedAt: null },
    ];
    const stats = applicationStats(items, now);
    expect(stats.applied).toBe(4);
    expect(stats.inProgress).toBe(1);
    expect(stats.thisWeek).toBe(3); // Monday Oct 26 onward
    expect(stats.daysLeft).toBe(4);
    expect(stats.streak).toBe(3);
    expect(stats.responses).toBe(2);
    expect(stats.interviews).toBe(1);
    expect(stats.peopleReached).toBe(1);
    expect(stats.medianMinutes).toBe(4);
    expect(stats.perDay).toHaveLength(14);
    expect(stats.perDay.at(-1)).toEqual({ date: "2026-10-29", count: 1 });
    expect(stats.bySystem).toEqual([{ ats: "greenhouse", count: 3 }, { ats: "lever", count: 1 }]);
  });
});

describe("job-site passwords", () => {
  it("are never stored on the server; only the consent to accept candidate terms is", async () => {
    const userId = await student();
    const saved = await saveApplicationProfile(userId, { jobSitePassword: "Str0ng!Passw0rd", accountConsent: true });
    expect(saved.profile.accountConsentAt).toBeTruthy();
    expect(saved.profile.hasJobSitePassword).toBe(false);
    expect(JSON.stringify(await applicationProfiles.get(userId))).not.toContain("Str0ng");
    await saveApplicationProfile(userId, { accountConsent: false });
    expect((await applyState(userId)).profile.accountConsentAt).toBeNull();
  });
});

describe("people after applying", () => {
  it("ranks people with verified emails first, keeps photos, and writes an email for each person", async () => {
    process.env.APOLLO_API_KEY = "apollo";
    process.env.HUNTER_API_KEY = "hunter";
    process.env.ANTHROPIC_API_KEY = "anthropic";
    process.env.DAILY_USER_SPEND_CENTS = "5000";
    process.env.DAILY_GLOBAL_SPEND_CENTS = "50000";
    const userId = await student();
    model.replies.push("{}");
    const { application } = await createApplication(userId, { url: "https://job-boards.greenhouse.io/acme/jobs/123" });
    await runContactDiscovery(userId, application.id);
    expect((await applications.get(userId, application.id))?.contactsStatus).toBe("idle");

    const person = (id: string, first: string, last: string, title: string) => ({ id, first_name: first, last_name: last, title, organization: { name: "Acme Corp", primary_domain: "acme.com" }, linkedin_url: `https://linkedin.com/in/${id}` });
    const seen: string[] = [];
    setContactFetcher(async (input, init) => {
      const url = String(input);
      seen.push(url.replace(/api_key=[^&]+/, "api_key=…"));
      if (url.includes("mixed_companies/search")) return Response.json({ organizations: [{ primary_domain: "acme.com" }] });
      if (url.includes("people/match")) return Response.json({ person: { title: "Senior Recruiter", email: "jordan.smith@acme.com", email_status: "verified" } });
      if (url.includes("mixed_people/api_search")) {
        const titles = JSON.parse(String(init?.body)).person_titles as string[];
        if (titles.includes("recruiter")) return Response.json({ people: [person("r1", "Avery", "Kim", "University Recruiter"), person("r2", "Sam", "Lee", "Talent Acquisition Partner"), person("r3", "Extra", "Person", "Recruiter")] });
        if (titles.some((title) => /manager|head|director/.test(title))) return Response.json({ people: [person("m1", "Taylor", "Brooks", "Head of Product")] });
        return Response.json({ people: [person("t1", "Riley", "Chen", "Product Analyst")] });
      }
      if (url.includes("bulk_match")) {
        const details = JSON.parse(String(init?.body)).details as Array<{ id: string }>;
        // Apollo verifies everyone except Taylor and the extra recruiter, and returns photos for all.
        const unverified = new Set(["m1", "r3"]);
        return Response.json({ matches: details.map((item) => ({ id: item.id, email: `${item.id}@acme.com`, email_status: unverified.has(item.id) ? "guessed" : "verified", photo_url: `https://img.example.com/${item.id}.jpg` })) });
      }
      if (url.includes("email-finder")) {
        const found = new URL(url).searchParams.get("first_name") === "Taylor";
        return Response.json({ data: found ? { email: "taylor.brooks@acme.com", verification: { status: "valid" } } : { email: null } });
      }
      return new Response("unexpected", { status: 500 });
    });
    model.replies.push(JSON.stringify({ emails: [1, 2, 3, 4, 5].map((index) => ({ index, subject: `Subject ${index}`, body: `Hi ${index}, I applied to the Product Analyst Intern role.` })) }));

    await markApplied(userId, { applicationId: application.id });
    await runContactDiscovery(userId, application.id);

    const app = await applications.get(userId, application.id);
    expect(app).toMatchObject({ status: "applied_manual", contactsStatus: "done", companyDomain: "acme.com" });
    const contacts = await applicationContacts.list(userId, [application.id]);
    expect(contacts.map((item) => [item.rank, item.role, item.name])).toEqual([
      [1, "job_poster", "Jordan Smith"],
      [2, "recruiter", "Avery Kim"],
      [3, "recruiter", "Sam Lee"],
      [4, "hiring_manager", "Taylor Brooks"],
      [5, "team_member", "Riley Chen"],
    ]);
    expect(contacts[0]).toMatchObject({ email: "jordan.smith@acme.com", emailSource: "apollo", title: "Senior Recruiter" });
    // Apollo's guess is dropped; Hunter's verified address is used instead.
    expect(contacts[3]).toMatchObject({ email: "taylor.brooks@acme.com", emailSource: "hunter", photoUrl: "https://img.example.com/m1.jpg" });
    expect(contacts[1]).toMatchObject({ photoUrl: "https://img.example.com/r1.jpg", linkedinUrl: "https://linkedin.com/in/r1" });
    // The third recruiter had no verified email, so verified people outranked them.
    expect(contacts.map((item) => item.name)).not.toContain("Extra Person");
    expect(contacts.every((item) => item.emailBody?.includes("Product Analyst Intern"))).toBe(true);
    expect(model.calls.at(-1)).toContain("Jordan Smith");
    expect(seen.some((url) => url.includes("api_key=hunter"))).toBe(false);
  });

  it("shortens job titles for team searches", () => {
    expect(coreTitle("Account Executive - Commercial, Spotify Technology")).toBe("Account Executive");
    expect(coreTitle("Senior Software Engineer II (Payments)")).toBe("Software Engineer");
  });
});
