import { APPLIED_HOW, addActivity, addMaybe, dropMaybe, liveMaybe, sessionNow } from "@/lib/apply/activity";
import { nameCompanyFromDescription } from "@/lib/apply/job-link";
import { CREDIT_COST } from "@/lib/config";
import { CLASS_YEARS, classYearOf, type StudentProfile } from "@/lib/profile/student";
import { followUpsDue } from "@/lib/apply/follow-ups";
import { assertCoverLetterAllowed, assertUseAllowed, countCoverLetter, countUse, isFree, planUsage } from "@/lib/apply/limits";
import { isAdminEmail } from "@/lib/services/auth";
import { mergeRepeats } from "@/lib/apply/merge-repeats";
import { dataDir, nowIso, repo } from "@/lib/db/file-store";
import { ServiceError } from "@/lib/errors";
import { coverLetterPdf, LETTER_FORMATS, rewriteLetterPart, writeCoverLetter, type CoverLetterStyle } from "@/lib/apply/cover-letter";
import { answerMaybe, companyMissing, contactBounced, createApplication, findPeopleOnApply, markApplied, setReachedOut, minimalApplication, trackedAt, repairCompanies, answerWith, ensureCharged, learnAnswers, requireApp, retryContacts, revealContact, runContext, runLater, setOutcome, setJobHidden, student, summary, titleMissing, updateOutreach, writeContactEmail } from "@/lib/apply/service";
import { postingLink } from "@/lib/apply/applied-list";
import { extractJob, findPostedRecruiter, isJobSiteName } from "@/lib/apply/extract";
import { buildMapping, claudeAsk, greenhouseSchema, knownAnswers, logTimings } from "@/lib/apply/fast/pipeline";
import type { FormSchema, SchemaField, SchemaFieldType } from "@/lib/apply/fast/schema";
import { WRITING_STYLE, classifyQuestion, normalizeLabel, plainWriting, shortAnswer } from "@/lib/apply/questions";
import { applicationContacts, applicationProfiles, applications } from "@/lib/apply/store";
import { isApplied } from "@/lib/apply/stats";
import { wornSkin } from "@/lib/spiders";
import type { ApplicationContact, FillAttempt, FillProblem, JobApplication, PostedRecruiter } from "@/lib/apply/types";
import { profileReady, profileState, saveStudentProfile } from "@/lib/profile/service";
import { readStoredResume, saveResumeBytes } from "@/lib/services/resume";

/**
 * What the Chrome extension calls. The extension fills forms in the student's own browser; the server
 * holds the profile, reads job boards, prepares answers (at most one AI call per form, cached by
 * question), and records submissions.
 */

// A day's AI calls from the extension: high enough for unlimited Pro (a full form's questions, many times), low enough to stop a script.
const DAILY_AI_CALLS = Number(process.env.EXTENSION_DAILY_AI_CALLS || 150);
/** Answers the model wrote, cached by question so the same question never costs a second call. */
const CACHE_LIMIT = 400;

/**
 * The questions that hold up most applications, asked once before the first fill: pay, start date,
 * relocating, working in person, work authorization, sponsorship, and year in school. Each says whether
 * it's answered yet.
 */
function setupState(student: StudentProfile) {
  const school = student.education[0];
  return {
    salaryExpectation: student.standardAnswers.salaryExpectation ?? "",
    earliestStart: student.standardAnswers.earliestStart ?? "",
    willingToRelocate: student.contact.willingToRelocate ?? null,
    inPerson: student.standardAnswers.inPerson ?? null,
    authorizedUS: student.workAuth.authorizedUS ?? null,
    needsSponsorship: student.workAuth.needsSponsorship ?? null,
    classYear: school ? classYearOf(school) ?? "" : "",
    hasSchool: Boolean(school),
  };
}

/** Saves the setup card's answers into the profile. Blank ones are left as they were. */
export async function extensionSetup(userId: string, raw: unknown) {
  const body = (raw ?? {}) as Record<string, unknown>;
  const { profile: student } = await profileState(userId);
  const yesNo = (value: unknown) => (value === true || value === false ? value : undefined);
  const text = (value: unknown, max: number) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined);
  const classYear = CLASS_YEARS.find(([value]) => value === body.classYear)?.[0];
  const patch = {
    contact: { ...(yesNo(body.willingToRelocate) !== undefined ? { willingToRelocate: yesNo(body.willingToRelocate) } : {}) },
    standardAnswers: {
      ...(text(body.salaryExpectation, 80) ? { salaryExpectation: text(body.salaryExpectation, 80) } : {}),
      ...(text(body.earliestStart, 80) ? { earliestStart: text(body.earliestStart, 80) } : {}),
      ...(yesNo(body.inPerson) !== undefined ? { inPerson: yesNo(body.inPerson) } : {}),
    },
    workAuth: {
      ...(yesNo(body.authorizedUS) !== undefined ? { authorizedUS: yesNo(body.authorizedUS) } : {}),
      ...(yesNo(body.needsSponsorship) !== undefined ? { needsSponsorship: yesNo(body.needsSponsorship) } : {}),
    },
    ...(classYear && student.education[0] ? { education: [{ ...student.education[0], classYear }, ...student.education.slice(1)] } : {}),
  };
  const state = await saveStudentProfile(userId, { profile: patch });
  return { setup: setupState(state.profile) };
}

