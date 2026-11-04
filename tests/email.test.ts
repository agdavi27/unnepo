import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addressFor, newToken, tokenIn } from "@/lib/email/address";
import { emailEvents, emailInboxes, messageKey } from "@/lib/email/store";
import { readFileSync } from "node:fs";
import path from "node:path";
import { gmailFilterQuery, passesPrefilter, senderDomain, type InboundEmail } from "@/lib/email/filter";
import { forwardingVerification } from "@/lib/email/verification";
import { parseClassification } from "@/lib/email/classify";
import { matchApplication, normalizeCompany, sameCompany, sameTitle } from "@/lib/email/match";
import { processEmail, reviewEmail } from "@/lib/email/process";
import { setClassifierForTests } from "@/lib/email/classify";
import { applications } from "@/lib/apply/store";
import { stageOf } from "@/lib/apply/stats";
import { login, signUp, verifyEmail } from "@/lib/services/auth";
import { POST } from "@/app/api/[...slug]/route";
import { unwrapForward } from "@/lib/email/inbound";
import { emailState, parsePasted, pasteEmail } from "@/lib/email/service";
import { useTempDb } from "./helpers";

const fixture = (name: string) => JSON.parse(readFileSync(path.join(__dirname, "fixtures/emails", `${name}.json`), "utf8")) as InboundEmail & { messageId: string };

beforeEach(() => {
  useTempDb();
  delete process.env.INBOUND_EMAIL_DOMAIN;
  delete process.env.INBOUND_EMAIL_BASE;
});
afterEach(() => {
  setClassifierForTests(null);
  delete process.env.INBOUND_WEBHOOK_USER;
  delete process.env.INBOUND_WEBHOOK_SECRET;
  delete process.env.INBOUND_EMAIL_DOMAIN;
  delete process.env.INBOUND_EMAIL_BASE;
});

describe("forwarding addresses", () => {
  it("makes unguessable tokens and reads them back from any recipient form", () => {
    const tokens = new Set(Array.from({ length: 200 }, newToken));
    expect(tokens.size).toBe(200);
    const token = [...tokens][0];
    expect(token).toMatch(/^u_[a-z2-7]{20}$/);
    process.env.INBOUND_EMAIL_BASE = "abc123@inbound.postmarkapp.com";
    expect(addressFor(token)).toBe(`abc123+${token}@inbound.postmarkapp.com`);
    process.env.INBOUND_EMAIL_DOMAIN = "inbox.unnepo.com";
    expect(addressFor(token)).toBe(`${token}@inbox.unnepo.com`);
    expect(tokenIn(`Unnepo <abc123+${token}@inbound.postmarkapp.com>`)).toBe(token);
    expect(tokenIn("someone@example.com")).toBeNull();
  });

  it("keeps one active address per student, and regenerating turns the old one off", async () => {
    const first = await emailInboxes.forUser("user-1");
    expect((await emailInboxes.forUser("user-1")).token).toBe(first.token);
    expect((await emailInboxes.byToken(first.token))?.userId).toBe("user-1");
    const second = await emailInboxes.regenerate("user-1");
    expect(second.token).not.toBe(first.token);
    expect(await emailInboxes.byToken(first.token)).toBeNull();
    expect((await emailInboxes.byToken(second.token))?.userId).toBe("user-1");
  });

  it("saves an email once per Message-ID", async () => {
    const key = messageKey("<abc@mail.example.com>");
    expect(key).toBe(messageKey(" <ABC@mail.example.com> "));
    const event = { userId: "user-1", messageKey: key, receivedAt: "2026-11-03T12:00:00.000Z", source: "forward" as const, fromDomain: "greenhouse.io", kind: "applied" as const, company: "Acme", jobTitle: null, confidence: 0.9, summary: "Applied.", outcome: "created" as const, applicationId: null };
    expect(await emailEvents.add(event)).not.toBeNull();
    expect(await emailEvents.add(event)).toBeNull();
    expect(await emailEvents.seen("user-1", key)).toBe(true);
    expect(await emailEvents.list("user-1")).toHaveLength(1);
  });
});

