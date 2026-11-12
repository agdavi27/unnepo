import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applications } from "@/lib/apply/store";
import { progressOf } from "@/lib/apply/progress";
import { signUp } from "@/lib/services/auth";
import { friendAction, inviteFriend, listFriends } from "@/lib/social/friends";
import { useTempDb } from "./helpers";

const student = async (email: string, name: string) => (await signUp({ email, password: "password123", name })).user.id;

async function applied(userId: string, n: number, submittedAt: string) {
  await applications.insert({
    userId, jobKey: `url:acme.com/job/${n}`, jobUrl: `https://acme.com/job/${n}`, ats: "other", title: `Role ${n}`, company: "Acme", companyDomain: null, department: null, location: null,
    description: "", requirements: [], applicationUrl: null, postedRecruiter: null, status: "submitted", statusMessage: "", questions: [], browserSessionId: null, fillReport: null,
    confirmation: null, submittedAt, contactsStatus: "idle", contactsMessage: "", charged: true, attempts: 0,
  });
}

describe("friends", () => {
  beforeEach(() => { useTempDb(); });
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.RESEND_API_KEY; });

  it("shares this week's count only once the friend accepts", async () => {
    const pat = await student("pat.doe@colby.edu", "Pat Doe");
    const sam = await student("sam.roe@colby.edu", "Sam Roe");
    const since = new Date(Date.now() - 3 * 86_400_000).toISOString();
    await applied(sam, 1, new Date().toISOString());
    await applied(sam, 2, new Date().toISOString());
    await applied(sam, 3, new Date(Date.now() - 6 * 86_400_000).toISOString());

    expect((await inviteFriend(pat, "Sam.Roe@colby.edu")).status).toBe("sent");
    const before = await listFriends(pat, since);
    expect(before.friends).toEqual([]);
    expect(before.outgoing).toEqual([expect.objectContaining({ email: "sam.roe@colby.edu" })]);

    const waiting = await listFriends(sam, since);
    expect(waiting.incoming).toEqual([expect.objectContaining({ name: "Pat Doe" })]);
    await friendAction(sam, { action: "respond", id: waiting.incoming[0].id, accept: true });

    const after = await listFriends(pat, since);
    // Two this week; the one from six days ago is before `since`.
    expect(after.friends).toEqual([expect.objectContaining({ name: "Sam Roe", applied: 2 })]);
    expect(after.outgoing).toEqual([]);
    expect((await listFriends(sam, since)).friends).toEqual([expect.objectContaining({ name: "Pat Doe", applied: 0 })]);
  });

  it("waits for an email with no account, and accepts when the other side asked first", async () => {
    const pat = await student("pat.doe@colby.edu", "Pat Doe");
    await friendAction(pat, { action: "invite", email: "lee.kay@colby.edu" });
    const lee = await student("lee.kay@colby.edu", "Lee Kay");
    expect((await listFriends(lee, "")).incoming).toHaveLength(1);
    // Lee adding Pat back is a yes.
    expect((await inviteFriend(lee, "pat.doe@colby.edu")).status).toBe("accepted");
    expect((await listFriends(pat, "")).friends.map((friend) => friend.name)).toEqual(["Lee Kay"]);
    expect((await inviteFriend(pat, "lee.kay@colby.edu")).status).toBe("already");
  });

  it("emails the invite from contact@unnepo.com as a challenge, with a sign-up link", async () => {
    const pat = await student("pat.doe@colby.edu", "Pat Doe");
    await applied(pat, 1, new Date().toISOString());
    process.env.RESEND_API_KEY = "test-key";
    const sent: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      if (url.includes("resend")) sent.push(JSON.parse(String(init.body)));
      return new Response("{}", { status: 200 });
    });
    const result = await inviteFriend(pat, "lee.kay@colby.edu");
    expect(result.emailed).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].from).toBe("Unnepo <contact@unnepo.com>");
    expect(sent[0].subject).toBe("Pat Doe challenged you to a job hunt");
    expect(String(sent[0].text)).toContain("Pat has applied to 1 job this week");
    expect(String(sent[0].html)).toContain("/signup?email=lee.kay%40colby.edu");
    expect(String(sent[0].html)).toContain("/email/spider-angry.gif");
  });

  it("tries the email again when a request is re-added after email wasn't set up", async () => {
    const pat = await student("pat.doe@colby.edu", "Pat Doe");
    const first = await inviteFriend(pat, "lee.kay@colby.edu");
    expect(first).toMatchObject({ status: "sent", emailed: false });
    process.env.RESEND_API_KEY = "test-key";
    let sent = 0;
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.includes("resend")) sent += 1;
      return new Response("{}", { status: 200 });
    });
    expect(await inviteFriend(pat, "lee.kay@colby.edu")).toMatchObject({ status: "waiting", emailed: true });
    expect(sent).toBe(1);
    // Once it went out, adding them again doesn't send another.
    expect(await inviteFriend(pat, "lee.kay@colby.edu")).toMatchObject({ status: "waiting", emailed: true });
    expect(sent).toBe(1);
  });

  it("refuses yourself and bad emails, and removes or declines", async () => {
    const pat = await student("pat.doe@colby.edu", "Pat Doe");
    const sam = await student("sam.roe@colby.edu", "Sam Roe");
    await expect(friendAction(pat, { action: "invite", email: "pat.doe@colby.edu" })).rejects.toThrow(/your own/);
    await expect(friendAction(pat, { action: "invite", email: "not an email" })).rejects.toThrow(/look like an email/);
    await friendAction(pat, { action: "invite", email: "sam.roe@colby.edu" });
    const request = (await listFriends(sam, "")).incoming[0];
    // Only the person it was sent to can answer it.
    await expect(friendAction(pat, { action: "respond", id: request.id, accept: true })).rejects.toThrow(/gone/);
    await friendAction(sam, { action: "respond", id: request.id, accept: false });
    expect((await listFriends(pat, "")).outgoing).toEqual([]);
    await friendAction(pat, { action: "invite", email: "sam.roe@colby.edu" });
    const again = (await listFriends(pat, "")).outgoing[0];
    await friendAction(pat, { action: "remove", id: again.id });
    expect((await listFriends(sam, "")).incoming).toEqual([]);
  });
});

