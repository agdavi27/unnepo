import { beforeEach, describe, expect, it } from "vitest";
import { repo } from "@/lib/db/file-store";
import { creditsForPeople, prepareSearchDebit, prepareUnlockDebit, assertCreditCommitAllowed } from "@/lib/credits/quote";
import { acceptModelFacts, factIsGrounded, mergeQuizFacts, parseHighlights, parseModelProfile, PROFILE_ORGANIZE_PROMPT, quizSourceText } from "@/lib/profile/quiz-model";
import { profileIntelligence } from "@/lib/profile/intelligence";
import { recordPeopleSearch, resetStructuredProfile, saveManualEmailDraft, saveStructuredProfile, unlockWorkspaceEmail, generateWorkspaceEmail, deleteWorkspaceContacts, refreshProfileHighlights, updateWorkspaceContact, workspaceState } from "@/lib/services/workspace";
import { setContactFetcher } from "@/lib/providers/contacts/http";
import { COLLEGE_SUGGESTIONS, brandsForInterests, rankSuggestions } from "@/lib/suggestions";
import { formatLocation, joinProfileList, parseLocation, splitLocations, splitProfileList } from "@/lib/profile/lists";
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
    expect(bodies[0]).toMatchObject({ person_titles: ["Brand marketing"], q_organization_domains_list: ["patagonia.com"], person_locations: ["Boston"] });
    expect(bodies[0].q_keywords).toBeUndefined();
    expect((await repo.getAccount(userId))?.balance).toBe(23);
    expect((await repo.listSaved(userId))).toHaveLength(30);

    expect(first.request.contactIds).toHaveLength(30);
    expect(first.request.contactIds?.[0]).toBe("apollo_p0");
    const second = await recordPeopleSearch(userId, { mode: "automatic", quantity: 25 });
    expect(second.people).toHaveLength(0);
    expect(second.charged).toBe(0);
    expect((await repo.getAccount(userId))?.balance).toBe(23);
  });

  it("loosens a search step by step and says what matched", async () => {
    process.env.APOLLO_API_KEY = "test-key";
    process.env.SIGNUP_CREDITS = "25";
    const userId = await verifiedStudent("ladder@colby.edu", "Ladder");
    await saveStructuredProfile(userId, form, "Ladder");
    const bodies: Array<Record<string, unknown>> = [];
    setContactFetcher(async (input, init) => {
      if (String(input).includes("bulk_match")) return Response.json({ matches: [] });
      const body = JSON.parse(String(init?.body ?? "{}"));
      bodies.push(body);
      // Only the step without a company filter finds anyone.
      if (body.q_organization_domains_list) return Response.json({ people: [] });
      return Response.json({ people: [{ id: "x1", first_name: "Sam", last_name_obfuscated: "R***", title: "Brand Manager", organization: { name: "REI" } }] });
    });
    const result = await recordPeopleSearch(userId, { mode: "custom", quantity: 25, prompt: "Find relevant professionals at companies matching my interests.", filters: { suggestion: "People at my dream companies" } });
    expect(result.people).toHaveLength(1);
    expect(bodies[0].q_organization_domains_list).toEqual(["patagonia.com"]);
    expect(bodies.some((body) => Array.isArray(body.organization_industries) && (body.organization_industries as string[]).includes("marketing & advertising"))).toBe(true);
    expect(result.message).toMatch(/Matched: people at companies in your interests/);
    const contact = await repo.getContact("apollo_x1");
    expect(contact?.school).toBeNull();
  });

  it("reads roles, cities, and industries from a typed search", async () => {
    process.env.APOLLO_API_KEY = "test-key";
    const userId = await verifiedStudent("typed@colby.edu", "Typer");
    await saveStructuredProfile(userId, form, "Typer");
    const bodies: Array<Record<string, unknown>> = [];
    setContactFetcher(async (input, init) => {
      if (String(input).includes("bulk_match")) return Response.json({ matches: [] });
      bodies.push(JSON.parse(String(init?.body ?? "{}")));
      return Response.json({ people: [] });
    });
    await recordPeopleSearch(userId, { mode: "custom", quantity: 25, prompt: "Marketing managers at outdoor brands in Boston", filters: {} });
    expect(bodies[0].person_titles).toEqual(["Marketing Manager"]);
    expect(bodies[0].person_locations).toEqual(["Boston, MA"]);
    expect(bodies[0].organization_industries).toContain("sporting goods");
    expect(bodies[0].q_keywords).toBeUndefined();
  });

  it("falls back to broader searches instead of returning nobody", async () => {
    process.env.APOLLO_API_KEY = "test-key";
    const userId = await verifiedStudent("fallback@colby.edu", "Fallback");
    await saveStructuredProfile(userId, form, "Fallback");
    const bodies: Array<Record<string, unknown>> = [];
    setContactFetcher(async (input, init) => {
      if (String(input).includes("bulk_match")) return Response.json({ matches: [] });
      const body = JSON.parse(String(init?.body ?? "{}"));
      bodies.push(body);
      // Only the broadest step finds anyone.
      const keys = Object.keys(body).filter((key) => !["page", "per_page", "include_similar_titles"].includes(key));
      if (keys.length === 1 && keys[0] === "person_seniorities") {
        return Response.json({ people: [{ id: `b${bodies.length}`, first_name: "Alex", last_name_obfuscated: "K***", title: "Manager", organization: { name: "Acme" } }] });
      }
      return Response.json({ people: [] });
    });
    const alumni = await recordPeopleSearch(userId, { mode: "custom", quantity: 25, prompt: "x", filters: { suggestion: "Alumni from my school" } });
    expect(alumni.people.length).toBeGreaterThan(0);
    expect(alumni.message).toMatch(/can't filter people by school/);
    expect(alumni.message).toMatch(/professionals \(broad match\)/);
    expect(alumni.message).toMatch(/match only part of your search/);
    const vague = await recordPeopleSearch(userId, { mode: "custom", quantity: 25, prompt: "Someone kind who wants to help students like me figure things out", filters: {} });
    expect(vague.people.length).toBeGreaterThan(0);
    expect(vague.message).toMatch(/based on your profile/);
  });

  it("saves photos and social links from the email lookup", async () => {
    process.env.APOLLO_API_KEY = "test-key";
    const userId = await verifiedStudent("socials@colby.edu", "Socials");
    await saveStructuredProfile(userId, form, "Socials");
    setContactFetcher(async (input, init) => {
      if (String(input).includes("bulk_match")) {
        const details = JSON.parse(String(init?.body)).details as Array<{ id: string }>;
        return Response.json({ matches: details.map((item) => ({
          id: item.id, last_name: "Rivera", city: "Boston", state: "Massachusetts", email: null,
          photo_url: "https://example.com/p.jpg", linkedin_url: "https://linkedin.com/in/sam", twitter_url: "https://x.com/sam", github_url: "javascript:alert(1)",
        })) });
      }
      return Response.json({ people: [{ id: "sam", first_name: "Sam", last_name_obfuscated: "R***", title: "Brand Manager", organization: { name: "Patagonia" } }] });
    });
    await recordPeopleSearch(userId, { mode: "automatic", quantity: 25 });
    const contact = (await workspaceState(userId)).contacts.find((item) => item.id === "apollo_sam");
    expect(contact).toMatchObject({ name: "Sam Rivera", location: "Boston, Massachusetts", photoUrl: "https://example.com/p.jpg" });
    expect(contact?.links).toEqual([
      { kind: "linkedin", url: "https://linkedin.com/in/sam" },
      { kind: "x", url: "https://x.com/sam" },
    ]);
  });

  it("looks up an unknown company in Apollo once and reuses the answer", async () => {
    process.env.APOLLO_API_KEY = "test-key";
    process.env.DAILY_USER_SPEND_CENTS = "100000";
    const userId = await verifiedStudent("lookup@colby.edu", "Looker");
    await saveStructuredProfile(userId, { ...form, dreamCompanies: "Acme Outdoor Co" }, "Looker");
    const urls: string[] = [];
    const bodies: Array<Record<string, unknown>> = [];
    setContactFetcher(async (input, init) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("mixed_companies")) return Response.json({ organizations: [{ id: "o1", name: "Acme Outdoor Co", primary_domain: "acmeoutdoor.com" }] });
      if (url.includes("bulk_match")) return Response.json({ matches: [] });
      bodies.push(JSON.parse(String(init?.body ?? "{}")));
      return Response.json({ people: [] });
    });
    await recordPeopleSearch(userId, { mode: "automatic", quantity: 25 });
    await recordPeopleSearch(userId, { mode: "automatic", quantity: 25 });
    expect(urls.filter((url) => url.includes("mixed_companies"))).toHaveLength(1);
    expect(bodies[0].q_organization_domains_list).toEqual(["acmeoutdoor.com"]);
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

  it("lets a student mark a saved contact as contacted and reports when it was found", async () => {
    const userId = await verifiedStudent("status@colby.edu", "Statuser");
    const other = await verifiedStudent("status.other@colby.edu", "Other");
    await saveStructuredProfile(userId, form, "Statuser");
    await repo.upsertContacts([{
      id: "status_person", externalId: "status_person", provider: "apollo", fullName: "Pat Doe", firstName: "Pat", lastName: "Doe",
      title: "Recruiter", company: "REI", companyDomain: null, location: "", school: null, profileUrl: null, email: null, emailStatus: "unknown",
      phone: null, phoneStatus: "unknown", tags: [], seniority: null, department: null, industry: null, companySize: null, interests: [],
      previousRoles: [], achievements: [], publicPosts: [], verifiedMutuals: [], shareable: false, licenseNote: "test", dataSource: "provider",
      fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString(), costCents: 0, costEstimated: true,
    }]);
    await repo.saveFoundContacts(userId, ["status_person"]);
    const before = (await workspaceState(userId)).contacts[0];
    expect(before.status).toBe("not_contacted");
    expect(before.foundAt).toBeTruthy();
    await expect(updateWorkspaceContact(userId, { contactId: "status_person", status: "sent" })).rejects.toThrow(/valid status/);
    await expect(updateWorkspaceContact(other, { contactId: "status_person", status: "contacted" })).rejects.toThrow(/not in your saved list/);
    await updateWorkspaceContact(userId, { contactId: "status_person", status: "contacted" });
    expect((await workspaceState(userId)).contacts[0].status).toBe("contacted");
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

  it("ranks typeahead suggestions by prefix and skips ones already chosen", () => {
    expect(rankSuggestions(COLLEGE_SUGGESTIONS, "col")[0]).toBe("Colby College");
    expect(rankSuggestions(COLLEGE_SUGGESTIONS, "berk")).toContain("University of California, Berkeley");
    expect(rankSuggestions(["Patagonia", "Spotify", "Pinterest"], "p", ["Patagonia"])).toEqual(["Pinterest", "Spotify"]);
    expect(rankSuggestions(["Patagonia"], "  ")).toEqual([]);
    expect(rankSuggestions(COLLEGE_SUGGESTIONS, "u", [], 8)).toHaveLength(8);
  });

  it("stores bubble answers as a list and keeps commas inside places", () => {
    expect(splitProfileList("Economics; Math ;economics")).toEqual(["Economics", "Math"]);
    expect(splitProfileList("Patagonia, REI")).toEqual(["Patagonia", "REI"]);
    expect(joinProfileList(["Patagonia", " REI "])).toBe("Patagonia; REI");
    const stored = joinProfileList([formatLocation("New York, NY", 25), formatLocation("Boston, MA", null)]);
    expect(splitLocations(stored).map((entry) => parseLocation(entry))).toEqual([
      { place: "New York, NY", miles: 25 },
      { place: "Boston, MA", miles: null },
    ]);
    expect(splitLocations("Boston, MA")).toEqual(["Boston, MA"]);
  });

  it("suggests brands from interests without repeating ones already added", () => {
    const ideas = brandsForInterests(["Outdoor & Adventure", "Music"], ["Patagonia"]);
    expect(ideas).toContain("REI");
    expect(ideas).toContain("Fender");
    expect(ideas).not.toContain("Patagonia");
    expect(brandsForInterests(["Trail running"])).toEqual([]);
  });

  it("saves bubble answers as separate search goals", async () => {
    const userId = await verifiedStudent("bubbles@colby.edu", "Bubbles");
    await saveStructuredProfile(userId, { ...form, targetRoles: "Brand marketing; Product marketing", dreamCompanies: "Patagonia; REI", locations: "New York, NY (within 25 mi); Boston, MA" }, "Bubbles");
    const goals = await repo.getGoals(userId);
    expect(goals?.roles).toEqual(["Brand marketing", "Product marketing"]);
    expect(goals?.companies).toEqual(["Patagonia", "REI"]);
    expect(goals?.locations).toEqual(["New York, NY", "Boston, MA"]);
  });

  it("keeps at most 20 highlights, drops duplicates, and keeps job details only on experience", () => {
    const items = Array.from({ length: 25 }, (_, index) => ({ label: `Item ${index}`, detail: `Detail ${index}`, category: "skill", experience_details: "should drop" }));
    items.unshift({ label: "Marketing intern at Patagonia", detail: "Ran email tests.", category: "experience", experience_details: "Owned weekly email A/B tests." });
    items.push({ label: "item 0", detail: "dup", category: "skill", experience_details: null as unknown as string });
    const parsed = parseHighlights(`Here you go: ${JSON.stringify({ highlights: items })}`);
    expect(parsed).toHaveLength(20);
    expect(parsed[0]).toMatchObject({ label: "Marketing intern at Patagonia", category: "experience", experienceDetails: "Owned weekly email A/B tests." });
    expect(parsed[1].experienceDetails).toBeNull();
    expect(new Set(parsed.map((item) => item.id)).size).toBe(20);
    expect(parseHighlights("not json")).toEqual([]);
  });

  it("saves a profile without highlights when no key is set and refuses to rebuild them", async () => {
    const userId = await verifiedStudent("highlights@colby.edu", "Highlighter");
    const saved = await saveStructuredProfile(userId, form, "Highlighter");
    expect(saved.document.highlights).toBeNull();
    expect((await workspaceState(userId)).highlights).toEqual([]);
    await expect(refreshProfileHighlights(userId)).rejects.toThrow(/could not be built/);
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
