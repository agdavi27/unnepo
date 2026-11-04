import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { repo } from "@/lib/db/file-store";
import { applications } from "@/lib/apply/store";
import { setJobPageFetcherForTests } from "@/lib/apply/safe-fetch";
import { readStoredResume } from "@/lib/services/resume";
import { setCompany, setDeferForTests, updateJobDetails } from "@/lib/apply/service";
import { extensionMe, extensionWrite } from "@/lib/extension/service";
import { issueExtensionToken, requireExtensionUser, revokeExtensionToken } from "@/lib/extension/auth";
import { saveStudentProfile } from "@/lib/profile/service";
import { login, signUp, userFromSessionToken, verifyEmail } from "@/lib/services/auth";
import { GET, OPTIONS, POST } from "@/app/api/[...slug]/route";
import { useTempDb } from "./helpers";
import { coverLetterPdf } from "@/lib/apply/cover-letter";
import { generatePassword, unmetRules } from "@/extension/src/shared/password";
import { nationalNumber } from "@/extension/src/content/generic";
import { jobLink, titleParts } from "@/extension/src/content/scan";
import { arrange, postingLink, siteFor, sitesIn } from "@/lib/apply/applied-list";
import { cleanCompanyName, notJobTitle } from "@/lib/apply/job-title";
import { companyFromDescription } from "@/lib/apply/extract";
import { fillFromLink } from "@/lib/apply/job-link";
import { appliedSince, bySite, secondsToApply } from "@/lib/apply/activity-stats";
import { autofillProblems, siteName } from "@/lib/services/admin";

const model = vi.hoisted(() => ({ replies: [] as string[], calls: 0, lastPrompt: "" }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: async (input: { messages: Array<{ content: string }> }) => {
        model.calls += 1;
        model.lastPrompt = input.messages[0]?.content ?? "";
        return { content: [{ type: "text", text: model.replies.shift() ?? "{}" }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10 } };
      },
    };
  },
}));

const GREENHOUSE_JOB = {
  title: "Product Analyst Intern",
  content: "&lt;p&gt;Join us.&lt;/p&gt;",
  location: { name: "Boston, MA" },
  questions: [
    { label: "First Name", required: true, fields: [{ name: "first_name", type: "input_text" }] },
    { label: "Email", required: true, fields: [{ name: "email", type: "input_text" }] },
    { label: "Will you require visa sponsorship?", required: true, fields: [{ name: "question_2", type: "multi_value_single_select", values: [{ label: "Yes", value: 1 }, { label: "No", value: 0 }] }] },
  ],
};

beforeEach(() => {
  useTempDb();
  model.replies = [];
  model.calls = 0;
  setDeferForTests(() => undefined);
  setJobPageFetcherForTests((url) => {
    if (url.endsWith("/boards/acme")) return Promise.resolve(Response.json({ name: "Acme Corp" }));
    if (url.includes("/boards/acme/jobs/123")) return Promise.resolve(Response.json(GREENHOUSE_JOB));
    return Promise.resolve(new Response("not found", { status: 404 }));
  });
});

afterEach(() => {
  setJobPageFetcherForTests(null);
  setDeferForTests(null);
});

async function readyStudent() {
  const signed = await signUp({ email: "pat.doe@colby.edu", password: "password123", name: "Pat Doe" });
  await verifyEmail(signed.verifyToken!);
  const userId = (await login("pat.doe@colby.edu", "password123")).user.id;
  await saveStudentProfile(userId, {
    profile: {
      contact: { firstName: "Pat", lastName: "Doe", email: "pat.doe@colby.edu", phone: "207-555-0100", city: "Waterville", state: "Maine" },
      education: [{ school: "Colby College", degree: "B.A.", major: "Economics", gradDate: "May 2027" }],
      workAuth: { authorizedUS: true, needsSponsorship: false, over18: true },
      essays: { aboutMe: "I led the Colby Data Club and built dashboards for 40 students." },
    },
    confirm: true,
  });
  return userId;
}

