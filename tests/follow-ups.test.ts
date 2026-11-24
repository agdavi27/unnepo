import { describe, expect, it } from "vitest";
import { followUpsDue } from "@/lib/apply/follow-ups";

const app = (log: Array<{ contactId: string; kind: string }>, emailedAt: string) => ({
  id: "a1", company: "Evercore", title: "Analyst",
  contacts: [{ id: "c1", name: "Jane Lee", outreachStatus: "emailed" }],
  fillReport: { emailedAt: { c1: emailedAt }, outreachLog: log },
});

describe("followUpsDue", () => {
  // Monday Nov 2, 2026, and later days.
  const sent = "2026-11-02T14:00:00Z";
  it("is due 5 business days after the first email, as follow-up 1", () => {
    expect(followUpsDue([app([], sent)], new Date("2026-11-06T14:00:00Z"))).toHaveLength(0);
    expect(followUpsDue([app([], sent)], new Date("2026-11-09T14:00:00Z"))[0]).toMatchObject({ contactId: "c1", number: 1 });
  });
  it("waits 7 business days after the first follow-up, then stops after the second", () => {
    const one = app([{ contactId: "c1", kind: "email" }, { contactId: "c1", kind: "follow_up" }], sent);
    expect(followUpsDue([one], new Date("2026-11-09T14:00:00Z"))).toHaveLength(0);
    expect(followUpsDue([one], new Date("2026-11-11T14:00:00Z"))[0]).toMatchObject({ number: 2 });
    const two = app([{ contactId: "c1", kind: "follow_up" }, { contactId: "c1", kind: "follow_up" }], sent);
    expect(followUpsDue([two], new Date("2027-01-11T14:00:00Z"))).toHaveLength(0);
  });
});
