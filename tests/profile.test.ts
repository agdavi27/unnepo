import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { repo } from "@/lib/db/file-store";
import { creditsForPeople, prepareSearchDebit, prepareUnlockDebit, assertCreditCommitAllowed } from "@/lib/credits/quote";
import { acceptModelFacts, factIsGrounded, mergeQuizFacts, parseHighlights, parseModelProfile, PROFILE_ORGANIZE_PROMPT, quizSourceText } from "@/lib/profile/quiz-model";
import { profileIntelligence } from "@/lib/profile/intelligence";
import { dismissRecommendedJob, resetStructuredProfile, saveStructuredProfile, generateWorkspaceCoverLetter, listRecommendedJobs, refreshProfileHighlights, workspaceState } from "@/lib/services/workspace";
import { PUBLIC_PLANS, creditMath, serverConfig } from "@/lib/config";
import { scoreJob, setJobFetcherForTests } from "@/lib/jobs/recommend";
import { isPersonalWorkEmail, looksLikePerson } from "@/lib/providers/contacts/router";
import { COLLEGE_SUGGESTIONS, brandsForInterests, rankSuggestions } from "@/lib/suggestions";
import { formatLocation, joinProfileList, parseLocation, splitLocations, splitProfileList } from "@/lib/profile/lists";
import { login, signUp, verifyEmail } from "@/lib/services/auth";
import type { ResumeFact } from "@/lib/db/types";
import { saveStudentProfile } from "@/lib/profile/service";
import { useTempDb } from "./helpers";

beforeEach(() => {
  useTempDb();
});

afterEach(() => {
  vi.unstubAllGlobals();
  setJobFetcherForTests(null);
});

