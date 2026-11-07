import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setPeopleSearcherForTests } from "@/lib/apply/people-web";
import { findPeopleForApplication, mixedList, placeBonus } from "@/lib/apply/contacts";
import { repo } from "@/lib/db/file-store";
import { login, signUp, verifyEmail } from "@/lib/services/auth";
import { saveStructuredProfile } from "@/lib/services/workspace";
import { setContactFetcher } from "@/lib/providers/contacts/http";
import { assertPublicUrl, setJobPageFetcherForTests } from "@/lib/apply/safe-fetch";
import { extractJob, extractRequirements, findPostedRecruiter, jobKeyFor, parseJobUrl } from "@/lib/apply/extract";
import { acceptAiAnswer, classifyQuestion, headlineAnswer, missingAnswers, planAnswers, policyAnswer, RECRUITER_NOTE, toolExperienceAnswer } from "@/lib/apply/questions";
import { applicationProfiles, applications, applicationContacts } from "@/lib/apply/store";
import { companyNames, coreTitle, departmentOf, domainFits, guessedDomains, postingDomains, siteDomain, swapAnd } from "@/lib/apply/contacts";
import { extensionCoverLetter, pagePoster } from "@/lib/extension/service";
import { coverLetterPdf } from "@/lib/apply/cover-letter";
import { businessDaysBetween, followUpsDue } from "@/lib/apply/follow-ups";
import { acceptFixes } from "@/lib/apply/fast/fields";
import { degreeAnswer, formatDate, keepStated, resumeFieldAnswer } from "@/lib/apply/resume-profile";
import { supportedBy } from "@/lib/apply/questions";
import { bestOption } from "@/lib/apply/options";
import { checkSchool } from "@/lib/school-plans";
import { classYearOf } from "@/lib/profile/student";
import { contactBounced, revealContact, applyState, saveApplicationProfile, createApplication, markApplied, retryContacts, runContactDiscovery, setDeferForTests, setOutcome, updateAnswers, updateOutreach, writeContactEmail, addJobByHand, companyMissing, setCompany } from "@/lib/apply/service";
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

  it("doesn't spend credits on applications, and tracks any number on Free", async () => {
    const userId = await student();
    const before = (await repo.getAccount(userId))!.balance;
    await createApplication(userId, { url: "https://job-boards.greenhouse.io/acme/jobs/123" });
    expect((await repo.getAccount(userId))!.balance).toBe(before);
    const ids: string[] = [];
    for (let index = 0; index < 25; index += 1) {
      const { app } = await applications.insert({
        userId, jobKey: `url:acme.com/job/${index}`, jobUrl: `https://acme.com/job/${index}`, ats: "other", title: `Role ${index}`, company: "Acme", companyDomain: null, department: null, location: null,
        description: "", requirements: [], applicationUrl: null, postedRecruiter: null, status: "extracted", statusMessage: "", questions: [], browserSessionId: null, fillReport: null,
        confirmation: null, submittedAt: null, contactsStatus: "idle", contactsMessage: "", charged: false, attempts: 0,
      });
      ids.push(app.id);
    }
    for (const applicationId of ids) await markApplied(userId, { applicationId });
    expect((await applications.get(userId, ids[24]))?.status).toBe("applied_manual");
    expect((await repo.getAccount(userId))!.balance).toBe(before);
  });
});