const call = async (method: "GET" | "POST", path: string, token: string | null, body?: unknown) => {
  const request = new Request(`https://unneponew.vercel.app/api/extension/${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json", Origin: "chrome-extension://abcdefghijklmnop" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const context = { params: Promise.resolve({ slug: ["extension", ...path.split("/")] }) };
  return method === "GET" ? GET(request, context) : POST(request, context);
};

describe("extension tokens", () => {
  it("work only for the extension, and stop working once revoked", async () => {
    const userId = await readyStudent();
    const { token } = await issueExtensionToken(userId);
    expect(token.startsWith("unx_")).toBe(true);
    const request = new Request("https://x/api/extension/me", { headers: { Authorization: `Bearer ${token}` } });
    const { user, sessionId } = await requireExtensionUser(request);
    expect(user.id).toBe(userId);
    // The same string isn't a website session.
    expect(await userFromSessionToken(token)).toBeNull();
    await revokeExtensionToken(sessionId);
    await expect(requireExtensionUser(request)).rejects.toThrow(/signed out/);
  });
});

describe("extension API", () => {
  it("serves the profile and resume, maps forms with at most one AI call, and caches answers", async () => {
    const userId = await readyStudent();
    process.env.ANTHROPIC_API_KEY = "anthropic";
    const { token } = await issueExtensionToken(userId);

    expect((await call("GET", "me", null)).status).toBe(401);
    const me = await (await call("GET", "me", token)).json();
    expect(me).toMatchObject({ profileReady: true, user: { email: "pat.doe@colby.edu" } });
    const cors = await call("GET", "me", token);
    expect(cors.headers.get("access-control-allow-origin")).toBe("chrome-extension://abcdefghijklmnop");
    const preflight = await OPTIONS(new Request("https://unneponew.vercel.app/api/extension/map", { method: "OPTIONS", headers: { Origin: "chrome-extension://abcdefghijklmnop" } }), { params: Promise.resolve({ slug: ["extension", "map"] }) });
    expect(preflight.status).toBe(204);

    const profile = await (await call("GET", "profile", token)).json();
    expect(profile.profile.contact.phone).toBe("207-555-0100");
    expect(JSON.stringify(profile)).not.toMatch(/password/i);

    // A Greenhouse job is read from Greenhouse itself; no fields needed from the page.
    const job = await (await call("POST", "jobs", token, { url: "https://job-boards.greenhouse.io/acme/jobs/123" })).json();
    expect(job).toMatchObject({ created: true, application: { title: "Product Analyst Intern", ats: "greenhouse" } });
    const again = await (await call("POST", "jobs", token, { url: "https://job-boards.greenhouse.io/acme/jobs/123?gh_src=x" })).json();
    expect(again).toMatchObject({ created: false, application: { id: job.application.id } });
    const greenhouse = await (await call("POST", "map", token, { applicationId: job.application.id })).json();
    const byId = Object.fromEntries(greenhouse.answers.map((item: { id: string; values: string[] }) => [item.id, item.values]));
    expect(byId.first_name).toEqual(["Pat"]);
    expect(byId.question_2).toEqual(["No"]);
    expect(greenhouse.llmCalls).toBe(0);

    // A page Unnepo can't read: tracked from what the page showed, mapped from the fields the extension scanned.
    const portal = await (await call("POST", "jobs", token, { url: "https://careers.globex.example/apply/77", title: "Data Intern", company: "Globex" })).json();
    expect(portal).toMatchObject({ created: true, application: { title: "Data Intern", company: "Globex", ats: "other" } });
    const why = { id: "f3", label: "Why do you want to work here?", type: "textarea", required: true };
    model.replies.push(JSON.stringify({ answers: [{ id: "f3", value: "I led the Colby Data Club and built dashboards for 40 students, and I want to do that at Globex.", source: "resume", evidence: "I led the Colby Data Club and built dashboards for 40 students." }] }));
    const scanned = await (await call("POST", "map", token, {
      applicationId: portal.application.id,
      fields: [
        { id: "f1", label: "Legal first name", type: "text", required: true },
        { id: "f2", label: "School", type: "text", section: "Education", required: true },
        why,
      ],
    })).json();
    expect(model.calls).toBe(1);
    expect(scanned.llmCalls).toBe(1);
    const scannedBy = Object.fromEntries(scanned.answers.map((item: { id: string; values: string[]; source: string }) => [item.id, item]));
    expect(scannedBy.f1.values).toEqual(["Pat"]);
    expect(scannedBy.f2.values).toEqual(["Colby College"]);
    expect(scannedBy.f3.source).toBe("ai");

    // Demographic dropdowns the page script opened to read: the student's choice, or the form's own decline. No AI.
    const before = model.calls;
    const demographics = await (await call("POST", "map", token, {
      applicationId: portal.application.id,
      fields: [
        { id: "d1", label: "How would you describe your sexual orientation? (mark all that apply)", type: "combobox", options: ["Heterosexual", "Gay", "Bisexual", "I don't wish to answer"] },
        { id: "d2", label: "Do you identify as transgender?", type: "combobox", options: ["Yes", "No", "I don't wish to answer"] },
      ],
    })).json();
    expect(model.calls).toBe(before);
    expect(demographics.answers.map((item: { values: string[] }) => item.values[0])).toEqual(["I don't wish to answer", "I don't wish to answer"]);

    // The same question on another form comes from the cache: no second AI call.
    const other = await (await call("POST", "jobs", token, { url: "https://careers.initech.example/jobs/9", title: "Analyst", company: "Initech" })).json();
    const cached = await (await call("POST", "map", token, { applicationId: other.application.id, fields: [{ ...why, id: "q9" }] })).json();
    expect(model.calls).toBe(1);
    expect(cached.answers[0]).toMatchObject({ source: "cache", values: [expect.stringContaining("Colby Data Club")] });

    // Answers the student typed are learned for next time.
    expect(await (await call("POST", "answers", token, { answers: [{ question: "Are you related to anyone at Globex?", answer: "No" }] })).json()).toEqual({ saved: 1 });
    const learned = await (await call("POST", "map", token, { applicationId: other.application.id, fields: [{ id: "r", label: "Are you related to anyone at Globex?", type: "select", options: ["Yes", "No"] }] })).json();
    expect(learned.answers[0].values).toEqual(["No"]);
  });

  it("logs a submission with its screenshot, and undoes it when the student says they didn't apply", async () => {
    const userId = await readyStudent();
    const { token } = await issueExtensionToken(userId);
    const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const logged = await (await call("POST", "submissions", token, { url: "https://careers.globex.example/apply/77", title: "Data Intern", company: "Globex", confidence: "confirmed", screenshot: pixel })).json();
    expect(logged.application).toMatchObject({ status: "submitted", confirmation: { confidence: "confirmed" } });
    const stored = await applications.get(userId, logged.application.id);
    expect(stored?.confirmation?.receiptPath).toBeTruthy();
    expect((await readStoredResume(stored!.confirmation!.receiptPath!))?.byteLength).toBeGreaterThan(0);
    // Applications don't spend credits, however many times one is logged.
    await call("POST", "submissions", token, { applicationId: logged.application.id, confidence: "likely" });
    expect((await repo.listLedger(userId)).filter((entry) => entry.entryType === "application_debit")).toHaveLength(0);

    expect((await call("POST", "submissions", token, { url: "https://x.example/a", title: "A", company: "B", confidence: "maybe" })).status).toBe(400);
    const undone = await (await call("POST", "submissions/undo", token, { applicationId: logged.application.id })).json();
    expect(undone.application).toMatchObject({ status: "extracted", confirmation: null });
  });
});

describe("applying on a job board without Fill", () => {
  it("saves the job the student applied to on Handshake as applied, with the posting's text", async () => {
    const userId = await readyStudent();
    const { token } = await issueExtensionToken(userId);
    const description = "MealPal is hiring a Growth Marketing Intern. You will run campaigns, analyze funnel data, and work with the brand team. Requirements: strong writing, Excel, curiosity.";
    const logged = await (await call("POST", "submissions", token, { url: "https://app.joinhandshake.com/stu/jobs/9876543", title: "Growth Marketing Intern", company: "MealPal", description, confidence: "likely", text: "Application submitted!" })).json();
    expect(logged.application).toMatchObject({ status: "submitted", title: "Growth Marketing Intern", company: "MealPal" });
    expect((await applications.get(userId, logged.application.id))?.description).toBe(description);
  });

  it("saves each job applied to from one search page as its own job, and the same job only once", async () => {
    const userId = await readyStudent();
    const { token } = await issueExtensionToken(userId);
    const search = "https://www.ziprecruiter.com/jobs-search?search=marketing+intern&location=Boston";
    const first = await (await call("POST", "submissions", token, { url: search, title: "Growth Intern", company: "MealPal", confidence: "likely", how: "button_changed" })).json();
    const second = await (await call("POST", "submissions", token, { url: search, title: "Brand Intern", company: "Acme", confidence: "likely", how: "button_changed" })).json();
    const again = await (await call("POST", "submissions", token, { url: search, title: "Growth Intern", company: "MealPal", confidence: "likely", how: "button_changed" })).json();
    expect(second.application.id).not.toBe(first.application.id);
    expect(again.application.id).toBe(first.application.id);
    // Indeed's search keeps the open job in vjk: two jobs, two keys.
    const one = await (await call("POST", "submissions", token, { url: "https://www.indeed.com/jobs?q=intern&vjk=aaa111", title: "Sales Intern", company: "Globex", confidence: "likely" })).json();
    const two = await (await call("POST", "submissions", token, { url: "https://www.indeed.com/jobs?q=intern&vjk=bbb222", title: "Sales Intern", company: "Globex", confidence: "likely" })).json();
    expect(two.application.id).not.toBe(one.application.id);
    const list = await applications.list(userId);
    expect(list.filter((app) => app.status === "submitted").map((app) => app.title).sort()).toEqual(["Brand Intern", "Growth Intern", "Sales Intern", "Sales Intern"]);
    // Saving for later from the same search page adds a job, and never turns an applied one back.
    await call("POST", "add-job", token, { title: "Data Intern", company: "Initech", url: search, stage: "in_progress" });
    await call("POST", "add-job", token, { title: "Growth Intern", company: "MealPal", url: search, stage: "in_progress" });
    const after = await applications.list(userId);
    expect(after.find((app) => app.title === "Data Intern")?.status).toBe("extracted");
    expect(after.find((app) => app.id === first.application.id)?.status).toBe("submitted");
  });

  it("keeps the job board posting as the job's link when the student applied on the company's site", async () => {
    const userId = await readyStudent();
    const { token } = await issueExtensionToken(userId);
    const logged = await (await call("POST", "submissions", token, { url: "https://jobs.lever.co/mealpal/abc/apply", postingUrl: "https://www.indeed.com/viewjob?jk=1a2b3c", title: "Growth Intern", company: "MealPal", confidence: "likely", how: "you_marked" })).json();
    const stored = await applications.get(userId, logged.application.id);
    expect(stored?.fillReport?.postingUrl).toBe("https://www.indeed.com/viewjob?jk=1a2b3c");
    expect(postingLink(stored!)).toBe("https://www.indeed.com/viewjob?jk=1a2b3c");
    expect(siteFor(stored!)).toBe("Indeed");
    // Not a link: ignored.
    const other = await (await call("POST", "submissions", token, { url: "https://jobs.lever.co/globex/x", postingUrl: "javascript:alert(1)", title: "Data Intern", company: "Globex", confidence: "likely" })).json();
    expect((await applications.get(userId, other.application.id))?.fillReport?.postingUrl).toBeUndefined();
  });
});

describe("status lines aren't job titles", () => {
  it("knows Applied on a date and similar lines from real titles", () => {
    for (const line of ["Applied on November 2, 2026", "Applied", "✓ Applied 2 days ago", "Applied Nov 2", "Application submitted", "You've applied", "Posted 3 days ago", "Nov 2, 2026", "Saved"]) expect(notJobTitle(line)).toBe(true);
    for (const title of ["Applied Scientist Intern", "Application Engineer", "Growth Intern", "Savings Analyst", "Postdoctoral Fellow"]) expect(notJobTitle(title)).toBe(false);
  });

  it("never saves one as the title, lists the job as missing its title, and fills it in from the link or by hand", async () => {
    const userId = await readyStudent();
    const { token } = await issueExtensionToken(userId);
    const saved = await (await call("POST", "submissions", token, { url: "https://app.joinhandshake.com/jobs/1234567", title: "Applied on November 2, 2026", company: "Initech", confidence: "likely" })).json();
    expect(saved.application).toMatchObject({ title: "Job title missing", titleMissing: true, companyMissing: false });
    const filled = await (await call("POST", "job-info", token, { applicationId: saved.application.id, info: { title: "Growth Intern", company: "Initech", location: "", description: "" } })).json();
    expect(filled.application).toMatchObject({ title: "Growth Intern", titleMissing: false });
    // An old job saved with the status line as its title is listed as missing it, and can be named by hand.
    await applications.update(userId, saved.application.id, { title: "Applied on November 2, 2026" });
    const fixed = await setCompany(userId, { applicationId: saved.application.id, title: "Brand Intern" });
    expect(fixed.application).toMatchObject({ title: "Brand Intern", titleMissing: false, company: "Initech" });
  });
});

describe("the company named in a job's description", () => {
  it("finds it the way postings say it, and nothing from text that doesn't name one", async () => {
    const intro = "You will run experiments on the funnel, write SQL, and present results to the team every week this summer.";
    expect(await companyFromDescription("Growth Intern", `MealPal is hiring a Growth Intern. ${intro}`)).toBe("MealPal");
    expect(await companyFromDescription("Growth Intern", `${intro}\nAbout Initech\nInitech makes software for banks.`)).toBe("Initech");
    expect(await companyFromDescription("Growth Intern", `At Globex Corporation, we build tools. ${intro}`)).toBe("Globex Corporation");
    expect(await companyFromDescription("Growth Intern", `About the role\n${intro}`)).toBe("");
    expect(await companyFromDescription("Growth Intern", `Join our team! ${intro}`)).toBe("");
  });

  it("names a Handshake job saved as 'app' from its description, without opening the page", async () => {
    const userId = await readyStudent();
    const { token } = await issueExtensionToken(userId);
    const description = "MealPal is hiring a Growth Marketing Intern. You will run campaigns, analyze funnel data, and work with the brand team all summer.";
    const saved = await (await call("POST", "submissions", token, { url: "https://app.joinhandshake.com/jobs/7654321", title: "Growth Marketing Intern", company: "app", description, confidence: "likely" })).json();
    expect(saved.application.companyMissing).toBe(true);
    const fixed = await fillFromLink(userId, { applicationId: saved.application.id });
    expect(fixed.application).toMatchObject({ company: "MealPal", companyMissing: false });
  });
});

describe("company names without the words around them", () => {
  it("cuts link and label words off the name, and leaves real names alone", () => {
    const cases: Array<[string, string]> = [
      ["See more jobs at Anderson Equipment Company", "Anderson Equipment Company"],
      ["View all jobs at MealPal", "MealPal"],
      ["More jobs from Initech →", "Initech"],
      ["Jobs at Globex", "Globex"],
      ["MealPal · Follow", "MealPal"],
      ["Acme 4.2 ★ 1,203 reviews", "Acme"],
      ["Initech's logo", "Initech"],
      ["Company logo for Hooli", "Hooli"],
      ["Learn more about Stark Industries", "Stark Industries"],
      ["Anderson Equipment Company", "Anderson Equipment Company"],
      ["Jobs for the Future", "Jobs for the Future"],
      ["Bank of America", "Bank of America"],
    ];
    for (const [raw, name] of cases) expect(cleanCompanyName(raw)).toBe(name);
  });

  it("saves new jobs with just the name, and fixes ones saved before", async () => {
    const userId = await readyStudent();
    const { token } = await issueExtensionToken(userId);
    const saved = await (await call("POST", "submissions", token, { url: "https://jobs.lever.co/anderson/123", title: "Sales Intern", company: "See more jobs at Anderson Equipment Company", confidence: "likely", how: "you_marked" })).json();
    expect(saved.application.company).toBe("Anderson Equipment Company");
    await applications.update(userId, saved.application.id, { company: "View all jobs at Anderson Equipment Company" });
    const list = await (await call("GET", "jobs", token)).json();
    expect(list.jobs.find((job: { id: string }) => job.id === saved.application.id).company).toBe("Anderson Equipment Company");
  });
});

describe("editing a job and its notes", () => {
  it("changes only what's sent, keeps notes, and turns down a status line as the title", async () => {
    const userId = await readyStudent();
    const { token } = await issueExtensionToken(userId);
    const saved = await (await call("POST", "submissions", token, { url: "https://jobs.lever.co/mealpal/abc", title: "Growth Intern", company: "MealPal", confidence: "likely" })).json();
    const edited = await updateJobDetails(userId, { applicationId: saved.application.id, title: "Growth Marketing Intern", location: "New York, NY", url: "https://www.indeed.com/viewjob?jk=1a2b", notes: "Talked to Sam at the fair." });
    expect(edited.application).toMatchObject({ title: "Growth Marketing Intern", company: "MealPal", location: "New York, NY" });
    expect(edited.application.fillReport?.notes).toBe("Talked to Sam at the fair.");
    expect(edited.application.fillReport?.postingUrl).toBe("https://www.indeed.com/viewjob?jk=1a2b");
    const cleared = await updateJobDetails(userId, { applicationId: saved.application.id, notes: "" });
    expect(cleared.application.fillReport?.notes).toBeUndefined();
    expect(cleared.application.title).toBe("Growth Marketing Intern");
    await expect(updateJobDetails(userId, { applicationId: saved.application.id, title: "Applied on November 2, 2026" })).rejects.toThrow("Type the job title.");
  });
});

describe("filling in a job from its link", () => {
  it("fills a missing company from what the extension read, and never replaces a real one", async () => {
    const userId = await readyStudent();
    const { token } = await issueExtensionToken(userId);
    const saved = await (await call("POST", "submissions", token, { url: "https://www.linkedin.com/jobs/view/4455667788/", title: "LinkedIn Easy Apply job", company: "LinkedIn", confidence: "likely", how: "linkedin_easy_apply" })).json();
    expect(saved.application.companyMissing).toBe(true);
    const description = "Initech's growth intern runs experiments on the funnel and reports to the head of growth. ".repeat(4);
    const filled = await (await call("POST", "job-info", token, { applicationId: saved.application.id, info: { title: "Growth Intern", company: "Initech", location: "Boston, MA", description } })).json();
    expect(filled.changed.sort()).toEqual(["company", "description", "location", "title"]);
    expect(filled.application).toMatchObject({ company: "Initech", title: "Growth Intern", location: "Boston, MA", companyMissing: false });
    // A real company stays.
    const again = await (await call("POST", "job-info", token, { applicationId: saved.application.id, info: { title: "Other", company: "Globex", location: "", description: "" } })).json();
    expect(again.changed).toEqual([]);
    expect(again.application.company).toBe("Initech");
  });

  it("reads company sites on the server, and sends job boards to the extension and LinkedIn nowhere", async () => {
    const userId = await readyStudent();
    const { token } = await issueExtensionToken(userId);
    const linkedin = await call("POST", "read-link", token, { url: "https://www.linkedin.com/jobs/view/123/" });
    expect([linkedin.status, (await linkedin.json()).code]).toEqual([422, "linkedin"]);
    const board = await call("POST", "read-link", token, { url: "https://www.ziprecruiter.com/c/MealPal/Job/Intern?jid=1a2b" });
    expect([board.status, (await board.json()).code]).toEqual([422, "in_browser"]);
    setJobPageFetcherForTests(async () => new Response(`<html><head><script type="application/ld+json">{"@type":"JobPosting","title":"Data Intern","hiringOrganization":{"name":"Globex"},"jobLocation":{"address":{"addressLocality":"Austin","addressRegion":"TX"}},"description":"<p>Globex data team.</p>"}</script></head><body></body></html>`, { status: 200, headers: { "content-type": "text/html" } }));
    const site = await (await call("POST", "read-link", token, { url: "https://careers.globex.example/jobs/data-intern" })).json();
    expect(site.info).toMatchObject({ title: "Data Intern", company: "Globex", location: "Austin, TX" });
  });
});

describe("sorting and filtering the Applied list", () => {
  const app = (company: string, submittedAt: string | null, extra: Record<string, unknown> = {}) => ({
    company, jobUrl: "https://boards.greenhouse.io/x/jobs/1", applicationUrl: null, status: submittedAt ? "submitted" as const : "extracted" as const,
    createdAt: "2026-10-01T12:00:00.000Z", submittedAt, fillReport: null, contacts: [], ...extra,
  });
  const apps = [
    app("Acme", "2026-10-28T12:00:00.000Z"),
    app("globex", "2026-11-02T09:00:00.000Z", { jobUrl: "https://www.ziprecruiter.com/c/Globex/Job/Intern?jid=1" }),
    app("Initech", "2026-10-05T12:00:00.000Z", { contacts: [{ outreachStatus: "emailed" }] }),
    app("Hooli", null, { createdAt: "2026-11-01T12:00:00.000Z" }),
  ];
  const now = new Date("2026-11-02T15:00:00.000Z");
  const names = (list: Array<{ company: string }>) => list.map((item) => item.company);

  it("sorts newest first, oldest first, by company, and by who's waiting on a follow-up", () => {
    expect(names(arrange(apps, { sort: "recent", site: "", when: "all", notFollowed: false, now }))).toEqual(["globex", "Hooli", "Acme", "Initech"]);
    expect(names(arrange(apps, { sort: "oldest", site: "", when: "all", notFollowed: false, now }))).toEqual(["Initech", "Acme", "Hooli", "globex"]);
    expect(names(arrange(apps, { sort: "company", site: "", when: "all", notFollowed: false, now }))).toEqual(["Acme", "globex", "Hooli", "Initech"]);
    expect(names(arrange(apps, { sort: "follow_up", site: "", when: "all", notFollowed: false, now }))).toEqual(["Acme", "globex", "Hooli", "Initech"]);
  });

  it("filters by site, by when, and to jobs nobody has been emailed about", () => {
    expect(names(arrange(apps, { sort: "recent", site: "ZipRecruiter", when: "all", notFollowed: false, now }))).toEqual(["globex"]);
    expect(names(arrange(apps, { sort: "recent", site: "", when: "today", notFollowed: false, now }))).toEqual(["globex"]);
    expect(names(arrange(apps, { sort: "recent", site: "", when: "month", notFollowed: false, now }))).toEqual(["globex", "Hooli"]);
    expect(names(arrange(apps, { sort: "recent", site: "", when: "all", notFollowed: true, now }))).toEqual(["globex", "Acme"]);
    expect(sitesIn(apps)[0]).toEqual({ site: "Greenhouse", count: 3 });
  });
});

describe("job-site password", () => {
  it("makes passwords that meet every rule job sites ask for, and never the same one twice", () => {
    const made = new Set<string>();
    for (let index = 0; index < 300; index += 1) {
      const password = generatePassword();
      expect(password).toHaveLength(16);
      expect(unmetRules(password)).toEqual([]);
      made.add(password);
    }
    expect(made.size).toBe(300);
  });

  it("says which rules a password the student typed still misses", () => {
    expect(unmetRules("abc")).toEqual(["A numeric character", "An uppercase character", "A special character", "A minimum of 8 characters"]);
    expect(unmetRules("Summer2026!")).toEqual([]);
    expect(unmetRules("        ")).toContain("A special character");
  });
});

describe("resume from the extension", () => {
  it("uploads a new resume, shows it in the panel's info, and serves the file back", async () => {
    const userId = await readyStudent();
    const { token } = await issueExtensionToken(userId);
    const before = await (await call("GET", "me", token)).json();
    expect(before.resume).toBeNull();
    // No resume yet: the download says so instead of failing silently.
    const missing = await call("GET", "resume", token);
    expect(missing.status).toBe(404);
    expect((await missing.json()).error).toMatch(/upload a resume/i);

    const bytes = await coverLetterPdf("Pat Doe. Colby College, B.A. Economics, May 2027. Led the Colby Data Club.", { name: "Pat Doe", contact: [] });
    const form = new FormData();
    form.append("file", new File([Buffer.from(bytes)], "Pat Doe Resume.pdf", { type: "application/pdf" }));
    const upload = await POST(new Request("https://unneponew.vercel.app/api/extension/resume", { method: "POST", headers: { Authorization: `Bearer ${token}`, Origin: "chrome-extension://abcdefghijklmnop" }, body: form }), { params: Promise.resolve({ slug: ["extension", "resume"] }) });
    expect(upload.status).toBe(200);

    const after = await (await call("GET", "me", token)).json();
    expect(after.resume).toMatchObject({ fileName: "Pat Doe Resume.pdf", file: true });
    // The stored file is the whole file (the PDF reader used to leave it empty).
    expect((await readStoredResume((await repo.getLatestResume(userId))!.storagePath))?.byteLength).toBe(bytes.byteLength);
    const file = await call("GET", "resume", token);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-disposition")).toContain("Pat Doe Resume.pdf");
    expect(new Uint8Array(await file.arrayBuffer()).byteLength).toBe(bytes.byteLength);

    // Without the extension's token, nothing.
    const anonymous = await POST(new Request("https://unneponew.vercel.app/api/extension/resume", { method: "POST", body: new FormData() }), { params: Promise.resolve({ slug: ["extension", "resume"] }) });
    expect(anonymous.status).toBe(401);
  });
});

describe("CV generator", () => {
  it("writes a CV from the student's facts, drops invented numbers, and charges 1 credit per 5", async () => {
    const userId = await readyStudent();
    process.env.ANTHROPIC_API_KEY = "anthropic";
    const { token } = await issueExtensionToken(userId);
    const startCredits = (await repo.getAccount(userId))!.balance;
    const before = await (await call("GET", "me", token)).json();
    expect(before.cv).toEqual({ usesLeft: startCredits * 5, perCredit: 5 });

    const cv = "EDUCATION\nColby College: B.A., Economics (May 2027)\n\nEXPERIENCE\nPresident, Colby Data Club\n• Built dashboards for 40 students\n• Grew membership by 300%\n\nSKILLS\nSQL, Tableau";
    for (let index = 0; index < 6; index += 1) model.replies.push(cv);
    const first = await (await call("POST", "cv", token, {})).json();
    expect(first.text).toContain("EDUCATION");
    expect(first.text).toContain("dashboards for 40 students");
    // "300%" isn't in the profile or resume, so that line is gone.
    expect(first.text).not.toContain("300%");
    expect(Buffer.from(first.pdfBase64, "base64").subarray(0, 5).toString()).toBe("%PDF-");
    expect((await repo.getAccount(userId))!.balance).toBe(startCredits - 1);
    expect(first.usesLeft).toBe(4 + (startCredits - 1) * 5);

    // The next four come out of the same credit; the sixth spends another.
    for (let index = 0; index < 4; index += 1) await call("POST", "cv", token, {});
    expect((await repo.getAccount(userId))!.balance).toBe(startCredits - 1);
    await call("POST", "cv", token, {});
    expect((await repo.getAccount(userId))!.balance).toBe(startCredits - 2);
  });

  it("stops before writing when there are no credits left", async () => {
    const userId = await readyStudent();
    process.env.ANTHROPIC_API_KEY = "anthropic";
    await repo.setAccountForTests(userId, { balance: 0, allowanceBalance: 0, purchasedBalance: 0 });
    const { token } = await issueExtensionToken(userId);
    const calls = model.calls;
    const response = await call("POST", "cv", token, {});
    expect(response.status).toBe(402);
    expect(model.calls).toBe(calls);
  });
});

describe("cover letters from the panel", () => {
  it("writes from a pasted job description when there's no job on the page, and lists the student's jobs", async () => {
    const userId = await readyStudent();
    process.env.ANTHROPIC_API_KEY = "anthropic";
    const { token } = await issueExtensionToken(userId);
    expect((await call("POST", "cover-letter", token, { description: "Too short." })).status).toBe(400);

    const description = "Marketing Associate at Initech. You will plan social campaigns, write weekly newsletters, and report results to the marketing lead.";
    model.replies.push("Dear Hiring Team,\n\nI am a Colby College student studying Economics, and I led the Colby Data Club, where I built dashboards for 40 students. I would bring that to Initech's marketing team.\n\nSincerely,\nPat Doe");
    const letter = await (await call("POST", "cover-letter", token, { description })).json();
    expect(letter.text).toContain("Initech");
    expect(model.lastPrompt).toContain("write weekly newsletters");
    expect(model.lastPrompt).toContain("as the job description below names them");
    // Nothing is added to the tracker for a pasted description.
    expect((await (await call("GET", "jobs", token)).json()).total).toBe(0);

    await call("POST", "jobs", token, { url: "https://careers.globex.example/apply/77", title: "Data Intern", company: "Globex" });
    const list = await (await call("GET", "jobs", token)).json();
    expect(list).toMatchObject({ total: 1, jobs: [{ title: "Data Intern", company: "Globex", status: "extracted" }] });
  });

  it("writes about the Handshake job the student clicked, from the text the page shows", async () => {
    const userId = await readyStudent();
    process.env.ANTHROPIC_API_KEY = "anthropic";
    const { token } = await issueExtensionToken(userId);
    const description = "Retail Manager at Northwind. You will lead a team of 12, plan weekly schedules, and run inventory counts.";
    const first = await (await call("POST", "jobs", token, { url: "https://app.joinhandshake.com/job-search/11814327?page=1&per_page=25", title: "Retail Manager", company: "Northwind", description })).json();
    expect(first).toMatchObject({ created: true, application: { title: "Retail Manager", company: "Northwind" } });
    // Clicking another job in the same search is a different job.
    const other = await (await call("POST", "jobs", token, { url: "https://app.joinhandshake.com/job-search/22222222?page=1&per_page=25", title: "Data Intern", company: "Globex", description: "Data Intern at Globex." })).json();
    expect(other.application.id).not.toBe(first.application.id);

    model.replies.push("Dear Hiring Team,\n\nI would love to lead the Northwind team.\n\nSincerely,\nPat Doe");
    await call("POST", "cover-letter", token, { applicationId: first.application.id, length: "short" });
    expect(model.lastPrompt).toContain("Retail Manager");
    expect(model.lastPrompt).toContain("plan weekly schedules");
    expect(model.lastPrompt).not.toContain("Data Intern");
  });

  it("writes to the student's length, tone and mention, revises on request, and reuses it otherwise", async () => {
    const userId = await readyStudent();
    process.env.ANTHROPIC_API_KEY = "anthropic";
    const { token } = await issueExtensionToken(userId);
    const job = await (await call("POST", "jobs", token, { url: "https://careers.globex.example/apply/77", title: "Data Intern", company: "Globex" })).json();
    const letter = (words: string) => `Dear Hiring Team,\n\n${words} I am a Colby College student studying Economics, and I led the Colby Data Club, where I built dashboards for 40 students.\n\nI would bring the same care to Globex's data team.\n\nSincerely,\nPat Doe`;

    model.replies.push(letter("First."));
    const first = await (await call("POST", "cover-letter", token, { applicationId: job.application.id, length: "short", tone: "warm", mention: "I grew up using Globex products" })).json();
    expect(first.text).toContain("First.");
    expect(model.lastPrompt).toContain("Under 150 words");
    expect(model.lastPrompt).toContain("Tone: warm.");
    expect(model.lastPrompt).toContain("I grew up using Globex products");
    expect(Buffer.from(first.pdfBase64, "base64").subarray(0, 5).toString()).toBe("%PDF-");

    model.replies.push(letter("Revised."));
    const revised = await (await call("POST", "cover-letter", token, { applicationId: job.application.id, previous: first.text, edit: "Make the close more confident" })).json();
    expect(revised.text).toContain("Revised.");
    expect(model.lastPrompt).toContain("Make the close more confident");
    expect(model.lastPrompt).toContain("First.");

    // No choices: the latest letter is reused (that's the one autofill attaches), no new AI call.
    const calls = model.calls;
    const reused = await (await call("POST", "cover-letter", token, { applicationId: job.application.id })).json();
    expect(reused.text).toContain("Revised.");
    expect(model.calls).toBe(calls);
    expect((await call("POST", "cover-letter", token, { applicationId: job.application.id, previous: first.text, edit: "  " })).status).toBe(400);
  });
});

