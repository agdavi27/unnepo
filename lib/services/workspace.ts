import { createHash } from "node:crypto";
import { readAnthropicKey, id, nowIso, repo } from "@/lib/db/file-store";
import type { Contact, ManualEmailDraft, PeopleSearchRequest, ProfileDocument, SavedContact } from "@/lib/db/types";
import { serverConfig } from "@/lib/config";
import { PEOPLE_PER_CREDIT, creditsForPeople, prepareSearchDebit, prepareUnlockDebit } from "@/lib/credits/quote";
import { enrichPeopleBatch, enrichPerson, searchPeople } from "@/lib/providers/contacts/router";
import { emptyFilters, filtersFromProfile, interpretPrompt } from "@/lib/search/interpret";
import { integrations } from "@/lib/integrations/flags";
import { profileIntelligence, type FormProfile } from "@/lib/profile/intelligence";
import { parseLocation, splitLocations, splitProfileList } from "@/lib/profile/lists";
import { highlightProfileWithModel, organizeQuizWithModel, quizSourceText } from "@/lib/profile/quiz-model";
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
  const apiKey = await readAnthropicKey();
  const model = await organizeQuizWithModel(userId, form, apiKey, resume?.text ?? "");
  const highlights = await highlightProfileWithModel(
    userId,
    model?.profile ? JSON.stringify(model.profile) : quizSourceText(form, resume?.text ?? ""),
    apiKey,
  );
  const document: ProfileDocument = {
    userId,
    form,
    facts: organized.facts,
    inconsistencies: organized.inconsistencies,
    resumeId: resume?.id ?? null,
    organizedProfile: model?.profile ?? null,
    highlights,
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
    roles: splitProfileList(form.targetRoles),
    industries: form.interests,
    locations: splitLocations(form.locations).map((entry) => parseLocation(entry).place),
    companies: splitProfileList(form.dreamCompanies),
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
  return { document, organization: model?.profile ? "anthropic" : "unavailable" as const };
}

/** Clears the structured profile only. Contacts, credits, and resumes stay. */
/** Builds highlights for a profile saved before they existed, or rebuilds them on request. */
export async function refreshProfileHighlights(userId: string) {
  const document = await repo.getProfileDocument(userId);
  if (!document?.ready) throw new ServiceError("Save your profile first.", "profile", 400);
  const resume = await repo.getLatestResume(userId);
  const highlights = await highlightProfileWithModel(
    userId,
    document.organizedProfile ? JSON.stringify(document.organizedProfile) : quizSourceText(document.form, resume?.text ?? ""),
    await readAnthropicKey(),
  );
  if (!highlights) throw new ServiceError("Highlights could not be built right now. Try again in a moment.", "provider_failed", 502);
  await repo.upsertProfileDocument({ ...document, highlights, updatedAt: nowIso() });
  return { highlights };
}

export async function resetStructuredProfile(userId: string) {
  await repo.deleteProfileDocument(userId);
  await repo.updateUser(userId, { onboardingStep: "profile" });
}

