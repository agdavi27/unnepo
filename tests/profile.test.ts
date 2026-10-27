import { beforeEach, describe, expect, it } from "vitest";
import { repo } from "@/lib/db/file-store";
import { creditsForPeople, prepareSearchDebit, prepareUnlockDebit, assertCreditCommitAllowed } from "@/lib/credits/quote";
import { acceptModelFacts, factIsGrounded, mergeQuizFacts, parseModelProfile, PROFILE_ORGANIZE_PROMPT, quizSourceText } from "@/lib/profile/quiz-model";
import { profileIntelligence } from "@/lib/profile/intelligence";
import { recordPeopleSearch, resetStructuredProfile, saveManualEmailDraft, saveStructuredProfile, unlockWorkspaceEmail, generateWorkspaceEmail, deleteWorkspaceContacts, workspaceState } from "@/lib/services/workspace";
import { setContactFetcher } from "@/lib/providers/contacts/http";
import { login, signUp, verifyEmail } from "@/lib/services/auth";
import { integrations } from "@/lib/integrations/flags";
import type { ResumeFact } from "@/lib/db/types";
import { useTempDb } from "./helpers";

beforeEach(() => {
  useTempDb();
});

async function verifiedStudent(email: string, name: string) {
  const signed = await signUp({ email, password: "password123", name });
  await verifyEmail(signed.verifyToken!);
  const session = await login(email, "password123");
  return session.user.id;
}

const form = {
  school: "Colby College",
  major: "Economics",
  graduationYear: "2027",
  interests: ["Marketing", "Outdoor & Adventure"],
  otherInterests: "Trail running",
  targetRoles: "Brand marketing",
  dreamCompanies: "Patagonia",
  locations: "Boston",
  workPreference: "hybrid",
  goals: ["Find a mentor"],
  contactTypes: ["Alumni"],
  seniority: "manager",
  bio: "I care about outdoor brands.",
  accomplishments: "Built a campus store",
  excludedTopics: "GPA",
  emailTone: "friendly",
};

