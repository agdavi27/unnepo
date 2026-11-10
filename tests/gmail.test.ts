import { describe, expect, it } from "vitest";
import { gmailAllowed, toInbound } from "@/lib/email/gmail";

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64url");

describe("Gmail messages", () => {
  it("reads the headers and the plain text of a multipart email", () => {
    const email = toInbound({
      id: "abc",
      payload: {
        mimeType: "multipart/alternative",
        headers: [
          { name: "From", value: "Acme Recruiting <no-reply@acme.greenhouse.io>" },
          { name: "Subject", value: "Thank you for applying" },
          { name: "Date", value: "Mon, 9 Nov 2026 10:00:00 -0500" },
          { name: "Message-ID", value: "<123@acme>" },
        ],
        parts: [
          { mimeType: "text/plain", body: { data: b64("Thanks for applying to the Analyst role at Acme. ".repeat(6)) } },
          { mimeType: "text/html", body: { data: b64("<p>Thanks</p>") } },
        ],
      },
    });
    expect(email.from).toContain("acme.greenhouse.io");
    expect(email.subject).toBe("Thank you for applying");
    expect(email.messageId).toBe("<123@acme>");
    expect(email.text).toContain("Analyst role at Acme");
  });

  it("falls back to the HTML and to Gmail's id when there's no text or Message-ID", () => {
    const email = toInbound({ id: "xyz", internalDate: "1762700000000", payload: { mimeType: "text/html", headers: [{ name: "From", value: "a@b.com" }], body: { data: b64("<p>Your interview is scheduled</p>") } } });
    expect(email.text).toContain("Your interview is scheduled");
    expect(email.messageId).toBe("gmail:xyz");
    expect(email.date).toBeTruthy();
  });
});

describe("Gmail beta", () => {
  it("lets only listed emails connect, or everyone with *", () => {
    const before = process.env.GMAIL_BETA_EMAILS;
    process.env.GMAIL_BETA_EMAILS = "a@colby.edu, B@school.edu";
    expect(gmailAllowed("a@colby.edu")).toBe(true);
    expect(gmailAllowed("b@school.edu")).toBe(true);
    expect(gmailAllowed("c@colby.edu")).toBe(false);
    expect(gmailAllowed(null)).toBe(false);
    process.env.GMAIL_BETA_EMAILS = "*";
    expect(gmailAllowed("anyone@college.edu")).toBe(true);
    if (before === undefined) delete process.env.GMAIL_BETA_EMAILS;
    else process.env.GMAIL_BETA_EMAILS = before;
  });
});
