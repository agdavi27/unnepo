import { createHash } from "node:crypto";
import { readAnthropicKey, id, nowIso, repo } from "@/lib/db/file-store";
import type { ProfileDocument } from "@/lib/db/types";
import { serverConfig } from "@/lib/config";
import { brandsForInterests } from "@/lib/suggestions";
import { INTEREST_WORDS, SOURCE_LABEL, recommendJobs, type JobSource } from "@/lib/jobs/recommend";
import { categoryOf } from "@/lib/jobs/category";
import { suggestRoles } from "@/lib/roles";
import { classYearOf } from "@/lib/profile/student";
import { integrations } from "@/lib/integrations/flags";
import { profileIntelligence, type FormProfile } from "@/lib/profile/intelligence";
import { parseLocation, splitLocations, splitProfileList } from "@/lib/profile/lists";
import { highlightProfileWithModel, organizeQuizWithModel, quizSourceText } from "@/lib/profile/quiz-model";
import { ServiceError } from "@/lib/errors";
import { applicationProfiles, applications } from "@/lib/apply/store";
import { LETTER_VOICE, letterModel, rewriteLetterPart } from "@/lib/apply/cover-letter";
import { assertUseAllowed, countUse } from "@/lib/apply/limits";
import { student } from "@/lib/apply/service";
import { assertCoverLetterAllowed, countCoverLetter, coverLettersLeft, hasUnlimitedCredits, planUsage } from "@/lib/apply/limits";
import { profileState, saveStudentProfile } from "@/lib/profile/service";

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

