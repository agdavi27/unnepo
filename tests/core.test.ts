import { beforeEach, describe, expect, it } from "vitest";
import { repo } from "@/lib/db/file-store";
import { bodyUsesOnlyFacts, generateGroundedEmail } from "@/lib/email/grounded";
import { classifyReply } from "@/lib/email/classify";
import { parseResumeText } from "@/lib/resume/parse";
import { setContactFetcher } from "@/lib/providers/contacts/http";
import { enrichPerson, searchPeople } from "@/lib/providers/contacts/router";
import { applyVerifiedStripeEvent } from "@/lib/services/billing";
import { unlockContact, runSearch } from "@/lib/services/contacts";
import { login, signUp, verifyEmail } from "@/lib/services/auth";
import { runIdempotent } from "@/lib/services/idempotency";
import { rewardReferralIfEligible } from "@/lib/services/referrals";
import { sendOutreach, setMailSenderForTests, syncReplies } from "@/lib/services/outreach";
import { useTempDb } from "./helpers";

beforeEach(() => {
  useTempDb();
});

async function verifiedStudent(email: string, name: string, referral?: string) {
  const signed = await signUp({ email, password: "password123", name, referralCode: referral });
  expect(signed.verifyToken).toBeTruthy();
  await verifyEmail(signed.verifyToken!);
  const session = await login(email, "password123");
  return { userId: session.user.id, email };
}

describe("search credits", () => {
  it("charges one credit once for a people search and refuses a second when the balance is empty", async () => {
    const student = await verifiedStudent("searcher@colby.edu", "Searcher");
    const first = await repo.spendCredits({ userId: student.userId, amount: 1, idempotencyKey: "search-1", note: "Show up to 20 people", entryType: "search_debit" });
    expect(first.charged).toBe(1);
    expect(first.balance).toBe(24);
    const again = await repo.spendCredits({ userId: student.userId, amount: 1, idempotencyKey: "search-1", note: "Show up to 20 people", entryType: "search_debit" });
    expect(again.duplicate).toBe(true);
    expect(again.charged).toBe(0);
    expect((await repo.getAccount(student.userId))?.balance).toBe(24);
    await repo.setAccountForTests(student.userId, { balance: 0, allowanceBalance: 0, purchasedBalance: 0 });
    const blocked = await repo.spendCredits({ userId: student.userId, amount: 1, idempotencyKey: "search-2", note: "Show up to 20 people", entryType: "search_debit" });
    expect(blocked.insufficient).toBe(true);
    expect(blocked.charged).toBe(0);
  });
});

describe("signup credits", () => {
  it("grants 25 credits exactly once after verification", async () => {
    const signed = await signUp({ email: "alex@colby.edu", password: "password123", name: "Alex Chen" });
    const before = await repo.getAccount(signed.user.id);
    expect(before?.balance).toBe(0);
    await verifyEmail(signed.verifyToken!);
    const after = await repo.getAccount(signed.user.id);
    expect(after?.balance).toBe(25);
    await expect(verifyEmail(signed.verifyToken!)).rejects.toThrow(/invalid or expired/);
    const again = await repo.grantCreditsOnce({
      userId: signed.user.id,
      entryType: "signup_grant",
      amount: 25,
      bucket: "allowance",
      idempotencyKey: `signup:${signed.user.id}`,
    });
    expect(again.granted).toBe(false);
    expect((await repo.getAccount(signed.user.id))?.balance).toBe(25);
    await expect(signUp({ email: "alex+alias@colby.edu", password: "password123", name: "Alex" })).rejects.toThrow(/already exists/);
  });
});

describe("referrals", () => {
  it("rewards a referrer once and blocks self referrals", async () => {
    const referrer = await verifiedStudent("drew@colby.edu", "Drew");
    const code = (await repo.getUserById(referrer.userId))!.referralCode;
    const referred = await verifiedStudent("sam@colby.edu", "Sam", code);
    expect((await repo.getAccount(referrer.userId))?.balance).toBe(75);
    const second = await rewardReferralIfEligible(referred.userId);
    expect(second.rewarded).toBe(false);
    const rewards = (await repo.listLedger(referrer.userId)).filter((entry) => entry.entryType === "referral_reward");
    expect(rewards).toHaveLength(1);
    await repo.updateUser(referrer.userId, { referredByUserId: referrer.userId });
    expect((await rewardReferralIfEligible(referrer.userId)).reason).toBe("self");
    await expect(signUp({ email: "new@colby.edu", password: "password123", name: "New", referralCode: "NOTREAL" })).rejects.toThrow(/not found/);
  });
});

