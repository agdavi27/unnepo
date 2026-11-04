import { after } from "next/server";
import { SKINS, skinUnlocked } from "@/lib/spiders";
import { isApplied } from "@/lib/apply/stats";
import { FREE_APPLICATIONS, serverConfig } from "@/lib/config";
import { id, nowIso, readAnthropicKey, repo } from "@/lib/db/file-store";
import { ServiceError } from "@/lib/errors";
import { splitProfileList } from "@/lib/profile/lists";
import { readStoredResume } from "@/lib/services/resume";
import { readResumeProfile, resumeFieldAnswer, resumeHash } from "@/lib/apply/resume-profile";
import { buildMapping, fastApplyOn, greenhouseSchema, knownAnswers, logTimings, questionsFromMapping, type Timings } from "@/lib/apply/fast/pipeline";
import { findPeopleForApplication, hunterReady, siteDomain, writeOutreachEmails } from "@/lib/apply/contacts";
import { cleanCompanyName, notJobTitle } from "@/lib/apply/job-title";
import { companyFromUrl, extractJob, findPostedRecruiter, isJobSiteName, jobKeyFor, parseJobUrl, plainJobKey } from "@/lib/apply/extract";
import { AI_ANSWER_PROMPT, acceptAiAnswer, classifyQuestion, contactFromResume, eligibilityAnswer, headlineAnswer, missingAnswers, normalizeLabel, planAnswers, toolExperienceAnswer, type AnswerContext } from "@/lib/apply/questions";
import { applicationContacts, applicationProfiles, applications } from "@/lib/apply/store";
import { hasUnlimitedCredits } from "@/lib/apply/limits";
import { addActivity, dropMaybe, liveMaybe, sessionNow } from "@/lib/apply/activity";
import { profileReady } from "@/lib/profile/service";
import { CLASS_YEARS, EEO_OPTIONS, DECLINE, classYearOf } from "@/lib/profile/student";
import type { ApplicationProfile, ApplicationQuestion, JobApplication, OutreachState, PostedRecruiter } from "@/lib/apply/types";

/** Background work runs after the response is sent. Tests run it inline. */
let defer: (task: () => Promise<void>) => void = (task) => after(task);

/** Runs work after the response is sent (inline in tests). */
export const runLater = (task: () => Promise<void>) => defer(task);

export function setDeferForTests(run: ((task: () => Promise<void>) => void) | null) {
  defer = run ?? ((task) => after(task));
}

const OUTREACH_STATES: OutreachState[] = ["not_contacted", "emailed", "replied", "no_response"];

/** Marks consent the student never changed: Settings shows it on, and turning it off saves null. */
const CONSENT_BY_DEFAULT = "default";
const US_STATE = /^(A[LKZR]|C[AOT]|DE|DC|FL|GA|HI|I[DLNA]|K[SY]|LA|M[EDAINSOT]|N[EVHJMYCD]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[TA]|W[AVIY]|Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|District of Columbia|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming)$/i;