describe("the pre-filter", () => {
  it("lets job emails through and drops the rest before any AI call", () => {
    for (const name of ["pg-thank-you", "workday-confirmation", "rejection", "interview-invite"]) expect(passesPrefilter(fixture(name))).toBe(true);
    expect(passesPrefilter(fixture("newsletter"))).toBe(false);
    // A job system's domain is enough, whatever it says.
    expect(passesPrefilter({ from: "Acme <acme@myworkday.com>", subject: "Update", text: "Hello" })).toBe(true);
    expect(passesPrefilter({ from: "jobs@notmyworkday.com", subject: "Update", text: "Hello" })).toBe(false);
    expect(senderDomain("Initech <no-reply@us.greenhouse-mail.io>")).toBe("us.greenhouse-mail.io");
    expect(gmailFilterQuery()).toContain('from:(myworkday.com OR');
    expect(gmailFilterQuery()).toContain('"thank you for applying"');
  });
});

describe("forwarding confirmations", () => {
  it("finds Gmail's code and link, and nothing in other emails", () => {
    expect(forwardingVerification(fixture("gmail-forwarding"))).toEqual({ provider: "gmail", code: "418923567", link: "https://mail-settings.google.com/mail/vf-%5BANGjdJ8example%5D-abc123" });
    expect(forwardingVerification(fixture("pg-thank-you"))).toBeNull();
    expect(forwardingVerification({ from: "Outlook <no-reply@outlook.com>", subject: "Verify your forwarding address", text: "Use security code 482913 to confirm forwarding." })).toMatchObject({ provider: "outlook", code: "482913" });
  });
});

describe("checking the AI's answer", () => {
  it("accepts JSON of the right shape and treats anything else as not sure", () => {
    expect(parseClassification('Sure! {"type":"applied","company":"P&G","job_title":null,"confidence":0.92,"summary":"P&G confirmed your application."}')).toEqual({ type: "applied", company: "P&G", job_title: null, confidence: 0.92, summary: "P&G confirmed your application." });
    expect(parseClassification('{"type":"interview","company":"Globex","job_title":"Unknown","confidence":0.8,"summary":"Interview."}').job_title).toBeNull();
    for (const bad of ["no json here", '{"type":"hired","company":"Acme","job_title":null,"confidence":0.9,"summary":""}', '{"type":"applied","company":"Acme","job_title":null,"confidence":1.4,"summary":""}', '{"type":"applied"']) {
      expect(parseClassification(bad).confidence).toBe(0);
    }
  });
});

describe("company names", () => {
  it("knows the same company however it's written, and keeps different ones apart", () => {
    expect(normalizeCompany("The Procter & Gamble Company")).toBe("procter and gamble");
    for (const [a, b] of [["P&G", "Procter & Gamble"], ["Procter and Gamble Co.", "P&G"], ["JPMorgan Chase & Co.", "J.P. Morgan"], ["Boston Consulting Group", "BCG"], ["Acme, Inc.", "ACME"], ["Workday", "Workday Talent Acquisition"], ["Deloitte", "Deloite"]]) {
      expect(sameCompany(a, b)).toBe(true);
    }
    for (const [a, b] of [["Acme", "Globex"], ["Meta", "Metabase"], ["GE", "GEICO"], ["Apple", "Applied Materials"]]) expect(sameCompany(a, b)).toBe(false);
  });

  it("knows the same job title in a different order", () => {
    expect(sameTitle("Data Analyst Intern", "Intern, Data Analyst")).toBe(true);
    expect(sameTitle("Data Analyst Intern (R-10423)", "Data Analyst Intern")).toBe(true);
    expect(sameTitle("Data Analyst Intern", "Marketing Intern")).toBe(false);
  });
});

