import { after } from "next/server";
import { APPLICATIONS_PER_CREDIT, serverConfig } from "@/lib/config";
import { id, nowIso, readAnthropicKey, repo } from "@/lib/db/file-store";
import { ServiceError } from "@/lib/errors";
import { splitProfileList } from "@/lib/profile/lists";
import { readStoredResume } from "@/lib/services/resume";
import { readResumeProfile, resumeFieldAnswer, resumeHash } from "@/lib/apply/resume-profile";
import { buildMapping, fastApplyOn, greenhouseSchema, knownAnswers, logTimings, questionsFromMapping, type Timings } from "@/lib/apply/fast/pipeline";
import { findPeopleForApplication, hunterReady, writeOutreachEmails } from "@/lib/apply/contacts";
import { extractJob } from "@/lib/apply/extract";
import { AI_ANSWER_PROMPT, acceptAiAnswer, classifyQuestion, contactFromResume, eligibilityAnswer, missingAnswers, normalizeLabel, planAnswers, type AnswerContext } from "@/lib/apply/questions";
import { applicationContacts, applicationProfiles, applications } from "@/lib/apply/store";
import { profileReady } from "@/lib/profile/service";
import { EEO_OPTIONS, DECLINE } from "@/lib/profile/student";
import type { ApplicationProfile, ApplicationQuestion, JobApplication, OutreachState } from "@/lib/apply/types";

/** Background work runs after the response is sent. Tests run it inline. */
let defer: (task: () => Promise<void>) => void = (task) => after(task);

export function setDeferForTests(run: ((task: () => Promise<void>) => void) | null) {
  defer = run ?? ((task) => after(task));
}

const OUTREACH_STATES: OutreachState[] = ["not_contacted", "emailed", "replied", "no_response"];

async function student(userId: string) {
  const [user, document, resume, stored] = await Promise.all([repo.getUserById(userId), repo.getProfileDocument(userId), repo.getLatestResume(userId), applicationProfiles.get(userId)]);
  if (!user) throw new ServiceError("Sign in to continue.", "auth", 401);
  const resumeText = resume?.text ?? "";
  const fromResume = contactFromResume(resumeText);
  const [firstName = "", ...rest] = user.name.trim().split(/\s+/);
  // What the student typed wins; anything blank comes from their resume.
  const parsed = stored?.resumeProfile && stored.resumeProfile.sourceHash === resumeHash(resumeText) ? stored.resumeProfile : null;
  const fromParsed = parsed?.contact;
  const pick = (typed: string | undefined, ...fallbacks: Array<string | undefined>) => typed?.trim() || fallbacks.find((value) => value?.trim())?.trim() || "";
  const profile: ApplicationProfile = {
    firstName: pick(stored?.firstName, firstName),
    lastName: pick(stored?.lastName, rest.join(" ")),
    email: pick(stored?.email, user.email),
    phone: pick(stored?.phone, fromResume.phone, fromParsed?.phone),
    linkedin: pick(stored?.linkedin, fromResume.linkedin, fromParsed?.linkedin),
    website: pick(stored?.website, fromParsed?.website),
    github: pick(stored?.github, fromResume.github, fromParsed?.github),
    city: pick(stored?.city, fromParsed?.city),
    addressLine1: pick(stored?.addressLine1, fromParsed?.addressLine1),
    state: pick(stored?.state, fromParsed?.state),
    postalCode: pick(stored?.postalCode, fromParsed?.postalCode),
    country: pick(stored?.country, fromParsed?.country, /^\d{5}(-\d{4})?$/.test(fromParsed?.postalCode ?? "") ? "United States" : ""),
    resumeProfile: parsed,
    saved: stored?.saved ?? {},
    eligibility: stored?.eligibility ?? {},
    fastApply: stored?.fastApply ?? false,
    jobSitePasswordEncrypted: stored?.jobSitePasswordEncrypted ?? null,
    accountConsentAt: stored?.accountConsentAt ?? null,
    jobAccounts: stored?.jobAccounts ?? [],
    student: stored?.student,
  };
  const form = document?.form;
  // The resume-first profile wins; the old onboarding form fills in for students who haven't redone it.
  const s = stored?.student;
  const school = s?.education[0];
  const context: AnswerContext = {
    profile,
    school: school?.school || form?.school || "",
    majors: school?.major ? splitProfileList(school.major) : splitProfileList(form?.major ?? ""),
    graduationYear: school?.gradDate?.match(/\b(19|20)\d{2}\b/)?.[0] || form?.graduationYear || "",
    resumeFileName: resume?.storagePath ? resume.fileName : null,
  };
  const profileText = (s
    ? [
      school && `School: ${school.school}; Degree: ${school.degree}; Major: ${school.major}${school.minor ? `; Minor: ${school.minor}` : ""}; Graduation: ${school.gradDate}${school.gpa ? `; GPA: ${school.gpa}` : ""}`,
      s.preferences.roles.length ? `Target roles: ${s.preferences.roles.join(", ")}` : "",
      s.essays.aboutMe && `About: ${s.essays.aboutMe}`,
      s.essays.whyField && `Why this field: ${s.essays.whyField}`,
      ...s.experience.map((item) => `${item.title} at ${item.company} (${item.startDate}${item.endDate ? ` - ${item.endDate}` : ""}): ${item.bullets.join(" ")}`),
      ...s.projects.map((item) => `Project ${item.name}${item.role ? ` (${item.role})` : ""}: ${item.bullets.join(" ")}${item.tech?.length ? ` Tech: ${item.tech.join(", ")}` : ""}`),
      s.skills.technical.length ? `Skills: ${s.skills.technical.join(", ")}` : "",
    ]
    : [
      form && `School: ${form.school}; Majors: ${form.major}; Graduation year: ${form.graduationYear}`,
      form?.targetRoles && `Target roles: ${form.targetRoles}`,
      form?.bio && `About: ${form.bio}`,
      form?.accomplishments && `Accomplishments: ${form.accomplishments}`,
      ...(document?.highlights ?? []).map((item) => `- ${item.detail}${item.experienceDetails ? ` ${item.experienceDetails}` : ""}`),
    ]).filter(Boolean).join("\n");
  return { user, document, resume, resumeText, profile, context, profileText, excluded: form?.excludedTopics ?? "" };
}

