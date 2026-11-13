import { describe, expect, it } from "vitest";
import { effectivePlan, trialEndedAt, trialFor, trialLeftLabel } from "@/lib/plan";

describe("the Pro trial", () => {
  const signedUp = "2026-11-10T12:00:00.000Z";
  const at = (iso: string) => Date.parse(iso);
  const withDays = <T,>(days: string | undefined, run: () => T) => {
    const saved = process.env.TRIAL_DAYS;
    if (days === undefined) delete process.env.TRIAL_DAYS;
    else process.env.TRIAL_DAYS = days;
    try { return run(); } finally { process.env.TRIAL_DAYS = saved; }
  };

  it("gives a new Free account Pro for 7 days from signup with TRIAL_DAYS=7, then Free", () => withDays("7", () => {
    expect(effectivePlan("free", signedUp, at("2026-11-10T13:00:00Z"))).toBe("pro");
    expect(trialFor("free", signedUp, at("2026-11-11T12:00:00Z"))).toEqual({ endsAt: "2026-11-17T12:00:00.000Z", daysLeft: 6, hoursLeft: 144 });
    expect(trialFor("free", signedUp, at("2026-11-17T11:30:00Z"))).toMatchObject({ daysLeft: 1, hoursLeft: 1 });
    expect(effectivePlan("free", signedUp, at("2026-11-17T12:00:00Z"))).toBe("free");
    expect(trialFor("free", signedUp, at("2026-11-17T12:00:00Z"))).toBeNull();
    expect(trialEndedAt("free", signedUp, at("2026-11-18T00:00:00Z"))).toBe("2026-11-17T12:00:00.000Z");
    expect(trialEndedAt("free", signedUp, at("2026-11-14T00:00:00Z"))).toBeNull();
  }));

  it("gives nothing to accounts made before the trial began, so none of them hear it ended", () => withDays("7", () => {
    expect(effectivePlan("free", "2026-11-03T12:00:00.000Z", at("2026-11-08T00:00:00Z"))).toBe("free");
    expect(trialEndedAt("free", "2026-11-03T12:00:00.000Z", at("2026-11-20T00:00:00Z"))).toBeNull();
  }));

  it("never touches a paid plan", () => withDays("7", () => {
    expect(effectivePlan("premium", signedUp, at("2026-11-11T00:00:00Z"))).toBe("premium");
    expect(trialFor("pro", signedUp, at("2026-11-11T00:00:00Z"))).toBeNull();
    expect(trialEndedAt("pro", signedUp, at("2026-12-10T00:00:00Z"))).toBeNull();
  }));

  it("is off unless TRIAL_DAYS is set", () => withDays(undefined, () => {
    expect(effectivePlan("free", signedUp, at("2026-11-10T13:00:00Z"))).toBe("free");
    expect(trialFor("free", signedUp, at("2026-11-10T13:00:00Z"))).toBeNull();
    expect(trialEndedAt("free", signedUp, at("2026-11-20T00:00:00Z"))).toBeNull();
  }));

  it("is turned off with TRIAL_DAYS=0", () => withDays("0", () => {
    expect(effectivePlan("free", signedUp, at("2026-11-10T13:00:00Z"))).toBe("free");
    expect(trialEndedAt("free", signedUp, at("2026-11-10T13:00:00Z"))).toBeNull();
  }));

  it("says hours on the last day", () => {
    expect(trialLeftLabel({ daysLeft: 3, hoursLeft: 70 })).toBe("3 days left");
    expect(trialLeftLabel({ daysLeft: 1, hoursLeft: 5 })).toBe("5 hours left");
  });
});
