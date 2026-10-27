import { beforeEach, describe, expect, it } from "vitest";
import { repo } from "@/lib/db/file-store";
import { creditsForPeople, prepareSearchDebit, prepareUnlockDebit, assertCreditCommitAllowed } from "@/lib/credits/quote";
import { acceptModelFacts, factIsGrounded, mergeQuizFacts } from "@/lib/profile/quiz-model";
import { profileIntelligence } from "@/lib/profile/intelligence";
import { recordPeopleSearch, resetStructuredProfile, saveManualEmailDraft, saveStructuredProfile } from "@/lib/services/workspace";
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
  });

  it("saves a profile for the signed-in user and does not show it to someone else", async () => {
    const a = await verifiedStudent("a.profile@colby.edu", "A");
    const b = await verifiedStudent("b.profile@colby.edu", "B");
    const saved = await saveStructuredProfile(a, form, "A");
    expect(saved.document.ready).toBe(true);
    expect(saved.organization).toBe("rules");
    expect(saved.document.facts.some((fact) => fact.section === "projects" && fact.text === "Built a campus store")).toBe(true);
    expect(await repo.getProfileDocument(b)).toBeNull();
    expect((await repo.getProfile(a))?.school).toBe("Colby College");
    await resetStructuredProfile(a);
    expect(await repo.getProfileDocument(a)).toBeNull();
    expect((await repo.getAccount(a))?.balance).toBe(3);
  });

  it("records a search without charging and refuses a duplicate insert", async () => {
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
    expect(integrations.apollo).toBe(false);
    expect(integrations.anthropic).toBe(false);
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
    expect(() => assertCreditCommitAllowed("search")).toThrow(/not deducted/);
    expect(() => creditsForPeople(30)).toThrow(/25/);
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