describe("rewriting part of a cover letter", () => {
  it("rewrites only the selected part and keeps the rest as it was", async () => {
    const userId = await readyStudent();
    process.env.ANTHROPIC_API_KEY = "anthropic";
    const { token } = await issueExtensionToken(userId);
    const job = await (await call("POST", "jobs", token, { url: "https://careers.globex.example/apply/79", title: "Data Intern", company: "Globex" })).json();
    const letter = "Dear Hiring Team,\n\nI am applying for the Data Intern role. I really really like data a lot.\n\nSincerely,\nPat Doe";
    model.replies.push("I led the Colby Data Club's dashboards for 40 students.");
    const result = await (await call("POST", "cover-letter", token, { applicationId: job.application.id, previous: letter, part: "I really really like data a lot.", ask: "specific" })).json();
    expect(result.text).toBe("Dear Hiring Team,\n\nI am applying for the Data Intern role. I led the Colby Data Club's dashboards for 40 students.\n\nSincerely,\nPat Doe");
    expect(model.lastPrompt).toContain("concrete detail");
    expect((await call("POST", "cover-letter", token, { applicationId: job.application.id, previous: letter, part: "Not in the letter at all.", ask: "shorter" })).status).toBe(502);
  });
});

describe("quick answers before the first fill", () => {
  it("says which are missing, saves the ones given, and leaves blanks alone", async () => {
    const userId = await readyStudent();
    const { token } = await issueExtensionToken(userId);
    const before = (await (await call("GET", "me", token)).json()).setup;
    expect(before).toMatchObject({ salaryExpectation: "", inPerson: null });
    const saved = await (await call("POST", "setup", token, { salaryExpectation: "$22/hour", inPerson: true, needsSponsorship: false, earliestStart: "  " })).json();
    expect(saved.setup).toMatchObject({ salaryExpectation: "$22/hour", inPerson: true, needsSponsorship: false, earliestStart: "" });
    expect((await (await call("GET", "me", token)).json()).setup.salaryExpectation).toBe("$22/hour");
  });
});