/** "Marketing Intern, Social Media" is "Marketing": the words of a past job title that say what the work was. */
function roleFromTitle(title: string) {
  return title.split(/\s[-–|,(]\s?|,|\(/)[0].replace(/\b(senior|sr\.?|junior|jr\.?|lead|head|intern(ship)?|assistant|associate|summer|student|part[- ]time|volunteer|i{1,3})\b/gi, " ").replace(/\s+/g, " ").trim();
}

/**
 * What jobs are matched against. Once the student has chosen on Edit careers & roles, exactly that. Before then,
 * what their profile and resume say: the roles they want and have done, their industries, city and dream companies.
 */
async function jobInputs(userId: string) {
  const [document, state] = await Promise.all([repo.getProfileDocument(userId), profileState(userId)]);
  const student = state.profile;
  const wanted = student.preferences;
  const majors = student.education.map((item) => item.major).filter(Boolean);
  const skills = uniqueList([...student.skills.technical, ...(student.projects ?? []).flatMap((project) => project.tech ?? [])]).slice(0, 25);
  if (wanted.setAt) {
    return { student, chosen: true, roles: wanted.roles, companies: wanted.companies ?? [], industries: wanted.industries, locations: wanted.locations, majors, skills, remote: wanted.remote };
  }
  const me = document?.ready ? await profileInputs(userId) : { roles: [], companies: [], locations: [] };
  const pastRoles = student.experience.map((job) => roleFromTitle(job.title)).filter((role) => role.length >= 3);
  return {
    student, chosen: false,
    roles: uniqueList([...wanted.roles, ...me.roles, ...pastRoles]).slice(0, 8),
    companies: uniqueList([...(wanted.companies ?? []), ...me.companies]).slice(0, 15),
    industries: uniqueList([...(document?.form.interests ?? []), ...wanted.industries]).slice(0, 8),
    locations: uniqueList([...wanted.locations, ...me.locations, student.contact.city ?? ""].filter((place) => place && !/^(remote|anywhere)/i.test(place))).slice(0, 6),
    majors, skills,
    remote: wanted.remote === "either" && document?.form.workPreference === "onsite" ? "no" as const : wanted.remote,
  };
}

/** What Edit careers & roles shows: what jobs match now, and roles to add from the student's resume. */
export async function jobPreferences(userId: string) {
  const { student, chosen, roles, companies, industries, locations, remote } = await jobInputs(userId);
  const resumeWords = [
    ...student.experience.flatMap((job) => [job.title, ...job.bullets]),
    ...(student.projects ?? []).flatMap((project) => [project.name, ...project.bullets, ...(project.tech ?? [])]),
    ...student.skills.technical,
    ...student.education.map((item) => item.major),
  ].filter(Boolean).join("\n");
  const { fromResume, similar } = suggestRoles([], resumeWords);
  const have = new Set(roles.map((role) => role.toLowerCase()));
  return {
    chosen, roles, companies, industries, locations, remote, jobType: student.preferences.jobType,
    suggestedRoles: uniqueList([...fromResume, ...similar]).filter((role) => !have.has(role.toLowerCase())).slice(0, 8),
    industryOptions: uniqueList([...industries, ...Object.keys(INTEREST_WORDS)]),
  };
}

/** Saves Edit careers & roles. From now on these are what jobs match against, and nothing else is added. */
export async function saveJobPreferences(userId: string, raw: unknown) {
  const body = (raw ?? {}) as Record<string, unknown>;
  const list = (value: unknown, max: number) => (Array.isArray(value) ? uniqueList(value.map((item) => String(item).replace(/\s+/g, " ").trim().slice(0, 80)).filter(Boolean)).slice(0, max) : []);
  const roles = list(body.roles, 10);
  if (!roles.length) throw new ServiceError("Add at least one role, so Unnepo knows what to look for.", "roles", 400);
  const { student } = await jobInputs(userId);
  const remote = body.remote === "yes" || body.remote === "no" ? body.remote : "either";
  const jobType = body.jobType === "internship" || body.jobType === "full_time" ? body.jobType : "either";
  await saveStudentProfile(userId, { profile: { preferences: { ...student.preferences, roles, companies: list(body.companies, 20), industries: list(body.industries, 10), locations: list(body.locations, 10), remote, jobType, setAt: nowIso() } } });
  return jobPreferences(userId);
}

/** "Save for later" on a job, or taking it back. The whole job is kept, since the list changes. */
export async function saveRecommendedJob(userId: string, raw: unknown) {
  const body = (raw ?? {}) as { job?: Record<string, unknown>; jobId?: unknown; saved?: unknown };
  const stored = await applicationProfiles.get(userId);
  if (!stored) throw new ServiceError("Finish your profile first.", "profile", 400);
  const feed = stored.jobFeed ?? { seen: {}, dismissed: [], round: 0 };
  const jobId = String(body.job?.id ?? body.jobId ?? "").trim().slice(0, 300);
  if (!jobId) throw new ServiceError("Say which job to save.", "job", 400);
  const others = (feed.saved ?? []).filter((job) => job.id !== jobId);
  if (body.saved === false) {
    await applicationProfiles.put(userId, { ...stored, jobFeed: { ...feed, saved: others } });
    return { ok: true };
  }
  const job = body.job ?? {};
  const text = (key: string, max: number) => String(job[key] ?? "").slice(0, max);
  const url = text("url", 2000);
  if (!/^https:\/\//i.test(url)) throw new ServiceError("That job has no link to save.", "job", 400);
  const entry = {
    id: jobId, title: text("title", 200), company: text("company", 200), location: text("location", 200), postedAt: text("postedAt", 40), postedKind: job.postedKind === "updated" ? "updated" as const : "posted" as const,
    url, source: text("source", 20), description: text("description", 6000), reasons: Array.isArray(job.reasons) ? job.reasons.map((reason) => String(reason).slice(0, 120)).slice(0, 8) : [], score: Math.max(0, Math.min(99, Number(job.score) || 0)), savedAt: nowIso(),
  };
  await applicationProfiles.put(userId, { ...stored, jobFeed: { ...feed, saved: [entry, ...others].slice(0, 100) } });
  return { ok: true };
}

/**
 * Jobs from public job feeds, ranked against the student's resume and profile: the roles they want and
 * have done (their past job titles), their skills, major, city, and dream companies.
 */
export async function listRecommendedJobs(userId: string, { refresh = false } = {}) {
  const { student, roles, companies: dreamCompanies, industries, locations, majors, skills, remote } = await jobInputs(userId);
  const interests = uniqueList([...industries, ...majors]).slice(0, 10);
  if (!roles.length && !interests.length && !skills.length) throw new ServiceError("Add your resume first so Unnepo can match jobs to it.", "profile", 400);
  const suggestedCompanies = brandsForInterests(interests, dreamCompanies, 32);
  const places = locations.filter((place) => !/^anywhere/i.test(place));
  const prefs = {
    roles, companies: dreamCompanies, suggestedCompanies, locations: places, interests, remoteOk: remote !== "no", remoteOnly: remote === "yes", skills,
    anywhere: places.length < locations.length, jobType: student.preferences.jobType, classYear: classYearOf(student.education[0]), needsSponsorship: student.workAuth.needsSponsorship === true,
  };
  const key = `${userId}:${createHash("sha256").update(JSON.stringify(prefs)).digest("hex").slice(0, 16)}`;
  const stored = await applicationProfiles.get(userId);
  const feed = stored?.jobFeed ?? { seen: {}, dismissed: [], round: 0 };
  const savedIds = new Set((feed.saved ?? []).map((job) => job.id));
  const round = refresh ? feed.round + 1 : feed.round;
  const result = await recommendJobs(key, prefs, { refresh, round });
  // Jobs the student hid or already applied to don't come back; ones they've never been shown go first.
  const applied = new Set((await applications.list(userId)).flatMap((app) => [jobKey(app.company, app.title), app.jobUrl]));
  const hidden = new Set(feed.dismissed);
  const now = nowIso();
  const stillOpen = (job: { id: string; company: string; title: string; url: string }) => !hidden.has(job.id) && !applied.has(jobKey(job.company, job.title)) && !applied.has(job.url);
  const jobs = [...result.jobs.filter((job) => !savedIds.has(job.id)), ...(feed.saved ?? []).map((job) => ({ ...job, source: job.source as JobSource }))]
    .filter(stillOpen)
    .map((job) => ({ ...job, sourceLabel: SOURCE_LABEL[job.source], category: categoryOf(job.title).name, saved: savedIds.has(job.id), isNew: !feed.seen[job.id] }))
    .sort((a, b) => b.score - a.score || (b.postedAt || "").localeCompare(a.postedAt || ""));
  // The first job list a student ever sees isn't "new": everything would be.
  const firstLook = !Object.keys(feed.seen).length;
  const seen = { ...feed.seen };
  for (const job of jobs) seen[job.id] ??= now;
  const day = Date.now() - 86_400_000;
  const newToday = Object.values(seen).filter((at) => Date.parse(at) > day).length;
  // Read again just before saving: the job search takes a while, and the profile may have changed meanwhile.
  const latest = await applicationProfiles.get(userId);
  if (latest) await applicationProfiles.put(userId, { ...latest, jobFeed: { seen: Object.fromEntries(Object.entries(seen).sort((a, b) => b[1].localeCompare(a[1])).slice(0, 800)), dismissed: latest.jobFeed?.dismissed ?? feed.dismissed, round, saved: latest.jobFeed?.saved ?? feed.saved } });
  const companies = uniqueList([...dreamCompanies, ...suggestedCompanies]).slice(0, 12);
  return {
    jobs: firstLook ? jobs.map((job) => ({ ...job, isNew: false })) : jobs,
    cachedAt: result.cachedAt,
    newCount: firstLook ? 0 : jobs.filter((job) => job.isNew).length,
    newToday: firstLook ? 0 : newToday,
    searchedCompanies: companies,
    matchedOn: { roles: roles.slice(0, 6), skills: skills.slice(0, 6) },
  };
}

const jobKey = (company: string, title: string) => `${company.trim().toLowerCase()}|${title.trim().toLowerCase()}`;

/** "Not for me": the job leaves the student's list for good. */
export async function dismissRecommendedJob(userId: string, raw: unknown) {
  const jobId = String((raw as { jobId?: unknown } | null)?.jobId ?? "").trim().slice(0, 300);
  if (!jobId) throw new ServiceError("Say which job to hide.", "job", 400);
  const stored = await applicationProfiles.get(userId);
  if (!stored) throw new ServiceError("Finish your profile first.", "profile", 400);
  const feed = stored.jobFeed ?? { seen: {}, dismissed: [], round: 0 };
  await applicationProfiles.put(userId, { ...stored, jobFeed: { ...feed, dismissed: [jobId, ...feed.dismissed.filter((item) => item !== jobId)].slice(0, 400) } });
  return { ok: true };
}

const LETTER_TONES: Record<string, string> = {
  professional: "professional and polished",
  friendly: "warm and personable",
  confident: "confident and direct",
  enthusiastic: "enthusiastic but grounded",
};
const LETTER_LENGTHS: Record<string, string> = { short: "about 200 words", standard: "about 300 words", detailed: "about 400 words" };

const COVER_LETTER_PROMPT = `You write cover letters for college students applying to jobs and internships.
${LETTER_VOICE}
- Lead with the highlights the student picked. Use the resume to fill in their details, not to add new topics.
- Never mention anything the student asked to avoid.

Shape: a greeting ("Dear Hiring Team," unless the posting names the person), three or four short paragraphs, and a sign-off with the student's full name. Follow the tone and length asked for. No placeholders in brackets.
Return only JSON with the key body.`;

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
  await assertCoverLetterAllowed(userId);

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
    `Today is ${new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}, for telling past roles from current ones.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const model = letterModel();
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
  await countCoverLetter(userId);
  // Writing a letter never adds the job: jobs come only from forwarded emails or the student adding one.
  return { body: letter.slice(0, 8000), addedToApplied: false };
}

/** The web app's "rewrite just this part" for a cover letter: the selected part, changed as asked, put back. */
export async function rewriteWorkspaceLetterPart(userId: string, raw: unknown) {
  const body = (raw ?? {}) as { letter?: unknown; part?: unknown; ask?: unknown; job?: { title?: unknown; company?: unknown; description?: unknown } };
  const letter = String(body.letter ?? "").slice(0, 8000);
  const part = String(body.part ?? "").slice(0, 2000);
  const ask = String(body.ask ?? "").trim().slice(0, 300);
  if (part.trim().length < 3 || !letter.includes(part)) throw new ServiceError("Select part of the letter first.", "part", 400);
  if (!ask) throw new ServiceError("Say how to change it.", "ask", 400);
  // A rewrite is an AI call like a chat answer, and costs the same.
  await assertUseAllowed(userId, "answers");
  const info = await student(userId);
  const job = `${String(body.job?.title ?? "")} at ${String(body.job?.company ?? "")}\n${String(body.job?.description ?? "").slice(0, 3000)}`;
  const rewritten = await rewriteLetterPart(userId, letter, part, ask, { job, student: { name: info.user.name, resumeText: info.resumeText, profile: info.profileText } });
  if (!rewritten) throw new ServiceError("Couldn't rewrite that part. Try again.", "part", 502);
  await countUse(userId, "answers");
  return { letter: rewritten };
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
  const [user, document, credits, resume, student] = await Promise.all([
    repo.getUserById(userId),
    repo.getProfileDocument(userId),
    repo.getAccount(userId),
    repo.getLatestResume(userId),
    profileState(userId),
  ]);
  const studentFacts = document ? profileIntelligence.approvedForOutreach(document.facts, document.form.excludedTopics) : [];
  return {
    user: { name: user?.name ?? "", email: user?.email ?? "" },
    credits: { balance: credits?.balance ?? 0, plan: credits?.plan ?? "free", includedAllowance: credits?.includedAllowance ?? 0, unlimited: await hasUnlimitedCredits(userId), coverLetters: await coverLettersLeft(userId), usage: await planUsage(userId) },
    profile: document,
    ready: student.ready,
    completeness: student.profile.completeness,
    studentFacts,
    highlights: document?.highlights ?? [],
    resume: resume ? { id: resume.id, fileName: resume.fileName, byteSize: resume.byteSize } : null,
    integrations: { apollo: integrations.apollo, anthropic: integrations.anthropic, stripeBilling: integrations.stripeBilling },
  };
}