describe("matching an email to an application", () => {
  const app = (id: string, company: string, title: string, extra: Record<string, unknown> = {}) => ({ id, company, title, status: "submitted" as const, fillReport: null, createdAt: "2026-10-01T00:00:00.000Z", submittedAt: "2026-10-01T00:00:00.000Z", ...extra });

  it("finds the job by company and title, or the one open job at the company", () => {
    const apps = [app("1", "Procter & Gamble", "Brand Intern"), app("2", "Acme", "Data Analyst Intern"), app("3", "Acme", "Sales Intern")];
    expect(matchApplication(apps, { company: "P&G", jobTitle: null })).toEqual({ kind: "one", app: apps[0] });
    expect(matchApplication(apps, { company: "Acme Inc", jobTitle: "Data Analyst Intern (R-10423)" })).toEqual({ kind: "one", app: apps[1] });
    expect(matchApplication(apps, { company: "Globex", jobTitle: null })).toEqual({ kind: "none", atCompany: [] });
  });

  it("sends it to review when two or more jobs fit", () => {
    const apps = [app("2", "Acme", "Data Analyst Intern"), app("3", "Acme", "Sales Intern"), app("4", "Acme", "Old Intern", { fillReport: { filled: [], failed: [], liveViewUrl: null, screenshotAt: null, outcome: "rejected" } })];
    const result = matchApplication(apps, { company: "Acme", jobTitle: null });
    expect(result.kind).toBe("several");
    expect(result.kind === "several" && result.candidates.map((item) => item.id)).toEqual(["2", "3"]);
  });

  it("finds a job saved before its title was known", () => {
    const apps = [app("5", "P&G", "Unknown role")];
    expect(matchApplication(apps, { company: "Procter & Gamble", jobTitle: "Brand Intern" })).toEqual({ kind: "one", app: apps[0] });
  });
});