describe("Free's cover letter limit", () => {
  it("writes 5 a month on Free, then stops; the student's own edits and a reused letter don't count", async () => {
    const userId = await readyStudent();
    process.env.ANTHROPIC_API_KEY = "anthropic";
    const { token } = await issueExtensionToken(userId);
    const job = await (await call("POST", "jobs", token, { url: "https://careers.globex.example/apply/78", title: "Data Intern", company: "Globex" })).json();
    for (let index = 0; index < 5; index += 1) {
      model.replies.push(`Dear Hiring Team,\n\nLetter ${index}. I am a Colby College student studying Economics, and I led the Colby Data Club, where I built dashboards for 40 students.\n\nI would bring the same care to Globex's data team.\n\nSincerely,\nPat Doe`);
      expect((await call("POST", "cover-letter", token, { applicationId: job.application.id, tone: "warm" })).status).toBe(200);
    }
    const blocked = await call("POST", "cover-letter", token, { applicationId: job.application.id, tone: "warm" });
    expect(blocked.status).toBe(402);
    expect((await blocked.json()).error).toMatch(/5 cover letters a month/);
    expect((await (await call("POST", "cover-letter", token, { applicationId: job.application.id })).json()).text).toContain("Letter 4.");
    expect((await (await call("POST", "cover-letter", token, { applicationId: job.application.id, text: "My own letter." })).json()).text).toBe("My own letter.");
    expect((await (await call("GET", "me", token)).json()).coverLetters).toEqual({ used: 5, left: 0 });
  });
});

