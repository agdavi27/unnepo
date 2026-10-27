import { createHash } from "node:crypto";
import { id, nowIso, repo } from "@/lib/db/file-store";
import type { ManualEmailDraft, PeopleSearchRequest, ProfileDocument } from "@/lib/db/types";
import { creditsForPeople, prepareSearchDebit, prepareUnlockDebit } from "@/lib/credits/quote";
import { integrations } from "@/lib/integrations/flags";
import { profileIntelligence, type FormProfile } from "@/lib/profile/intelligence";
import { ServiceError } from "@/lib/errors";

function asForm(value: unknown): FormProfile {
  const body = (value ?? {}) as Partial<FormProfile>;
  const list = (input: unknown) => (Array.isArray(input) ? input.map((item) => String(item).slice(0, 80)).filter(Boolean).slice(0, 40) : []);
  const text = (input: unknown, max = 2000) => String(input ?? "").slice(0, max);
  return {
    school: text(body.school, 160),
    major: text(body.major, 160),
    graduationYear: text(body.graduationYear, 8),
    interests: list(body.interests),
    otherInterests: text(body.otherInterests, 500),
    targetRoles: text(body.targetRoles),
    dreamCompanies: text(body.dreamCompanies),
    locations: text(body.locations, 500),
    workPreference: text(body.workPreference, 40) || "either",
    goals: list(body.goals),
    contactTypes: list(body.contactTypes),
    seniority: text(body.seniority, 40) || "balanced",
    bio: text(body.bio),
    accomplishments: text(body.accomplishments),
    excludedTopics: text(body.excludedTopics),
    emailTone: text(body.emailTone, 40) || "friendly",
  };
}

export async function saveStructuredProfile(userId: string, raw: unknown, name: string) {
  const form = asForm(raw);
  const [facts, resume] = await Promise.all([repo.getFacts(userId), repo.getLatestResume(userId)]);
  const organized = profileIntelligence.organize({ profile: form, resumeFacts: facts });
  const document: ProfileDocument = {
    userId,
    form,
    facts: organized.facts,
    inconsistencies: organized.inconsistencies,
    resumeId: resume?.id ?? null,
    ready: true,
    updatedAt: nowIso(),
  };
  await repo.upsertProfileDocument(document);
  await repo.upsertProfile({
    userId,
    name,
    school: form.school,
    major: form.major,
    graduationYear: form.graduationYear,
    bio: form.bio.slice(0, 300),
    avatarPath: null,
    updatedAt: nowIso(),
  });
  const currentGoals = await repo.getGoals(userId);
  await repo.upsertGoals({
    userId,
    roles: form.targetRoles ? [form.targetRoles] : [],
    industries: form.interests,
    locations: form.locations ? [form.locations] : [],
    companies: form.dreamCompanies ? [form.dreamCompanies] : [],
    tracks: currentGoals?.tracks ?? [],
    timing: currentGoals?.timing ?? "",
    workModes: [form.workPreference],
    relocate: currentGoals?.relocate ?? false,
    contactTypes: form.contactTypes,
    networkingGoals: form.goals,
    extraNote: form.excludedTopics,
    originStory: form.bio,
    updatedAt: nowIso(),
  });
  await repo.updateUser(userId, { onboardingStep: "done" });
  return document;
}

/** Clears the structured profile only. Contacts, credits, and resumes stay. */
export async function resetStructuredProfile(userId: string) {
  await repo.deleteProfileDocument(userId);
  await repo.updateUser(userId, { onboardingStep: "profile" });
}

export async function recordPeopleSearch(userId: string, raw: unknown) {
  if (integrations.apollo) {
    throw new ServiceError("Apollo is flagged on, but the live search adapter is not activated.", "disabled", 409);
  }
  const body = (raw ?? {}) as { mode?: string; quantity?: number; prompt?: string; filters?: Record<string, unknown> };
  const quantity = Number(body.quantity);
  let creditsQuoted = 0;
  try {
    creditsQuoted = creditsForPeople(quantity);
  } catch (error) {
    throw new ServiceError(error instanceof Error ? error.message : "Invalid quantity.", "quantity", 400);
  }
  const mode = body.mode === "custom" ? "custom" : "automatic";
  const filters = body.filters && typeof body.filters === "object" ? body.filters : {};
  const prompt = String(body.prompt ?? "").slice(0, 2000);
  const idempotencyKey = `search:${userId}:${createHash("sha256").update(JSON.stringify({ mode, quantity, prompt, filters })).digest("hex").slice(0, 24)}`;
  const request: PeopleSearchRequest = {
    id: id(),
    userId,
    mode,
    quantity,
    creditsQuoted,
    prompt,
    filters,
    status: "not_connected",
    resultCount: 0,
    creditsCharged: 0,
    idempotencyKey,
    createdAt: nowIso(),
  };
  const saved = await repo.insertSearchRequest(request);
  const quote = prepareSearchDebit(userId, saved.id, quantity);
  return {
    request: saved,
    people: [] as [],
    charged: 0,
    quote,
    status: "not_connected" as const,
    message: "People search is not connected yet. No credits were used.",
  };
}

