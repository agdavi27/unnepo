import { describe, expect, it } from "vitest";
import { nextUp } from "@/lib/apply/next-up";

const now = new Date("2026-11-04T15:00:00.000Z");
const app = (id: string, extra: Record<string, unknown> = {}) => ({
  id, company: id, title: `${id} role`, status: "applied_manual", contactsStatus: "done",
  createdAt: "2026-11-03T12:00:00.000Z", submittedAt: "2026-11-03T12:00:00.000Z", fillReport: null, contacts: [], ...extra,
}) as unknown as Parameters<typeof nextUp>[0][number];
const reply = { outcome: "interviewing", statusHistory: [{ at: "2026-11-04T12:00:00.000Z", status: "interviewing", source: "email" }] };

describe("Home's next up list", () => {
  it("orders replies, emails to review, follow-ups, unfinished applications, then finding people", () => {
    const items = nextUp([
      app("people", { contactsStatus: "idle" }),
      app("started", { status: "filling", submittedAt: null }),
      app("follow", { fillReport: { emailedAt: { c1: "2026-10-20T12:00:00.000Z" } }, contacts: [{ id: "c1", name: "Maya", outreachStatus: "emailed" }] }),
      app("replied", { fillReport: reply }),
    ], { toReview: 2, now });
    expect(items.map((item) => item.kind)).toEqual(["reply", "review", "follow_up", "finish", "find_people"]);
    expect(items[0]).toMatchObject({ title: "replied replied to your application", detail: "replied role · arrived today", when: "Today", action: "Read email" });
    expect(items[1].title).toBe("2 emails need a look");
    expect(items[2].title).toBe("Follow up with Maya");
    expect(items[3].title).toBe("Finish started role at started");
  });

  it("drops a reply once it's read, once it's old, or when it was bad news", () => {
    const [item] = nextUp([app("a", { fillReport: reply })], { now });
    expect(nextUp([app("a", { fillReport: reply })], { read: new Set([item.key]), now })).toEqual([]);
    expect(nextUp([app("a", { fillReport: reply })], { now: new Date("2026-12-04T15:00:00.000Z") }).filter((next) => next.kind === "reply")).toEqual([]);
    expect(nextUp([app("a", { fillReport: { outcome: "rejected", statusHistory: [{ at: "2026-11-04T12:00:00.000Z", status: "rejected", source: "email" }] } })], { now })).toEqual([]);
  });

  it("leaves out old jobs and jobs missing a company", () => {
    expect(nextUp([app("old", { contactsStatus: "idle", submittedAt: "2026-09-01T12:00:00.000Z" })], { now })).toEqual([]);
    expect(nextUp([app("blank", { contactsStatus: "idle", companyMissing: true })], { now })).toEqual([]);
    expect(nextUp([app("old", { status: "filling", submittedAt: null, createdAt: "2026-08-01T12:00:00.000Z" })], { now })).toEqual([]);
  });

  it("shows at most three jobs to find people at", () => {
    expect(nextUp(["a", "b", "c", "d"].map((id) => app(id, { contactsStatus: "idle" })), { now })).toHaveLength(3);
  });
});