describe("applying activity", () => {
  it("records opened, filled and applied with how it was caught, and the pace by site", async () => {
    const userId = await readyStudent();
    const { token } = await issueExtensionToken(userId);
    const job = await (await call("POST", "jobs", token, { url: "https://careers.globex.example/apply/90", title: "Data Intern", company: "Globex" })).json();
    expect((await call("POST", "activity", token, { applicationId: job.application.id, kind: "filled", fields: 31, needs: 2, ms: 48000 })).status).toBe(200);
    await call("POST", "submissions", token, { applicationId: job.application.id, confidence: "likely", how: "button_changed" });
    const stored = (await applications.get(userId, job.application.id))!;
    expect(stored.fillReport!.activity!.map((event) => [event.kind, event.how ?? null])).toEqual([["opened", null], ["filled", null], ["applied", "button_changed"]]);
    expect(stored.fillReport!.activity![1]).toMatchObject({ fields: 31, needs: 2, ms: 48000, site: "Globex" });
    expect(secondsToApply(stored)).toBeNull(); // the same second: too quick to count
    const opened = new Date(Date.now() - 100_000).toISOString();
    const timed = { ...stored, fillReport: { ...stored.fillReport!, activity: stored.fillReport!.activity!.map((event, index) => (index === 0 ? { ...event, at: opened } : event)) } };
    expect(secondsToApply(timed)).toBeGreaterThanOrEqual(99);
    expect(bySite([timed])).toEqual([{ site: "Globex", count: 1, averageSeconds: expect.any(Number), confirmedShare: 100 }]);
    expect(appliedSince([timed], Date.now() - 3600_000)).toMatchObject({ count: 1, sites: 1 });
  });

  it("keeps the Did you apply? list in Unnepo, and a yes saves the job as applied", async () => {
    const userId = await readyStudent();
    const { token } = await issueExtensionToken(userId);
    await call("POST", "maybe", token, { action: "add", item: { url: "https://www.ziprecruiter.com/c/MealPal/Job/Growth-Intern?jid=1", title: "Growth Intern", company: "MealPal" } });
    const me = await (await call("GET", "me", token)).json();
    expect(me.maybe).toMatchObject([{ title: "Growth Intern", company: "MealPal", site: "ZipRecruiter" }]);
    await call("POST", "maybe", token, { action: "answer", id: me.maybe[0].id, applied: true });
    expect((await (await call("GET", "me", token)).json()).maybe).toEqual([]);
    const saved = (await applications.list(userId)).find((app) => app.title === "Growth Intern")!;
    expect(saved).toMatchObject({ status: "applied_manual", company: "MealPal" });
    expect(saved.fillReport?.activity?.at(-1)).toMatchObject({ kind: "applied", how: "you_marked", site: "ZipRecruiter" });
    // A job confirmed some other way leaves the list by itself.
    await call("POST", "maybe", token, { action: "add", item: { url: "https://careers.globex.example/apply/91", title: "Analyst", company: "Globex" } });
    await call("POST", "submissions", token, { url: "https://careers.globex.example/apply/91", title: "Analyst", company: "Globex", confidence: "confirmed" });
    expect((await (await call("GET", "me", token)).json()).maybe).toEqual([]);
  });

  it("starts and ends an applying session", async () => {
    const userId = await readyStudent();
    const { token } = await issueExtensionToken(userId);
    const started = await (await call("POST", "session", token, { start: true })).json();
    expect(started.session).toMatchObject({ active: true });
    expect((await (await call("GET", "me", token)).json()).session.active).toBe(true);
    expect((await (await call("POST", "session", token, { start: false })).json()).session).toBeNull();
  });
});