/** Answers open, non-sensitive questions from the profile and resume. Answers without quoted evidence are dropped. */
async function aiAnswers(userId: string, questions: ApplicationQuestion[], sources: string) {
  const open = questions.filter((question) => !question.answer && !question.sensitive && !classifyQuestion(question.label).sensitive && question.kind !== "file" && question.kind !== "unknown" && classifyQuestion(question.label).field !== "coverLetter").slice(0, 30);
  if (!open.length || !sources.trim()) return questions;
  const apiKey = await readAnthropicKey();
  if (!apiKey) return questions;
  const config = serverConfig();
  const started = Date.now();
  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey });
    const model = process.env.ANTHROPIC_FAST_MODEL || "claude-haiku-4-5";
    const response = await client.messages.create({
      model,
      max_tokens: 2500,
      system: [{ type: "text", text: AI_ANSWER_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: `Questions:\n${JSON.stringify(open.map((q) => ({ key: q.key, question: q.label, options: q.options.length ? q.options : undefined, long: q.kind === "textarea" || undefined })))}\n\nStudent profile and resume:\n${sources.slice(0, 12000)}` }],
    });
    const text = response.content.map((block) => (block.type === "text" ? block.text : "")).join("");
    const inputTokens = response.usage?.input_tokens ?? 0;
    const outputTokens = response.usage?.output_tokens ?? 0;
    const costCents = (inputTokens * config.fastInputCentsPerMillion + outputTokens * config.fastOutputCentsPerMillion) / 1_000_000;
    await repo.insertUsage({ id: id(), userId, provider: "anthropic", operation: "application_answers", success: true, latencyMs: Date.now() - started, costCents, estimated: true, error: null, createdAt: nowIso() });
    await repo.insertGeneration({ id: id(), userId, purpose: "application_answers", model, inputTokens, outputTokens, costCents, estimated: true, createdAt: nowIso() });
    const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as { answers?: Array<{ key?: string; answer?: string; evidence?: string }> };
    const byKey = new Map((parsed.answers ?? []).map((item) => [String(item.key), item]));
    return questions.map((question) => {
      const proposal = byKey.get(question.key);
      if (question.answer || !proposal?.answer || !proposal.evidence) return question;
      const answer = acceptAiAnswer(question, String(proposal.answer), String(proposal.evidence), sources);
      return answer ? { ...question, answer, source: "ai", evidence: String(proposal.evidence).slice(0, 300) } : question;
    });
  } catch (error) {
    await repo.insertUsage({ id: id(), userId, provider: "anthropic", operation: "application_answers", success: false, latencyMs: Date.now() - started, costCents: 0, estimated: true, error: error instanceof Error ? error.message : "anthropic_failed", createdAt: nowIso() });
    return questions;
  }
}