describe("processing forwarded emails", () => {
  async function student() {
    const signed = await signUp({ email: "pat.doe@colby.edu", password: "password123", name: "Pat Doe" });
    await verifyEmail(signed.verifyToken!);
    return (await login("pat.doe@colby.edu", "password123")).user.id;
  }
  // What the AI would answer for each sample email.
  const answers: Record<string, string> = {
    "Thank you for applying to P&G": '{"type":"applied","company":"P&G","job_title":null,"confidence":0.93,"summary":"P&G confirmed your application."}',
    "Application received: Data Analyst Intern (R-10423)": '{"type":"applied","company":"Acme","job_title":"Data Analyst Intern","confidence":0.95,"summary":"Acme received your Data Analyst Intern application."}',
    "Your application to Initech": '{"type":"rejected","company":"Initech","job_title":"Growth Intern","confidence":0.9,"summary":"Initech isn\'t moving forward."}',
    "Interview invitation: Brand Marketing Intern at Globex": '{"type":"interview","company":"Globex","job_title":"Brand Marketing Intern","confidence":0.94,"summary":"Globex wants to set up an interview."}',
  };
  let calls = 0;
  beforeEach(() => {
    calls = 0;
    setClassifierForTests(async (email) => {
      calls += 1;
      return answers[email.subject] ?? '{"type":"not_job_related","company":"","job_title":null,"confidence":0.9,"summary":"Not about a job."}';
    });
  });

  it("saves a confirmation with no title as a new application, once", async () => {
    const userId = await student();
    const first = await processEmail(userId, fixture("pg-thank-you"), "forward");
    expect(first.outcome).toBe("created");
    const app = await applications.get(userId, first.applicationId!);
    expect(app).toMatchObject({ company: "P&G", title: "Unknown role", status: "applied_manual" });
    expect(app?.fillReport?.fromEmail).toBe("added");
    expect(app?.fillReport?.statusHistory?.[0]).toMatchObject({ status: "applied", source: "email", summary: "P&G confirmed your application." });
    expect((await processEmail(userId, fixture("pg-thank-you"), "forward")).outcome).toBe("duplicate");
    expect(calls).toBe(1);
    expect(await applications.list(userId)).toHaveLength(1);
  });

  it("confirms a saved job by its title, and moves a job to interviewing", async () => {
    const userId = await student();
    const base = { userId, jobUrl: "https://acme.example/jobs/1", ats: "other" as const, companyDomain: null, department: null, location: null, description: "", requirements: [], applicationUrl: null, postedRecruiter: null, statusMessage: "", questions: [], browserSessionId: null, fillReport: null, confirmation: null, contactsStatus: "idle" as const, contactsMessage: "", charged: false, attempts: 0 };
    const acme = await applications.insert({ ...base, jobKey: "k1", title: "Data Analyst Intern", company: "Acme, Inc.", status: "extracted", submittedAt: null });
    const globex = await applications.insert({ ...base, jobKey: "k2", title: "Brand Marketing Intern", company: "Globex", status: "submitted", submittedAt: "2026-10-20T12:00:00.000Z" });
    expect((await processEmail(userId, fixture("workday-confirmation"), "forward"))).toMatchObject({ outcome: "updated", applicationId: acme.app.id });
    expect((await applications.get(userId, acme.app.id))?.status).toBe("applied_manual");
    expect((await processEmail(userId, fixture("interview-invite"), "forward"))).toMatchObject({ outcome: "updated", applicationId: globex.app.id });
    const moved = await applications.get(userId, globex.app.id);
    expect(moved?.fillReport).toMatchObject({ outcome: "interviewing", fromEmail: "updated" });
    expect(stageOf(moved!)).toBe("interviewing");
  });

  it("sends a status email about a job that isn't saved to review, and approving saves it", async () => {
    const userId = await student();
    const result = await processEmail(userId, fixture("rejection"), "forward");
    expect(result.outcome).toBe("review");
    expect(result.event?.reason).toBe("no_match");
    expect(await applications.list(userId)).toHaveLength(0);
    const approved = await reviewEmail(userId, { eventId: result.event!.id, action: "approve" });
    expect(approved.ok).toBe(true);
    const [app] = await applications.list(userId);
    expect(app).toMatchObject({ company: "Initech", title: "Growth Intern" });
    expect(stageOf(app)).toBe("rejected");
  });

  it("changes nothing when it isn't sure, and lets the student pick when two jobs fit", async () => {
    const userId = await student();
    setClassifierForTests(async () => '{"type":"interview","company":"Acme","job_title":null,"confidence":0.55,"summary":"Maybe an interview at Acme."}');
    const unsure = await processEmail(userId, { ...fixture("interview-invite"), messageId: "<unsure@x>" }, "forward");
    expect(unsure.event).toMatchObject({ outcome: "review", reason: "low_confidence" });
    const base = { userId, jobUrl: "https://acme.example/jobs/1", ats: "other" as const, companyDomain: null, department: null, location: null, description: "", requirements: [], applicationUrl: null, postedRecruiter: null, status: "submitted" as const, statusMessage: "", questions: [], browserSessionId: null, fillReport: null, confirmation: null, submittedAt: "2026-10-20T12:00:00.000Z", contactsStatus: "idle" as const, contactsMessage: "", charged: false, attempts: 0 };
    await applications.insert({ ...base, jobKey: "a1", title: "Data Intern", company: "Acme" });
    const sales = await applications.insert({ ...base, jobKey: "a2", title: "Sales Intern", company: "Acme" });
    setClassifierForTests(async () => '{"type":"interview","company":"Acme","job_title":null,"confidence":0.9,"summary":"Acme wants to interview you."}');
    const several = await processEmail(userId, { ...fixture("interview-invite"), messageId: "<several@x>" }, "forward");
    expect(several.event).toMatchObject({ outcome: "review", reason: "several_matches" });
    expect(several.event?.candidates).toHaveLength(2);
    expect((await reviewEmail(userId, { eventId: several.event!.id, action: "approve" })).ok).toBe(false);
    expect((await reviewEmail(userId, { eventId: several.event!.id, action: "pick", applicationId: sales.app.id })).ok).toBe(true);
    expect(stageOf((await applications.get(userId, sales.app.id))!)).toBe("interviewing");
    expect((await reviewEmail(userId, { eventId: unsure.event!.id, action: "dismiss" })).event?.outcome).toBe("dismissed");
  });

  it("drops emails that aren't about jobs without asking the AI, and keeps the forwarding code", async () => {
    const userId = await student();
    expect((await processEmail(userId, fixture("newsletter"), "forward")).outcome).toBe("dropped");
    expect(calls).toBe(0);
    const verify = await processEmail(userId, fixture("gmail-forwarding"), "forward");
    expect(verify.event?.verification).toMatchObject({ provider: "gmail", code: "418923567" });
    expect(calls).toBe(0);
    // Nothing from the newsletter is kept, only a count; the forwarding code is kept.
    const events = await emailEvents.list(userId);
    expect(events.filter((event) => event.outcome !== "skipped").map((event) => event.kind)).toEqual(["verification"]);
    const count = events.find((event) => event.outcome === "skipped")!;
    expect(count).toMatchObject({ skippedCount: 1, fromDomain: "", company: "", jobTitle: null, summary: "" });
    expect(JSON.stringify(count)).not.toContain(fixture("newsletter").subject);
  });

  it("shows skipped emails on the page: the AI's line for those it read, a count for those dropped before it", async () => {
    const userId = await student();
    expect((await emailState(userId)).skipped).toEqual({ read: [], dropped: 0, droppedAt: null });

    const newsletter = fixture("newsletter");
    await processEmail(userId, newsletter, "forward");
    await processEmail(userId, { ...newsletter, messageId: "<another-newsletter@example.com>" }, "forward");
    // Told on the spot, so a pasted one isn't counted.
    await processEmail(userId, { ...newsletter, messageId: "<pasted@example.com>" }, "paste");

    setClassifierForTests(async () => '{"type":"not_job_related","company":"","job_title":null,"confidence":0.95,"summary":"A job alert listing other roles."}');
    await processEmail(userId, { ...fixture("workday-confirmation"), messageId: "<alert@example.com>" }, "forward");

    const { skipped, review, recent } = await emailState(userId);
    expect(skipped.dropped).toBe(2);
    expect(skipped.droppedAt).toBeTruthy();
    expect(skipped.read.map((item) => item.summary)).toEqual(["A job alert listing other roles."]);
    // Skipped emails stay out of the other lists.
    expect(review).toEqual([]);
    expect(recent).toEqual([]);
  });

  it("reads job emails that don't use the usual phrases, and still drops the rest", () => {
    const email = (subject: string, text: string) => ({ from: "Careers <careers@almocorp.com>", subject, text });
    expect(passesPrefilter(email("Thanks for your submission", "We got what you sent for the Sales position."))).toBe(true);
    expect(passesPrefilter(email("Finish applying", "You're almost done."))).toBe(true);
    expect(passesPrefilter(email("We've decided", "We won't be moving forward."))).toBe(true);
    expect(passesPrefilter(fixture("newsletter"))).toBe(false);
    // The mail rule stays narrow: a word like "position" alone doesn't forward an email.
    expect(gmailFilterQuery()).toContain('"thanks for applying"');
    expect(gmailFilterQuery()).not.toContain('"position"');
  });

  it("saves a reminder to finish an application as In progress, and a later confirmation makes it applied", async () => {
    const userId = await student();
    const say = (type: string) => setClassifierForTests(async () => JSON.stringify({ type, company: "ALMO CORP", job_title: "Account Specialist", confidence: 0.95, summary: `${type} at ALMO CORP.` }));
    const email = (id: string, subject: string) => ({ messageId: `<${id}@almo.example.com>`, from: "ALMO <jobs@almo.example.com>", subject, text: "Your application for Account Specialist." });

    say("incomplete");
    const first = await processEmail(userId, email("one", "Finish your application"), "forward");
    expect(first.outcome).toBe("created");
    const saved = await applications.get(userId, first.applicationId!);
    expect(stageOf(saved!)).toBe("in_progress");
    expect(saved).toMatchObject({ company: "ALMO CORP", title: "Account Specialist", submittedAt: null });
    expect(saved?.fillReport?.fromEmail).toBe("added");

    // A second reminder is the same job.
    const second = await processEmail(userId, email("two", "Reminder: your application"), "forward");
    expect(second).toMatchObject({ outcome: "updated", applicationId: first.applicationId });
    expect(stageOf((await applications.get(userId, first.applicationId!))!)).toBe("in_progress");

    say("applied");
    await processEmail(userId, email("three", "Thank you for applying"), "forward");
    expect(stageOf((await applications.get(userId, first.applicationId!))!)).toBe("submitted");

    // A late reminder doesn't take it back.
    say("incomplete");
    expect((await processEmail(userId, email("four", "Reminder: your application"), "forward")).outcome).toBe("updated");
    expect(stageOf((await applications.get(userId, first.applicationId!))!)).toBe("submitted");
  });

  it("saves jobs from email without using up the free plan's applications", async () => {
    const userId = await student();
    // Names nothing like each other, so each email is a job of its own.
    setClassifierForTests(async () => JSON.stringify({ type: "applied", company: crypto.randomUUID().slice(0, 13), job_title: "Analyst", confidence: 0.95, summary: "Confirmed." }));
    for (let index = 0; index < 27; index += 1) {
      const result = await processEmail(userId, { messageId: `<limit-${index}@example.com>`, from: "Jobs <jobs@example.com>", subject: "Thank you for applying", text: "Thank you for applying." }, "forward");
      expect(result.outcome).toBe("created");
    }
    expect((await applications.list(userId)).filter((app) => app.charged)).toEqual([]);
  });

  it("says whether any forwarded email has arrived, for Setup", async () => {
    const userId = await student();
    expect((await emailState(userId)).forwarded).toBe(false);
    await processEmail(userId, fixture("newsletter"), "paste");
    expect((await emailState(userId)).forwarded).toBe(false);
    await processEmail(userId, fixture("newsletter"), "forward");
    expect((await emailState(userId)).forwarded).toBe(true);
  });

  it("tells the setup's test about real emails, not the forwarding code", async () => {
    const userId = await student();
    await processEmail(userId, fixture("gmail-forwarding"), "forward");
    const coded = await emailState(userId);
    expect(coded.lastEmail).toBeNull();
    expect(coded.skipped.dropped).toBe(0);
    await processEmail(userId, fixture("newsletter"), "forward");
    const dropped = await emailState(userId);
    expect(dropped.lastEmail).toBeNull();
    expect(dropped.skipped.dropped).toBe(1);
    await processEmail(userId, fixture("pg-thank-you"), "forward");
    expect((await emailState(userId)).lastEmail).toMatchObject({ outcome: "created" });
  });

  it("marks a job No response after 28 days without an email", () => {
    const now = Date.parse("2026-11-03T12:00:00.000Z");
    const applied = { status: "submitted" as const, submittedAt: "2026-10-01T12:00:00.000Z", createdAt: "2026-10-01T12:00:00.000Z", fillReport: null };
    expect(stageOf(applied, now)).toBe("no_response");
    expect(stageOf({ ...applied, fillReport: { filled: [], failed: [], liveViewUrl: null, screenshotAt: null, lastEmailAt: "2026-10-20T12:00:00.000Z" } }, now)).toBe("submitted");
    expect(stageOf({ ...applied, submittedAt: "2026-10-20T12:00:00.000Z" }, now)).toBe("submitted");
  });
});

