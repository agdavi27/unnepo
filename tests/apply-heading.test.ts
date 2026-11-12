import { beforeEach, describe, expect, it } from "vitest";
import { applications } from "@/lib/apply/store";
import { repairCompanies, titleMissing } from "@/lib/apply/service";
import { signUp } from "@/lib/services/auth";
import { useTempDb } from "./helpers";

async function saved(userId: string, n: number, title: string, company: string) {
  const { app } = await applications.insert({
    userId, jobKey: `url:app.joinhandshake.com/jobs/${n}`, jobUrl: `https://app.joinhandshake.com/jobs/${n}`, ats: "other", title, company, companyDomain: null, department: null, location: null,
    description: "", requirements: [], applicationUrl: null, postedRecruiter: null, status: "submitted", statusMessage: "", questions: [], browserSessionId: null, fillReport: null,
    confirmation: null, submittedAt: new Date().toISOString(), contactsStatus: "idle", contactsMessage: "", charged: true, attempts: 0,
  });
  return app;
}

describe("jobs saved from an apply pop-up's headings", () => {
  beforeEach(() => { useTempDb(); });

  it("come back with the employer's name, and the title shown as missing", async () => {
    const userId = (await signUp({ email: "pat.doe@colby.edu", password: "password123", name: "Pat Doe" })).user.id;
    await saved(userId, 1, "Apply to The Black Sheep", "Details from The Black Sheep");
    await saved(userId, 2, "Apply to Runway Services", "joinhandshake");
    const fixed = await repairCompanies(userId, await applications.list(userId));
    expect(fixed.map((app) => app.company).sort()).toEqual(["Runway Services", "The Black Sheep"]);
    expect(fixed.every((app) => titleMissing(app.title))).toBe(true);
    // Saved, not just shown.
    expect((await applications.list(userId)).map((app) => app.company).sort()).toEqual(["Runway Services", "The Black Sheep"]);
  });
});
