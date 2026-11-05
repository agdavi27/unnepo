import { beforeEach, describe, expect, it } from "vitest";
import { mergeRepeats, repeatGroups, sameJob } from "@/lib/apply/merge-repeats";
import { applicationContacts, applications } from "@/lib/apply/store";
import type { JobApplication } from "@/lib/apply/types";
import { emailEvents } from "@/lib/email/store";
import { login, signUp, verifyEmail } from "@/lib/services/auth";
import { useTempDb } from "./helpers";

async function student() {
  const signed = await signUp({ email: "pat.doe@colby.edu", password: "password123", name: "Pat Doe" });
  await verifyEmail(signed.verifyToken!);
  return (await login("pat.doe@colby.edu", "password123")).user.id;
}

const job = (over: Partial<JobApplication> = {}): JobApplication => ({
  id: "a", userId: "u", jobKey: "url:a", jobUrl: "https://a.example/1", ats: "other", title: "Data Intern", company: "Acme", companyDomain: null, department: null, location: null,
  description: "", requirements: [], applicationUrl: null, postedRecruiter: null, status: "applied_manual", statusMessage: "", questions: [], browserSessionId: null, fillReport: null, confirmation: null,
  submittedAt: "2026-11-01T00:00:00Z", contactsStatus: "idle", contactsMessage: "", charged: true, attempts: 0, createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z", ...over,
});

describe("finding repeat jobs", () => {
  it("matches the same job whatever the punctuation or company ending", () => {
    expect(sameJob(job(), job({ title: "data intern!", company: "Acme, Inc." }))).toBe(true);
    expect(sameJob(job(), job({ location: "Boston, MA" }))).toBe(true);
  });

  it("keeps jobs apart that only look alike", () => {
    expect(sameJob(job(), job({ title: "Data Analyst" }))).toBe(false);
    expect(sameJob(job(), job({ company: "Acme Robotics" }))).toBe(false);
    expect(sameJob(job({ location: "Boston" }), job({ location: "Denver" }))).toBe(false);
    expect(sameJob(job({ fillReport: { filled: [], failed: [], liveViewUrl: null, screenshotAt: null, jobNumber: "R-1" } }), job({ fillReport: { filled: [], failed: [], liveViewUrl: null, screenshotAt: null, jobNumber: "R-2" } }))).toBe(false);
    expect(sameJob(job({ ats: "greenhouse", jobKey: "gh:1" }), job({ ats: "greenhouse", jobKey: "gh:2" }))).toBe(false);
    expect(sameJob(job({ submittedAt: "2025-01-01T00:00:00Z" }), job())).toBe(false);
    expect(sameJob(job({ title: "Unknown role" }), job({ title: "Unknown role" }))).toBe(false);
  });

  it("leaves jobs nobody has applied to", () => {
    expect(repeatGroups([job({ status: "extracted" }), job({ id: "b", status: "extracted" })])).toEqual([]);
    expect(repeatGroups([job({ status: "extracted" }), job({ id: "b" })])).toHaveLength(1);
  });
});

describe("combining repeat jobs", () => {
  beforeEach(() => { useTempDb(); });

  it("keeps one job with everything both knew, and its people and emails", async () => {
    const userId = await student();
    const base = { userId, ats: "other" as const, companyDomain: null, department: null, requirements: [], postedRecruiter: null, statusMessage: "", questions: [], browserSessionId: null, confirmation: null, contactsMessage: "", charged: true, attempts: 0, title: "Data Intern", company: "Acme" };
    const report = { filled: [], failed: [], liveViewUrl: null, screenshotAt: null };
    const first = (await applications.insert({ ...base, jobKey: "url:one", jobUrl: "https://unnepo.local/manual/1", applicationUrl: null, location: null, description: "Short.", status: "applied_manual", submittedAt: "2026-11-03T00:00:00Z", contactsStatus: "idle", fillReport: { ...report, notes: "My note", statusHistory: [{ at: "2026-11-03T00:00:00Z", status: "applied", source: "you", summary: "" }] } })).app;
    const second = (await applications.insert({ ...base, company: "Acme, Inc.", jobKey: "url:two", jobUrl: "https://careers.acme.example/9", applicationUrl: "https://careers.acme.example/9", location: "Boston", description: "A much longer description of the job.", status: "submitted", submittedAt: "2026-11-01T00:00:00Z", contactsStatus: "done", fillReport: { ...report, outcome: "interviewing", notes: "From the site", autofillCounted: true, statusHistory: [{ at: "2026-11-04T00:00:00Z", status: "interviewing", source: "email", summary: "" }] } })).app;
    await applicationContacts.replace(userId, second.id, [{ userId, applicationId: second.id, rank: 1, role: "recruiter", name: "Sam Lee", title: "Recruiter", email: "sam@acme.example", emailSource: "apollo", relevance: "", linkedinUrl: null, photoUrl: null, outreachStatus: "emailed", emailSubject: "Hello", emailBody: "Hi Sam" }]);
    const event = await emailEvents.add({ userId, key: "k1", applicationId: second.id, kind: "interview", outcome: "updated" } as never);

    const merged = await mergeRepeats(userId, await applications.list(userId));
    expect(merged).toHaveLength(1);
    const kept = (await applications.list(userId))[0];
    expect(await applications.get(userId, second.id)).toBeNull();
    expect(kept).toMatchObject({ id: first.id, status: "submitted", submittedAt: "2026-11-01T00:00:00Z", jobUrl: "https://careers.acme.example/9", location: "Boston", description: "A much longer description of the job." });
    expect(kept.fillReport).toMatchObject({ outcome: "interviewing", notes: "My note\n\nFrom the site", autofillCounted: true });
    expect(kept.fillReport?.statusHistory?.map((change) => change.status)).toEqual(["applied", "interviewing"]);
    if (event) expect((await emailEvents.forApplication(userId, first.id)).map((item) => item.id)).toContain(event.id);
    expect((await applicationContacts.list(userId, [first.id])).map((person) => person.name)).toEqual(["Sam Lee"]);
    // Run again: nothing left to do.
    expect(await mergeRepeats(userId, await applications.list(userId))).toHaveLength(1);
  });
});