describe("contact unlocks", () => {
  it("charges one credit for a usable contact and zero for a failed lookup", async () => {
    const student = await verifiedStudent("alex@colby.edu", "Alex Chen");
    const success = await unlockContact(student.userId, "sample_taylor_kim", "unlock-taylor");
    expect(success.ok).toBe(true);
    expect(success.charged).toBe(1);
    expect(success.contact?.email).toBe("taylor.kim@patagonia.com");
    const replay = await unlockContact(student.userId, "sample_taylor_kim", "unlock-taylor");
    expect(replay.charged).toBe(0);
    const otherKey = await unlockContact(student.userId, "sample_taylor_kim", "unlock-taylor-2");
    expect(otherKey.charged).toBe(0);
    const beforeFail = (await repo.getAccount(student.userId))!.balance;
    const failed = await unlockContact(student.userId, "sample_jamie_cole", "unlock-jamie");
    expect(failed.ok).toBe(false);
    expect(failed.charged).toBe(0);
    expect((await repo.getAccount(student.userId))!.balance).toBe(beforeFail);
    expect(await repo.getSavedByUserAndContact(student.userId, "sample_jamie_cole")).toBeNull();
    const debits = (await repo.listLedger(student.userId)).filter((entry) => entry.entryType === "unlock_debit");
    expect(debits.reduce((sum, entry) => sum + entry.amount, 0)).toBe(-1);
  });

  it("keeps concurrent unlocks from overspending a single credit", async () => {
    const student = await verifiedStudent("alex@colby.edu", "Alex Chen");
    await repo.setAccountForTests(student.userId, { balance: 1, allowanceBalance: 1, purchasedBalance: 0, reserved: 0 });
    const ids = ["sample_taylor_kim", "sample_jordan_lee", "sample_morgan_smith", "sample_alex_rivera", "sample_casey_nguyen", "sample_matt_evans"];
    const results = await Promise.all(ids.map((contactId) => unlockContact(student.userId, contactId, `race-${contactId}`)));
    expect(results.filter((result) => result.ok && result.charged === 1)).toHaveLength(1);
    const account = await repo.getAccount(student.userId);
    expect(account?.balance).toBe(0);
    expect(account?.reserved).toBe(0);
    expect(await repo.listSaved(student.userId)).toHaveLength(1);
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
          amount_total: 5000,
          currency: "usd",
          payment_intent: "pi_1",
          client_reference_id: student.userId,
          metadata: { userId: student.userId, credits: "500" },
        },
      },
    };
    const first = await applyVerifiedStripeEvent(event);
    const second = await applyVerifiedStripeEvent(event);
    expect(first.granted).toBe(500);
    expect(second.duplicate).toBe(true);
    const purchases = (await repo.listLedger(student.userId)).filter((entry) => entry.entryType === "purchase_grant");
    expect(purchases).toHaveLength(1);
    expect((await repo.getAccount(student.userId))?.purchasedBalance).toBe(500);
    expect((await repo.getAccount(student.userId))?.balance).toBe(525);
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

  it("does not invent employers or mutual connections", () => {
    const facts = [
      {
        id: "you:education",
        group: "you" as const,
        key: "education",
        label: "Education",
        detail: "Colby College, Economics",
        source: "Resume",
        available: true,
      },
    ];
    const email = generateGroundedEmail({
      studentName: "Alex Chen",
      leadFirstName: "Taylor",
      leadTitle: "Brand Marketing Manager",
      leadCompany: "Patagonia",
      purpose: "internship",
      tone: "professional",
      facts,
      attachResume: false,
    });
    expect(email.body).toContain("Colby College");
    expect(email.body.toLowerCase()).not.toContain("goldman");
    expect(email.body.toLowerCase()).not.toContain("mutual connection");
    expect(email.body.toLowerCase()).not.toContain("i saw your post");
    expect(bodyUsesOnlyFacts(email.body, facts, ["colby college"])).toBe(true);
  });
});

describe("email sending and replies", () => {
  it("marks a message sent only after the provider confirms, and syncs a reply once", async () => {
    const student = await verifiedStudent("alex@colby.edu", "Alex Chen");
    await unlockContact(student.userId, "sample_taylor_kim", "send-unlock");
    const saved = await repo.getSavedByUserAndContact(student.userId, "sample_taylor_kim");
    const demo = await sendOutreach(student.userId, {
      savedContactId: saved!.id,
      subject: "Hello",
      body: "A short note.",
      idempotencyKey: "demo-1",
      delivery: "demo_outbox",
    });
    expect(demo.message.deliveryConfirmed).toBe(false);
    expect(demo.message.status).toBe("demo_outbox");
    await expect(
      sendOutreach(student.userId, {
        savedContactId: saved!.id,
        subject: "Hello",
        body: "A short note.",
        idempotencyKey: "real-1",
        delivery: "provider",
      }),
    ).rejects.toThrow(/Connect Gmail/);

    await repo.upsertMailbox({
      id: "mbx",
      userId: student.userId,
      provider: "gmail",
      email: "alex@colby.edu",
      accessTokenEncrypted: "not-used",
      refreshTokenEncrypted: null,
      expiresAt: null,
      connectedAt: new Date().toISOString(),
    });
    setMailSenderForTests({
      async send() {
        return { id: "gmail-msg-1", threadId: "thread-1" };
      },
      async replies() {
        return [{ id: "reply-1", from: "Taylor", body: "Happy to chat next week. Let's schedule a Zoom." }];
      },
    });
    const sent = await sendOutreach(student.userId, {
      savedContactId: saved!.id,
      subject: "Hello",
      body: "A short note.",
      idempotencyKey: "real-1",
      delivery: "provider",
    });
    expect(sent.message.deliveryConfirmed).toBe(true);
    expect(sent.message.status).toBe("sent");
    const duplicate = await sendOutreach(student.userId, {
      savedContactId: saved!.id,
      subject: "Hello",
      body: "A short note.",
      idempotencyKey: "real-1",
      delivery: "provider",
    });
    expect(duplicate.created).toBe(false);
    expect((await repo.listMessages(student.userId)).filter((message) => message.status === "sent")).toHaveLength(1);
    const synced = await syncReplies(student.userId);
    expect(synced.imported).toBe(1);
    expect((await repo.getSavedById(student.userId, saved!.id))?.status).toBe("interview_scheduled");
    expect((await syncReplies(student.userId)).imported).toBe(0);
    expect(classifyReply("Please unsubscribe me")).toBe("opt_out");
  });
});