/** When each student's resume was last sent to be read, so polling doesn't start it twice. */
const resumeReads = new Map<string, number>();

/** Reads the resume into schools, jobs, and contact details once, and again only when the resume changes. */
async function ensureResumeProfile(userId: string) {
  const [resume, stored] = await Promise.all([repo.getLatestResume(userId), applicationProfiles.get(userId)]);
  const text = resume?.text ?? "";
  if (!text.trim() || stored?.resumeProfile?.sourceHash === resumeHash(text)) return;
  const parsed = await readResumeProfile(userId, text);
  if (!parsed) return;
  const base = stored ?? (await student(userId)).profile;
  await applicationProfiles.put(userId, { ...base, resumeProfile: parsed });
}

/** The answer for a form question: the student's own answers first, then their resume's schools and jobs, then their details. */
function answerWith(info: Awaited<ReturnType<typeof student>>, company: string) {
  return (label: string, kind: ApplicationQuestion["kind"], options: string[], where?: { section?: string; format?: string | null }) => {
    const [planned] = planAnswers([{ key: label, label, kind, required: false, options, sensitive: false, answer: null, source: null, evidence: null }], info.context);
    if (planned.answer && (planned.source === "saved" || planned.source === "student")) return planned.answer;
    const fromResume = resumeFieldAnswer(info.profile.resumeProfile, { label, section: where?.section, kind, options, format: where?.format });
    if (fromResume) return fromResume;
    if (planned.answer && planned.source && planned.source !== "resume_file") return planned.answer;
    // "Have you worked for Acme before?" The resume lists every job, so it answers this.
    if (company && new RegExp(`(previously|ever|before|formerly|in the past).*(work|employ)|(work|employ).*(previously|ever|before|in the past)|former employee`, "i").test(label) && !/\b(intern|contractor|relative|family)\b/i.test(label)) {
      const jobs = info.profile.resumeProfile?.experience ?? [];
      if (!jobs.length) return null;
      const worked = jobs.some((job) => job.company && (job.company.toLowerCase().includes(company.toLowerCase()) || company.toLowerCase().includes(job.company.toLowerCase())));
      const answer = worked ? "Yes" : "No";
      return options.length ? options.find((option) => option.toLowerCase().startsWith(answer.toLowerCase())) ?? null : answer;
    }
    return null;
  };
}

/** Saves answers the student entered on a form, so the same question fills itself next time. */
export async function learnAnswers(userId: string, info: Awaited<ReturnType<typeof student>>, entries: Array<{ label: string; section: string; value: string }>) {
  const saved = { ...info.profile.saved };
  const next: ApplicationProfile = { ...info.profile };
  let learned = 0;
  for (const entry of entries) {
    const { field } = classifyQuestion(entry.label);
    if (field === "resume" || field === "coverLetter" || field === "phoneExtension" || /cover ?letter|password/i.test(entry.label)) continue;
    // A plain contact field fills the student's details if they were blank.
    if (field && (["firstName", "lastName", "phone", "city", "addressLine1", "state", "postalCode", "country", "linkedin", "website", "github"] as const).includes(field as never)) {
      const key = field as "firstName";
      if (!String(info.profile[key] ?? "").trim()) {
        next[key] = entry.value;
        learned += 1;
      }
      continue;
    }
    const eligible = eligibilityAnswer(entry.label, { ...info.profile, eligibility: { workAuthorized: "x", needsSponsorship: "x", over18: "x" } });
    if (eligible && /^(yes|no)\b/i.test(entry.value)) {
      const key = /sponsor/i.test(entry.label) ? "needsSponsorship" : /18|age/i.test(entry.label) ? "over18" : "workAuthorized";
      if (!info.profile.eligibility?.[key]) {
        next.eligibility = { ...(next.eligibility ?? {}), [key]: /^yes/i.test(entry.value) ? "Yes" : "No" };
        learned += 1;
      }
      continue;
    }
    const key = normalizeLabel(entry.label);
    if (saved[key]?.answer === entry.value) continue;
    saved[key] = { label: entry.label, answer: entry.value, updatedAt: nowIso() };
    learned += 1;
  }
  if (!learned) return 0;
  next.saved = saved;
  await applicationProfiles.put(userId, next);
  Object.assign(info.profile, next);
  return learned;
}