describe("Postmark's webhook", () => {
  const post = (body: unknown, auth?: string) => POST(new Request("https://unneponew.vercel.app/api/inbound/postmark", {
    method: "POST", headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Basic ${Buffer.from(auth).toString("base64")}` } : {}) }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ slug: ["inbound", "postmark"] }) });
  const postmark = (email: ReturnType<typeof fixture>, to: string) => ({
    FromFull: { Email: email.from.match(/<(.+)>/)?.[1] ?? email.from, Name: email.from.replace(/\s*<.+>/, "") }, OriginalRecipient: to, ToFull: [{ Email: to }],
    Subject: email.subject, Date: email.date, TextBody: email.text, MessageID: "postmark-id", Headers: [{ Name: "Message-ID", Value: email.messageId }],
  });

  it("turns away posts without the secret and addresses no student has, and processes the rest once", async () => {
    process.env.INBOUND_WEBHOOK_USER = "postmark";
    process.env.INBOUND_WEBHOOK_SECRET = "a-long-secret-for-tests-1234";
    setClassifierForTests(async () => '{"type":"applied","company":"P&G","job_title":null,"confidence":0.93,"summary":"P&G confirmed your application."}');
    const signed = await signUp({ email: "pat.doe@colby.edu", password: "password123", name: "Pat Doe" });
    await verifyEmail(signed.verifyToken!);
    const userId = (await login("pat.doe@colby.edu", "password123")).user.id;
    const inbox = await emailInboxes.forUser(userId);
    const to = `abc123+${inbox.token}@inbound.postmarkapp.com`;
    const body = postmark(fixture("pg-thank-you"), to);
    expect((await post(body)).status).toBe(401);
    expect((await post(body, "postmark:wrong-secret-wrong-secret")).status).toBe(401);
    expect((await post(postmark(fixture("pg-thank-you"), "abc123+u_bbbbbbbbbbbbbbbbbbbb@inbound.postmarkapp.com"), "postmark:a-long-secret-for-tests-1234")).status).toBe(403);
    const first = await post(body, "postmark:a-long-secret-for-tests-1234");
    expect([first.status, (await first.json()).result]).toEqual([200, "created"]);
    expect((await (await post(body, "postmark:a-long-secret-for-tests-1234")).json()).result).toBe("duplicate");
    expect(await applications.list(userId)).toHaveLength(1);
  });

  it("reads the original sender of an email forwarded by hand", () => {
    const forwarded = unwrapForward({ from: "Pat <pat.doe@gmail.com>", subject: "Fwd: Thank you for applying", text: "---------- Forwarded message ---------\nFrom: P&G Careers <no-reply@pgcareers.com>\nDate: Mon, Nov 2, 2026 at 2:05 PM\nSubject: Thank you for applying to P&G\nTo: <pat.doe@gmail.com>\n\nDear Pat, thank you for applying." });
    expect(forwarded).toMatchObject({ from: "P&G Careers <no-reply@pgcareers.com>", subject: "Thank you for applying to P&G", date: "Mon, Nov 2, 2026 at 2:05 PM" });
  });
});

describe("the paste box and the setup page", () => {
  it("reads a pasted email's own headers, runs it through the same steps, and lists what needs review", async () => {
    setClassifierForTests(async (email) => email.subject.includes("Globex")
      ? '{"type":"interview","company":"Globex","job_title":null,"confidence":0.6,"summary":"Maybe an interview."}'
      : '{"type":"applied","company":"P&G","job_title":null,"confidence":0.93,"summary":"P&G confirmed your application."}');
    const signed = await signUp({ email: "pat.doe@colby.edu", password: "password123", name: "Pat Doe" });
    await verifyEmail(signed.verifyToken!);
    const userId = (await login("pat.doe@colby.edu", "password123")).user.id;
    const pasted = "From: P&G Careers <no-reply@pgcareers.com>\nSubject: Thank you for applying to P&G\nDate: Mon, 2 Nov 2026 14:05:00 -0500\n\nDear Pat, thank you for applying to Procter & Gamble.";
    expect(parsePasted(pasted)).toMatchObject({ from: "P&G Careers <no-reply@pgcareers.com>", subject: "Thank you for applying to P&G" });
    expect((await pasteEmail(userId, { text: pasted })).outcome).toBe("created");
    expect((await pasteEmail(userId, { text: pasted })).outcome).toBe("duplicate");
    await pasteEmail(userId, { text: "From: Globex <hr@globex.com>\nSubject: Globex interview\n\nWe'd like to talk about an interview next week." });
    await processEmail(userId, fixture("gmail-forwarding"), "forward");
    const state = await emailState(userId);
    expect(state.address).toMatch(/^u_[a-z2-7]{20}@inbox\.unnepo\.local$/);
    expect(state.verification).toMatchObject({ provider: "gmail", code: "418923567" });
    expect(state.review).toHaveLength(1);
    expect(state.review[0]).toMatchObject({ company: "Globex", reason: "low_confidence" });
    expect(state.recent[0]).toMatchObject({ outcome: "created", application: { company: "P&G", title: "Unknown role" } });
  });
});