export async function extensionMe(userId: string) {
  const [user, credits, state, resume, stored, saved, usage] = await Promise.all([repo.getUserById(userId), repo.getAccount(userId), profileState(userId), repo.getLatestResume(userId), applicationProfiles.get(userId), applications.appliedTimes(userId), planUsage(userId)]);
  const applied = saved.filter((app) => isApplied(app.status));
  const weekAgo = Date.now() - 8 * 86_400_000;
  return {
    // The panel's Day / Week goal. The panel counts them, so "today" is the student's own day.
    goal: { weekly: stored?.weeklyGoal ?? null, daily: stored?.dailyGoal ?? null, appliedAt: applied.filter((app) => !app.notCounted).map((app) => app.submittedAt ?? app.createdAt).filter((at) => Date.parse(at) >= weekAgo) },
    user: { name: user?.name ?? "", email: user?.email ?? "" },
    credits: credits?.balance ?? 0,
    unlimitedCredits: usage.unlimited,
    setup: setupState(state.profile),
    // What the cover letter popup offers to mention, as bubbles.
    highlights: resumeHighlights(state.profile),
    creditCost: { letters: CREDIT_COST.letters, answers: CREDIT_COST.answers },
    maybe: liveMaybe(stored?.maybeApplied).map(({ id, title, company, site, at }) => ({ id, title, company, site, at })),
    session: sessionNow(stored?.session),
    // What the account is on (billing), and what it works as: Pro during the trial.
    plan: credits?.plan ?? "free",
    effectivePlan: usage.plan,
    // Admins can switch what the account works as (Free or Pro) to see both.
    admin: user ? await isAdminEmail(user) : false,
    planPreview: usage.preview ?? null,
    trial: usage.trial,
    trialEnded: usage.trialEnded,
    coverLetters: { used: usage.letters.used, left: usage.free ? usage.letters.left : null },
    profileReady: state.ready,
    completeness: state.profile.completeness,
    // What the panel lists under "Missing": the parts of the profile still to fill in, required ones first.
    // What's left on the plan: credits, each kind of use, and a line for anything running low.
    usage,
    // The resume the extension attaches. `file` is false when only its text was kept, so it must be uploaded again.
    resume: resume ? { fileName: resume.fileName, uploadedAt: resume.createdAt, file: Boolean(resume.storagePath) && resume.byteSize > 0 } : null,
    missing: [...state.missing].sort((a, b) => Number(a.optional) - Number(b.optional)).map((gap) => gap.title).slice(0, 3),
    // The spider the student wears from the Stats page, for the panel and the crawling spiders.
    spider: { skin: wornSkin(stored?.spiderSkin, applied.length), school: state.profile.education?.[0]?.school ?? "" },
  };
}

/** The student's jobs, projects and top skills from their resume, each short enough for a bubble. */
function resumeHighlights(profile: Pick<StudentProfile, "experience" | "projects" | "skills">) {
  const jobs = (profile.experience ?? []).map((job) => {
    const both = [job.title, job.company].filter(Boolean).join(" at ");
    return both.length <= 44 ? both : job.company || job.title || "";
  });
  const pick = (items: Array<string | undefined>, count: number) => items.map((item) => item?.trim() ?? "").filter((item) => item && item.length <= 44).slice(0, count);
  return [...new Set([...pick(jobs, 4), ...pick((profile.projects ?? []).map((project) => project.name), 3), ...pick(profile.skills?.technical ?? [], 3)])];
}

/** Everything the extension fills forms from. Passwords for job sites stay in the extension. */
export async function extensionProfile(userId: string) {
  const [state, stored] = await Promise.all([profileState(userId), applicationProfiles.get(userId)]);
  const resume = await repo.getLatestResume(userId);
  return {
    profile: state.profile,
    ready: state.ready,
    consentToTerms: Boolean(stored?.accountConsentAt),
    accountEmail: state.profile.accountEmail || state.profile.contact.email,
    resume: resume?.storagePath ? { fileName: resume.fileName, mime: resume.mime || "application/pdf", byteSize: resume.byteSize } : null,
  };
}

export async function extensionResume(userId: string) {
  const resume = await repo.getLatestResume(userId);
  const bytes = resume?.storagePath ? await readStoredResume(resume.storagePath) : null;
  if (!resume) throw new ServiceError("Upload a resume in Unnepo first.", "no_resume", 404);
  if (!bytes?.byteLength) throw new ServiceError("Unnepo has your resume's text but not the file. Upload it again.", "no_resume_file", 404);
  return { bytes, fileName: resume.fileName, mime: resume.mime || "application/pdf" };
}