function summary(app: JobApplication) {
  const missing = missingAnswers(app.questions);
  return { ...app, description: app.description.slice(0, 4000), missing: missing.map((question) => question.key) };
}

export async function applyState(userId: string) {
  const [apps, info] = await Promise.all([applications.list(userId), student(userId)]);
  // A new resume is read in the background, so blank details fill from it without waiting for an application.
  if (info.resumeText.trim() && !info.profile.resumeProfile && Date.now() - (resumeReads.get(userId) ?? 0) > 120_000) {
    resumeReads.set(userId, Date.now());
    defer(() => ensureResumeProfile(userId).catch(() => undefined));
  }
  const contacts = await applicationContacts.list(userId, apps.map((app) => app.id));
  return {
    applications: apps.map((app) => ({ ...summary(app), contacts: contacts.filter((contact) => contact.applicationId === app.id) })),
    profile: publicProfile(info.profile),
    resume: info.resume ? { fileName: info.resume.fileName, stored: Boolean(info.resume.storagePath) } : null,
    ready: { hunter: hunterReady(), profile: await profileReady(userId) },
    applicationsPerCredit: APPLICATIONS_PER_CREDIT,
  };
}

/** Reads the job link and proposes answers. Pasting the same job again returns the first application. */
export async function createApplication(userId: string, raw: unknown) {
  const url = String((raw as { url?: unknown } | null)?.url ?? "").trim().slice(0, 2000);
  if (!url) throw new ServiceError("Paste a job posting link.", "job_url", 400);
  if (!(await profileReady(userId))) throw new ServiceError("Finish your profile first so Unnepo has your details to apply with.", "profile", 400);
  const [job] = await Promise.all([extractJob(url), ensureResumeProfile(userId)]);
  const info = await student(userId);
  const existing = await applications.findByKey(userId, job.jobKey);
  if (existing) return { application: summary(existing), duplicate: true, message: `You already added ${existing.title} at ${existing.company}.` };
  let questions: ApplicationQuestion[];
  let timings: Timings | undefined;
  if (fastApplyOn(job, info.profile)) {
    // Fast pipeline: the whole form from Greenhouse's API, mapped with at most one AI call.
    const fast = await fastQuestions(userId, info, { ...job, fillReport: null });
    questions = fast.questions;
    timings = fast.timings;
  } else {
    questions = planAnswers(job.questions, info.context);
    // Education and work history questions come straight from the resume's entries.
    questions = questions.map((question) => {
      if (question.answer || question.sensitive || question.kind === "file") return question;
      const answer = resumeFieldAnswer(info.profile.resumeProfile, { label: question.label, kind: question.kind, options: question.options });
      return answer ? { ...question, answer, source: "resume", evidence: null } : question;
    });
    questions = await aiAnswers(userId, questions, [info.profileText, info.resumeText].join("\n\n"));
  }
  const { app, created } = await applications.insert({
    userId,
    jobKey: job.jobKey,
    jobUrl: job.jobUrl,
    ats: job.ats,
    title: job.title,
    company: job.company,
    companyDomain: null,
    department: job.department,
    location: job.location,
    description: job.description,
    requirements: job.requirements,
    applicationUrl: job.applicationUrl,
    postedRecruiter: job.postedRecruiter,
    status: "extracted",
    statusMessage: timings ? `Answers ready in ${((timings.schemaMs ?? 0) + (timings.mappingMs ?? 0)) / 1000}s with ${timings.llmCalls} AI call${timings.llmCalls === 1 ? "" : "s"}. Review them, then autofill.` : job.questions.length ? "Review the answers below." : "This job board doesn't publish its questions ahead of time. Autofill reads them from the live form.",
    questions,
    browserSessionId: null,
    fillReport: timings ? { filled: [], failed: [], liveViewUrl: null, screenshotAt: null, timings } : null,
    confirmation: null,
    submittedAt: null,
    contactsStatus: "idle",
    contactsMessage: "",
    charged: false,
    attempts: 0,
  });
  if (timings && created) logTimings(app.id, "mapping", timings);
  // Credits are spent when Unnepo prepares a job's answers (1 credit covers APPLICATIONS_PER_CREDIT jobs).
  if (created) await ensureCharged(userId, app);
  return { application: summary(app), duplicate: !created, message: created ? "Job added." : "You already added this job." };
}