describe("structured profile", () => {
  it("sorts onboarding answers into sections and keeps resume lines pending", () => {
    const resumeFact: ResumeFact = {
      id: "rf1",
      userId: "u",
      resumeId: "r1",
      category: "education",
      label: "Colby College",
      detail: "Colby College — Economics, 2026",
      sourceExcerpt: "Colby College — Economics, 2026",
      edited: false,
      createdAt: new Date().toISOString(),
    };
    const organized = profileIntelligence.organize({ profile: form, resumeFacts: [resumeFact] });
    const sections = new Set(organized.facts.map((fact) => fact.section));
    expect(sections.has("personal_education")).toBe(true);
    expect(sections.has("interests")).toBe(true);
    expect(sections.has("career_goals")).toBe(true);
    expect(sections.has("networking")).toBe(true);
    expect(sections.has("story")).toBe(true);
    expect(sections.has("excluded_topics")).toBe(true);
    expect(sections.has("email_preferences")).toBe(true);
    const school = organized.facts.find((fact) => fact.text === "Colby College");
    expect(school?.approvalStatus).toBe("approved");
    expect(school?.source.kind).toBe("onboarding_field");
    const resumeLine = organized.facts.find((fact) => fact.text.includes("2026"));
    expect(resumeLine?.verificationStatus).toBe("file_extracted");
    expect(resumeLine?.approvalStatus).toBe("pending_review");
    expect(resumeLine?.uncertain).toBe(true);
    const outreach = profileIntelligence.approvedForOutreach(organized.facts, form.excludedTopics);
    expect(outreach.some((fact) => /gpa/i.test(fact.text))).toBe(false);
    expect(outreach.every((fact) => fact.verified)).toBe(true);
    const invented = acceptModelFacts(form, [{ section: "employment", label: "Employer", text: "Worked at NASA", sourceField: "bio", uncertain: false }]);
    expect(invented).toEqual([]);
    expect(factIsGrounded("Built a campus store", form)).toBe(true);
    const split = acceptModelFacts(form, [
      { section: "career_goals", label: "Target company", text: "Patagonia", sourceField: "dreamCompanies" },
      { section: "career_goals", label: "Target role", text: "Brand marketing", sourceField: "targetRoles" },
    ]);
    const base = profileIntelligence.organize({ profile: form }).facts;
    const merged = mergeQuizFacts(base, split);
    expect(merged.filter((fact) => fact.text === "Patagonia")).toHaveLength(1);
    expect(merged.find((fact) => fact.text === "Patagonia")?.source.kind).toBe("onboarding_model");
    expect(merged.some((fact) => fact.text === "Colby College" && fact.source.kind === "onboarding_field")).toBe(true);
    const partialBase = profileIntelligence.organize({ profile: { ...form, targetRoles: "Brand marketing and eCommerce" } }).facts;
    const partial = mergeQuizFacts(partialBase, acceptModelFacts(
      { ...form, targetRoles: "Brand marketing and eCommerce" },
      [{ section: "career_goals", label: "Target role", text: "Brand marketing", sourceField: "targetRoles" }],
    ));
    expect(partial.some((fact) => fact.text === "Brand marketing and eCommerce")).toBe(true);
    expect(PROFILE_ORGANIZE_PROMPT.startsWith("Analyze the following text")).toBe(true);
    expect(PROFILE_ORGANIZE_PROMPT).toContain("use null for unknown values");
    expect(quizSourceText(form)).toContain("Colby College");
    expect(quizSourceText(form, "Economics major")).toContain("Resume:");
    expect(parseModelProfile('```json\n{"education":{"school":"Colby College"}}\n```')).toEqual({ education: { school: "Colby College" } });
  });

  it("saves a profile for the signed-in user and does not show it to someone else", async () => {
    const a = await verifiedStudent("a.profile@colby.edu", "A");
    const b = await verifiedStudent("b.profile@colby.edu", "B");
    const saved = await saveStructuredProfile(a, form, "A");
    expect(saved.document.ready).toBe(true);
    expect(saved.organization).toBe("unavailable");
    expect(saved.document.organizedProfile).toBeNull();
    expect(saved.document.facts.some((fact) => fact.section === "projects" && fact.text === "Built a campus store")).toBe(true);
    expect(await repo.getProfileDocument(b)).toBeNull();
    expect((await repo.getProfile(a))?.school).toBe("Colby College");
    await resetStructuredProfile(a);
    expect(await repo.getProfileDocument(a)).toBeNull();
    expect((await repo.getAccount(a))?.balance).toBe(3);
  });

  it("records a search without charging and refuses a duplicate insert while Apollo is off", async () => {
    const flags = integrations as { apollo: boolean };
    flags.apollo = false;
    try {
      const userId = await verifiedStudent("search.quote@colby.edu", "Searcher");
      const before = (await repo.getAccount(userId))?.balance;
      const first = await recordPeopleSearch(userId, { mode: "automatic", quantity: 50 });
      const second = await recordPeopleSearch(userId, { mode: "automatic", quantity: 50 });
      expect(first.charged).toBe(0);
      expect(first.people).toEqual([]);
      expect(first.status).toBe("not_connected");
      expect(first.request.creditsQuoted).toBe(2);
      expect(second.request.id).toBe(first.request.id);
      expect((await repo.getAccount(userId))?.balance).toBe(before);
      expect(() => assertCreditCommitAllowed("search")).toThrow(/not deducted/);
    } finally {
      flags.apollo = true;
    }
  });

  it("charges a live search only for people found and skips people already saved", async () => {
    process.env.APOLLO_API_KEY = "test-key";
    process.env.SIGNUP_CREDITS = "25";
    const userId = await verifiedStudent("live.search@colby.edu", "Live Searcher");
    await saveStructuredProfile(userId, form, "Live Searcher");
    const bodies: Array<Record<string, unknown>> = [];
    setContactFetcher(async (input, init) => {
      if (String(input).includes("bulk_match")) return Response.json({ matches: [] });
      bodies.push(JSON.parse(String(init?.body ?? "{}")));
      const people = Array.from({ length: 30 }, (_, index) => ({
        id: `p${index}`,
        first_name: "Person",
        last_name: String(index),
        title: "Brand Marketing Manager",
        organization: { name: "Patagonia" },
      }));
      return Response.json({ people });
    });
    const first = await recordPeopleSearch(userId, { mode: "automatic", quantity: 50 });
    expect(first.status).toBe("completed");
    expect(first.people).toHaveLength(30);
    expect(first.charged).toBe(2);
    expect(bodies[0].person_titles).toEqual(["Brand marketing"]);
    expect((await repo.getAccount(userId))?.balance).toBe(23);
    expect((await repo.listSaved(userId))).toHaveLength(30);

    const second = await recordPeopleSearch(userId, { mode: "automatic", quantity: 25 });
    expect(second.people).toHaveLength(0);
    expect(second.charged).toBe(0);
    expect((await repo.getAccount(userId))?.balance).toBe(23);
  });

  it("refuses a live search the balance cannot cover without calling Apollo", async () => {
    process.env.APOLLO_API_KEY = "test-key";
    const userId = await verifiedStudent("live.poor@colby.edu", "Short On Credits");
    await saveStructuredProfile(userId, form, "Short On Credits");
    let calls = 0;
    setContactFetcher(async () => {
      calls += 1;
      return Response.json({ people: [] });
    });
    await expect(recordPeopleSearch(userId, { mode: "automatic", quantity: 250 })).rejects.toThrow(/needs 10 credits/);
    expect(calls).toBe(0);
  });

  it("includes verified emails with a search at no extra credit and retries lookups for free", async () => {
    process.env.APOLLO_API_KEY = "test-key";
    const userId = await verifiedStudent("emails@colby.edu", "Emailer");
    await saveStructuredProfile(userId, form, "Emailer");
    let status = "guessed";
    const urls: string[] = [];
    setContactFetcher(async (input, init) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("bulk_match")) {
        const details = JSON.parse(String(init?.body)).details as Array<{ id: string }>;
        return Response.json({ matches: details.map((item) => ({ id: item.id, email: `${item.id}@patagonia.com`, email_status: item.id === "jo" ? "verified" : status })) });
      }
      if (url.includes("people/match")) return Response.json({ person: { email: "al@patagonia.com", email_status: status } });
      return Response.json({
        people: [
          { id: "jo", first_name: "Jo", last_name: "Lee", title: "Brand Manager", organization: { name: "Patagonia" } },
          { id: "al", first_name: "Al", last_name: "Diaz", title: "Brand Manager", organization: { name: "Patagonia" } },
        ],
      });
    });
    const result = await recordPeopleSearch(userId, { mode: "automatic", quantity: 25 });
    expect(result.charged).toBe(1);
    expect(urls.filter((url) => url.includes("bulk_match"))).toHaveLength(1);
    const balance = (await repo.getAccount(userId))!.balance;
    const state = await workspaceState(userId);
    expect(state.contacts.find((contact) => contact.id === "apollo_jo")?.email).toBe("jo@patagonia.com");
    expect(state.contacts.find((contact) => contact.id === "apollo_al")?.email).toBeUndefined();

    const still = await unlockWorkspaceEmail(userId, { contactId: "apollo_al" });
    expect(still.ok).toBe(false);
    status = "verified";
    const found = await unlockWorkspaceEmail(userId, { contactId: "apollo_al" });
    expect(found.ok).toBe(true);
    expect(found.email).toBe("al@patagonia.com");
    expect((await repo.getAccount(userId))!.balance).toBe(balance);
  });

  it("deletes contacts from one student's list only", async () => {
    process.env.APOLLO_API_KEY = "test-key";
    const a = await verifiedStudent("delete.a@colby.edu", "Deleter A");
    const b = await verifiedStudent("delete.b@colby.edu", "Deleter B");
    await saveStructuredProfile(a, form, "Deleter A");
    await repo.saveFoundContacts(a, ["c1", "c2"]);
    await repo.saveFoundContacts(b, ["c1"]);
    const removed = await deleteWorkspaceContacts(a, { contactIds: ["c1"] });
    expect(removed.removed).toBe(1);
    expect((await repo.listSaved(a)).map((row) => row.contactId)).toEqual(["c2"]);
    expect((await repo.listSaved(b)).map((row) => row.contactId)).toEqual(["c1"]);
    await expect(deleteWorkspaceContacts(a, { contactIds: [] })).rejects.toThrow(/at least one/);
  });

  it("quotes credits and will not commit them while providers are off", () => {
    expect(creditsForPeople(25)).toBe(1);
    expect(creditsForPeople(250)).toBe(10);
    const search = prepareSearchDebit("user", "req", 100);
    const unlock = prepareUnlockDebit("user", "contact");
    expect(search.commit).toBe(false);
    expect(search.amount).toBe(4);
    expect(search.idempotencyKey).toBe("search:user:req");
    expect(unlock.amount).toBe(1);
    expect(unlock.idempotencyKey).toBe("unlock:user:contact");
    expect(() => assertCreditCommitAllowed("unlock")).toThrow(/not deducted/);
    expect(() => creditsForPeople(30)).toThrow(/25/);
  });

  it("refuses an AI draft without a key and does not count it", async () => {
    const userId = await verifiedStudent("ai.draft@colby.edu", "Writer");
    await saveStructuredProfile(userId, form, "Writer");
    await repo.upsertContacts([{
      id: "ai_person",
      externalId: "ai_person",
      provider: "apollo",
      fullName: "Sam Rivera",
      firstName: "Sam",
      lastName: "Rivera",
      title: "Brand Manager",
      company: "Patagonia",
      companyDomain: null,
      location: "Boston, MA",
      school: null,
      profileUrl: null,
      email: null,
      emailStatus: "unknown",
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
    }]);
    await repo.saveFoundContacts(userId, ["ai_person"]);
    await expect(generateWorkspaceEmail(userId, { contactId: "ai_person", goal: "chat" })).rejects.toThrow(/not configured/);
    await expect(generateWorkspaceEmail(userId, { contactId: "nobody" })).rejects.toThrow();
    expect(await repo.listGenerations(userId)).toHaveLength(0);
  });

  it("saves a manual draft and does not mark it sent", async () => {
    const userId = await verifiedStudent("drafts@colby.edu", "Drafter");
    await saveStructuredProfile(userId, form, "Drafter");
    const document = await repo.getProfileDocument(userId);
    const factId = document!.facts.find((fact) => fact.text === "Colby College")!.id;
    await repo.upsertContacts([{
      id: "saved_person",
      externalId: "saved_person",
      provider: "sample",
      fullName: "Existing Person",
      firstName: "Existing",
      lastName: "Person",
      title: "Manager",
      company: "Acme",
      companyDomain: null,
      location: "Boston",
      school: null,
      profileUrl: null,
      email: "person@acme.com",
      emailStatus: "verified",
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
      dataSource: "sample",
      fetchedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      costCents: 0,
      costEstimated: true,
    }]);
    await repo.saveFoundContacts(userId, ["saved_person"]);
    const draft = await saveManualEmailDraft(userId, {
      contactId: "saved_person",
      subject: "Hello",
      body: "Would you have 15 minutes?",
      studentFactIds: [factId, "not-mine"],
      contactFactIds: [],
      goal: "chat",
      tone: "friendly",
      length: "short",
      notes: "",
    });
    expect(draft.status).toBe("saved");
    expect(draft.studentFactIds).toEqual([factId]);
    expect(await repo.listMessages(userId)).toEqual([]);
  });
});