/** A job the extension is on. Unnepo reads it when it can; otherwise it keeps what the page showed. */
/** LinkedIn's "Meet the hiring team" person as the extension read it, checked. */
export function pagePoster(raw: unknown): PostedRecruiter | null {
  const poster = (raw ?? {}) as { name?: unknown; title?: unknown; profileUrl?: unknown };
  const name = typeof poster.name === "string" ? poster.name.replace(/\s+/g, " ").trim().slice(0, 80) : "";
  if (name.split(" ").length < 2) return null;
  const profile = typeof poster.profileUrl === "string" ? poster.profileUrl.trim() : "";
  const linkedinUrl = /^https:\/\/([a-z]+\.)?linkedin\.com\/in\/[^/?#\s]+\/?$/i.test(profile) ? profile : null;
  const title = typeof poster.title === "string" && poster.title.trim() ? poster.title.trim().slice(0, 160) : "Job poster";
  return { name, title, email: null, linkedinUrl };
}

/** Opens (or reuses) the application for the job the extension is on. A new job spends credits as usual. */
export async function extensionJob(userId: string, raw: unknown) {
  const result = await openJob(userId, raw);
  await addActivity(userId, result.application.id, { kind: "opened" });
  return result;
}

/** What the extension sends as it works: a form filled (how many fields, how many left for the student, how long). */
export async function extensionActivity(userId: string, raw: unknown) {
  const body = (raw ?? {}) as { applicationId?: unknown; kind?: unknown; fields?: unknown; needs?: unknown; ms?: unknown };
  const app = await requireApp(userId, body.applicationId);
  if (body.kind !== "filled") throw new ServiceError("Unknown event.", "kind", 400);
  const count = (value: unknown, max: number) => Math.max(0, Math.min(max, Math.round(Number(value) || 0)));
  await addActivity(userId, app.id, { kind: "filled", fields: count(body.fields, 500), needs: count(body.needs, 500), ms: count(body.ms, 3_600_000) });
  return { ok: true };
}

/** The panel's "Did you apply?" list: add one, or answer one. */
export async function extensionMaybe(userId: string, raw: unknown) {
  const body = (raw ?? {}) as { action?: unknown; item?: unknown; id?: unknown; applied?: unknown; url?: unknown; applicationId?: unknown };
  if (body.action === "add") return addMaybe(userId, body.item);
  if (body.action === "answer") return answerMaybe(userId, { id: body.id, applied: body.applied });
  if (body.action === "drop") {
    await dropMaybe(userId, { url: typeof body.url === "string" ? body.url : undefined, applicationId: typeof body.applicationId === "string" ? body.applicationId : undefined });
    return { ok: true };
  }
  throw new ServiceError("Unknown action.", "action", 400);
}

/**
 * LinkedIn's "Meet the hiring team" person, kept on the job and listed with its people as soon as the page shows
 * them, tagged "Shown on job posting", whether or not a people search has run (a later search keeps them first).
 */
async function notePoster(userId: string, app: JobApplication, poster: PostedRecruiter | null) {
  const named = poster ?? app.postedRecruiter;
  if (!named) return app;
  const current = app.postedRecruiter ? app : (await applications.update(userId, app.id, { postedRecruiter: named })) ?? app;
  const people = await applicationContacts.list(userId, [app.id]);
  const same = (name: string) => name.trim().toLowerCase() === named.name.trim().toLowerCase();
  if (!people.some((person) => person.role === "job_poster" || same(person.name))) {
    await applicationContacts.add(userId, {
      applicationId: app.id, userId, rank: 0, role: "job_poster", name: named.name, title: named.title ?? "", email: named.email, emailSource: named.email ? "job_posting" : null,
      relevance: named.linkedinUrl ? "Shown under \"Meet the hiring team\" on this job." : "Named on the job posting.", linkedinUrl: named.linkedinUrl ?? null, photoUrl: null, emailSubject: null, emailBody: null,
    });
  }
  return current;
}

async function openJob(userId: string, raw: unknown) {
  const body = (raw ?? {}) as { url?: unknown; title?: unknown; company?: unknown; description?: unknown; poster?: unknown };
  const url = String(body.url ?? "").trim().slice(0, 2000);
  if (!/^https:\/\//i.test(url)) throw new ServiceError("Open a job application page first.", "job_url", 400);
  // The posting's text as the page shows it (Handshake, which Unnepo can't read on its own).
  const pageDescription = typeof body.description === "string" ? body.description.trim().slice(0, 8000) : "";
  const poster = pagePoster(body.poster);
  const tracked = await trackedAt(userId, url, { title: String(body.title ?? ""), company: String(body.company ?? "") });
  const existing = tracked.app;
  if (existing) {
    if (poster) {
      const noted = await notePoster(userId, existing, existing.postedRecruiter ? null : poster);
      return { application: summary(pageDescription && !noted.description ? (await applications.update(userId, existing.id, { description: pageDescription }))! : noted), created: false };
    }
    if (pageDescription && !existing.description) return { application: summary((await applications.update(userId, existing.id, { description: pageDescription, postedRecruiter: existing.postedRecruiter ?? findPostedRecruiter(pageDescription) }))!), created: false };
    return { application: summary(existing), created: false };
  }
  // The fast way: open the job from what the page shows, so filling starts right away, and read the posting
  // (description, requirements, recruiter) in the background for the cover letter and the people search.
  const pageTitle = String(body.title ?? "").trim();
  const pageCompany = String(body.company ?? "").trim();
  if (pageTitle && pageCompany) {
    if (!(await profileReady(userId))) throw new ServiceError("Finish your profile first so Unnepo has your details to apply with.", "profile", 400);
    const app = await minimalApplication(userId, { url, title: pageTitle, company: pageCompany, description: pageDescription, poster, key: tracked.key });
    if (poster) await notePoster(userId, app, null);
    runLater(async () => {
      if (!pageDescription) await enrichFromPosting(userId, app.id, url);
      await preWriteLetter(userId, app.id);
    });
    return { application: summary(app), created: true };
  }
  try {
    const result = await createApplication(userId, { url });
    return { application: result.application, created: !result.duplicate };
  } catch (error) {
    // Pages Unnepo can't read on its own (a signed-in portal, an unknown job system) still get tracked.
    const title = String(body.title ?? "").trim();
    const company = String(body.company ?? "").trim();
    if (error instanceof ServiceError && (error.code === "credits" || error.code === "profile" || error.code === "job_url")) throw error;
    if (!title || !company) throw error;
    return { application: summary(await minimalApplication(userId, { url, title, company, description: pageDescription, poster, key: tracked.key })), created: true };
  }
}

/** The student's jobs for the panel's "My jobs": the newest first, with just what the list shows. */
export async function extensionJobs(userId: string) {
  const apps = await repairCompanies(userId, await mergeRepeats(userId, await applications.list(userId)));
  return {
    jobs: apps.slice(0, 30).map((app) => ({
      id: app.id, title: app.title, company: app.company, status: app.status, url: app.applicationUrl || app.jobUrl,
      submittedAt: app.submittedAt, createdAt: app.createdAt,
    })),
    total: apps.length,
    // People emailed five business days ago or more with no reply: the panel points to the tracker.
    followUpsDue: apps.some((app) => Object.keys(app.fillReport?.emailedAt ?? {}).length) ? followUpsDue(await withContacts(userId, apps)).length : 0,
  };
}

/**
 * The extension's tracker: every job with its people, for Home's reminders, a job's own page and the dashboard.
 * Reminders are worked out in the extension (lib/apply/next-up.ts), in the student's own time.
 */
export async function extensionTracker(userId: string) {
  const apps = await repairCompanies(userId, await mergeRepeats(userId, await applications.list(userId)));
  const [contacts, usage, stored] = await Promise.all([applicationContacts.list(userId, apps.map((app) => app.id)), planUsage(userId), applicationProfiles.get(userId)]);
  return {
    jobs: apps.map((app) => trackerJob(app, contacts.filter((contact) => contact.applicationId === app.id))),
    weeklyGoal: stored?.weeklyGoal ?? null,
    free: usage.free,
    peopleNote: usage.people.note,
    peopleBadge: usage.people.badge,
  };
}

export type TrackerJob = ReturnType<typeof trackerJob>;

function trackerJob(app: JobApplication, people: ApplicationContact[]) {
  const report = app.fillReport;
  return {
    id: app.id, title: app.title, company: app.company, status: app.status, location: app.location, department: app.department,
    createdAt: app.createdAt, submittedAt: app.submittedAt, updatedAt: app.updatedAt,
    url: postingLink(app) || (app.applicationUrl && /^https:\/\//i.test(app.applicationUrl) ? app.applicationUrl : ""),
    companyMissing: companyMissing(app), titleMissing: titleMissing(app.title),
    contactsStatus: app.contactsStatus, contactsMessage: app.contactsMessage,
    confirmation: app.confirmation ? { confidence: app.confirmation.confidence } : null,
    postedRecruiter: app.postedRecruiter ? { name: app.postedRecruiter.name, title: app.postedRecruiter.title, email: app.postedRecruiter.email, linkedinUrl: app.postedRecruiter.linkedinUrl } : null,
    fillReport: report ? {
      outcome: report.outcome ?? null, statusHistory: report.statusHistory, lastEmailAt: report.lastEmailAt, emailedAt: report.emailedAt, reachedOut: report.reachedOut,
      notCounted: report.notCounted, jobHidden: report.jobHidden === true, peopleReveals: report.peopleReveals ?? 0, peopleLinks: report.peopleLinks,
      peoplePreview: report.peoplePreview ? { rows: report.peoplePreview.rows } : undefined,
      peopleLocked: report.peopleLocked ?? 0,
    } : null,
    /** People on the list Unnepo can still look up ("Show person"), by lowercase name. */
    hidden: Object.keys(report?.peopleHidden ?? {}),
    contacts: people.sort((a, b) => a.rank - b.rank).map((person) => ({
      id: person.id, name: person.name, title: person.title, role: person.role, email: person.email, emailSource: person.emailSource,
      relevance: person.relevance, linkedinUrl: person.linkedinUrl, outreachStatus: person.outreachStatus, emailSubject: person.emailSubject, emailBody: person.emailBody,
    })),
  };
}

/**
 * The People card: find people at the company (after applying), show one more, write an email to one (or a
 * follow-up), mark them emailed or replied, or say an address bounced. Credits are spent as on the website.
 */
export async function extensionPeople(userId: string, raw: unknown) {
  const body = (raw ?? {}) as { action?: unknown; applicationId?: unknown; contactId?: unknown; website?: unknown; status?: unknown; followUp?: unknown; followedUp?: unknown; subject?: unknown; body?: unknown };
  const app = await requireApp(userId, body.applicationId);
  const forApp = async () => (await applicationContacts.list(userId, [app.id])).find((row) => row.id === String(body.contactId ?? ""));
  switch (body.action) {
    case "find": return retryContacts(userId, { applicationId: app.id, website: body.website });
    case "reveal": return revealContact(userId, { applicationId: app.id, contactId: body.contactId });
    case "write": return writeContactEmail(userId, { applicationId: app.id, contactId: body.contactId, followUp: body.followUp === true, ...(typeof body.body === "string" ? { subject: body.subject, body: body.body } : {}) });
    case "status": {
      // Only someone on this job's list.
      if (!(await forApp())) throw new ServiceError("That person wasn't found.", "not_found", 404);
      return updateOutreach(userId, { contactId: body.contactId, status: body.status, followedUp: body.followedUp === true });
    }
    case "bounced": return contactBounced(userId, { applicationId: app.id, contactId: body.contactId });
    default: throw new ServiceError("Unknown action.", "action", 400);
  }
}

/** A job's status from the extension: applied (the student says so), or what happened after (interviewing, rejected…). */
export async function extensionStatus(userId: string, raw: unknown) {
  const body = (raw ?? {}) as { applicationId?: unknown; applied?: unknown; outcome?: unknown; reachedOut?: unknown; hidden?: unknown };
  if (typeof body.hidden === "boolean") return setJobHidden(userId, { applicationId: body.applicationId, hidden: body.hidden });
  if (body.reachedOut !== undefined && body.reachedOut !== null) return setReachedOut(userId, { applicationId: body.applicationId, count: body.reachedOut });
  if (body.applied === true) return markApplied(userId, { applicationId: body.applicationId });
  return setOutcome(userId, { applicationId: body.applicationId, outcome: body.outcome || null });
}

async function withContacts(userId: string, apps: JobApplication[]) {
  const contacts = await applicationContacts.list(userId, apps.map((app) => app.id));
  return apps.map((app) => ({ ...app, contacts: contacts.filter((contact) => contact.applicationId === app.id) }));
}

/**
 * Paid plans: the cover letter is written as soon as a job is opened, so it's ready when the form asks or the
 * student presses Write. Free writes one only when asked, since it has a daily number.
 */
async function preWriteLetter(userId: string, applicationId: string) {
  const [free, app] = await Promise.all([isFree(userId), applications.get(userId, applicationId)]);
  if (free || !app || app.fillReport?.coverLetter || !app.description.trim()) return;
  const info = await student(userId);
  const name = [info.profile.firstName, info.profile.lastName].filter(Boolean).join(" ") || info.user.name;
  const text = await writeCoverLetter(userId, app, { name, resumeText: info.resumeText, profile: info.profileText });
  if (!text) return;
  const latest = (await applications.get(userId, applicationId)) ?? app;
  if (latest.fillReport?.coverLetter) return;
  await applications.update(userId, applicationId, { fillReport: { ...(latest.fillReport ?? { filled: [], failed: [], liveViewUrl: null, screenshotAt: null }), coverLetter: text } });
}

/** Fills in a quickly-opened job from its posting. Best effort: a posting Unnepo can't read keeps the page's details. */
async function enrichFromPosting(userId: string, applicationId: string, url: string) {
  try {
    const job = await extractJob(url);
    const saved = await applications.get(userId, applicationId);
    await applications.update(userId, applicationId, {
      ats: job.ats, department: job.department, location: job.location, description: job.description,
      requirements: job.requirements, applicationUrl: job.applicationUrl, postedRecruiter: job.postedRecruiter ?? saved?.postedRecruiter ?? null,
      ...(job.title ? { title: job.title } : {}), ...(job.company && !isJobSiteName(job.company) ? { company: job.company } : {}),
    });
  } catch {
    // Signed-in portals and unknown job systems: the title and company from the page stay.
  }
}

/** A field the extension found on the page. Its id is the extension's own reference for it. */
type PageField = { id?: unknown; label?: unknown; type?: unknown; options?: unknown; required?: unknown; section?: unknown; format?: unknown };

const TYPES: Record<string, SchemaFieldType> = {
  text: "text", email: "email", tel: "tel", textarea: "textarea", file: "file", select: "select", combobox: "select", radio: "select",
  checkbox: "select", multiselect: "multiselect", date: "text", url: "text", number: "text",
};

function schemaFromPage(app: JobApplication, fields: PageField[]): FormSchema {
  return {
    ats: app.ats, board: "", jobId: "", formUrl: app.applicationUrl ?? app.jobUrl, title: app.title, company: app.company, description: app.description.slice(0, 6000),
    fields: fields.slice(0, 200).flatMap((field): SchemaField[] => {
      const id = String(field.id ?? "").slice(0, 200);
      const label = String(field.label ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
      if (!id || !label) return [];
      const kind = String(field.type ?? "text");
      const options = (Array.isArray(field.options) ? field.options : kind === "checkbox" ? ["Yes"] : []).map(String).map((option) => option.trim()).filter(Boolean).slice(0, 100);
      const section = String(field.section ?? "").slice(0, 120);
      return [{
        id, label, type: TYPES[kind] ?? "text", required: Boolean(field.required), options: options.map((option) => ({ label: option, value: option })),
        section: /self-identif|eeo|voluntary|demographic/i.test(section) ? "eeoc" : /education/i.test(section) ? "education" : "question",
        sensitive: classifyQuestion(label).sensitive, sectionLabel: section || undefined, format: typeof field.format === "string" ? field.format.slice(0, 20) : null,
      }];
    }),
  };
}

const cacheKey = (field: SchemaField) => `${normalizeLabel(field.label)}|${field.options.map((option) => option.label.toLowerCase()).sort().join("/")}`.slice(0, 400);

async function aiCallsToday(userId: string) {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  return (await repo.listUsage(start.toISOString())).filter((row) => row.userId === userId && (row.operation === "application_mapping" || row.operation === "question_draft")).length;
}

const DRAFT_PROMPT = `You draft one answer to a job application question for a college student, who will read it and edit it before sending.
Use only facts from the student's resume and profile and the job posting. Never invent experience, numbers, skills, employers, or anything about the student.
If the question asks for a fact the resume and profile don't give (a date, a number, a yes or no about them), reply with exactly: NONE
${WRITING_STYLE}
Reply with only the answer text, no quotes and no preamble.`;

/** The orange questions Unnepo couldn't fill: a short draft for one, on the student's request, for them to check. */
/** A job as the extension read it off the page: title and company, with the posting's text when there was one. */
function pageJob(raw: unknown) {
  const job = (raw ?? {}) as { title?: unknown; company?: unknown; description?: unknown };
  const text = (value: unknown, max: number) => String(value ?? "").replace(/[ \t]+/g, " ").trim().slice(0, max);
  const title = text(job.title, 200);
  const company = text(job.company, 200);
  if (title.length < 2 || company.length < 2) return null;
  return { title, company, description: text(job.description, 8000) };
}

export async function extensionWrite(userId: string, raw: unknown) {
  const body = (raw ?? {}) as { applicationId?: unknown; question?: unknown; length?: unknown; job?: unknown; batch?: unknown };
  const question = String(body.question ?? "").replace(/\s+/g, " ").trim().slice(0, 600);
  // The student's choice in the panel. Without one (the orange questions on a form), a short draft.
  const length = body.length === "paragraph" || body.length === "long" ? body.length : null;
  if (!question) throw new ServiceError("Which question should Unnepo write?", "question", 400);
  if (classifyQuestion(question).sensitive) throw new ServiceError("Unnepo doesn't answer questions about you like this one. Answer it yourself.", "sensitive", 400);
  // No job: a question pasted in the panel, answered from the student's details alone.
  const app = body.applicationId ? await requireApp(userId, body.applicationId) : null;
  // Or the job the extension read off the page ("Answer complex questions"), which isn't in the tracker.
  const read = app ? null : pageJob(body.job);
  await assertUseAllowed(userId, "answers");
  if ((await aiCallsToday(userId)) >= DAILY_AI_CALLS) throw new ServiceError("That's today's AI limit. Write this one yourself, or try again tomorrow.", "limit", 429);
  const info = await student(userId);
  const context = runContext(userId, info, app ?? { title: "", company: "" });
  const text = await claudeAsk(userId, "question_draft")(DRAFT_PROMPT, [
    `Question: ${question}`,
    ...(length ? [`Length: ${length === "paragraph" ? "one full paragraph, about 4 to 6 sentences" : "a longer answer of 2 or 3 paragraphs"}.`] : []),
    ...(app ? [`Job: ${app.title} at ${app.company}\n${app.description.slice(0, 3500)}`] : read ? [`Job: ${read.title} at ${read.company}\n${read.description.slice(0, 3500)}`] : []),
    `Student's details:\n${context.facts}`,
    `Resume and profile:\n${context.sources.slice(0, 12000)}`,
  ].join("\n\n")).catch(() => {
    throw new ServiceError("Couldn't write that right now. Try again.", "ai_failed", 502);
  });
  const written = plainWriting(text.trim().replace(/^["“]|["”]$/g, ""));
  const answer = (length ? written : shortAnswer(question, written)).slice(0, 4000);
  if (!answer || /^none\.?$/i.test(answer)) throw new ServiceError("Your resume doesn't say enough to answer this one. Answer it yourself.", "no_facts", 422);
  await countUse(userId, "answers");
  return { answer };
}

/**
 * Answers for every field on the form. Greenhouse forms are read from Greenhouse itself; other forms use
 * the fields the extension scanned. The student's own data answers first, then cached AI answers, then at
 * most one AI call for what's left.
 */
export async function extensionMap(userId: string, raw: unknown) {
  const body = (raw ?? {}) as { applicationId?: unknown; fields?: unknown; ai?: unknown };
  const app = await requireApp(userId, body.applicationId);
  // Filling a job again is free once it has counted; a new one needs a use left.
  if (!app.fillReport?.autofillCounted) await assertUseAllowed(userId, "autofills");
  // Free's full autofills answer the questions too, a few a day; after those (or for a job already counted
  // today, still full) it fills the basic fields from the student's own details.
  const free = !app.fillReport?.autofillCounted && (await planUsage(userId)).autofills.basic;
  const fields = Array.isArray(body.fields) ? (body.fields as PageField[]) : [];
  // ai: false answers only from the student's data and saved answers, with no model call, so the extension can
  // start filling at once; it asks again for what's left.
  const skipAi = body.ai === false;
  const started = Date.now();
  let schemaMs = 0;
  let schema: FormSchema;
  if (!fields.length && app.ats === "greenhouse") {
    const read = await greenhouseSchema(app.jobKey);
    schema = read.schema;
    schemaMs = read.ms;
  } else {
    schema = schemaFromPage(app, fields);
  }
  if (!schema.fields.length) throw new ServiceError("No form fields were found on this page.", "no_fields", 400);

  const info = await student(userId);
  const context = runContext(userId, info, app);
  const stored = await applicationProfiles.get(userId);
  const cache = { ...(stored?.aiCache ?? {}) };
  const known = knownAnswers({ answerFor: answerWith(info, app.company), profile: info.profile, school: info.context.school, resumeProfile: info.profile.resumeProfile });
  const fromCache = new Set<string>();
  const knownOrCached = (field: SchemaField) => {
    const answer = known(field);
    if (answer) return answer;
    const hit = free ? null : cache[cacheKey(field)];
    if (!hit) return null;
    fromCache.add(field.id);
    return { value: hit.values.join("\n"), source: "ai" };
  };
  const ai = !free && !skipAi && (await aiCallsToday(userId)) < DAILY_AI_CALLS;
  const mapped = await buildMapping({
    userId, ai, schema, known: knownOrCached, facts: context.facts, sources: context.sources,
    consent: Boolean(info.profile.accountConsentAt), resumeFileName: info.context.resumeFileName,
  });

  // Keep what the model wrote, so this question is free next time on any form.
  let added = 0;
  for (const field of schema.fields) {
    const answer = mapped.answers.get(field.id);
    if (!answer || answer.source !== "ai" || fromCache.has(field.id)) continue;
    cache[cacheKey(field)] = { values: answer.values, why: answer.why ?? "", at: nowIso() };
    added += 1;
  }
  if (added && stored) {
    const entries = Object.entries(cache).sort((a, b) => b[1].at.localeCompare(a[1].at)).slice(0, CACHE_LIMIT);
    await applicationProfiles.put(userId, { ...stored, aiCache: Object.fromEntries(entries) });
  }

  const timings = { pipeline: "fast" as const, schemaMs, mappingMs: mapped.ms, llmCalls: mapped.llmCalls, fallback: [] };
  logTimings(app.id, "extension_map", timings);
  // Read again: the extension may have saved its fill record while the answers were being worked out.
  const latest = (await applications.get(userId, app.id)) ?? app;
  await applications.update(userId, app.id, { fillReport: { ...(latest.fillReport ?? { filled: [], failed: [], liveViewUrl: null, screenshotAt: null }), timings } });
  return {
    applicationId: app.id,
    ats: schema.ats,
    answers: schema.fields.map((field) => {
      const answer = mapped.answers.get(field.id);
      return { id: field.id, label: field.label, type: field.type, required: field.required, values: answer?.values ?? [], source: answer ? (fromCache.has(field.id) ? "cache" : answer.source) : null, why: answer?.why ?? null };
    }),
    llmCalls: mapped.llmCalls,
    aiAvailable: ai,
    // Free: the questions left that Pro would answer ("Pro would answer these 4 questions for you").
    locked: free ? lockedQuestions(schema.fields, mapped.answers) : [],
    ms: Date.now() - started,
  };
}

/** The questions on a form that are left unanswered and that AI would write: not files, not about who the student is. */
export function lockedQuestions(fields: SchemaField[], answers: Map<string, unknown>) {
  return fields
    .filter((field) => !answers.has(field.id) && field.type !== "file" && field.section === "question" && !field.sensitive)
    .map((field) => ({ id: field.id, label: field.label }));
}

/** Fill records kept per application, newest last. */
const ATTEMPTS_PER_APP = 300;
const PROBLEMS = new Set<FillProblem>(["not_on_page", "list_didnt_open", "no_option", "more_choices", "didnt_stick", "no_file", "error"]);

/**
 * What the extension did with each question on a page (site, question, kind of field, way, whether it
 * stuck, and why not), kept in the application's fill report so autofill failures can be counted.
 */
export async function extensionAttempts(userId: string, raw: unknown) {
  const body = (raw ?? {}) as { applicationId?: unknown; attempts?: unknown };
  const app = await requireApp(userId, body.applicationId);
  const at = nowIso();
  const text = (value: unknown, max: number) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  const attempts = (Array.isArray(body.attempts) ? body.attempts : []).slice(0, 200).flatMap((item): FillAttempt[] => {
    const entry = (item ?? {}) as Record<string, unknown>;
    const label = text(entry.label, 200);
    if (!label) return [];
    const problem = PROBLEMS.has(entry.problem as FillProblem) ? (entry.problem as FillProblem) : undefined;
    return [{
      site: text(entry.site, 120).toLowerCase(), label, type: text(entry.type, 30), answer: text(entry.answer, 60), method: text(entry.method, 40), ok: entry.ok === true,
      ...(entry.ok === true ? {} : { problem: problem ?? "error", reason: text(entry.reason, 200) }), at,
    }];
  });
  if (!attempts.length) return { saved: 0, counted: false };
  const report = app.fillReport ?? { filled: [], failed: [], liveViewUrl: null, screenshotAt: null };
  // A successful autofill: at least one answer stuck on the form. Each job counts once.
  const counts = !report.autofillCounted && attempts.some((attempt) => attempt.ok);
  await applications.update(userId, app.id, { fillReport: { ...report, ...(counts ? { autofillCounted: true } : {}), attempts: [...(report.attempts ?? []), ...attempts].slice(-ATTEMPTS_PER_APP) } });
  if (counts) await countUse(userId, "autofills");
  // `counted`: this autofill used one up, so the extension reads the credits left again.
  return { saved: attempts.length, counted: counts };
}

/** Answers the student typed into a form themselves, saved so the same question fills itself next time. */
export async function extensionLearn(userId: string, raw: unknown) {
  const body = (raw ?? {}) as { answers?: unknown };
  const entries = (Array.isArray(body.answers) ? body.answers : []).slice(0, 80).flatMap((item) => {
    const entry = (item ?? {}) as { question?: unknown; answer?: unknown; section?: unknown };
    const label = String(entry.question ?? "").trim().slice(0, 300);
    const value = String(entry.answer ?? "").trim().slice(0, 2000);
    return label && value ? [{ label, value, section: String(entry.section ?? "").slice(0, 120) }] : [];
  });
  if (!entries.length) return { saved: 0 };
  return { saved: await learnAnswers(userId, await student(userId), entries) };
}

/** A cover letter for this job, as text and as a PDF to upload. Written once per job. */
export async function extensionCoverLetter(userId: string, raw: unknown) {
  const body = (raw ?? {}) as { applicationId?: unknown; description?: unknown; job?: unknown; generic?: unknown; length?: unknown; tone?: unknown; format?: unknown; mention?: unknown; edit?: unknown; previous?: unknown; text?: unknown; part?: unknown; ask?: unknown };
  // The job the extension read off the page, used as it is: writing a letter never adds a job to the tracker.
  const read = pageJob(body.job);
  if (read && !body.applicationId && typeof body.description !== "string") body.description = read.description || `${read.title} at ${read.company}`;
  // No job on the page: the student pasted the job description instead. Nothing is opened in the tracker.
  const pasted = !body.applicationId && typeof body.description === "string" ? body.description.trim().slice(0, 8000) : "";
  // Or asked for a generic letter, for no job in particular.
  const generic = !body.applicationId && !pasted && body.generic === true;
  if (!body.applicationId && !generic && !read && pasted.length < 80) throw new ServiceError("Paste the whole job description (at least a few sentences).", "description", 400);
  const app = pasted || generic ? null : await requireApp(userId, body.applicationId);
  const info = await student(userId);
  const name = [info.profile.firstName, info.profile.lastName].filter(Boolean).join(" ") || info.user.name;
  const pick = <T extends string>(value: unknown, allowed: readonly T[]) => (allowed.includes(value as T) ? (value as T) : undefined);
  const style: CoverLetterStyle = {
    length: pick(body.length, ["short", "standard", "detailed"] as const),
    tone: pick(body.tone, ["professional", "warm", "confident", "enthusiastic"] as const),
    format: pick(body.format, LETTER_FORMATS),
    mention: typeof body.mention === "string" ? body.mention.slice(0, 800) : undefined,
    edit: typeof body.edit === "string" ? body.edit.slice(0, 600) : undefined,
    previous: typeof body.previous === "string" ? body.previous.slice(0, 6000) : undefined,
  };
  if (style.edit !== undefined && !style.edit.trim()) throw new ServiceError("Say what you'd like changed.", "edit", 400);
  // The student's choices (or edits) always mean a new letter; otherwise the one already written is reused.
  const asked = Boolean(style.length || style.tone || style.format || style.mention?.trim() || style.edit?.trim());
  // Free writes a general letter (the job's title and company, not its description); Pro tailors it to the posting.
  const free = await isFree(userId);
  const tailored = !free && !generic;
  const job = !tailored && app
    ? { title: app.title, company: app.company, department: app.department, description: "", requirements: [] }
    : !tailored && read ? { title: read.title, company: read.company, department: null, description: "", requirements: [] }
    : !tailored && pasted ? { title: "", company: "", department: null, description: "", requirements: [] }
    : app ?? { title: read?.title ?? "", company: read?.company ?? "", department: null, description: read ? read.description : pasted, requirements: [] };
  // The student selected part of the letter and asked for it changed: only that part is rewritten.
  if (typeof body.part === "string" && typeof body.previous === "string") {
    const how = typeof body.ask === "string" ? body.ask.trim().slice(0, 300) : "";
    if (!how) throw new ServiceError("Say how to change it.", "ask", 400);
    // A rewrite is an AI call like a chat answer, and costs the same.
    await assertUseAllowed(userId, "answers");
    const jobText = app ? `${app.title} at ${app.company}\n${app.requirements.join("\n")}\n${app.description}` : read ? `${read.title} at ${read.company}\n${read.description}` : pasted;
    const rewritten = await rewriteLetterPart(userId, body.previous.slice(0, 6000), body.part.slice(0, 2000), how, { job: jobText, student: { name, resumeText: info.resumeText, profile: info.profileText } });
    if (!rewritten) throw new ServiceError("Couldn't rewrite that part. Select it again and try once more.", "part", 502);
    await countUse(userId, "answers");
    body.text = rewritten;
  }
  // The student edited the letter themselves: their text, as typed, with no AI.
  const own = typeof body.text === "string" ? body.text.replace(/\r\n/g, "\n").trim().slice(0, 6000) : "";
  if (typeof body.text === "string" && !own) throw new ServiceError("The cover letter is empty.", "text", 400);
  // A letter written during the trial (tailored) is still the job's letter after it.
  const reused = !own && !asked ? app?.fillReport?.coverLetter ?? "" : "";
  // A new letter from AI counts toward Free's daily number; the student's own edits and a reused letter don't.
  const fresh = !own && !reused;
  if (fresh) await assertCoverLetterAllowed(userId);
  const text = own || reused || (await writeCoverLetter(userId, job, { name, resumeText: info.resumeText, profile: info.profileText, excluded: info.excluded }, style));
  if (fresh && text) await countCoverLetter(userId);
  if (!text) throw new ServiceError("Couldn't write a cover letter. Add your resume and profile first.", "cover_letter", 409);
  // The newest letter is the one autofill attaches when the form asks for a cover letter.
  if (app && text !== app.fillReport?.coverLetter) await applications.update(userId, app.id, { fillReport: { ...(app.fillReport ?? { filled: [], failed: [], liveViewUrl: null, screenshotAt: null }), coverLetter: text } });
  const pdf = await coverLetterPdf(text, { name, contact: [info.profile.email, info.profile.phone, info.profile.city, info.profile.linkedin.replace(/^https?:\/\/(www\.)?/, "")] });
  return { text, fileName: `${name} Cover Letter.pdf`, pdfBase64: pdf.toString("base64"), addedToApplied: false, tailored: tailored || Boolean(reused && app?.fillReport?.coverLetter), upgrade: free && !generic ? "Pro tailors every letter to the job description." : null };
}

/** Saves the confirmation screenshot the extension took. Only JPEG or PNG, at most about 2 MB. */
async function saveScreenshot(userId: string, applicationId: string, dataUrl: unknown) {
  const match = String(dataUrl ?? "").match(/^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return undefined;
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.byteLength || bytes.byteLength > 2_500_000) return undefined;
  return (await saveResumeBytes(dataDir(), `receipts/${userId}/${applicationId}.${match[1] === "png" ? "png" : "jpg"}`, new Uint8Array(bytes), `image/${match[1]}`).catch(() => "")) || undefined;
}

/**
 * The extension saw an application go through: the site's submit call succeeded ("confirmed"), or the page
 * said so after a submit click ("likely"). Records it and keeps the screenshot.
 */
export async function extensionSubmission(userId: string, raw: unknown) {
  const body = (raw ?? {}) as { applicationId?: unknown; url?: unknown; postingUrl?: unknown; title?: unknown; company?: unknown; description?: unknown; poster?: unknown; confidence?: unknown; screenshot?: unknown; text?: unknown; how?: unknown; appliedOn?: unknown; noPeople?: unknown };
  const confidence = body.confidence === "confirmed" ? "confirmed" : body.confidence === "likely" ? "likely" : null;
  if (!confidence) throw new ServiceError("Say whether the submission was confirmed or likely.", "confidence", 400);
  const url = String(body.url ?? "").trim().slice(0, 2000);
  let app = body.applicationId ? await applications.get(userId, String(body.applicationId).slice(0, 80)) : null;
  const title = String(body.title ?? "").trim();
  const company = String(body.company ?? "").trim();
  // One job per link, except a job board's search page, where each job named there is its own.
  const tracked = !app && /^https:\/\//i.test(url) ? await trackedAt(userId, url, { title, company }) : null;
  if (!app) app = tracked?.app ?? null;
  if (!app) {
    if (!/^https:\/\//i.test(url) || !title || !company) throw new ServiceError("Couldn't tell which job this was.", "job", 400);
    // Applied on a job board (Handshake, ZipRecruiter) without Unnepo: the posting as the page showed it.
    const description = typeof body.description === "string" ? body.description.trim().slice(0, 8000) : "";
    app = await minimalApplication(userId, { url, title: title.slice(0, 200), company: company.slice(0, 200), description, poster: pagePoster(body.poster), key: tracked?.key });
    // No description, or no company: the link is read for them (company sites; job boards wait for the extension).
    if (!description || companyMissing(app)) runLater(() => enrichFromPosting(userId, app!.id, url));
    if (description && companyMissing(app)) runLater(() => nameCompanyFromDescription(userId, app!.id));
  }
  const seenPoster = pagePoster(body.poster);
  if (seenPoster || app.postedRecruiter) app = await notePoster(userId, app, app.postedRecruiter ? null : seenPoster);
  await ensureCharged(userId, app);
  const receiptPath = await saveScreenshot(userId, app.id, body.screenshot);
  const detectedAt = nowIso();
  // The day the job board says it was applied ("Applied on Oct 3"): a job applied to before Unnepo saw it keeps its own day.
  const day = String(body.appliedOn ?? "");
  const boardDay = /^\d{4}-\d{2}-\d{2}$/.test(day) && Date.parse(`${day}T12:00:00Z`) <= Date.now() ? new Date(`${day}T12:00:00Z`).toISOString() : null;
  // The job board posting the application came from, when it isn't the page applied on: the job's link.
  const postingUrl = String(body.postingUrl ?? "").trim().slice(0, 2000);
  const report = app.fillReport ?? { filled: [], failed: [], liveViewUrl: null, screenshotAt: null };
  const keepPosting = /^https:\/\/\S+\.\S+/i.test(postingUrl) && postingUrl !== app.jobUrl && !report.postingUrl;
  const updated = await applications.update(userId, app.id, {
    ...(keepPosting ? { fillReport: { ...report, postingUrl } } : {}),
    status: "submitted",
    submittedAt: app.submittedAt ?? boardDay ?? detectedAt,
    confirmation: { url: url || app.applicationUrl || app.jobUrl, text: String(body.text ?? "").slice(0, 240) || `Detected by the Unnepo extension (${confidence}).`, detectedAt, receiptPath, confidence },
    statusMessage: confidence === "confirmed" ? "Submitted. The site accepted your application." : "Submitted, as far as the page shows. Check your email for the site's confirmation.",
  });
  // How it was caught, for the Activity view and each site's confirmation rate.
  const how = APPLIED_HOW.find((item) => item === body.how) ?? (confidence === "confirmed" ? "site_confirmed" : "page_said");
  await addActivity(userId, app.id, { kind: "applied", how });
  await dropMaybe(userId, { applicationId: app.id, url });
  // People are looked for now when the student's plan or setting says so; otherwise when they ask. Not for old
  // applications brought in from a job board's list: the student asks for those one by one.
  if (body.noPeople !== true) await findPeopleOnApply(userId, app.id);
  return { application: summary((await applications.get(userId, app.id)) ?? updated!) };
}

/** The student says they didn't actually apply. Puts the job back to not applied. */
export async function extensionUndoSubmission(userId: string, raw: unknown) {
  const app = await requireApp(userId, (raw as { applicationId?: unknown } | null)?.applicationId);
  const updated = await applications.update(userId, app.id, { status: "extracted", submittedAt: null, confirmation: null, statusMessage: "You said you didn't apply to this one." });
  return { application: summary(updated!) };
}