async function requireApp(userId: string, applicationId: unknown) {
  const app = await applications.get(userId, String(applicationId ?? "").slice(0, 80));
  if (!app) throw new ServiceError("That application wasn't found.", "not_found", 404);
  return app;
}

/** Saves the student's own answers. Answers marked "save" are reused on later applications. */
export async function updateAnswers(userId: string, raw: unknown) {
  const body = (raw ?? {}) as { applicationId?: unknown; answers?: Record<string, unknown>; save?: unknown };
  const app = await requireApp(userId, body.applicationId);
  if (!["extracted", "review", "unconfirmed", "failed", "filling", "submitting"].includes(app.status)) throw new ServiceError("This application can't be edited right now.", "state", 409);
  const answers = body.answers ?? {};
  const save = new Set((Array.isArray(body.save) ? body.save : []).map(String));
  const info = await student(userId);
  const saved = { ...info.profile.saved };
  const questions = app.questions.map((question) => {
    if (!(question.key in answers)) return question;
    const value = String(answers[question.key] ?? "").trim().slice(0, 4000);
    if (question.kind === "select" && value && question.options.length && !question.options.includes(value)) {
      throw new ServiceError(`Pick one of the options for "${question.label}".`, "answer", 400);
    }
    if (question.kind === "multiselect" && value && question.options.length && value.split("\n").some((item) => !question.options.includes(item))) {
      throw new ServiceError(`Pick from the options for "${question.label}".`, "answer", 400);
    }
    if (save.has(question.key) && value) saved[normalizeLabel(question.label)] = { label: question.label, answer: value, updatedAt: nowIso() };
    return { ...question, answer: value || null, source: value ? "student" : null, evidence: null };
  });
  if (Object.keys(saved).length !== Object.keys(info.profile.saved).length || save.size) await applicationProfiles.put(userId, { ...info.profile, saved });
  const updated = await applications.update(userId, app.id, { questions });
  return { application: summary(updated!) };
}

const PROFILE_FIELDS = ["firstName", "lastName", "email", "phone", "linkedin", "website", "github", "city", "addressLine1", "state", "postalCode", "country"] as const;

/** The profile as the page sees it: the encrypted password is replaced by whether one is set. */
function publicProfile(profile: ApplicationProfile) {
  const { jobSitePasswordEncrypted, ...rest } = profile;
  return { ...rest, hasJobSitePassword: Boolean(jobSitePasswordEncrypted) };
}

export async function saveApplicationProfile(userId: string, raw: unknown) {
  const body = (raw ?? {}) as Record<string, unknown>;
  const info = await student(userId);
  const next: ApplicationProfile = { ...info.profile };
  for (const field of PROFILE_FIELDS) if (typeof body[field] === "string") next[field] = String(body[field]).trim().slice(0, 300);
  if (next.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.email)) throw new ServiceError("Enter a valid email address.", "email", 400);
  if (body.eligibility && typeof body.eligibility === "object") {
    const given = body.eligibility as Record<string, unknown>;
    const eligibility = { ...(info.profile.eligibility ?? {}) };
    for (const key of ["workAuthorized", "needsSponsorship", "over18"] as const) {
      if (key in given) eligibility[key] = given[key] === "Yes" || given[key] === "No" ? String(given[key]) : "";
    }
    next.eligibility = eligibility;
  }
  if (typeof body.fastApply === "boolean") next.fastApply = body.fastApply;
  if (typeof body.accountConsent === "boolean") next.accountConsentAt = body.accountConsent ? info.profile.accountConsentAt || nowIso() : null;
  await applicationProfiles.put(userId, next);
  return { profile: publicProfile(next) };
}