describe("one link per job", () => {
  it("turns Indeed's search with a job open into that job's own page, and leaves other links alone", () => {
    expect(jobLink("https://www.indeed.com/jobs?q=intern&l=Boston&vjk=9f8e7d6c5b4a3210")).toBe("https://www.indeed.com/viewjob?jk=9f8e7d6c5b4a3210");
    expect(jobLink("https://www.indeed.com/viewjob?jk=abc123&from=serp")).toBe("https://www.indeed.com/viewjob?jk=abc123");
    expect(jobLink("https://www.ziprecruiter.com/c/MealPal/Job/Intern?jid=1a2b")).toBe("https://www.ziprecruiter.com/c/MealPal/Job/Intern?jid=1a2b");
  });
});

describe("job boards' page titles", () => {
  it("reads the job and company the way boards write them, and nothing from a title that doesn't say both", () => {
    expect(titleParts("Growth Marketing Intern - MealPal - New York, NY | ZipRecruiter")).toEqual({ title: "Growth Marketing Intern", company: "MealPal" });
    expect(titleParts("(3) Data Intern at Globex | Handshake")).toEqual({ title: "Data Intern", company: "Globex" });
    expect(titleParts("MealPal hiring Growth Intern Job in New York, NY | Glassdoor")).toEqual({ title: "Growth Intern", company: "MealPal" });
    expect(titleParts("Analyst - Initech - Austin, TX - Indeed.com")).toEqual({ title: "Analyst", company: "Initech" });
    expect(titleParts("Jobs | ZipRecruiter")).toBeNull();
    expect(titleParts("Search results")).toBeNull();
  });
});