describe("isolation, spend limits, fallback, and retries", () => {
  it("does not let one student read another student's saved contact", async () => {
    const a = await verifiedStudent("a@colby.edu", "A");
    const b = await verifiedStudent("b@upenn.edu", "B");
    await unlockContact(a.userId, "sample_taylor_kim", "iso");
    const saved = await repo.listSaved(a.userId);
    expect(await repo.getSavedById(b.userId, saved[0].id)).toBeNull();
    const search = await runSearch(b.userId, {
      titles: ["Brand Marketing Manager"],
      industries: [],
      locations: [],
      schools: [],
      includeSimilarSchools: false,
      companies: ["Patagonia"],
      seniorities: [],
      departments: [],
      companySizes: [],
    });
    const taylor = search.people.find((person) => person.id === "sample_taylor_kim");
    expect(taylor?.email).toBeNull();
    expect(taylor?.unlocked).toBe(false);
    expect(search.source).toBe("sample");
  });

  it("stops paid lookups at the spend cap and does not fall back to sample data", async () => {
    process.env.APOLLO_API_KEY = "test-key";
    process.env.DAILY_GLOBAL_SPEND_CENTS = "0";
    await expect(
      searchPeople("user", { titles: [], industries: [], locations: [], schools: [], includeSimilarSchools: false, companies: [], seniorities: [], departments: [], companySizes: [] }, 1, 5),
    ).rejects.toThrow(/budget/);

    process.env.DAILY_GLOBAL_SPEND_CENTS = "100000";
    setContactFetcher(async () => new Response("no", { status: 503 }));
    await expect(
      searchPeople("user", { titles: [], industries: [], locations: [], schools: [], includeSimilarSchools: false, companies: [], seniorities: [], departments: [], companySizes: [] }, 1, 5),
    ).rejects.toThrow(/temporarily unavailable/);
  });

  it("uses Hunter when Apollo enrichment returns no email", async () => {
    process.env.APOLLO_API_KEY = "test-key";
    process.env.HUNTER_API_KEY = "hunter-key";
    process.env.DAILY_GLOBAL_SPEND_CENTS = "100000";
    process.env.DAILY_USER_SPEND_CENTS = "100000";
    await repo.upsertContacts([
      {
        id: "apollo_1",
        externalId: "1",
        provider: "apollo",
        fullName: "Taylor Kim",
        firstName: "Taylor",
        lastName: "Kim",
        title: "Brand Marketing Manager",
        company: "Patagonia",
        companyDomain: "patagonia.com",
        location: "New York, NY",
        school: null,
        profileUrl: null,
        email: null,
        emailStatus: "available",
        phone: null,
        phoneStatus: "unknown",
        tags: [],
        seniority: null,
        department: null,
        industry: null,
        companySize: null,
        interests: [],
        previousRoles: [],
        achievements: [],
        publicPosts: [],
        verifiedMutuals: [],
        shareable: false,
        licenseNote: "test",
        dataSource: "provider",
        fetchedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        costCents: 0,
        costEstimated: true,
      },
    ]);
    setContactFetcher(async (input) => {
      const url = String(input);
      if (url.includes("people/match")) return Response.json({ person: { email: null, phone_numbers: [] } });
      if (url.includes("email-finder")) return Response.json({ data: { email: "taylor.kim@patagonia.com", verification: { status: "valid" } } });
      return new Response("missing", { status: 404 });
    });
    const contact = await repo.getContact("apollo_1");
    const enriched = await enrichPerson(contact!, "user");
    expect(enriched.ok).toBe(true);
    if (enriched.ok) expect(enriched.email).toBe("taylor.kim@patagonia.com");
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
