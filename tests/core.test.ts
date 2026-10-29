import { beforeEach, describe, expect, it } from "vitest";
import { repo } from "@/lib/db/file-store";
import { writeFileSync } from "node:fs";
import { parseResumeText } from "@/lib/resume/parse";
import { saveResumeBytes } from "@/lib/services/resume";
import { setContactFetcher } from "@/lib/providers/contacts/http";
import { enrichPeopleBatch, searchPeopleQuery } from "@/lib/providers/contacts/router";
import { applyVerifiedStripeEvent } from "@/lib/services/billing";
import { login, requestPasswordReset, resetPassword, signUp, verifyEmail } from "@/lib/services/auth";
import { runIdempotent } from "@/lib/services/idempotency";
import { suggestRoles } from "@/lib/roles";
import { aiMonthlyLimit } from "@/lib/services/entitlements";
import { useTempDb } from "./helpers";

beforeEach(() => {
  useTempDb();
});

async function verifiedStudent(email: string, name: string) {
  const signed = await signUp({ email, password: "password123", name });
  expect(signed.verifyToken).toBeTruthy();
  await verifyEmail(signed.verifyToken!);
  const session = await login(email, "password123");
  return { userId: session.user.id, email };
}

describe("signup credits", () => {
  it("grants 3 credits exactly once after verification", async () => {
    const signed = await signUp({ email: "alex@colby.edu", password: "password123", name: "Alex Chen" });
    const before = await repo.getAccount(signed.user.id);
    expect(before?.balance).toBe(0);
    await verifyEmail(signed.verifyToken!);
    const after = await repo.getAccount(signed.user.id);
    expect(after?.balance).toBe(3);
    await expect(verifyEmail(signed.verifyToken!)).rejects.toThrow(/invalid or expired/);
    const again = await repo.grantCreditsOnce({
      userId: signed.user.id,
      entryType: "signup_grant",
      amount: 3,
      bucket: "allowance",
      idempotencyKey: `signup:${signed.user.id}`,
    });
    expect(again.granted).toBe(false);
    expect((await repo.getAccount(signed.user.id))?.balance).toBe(3);
    await expect(signUp({ email: "alex+alias@colby.edu", password: "password123", name: "Alex" })).rejects.toThrow(/already exists/);
  });
});

describe("password reset", () => {
  it("emails a one-time link and replaces the password", async () => {
    await verifiedStudent("resetme@colby.edu", "Reset");
    const missing = await requestPasswordReset("nobody@colby.edu");
    expect(missing.resetUrl).toBeNull();
    const asked = await requestPasswordReset("resetme@colby.edu", "http://127.0.0.1:43123");
    expect(asked.resetUrl).toContain("/reset?token=");
    const token = new URL(asked.resetUrl!).searchParams.get("token");
    expect(token).toBeTruthy();
    await resetPassword(token!, "newpass123");
    await expect(login("resetme@colby.edu", "password123")).rejects.toThrow(/incorrect/);
    const session = await login("resetme@colby.edu", "newpass123");
    expect(session.user.email).toBe("resetme@colby.edu");
    await expect(resetPassword(token!, "anotherpass")).rejects.toThrow(/invalid or expired/);
  });
});

describe("stripe webhooks", () => {
  it("grants pack credits once when the same event is delivered twice", async () => {
    const student = await verifiedStudent("alex@colby.edu", "Alex Chen");
    const event = {
      id: "evt_pack_1",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_1",
          mode: "payment",
          payment_status: "paid",
          amount_total: 6000,
          currency: "usd",
          payment_intent: "pi_1",
          client_reference_id: student.userId,
          metadata: { userId: student.userId, credits: "75" },
        },
      },
    };
    const first = await applyVerifiedStripeEvent(event);
    const second = await applyVerifiedStripeEvent(event);
    expect(first.granted).toBe(75);
    expect(second.duplicate).toBe(true);
    const purchases = (await repo.listLedger(student.userId)).filter((entry) => entry.entryType === "purchase_grant");
    expect(purchases).toHaveLength(1);
    expect((await repo.getAccount(student.userId))?.purchasedBalance).toBe(75);
    expect((await repo.getAccount(student.userId))?.balance).toBe(78);
  });
});

describe("resume parsing and grounding", () => {
  it("extracts only headings that are present", () => {
    const facts = parseResumeText(`
Education
Colby College — Economics

Experience
Marketing intern — campus campaigns

Skills
SEO, content, analytics

Interests
Outdoor, running
`);
    expect(facts.map((fact) => fact.category).sort()).toEqual(["education", "experience", "interest", "skill"]);
    expect(facts.some((fact) => /mba|goldman|google/i.test(fact.detail))).toBe(false);
    expect(facts.find((fact) => fact.category === "skill")?.detail).toContain("SEO");
  });

  it("saves the resume record when the file folder cannot be written", async () => {
    const blocker = "/tmp/unnepo-not-a-directory";
    writeFileSync(blocker, "not a folder");
    const previousUrl = process.env.SUPABASE_URL;
    const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      const saved = await saveResumeBytes(blocker, "student/resume.docx", new Uint8Array([1, 2, 3]), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      expect(saved).toBe("");
    } finally {
      if (previousUrl) process.env.SUPABASE_URL = previousUrl;
      if (previousKey) process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
    }
  });

});

describe("spend limits and retries", () => {

  it("stops paid lookups at the spend cap, and a failed search says no credits were used", async () => {
    process.env.APOLLO_API_KEY = "test-key";
    process.env.DAILY_GLOBAL_SPEND_CENTS = "0";
    let calls = 0;
    setContactFetcher(async () => {
      calls += 1;
      return Response.json({ matches: [] });
    });
    const person = { id: "apollo_1", provider: "apollo", externalId: "ext_1" } as unknown as Parameters<typeof enrichPeopleBatch>[0][number];
    expect((await enrichPeopleBatch([person], "user")).size).toBe(0);
    expect(calls).toBe(0);

    process.env.DAILY_GLOBAL_SPEND_CENTS = "100000";
    setContactFetcher(async () => new Response("no", { status: 503 }));
    await expect(searchPeopleQuery("user", { person_titles: ["recruiter"] }, 1, 5)).rejects.toThrow(/No credits were used/);
  });

  it("does not run a background job twice", async () => {
    let runs = 0;
    const first = await runIdempotent("resume:1", async () => {
      runs += 1;
      return { ok: true };
    });
    const second = await runIdempotent("resume:1", async () => {
      runs += 1;
      return { ok: false };
    });
    expect(runs).toBe(1);
    expect(second).toEqual(first);
  });
});

describe("job helpers", () => {

  it("suggests marketing roles from resume experience", () => {
    const roles = suggestRoles([
      {
        id: "1",
        userId: "u",
        resumeId: "r",
        category: "experience",
        label: "Marketing intern",
        detail: "Campus campaigns and SEO",
        sourceExcerpt: "Marketing intern",
        edited: false,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    expect(roles.fromResume.some((role) => /marketing/i.test(role))).toBe(true);
    expect(roles.similar.some((role) => /marketing|brand|content|growth/i.test(role))).toBe(true);
  });
});

describe("plans", () => {

  it("keeps AI writing off the free plan", () => {
    expect(aiMonthlyLimit("free")).toBe(0);
    expect(aiMonthlyLimit("pro")).toBeGreaterThan(0);
    expect(aiMonthlyLimit("grind")).toBeGreaterThan(0);
  });
});