describe("phone numbers next to a country code dropdown", () => {
  it("drops the country code from the number", () => {
    expect(nationalNumber("+1 (207) 555-0100")).toBe("2075550100");
    expect(nationalNumber("1-207-555-0100")).toBe("2075550100");
    expect(nationalNumber("207.555.0100")).toBe("2075550100");
    expect(nationalNumber("+44 20 7946 0958")).toBe("2079460958");
  });
});

describe("company names on job sites", () => {
  it("names the company from the link when the page only says Workday, and fixes ones saved that way", async () => {
    const userId = await readyStudent();
    const { token } = await issueExtensionToken(userId);
    const url = "https://searchinfluence.wd1.myworkdayjobs.com/en-US/careers/job/New-Orleans/Analyst_R9/apply";
    const made = await (await call("POST", "jobs", token, { url, title: "Analyst", company: "Workday" })).json();
    expect(made.application.company).toBe("Searchinfluence");
    // One saved before the fix, on a site Unnepo can't read: the link still names the company.
    await applications.update(userId, made.application.id, { company: "Workday" });
    const listed = await (await call("GET", "jobs", token)).json();
    expect(listed.jobs.find((job: { id: string }) => job.id === made.application.id).company).toBe("Searchinfluence");
    expect((await applications.get(userId, made.application.id))?.company).toBe("Searchinfluence");
  });
});

