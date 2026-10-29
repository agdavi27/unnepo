import { createHash } from "node:crypto";
import { readAnthropicKey, id, nowIso, repo } from "@/lib/db/file-store";
import type { ProfileDocument } from "@/lib/db/types";
import { serverConfig } from "@/lib/config";
import { brandsForInterests } from "@/lib/suggestions";
import { SOURCE_LABEL, recommendJobs } from "@/lib/jobs/recommend";
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

function uniqueList(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function profileInputs(userId: string) {
  const [document, goals] = await Promise.all([repo.getProfileDocument(userId), repo.getGoals(userId)]);
  const form = document?.form;
  const roles = uniqueList([...(goals?.roles ?? []).flatMap((entry) => splitProfileList(entry)), ...splitProfileList(form?.targetRoles ?? "")]).slice(0, 8);
  const companies = uniqueList([...(goals?.companies ?? []).flatMap((entry) => splitProfileList(entry)), ...splitProfileList(form?.dreamCompanies ?? "")]).slice(0, 15);
  const remote = form?.workPreference === "remote";
  const locations = remote
    ? []
    : uniqueList(splitLocations(form?.locations ?? "").map((entry) => parseLocation(entry).place).filter((place) => !/^(remote|anywhere)/i.test(place))).slice(0, 6);
  return { roles, companies, locations };
}

/** Jobs from public job feeds, ranked against the student's roles, companies, cities, and interests. */
export async function listRecommendedJobs(userId: string, { refresh = false } = {}) {
  const document = await repo.getProfileDocument(userId);
  if (!document?.ready) throw new ServiceError("Save your profile first so jobs can match your interests.", "profile", 400);
  const me = await profileInputs(userId);
  const interests = document.form.interests;
  const suggestedCompanies = brandsForInterests(interests, me.companies, 8);
  const companies = uniqueList([...me.companies, ...suggestedCompanies]).slice(0, 12);
  const prefs = { roles: me.roles, companies: me.companies, suggestedCompanies, locations: me.locations, interests, remoteOk: document.form.workPreference !== "onsite" };
  const key = `${userId}:${createHash("sha256").update(JSON.stringify(prefs)).digest("hex").slice(0, 16)}`;
  const result = await recommendJobs(key, prefs, { refresh });
  return {
    jobs: result.jobs.map((job) => ({ ...job, sourceLabel: SOURCE_LABEL[job.source] })),
    cachedAt: result.cachedAt,
    searchedCompanies: companies,
  };
}

const LETTER_TONES: Record<string, string> = {
  professional: "professional and polished",
  friendly: "warm and personable",
  confident: "confident and direct",
  enthusiastic: "enthusiastic but grounded",
};
const LETTER_LENGTHS: Record<string, string> = { short: "about 200 words", standard: "about 300 words", detailed: "about 400 words" };

const COVER_LETTER_PROMPT =
  "You write cover letters for college students applying to jobs and internships. Use only facts from the student's highlights and resume; never invent jobs, schools, skills, numbers, or achievements. Connect two or three of the student's real experiences to specific requirements in the job description. Do not copy sentences from the job description. Do not mention anything the student asked to avoid. Write plain text: a greeting, three or four short paragraphs, and a sign-off with the student's name. No placeholders in brackets. Return only JSON with the key body.";

/** Writes a cover letter for one job from the student's selected highlights and resume text. */
export async function generateWorkspaceCoverLetter(userId: string, raw: unknown) {
  if (!integrations.anthropic) throw new ServiceError("AI writing is not connected yet. You can still write the letter yourself.", "not_connected", 409);
  const body = (raw ?? {}) as Record<string, unknown>;
  const job = (body.job ?? {}) as Record<string, unknown>;
  const title = String(job.title ?? "").trim().slice(0, 200);
  const company = String(job.company ?? "").trim().slice(0, 200);
  const description = String(job.description ?? "").trim().slice(0, 6000);
  if (!title || !company) throw new ServiceError("Add the job title and company.", "job", 400);
  const ids = (value: unknown) => new Set((Array.isArray(value) ? value : []).map(String).slice(0, 40));
  const chosen = ids(body.studentFactIds);
  const withDetails = ids(body.detailFactIds);
  const tone = LETTER_TONES[String(body.tone)] ? String(body.tone) : "professional";
  const length = LETTER_LENGTHS[String(body.length)] ? String(body.length) : "standard";
  const notes = String(body.notes ?? "").slice(0, 1000);

  const config = serverConfig();
  const [hourly, daily] = await Promise.all([
    repo.listGenerations(userId, new Date(Date.now() - 60 * 60 * 1000).toISOString()),
    repo.listGenerations(userId, new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
  ]);
  if (hourly.length >= config.aiHourlyLimit || daily.length >= config.aiDailyLimit) {
    throw new ServiceError("AI writing limit reached for now. Try again later.", "ai_limit", 429);
  }
  const [document, resume, user] = await Promise.all([repo.getProfileDocument(userId), repo.getLatestResume(userId), repo.getUserById(userId)]);
  const highlights = (document?.highlights ?? []).filter((item) => chosen.has(item.id));
  const resumeText = (resume?.text ?? "").trim().slice(0, 5000);
  if (!highlights.length && !resumeText && !document?.organizedProfile) {
    throw new ServiceError("Upload a resume or pick a few highlights so the letter has real experience to draw on.", "profile", 400);
  }
  const apiKey = await readAnthropicKey();
  if (!apiKey) throw new ServiceError("AI writing is not configured.", "not_configured", 503);

  const prompt = [
    `Student name: ${user?.name || "Student"}`,
    `Job: ${title} at ${company}`,
    `Tone: ${LETTER_TONES[tone]}`,
    `Length: ${LETTER_LENGTHS[length]}`,
    `Job description:\n${description || "(not provided)"}`,
    `Highlights the student wants to feature:\n${highlights.map((item) => `- ${item.detail}${withDetails.has(item.id) && item.experienceDetails ? ` Details: ${item.experienceDetails}` : ""}`).join("\n") || "- (none picked; choose from the resume)"}`,
    resumeText ? `Resume:\n${resumeText}` : document?.organizedProfile ? `Profile:\n${JSON.stringify(document.organizedProfile).slice(0, 5000)}` : "",
    document?.form.excludedTopics.trim() ? `Topics not to mention: ${document.form.excludedTopics.trim()}` : "",
    notes ? `Extra notes from the student: ${notes}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const model = process.env.ANTHROPIC_FAST_MODEL || "claude-haiku-4-5";
  const started = Date.now();
  let letter = "";
  let inputTokens = 0;
  let outputTokens = 0;
  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model,
      max_tokens: 2000,
      system: [{ type: "text", text: COVER_LETTER_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: prompt }],
    });
    if (response.stop_reason === "refusal") throw new Error("refusal");
    letter = parseEmailJson(response.content.map((block) => (block.type === "text" ? block.text : "")).join("\n")).body;
    inputTokens = response.usage?.input_tokens ?? 0;
    outputTokens = response.usage?.output_tokens ?? 0;
    if (!letter) throw new Error("empty_letter");
  } catch (error) {
    await repo.insertUsage({
      id: id(), userId, provider: "anthropic", operation: "cover_letter", success: false, latencyMs: Date.now() - started, costCents: 0, estimated: true,
      error: error instanceof Error ? error.message : "anthropic_failed", createdAt: nowIso(),
    });
    throw new ServiceError("The AI could not write this letter right now. Try again in a moment.", "provider_failed", 502);
  }
  const costCents = (inputTokens * config.fastInputCentsPerMillion + outputTokens * config.fastOutputCentsPerMillion) / 1_000_000;
  await repo.insertUsage({ id: id(), userId, provider: "anthropic", operation: "cover_letter", success: true, latencyMs: Date.now() - started, costCents, estimated: true, error: null, createdAt: nowIso() });
  await repo.insertGeneration({ id: id(), userId, purpose: "cover_letter", model, inputTokens, outputTokens, costCents, estimated: true, createdAt: nowIso() });
  return { body: letter.slice(0, 8000) };
}

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

export async function workspaceState(userId: string) {
  const [user, document, credits, resume] = await Promise.all([
    repo.getUserById(userId),
    repo.getProfileDocument(userId),
    repo.getAccount(userId),
    repo.getLatestResume(userId),
  ]);
  const studentFacts = document ? profileIntelligence.approvedForOutreach(document.facts, document.form.excludedTopics) : [];
  return {
    user: { name: user?.name ?? "", email: user?.email ?? "" },
    credits: { balance: credits?.balance ?? 0, plan: credits?.plan ?? "free", includedAllowance: credits?.includedAllowance ?? 0 },
    profile: document,
    studentFacts,
    highlights: document?.highlights ?? [],
    resume: resume ? { id: resume.id, fileName: resume.fileName, byteSize: resume.byteSize } : null,
    integrations: { apollo: integrations.apollo, anthropic: integrations.anthropic, stripeBilling: integrations.stripeBilling },
  };
}
