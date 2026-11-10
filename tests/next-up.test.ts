import { describe, expect, it } from "vitest";
import { nextUp } from "@/lib/apply/next-up";

const now = new Date("2026-11-04T15:00:00.000Z");
const app = (id: string, extra: Record<string, unknown> = {}) => ({
  id, company: id, title: `${id} role`, status: "applied_manual", contactsStatus: "done",
  createdAt: "2026-11-03T12:00:00.000Z", submittedAt: "2026-11-03T12:00:00.000Z", fillReport: null, contacts: [], ...extra,
}) as unknown as Parameters<typeof nextUp>[0][number];
const replied = { outcome: "follow_up", statusHistory: [{ at: "2026-11-04T12:00:00.000Z", status: "follow_up", source: "email", summary: "Acme wants to set up a call." }] };

describe("Home's next up sections", () => {
  it("says how many more to apply to, today first, then this week", () => {
    expect(nextUp([], { now, goal: { today: 1, daily: 3, week: 4, weekly: 10 } }).goals.items[0]).toMatchObject({ title: "Apply to 2 more jobs today", detail: "1 of 3 today · 4 of 10 this week", action: "Find a job" });
    expect(nextUp([], { now, goal: { today: 3, daily: 3, week: 4, weekly: 30 } }).goals.items[0].title).toBe("Apply to 26 more jobs this week");
    expect(nextUp([], { now, goal: { today: 3, daily: 3, week: 10, weekly: 10 } }).goals.items).toEqual([]);
  });

  it("lists jobs marked Follow up, then people to follow up with", () => {
    const next = nextUp([
      app("follow", { fillReport: { emailedAt: { c1: "2026-10-20T12:00:00.000Z" } }, contacts: [{ id: "c1", name: "Maya", outreachStatus: "emailed" }] }),
      app("acme", { fillReport: replied }),
      app("rejected", { fillReport: { outcome: "rejected" } }),
    ], { now });
    expect(next.follow_ups.replied).toBe(1);
    expect(next.follow_ups.items.map((item) => item.kind)).toEqual(["reply", "follow_up"]);
    expect(next.follow_ups.items[0]).toMatchObject({ title: "Follow up with acme", detail: "acme role · Acme wants to set up a call.", when: "Today" });
    expect(next.follow_ups.items[1].title).toBe("Follow up with Maya");
  });

  it("lists unfinished applications, then applied ones quiet for two weeks", () => {
    const next = nextUp([
      app("quiet", { submittedAt: "2026-10-10T12:00:00.000Z", createdAt: "2026-10-10T12:00:00.000Z" }),
      app("recent"),
      app("started", { status: "filling", submittedAt: null }),
      app("blank", { status: "filling", submittedAt: null, companyMissing: true }),
    ], { now });
    expect(next.applications.items.map((item) => item.key)).toEqual(["finish:started", "update:quiet"]);
    expect(next.applications.items[1].title).toBe("Heard back from quiet?");
  });
});