export async function student(userId: string) {
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
    // Resumes rarely say the country: a US ZIP code or state means the United States.
    country: pick(stored?.country, fromParsed?.country, /^\d{5}(-\d{4})?$/.test(pick(stored?.postalCode, fromParsed?.postalCode)) || US_STATE.test(pick(stored?.state, fromParsed?.state)) ? "United States" : ""),
    resumeProfile: parsed,
    saved: stored?.saved ?? {},
    eligibility: stored?.eligibility ?? {},
    fastApply: stored?.fastApply ?? false,
    jobSitePasswordEncrypted: stored?.jobSitePasswordEncrypted ?? null,
    // Accepting terms and acknowledgements is on until the student turns it off (which saves null).
    accountConsentAt: stored?.accountConsentAt === undefined ? CONSENT_BY_DEFAULT : stored.accountConsentAt,
    jobAccounts: stored?.jobAccounts ?? [],
    student: stored?.student,
    aiCache: stored?.aiCache,
    weeklyGoal: stored?.weeklyGoal,
    spiderSkin: stored?.spiderSkin,
    autoFindPeople: stored?.autoFindPeople,
    maybeApplied: stored?.maybeApplied,
    session: stored?.session,
    letters: stored?.letters,
    jobFeed: stored?.jobFeed,
    cvCount: stored?.cvCount,
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
    classYear: CLASS_YEARS.find(([value]) => value === classYearOf(school))?.[1] ?? "",
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
export function answerWith(info: Awaited<ReturnType<typeof student>>, company: string) {
  return (label: string, kind: ApplicationQuestion["kind"], options: string[], where?: { section?: string; format?: string | null }) => {
    const [planned] = planAnswers([{ key: label, label, kind, required: false, options, sensitive: false, answer: null, source: null, evidence: null }], info.context);
    if (planned.answer && (planned.source === "saved" || planned.source === "student")) return planned.answer;
    const fromResume = resumeFieldAnswer(info.profile.resumeProfile, { label, section: where?.section, kind, options, format: where?.format });
    if (fromResume) return fromResume;
    if (planned.answer && planned.source && planned.source !== "resume_file") return planned.answer;
    // "Current/Most Recent Employer Name", "Most recent job title": the latest job on the resume.
    const latest = info.profile.resumeProfile?.experience?.[0] ?? info.profile.student?.experience?.[0];
    if (latest && kind !== "file" && kind !== "textarea" && !options.length && /\b(current|most recent|present|latest)\b/i.test(label)) {
      if (/\b(employer|company|organi[sz]ation)\b/i.test(label) && latest.company) return latest.company;
      if (/\b(job |position )?title\b|\bposition\b/i.test(label) && latest.title) return latest.title;
    }
    const tools = toolExperienceAnswer(label, kind, options, info.resumeText);
    if (tools) return tools;
    const headline = headlineAnswer(label, info.context, info.profile.resumeProfile?.experience?.[0]);
    if (headline) return headline;
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

export function summary(app: JobApplication) {
  const missing = missingAnswers(app.questions);
  return { ...app, description: app.description.slice(0, 4000), missing: missing.map((question) => question.key), companyMissing: companyMissing(app), titleMissing: titleMissing(app.title) };
}

/** What a job is saved as when the page didn't say its name. */
export const NO_TITLE = "Job title missing";
// Titles saved when nothing better was known: LinkedIn's stand-in, and page names.
const STAND_IN_TITLE = /^(job title missing|linkedin easy apply job|a job|job|untitled|job application|apply|thank you.*)$/i;

/** Whether the saved title isn't the job's name: a stand-in, or a status line like "Applied on November 2, 2026". */
export function titleMissing(title: string) {
  return notJobTitle(title) || STAND_IN_TITLE.test(title.trim());
}

// What a page calls itself when it isn't the employer: job boards, and the first part of a site address.
const BOARD_NAME = /^(handshake|joinhandshake|ziprecruiter|zip recruiter|linkedin|indeed|glassdoor|simplyhired|monster|wellfound|angellist|builtin|built in|app|www|careers?|jobs?|unknown|n\/a|company|employer|\?)$/i;

/** Whether the job was saved without a real company: blank, a job site's name, or a website address. */
export function companyMissing(app: Pick<JobApplication, "company" | "jobUrl">) {
  const name = app.company.replace(/\s+/g, " ").trim();
  if (isJobSiteName(name) || BOARD_NAME.test(name)) return true;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(name)) return true;
  // The scanner's last resort is the site address's first part ("mealpal" from mealpal.applytojob.com is fine,
  // "jobs" from jobs.example.com isn't): a lowercase single word that's only the host.
  try {
    const host = new URL(app.jobUrl).hostname.replace(/^www\./, "");
    return name === name.toLowerCase() && name === host.split(".")[0] && BOARD_NAME.test(host.split(".")[0]);
  } catch {
    return false;
  }
}

/** The student names the company, or the job title, for a job saved without one. */
export async function setCompany(userId: string, raw: unknown) {
  const body = (raw ?? {}) as { applicationId?: unknown; company?: unknown; title?: unknown };
  const app = await requireApp(userId, body.applicationId);
  const company = String(body.company ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  const title = String(body.title ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (body.company !== undefined && company.length < 2) throw new ServiceError("Type the company's name.", "company", 400);
  if (body.title !== undefined && (title.length < 2 || notJobTitle(title))) throw new ServiceError("Type the job title.", "title", 400);
  if (!company && !title) throw new ServiceError("Type the company's name.", "company", 400);
  // A new company means a new search for its website and people.
  const updated = await applications.update(userId, app.id, { ...(company ? { company, companyDomain: null } : {}), ...(title ? { title } : {}) });
  return { application: summary(updated!) };
}

/**
 * The student edits a job's details on the Applied page: its title, company, place, posting link and
 * description, and their own notes. Only what's sent changes; an empty notes box clears the notes.
 */
export async function updateJobDetails(userId: string, raw: unknown) {
  const body = (raw ?? {}) as Record<string, unknown>;
  const app = await requireApp(userId, body.applicationId);
  const text = (key: string, max: number) => (typeof body[key] === "string" ? (body[key] as string).trim().slice(0, max) : undefined);
  const [title, company, location, link, description, notes] = [text("title", 200), text("company", 200), text("location", 200), text("url", 2000), text("description", 8000), typeof body.notes === "string" ? body.notes.slice(0, 4000) : undefined];
  if (title !== undefined && (title.length < 2 || notJobTitle(title))) throw new ServiceError("Type the job title.", "title", 400);
  if (company !== undefined && company.length < 2) throw new ServiceError("Type the company's name.", "company", 400);
  if (link !== undefined && link && !/^https:\/\/\S+\.\S+/i.test(link)) throw new ServiceError("The link should start with https://.", "url", 400);
  const report = app.fillReport ?? { filled: [], failed: [], liveViewUrl: null, screenshotAt: null };
  const nextReport = { ...report, ...(link !== undefined ? { postingUrl: link || undefined } : {}), ...(notes !== undefined ? { notes: notes.trim() ? notes : undefined } : {}) };
  const updated = await applications.update(userId, app.id, {
    ...(title !== undefined ? { title } : {}),
    // A new company means a new search for its website and people.
    ...(company !== undefined && company !== app.company ? { company, companyDomain: null } : {}),
    ...(location !== undefined ? { location: location || null } : {}),
    ...(description !== undefined ? { description } : {}),
    // A job added without a link takes the one typed in as its own.
    ...(link && !app.jobUrl ? { jobUrl: link } : {}),
    fillReport: nextReport,
  });
  return { application: summary(updated!) };
}

/** One key per job link, for links Unnepo can't parse too. */
export function keyFor(url: string) {
  try {
    return jobKeyFor(parseJobUrl(url));
  } catch {
    // Job boards Unnepo doesn't fill (Indeed, LinkedIn) still keep the job's id from the address. Without
    // one, the key stays as it always was, so jobs saved before still match.
    const parsed = new URL(url);
    const named = new URL(plainJobKey(url).replace(/^url:/, "https://")).search;
    return `url:${parsed.hostname}${parsed.pathname}`.toLowerCase().concat(named).slice(0, 300);
  }
}

const plainName = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const sameJobName = (app: Pick<JobApplication, "title" | "company">, named: { title: string; company?: string }) => {
  if (plainName(app.title) !== plainName(named.title)) return false;
  const [a, b] = [plainName(app.company), plainName(named.company ?? "")];
  return !a || !b || a.startsWith(b) || b.startsWith(a);
};

/**
 * The job already tracked at this link, and the key a new one gets. A job board's search page shows many jobs
 * at one address (ZipRecruiter's jobs-search, Indeed's /jobs), so on a plain link the same address under another
 * job's name is another job. Job systems' own links (Greenhouse, Lever, Workday) name the job themselves.
 */
export async function trackedAt(userId: string, url: string, named?: { title?: string; company?: string }) {
  const base = keyFor(url);
  const existing = await applications.findByKey(userId, base);
  const title = named?.title?.trim() ?? "";
  if (!existing || !title || !base.startsWith("url:") || sameJobName(existing, { title, company: named?.company })) return { app: existing, key: base };
  const key = `${base}#${plainName(named?.company ?? "")}|${plainName(title)}`.slice(0, 400);
  return { app: await applications.findByKey(userId, key), key };
}

/** A job tracked from what a page (or the student) says about it, without reading the posting. */
export async function minimalApplication(userId: string, input: { url: string; title: string; company: string; description?: string; poster?: PostedRecruiter | null; key?: string; charge?: boolean }) {
  let ats: JobApplication["ats"] = "other";
  try { ats = parseJobUrl(input.url).ats; } catch { /* a page Unnepo can't parse is still tracked */ }
  // A Workday page calls itself "Workday"; the link names the company.
  // "See more jobs at Anderson Equipment Company" is "Anderson Equipment Company".
  const named = cleanCompanyName(input.company) || input.company;
  const company = isJobSiteName(named) ? companyFromUrl(input.url) || named : named;
  // "Applied on November 2, 2026" is what the page said after applying, not the job.
  const title = notJobTitle(input.title) ? NO_TITLE : input.title;
  const { app } = await applications.insert({
    userId, jobKey: input.key ?? keyFor(input.url), jobUrl: input.url, ats, title: title.slice(0, 200), company: company.slice(0, 200), companyDomain: null,
    department: null, location: null, description: input.description ?? "", requirements: [], applicationUrl: input.url, postedRecruiter: input.poster ?? (input.description ? findPostedRecruiter(input.description) : null), status: "extracted",
    statusMessage: "Opened from the extension.", questions: [], browserSessionId: null, fillReport: null, confirmation: null, submittedAt: null,
    contactsStatus: "idle", contactsMessage: "", charged: false, attempts: 0,
  });
  if (input.charge !== false) await ensureCharged(userId, app);
  return (await applications.get(userId, app.id))!;
}

const MANUAL_STAGES = ["applied", "in_progress", "assessment", "interviewing", "offer", "rejected"] as const;

/**
 * A job the student adds to the tracker by hand: applied somewhere Unnepo didn't see, or one to keep track of.
 * Only a title and company are needed; a link, the date, the posting's text and how it's going are optional.
 */
export async function addJobByHand(userId: string, raw: unknown) {
  const body = (raw ?? {}) as { title?: unknown; company?: unknown; url?: unknown; stage?: unknown; appliedOn?: unknown; description?: unknown; location?: unknown };
  const title = String(body.title ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  const company = String(body.company ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (title.length < 2) throw new ServiceError("Type the job title.", "title", 400);
  if (company.length < 2) throw new ServiceError("Type the company's name.", "company", 400);
  const link = String(body.url ?? "").trim().slice(0, 2000);
  if (link && !/^https:\/\/[^\s]+\.[^\s]+/i.test(link)) throw new ServiceError("The link should start with https://.", "url", 400);
  const stage = MANUAL_STAGES.find((item) => item === body.stage) ?? "applied";
  const day = String(body.appliedOn ?? "").trim();
  const when = /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(`${day}T12:00:00Z`)) && Date.parse(`${day}T12:00:00Z`) <= Date.now() + 86_400_000 ? new Date(`${day}T12:00:00Z`).toISOString() : nowIso();
  const description = typeof body.description === "string" ? body.description.trim().slice(0, 8000) : "";
  // No link: a key of its own, so two jobs added by hand never count as the same one.
  const url = link || `https://unnepo.local/manual/${id()}`;
  // Another job at a link already tracked (a job board's search page) is a job of its own.
  const tracked = link ? await trackedAt(userId, url, { title, company }) : null;
  const app = tracked?.app ?? await minimalApplication(userId, { url, title, company, description, key: tracked?.key });
  const applied = stage !== "in_progress";
  // Saving for later a job already applied to leaves it applied.
  if (!applied && tracked?.app && (app.status === "submitted" || app.status === "applied_manual")) return { application: summary(app) };
  const report = app.fillReport ?? { filled: [], failed: [], liveViewUrl: null, screenshotAt: null };
  const updated = await applications.update(userId, app.id, {
    ...(link ? {} : { jobUrl: "", applicationUrl: null }),
    status: applied ? "applied_manual" : "extracted",
    submittedAt: applied ? when : null,
    statusMessage: applied ? "Added by you." : "Added by you. Not applied yet.",
    ...(typeof body.location === "string" && body.location.trim() && !app.location ? { location: body.location.trim().slice(0, 200) } : {}),
    ...(stage === "assessment" || stage === "interviewing" || stage === "offer" || stage === "rejected" ? { fillReport: { ...report, outcome: stage } } : {}),
  });
  if (applied) await addActivity(userId, app.id, { kind: "applied", how: "added_by_hand", site: link ? undefined : "Added by you" });
  if (applied) await findPeopleOnApply(userId, app.id);
  return { application: summary((await applications.get(userId, app.id)) ?? updated!) };
}

// Jobs whose company couldn't be found, so a page load doesn't read their posting again.
const companyTries = new Set<string>();

/**
 * Jobs saved with the job site's name as the company ("Workday") get the company's name: from the posting
 * when Unnepo can read it, else from the link. Saved, so it's fixed once.
 */
export async function repairCompanies(userId: string, apps: JobApplication[]) {
  return Promise.all(apps.map(async (app) => {
    // Saved with the words around the name ("See more jobs at Anderson Equipment Company"): just the name.
    const cleaned = cleanCompanyName(app.company);
    if (cleaned !== app.company && cleaned.length >= 2) return (await applications.update(userId, app.id, { company: cleaned.slice(0, 200) })) ?? app;
    if (!isJobSiteName(app.company) || companyTries.has(app.id)) return app;
    companyTries.add(app.id);
    let company = "";
    try {
      company = (await extractJob(app.jobUrl)).company;
    } catch {
      // A posting that closed or needs signing in: the link still names the company.
    }
    if (!company || isJobSiteName(company)) company = companyFromUrl(app.jobUrl) || companyFromUrl(app.applicationUrl ?? "");
    if (!company) return app;
    return (await applications.update(userId, app.id, { company: company.slice(0, 200) })) ?? app;
  }));
}

export async function applyState(userId: string) {
  const [saved, info] = await Promise.all([applications.list(userId), student(userId)]);
  const apps = await repairCompanies(userId, saved);
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
    freeApplications: FREE_APPLICATIONS,
    school: info.context.school,
    plan: (await repo.getAccount(userId))?.plan ?? "free",
    maybe: liveMaybe(info.profile.maybeApplied).map(({ description, ...item }) => (void description, item)),
    session: sessionNow(info.profile.session),
  };
}

/** "Did you apply to this?" answered in the web app or the panel: yes saves it as applied, no drops it. */
export async function answerMaybe(userId: string, raw: unknown) {
  const body = (raw ?? {}) as { id?: unknown; applied?: unknown };
  const item = await dropMaybe(userId, { id: String(body.id ?? "") });
  if (!item || body.applied !== true) return { ok: true, application: null };
  const tracked = item.applicationId ? null : await trackedAt(userId, item.url, { title: item.title, company: item.company });
  let app = item.applicationId ? await applications.get(userId, item.applicationId) : tracked!.app;
  if (!app) app = await minimalApplication(userId, { url: item.url, title: item.title, company: item.company || item.site, description: item.description, key: tracked?.key });
  if (app.status !== "submitted" && app.status !== "applied_manual") {
    await applications.update(userId, app.id, { status: "applied_manual", submittedAt: nowIso(), statusMessage: "You said you applied." });
  }
  await addActivity(userId, app.id, { kind: "applied", how: "you_marked" });
  await findPeopleOnApply(userId, app.id);
  return { ok: true, application: summary((await applications.get(userId, app.id))!) };
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
  // Free covers FREE_APPLICATIONS jobs; paid plans have no limit.
  if (created) await ensureCharged(userId, app);
  return { application: summary(app), duplicate: !created, message: created ? "Job added." : "You already added this job." };
}

export async function requireApp(userId: string, applicationId: unknown) {
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
  if (typeof body.autoFindPeople === "boolean") next.autoFindPeople = body.autoFindPeople;
  if (body.weeklyGoal !== undefined) {
    const goal = Math.round(Number(body.weeklyGoal));
    if (!Number.isFinite(goal) || goal < 1 || goal > 200) throw new ServiceError("Pick a weekly goal between 1 and 200 applications.", "goal", 400);
    next.weeklyGoal = goal;
  }
  if (body.spiderSkin !== undefined) {
    const skin = SKINS.find((item) => item.id === body.spiderSkin);
    if (!skin) throw new ServiceError("Pick one of the spiders.", "spider", 400);
    const applied = (await applications.list(userId)).filter((app) => isApplied(app.status)).length;
    if (!skinUnlocked(skin, applied)) throw new ServiceError(`That spider unlocks after ${skin.unlockAt} applications.`, "spider", 403);
    next.spiderSkin = skin.id;
  }
  if (body.savedAnswer && typeof body.savedAnswer === "object") {
    const given = body.savedAnswer as { key?: unknown; answer?: unknown };
    const current = info.profile.saved?.[String(given.key ?? "")];
    if (!current) throw new ServiceError("That saved answer isn't there anymore.", "answer", 404);
    const answer = String(given.answer ?? "").trim().slice(0, 4000);
    if (!answer) throw new ServiceError("Type an answer.", "answer", 400);
    next.saved = { ...info.profile.saved, [String(given.key)]: { ...current, answer, updatedAt: nowIso() } };
  }
  if (typeof body.accountConsent === "boolean") next.accountConsentAt = body.accountConsent ? (info.profile.accountConsentAt && info.profile.accountConsentAt !== CONSENT_BY_DEFAULT ? info.profile.accountConsentAt : nowIso()) : null;
  await applicationProfiles.put(userId, next);
  return { profile: publicProfile(next) };
}

/** Free covers FREE_APPLICATIONS applications; paid plans and school plans have no limit. Credits aren't spent here. */
export async function ensureCharged(userId: string, app: JobApplication) {
  if (app.charged) return;
  const account = await repo.getAccount(userId);
  if (!account || account.plan === "free") {
    const count = await applications.countCharged(userId);
    if (count >= FREE_APPLICATIONS) throw new ServiceError(`Free covers ${FREE_APPLICATIONS} applications. Pro has no limit.`, "credits", 402);
  }
  await applications.update(userId, app.id, { charged: true });
}

/** The student's facts and resume text: the only things the mapping's AI call may use. */
export function runContext(userId: string, info: Awaited<ReturnType<typeof student>>, app: JobApplication) {
  const sources = [info.profileText, info.resumeText].join("\n\n");
  // The student's own details as plain lines: the only facts the AI may use besides the resume.
  const p = info.profile;
  const said = (value: string | undefined) => value?.trim() || "(not set)";
  const facts = [
    `First name: ${said(p.firstName)}`, `Last name: ${said(p.lastName)}`, `Email: ${said(p.email)}`, `Phone: ${said(p.phone)}`,
    `Street address: ${said(p.addressLine1)}`, `City: ${said(p.city)}`, `State: ${said(p.state)}`, `ZIP code: ${said(p.postalCode)}`, `Country: ${said(p.country)}`,
    `LinkedIn: ${said(p.linkedin)}`, `Website: ${said(p.website)}`, `GitHub: ${said(p.github)}`,
    `School: ${said(info.context.school)}`, `Majors: ${said(info.context.majors.join(", "))}`, `Graduation year: ${said(info.context.graduationYear)}`, `Class year: ${said(info.context.classYear)}`,
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

/** `claimed`: the caller already marked the search as running. */
/**
 * A job was just saved as applied: look for people right away, so the list is waiting. Paid plans do this
 * unless the student turned it off; Free only when they turned it on. Credits are spent as usual (only for a
 * list with an email).
 */
export async function findPeopleOnApply(userId: string, applicationId: string) {
  const [app, account, stored] = await Promise.all([applications.get(userId, applicationId), repo.getAccount(userId), applicationProfiles.get(userId)]);
  if (!app || app.contactsStatus !== "idle" || (app.status !== "submitted" && app.status !== "applied_manual")) return false;
  const on = account && account.plan !== "free" ? stored?.autoFindPeople !== false : stored?.autoFindPeople === true;
  if (!on || companyMissing(app)) return false;
  await applications.update(userId, app.id, { contactsStatus: "finding", contactsMessage: `Searching for relevant people at ${app.company}…` });
  startContacts(userId, app.id, true);
  return true;
}

export function startContacts(userId: string, applicationId: string, claimed = false) {
  defer(async () => {
    await runContactDiscovery(userId, applicationId, claimed).catch((error) => console.error("contact discovery failed", error));
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
  await addActivity(userId, app.id, { kind: "applied", how: "you_marked" });
  await dropMaybe(userId, { applicationId: app.id });
  await findPeopleOnApply(userId, app.id);
  return { application: summary((await applications.get(userId, app.id)) ?? updated!) };
}

const STALE_MS = 5 * 60 * 1000;

const contactsBusy = (app: JobApplication) => (app.contactsStatus === "finding" || app.contactsStatus === "writing") && Date.now() - Date.parse(app.updatedAt) < STALE_MS;

/** Finds the best person, then writes their email. Safe to retry; a run already in progress is left alone. */
export async function runContactDiscovery(userId: string, applicationId: string, claimed = false) {
  const app = await applications.get(userId, applicationId);
  if (!app || (app.status !== "submitted" && app.status !== "applied_manual")) return;
  if (!claimed) {
    if (contactsBusy(app)) return;
    await applications.update(userId, app.id, { contactsStatus: "finding", contactsMessage: "Finding the best person to connect with…" });
  }
  // 1 credit finds 1 person, spent only when one with a verified email turns up. With none left, nothing is looked up.
  const paidKey = `person:${userId}:${app.id}`;
  const alreadyPaid = Boolean(app.fillReport?.personCharged);
  const unlimited = await hasUnlimitedCredits(userId);
  if (!alreadyPaid && !unlimited && ((await repo.getAccount(userId))?.balance ?? 0) < 1) {
    await applications.update(userId, app.id, { contactsStatus: "done", contactsMessage: "You're out of credits. 1 credit finds the people at a company for one job." });
    return;
  }
  let found: Awaited<ReturnType<typeof findPeopleForApplication>>;
  const info = await student(userId);
  try {
    // Each step is saved as the job's message, so the page's spider can say what it's doing.
    found = await findPeopleForApplication(userId, app, {
      school: info.context.school,
      progress: async (text) => { await applications.update(userId, app.id, { contactsMessage: text }); },
    });
  } catch (error) {
    // Apollo's own messages mention search credits, which don't apply here; the application credit covers this.
    const reason = error instanceof ServiceError ? error.message.replace(/\s*No credits were used\.?/i, "") : "Couldn't look up people right now.";
    await applications.update(userId, app.id, { contactsStatus: "failed", contactsMessage: `${reason} Try again.` });
    return;
  }
  let charged = alreadyPaid;
  // 1 credit for the job's list of people, once, and only when someone on it has an email (checked or written
  // from the company's format). Searching again is free; a list with no emails costs nothing.
  if (found.people.some((person) => person.email) && !charged && !unlimited) {
    const spent = await repo.spendCredits({ userId, amount: 1, idempotencyKey: paidKey, note: `A person at ${app.company.slice(0, 80)}`, entryType: "unlock_debit" });
    if (spent.insufficient) {
      await applications.update(userId, app.id, { contactsStatus: "done", contactsMessage: "You're out of credits. 1 credit finds the people at a company for one job." });
      return;
    }
    charged = true;
  }
  await applicationContacts.replace(userId, app.id, found.people.map((person) => ({ rank: person.rank, role: person.role, name: person.name, title: person.title, email: person.email, emailSource: person.emailSource, relevance: person.relevance, linkedinUrl: person.linkedinUrl, photoUrl: person.photoUrl, applicationId: app.id, userId, emailSubject: null, emailBody: null })));
  const peopleLinks = Object.fromEntries(found.people.filter((person) => person.links.length).map((person) => [person.name.toLowerCase(), person.links]));
  // What each search found is kept with the application, so "no one found" can be traced.
  const latest = (await applications.get(userId, app.id)) ?? app;
  const report = latest.fillReport ?? { filled: [], failed: [], liveViewUrl: null, screenshotAt: null };
  // Emails are written only when the student asks, one person at a time.
  await applications.update(userId, app.id, { companyDomain: found.domain, contactsStatus: "done", contactsMessage: found.notes.join(" "), fillReport: { ...report, peopleSearch: found.search, peopleLinks, ...(charged ? { personCharged: true } : {}) } });
}

/**
 * One person's email: written by AI when the student presses "Write email", or the student's own edits to it
 * (`subject` and `body`), saved as typed.
 */
export async function writeContactEmail(userId: string, raw: unknown) {
  const body = (raw ?? {}) as { applicationId?: unknown; contactId?: unknown; subject?: unknown; body?: unknown; followUp?: unknown };
  const app = await requireApp(userId, body.applicationId);
  const contact = (await applicationContacts.list(userId, [app.id])).find((row) => row.id === String(body.contactId ?? ""));
  if (!contact) throw new ServiceError("That contact wasn't found.", "not_found", 404);
  if (typeof body.body === "string") {
    const text = body.body.replace(/\r\n/g, "\n").trim().slice(0, 4000);
    if (!text) throw new ServiceError("The email is empty.", "body", 400);
    const row = await applicationContacts.update(userId, contact.id, { emailSubject: String(body.subject ?? contact.emailSubject ?? "").trim().slice(0, 200), emailBody: text });
    return { contact: row };
  }
  const info = await student(userId);
  // "Write follow-up": a short nudge on the email already sent, which stays in the thread.
  const followUp = body.followUp === true && contact.emailBody ? { subject: contact.emailSubject ?? "", body: contact.emailBody, sentAt: app.fillReport?.emailedAt?.[contact.id] ?? null } : undefined;
  const [email] = await writeOutreachEmails(userId, app, [contact], { name: info.user.name, resumeText: info.resumeText, profile: info.profileText }, { followUp }).catch((error: unknown) => {
    throw new ServiceError(`The email couldn't be written. ${error instanceof Error ? error.message : ""}`.trim(), "write_failed", 502);
  });
  if (!email?.body) throw new ServiceError("The email couldn't be written. Try again.", "write_failed", 502);
  const row = await applicationContacts.update(userId, contact.id, { emailSubject: email.subject, emailBody: email.body });
  return { contact: row };
}

/** "Find me the best person to connect with": starts the search, marked running right away so the page shows it. */
export async function retryContacts(userId: string, raw: unknown) {
  const app = await requireApp(userId, (raw as { applicationId?: unknown } | null)?.applicationId);
  if (app.status !== "submitted" && app.status !== "applied_manual") throw new ServiceError("People are found after you apply.", "state", 409);
  if (contactsBusy(app)) return { ok: true };
  // The student can give the company's website when Unnepo couldn't find it.
  const website = String((raw as { website?: unknown } | null)?.website ?? "").trim();
  const domain = website ? siteDomain(/^https?:\/\//i.test(website) ? website : `https://${website}`) : null;
  if (website && !domain) throw new ServiceError("That doesn't look like the company's own website. Try something like acme.com.", "website", 400);
  await applications.update(userId, app.id, { ...(domain ? { companyDomain: domain } : {}), contactsStatus: "finding", contactsMessage: "Finding the best person to connect with…" });
  startContacts(userId, app.id, true);
  return { ok: true };
}

export async function updateOutreach(userId: string, raw: unknown) {
  const body = (raw ?? {}) as { contactId?: unknown; status?: unknown; followedUp?: unknown };
  const status = String(body.status) as OutreachState;
  if (!OUTREACH_STATES.includes(status)) throw new ServiceError("Choose a valid status.", "status", 400);
  const row = await applicationContacts.update(userId, String(body.contactId ?? "").slice(0, 80), { outreachStatus: status });
  if (!row) throw new ServiceError("That contact wasn't found.", "not_found", 404);
  // When they were emailed, for the reminder to follow up five business days later.
  const app = await applications.get(userId, row.applicationId);
  if (app) {
    const report = app.fillReport ?? { filled: [], failed: [], liveViewUrl: null, screenshotAt: null };
    const emailedAt = { ...(report.emailedAt ?? {}) };
    // "I sent the follow-up" starts the five business days again.
    if (status === "emailed") emailedAt[row.id] = body.followedUp === true ? nowIso() : emailedAt[row.id] ?? nowIso();
    else delete emailedAt[row.id];
    await applications.update(userId, app.id, { fillReport: { ...report, emailedAt } });
  }
  return { contact: row };
}

const OUTCOMES = ["assessment", "interviewing", "offer", "rejected"] as const;

/** The student's own note of what happened after applying: an assessment, interviewing, an offer, or a rejection. */
export async function setOutcome(userId: string, raw: unknown) {
  const body = (raw ?? {}) as { applicationId?: unknown; outcome?: unknown };
  const app = await requireApp(userId, body.applicationId);
  if (app.status !== "submitted" && app.status !== "applied_manual") throw new ServiceError("Mark the job as applied first.", "state", 409);
  const outcome = OUTCOMES.find((item) => item === body.outcome) ?? null;
  if (body.outcome && !outcome) throw new ServiceError("Choose assessment, interviewing, offer, or rejected.", "outcome", 400);
  const report = app.fillReport ?? { filled: [], failed: [], liveViewUrl: null, screenshotAt: null };
  const history = outcome && outcome !== report.outcome ? [...(report.statusHistory ?? []), { at: nowIso(), status: outcome, source: "you" as const, summary: "You changed the status." }].slice(-50) : report.statusHistory;
  const updated = await applications.update(userId, app.id, { fillReport: { ...report, outcome, statusHistory: history } });
  return { application: summary(updated!) };
}

export async function deleteApplication(userId: string, raw: unknown) {
  const app = await requireApp(userId, (raw as { applicationId?: unknown } | null)?.applicationId);
  await applications.remove(userId, app.id);
  return { ok: true };
}