describe("job progress", () => {
  const job = (patch: Partial<Parameters<typeof progressOf>[0]> = {}) => ({
    id: "j", company: "Ramp", title: "Analyst", status: "submitted", companyMissing: false, createdAt: new Date().toISOString(), submittedAt: new Date().toISOString(),
    fillReport: null, contacts: [], ...patch,
  });

  it("walks Applied → Reach out → Waiting → Follow up → Interview", () => {
    expect(progressOf(job({ status: "in_progress", submittedAt: null }))).toMatchObject({ done: 0 });
    expect(progressOf(job())).toMatchObject({ done: 1, next: "Email someone at Ramp." });
    const emailed = { contacts: [{ id: "c", name: "Jamie", outreachStatus: "emailed" }] };
    expect(progressOf(job({ ...emailed, fillReport: { emailedAt: { c: new Date().toISOString() } } }))).toMatchObject({ done: 2, due: false });
    expect(progressOf(job({ ...emailed, fillReport: { emailedAt: { c: new Date(Date.now() - 10 * 86_400_000).toISOString() } } }))).toMatchObject({ done: 3, due: true });
    expect(progressOf(job({ contacts: [{ id: "c", name: "Jamie", outreachStatus: "replied" }] }))).toMatchObject({ done: 4 });
    expect(progressOf(job({ fillReport: { outcome: "interviewing" } }))).toMatchObject({ done: 5 });
    expect(progressOf(job({ fillReport: { outcome: "rejected" } }))).toMatchObject({ ended: "Rejected" });
  });
});
