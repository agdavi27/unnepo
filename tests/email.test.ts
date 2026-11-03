import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addressFor, newToken, tokenIn } from "@/lib/email/address";
import { emailEvents, emailInboxes, messageKey } from "@/lib/email/store";
import { readFileSync } from "node:fs";
import path from "node:path";
import { gmailFilterQuery, passesPrefilter, senderDomain, type InboundEmail } from "@/lib/email/filter";
import { forwardingVerification } from "@/lib/email/verification";
import { parseClassification } from "@/lib/email/classify";
import { matchApplication, normalizeCompany, sameCompany, sameTitle } from "@/lib/email/match";
import { useTempDb } from "./helpers";

const fixture = (name: string) => JSON.parse(readFileSync(path.join(__dirname, "fixtures/emails", `${name}.json`), "utf8")) as InboundEmail & { messageId: string };

beforeEach(() => {
  useTempDb();
  delete process.env.INBOUND_EMAIL_DOMAIN;
  delete process.env.INBOUND_EMAIL_BASE;
});
afterEach(() => {
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