export async function recordPeopleSearch(userId: string, raw: unknown) {
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
  if (integrations.apollo) return runLivePeopleSearch(userId, { mode, quantity, creditsQuoted, prompt, filters });
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

/** Apollo returns at most 100 people per page. */
const APOLLO_PAGE_SIZE = 100;
const APOLLO_SENIORITY: Record<string, string> = {
  entry: "entry",
  associate: "senior",
  manager: "manager",
  director: "director",
  vp: "vp",
  founder: "founder",
};

function splitList(value: unknown) {
  return String(value ?? "")
    .split(/[,;\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function uniqueList(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function profileSearchFilters(userId: string) {
  const [document, goals] = await Promise.all([repo.getProfileDocument(userId), repo.getGoals(userId)]);
  const expanded = goals
    ? {
        ...goals,
        roles: goals.roles.flatMap((entry) => splitProfileList(entry)),
        companies: goals.companies.flatMap((entry) => splitProfileList(entry)),
        locations: goals.locations.flatMap(splitLocations).map((entry) => parseLocation(entry).place),
      }
    : null;
  return filtersFromProfile(expanded, document?.form.school || null, "").filters;
}

async function liveSearchFilters(userId: string, mode: "automatic" | "custom", prompt: string, raw: Record<string, unknown>) {
  if (mode === "automatic") return profileSearchFilters(userId);
  const text = prompt.trim();
  // Suggested searches say "my college" or "my interests", so they start from the saved profile.
  const filters = /\bmy\b/i.test(text) ? await profileSearchFilters(userId) : emptyFilters();
  const parsed = text ? interpretPrompt(text).filters : emptyFilters();
  const guessedTitle = /^find\b/i.test(text) ? [] : parsed.titles;
  filters.titles = uniqueList([...splitList(raw.title), ...guessedTitle, ...filters.titles]).slice(0, 6);
  filters.companies = uniqueList([...splitList(raw.company), ...parsed.companies, ...filters.companies]).slice(0, 6);
  filters.locations = uniqueList([...splitList(raw.location), ...parsed.locations, ...filters.locations]).slice(0, 6);
  filters.industries = uniqueList([...splitList(raw.industry), ...parsed.industries, ...filters.industries]).slice(0, 6);
  filters.schools = uniqueList([...splitList(raw.school), ...filters.schools]).slice(0, 3);
  const seniority = APOLLO_SENIORITY[String(raw.seniority ?? "")];
  if (seniority) filters.seniorities = [seniority];
  // A whole sentence is a poor keyword search, so it is only sent when nothing structured came out of it.
  const structured = filters.titles.length + filters.companies.length + filters.locations.length + filters.schools.length;
  filters.query = structured ? undefined : text.slice(0, 180) || undefined;
  return filters;
}

async function runLivePeopleSearch(
  userId: string,
  input: { mode: "automatic" | "custom"; quantity: number; creditsQuoted: number; prompt: string; filters: Record<string, unknown> },
) {
  const filters = await liveSearchFilters(userId, input.mode, input.prompt, input.filters);
  if (!filters.titles.length && !filters.companies.length && !filters.locations.length && !filters.schools.length && !filters.query) {
    throw new ServiceError(
      input.mode === "automatic"
        ? "Add target roles, dream companies, or locations to your profile so Find for Me knows who to look for. No credits were used."
        : "Describe who you're looking for or add a filter. No credits were used.",
      "empty_search",
      400,
    );
  }
  const account = await repo.getAccount(userId);
  const balance = account?.balance ?? 0;
  if (balance < input.creditsQuoted) {
    throw new ServiceError(
      `Up to ${input.quantity} people needs ${input.creditsQuoted} ${input.creditsQuoted === 1 ? "credit" : "credits"}. You have ${balance}. No credits were used.`,
      "insufficient_credits",
      402,
    );
  }
  const excludeSaved = input.filters.excludeSaved !== false;
  const excluded = new Set(excludeSaved ? (await repo.listSaved(userId)).map((row) => row.contactId) : []);
  const found: Contact[] = [];
  const maxPages = Math.ceil(input.quantity / APOLLO_PAGE_SIZE) + 2;
  for (let page = 1; page <= maxPages && found.length < input.quantity; page += 1) {
    const result = await searchPeople(userId, filters, page, APOLLO_PAGE_SIZE);
    if (result.source !== "apollo") {
      throw new ServiceError("Live people search is not available right now. No credits were used.", "provider_missing", 503);
    }
    for (const person of result.people) {
      if (!excluded.has(person.id) && !found.some((item) => item.id === person.id)) found.push(person);
    }
    if (result.people.length < APOLLO_PAGE_SIZE) break;
  }
  const people = found.slice(0, input.quantity);
  // Partial results are charged per started block of 25, never more than the quote.
  const creditsCharged = people.length ? Math.min(input.creditsQuoted, Math.ceil(people.length / PEOPLE_PER_CREDIT)) : 0;
  const requestId = id();
  const idempotencyKey = `search:${userId}:${requestId}`;
  let charged = 0;
  if (creditsCharged) {
    const spend = await repo.spendCredits({
      userId,
      amount: creditsCharged,
      idempotencyKey,
      note: `${people.length} people found`,
      entryType: "search_debit",
    });
    if (spend.insufficient) {
      throw new ServiceError("Your credit balance changed during the search. No credits were used.", "insufficient_credits", 402);
    }
    charged = spend.charged;
  }
  // Credits pay for the people. Their verified work emails come with them at no extra credit.
  const emails = await enrichPeopleBatch(people, userId);
  if (emails.size) {
    await repo.upsertContacts(
      people.map((person) => {
        const found = emails.get(person.id);
        return found ? { ...person, email: found.email, emailStatus: found.emailStatus, fetchedAt: nowIso() } : person;
      }),
    );
  }
  const withEmail = people.filter((person) => emails.get(person.id)?.email).length;
  await repo.saveFoundContacts(userId, people.map((person) => person.id));
  const request: PeopleSearchRequest = {
    id: requestId,
    userId,
    mode: input.mode,
    quantity: input.quantity,
    creditsQuoted: input.creditsQuoted,
    prompt: input.prompt,
    filters: input.filters,
    status: "completed",
    resultCount: people.length,
    contactIds: people.map((person) => person.id),
    creditsCharged: charged,
    idempotencyKey,
    createdAt: nowIso(),
  };
  await repo.insertSearchRequest(request);
  await repo.insertAnalytics({ userId, name: "search", properties: { source: "apollo", count: people.length, mode: input.mode } });
  return {
    request,
    people: people.map((person) => ({ id: person.id, name: person.fullName, title: person.title, company: person.company })),
    charged,
    status: "completed" as const,
    message: people.length
      ? `Found ${people.length} ${people.length === 1 ? "person" : "people"} (${withEmail} with a verified work email) and added them to My Contacts. ${charged} ${charged === 1 ? "credit was" : "credits were"} used.`
      : "Apollo found no new people for that search. No credits were used.",
  };
}

/** Retries the email lookup for one saved contact. It never costs credits. */
export async function unlockWorkspaceEmail(userId: string, raw: unknown) {
  const contactId = String((raw as { contactId?: unknown } | null)?.contactId ?? "").slice(0, 120);
  if (!integrations.apollo) {
    return { ok: false, code: "not_connected", charged: 0, email: null, message: "Email lookup is not connected yet." };
  }
  const saved = await repo.getSavedByUserAndContact(userId, contactId);
  const contact = saved ? await repo.getContact(contactId) : null;
  if (!saved || !contact) throw new ServiceError("That contact is not in your saved list.", "not_found", 404);
  if (contact.email && contact.emailStatus === "verified") {
    return { ok: true, code: "already", charged: 0, email: contact.email, message: "This contact already has a verified email." };
  }
  const enriched = await enrichPerson(contact, userId);
  if (!enriched.ok || !enriched.email || enriched.emailStatus !== "verified") {
    return { ok: false, code: "no_verified_email", charged: 0, email: null, message: "Apollo still has no verified work email for this person. No credits were used." };
  }
  await repo.upsertContacts([{ ...contact, email: enriched.email, emailStatus: "verified", fetchedAt: nowIso() }]);
  return { ok: true, code: "found", charged: 0, email: enriched.email, message: "Found a verified work email. No credits were used." };
}

const CONTACT_STATUSES = new Set<SavedContact["status"]>(["not_contacted", "contacted", "follow_up_needed", "replied", "interested", "interview_scheduled", "closed"]);

/** Students mark outreach themselves while sending is not connected. */
export async function updateWorkspaceContact(userId: string, raw: unknown) {
  const body = (raw ?? {}) as { contactId?: unknown; status?: unknown };
  const contactId = String(body.contactId ?? "").slice(0, 120);
  const status = String(body.status ?? "") as SavedContact["status"];
  if (!CONTACT_STATUSES.has(status)) throw new ServiceError("Choose a valid status.", "status", 400);
  const saved = await repo.getSavedByUserAndContact(userId, contactId);
  if (!saved) throw new ServiceError("That contact is not in your saved list.", "not_found", 404);
  const updated = await repo.updateSaved(userId, saved.id, { status });
  return { contactId, status: updated?.status ?? status };
}

export async function deleteWorkspaceContacts(userId: string, raw: unknown) {
  const list = (raw as { contactIds?: unknown } | null)?.contactIds;
  const contactIds = (Array.isArray(list) ? list : []).map((item) => String(item).slice(0, 120)).filter(Boolean).slice(0, 500);
  if (!contactIds.length) throw new ServiceError("Choose at least one contact to delete.", "contacts", 400);
  const removed = await repo.deleteSaved(userId, contactIds);
  return { removed, message: `Deleted ${removed} ${removed === 1 ? "contact" : "contacts"} from My Contacts.` };
}

const EMAIL_GOALS: Record<string, string> = {
  chat: "ask for a quick 15-minute conversation",
  advice: "ask for career advice",
  referral: "ask whether they would be open to a referral or introduction",
  opportunity: "ask about opportunities on their team",
  mentor: "ask whether they would be open to mentorship",
  other: "introduce yourself and start a conversation",
};
const EMAIL_TONES: Record<string, string> = {
  friendly: "friendly and conversational",
  professional: "professional and polished",
  direct: "short and direct",
  casual: "casual and personable",
};
const EMAIL_LENGTHS: Record<string, string> = {
  "very-short": "under 60 words",
  short: "under 100 words",
  detailed: "under 160 words",
};

const EMAIL_SYSTEM_PROMPT =
  "You write cold outreach emails from a college student to a professional. Use only the facts provided. Facts about the student describe the sender; facts about the recipient describe the person receiving the email. Never attribute the student's school, jobs, or interests to the recipient. Do not invent posts, mutual connections, employers, achievements, or shared experiences. Do not mention any topic the student asked to avoid. Write the body as plain text with a greeting, the message, and a sign-off with the student's name. Return only JSON with the keys subject and body.";

function parseEmailJson(text: string) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { subject: "", body: "" };
  try {
    const value = JSON.parse(match[0]) as { subject?: unknown; body?: unknown };
    return { subject: String(value.subject ?? "").trim(), body: String(value.body ?? "").trim() };
  } catch {
    return { subject: "", body: "" };
  }
}

export async function generateWorkspaceEmail(userId: string, raw: unknown) {
  if (!integrations.anthropic) {
    throw new ServiceError("AI email generation is not connected yet. Use Write it yourself, then save the draft.", "not_connected", 409);
  }
  const body = (raw ?? {}) as Record<string, unknown>;
  const contactId = String(body.contactId ?? "").slice(0, 120);
  const ids = (value: unknown) => new Set((Array.isArray(value) ? value : []).map(String).slice(0, 40));
  const studentIds = ids(body.studentFactIds);
  const detailIds = ids(body.detailFactIds);
  const contactIds = ids(body.contactFactIds);
  const goal = EMAIL_GOALS[String(body.goal)] ? String(body.goal) : "chat";
  const tone = EMAIL_TONES[String(body.tone)] ? String(body.tone) : "friendly";
  const length = EMAIL_LENGTHS[String(body.length)] ? String(body.length) : "short";
  const notes = String(body.notes ?? "").slice(0, 1000);

  const config = serverConfig();
  const [hourly, daily] = await Promise.all([
    repo.listGenerations(userId, new Date(Date.now() - 60 * 60 * 1000).toISOString()),
    repo.listGenerations(userId, new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
  ]);
  if (hourly.length >= config.aiHourlyLimit || daily.length >= config.aiDailyLimit) {
    throw new ServiceError("AI email limit reached for now. You can still write the email yourself and save the draft.", "ai_limit", 429);
  }

  const state = await workspaceState(userId);
  const contact = state.contacts.find((item) => item.id === contactId);
  if (!contact) throw new ServiceError("That contact is not in your saved list.", "not_found", 404);
  const studentFacts = [
    ...state.highlights
      .filter((item) => studentIds.has(item.id))
      .map((item) => ({ text: detailIds.has(item.id) && item.experienceDetails ? `${item.detail} Details: ${item.experienceDetails}` : item.detail })),
    ...state.studentFacts.filter((fact) => studentIds.has(fact.id)).map((fact) => ({ text: fact.text })),
  ];
  const contactFacts = contact.facts.filter((fact) => fact.verified && contactIds.has(fact.id));
  const user = await repo.getUserById(userId);
  const excluded = state.profile?.form.excludedTopics.trim();
  const apiKey = await readAnthropicKey();
  if (!apiKey) throw new ServiceError("AI email generation is not configured. Use Write it yourself, then save the draft.", "not_configured", 503);

  const prompt = [
    `Student name: ${user?.name || "Student"}`,
    `Recipient: ${contact.name}, ${contact.title}${contact.company ? ` at ${contact.company}` : ""}`,
    `Goal: ${EMAIL_GOALS[goal]}`,
    `Tone: ${EMAIL_TONES[tone]}`,
    `Length: body ${EMAIL_LENGTHS[length]}`,
    `Facts about the student:\n${studentFacts.map((fact) => `- ${fact.text}`).join("\n") || "- (none selected)"}`,
    `Facts about the recipient:\n${contactFacts.map((fact) => `- ${fact.text}`).join("\n") || "- (none selected beyond name, title, and company)"}`,
    excluded ? `Topics the student asked not to mention: ${excluded}` : "",
    notes ? `Extra notes from the student: ${notes}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const model = process.env.ANTHROPIC_FAST_MODEL || "claude-haiku-4-5";
  const started = Date.now();
  let subject = "";
  let text = "";
  let inputTokens = 0;
  let outputTokens = 0;
  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model,
      max_tokens: 1000,
      system: [{ type: "text", text: EMAIL_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: prompt }],
    });
    if (response.stop_reason === "refusal") throw new Error("refusal");
    const parsed = parseEmailJson(response.content.map((block) => (block.type === "text" ? block.text : "")).join("\n"));
    subject = parsed.subject;
    text = parsed.body;
    inputTokens = response.usage?.input_tokens ?? 0;
    outputTokens = response.usage?.output_tokens ?? 0;
    if (!text) throw new Error("empty_email");
  } catch (error) {
    await repo.insertUsage({
      id: id(),
      userId,
      provider: "anthropic",
      operation: "email",
      success: false,
      latencyMs: Date.now() - started,
      costCents: 0,
      estimated: true,
      error: error instanceof Error ? error.message : "anthropic_failed",
      createdAt: nowIso(),
    });
    throw new ServiceError("The AI could not write this email right now. Try again, or write it yourself and save the draft.", "provider_failed", 502);
  }
  const costCents = (inputTokens * config.fastInputCentsPerMillion + outputTokens * config.fastOutputCentsPerMillion) / 1_000_000;
  await repo.insertUsage({
    id: id(),
    userId,
    provider: "anthropic",
    operation: "email",
    success: true,
    latencyMs: Date.now() - started,
    costCents,
    estimated: true,
    error: null,
    createdAt: nowIso(),
  });
  await repo.insertGeneration({ id: id(), userId, purpose: "email", model, inputTokens, outputTokens, costCents, estimated: true, createdAt: nowIso() });
  return { subject: subject.slice(0, 200), body: text.slice(0, 8000) };
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
  const allowed = new Set([
    ...(document?.facts ?? []).filter((fact) => fact.approvalStatus === "approved").map((fact) => fact.id),
    ...(document?.highlights ?? []).map((item) => item.id),
  ]);
  const studentFactIds = (Array.isArray(body.studentFactIds) ? body.studentFactIds : []).map(String).filter((factId) => allowed.has(factId));
  const detailFactIds = (Array.isArray(body.detailFactIds) ? body.detailFactIds : []).map(String).filter((factId) => studentFactIds.includes(factId));
  const draft: ManualEmailDraft = {
    id: id(),
    userId,
    contactId,
    subject: String(body.subject ?? "").slice(0, 200),
    body: String(body.body ?? "").slice(0, 8000),
    studentFactIds,
    detailFactIds,
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
  const [user, document, credits, resume, saved, searches, drafts] = await Promise.all([
    repo.getUserById(userId),
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
      email: contact.email && contact.emailStatus === "verified" ? contact.email : undefined,
      status: row.status,
      foundAt: row.unlockedAt,
      facts: verifiedFacts,
    }];
  });
  return {
    user: { name: user?.name ?? "", email: user?.email ?? "" },
    credits: { balance: credits?.balance ?? 0, plan: credits?.plan ?? "free", includedAllowance: credits?.includedAllowance ?? 0 },
    profile: document,
    studentFacts,
    highlights: document?.highlights ?? [],
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