export async function saveManualEmailDraft(userId: string, raw: unknown) {
  const body = (raw ?? {}) as Partial<ManualEmailDraft> & { contactId?: string };
  const contactId = String(body.contactId || "").slice(0, 120);
  if (!contactId) throw new ServiceError("Choose a saved contact before saving a draft.", "contact", 400);
  const savedRows = await repo.listSaved(userId);
  if (!savedRows.some((row) => row.contactId === contactId)) {
    throw new ServiceError("That contact is not in your saved list.", "not_found", 404);
  }
  const document = await repo.getProfileDocument(userId);
  const allowed = new Set((document?.facts ?? []).filter((fact) => fact.approvalStatus === "approved").map((fact) => fact.id));
  const studentFactIds = (Array.isArray(body.studentFactIds) ? body.studentFactIds : []).map(String).filter((factId) => allowed.has(factId));
  const draft: ManualEmailDraft = {
    id: id(),
    userId,
    contactId,
    subject: String(body.subject ?? "").slice(0, 200),
    body: String(body.body ?? "").slice(0, 8000),
    studentFactIds,
    contactFactIds: (Array.isArray(body.contactFactIds) ? body.contactFactIds : []).map(String).slice(0, 20),
    goal: String(body.goal ?? "").slice(0, 40),
    tone: String(body.tone ?? "").slice(0, 40),
    length: String(body.length ?? "").slice(0, 40),
    notes: String(body.notes ?? "").slice(0, 2000),
    status: "saved",
    createdAt: nowIso(),
  };
  if (!draft.subject.trim() && !draft.body.trim()) throw new ServiceError("Write a subject or body before saving.", "draft", 400);
  return repo.insertManualDraft(draft);
}

export function emailUnlockQuote(userId: string, contactId: string) {
  return { quote: prepareUnlockDebit(userId, contactId), charged: 0, status: "not_connected" as const };
}

export async function workspaceState(userId: string) {
  const [document, credits, resume, saved, searches, drafts] = await Promise.all([
    repo.getProfileDocument(userId),
    repo.getAccount(userId),
    repo.getLatestResume(userId),
    repo.listSavedDetailed(userId),
    repo.listSearchRequests(userId),
    repo.listManualDrafts(userId),
  ]);
  const studentFacts = document ? profileIntelligence.approvedForOutreach(document.facts, document.form.excludedTopics) : [];
  const contacts = saved.flatMap(({ saved: row, contact }) => {
    if (!contact) return [];
    const verifiedFacts = [
      contact.title ? { id: `${contact.id}:title`, text: contact.title, verified: contact.dataSource === "provider" } : null,
      contact.company ? { id: `${contact.id}:company`, text: `Works at ${contact.company}`, verified: contact.dataSource === "provider" } : null,
      contact.location ? { id: `${contact.id}:location`, text: contact.location, verified: contact.dataSource === "provider" } : null,
      contact.school ? { id: `${contact.id}:school`, text: `Attended ${contact.school}`, verified: contact.dataSource === "provider" } : null,
    ].filter((fact): fact is { id: string; text: string; verified: boolean } => Boolean(fact));
    return [{
      id: contact.id,
      name: contact.fullName,
      title: contact.title,
      company: contact.company,
      email: row.creditCharged && contact.email ? contact.email : undefined,
      facts: verifiedFacts,
    }];
  });
  return {
    credits: { balance: credits?.balance ?? 0 },
    profile: document,
    studentFacts,
    resume: resume ? { id: resume.id, fileName: resume.fileName, byteSize: resume.byteSize } : null,
    contacts,
    searches: searches.slice(0, 10),
    drafts: drafts.slice(0, 20),
    integrations: {
      apollo: integrations.apollo,
      anthropic: integrations.anthropic,
      stripeBilling: integrations.stripeBilling,
      gmail: integrations.gmail,
      outlook: integrations.outlook,
    },
  };
}
