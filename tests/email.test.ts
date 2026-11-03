import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addressFor, newToken, tokenIn } from "@/lib/email/address";
import { emailEvents, emailInboxes, messageKey } from "@/lib/email/store";
import { useTempDb } from "./helpers";

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