describe("matching answers to dropdown options", () => {
  it("lets Yes and No pick longer options, as whole words only", () => {
    expect(bestOption("Yes", ["Yes, I am authorized to work in the US.", "No, I am not authorized"])).toBe("Yes, I am authorized to work in the US.");
    expect(bestOption("No", ["Yes, I will require sponsorship", "No, I will not require sponsorship"])).toBe("No, I will not require sponsorship");
    expect(bestOption("Yes", ["Yes.*", "No.*"])).toBe("Yes.*");
    expect(bestOption("No", ["Not applicable", "None"])).toBeNull();
    expect(bestOption("Yes", ["Yes - full time", "Yes - part time"])).toBeNull();
  });

  it("ignores brackets, dialing codes, and word order, and knows country names", () => {
    expect(bestOption("United States", ["United States Minor Outlying Islands (+1)", "United States (+1)"])).toBe("United States (+1)");
    expect(bestOption("United States", ["Canada", "United States of America (+1)"])).toBe("United States of America (+1)");
    expect(bestOption("United States", ["US Virgin Islands", "USA"])).toBe("USA");
    expect(bestOption("United States of America", ["United States", "Canada"])).toBe("United States");
    expect(bestOption("UK", ["United Kingdom", "Ukraine"])).toBe("United Kingdom");
    expect(bestOption("Bachelor's Degree", ["Degree - Bachelor’s", "Degree - Master's"])).toBe("Degree - Bachelor’s");
    expect(bestOption("+1 United States", ["United States", "Canada"])).toBe("United States");
    expect(bestOption("Computer Science", ["Computer Science and Engineering", "Computer Science (BS)", "Computer Science (BA)"])).toBeNull();
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

  it("answers notice period, attestations, and commuting", () => {
    const p = { ...profile, accountConsentAt: "default" };
    expect(policyAnswer("What is your current notice period?", "text", [], p)).toBe("2 weeks");
    expect(policyAnswer("What is your current notice period?", "select", ["Immediately", "2 weeks", "1 month"], p)).toBe("2 weeks");
    expect(policyAnswer("I attest that my application documents and all further information about myself which I have submitted to IONOS, Inc is true and complete.", "checkbox", ["Yes"], p)).toBe("Yes");
    const commute = "Are you able to commute multiple times a week into a Philadelphia or New York City office?";
    expect(policyAnswer(commute, "select", ["Yes", "No"], p)).toBe("Yes");
    const remoteOnly = { ...p, student: { standardAnswers: { inPerson: false } } } as unknown as ApplicationProfile;
    expect(policyAnswer(commute, "select", ["Yes", "No"], remoteOnly)).toBe("No");
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
    await expect(setOutcome(userId, { applicationId: app.id, outcome: "hired" })).rejects.toThrow(/follow up, interviewing, or rejected/);
    const set = await setOutcome(userId, { applicationId: app.id, outcome: "offer" });
    expect(stageOf(set.application)).toBe("offer");
    const cleared = await setOutcome(userId, { applicationId: app.id, outcome: null });
    expect(stageOf(cleared.application)).toBe("submitted");
  });

  it("keeps a weekly goal between 1 and 200 without touching other settings", async () => {
    const userId = await student();
    await saveApplicationProfile(userId, { accountConsent: true });
    await expect(saveApplicationProfile(userId, { weeklyGoal: 0 })).rejects.toThrow(/between 1 and 200/);
    await expect(saveApplicationProfile(userId, { dailyGoal: 51 })).rejects.toThrow(/between 1 and 50/);
    // A saved answer is edited in place; a blank one or one that isn't there is turned away.
    const before = await applicationProfiles.get(userId);
    await applicationProfiles.put(userId, { ...before!, saved: { "why here": { label: "Why here?", answer: "Old answer", updatedAt: "2026-01-01T00:00:00.000Z" } } });
    const edited = await saveApplicationProfile(userId, { savedAnswer: { key: "why here", answer: "  New answer " } });
    expect(edited.profile.saved["why here"]).toMatchObject({ label: "Why here?", answer: "New answer" });
    await expect(saveApplicationProfile(userId, { savedAnswer: { key: "why here", answer: "  " } })).rejects.toThrow(/Type an answer/);
    await expect(saveApplicationProfile(userId, { savedAnswer: { key: "gone", answer: "Hi" } })).rejects.toThrow(/isn't there/);
    await saveApplicationProfile(userId, { weeklyGoal: 12 });
    const state = await applyState(userId);
    expect(state.profile.weeklyGoal).toBe(12);
    await expect(saveApplicationProfile(userId, { dailyGoal: 51 })).rejects.toThrow(/between 1 and 50/);
    await saveApplicationProfile(userId, { dailyGoal: 4 });
    expect((await applyState(userId)).profile.dailyGoal).toBe(4);
    await expect(saveApplicationProfile(userId, { streakGoal: 1 })).rejects.toThrow(/between 2 and 365/);
    await saveApplicationProfile(userId, { monthlyGoal: 40, weeklyEmailGoal: 5, monthlyInterviewGoal: 2, streakGoal: 7 });
    expect((await applyState(userId)).profile).toMatchObject({ monthlyGoal: 40, weeklyEmailGoal: 5, monthlyInterviewGoal: 2, streakGoal: 7 });
    await saveApplicationProfile(userId, { monthlyGoal: null });
    expect((await applyState(userId)).profile.monthlyGoal).toBeUndefined();
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
    expect(stats.thisMonth).toBeGreaterThanOrEqual(stats.thisWeek);
    expect(stats.emailedThisWeek).toBe(0);
    expect(stats.interviewsThisMonth).toBe(0);
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
  const person = (id: string, first: string, last: string, title: string) => ({ id, first_name: first, last_name: last, title, organization: { name: "Acme Corp", primary_domain: "acme.com" }, linkedin_url: `https://linkedin.com/in/${id}` });
  type Search = { q_organization_domains_list: string[]; person_titles?: string[]; q_keywords?: string; contact_email_status?: string[] };

  /** A student who applied to Acme's Greenhouse job, and an Apollo that answers searches with `people`. */
  async function appliedWith(people: (search: Search) => Array<ReturnType<typeof person>> | "fail", options: { reveal?: Record<string, Record<string, unknown>>; verified?: string[]; poster?: boolean; hunterValid?: string[]; twitter?: string[]; companies?: Array<{ name: string; primary_domain: string }>; revealFails?: boolean; hunterEmails?: Array<{ value: string; first_name: string; last_name: string; verification?: { status: string } }> } = {}) {
    process.env.APOLLO_API_KEY = "apollo";
    delete process.env.HUNTER_API_KEY;
    process.env.ANTHROPIC_API_KEY = "anthropic";
    process.env.DAILY_USER_SPEND_CENTS = "5000";
    process.env.DAILY_GLOBAL_SPEND_CENTS = "50000";
    const userId = await student();
    model.replies.push("{}");
    const { application } = await createApplication(userId, { url: "https://job-boards.greenhouse.io/acme/jobs/123" });
    if (options.poster === false) await applications.update(userId, application.id, { postedRecruiter: null });
    if (options.hunterValid || options.hunterEmails) process.env.HUNTER_API_KEY = "hunter";
    const searches: Search[] = [];
    setContactFetcher(async (input, init) => {
      const url = String(input);
      if (url.includes("mixed_companies/search")) return Response.json({ organizations: options.companies ?? [{ name: "Acme Dental", primary_domain: "acmedental.com" }, { name: "Acme Corp", primary_domain: "acme.com" }] });
      if (url.includes("people/match")) return Response.json({ person: { title: "Recruiter", email: null } });
      if (url.includes("mixed_people/api_search")) {
        const search = JSON.parse(String(init?.body)) as Search;
        searches.push(search);
        const found = people(search);
        return found === "fail" ? new Response("busy", { status: 500 }) : Response.json({ people: found });
      }
      if (url.includes("api.hunter.io")) {
        const asked = new URL(url);
        if (asked.pathname.endsWith("/email-verifier")) return Response.json({ data: { status: options.hunterValid?.includes(asked.searchParams.get("email") ?? "") ? "valid" : "invalid" } });
        if (asked.pathname.endsWith("/email-finder")) return Response.json({ data: { email: null } });
        return Response.json({ data: { pattern: null, accept_all: false, emails: options.hunterEmails ?? [] } });
      }
      if (url.includes("bulk_match") && options.revealFails) return Response.json({ error: "api/v1/people/bulk_match is not accessible with this api_key on a free plan." }, { status: 403 });
      if (url.includes("bulk_match")) {
        const details = JSON.parse(String(init?.body)).details as Array<{ id: string }>;
        return Response.json({ matches: details.map((item) => ({ id: item.id, email: `${item.id}@acme.com`, email_status: options.verified?.includes(item.id) ? "verified" : "guessed", photo_url: `https://img.example.com/${item.id}.jpg`, ...(options.twitter?.includes(item.id) ? { twitter_url: `https://x.com/${item.id}` } : {}), ...(options.reveal?.[item.id] ?? {}) })) });
      }
      return new Response("unexpected", { status: 500 });
    });
    await markApplied(userId, { applicationId: application.id });
    await runContactDiscovery(userId, application.id);
    return { userId, application: (await applications.get(userId, application.id))!, contacts: await applicationContacts.list(userId, [application.id]), searches };
  }

  it("lists up to 5 people, most relevant first, on the company's real website, with emails in the company's format", async () => {
    // An old wrong match for Acme is tried first and turns up no one; it's replaced by the site that does.
    await repo.setCompanyDomains("Acme Corp", ["acme.org"]);
    const { userId, application, contacts, searches } = await appliedWith((search) => {
      if (search.q_organization_domains_list[0] !== "acme.com") return [];
      if (search.q_keywords === "Colby College") return [person("a1", "Casey", "Park", "Product Manager")];
      if (search.person_titles?.includes("recruiter")) return [person("r1", "Avery", "Kim", "Senior Recruiter"), person("r2", "Sam", "Lee", "University Recruiter"), person("c1", "Pat", "Doe", "Chief People Officer")];
      return [person("t1", "Riley", "Chen", "Product Lead"), person("t2", "Jo", "Ray", "Analyst")];
    }, { verified: ["a1"] });
    // The posting's recruiter first, then the school, campus recruiters, recruiters, the team; executives last. Five in all.
    expect(contacts.map((item) => [item.rank, item.role, item.name, item.email, item.emailSource])).toEqual([
      [1, "job_poster", "Jordan Smith", "jordan.smith@acme.com", "job_posting"],
      [2, "alumni", "Casey Park", "casey.park@acme.com", "likely"],
      [3, "recruiter", "Sam Lee", "sam.lee@acme.com", "likely"],
      [4, "recruiter", "Avery Kim", "avery.kim@acme.com", "likely"],
      [5, "team_member", "Riley Chen", "riley.chen@acme.com", "likely"],
    ]);
    expect(contacts[1].relevance).toContain("Colby College");
    expect(contacts[1].linkedinUrl).toBe("https://linkedin.com/in/a1");
    // No email is written until the student asks, then just that person's, which they can edit.
    expect(contacts.every((item) => item.emailBody === null)).toBe(true);
    model.replies.push(JSON.stringify({ emails: [{ index: 1, subject: "Hello", body: "Hi Jordan, I applied to the Product Analyst Intern role." }] }));
    const written = await writeContactEmail(userId, { applicationId: application.id, contactId: contacts[0].id });
    expect(written.contact?.emailBody).toContain("Product Analyst Intern");
    const edited = await writeContactEmail(userId, { applicationId: application.id, contactId: contacts[0].id, subject: "Hi", body: "My own words." });
    expect(edited.contact).toMatchObject({ emailSubject: "Hi", emailBody: "My own words." });
    // The format came from the posting's own recruiter's address, and is kept for every student.
    expect(application.contactsMessage).toContain("usual format (first.last@acme.com)");
    // No reveals were paid for: everyone's name was already known and the format came free.
    expect((await repo.snapshot()).usage.filter((row) => row.operation === "enrich" && row.success)).toEqual([]);
    expect((await repo.getEmailFormat("acme.com"))?.pattern).toBe("{first}.{last}");
    expect(application).toMatchObject({ contactsStatus: "done", companyDomain: "acme.com" });
    expect((await repo.getCompanyDomains(["Acme Corp"]))["acme corp"]).toEqual(["acme.com"]);
    expect(searches.every((search) => !search.contact_email_status)).toBe(true);
    expect(application.fillReport?.peopleSearch?.steps.slice(0, 2)).toEqual([
      { step: "From Colby College", domain: "acme.org", found: 0 },
      { step: "Recruiters", domain: "acme.org", found: 0 },
    ]);
  });

  it("writes first.last as a best guess when the company's format is unknown, and keeps each person's links", async () => {
    const hiddenName = { ...person("r1", "Avery", "", "Recruiter"), last_name_obfuscated: "K***m" };
    const { application, contacts } = await appliedWith((search) => (search.person_titles?.includes("recruiter") ? [hiddenName] : []), { poster: false, twitter: ["r1"], reveal: { r1: { last_name: "Kim" } } });
    expect(contacts.map((item) => [item.name, item.email, item.emailSource])).toEqual([["Avery Kim", "avery.kim@acme.com", "guess"]]);
    expect(application.contactsMessage).toContain("best guess");
    expect(application.fillReport?.peopleLinks?.["avery kim"]).toEqual([{ label: "LinkedIn", url: "https://linkedin.com/in/r1" }, { label: "X", url: "https://x.com/r1" }]);
  });

  it("shows blurred last names as an initial with no email, unless Hunter knows the person, and says why", async () => {
    const blurred = (id: string, first: string, hidden: string, title: string) => ({ ...person(id, first, "", title), last_name_obfuscated: hidden });
    const { application, contacts } = await appliedWith((search) => (search.person_titles?.includes("recruiter") ? [blurred("r1", "Avery", "Ki***l", "Recruiter"), blurred("r2", "Sam", "Le***e", "Recruiter")] : []), {
      poster: false, revealFails: true, hunterEmails: [{ value: "avery.kimball@acme.com", first_name: "Avery", last_name: "Kimball", verification: { status: "valid" } }],
    });
    expect(contacts.map((item) => [item.name, item.email, item.emailSource])).toEqual([
      ["Avery Kimball", "avery.kimball@acme.com", "hunter"],
      ["Sam L.", null, null],
    ]);
    expect(application.contactsMessage).toBe("");
    // Hunter's verified address was enough: nothing was paid to Apollo, so Sam can be shown when asked.
    expect(application.fillReport?.peopleSearch?.steps.at(-1)).toMatchObject({ step: "Full names", found: 1 });
    expect(Object.keys(application.fillReport?.peopleHidden ?? {})).toEqual(["sam l."]);
    expect(application.fillReport?.peopleLinks?.["sam l."]?.[0]?.label).toBe("LinkedIn");
  });

  it("spends 1 credit for a job's list, not again on a new search, and looks no one up without credits", async () => {
    const found = (search: Search) => (search.q_keywords === "Colby College" ? [person("a1", "Casey", "Park", "Product Manager")] : []);
    const { userId, application, contacts, searches } = await appliedWith(found, { verified: ["a1"] });
    expect(contacts.length).toBeGreaterThan(0);
    const debits = async () => (await repo.listLedger(userId)).filter((entry) => entry.entryType === "unlock_debit").reduce((sum, entry) => sum - entry.amount, 0);
    expect(await debits()).toBe(1);
    await applications.update(userId, application.id, { contactsStatus: "idle" });
    await runContactDiscovery(userId, application.id);
    expect(await debits()).toBe(1);

    const another = async (n: number) => (await applications.insert({
      userId, jobKey: `url:acme.com/job/${n}`, jobUrl: `https://acme.com/job/${n}`, ats: "other", title: "Analyst", company: "Acme Corp", companyDomain: "acme.com", department: null, location: null,
      description: "", requirements: [], applicationUrl: null, postedRecruiter: null, status: "applied_manual", statusMessage: "", questions: [], browserSessionId: null, fillReport: null,
      confirmation: null, submittedAt: null, contactsStatus: "idle", contactsMessage: "", charged: true, attempts: 0,
    })).app;

    // Another job with no credits left, on Free: who's there, from the free searches, kept as roles and titles
    // only (no names, no emails), and nothing spent.
    await repo.setAccountForTests(userId, { balance: 0, allowanceBalance: 0, purchasedBalance: 0 });
    const app = await another(2);
    await runContactDiscovery(userId, app.id);
    expect(await applicationContacts.list(userId, [app.id])).toEqual([]);
    const preview = (await applications.get(userId, app.id))?.fillReport?.peoplePreview;
    expect(preview?.rows).toEqual([{ role: "alumni", title: "Product Manager" }]);
    expect(JSON.stringify(preview)).not.toContain("Casey");
    expect(await debits()).toBe(1);

    // On a paid plan with no credits left: nobody is looked up.
    await repo.setAccountForTests(userId, { plan: "pro" });
    const paid = await another(3);
    const searchesBefore = searches.length;
    await runContactDiscovery(userId, paid.id);
    expect(searches.length).toBe(searchesBefore);
    expect(await applicationContacts.list(userId, [paid.id])).toEqual([]);
    expect((await applications.get(userId, paid.id))?.contactsMessage).toMatch(/out of credits/);
  });

  it("charges nothing for a list with no emails, and never charges an unlimited account", async () => {
    // Blurred names that can't be revealed: the people show, with no email, so no credit is spent.
    const blurred = (id: string, first: string) => ({ ...person(id, first, "", "Recruiter"), last_name_obfuscated: "K***m" });
    const noEmail = await appliedWith((search) => (search.person_titles?.includes("recruiter") ? [blurred("r1", "Avery")] : []), { poster: false, revealFails: true });
    expect(noEmail.contacts.map((item) => item.email)).toEqual([null]);
    expect(noEmail.application.contactsMessage).toContain("Apollo said: (403)");
    expect((await repo.listLedger(noEmail.userId)).filter((entry) => entry.entryType === "unlock_debit")).toHaveLength(0);
  });

  it("never charges an account listed as unlimited, and searches with no credits left", async () => {
    process.env.UNLIMITED_CREDIT_EMAILS = "someone@else.edu, Pat.Doe@colby.edu";
    try {
      const found = (search: Search) => (search.q_keywords === "Colby College" ? [person("a1", "Casey", "Park", "Product Manager")] : []);
      const free = await appliedWith(found, { verified: ["a1"] });
      expect(free.contacts.length).toBeGreaterThan(0);
      expect((await repo.listLedger(free.userId)).filter((entry) => entry.entryType === "unlock_debit")).toHaveLength(0);
      await repo.setAccountForTests(free.userId, { balance: 0, allowanceBalance: 0, purchasedBalance: 0 });
      await applications.update(free.userId, free.application.id, { contactsStatus: "idle", fillReport: { ...free.application.fillReport!, personCharged: false } });
      await runContactDiscovery(free.userId, free.application.id);
      expect((await applications.get(free.userId, free.application.id))?.contactsMessage).not.toMatch(/out of credits/);
    } finally {
      delete process.env.UNLIMITED_CREDIT_EMAILS;
    }
  });

  it("reminds to follow up five business days after emailing, and writes the follow-up in the thread", async () => {
    const found = (search: Search) => (search.q_keywords === "Colby College" ? [person("a1", "Casey", "Park", "Product Manager")] : []);
    const { userId, application, contacts } = await appliedWith(found, { verified: ["a1"] });
    const casey = contacts.find((item) => item.name === "Casey Park")!;
    // Follow-ups written for you are Pro.
    await repo.setAccountForTests(userId, { plan: "pro" });
    await writeContactEmail(userId, { applicationId: application.id, contactId: casey.id, subject: "Hello", body: "Hi Casey, I applied to the Product Analyst Intern role." });
    await updateOutreach(userId, { contactId: casey.id, status: "emailed" });
    const emailedAt = (await applications.get(userId, application.id))!.fillReport!.emailedAt![casey.id];
    expect(emailedAt).toBeTruthy();
    const withPeople = async () => [{ ...(await applications.get(userId, application.id))!, contacts: await applicationContacts.list(userId, [application.id]) }];
    // Monday to the next Monday is five business days; four isn't enough.
    expect(businessDaysBetween(new Date("2026-11-02T10:00:00Z"), new Date("2026-11-09T09:00:00Z"))).toBe(5);
    expect(businessDaysBetween(new Date("2026-11-06T10:00:00Z"), new Date("2026-11-09T09:00:00Z"))).toBe(1);
    expect(followUpsDue(await withPeople(), new Date(Date.parse(emailedAt) + 3 * 86_400_000))).toHaveLength(0);
    expect(followUpsDue(await withPeople(), new Date(Date.parse(emailedAt) + 8 * 86_400_000))).toMatchObject([{ name: "Casey Park", company: "Acme Corp" }]);
    model.replies.push(JSON.stringify({ emails: [{ index: 1, subject: "Re: Hello", body: "Hi Casey, a quick note on my application." }] }));
    const followUp = await writeContactEmail(userId, { applicationId: application.id, contactId: casey.id, followUp: true });
    expect(followUp.contact).toMatchObject({ emailSubject: "Re: Hello" });
    expect(model.calls.at(-1)).toContain("This is a follow-up");
    expect(model.calls.at(-1)).toContain("Hi Casey, I applied to the Product Analyst Intern role.");
    // "I sent it" starts the five days again; marking them replied ends the reminders.
    await updateOutreach(userId, { contactId: casey.id, status: "emailed", followedUp: true });
    expect(Date.parse((await applications.get(userId, application.id))!.fillReport!.emailedAt![casey.id])).toBeGreaterThanOrEqual(Date.parse(emailedAt));
    await updateOutreach(userId, { contactId: casey.id, status: "replied" });
    expect((await applications.get(userId, application.id))!.fillReport!.emailedAt![casey.id]).toBeUndefined();
  });

  it("doesn't write follow-ups on Free", async () => {
    const found = (search: Search) => (search.q_keywords === "Colby College" ? [person("a1", "Casey", "Park", "Product Manager")] : []);
    const { userId, application, contacts } = await appliedWith(found, { verified: ["a1"] });
    const casey = contacts.find((item) => item.name === "Casey Park")!;
    await writeContactEmail(userId, { applicationId: application.id, contactId: casey.id, subject: "Hello", body: "Hi Casey." });
    const calls = model.calls.length;
    await expect(writeContactEmail(userId, { applicationId: application.id, contactId: casey.id, followUp: true })).rejects.toMatchObject({ code: "plan", status: 402 });
    expect(model.calls.length).toBe(calls);
  });

  it("looks for people as soon as a job is applied to, on a paid plan or when Free turns it on", async () => {
    const userId = await student();
    process.env.APOLLO_API_KEY = "apollo";
    setContactFetcher(async () => Response.json({ people: [], organizations: [] }));
    const off = (await addJobByHand(userId, { title: "Intern", company: "Acme Corp" })).application;
    expect(off.contactsStatus).toBe("idle");
    await saveApplicationProfile(userId, { autoFindPeople: true });
    const on = (await addJobByHand(userId, { title: "Analyst", company: "Acme Corp" })).application;
    expect(on.contactsStatus).not.toBe("idle");
  });

  it("keeps going when one search fails", async () => {
    const { application, contacts } = await appliedWith((search) => {
      if (search.q_keywords) return "fail";
      if (search.person_titles?.includes("recruiter")) return [person("r2", "Sam", "Lee", "University Recruiter")];
      return [];
    }, { poster: false });
    expect(contacts.map((item) => [item.role, item.name])).toEqual([["recruiter", "Sam Lee"]]);
    expect(application.fillReport?.peopleSearch?.steps[0]).toMatchObject({ step: "From Colby College", found: 0, error: expect.stringContaining("500") });
  });

  it("never searches a website that doesn't fit the company's name", async () => {
    const { application } = await appliedWith(() => [], { poster: false, companies: [{ name: "The Breadwinners Club", primary_domain: "thebreadwinners.club" }] });
    expect(application.fillReport?.peopleSearch?.domains).not.toContain("thebreadwinners.club");
  });

  it("looks for people only when the student asks", async () => {
    process.env.APOLLO_API_KEY = "apollo";
    const userId = await student();
    model.replies.push("{}");
    const { application } = await createApplication(userId, { url: "https://job-boards.greenhouse.io/acme/jobs/123" });
    await markApplied(userId, { applicationId: application.id });
    expect((await applications.get(userId, application.id))?.contactsStatus).toBe("idle");
    await retryContacts(userId, { applicationId: application.id });
    expect((await applications.get(userId, application.id))?.contactsStatus).toBe("finding");
  });

  it("says why no one was found, and keeps no guess about the company", async () => {
    const { contacts, application } = await appliedWith(() => [], { poster: false });
    expect(contacts).toEqual([]);
    expect(application).toMatchObject({ contactsStatus: "done", companyDomain: null });
    expect(application.contactsMessage).toMatch(/None of the sources Unnepo checks know anyone at Acme/);
    expect(application.fillReport?.peopleSearch?.steps.length).toBeGreaterThanOrEqual(3);
    expect(await repo.getCompanyDomains(["Acme Corp"])).toEqual({});
  });

  describe("finding people the cheapest way that works", () => {
    const blurred = (id: string, first: string, hidden: string, title: string, more = {}) => ({ ...person(id, first, "", title), last_name_obfuscated: hidden, linkedin_url: undefined, ...more }) as unknown as ReturnType<typeof person>;
    const paid = async (userId: string, provider: string, operation: string) => (await repo.snapshot()).usage.filter((row) => row.userId === userId && row.provider === provider && row.operation === operation && row.success).length;

    it("searches wider, for free, when the targeted searches find no one", async () => {
      const { contacts, application } = await appliedWith((search) => ((search as { person_seniorities?: string[] }).person_seniorities ? [person("w1", "Morgan", "Bell", "Office Coordinator")] : []), { poster: false });
      expect(contacts.map((item) => [item.name, item.title])).toEqual([["Morgan Bell", "Office Coordinator"]]);
      expect(contacts[0].relevance).toBe("Office Coordinator at Acme Corp.");
      expect(application.fillReport?.peopleSearch?.steps.map((step) => step.step)).toContain("Anyone at the company");
    });

    it("searches by the company's name when no website works, and keeps only people who work there", async () => {
      const elsewhere = { ...person("x1", "Lee", "Fox", "Recruiter"), organization: { name: "Other Inc", primary_domain: "other.com" } };
      const { contacts } = await appliedWith((search) => (search.q_keywords === "Acme Corp" ? [person("n1", "Dana", "Ward", "Recruiter"), elsewhere] : []), { poster: false });
      expect(contacts.map((item) => item.name)).toEqual(["Dana Ward"]);
    });

    it("reveals only the top person, and leaves the rest for Show person", async () => {
      const { userId, application, contacts } = await appliedWith((search) => (search.person_titles?.includes("recruiter") ? [blurred("r1", "Sam", "Le***e", "University Recruiter"), blurred("r2", "Avery", "Ki***m", "Recruiter"), blurred("r3", "Pat", "Do***e", "Recruiter")] : []), { poster: false, verified: ["r1"], reveal: { r1: { last_name: "Leone" }, r2: { last_name: "Kim" } } });
      expect(await paid(userId, "apollo", "enrich")).toBe(1);
      expect(contacts.map((item) => [item.name, item.email, item.emailSource])).toEqual([["Sam Leone", "r1@acme.com", "apollo"], ["Avery K.", null, null], ["Pat D.", null, null]]);
      const hidden = application.fillReport?.peopleHidden ?? {};
      expect(Object.keys(hidden)).toEqual(["avery k.", "pat d."]);
      // Showing one more pays for one more, and fills them in.
      setContactFetcherOnce(contacts);
      await revealContact(userId, { applicationId: application.id, contactId: contacts[1].id });
      const after = await applicationContacts.list(userId, [application.id]);
      expect(after[1]).toMatchObject({ name: "Avery Kim", emailSource: "apollo", email: "r2@acme.com" });
      expect(await paid(userId, "apollo", "enrich")).toBe(2);
      const report = (await applications.get(userId, application.id))!.fillReport!;
      expect(report.peopleReveals).toBe(2);
      expect(Object.keys(report.peopleHidden ?? {})).toEqual(["pat d."]);
      // The job's limit.
      await applications.update(userId, application.id, { fillReport: { ...report, peopleReveals: 3 } });
      await expect(revealContact(userId, { applicationId: application.id, contactId: after[2].id })).rejects.toThrow(/limit/);
    });
    function setContactFetcherOnce(contacts: Array<{ id: string }>) {
      void contacts;
      setContactFetcher(async (_input, init) => {
        const details = JSON.parse(String(init?.body)).details as Array<{ id: string }>;
        return Response.json({ matches: details.map((item) => ({ id: item.id, last_name: "Kim", email: `${item.id}@acme.com`, email_status: "verified" })) });
      });
    }

    it("uses one Hunter search instead of paying for reveals when Hunter knows the people", async () => {
      const { userId, contacts } = await appliedWith((search) => (search.person_titles?.includes("recruiter") ? [blurred("r1", "Avery", "Ki***l", "Recruiter"), blurred("r2", "Sam", "Le***e", "Recruiter")] : []), {
        poster: false,
        hunterEmails: [{ value: "avery.kimball@acme.com", first_name: "Avery", last_name: "Kimball", verification: { status: "valid" } }, { value: "sam.leone@acme.com", first_name: "Sam", last_name: "Leone" }],
      });
      expect(await paid(userId, "apollo", "enrich")).toBe(0);
      expect(await paid(userId, "hunter", "domain_search")).toBe(1);
      expect(contacts.map((item) => [item.name, item.email, item.emailSource])).toEqual([["Avery Kimball", "avery.kimball@acme.com", "hunter"], ["Sam Leone", "sam.leone@acme.com", "likely"]]);
    });

    it("moves to the next person when an email fails, and stops paying after two reveals", async () => {
      const three = [blurred("r1", "Avery", "Ki***m", "Recruiter"), blurred("r2", "Sam", "Le***e", "Recruiter"), blurred("r3", "Pat", "Do***e", "Recruiter")];
      const { userId, contacts } = await appliedWith((search) => (search.person_titles?.includes("recruiter") ? three : []), { poster: false, hunterValid: ["nobody@acme.com"], reveal: { r1: { last_name: "Kim" }, r2: { last_name: "Leone" }, r3: { last_name: "Doe" } } });
      expect(await paid(userId, "apollo", "enrich")).toBe(2);
      expect(contacts.map((item) => item.name)).toEqual(["Avery Kim", "Sam Leone", "Pat D."]);
    });

    it("drops someone Apollo says has left for another company", async () => {
      const elsewhere = { ...blurred("r1", "Avery", "Ki***m", "Recruiter") };
      const { contacts } = await appliedWith((search) => (search.person_titles?.includes("recruiter") ? [{ ...elsewhere, organization: { name: "Acme Holdings", primary_domain: "acme.com" } }, blurred("r2", "Sam", "Le***e", "Recruiter")] : []), {
        poster: false, verified: ["r2"], reveal: { r1: { last_name: "Kim", organization: { primary_domain: "other.com" } }, r2: { last_name: "Leone" } },
      });
      expect(contacts.map((item) => item.name)).toEqual(["Sam Leone"]);
    });

    it("only says someone shares a school or employer once their history confirms it", async () => {
      const { contacts } = await appliedWith((search) => (search.q_keywords === "Colby College" ? [blurred("a1", "Casey", "Pa***k", "Product Manager"), blurred("a2", "Jo", "Ra***y", "Analyst")] : []), {
        poster: false, verified: ["a1"], reveal: { a1: { last_name: "Park", employment_history: [{ organization_name: "Colby College" }, { organization_name: "Acme Corp" }] } },
      });
      expect(contacts[0].relevance).toMatch(/^Also went to Colby College\./);
      expect(contacts[1].relevance).toMatch(/^May have gone to Colby College\./);
    });

    it("ranks a person sharing a past employer up, and looks for them with free searches", async () => {
      process.env.APOLLO_API_KEY = "apollo";
      setContactFetcher(async (input, init) => {
        const url = String(input);
        if (!url.includes("api_search")) return Response.json({ organizations: [] });
        const search = JSON.parse(String(init?.body));
        if (search.q_keywords === "Patagonia") return Response.json({ people: [person("t1", "Riley", "Chen", "Analyst")] });
        if (search.person_titles?.includes("recruiter")) return Response.json({ people: [person("r1", "Avery", "Kim", "Recruiter")] });
        return Response.json({ people: [] });
      });
      const app = { id: "", userId: "u", jobKey: "", jobUrl: "", ats: "other", title: "Analyst", company: "Acme Corp", companyDomain: "acme.com", department: null, location: null, description: "", requirements: [], applicationUrl: null, postedRecruiter: null, status: "applied_manual", statusMessage: "", questions: [], browserSessionId: null, fillReport: null, confirmation: null, submittedAt: null, contactsStatus: "finding", contactsMessage: "", charged: true, attempts: 0, createdAt: "", updatedAt: "" } as unknown as Parameters<typeof findPeopleForApplication>[1];
      const found = await findPeopleForApplication("u", app, { facts: { pastEmployers: ["Patagonia", "Acme Corp"] } });
      expect(found.people.map((item) => item.name)).toEqual(["Avery Kim", "Riley Chen"]);
      expect(found.people[1].relevance).toMatch(/^May have worked at Patagonia\./);
      expect(found.search.steps.map((step) => step.step)).not.toContain("Also at Acme Corp");
    });

    it("searches public pages last, and keeps only people the page really names", async () => {
      setPeopleSearcherForTests(async () => { setJobPageFetcherForTests(async () => new Response("<h1>Acme team</h1><p>Robin Vale leads people.</p>", { status: 200 })); return [{ name: "Robin Vale", title: "Head of People", url: "https://acme.com/team" }, { name: "Made Up", title: "Recruiter", url: "https://acme.com/team" }, { name: "Link Person", title: "Recruiter", url: "https://www.linkedin.com/in/x" }]; });
      try {
        const { contacts, application } = await appliedWith(() => [], { poster: false, companies: [{ name: "Acme Corp", primary_domain: "acme.com" }] });
        expect(contacts.map((item) => [item.name, item.role, item.email])).toEqual([["Robin Vale", "recruiter", "robin.vale@acme.com"]]);
        expect(application.fillReport?.peopleSearch?.steps.map((step) => step.step)).toContain("Public web pages");
      } finally {
        setPeopleSearcherForTests(null);
        setJobPageFetcherForTests(null);
      }
    });

    it("forgets a format that bounced, and trusts one a reply proved", async () => {
      await repo.setEmailFormat("acme.com", { pattern: "{first}.{last}", acceptAll: false, source: "website" });
      const { userId, application, contacts } = await appliedWith((search) => (search.person_titles?.includes("recruiter") ? [person("r1", "Avery", "Kim", "Recruiter")] : []), { poster: false });
      expect(contacts[0].email).toBe("avery.kim@acme.com");
      await contactBounced(userId, { applicationId: application.id, contactId: contacts[0].id });
      expect((await repo.getEmailFormat("acme.com"))?.pattern).toBeNull();
      expect((await applicationContacts.list(userId, [application.id]))[0]).toMatchObject({ email: null, emailSource: null });
      await repo.setEmailFormat("acme.com", { pattern: "{f}{last}", acceptAll: false, source: "website" });
      const rows = await applicationContacts.replace(userId, application.id, [{ ...contacts[0], applicationId: application.id, userId, email: "akim@acme.com", emailSource: "likely" }]);
      void rows;
      const [row] = await applicationContacts.list(userId, [application.id]);
      await updateOutreach(userId, { contactId: row.id, status: "replied" });
      expect((await repo.getEmailFormat("acme.com"))?.source).toBe("replied");
      await contactBounced(userId, { applicationId: application.id, contactId: row.id });
      expect((await repo.getEmailFormat("acme.com"))?.pattern).toBe("{f}{last}");
    });

    it("mixes the list: at most three recruiters while anyone else is available", () => {
      const row = (role: "recruiter" | "team_member", title: string) => ({ person: { role, title }, bonus: 0 });
      const list = mixedList([row("recruiter", "Recruiter"), row("recruiter", "Recruiter"), row("recruiter", "Recruiter"), row("recruiter", "Recruiter"), row("recruiter", "Recruiter"), row("team_member", "Analyst"), row("team_member", "Manager")], 5);
      expect(list.filter((item) => item.person.role === "recruiter")).toHaveLength(3);
    });

    it("counts a recruiter abroad down and one near the job up", () => {
      expect(placeBonus("Bengaluru, India", "Boston, MA")).toBeLessThan(0);
      expect(placeBonus("Boston, MA", "Boston, MA")).toBeGreaterThan(0);
      expect(placeBonus("", "Boston, MA")).toBe(0);
    });
  });

  it("asks to try again when every search fails", async () => {
    const { contacts, application } = await appliedWith(() => "fail", { poster: false });
    expect(contacts).toEqual([]);
    expect(application.contactsStatus).toBe("failed");
  });

  it("reads the company's own website and names from the posting", () => {
    expect(siteDomain("https://careers.globex.com/jobs/1")).toBe("globex.com");
    expect(siteDomain("https://jobs.acme.co.uk/apply")).toBe("acme.co.uk");
    expect(siteDomain("https://acme.wd5.myworkdayjobs.com/en-US/careers")).toBeNull();
    expect(companyNames({ company: "Acme Corp, Inc.", jobUrl: "https://acme.wd5.myworkdayjobs.com/x" })).toEqual(["Acme Corp, Inc.", "Acme"]);
    expect(companyNames({ company: "Globex", jobUrl: "https://jobs.lever.co/globex-labs/1" })).toEqual(["Globex", "globex labs"]);
    expect(departmentOf({ department: null, title: "Data Analyst Intern" })).toBe("Data");
    expect(departmentOf({ department: "Marketing & Growth", title: "Intern" })).toBe("Marketing");
  });

  it("finds a company Apollo writes with & instead of and, or from its own website", () => {
    expect(swapAnd("Modjeski and Masters")).toBe("Modjeski & Masters");
    expect(swapAnd("Ben & Jerry's")).toBe("Ben and Jerry's");
    expect(swapAnd("Globex")).toBeNull();
    expect(guessedDomains("Modjeski and Masters, Inc.")).toEqual(["modjeskiandmasters.com", "modjeskimasters.com", "modjeski.com"]);
    expect(domainFits("modjeski.com", "Modjeski and Masters")).toBe(true);
    expect(domainFits("mm.com", "Modjeski and Masters")).toBe(true);
    expect(domainFits("eeoc.gov", "Modjeski and Masters")).toBe(false);
    expect(postingDomains("Learn more at www.modjeski.com. EEO: https://www.eeoc.gov/poster. Apply on linkedin.com.", "Modjeski and Masters")).toEqual(["modjeski.com"]);
  });

  it("keeps LinkedIn's hiring-team person only with a real name and profile", () => {
    expect(pagePoster({ name: "Jane  Doe", title: "Talent Partner", profileUrl: "https://www.linkedin.com/in/janedoe/" })).toEqual({ name: "Jane Doe", title: "Talent Partner", email: null, linkedinUrl: "https://www.linkedin.com/in/janedoe/" });
    expect(pagePoster({ name: "Jane", title: "", profileUrl: "" })).toBeNull();
    expect(pagePoster({ name: "Jane Doe", title: "", profileUrl: "https://evil.com/in/x" })?.linkedinUrl).toBeNull();
  });

  it("shortens job titles for team searches", () => {
    expect(coreTitle("Account Executive - Commercial, Spotify Technology")).toBe("Account Executive");
    expect(coreTitle("Senior Software Engineer II (Payments)")).toBe("Software Engineer");
  });
});

describe("questions from the latest round", () => {
  it("answers opt-into texting, phone country code, and current employer", () => {
    const p = { ...profile, accountConsentAt: "default" };
    expect(policyAnswer("Opt into Text Messaging?", "select", ["Yes", "No"], p)).toBe("Yes");
    expect(classifyQuestion("Phone Country Code").field).toBe("phoneCountry");
    expect(classifyQuestion("Country").field).toBe("country");
    const [planned] = planAnswers([q("code", "Phone Country Code", "select", ["Canada (+1)", "United States of America (+1)"])], context);
    expect(planned.answer).toBe("United States of America (+1)");
  });
});

describe("questions autofill used to miss", () => {
  const chosen = { eeo: { gender: "decline", race: "white", hispanicLatino: "no", veteran: "decline", disability: "decline" }, standardAnswers: { salaryExpectation: "$22/hour" } } as unknown as ApplicationProfile["student"];
  const withStudent = { ...context, profile: { ...profile, country: "United States", student: chosen }, classYear: "Junior" };
  const answer = (label: string, kind: ApplicationQuestion["kind"] = "text", options: string[] = []) => planAnswers([q("x", label, kind, options)], withStudent)[0].answer;

  it("answers Hispanic or Latino in the form's words, even under an Ethnicity label", () => {
    expect(answer("Are you Hispanic/Latino?", "select", ["Hispanic or Latino", "Not Hispanic or Latino", "Decline to self-identify"])).toBe("Not Hispanic or Latino");
    expect(answer("Ethnicity", "select", ["Hispanic or Latino", "Not Hispanic or Latino", "I don't wish to answer"])).toBe("Not Hispanic or Latino");
    expect(answer("Are you Hispanic or Latino?", "select", ["Yes", "No", "Decline"])).toBe("No");
  });

  it("uses the student's own salary answer however the question is worded, and never invents one", () => {
    expect(answer("Annual Salary Expectations:*")).toBe("$22/hour");
    expect(answer("What is your desired pay?")).toBe("$22/hour");
    expect(planAnswers([q("x", "Annual Salary Expectations", "text", [])], context)[0]).toMatchObject({ answer: null, sensitive: true });
  });

  it("fills the country however it's asked, but never citizenship", () => {
    expect(answer("Country*", "select", ["Canada", "United States of America"])).toBe("United States of America");
    expect(answer("Which country do you currently reside in?", "select", ["Canada", "United States of America"])).toBe("United States of America");
    expect(answer("Country of residence")).toBe("United States");
    expect(answer("Country of citizenship")).toBeNull();
  });

  it("reuses a saved answer for the same question worded differently, but never across a 'not' or for who you are", () => {
    const saved = {
      "when can you start": { label: "When can you start?", answer: "June 1, 2027", updatedAt: "" },
      "are you willing to relocate": { label: "Are you willing to relocate?", answer: "Yes", updatedAt: "" },
      "gender": { label: "Gender", answer: "Woman", updatedAt: "" },
      "do you require visa sponsorship": { label: "Do you require visa sponsorship?", answer: "No", updatedAt: "" },
    };
    const own = { ...context, profile: { ...profile, saved } };
    const plan = (label: string, kind: ApplicationQuestion["kind"] = "text", options: string[] = []) => planAnswers([q("x", label, kind, options)], own)[0].answer;
    expect(plan("What is your earliest available start date?")).toBe("June 1, 2027");
    expect(plan("Willing to relocation for this role?", "select", ["Yes", "No"])).toBe("Yes");
    expect(plan("Are you not willing to relocate?", "select", ["Yes", "No"])).toBeNull();
    expect(plan("Gender identity", "select", ["Woman", "Man"])).toBeNull();
    expect(plan("Will you now or in the future require sponsorship for a work visa?", "select", ["Yes", "No"])).toBeNull();
    expect(plan("What is your favorite color?")).toBeNull();
  });

  it("answers the year in school, in the form's own words", () => {
    expect(classifyQuestion("What year are you in school?").field).toBe("classYear");
    expect(answer("What year are you in school?", "select", ["Freshman", "Sophomore", "Junior", "Senior"])).toBe("Junior");
    expect(answer("Current year of study", "select", ["1st year", "2nd year", "3rd year", "4th year"])).toBe("3rd year");
    expect(classYearOf({ gradDate: "May 2027" }, new Date("2025-10-01"))).toBe("junior");
    expect(classYearOf({ gradDate: "May 2027" }, new Date("2026-09-01"))).toBe("senior");
    expect(classYearOf({ gradDate: "May 2027", classYear: "graduate" })).toBe("graduate");
  });
});

describe("jobs added by hand, and jobs missing the company", () => {
  it("loads the list without waiting to read a posting, and fixes the company afterward", async () => {
    const userId = await student();
    const jobUrl = "https://acme.wd5.myworkdayjobs.com/en-US/careers/job/Boston/Analyst_R1";
    const { app } = await applications.insert({
      userId, jobKey: "workday:slow", jobUrl, ats: "workday", title: "Analyst", company: "Workday", companyDomain: null, department: null, location: null,
      description: "", requirements: [], applicationUrl: null, postedRecruiter: null, status: "applied_manual", statusMessage: "", questions: [], browserSessionId: null, fillReport: null,
      confirmation: null, submittedAt: null, contactsStatus: "idle", contactsMessage: "", charged: false, attempts: 0,
    });
    const later: Array<() => Promise<void>> = [];
    setDeferForTests((task) => { later.push(task); });
    let reads = 0;
    let release = () => {};
    const slowSite = new Promise<void>((resolve) => { release = resolve; });
    setJobPageFetcherForTests(async () => { reads += 1; await slowSite; return new Response("not found", { status: 404 }); });
    try {
      const state = await applyState(userId);
      expect(reads).toBe(0);
      expect(state.applications.find((item) => item.id === app.id)?.company).toBe("Acme");
      expect((await applications.get(userId, app.id))?.company).toBe("Workday");
      release();
      await Promise.all(later.map((task) => task()));
      expect(reads).toBeGreaterThan(0);
      expect((await applications.get(userId, app.id))?.company).toBe("Acme");
    } finally {
      release();
      setJobPageFetcherForTests(null);
    }
  });

  it("adds a job with just a title and company, or with a link, date and stage", async () => {
    const userId = await student();
    const plain = (await addJobByHand(userId, { title: "Growth Intern", company: "MealPal" })).application;
    expect(plain).toMatchObject({ title: "Growth Intern", company: "MealPal", status: "applied_manual", jobUrl: "", companyMissing: false });
    const second = (await addJobByHand(userId, { title: "Growth Intern", company: "MealPal" })).application;
    expect(second.id).not.toBe(plain.id);
    const full = (await addJobByHand(userId, { title: "Analyst", company: "Stripe", url: "https://stripe.com/jobs/123", stage: "interviewing", appliedOn: "2026-10-20" })).application;
    expect(full).toMatchObject({ jobUrl: "https://stripe.com/jobs/123", status: "applied_manual", submittedAt: "2026-10-20T12:00:00.000Z", fillReport: { outcome: "interviewing" } });
    const later = (await addJobByHand(userId, { title: "Designer", company: "Figma", stage: "in_progress" })).application;
    expect(later).toMatchObject({ status: "extracted", submittedAt: null });
    await expect(addJobByHand(userId, { title: "", company: "Acme" })).rejects.toThrow(/job title/);
    await expect(addJobByHand(userId, { title: "Intern", company: "Acme", url: "javascript:alert(1)" })).rejects.toThrow(/https/);
  });

  it("knows a job saved under a job site's name, and takes the company the student types", async () => {
    expect(companyMissing({ company: "Workday", jobUrl: "https://x.wd5.myworkdayjobs.com/a" })).toBe(true);
    expect(companyMissing({ company: "Handshake", jobUrl: "https://app.joinhandshake.com/stu/jobs/1" })).toBe(true);
    expect(companyMissing({ company: "jobs.lever.co", jobUrl: "https://jobs.lever.co/x" })).toBe(true);
    expect(companyMissing({ company: "", jobUrl: "" })).toBe(true);
    expect(companyMissing({ company: "MealPal", jobUrl: "https://mealpal.applytojob.com/apply/1" })).toBe(false);
    const userId = await student();
    const app = (await addJobByHand(userId, { title: "Intern", company: "ZipRecruiter" })).application;
    expect(app.companyMissing).toBe(true);
    const fixed = (await setCompany(userId, { applicationId: app.id, company: "  Acme   Corp " })).application;
    expect(fixed).toMatchObject({ company: "Acme Corp", companyMissing: false });
  });
});

describe("editing the cover letter", () => {
  it("keeps the student's own edits as typed, with no AI, and attaches that version", async () => {
    const userId = await student();
    model.replies.push("{}");
    const { application } = await createApplication(userId, { url: "https://job-boards.greenhouse.io/acme/jobs/123" });
    const asked = model.replies.length;
    const saved = await extensionCoverLetter(userId, { applicationId: application.id, text: "Dear Acme,\r\n\r\nI fixed this line myself.  " });
    expect(saved.text).toBe("Dear Acme,\n\nI fixed this line myself.");
    expect(saved.pdfBase64.length).toBeGreaterThan(100);
    expect(model.replies.length).toBe(asked);
    expect((await applications.get(userId, application.id))?.fillReport?.coverLetter).toBe("Dear Acme,\n\nI fixed this line myself.");
    await expect(extensionCoverLetter(userId, { applicationId: application.id, text: "  " })).rejects.toThrow(/empty/);
  });
});

describe("school plan check on the home page", () => {
  it("says whether a school covers Unnepo, from the school plans setting", () => {
    const before = process.env.UNNEPO_SCHOOL_PLANS;
    process.env.UNNEPO_SCHOOL_PLANS = "bates.edu=Bates College, colby.edu=Colby College";
    expect(checkSchool("jo@bates.edu")).toEqual({ status: "covered", school: "Bates College" });
    expect(checkSchool("jo@cs.colby.edu")).toEqual({ status: "covered", school: "Colby College" });
    expect(checkSchool("jo@middlebury.edu")).toEqual({ status: "not_covered", school: "Middlebury" });
    expect(checkSchool("jo@gmail.com").status).toBe("not_school");
    expect(checkSchool("not an email").status).toBe("not_school");
    process.env.UNNEPO_SCHOOL_PLANS = before;
  });
});
