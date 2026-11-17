import { describe, expect, it } from "vitest";
import { companyFromEmail, domainName, gmailSearches, jobFor, sortInbox, type MailRow, type ScanJob } from "@/lib/apply/inbox-scan";

const job = (id: string, title: string, company: string, extra: Partial<ScanJob> = {}): ScanJob => ({ id, title, company, stage: "submitted", createdAt: "2026-11-01T12:00:00Z", contacts: [], ...extra });
let n = 0;
const mail = (fromName: string, fromEmail: string, subject: string, snippet = "", at = Date.parse("2026-11-10T12:00:00Z")): MailRow => ({ id: `t${n++}`, fromName, fromEmail, subject, snippet, at, url: "https://mail.google.com/mail/u/0/#inbox/x" });

const jobs = [
  job("a", "E Commerce Associate", "AIR Control Concepts", { contacts: [{ id: "c1", name: "Robert Berning", email: "rberning@aircontrolconcepts.com", outreachStatus: "emailed" }] }),
  job("b", "Software Engineer Intern", "Stripe, Inc."),
  job("c", "Product Analyst", "Ramp", { stage: "rejected" }),
];

describe("Scan my email", () => {
  it("finds the job an email is about", () => {
    expect(jobFor(mail("Stripe Recruiting", "no-reply@greenhouse.io", "Thanks for applying"), jobs)?.id).toBe("b");
    expect(jobFor(mail("Careers", "jobs@stripe.com", "Your application"), jobs)?.id).toBe("b");
    expect(jobFor(mail("Workday", "noreply@myworkday.com", "Your application to AIR Control Concepts"), jobs)?.id).toBe("a");
    expect(jobFor(mail("Notion", "team@makenotion.com", "Hello"), jobs)).toBeNull();
    expect(domainName("x@careers.stripe.com")).toBe("stripe");
    expect(domainName("x@greenhouse.io")).toBe("");
  });

  it("sorts emails into to-dos", () => {
    const items = sortInbox([
      mail("Robert Berning", "RBerning@aircontrolconcepts.com", "Re: E Commerce Associate", "Thanks for reaching out, are you free Thursday?"),
      mail("Stripe Recruiting", "no-reply@greenhouse.io", "Stripe: next steps", "We'd like to invite you to a phone screen. Share your availability."),
      mail("Ramp", "careers@ramp.com", "Your application", "Unfortunately we've decided to move forward with other candidates."),
      mail("Notion Recruiting", "no-reply@ashbyhq.com", "Thank you for applying to Notion!", "We received your application for Data Science Intern."),
      mail("Weekly digest", "news@medium.com", "Top stories", "Nothing about jobs"),
    ], jobs);
    const by = Object.fromEntries(items.map((item) => [item.kind, item]));
    expect(by.reply?.contactId).toBe("c1");
    expect(by.reply?.applicationId).toBe("a");
    expect(by.interview?.applicationId).toBe("b");
    // Ramp is already Rejected: nothing to do.
    expect(by.rejected).toBeUndefined();
    expect(by.new?.company).toBe("Notion");
    expect(items).toHaveLength(3);
  });

  it("reads a no, an offer and a confirmation", () => {
    const [no] = sortInbox([mail("Stripe", "jobs@stripe.com", "Update on your application", "We regret to inform you that we will not be moving forward.")], jobs);
    expect(no?.kind).toBe("rejected");
    const [offer] = sortInbox([mail("Stripe", "jobs@stripe.com", "Your offer letter", "We're pleased to offer you the role.")], jobs);
    expect(offer?.kind).toBe("offer");
    const [got] = sortInbox([mail("Stripe Recruiting", "no-reply@greenhouse.io", "Thank you for applying!", "We've received your application.")], jobs);
    expect(got?.kind).toBe("confirmed");
  });

  it("drops an older confirmation once the company has said more", () => {
    const items = sortInbox([
      mail("Stripe", "jobs@stripe.com", "Application received", "Thanks for applying", Date.parse("2026-11-01T12:00:00Z")),
      mail("Stripe", "jobs@stripe.com", "Interview invitation", "We'd like to schedule a call", Date.parse("2026-11-08T12:00:00Z")),
    ], jobs);
    expect(items.map((item) => item.kind)).toEqual(["interview"]);
  });

  it("guesses the company of a job that isn't tracked", () => {
    expect(companyFromEmail(mail("Figma Careers", "no-reply@lever.co", "Application received"))).toBe("Figma");
    expect(companyFromEmail(mail("no-reply", "no-reply@ashbyhq.com", "Thanks for your interest in Linear"))).toBe("Linear");
  });

  it("searches Gmail for job emails and replies", () => {
    const [words, replies] = gmailSearches(["A@x.com", "a@x.com", "bad email"]);
    expect(words).toContain("newer_than:60d");
    expect(replies).toBe("newer_than:120d -in:sent from:(a@x.com)");
    expect(gmailSearches([])).toHaveLength(1);
  });
});