describe("autofill failure records", () => {
  it("keeps what the extension tried on the application and counts the failures for the admin page", async () => {
    const userId = await readyStudent();
    const { token } = await issueExtensionToken(userId);
    const portal = await (await call("POST", "jobs", token, { url: "https://acme.wd5.myworkdayjobs.com/en-US/careers/job/Boston/Analyst_R123/apply", title: "Analyst", company: "Acme" })).json();
    const applicationId = portal.application.id;
    const site = "acme.wd5.myworkdayjobs.com";
    const sent = await (await call("POST", "attempts", token, {
      applicationId,
      attempts: [
        { site, label: "First Name", type: "text", answer: "", method: "set", ok: true },
        { site, label: "Country", type: "combobox", answer: "United States", method: "click", ok: false, problem: "list_didnt_open", reason: "the list didn't open, by click or keyboard" },
        { site, label: "How did you hear about us?", type: "combobox", answer: "LinkedIn", method: "", ok: false, problem: "no_option", reason: 'no option matching "LinkedIn"' },
        { site, label: "", type: "text", ok: false },
        { site, label: "Weird", type: "text", ok: false, problem: "made_up" },
      ],
    })).json();
    expect(sent.saved).toBe(4);
    await call("POST", "attempts", token, { applicationId, attempts: [{ site, label: "State", type: "combobox", answer: "Maine", method: "click", ok: false, problem: "list_didnt_open", reason: "the list didn't open" }] });

    const saved = await applications.get(userId, applicationId);
    expect(saved?.fillReport?.attempts).toHaveLength(5);
    expect(saved?.fillReport?.attempts?.[3]).toMatchObject({ label: "Weird", problem: "error" });
    // An answers call afterwards keeps the record.
    await call("POST", "map", token, { applicationId, fields: [{ id: "f1", label: "Legal first name", type: "text", required: true }], ai: false });
    expect((await applications.get(userId, applicationId))?.fillReport?.attempts).toHaveLength(5);

    const report = await autofillProblems();
    expect(report).toMatchObject({ tried: 5, failed: 4 });
    expect(report.problems[0]).toMatchObject({ site: "Workday", type: "combobox", problem: "list didn't open", count: 2 });
    expect(report.problems[0].examples.map((example) => example.label)).toEqual(["Country", "State"]);
    expect(report.sites[0]).toMatchObject({ site: "Workday", tried: 5, failed: 4 });
    expect(siteName("jobs.lever.co")).toBe("Lever");
    expect(siteName("careers.globex.com")).toBe("globex.com");

    // Someone else's application can't be written to.
    const other = await signUp({ email: "sam.roe@colby.edu", password: "password123", name: "Sam Roe" });
    await verifyEmail(other.verifyToken!);
    const otherId = (await login("sam.roe@colby.edu", "password123")).user.id;
    const { token: otherToken } = await issueExtensionToken(otherId);
    expect((await call("POST", "attempts", otherToken, { applicationId, attempts: [{ site, label: "X", type: "text", ok: true }] })).status).toBe(404);
  });
});

describe("Workday steps", () => {
  it("tells a step backward, or a fall back to the start, from moving on", async () => {
    const { wentBack, stepText } = await import("@/extension/src/shared/steps");
    const step = (index: number, name = "") => ({ index, total: 6, name });
    expect(wentBack(step(2), step(3), false)).toBe(false);
    expect(wentBack(step(3), step(3), false)).toBe(false);
    expect(wentBack(step(3, "My Experience"), step(1, "Autofill with Resume"), false)).toBe(true);
    // Out of the steps, back at "how do you want to apply".
    expect(wentBack(step(2), null, true)).toBe(true);
    // Between steps the bar can briefly vanish: not backward on its own.
    expect(wentBack(step(2), null, false)).toBe(false);
    expect(wentBack(null, step(1), false)).toBe(false);
    expect(stepText(step(3, "My Experience"))).toBe("step 3 of 6 (My Experience)");
  });

  it("knows the site's language dropdown from a question about languages", async () => {
    const { LANGUAGE_SWITCH } = await import("@/extension/src/content/scan");
    // What Workday's language dropdown says: changing it starts the application over.
    for (const label of ["English", "English (United States)", "Español", "Français", "日本語"]) expect(LANGUAGE_SWITCH.test(label)).toBe(true);
    for (const label of ["Language", "Languages spoken", "English proficiency", "What languages do you speak?", "Country"]) expect(LANGUAGE_SWITCH.test(label)).toBe(false);
  });
});

describe("the side panel's goal and pasted questions", () => {
  it("answers a pasted question with no job, and sends what the goal needs", async () => {
    const userId = await readyStudent();
    process.env.ANTHROPIC_API_KEY = "anthropic";
    model.replies.push("I led a team of four on a class project.");
    expect((await extensionWrite(userId, { question: "Describe a time you led a team" })).answer).toContain("team of four");
    expect(model.lastPrompt).not.toContain("Job:");
    expect(model.lastPrompt).not.toContain("Applying to:");
    await expect(extensionWrite(userId, { question: "" })).rejects.toThrow(/Which question/);

    expect((await extensionMe(userId)).goal).toEqual({ weekly: null, appliedAt: [] });
    await applications.insert({ userId, jobKey: "a", jobUrl: "https://example.com/a", ats: "other", title: "Analyst", company: "Acme", companyDomain: null, department: null, location: null, description: "", requirements: [], applicationUrl: null, postedRecruiter: null, status: "applied_manual", statusMessage: "", questions: [], browserSessionId: null, fillReport: null, confirmation: null, submittedAt: new Date().toISOString(), contactsStatus: "idle", contactsMessage: "", charged: false, attempts: 0 });
    expect((await extensionMe(userId)).goal?.appliedAt).toHaveLength(1);
    delete process.env.ANTHROPIC_API_KEY;
  });
});