/** Apollo bulk match reply that gives every person a verified work email of their own. */
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

  it("offers Free, Pro and Premium, monthly or by the semester, with 1 credit per company", () => {
    expect(PUBLIC_PLANS.map((plan) => [plan.id, plan.priceLabel, plan.semesterLabel, plan.credits])).toEqual([["free", "$0", null, 3], ["pro", "$24", "or $69 a semester", 40], ["premium", "$44", "or $119 a semester", 100]]);
    expect(creditMath(1)).toBe("People at 1 company");
    expect(creditMath(40)).toBe("People at 40 companies");
    const saved = process.env.SIGNUP_CREDITS;
    delete process.env.SIGNUP_CREDITS;
    expect(serverConfig().signupCredits).toBe(3);
    expect(serverConfig().proMonthlyCredits).toBe(40);
    expect(serverConfig().premiumMonthlyCredits).toBe(100);
    expect(serverConfig().proSemesterPriceCents).toBe(6900);
    process.env.SIGNUP_CREDITS = saved;
  });

  it("scores jobs for students and drops senior or stale postings", () => {
    const prefs = { roles: ["Brand marketing"], companies: ["Patagonia"], locations: ["Boston"], interests: ["Marketing"], remoteOk: true };
    const base = { id: "j", company: "Patagonia", location: "Boston, MA", postedKind: "posted" as const, url: "https://example.com/j", source: "greenhouse" as const, description: "Help our marketing team." };
    const now = Date.parse("2026-10-27T12:00:00Z");
    const intern = scoreJob({ ...base, title: "Brand Marketing Intern", postedAt: "2026-10-25T00:00:00Z" }, prefs, now);
    expect(intern?.reasons).toEqual(expect.arrayContaining(["Matches your role: Brand marketing", "At Patagonia, one of your dream companies", "In Boston", "Internship"]));
    expect(scoreJob({ ...base, title: "Senior Brand Marketing Manager", postedAt: "2026-10-25T00:00:00Z" }, prefs, now)).toBeNull();
    expect(scoreJob({ ...base, title: "Brand Marketing Intern", postedAt: "2026-06-01T00:00:00Z" }, prefs, now)).toBeNull();
    expect(scoreJob({ ...base, company: "Acme", location: "Denver", description: "", title: "Accountant", postedAt: "2026-10-25T00:00:00Z" }, prefs, now)).toBeNull();
  });

  it("suggests jobs from the resume alone: past job titles and skills", async () => {
    const userId = await verifiedStudent("resume-jobs@colby.edu", "Jobseeker");
    await saveStudentProfile(userId, { profile: { experience: [{ company: "Colby", title: "Data Analyst Intern", startDate: "2025", current: false, bullets: [] }], skills: { technical: ["SQL", "Tableau"] } } });
    const asked: string[] = [];
    setJobFetcherForTests(async (url) => {
      asked.push(url);
      if (url.includes("remotive.com")) {
        return Response.json({ jobs: [
          { id: 1, title: "Data Analyst Intern", company_name: "Globex", candidate_required_location: "USA", publication_date: new Date().toISOString(), url: "https://remotive.com/jobs/1", description: "Write SQL and build Tableau dashboards." },
          { id: 2, title: "Pastry Chef", company_name: "Bakery", candidate_required_location: "USA", publication_date: new Date().toISOString(), url: "https://remotive.com/jobs/2", description: "Bake." },
        ] });
      }
      return new Response("not found", { status: 404 });
    });
    const result = await listRecommendedJobs(userId);
    expect(asked.some((url) => url.includes("search=Data%20Analyst"))).toBe(true);
    expect(result.jobs.map((job) => job.title)).toEqual(["Data Analyst Intern"]);
    expect(result.jobs[0].reasons).toEqual(expect.arrayContaining(["Matches your role: Data Analyst", "Uses your skills: SQL, Tableau", "Internship"]));
    expect(result.matchedOn).toEqual({ roles: ["Data Analyst"], skills: ["SQL", "Tableau"] });
  });

  it("finds new jobs on refresh: other searches, new ones first, hidden ones gone", async () => {
    const userId = await verifiedStudent("refresh-jobs@colby.edu", "Jobseeker");
    await saveStudentProfile(userId, { profile: { experience: [{ company: "Colby", title: "Data Analyst Intern", startDate: "2025", current: false, bullets: [] }, { company: "Bank", title: "Finance Intern", startDate: "2024", current: false, bullets: [] }], skills: { technical: ["SQL"] } } });
    const asked: string[] = [];
    const posting = (id: number, title: string) => ({ id, title, company_name: `Co${id}`, candidate_required_location: "USA", publication_date: new Date().toISOString(), url: `https://remotive.com/jobs/${id}`, description: "SQL" });
    setJobFetcherForTests(async (url) => {
      asked.push(url);
      if (url.includes("remotive.com")) return Response.json({ jobs: url.includes("Finance") ? [posting(3, "Finance Analyst Intern"), posting(1, "Data Analyst Intern")] : [posting(1, "Data Analyst Intern"), posting(2, "Data Analyst Intern II")] });
      return new Response("not found", { status: 404 });
    });
    const first = await listRecommendedJobs(userId);
    // The first list a student sees isn't marked new.
    expect(first.jobs.every((job) => !job.isNew)).toBe(true);
    expect(first.newCount).toBe(0);
    const again = await listRecommendedJobs(userId, { refresh: true });
    // The refresh searched the student's next role, and its new job comes first.
    expect(asked.some((url) => url.includes("search=Finance"))).toBe(true);
    expect(again.jobs[0]).toMatchObject({ title: "Finance Analyst Intern", isNew: true });
    expect(again.newCount).toBe(1);
    await dismissRecommendedJob(userId, { jobId: again.jobs[0].id });
    const later = await listRecommendedJobs(userId);
    expect(later.jobs.map((job) => job.title)).not.toContain("Finance Analyst Intern");
  });

  it("recommends jobs from dream company boards with posted dates", async () => {
    const userId = await verifiedStudent("jobs@colby.edu", "Jobseeker");
    await expect(listRecommendedJobs(userId)).rejects.toThrow(/Add your resume first/);
    await saveStructuredProfile(userId, form, "Jobseeker");
    const urls: string[] = [];
    setJobFetcherForTests(async (url) => {
      urls.push(url);
      if (url.includes("boards-api.greenhouse.io/v1/boards/patagonia/")) {
        return Response.json({ jobs: [
          { id: 1, title: "Brand Marketing Intern", location: { name: "Boston, MA" }, first_published: new Date(Date.now() - 2 * 86400000).toISOString(), absolute_url: "https://boards.greenhouse.io/patagonia/jobs/1", content: "&lt;p&gt;Support campaigns&lt;/p&gt;" },
          { id: 2, title: "Director of Brand", location: { name: "Boston, MA" }, first_published: new Date().toISOString(), absolute_url: "https://boards.greenhouse.io/patagonia/jobs/2", content: "" },
        ] });
      }
      return new Response("not found", { status: 404 });
    });
    const result = await listRecommendedJobs(userId);
    expect(urls.some((url) => url.includes("greenhouse.io/v1/boards/patagonia/"))).toBe(true);
    expect(urls.some((url) => url.includes("linkedin.com"))).toBe(false);
    expect(result.jobs.map((job) => job.title)).toEqual(["Brand Marketing Intern"]);
    expect(result.jobs[0]).toMatchObject({ company: "Patagonia", postedKind: "posted", sourceLabel: "Company careers page" });
    expect(result.jobs[0].postedAt).toBeTruthy();
    expect(result.searchedCompanies[0]).toBe("Patagonia");
  });

  it("refuses a cover letter without a job or without a key", async () => {
    const userId = await verifiedStudent("letter@colby.edu", "Letterer");
    await saveStructuredProfile(userId, { ...form, accomplishments: "Ran a campus store" }, "Letterer");
    await expect(generateWorkspaceCoverLetter(userId, { job: { title: "", company: "REI" } })).rejects.toThrow(/job title and company/);
    await expect(generateWorkspaceCoverLetter(userId, { job: { title: "Intern", company: "REI", description: "Retail" } })).rejects.toThrow(/Upload a resume or pick a few highlights/);
    const document = await repo.getProfileDocument(userId);
    await repo.upsertProfileDocument({ ...document!, highlights: [{ id: "hl_store", label: "Campus store founder", detail: "Ran a campus store.", category: "leadership", experienceDetails: null }] });
    await expect(generateWorkspaceCoverLetter(userId, { job: { title: "Intern", company: "REI", description: "Retail" }, studentFactIds: ["hl_store"] })).rejects.toThrow(/not configured/);
    expect(await repo.listGenerations(userId)).toHaveLength(0);
  });

  it("recognizes company pages and shared inboxes", () => {
    expect(looksLikePerson("Field", "Startup", "Field Startup")).toBe(false);
    expect(looksLikePerson("Patagonia", "Careers", "Patagonia")).toBe(false);
    expect(looksLikePerson("Jordan", "Lee", "REI")).toBe(true);
    expect(looksLikePerson("Jordan", "", "REI")).toBe(false);
    expect(isPersonalWorkEmail("jordan.lee@rei.com")).toBe(true);
    expect(isPersonalWorkEmail("careers@rei.com")).toBe(false);
    expect(isPersonalWorkEmail("no-reply@rei.com")).toBe(false);
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

});