/** 1 credit covers APPLICATIONS_PER_CREDIT applications: charged on the 1st, 16th, 31st… */
async function ensureCharged(userId: string, app: JobApplication) {
  if (app.charged) return;
  const count = await applications.countCharged(userId);
  if (count % APPLICATIONS_PER_CREDIT === 0) {
    const block = Math.floor(count / APPLICATIONS_PER_CREDIT);
    const spent = await repo.spendCredits({ userId, amount: 1, idempotencyKey: `application-block:${userId}:${block}`, note: `Applications ${block * APPLICATIONS_PER_CREDIT + 1}–${(block + 1) * APPLICATIONS_PER_CREDIT}`, entryType: "application_debit" });
    if (spent.insufficient) throw new ServiceError(`You're out of credits. 1 credit covers your next ${APPLICATIONS_PER_CREDIT} applications.`, "credits", 402);
  }
  await applications.update(userId, app.id, { charged: true });
}

/** The student's facts and resume text: the only things the mapping's AI call may use. */
function runContext(userId: string, info: Awaited<ReturnType<typeof student>>, app: JobApplication) {
  const sources = [info.profileText, info.resumeText].join("\n\n");
  // The student's own details as plain lines: the only facts the AI may use besides the resume.
  const p = info.profile;
  const said = (value: string | undefined) => value?.trim() || "(not set)";
  const facts = [
    `First name: ${said(p.firstName)}`, `Last name: ${said(p.lastName)}`, `Email: ${said(p.email)}`, `Phone: ${said(p.phone)}`,
    `Street address: ${said(p.addressLine1)}`, `City: ${said(p.city)}`, `State: ${said(p.state)}`, `ZIP code: ${said(p.postalCode)}`, `Country: ${said(p.country)}`,
    `LinkedIn: ${said(p.linkedin)}`, `Website: ${said(p.website)}`, `GitHub: ${said(p.github)}`,
    `School: ${said(info.context.school)}`, `Majors: ${said(info.context.majors.join(", "))}`, `Graduation year: ${said(info.context.graduationYear)}`,
    `Authorized to work in the United States: ${said(p.eligibility?.workAuthorized)}`,
    `Will now or in the future need visa sponsorship: ${said(p.eligibility?.needsSponsorship)}`,
    `At least 18 years old: ${said(p.eligibility?.over18)}`,
    `Unnepo may accept privacy notices and candidate terms for the student: ${p.accountConsentAt ? "Yes" : "No"}`,
    ...Object.entries(p.student?.eeo ?? {}).filter(([, value]) => value && value !== DECLINE).map(([key, value]) => `Self-identification. ${key}: ${EEO_OPTIONS[key as keyof typeof EEO_OPTIONS].find(([option]) => option === value)?.[1] ?? value}`),
    `Applying to: ${app.title} at ${app.company}`,
    ...Object.values(p.saved).slice(0, 60).map((item) => `Saved answer. ${item.label}: ${item.answer}`),
  ].join("\n");
  return { sources, facts };
}

/** The fast mapping for a Greenhouse job: its form from the job board API, answers with at most one AI call. */
async function fastQuestions(userId: string, info: Awaited<ReturnType<typeof student>>, app: Pick<JobApplication, "jobKey" | "title" | "company" | "department" | "description" | "requirements" | "fillReport">) {
  const { schema, ms: schemaMs } = await greenhouseSchema(app.jobKey);
  const context = runContext(userId, info, app as JobApplication);
  const mapped = await buildMapping({
    userId,
    ai: true,
    schema,
    known: knownAnswers({ answerFor: answerWith(info, schema.company), profile: info.profile, school: info.context.school, resumeProfile: info.profile.resumeProfile }),
    facts: context.facts,
    sources: context.sources,
    consent: Boolean(info.profile.accountConsentAt),
    resumeFileName: info.context.resumeFileName,
  });
  const timings: Timings = { pipeline: "fast", schemaMs, mappingMs: mapped.ms, llmCalls: mapped.llmCalls, fallback: [] };
  return { schema, questions: questionsFromMapping(schema, mapped.answers), timings };
}

function startContacts(userId: string, applicationId: string) {
  defer(async () => {
    await runContactDiscovery(userId, applicationId).catch((error) => console.error("contact discovery failed", error));
  });
}

