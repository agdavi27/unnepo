import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { repo } from "@/lib/db/file-store";
import { applications } from "@/lib/apply/store";
import { setJobPageFetcherForTests } from "@/lib/apply/safe-fetch";
import { readStoredResume } from "@/lib/services/resume";
import { setDeferForTests } from "@/lib/apply/service";
import { issueExtensionToken, requireExtensionUser, revokeExtensionToken } from "@/lib/extension/auth";
import { saveStudentProfile } from "@/lib/profile/service";
import { login, signUp, userFromSessionToken, verifyEmail } from "@/lib/services/auth";
import { GET, OPTIONS, POST } from "@/app/api/[...slug]/route";
import { useTempDb } from "./helpers";
import { coverLetterPdf } from "@/lib/apply/cover-letter";
import { generatePassword, unmetRules } from "@/extension/src/shared/password";

const model = vi.hoisted(() => ({ replies: [] as string[], calls: 0 }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: async () => {
        model.calls += 1;
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
    // One credit covers this job; logging it again doesn't charge twice.
    await call("POST", "submissions", token, { applicationId: logged.application.id, confidence: "likely" });
    expect((await repo.listLedger(userId)).filter((entry) => entry.entryType === "application_debit")).toHaveLength(1);

    expect((await call("POST", "submissions", token, { url: "https://x.example/a", title: "A", company: "B", confidence: "maybe" })).status).toBe(400);
    const undone = await (await call("POST", "submissions/undo", token, { applicationId: logged.application.id })).json();
    expect(undone.application).toMatchObject({ status: "extracted", confirmation: null });
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
