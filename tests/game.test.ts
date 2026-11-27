import { beforeEach, describe, expect, it } from "vitest";
import { applications } from "@/lib/apply/store";
import { signUp } from "@/lib/services/auth";
import { BOSSES, bossFor, bossPopupHtml, nextUi, normalizeGame, NO_COUNTS, POPUP_UI, TARGETS, xpOf } from "@/lib/game/boss";
import { gameToday, saveGame } from "@/lib/game/service";
import { useTempDb } from "./helpers";

async function applied(userId: string, n: number, submittedAt: string) {
  await applications.insert({
    userId, jobKey: `url:acme.com/job/${n}`, jobUrl: `https://acme.com/job/${n}`, ats: "other", title: `Role ${n}`, company: "Acme", companyDomain: null, department: null, location: null,
    description: "", requirements: [], applicationUrl: null, postedRecruiter: null, status: "submitted", statusMessage: "", questions: [], browserSessionId: null, fillReport: null,
    confirmation: null, submittedAt, contactsStatus: "idle", contactsMessage: "", charged: true, attempts: 0,
  });
}

describe("game mode: the daily boss", () => {
  it("adds up XP from each action", () => {
    expect(xpOf(NO_COUNTS)).toBe(0);
    expect(xpOf({ apply: 3, tailor: 1, email: 2, follow: 1 })).toBe(3 * 10 + 25 + 2 * 30 + 15);
  });

  it("is on by default and ignores bad settings", () => {
    expect(normalizeGame(undefined)).toEqual({ on: true, home: true, panel: true, target: "normal" });
    expect(normalizeGame({ on: false, home: "yes", target: "nightmare" })).toEqual({ on: false, home: true, panel: true, target: "normal" });
  });

  it("has a boss for every day of the week", () => {
    expect(BOSSES).toHaveLength(7);
    expect(bossFor(new Date(2026, 10, 27)).name).toBe("The Doomscroller");
  });

  it("draws nothing when game mode or that place is off, and the boss beaten at the target", () => {
    const settings = normalizeGame(null);
    const at = { counts: NO_COUNTS, ui: POPUP_UI, now: new Date(2026, 10, 27) };
    expect(bossPopupHtml({ ...at, settings: { ...settings, on: false }, where: "home" })).toBe("");
    expect(bossPopupHtml({ ...at, settings: { ...settings, panel: false }, where: "panel" })).toBe("");
    expect(bossPopupHtml({ ...at, settings, where: "home" })).toContain(`${TARGETS.normal} XP left`);
    const beaten = bossPopupHtml({ ...at, counts: { apply: 0, tailor: 0, email: 4, follow: 0 }, settings, where: "home" });
    expect(beaten).toContain("Beaten today");
    expect(bossPopupHtml({ ...at, settings, where: "home", ui: { ...POPUP_UI, how: true } })).toContain("Email a person</span><b>+30 XP");
  });

  it("opens the menu, How it works and the pill from taps", () => {
    expect(nextUi(POPUP_UI, "more").more).toBe(true);
    expect(nextUi({ ...POPUP_UI, more: true }, "how")).toMatchObject({ how: true, more: false });
    expect(nextUi(POPUP_UI, "min").min).toBe(true);
  });

  describe("on the account", () => {
    beforeEach(() => { useTempDb(); });

    it("counts today's applications and saves the settings", async () => {
      const userId = (await signUp({ email: "pat.doe@colby.edu", password: "password123", name: "Pat Doe" })).user.id;
      await applied(userId, 1, new Date().toISOString());
      await applied(userId, 2, new Date(Date.now() - 3 * 86_400_000).toISOString());
      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const today = await gameToday(userId, since);
      expect(today.counts).toEqual({ apply: 1, tailor: 0, email: 0, follow: 0 });
      expect(today.settings.on).toBe(true);

      expect((await saveGame(userId, { on: false, target: "grind" })).settings).toEqual({ on: false, home: true, panel: true, target: "grind" });
      expect((await gameToday(userId, since)).settings).toMatchObject({ on: false, target: "grind" });
      await expect(saveGame(userId, { target: "nightmare" })).rejects.toThrow("Pick Chill, Normal or Grind.");
    });
  });
});