/** The confirmation screenshot Unnepo kept when the site confirmed the application. */
export async function receiptImage(userId: string, applicationId: string) {
  const app = await requireApp(userId, applicationId);
  const bytes = app.confirmation?.receiptPath ? await readStoredResume(app.confirmation.receiptPath) : null;
  if (!bytes) throw new ServiceError("No receipt for this application.", "not_found", 404);
  return bytes;
}

/** The student applied on their own. Shown as "Applied (you)", never as confirmed by Unnepo. */
export async function markApplied(userId: string, raw: unknown) {
  const app = await requireApp(userId, (raw as { applicationId?: unknown } | null)?.applicationId);
  if (app.status === "submitted" || app.status === "applied_manual") return { application: summary(app) };
  await ensureCharged(userId, app);
  const updated = await applications.update(userId, app.id, { status: "applied_manual", browserSessionId: null, submittedAt: nowIso(), statusMessage: "You marked this as applied." });
  startContacts(userId, app.id);
  return { application: summary(updated!) };
}

const STALE_MS = 5 * 60 * 1000;

/** Finds people, then writes their emails. Safe to retry; a run already in progress is left alone. */
export async function runContactDiscovery(userId: string, applicationId: string) {
  const app = await applications.get(userId, applicationId);
  if (!app || (app.status !== "submitted" && app.status !== "applied_manual")) return;
  const busy = (app.contactsStatus === "finding" || app.contactsStatus === "writing") && Date.now() - Date.parse(app.updatedAt) < STALE_MS;
  if (busy) return;
  await applications.update(userId, app.id, { contactsStatus: "finding", contactsMessage: "Finding people…" });
  let found: Awaited<ReturnType<typeof findPeopleForApplication>>;
  try {
    found = await findPeopleForApplication(userId, app);
  } catch (error) {
    // Apollo's own messages mention search credits, which don't apply here; the application credit covers this.
    const reason = error instanceof ServiceError ? error.message.replace(/\s*No credits were used\.?/i, "") : "Couldn't look up people right now.";
    await applications.update(userId, app.id, { contactsStatus: "failed", contactsMessage: `${reason} Try again.` });
    return;
  }
  const rows = await applicationContacts.replace(userId, app.id, found.people.map((person) => ({ ...person, applicationId: app.id, userId, emailSubject: null, emailBody: null })));
  await applications.update(userId, app.id, { companyDomain: found.domain, contactsStatus: rows.length ? "writing" : "done", contactsMessage: found.notes.join(" ") });
  if (!rows.length) return;
  try {
    const info = await student(userId);
    const emails = await writeOutreachEmails(userId, app, rows, { name: info.user.name, resumeText: info.resumeText, profile: info.profileText });
    for (const [index, row] of rows.entries()) {
      if (emails[index]?.body) await applicationContacts.update(userId, row.id, { emailSubject: emails[index].subject, emailBody: emails[index].body });
    }
    await applications.update(userId, app.id, { contactsStatus: "done", contactsMessage: found.notes.join(" ") });
  } catch (error) {
    await applications.update(userId, app.id, { contactsStatus: "failed", contactsMessage: `Found ${rows.length} people, but the emails couldn't be written. ${error instanceof Error ? error.message : ""} Try again.`.trim() });
  }
}

export async function retryContacts(userId: string, raw: unknown) {
  const app = await requireApp(userId, (raw as { applicationId?: unknown } | null)?.applicationId);
  if (app.status !== "submitted" && app.status !== "applied_manual") throw new ServiceError("People are found after you apply.", "state", 409);
  startContacts(userId, app.id);
  return { ok: true };
}

export async function updateOutreach(userId: string, raw: unknown) {
  const body = (raw ?? {}) as { contactId?: unknown; status?: unknown };
  const status = String(body.status) as OutreachState;
  if (!OUTREACH_STATES.includes(status)) throw new ServiceError("Choose a valid status.", "status", 400);
  const row = await applicationContacts.update(userId, String(body.contactId ?? "").slice(0, 80), { outreachStatus: status });
  if (!row) throw new ServiceError("That contact wasn't found.", "not_found", 404);
  return { contact: row };
}

export async function deleteApplication(userId: string, raw: unknown) {
  const app = await requireApp(userId, (raw as { applicationId?: unknown } | null)?.applicationId);
  await applications.remove(userId, app.id);
  return { ok: true };
}
