import { after } from "next/server";
import { APPLICATIONS_PER_CREDIT, serverConfig } from "@/lib/config";
import { id, nowIso, readAnthropicKey, repo } from "@/lib/db/file-store";
import { ServiceError } from "@/lib/errors";
import { splitProfileList } from "@/lib/profile/lists";
import { readStoredResume } from "@/lib/services/resume";
import { browserReady, createBrowserSession, detectConfirmation, liveViewUrl, releaseBrowserSession, runApplicationFlow, submitAndConfirm, withSessionPage, type FlowResult, type ResumeFile } from "@/lib/apply/browser";
import { decryptSecret, encryptSecret } from "@/lib/security";
import { findPeopleForApplication, hunterReady, writeOutreachEmails } from "@/lib/apply/contacts";
import { extractJob } from "@/lib/apply/extract";
import { AI_ANSWER_PROMPT, acceptAiAnswer, classifyQuestion, contactFromResume, missingAnswers, normalizeLabel, planAnswers, type AnswerContext } from "@/lib/apply/questions";
import { applicationContacts, applicationProfiles, applications } from "@/lib/apply/store";
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
  const profile: ApplicationProfile = {
    firstName: stored?.firstName ?? firstName,
    lastName: stored?.lastName ?? rest.join(" "),
    email: stored?.email ?? user.email,
    phone: stored?.phone ?? fromResume.phone,
    linkedin: stored?.linkedin ?? fromResume.linkedin,
    website: stored?.website ?? "",
    github: stored?.github ?? fromResume.github,
    city: stored?.city ?? "",
    saved: stored?.saved ?? {},
    jobSitePasswordEncrypted: stored?.jobSitePasswordEncrypted ?? null,
    accountConsentAt: stored?.accountConsentAt ?? null,
    jobAccounts: stored?.jobAccounts ?? [],
  };
  const form = document?.form;
  const context: AnswerContext = {
    profile,
    school: form?.school ?? "",
    majors: splitProfileList(form?.major ?? ""),
    graduationYear: form?.graduationYear ?? "",
    resumeFileName: resume?.storagePath ? resume.fileName : null,
  };
  const profileText = [
    form && `School: ${form.school}; Majors: ${form.major}; Graduation year: ${form.graduationYear}`,
    form?.targetRoles && `Target roles: ${form.targetRoles}`,
    form?.bio && `About: ${form.bio}`,
    form?.accomplishments && `Accomplishments: ${form.accomplishments}`,
    ...(document?.highlights ?? []).map((item) => `- ${item.detail}${item.experienceDetails ? ` ${item.experienceDetails}` : ""}`),
  ].filter(Boolean).join("\n");
  return { user, document, resume, resumeText, profile, context, profileText, excluded: form?.excludedTopics ?? "" };
}

/** Answers open, non-sensitive questions from the profile and resume. Answers without quoted evidence are dropped. */
async function aiAnswers(userId: string, questions: ApplicationQuestion[], sources: string) {
  const open = questions.filter((question) => !question.answer && !question.sensitive && !classifyQuestion(question.label).sensitive && question.kind !== "file" && question.kind !== "unknown").slice(0, 30);
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

function summary(app: JobApplication) {
  const missing = missingAnswers(app.questions);
  return { ...app, description: app.description.slice(0, 4000), missing: missing.map((question) => question.key) };
}

export async function applyState(userId: string) {
  const [apps, info] = await Promise.all([applications.list(userId), student(userId)]);
  const contacts = await applicationContacts.list(userId, apps.map((app) => app.id));
  return {
    applications: apps.map((app) => ({ ...summary(app), contacts: contacts.filter((contact) => contact.applicationId === app.id) })),
    profile: publicProfile(info.profile),
    resume: info.resume ? { fileName: info.resume.fileName, stored: Boolean(info.resume.storagePath) } : null,
    ready: { autofill: browserReady(), hunter: hunterReady(), profile: Boolean(info.document?.ready) },
    applicationsPerCredit: APPLICATIONS_PER_CREDIT,
  };
}

/** Reads the job link and proposes answers. Pasting the same job again returns the first application. */
export async function createApplication(userId: string, raw: unknown) {
  const url = String((raw as { url?: unknown } | null)?.url ?? "").trim().slice(0, 2000);
  if (!url) throw new ServiceError("Paste a job posting link.", "job_url", 400);
  const info = await student(userId);
  if (!info.document?.ready) throw new ServiceError("Finish your profile first so Unnepo has your details to apply with.", "profile", 400);
  const job = await extractJob(url);
  const existing = await applications.findByKey(userId, job.jobKey);
  if (existing) return { application: summary(existing), duplicate: true, message: `You already added ${existing.title} at ${existing.company}.` };
  let questions = planAnswers(job.questions, info.context);
  questions = await aiAnswers(userId, questions, [info.profileText, info.resumeText].join("\n\n"));
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
    statusMessage: job.questions.length ? "Review the answers below." : "This job board doesn't publish its questions ahead of time. Autofill reads them from the live form.",
    questions,
    browserSessionId: null,
    fillReport: null,
    confirmation: null,
    submittedAt: null,
    contactsStatus: "idle",
    contactsMessage: "",
    charged: false,
    attempts: 0,
  });
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
  if (!["extracted", "review", "unconfirmed", "failed"].includes(app.status)) throw new ServiceError("This application can't be edited right now.", "state", 409);
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
  if (typeof body.jobSitePassword === "string" && body.jobSitePassword) {
    const password = body.jobSitePassword;
    // Job sites commonly want 8+ characters with upper, lower, a number, and a symbol.
    if (password.length < 10 || password.length > 128 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
      throw new ServiceError("Use at least 10 characters with an uppercase letter, a lowercase letter, a number, and a symbol. Most job sites require that.", "password", 400);
    }
    next.jobSitePasswordEncrypted = encryptSecret(password);
  }
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

async function resumeFile(userId: string): Promise<ResumeFile | null> {
  const resume = await repo.getLatestResume(userId);
  if (!resume) return null;
  const bytes = await readStoredResume(resume.storagePath);
  if (!bytes?.byteLength) return null;
  return { name: resume.fileName, mimeType: resume.mime || "application/pdf", buffer: Buffer.from(bytes) };
}

const STOP_MESSAGE: Record<FlowResult["stoppedAt"], (report: FlowResult, email: string) => string> = {
  review: (r) => `Filled ${r.filled.length} fields${r.pages && r.pages > 1 ? ` across ${r.pages} pages` : ""}.${r.failed.length ? ` ${r.failed.length} still need you in the live view.` : ""} Check the form in the live view, then approve.`,
  needs_input: (r) => {
    const names = r.failed.map((item) => item.label);
    const list = names.length ? ` It needs: ${names.slice(0, 4).join("; ")}${names.length > 4 ? ` and ${names.length - 4} more` : ""}.` : "";
    const profileHint = names.some((label) => classifyQuestion(label).field && ["firstName", "lastName", "fullName", "phone", "email", "city", "linkedin", "addressLine1", "state", "postalCode", "country"].includes(classifyQuestion(label).field!))
      ? " Add missing contact details under Your application details so Unnepo fills them next time."
      : "";
    return `Filled ${r.filled.length} fields, then stopped on a page that needs you.${list} Finish it in the live view, then press Continue autofill.${profileHint}`;
  },
  email_verification: (r, email) => `${r.account === "created" ? `Created your account on ${r.host}. ` : ""}${r.host} sent a verification email to ${email}. Click the link in that email, then press Continue autofill.`,
  needs_account: (r) => `${r.host} needs an account. Set your job-site password and allow account creation under Your application details, then press Continue autofill.`,
  signin_failed: (r) => `Couldn't sign in on ${r.host} with your email and job-site password. Sign in (or reset the password) in the live view, then press Continue autofill.`,
};

/** Runs the page-by-page fill in a session and records where it stopped. Never submits. */
async function runFlow(userId: string, app: JobApplication, sessionId: string, navigate: boolean) {
  const info = await student(userId);
  const resume = await resumeFile(userId);
  const password = info.profile.jobSitePasswordEncrypted ? decryptSecret(info.profile.jobSitePasswordEncrypted) : "";
  const credentials = password && info.profile.email ? { email: info.profile.email, password } : null;
  const answerFor = (label: string, kind: ApplicationQuestion["kind"], options: string[]) => {
    const [planned] = planAnswers([{ key: label, label, kind, required: false, options, sensitive: false, answer: null, source: null, evidence: null }], info.context);
    return planned.answer && planned.source && planned.source !== "resume_file" ? planned.answer : null;
  };
  const report = await withSessionPage(sessionId, (page) =>
    runApplicationFlow(page, { url: app.applicationUrl!, navigate, questions: app.questions, resume, credentials, allowSignup: Boolean(info.profile.accountConsentAt), answerFor }),
  );
  if (report.account === "created") {
    const jobAccounts = [...(info.profile.jobAccounts ?? []).filter((item) => item.host !== report.host), { host: report.host, email: info.profile.email, createdAt: nowIso() }];
    await applicationProfiles.put(userId, { ...info.profile, jobAccounts });
  }
  const live = await liveViewUrl(sessionId);
  const updated = await applications.update(userId, app.id, {
    status: "review",
    browserSessionId: sessionId,
    fillReport: { ...report, liveViewUrl: live, screenshotAt: nowIso() },
    statusMessage: STOP_MESSAGE[report.stoppedAt](report, info.profile.email),
  });
  return { application: summary(updated!) };
}

/** Opens the application in a browser and fills it page by page. Stops before submitting. */
export async function startAutofill(userId: string, raw: unknown) {
  const app = await requireApp(userId, (raw as { applicationId?: unknown } | null)?.applicationId);
  if (!app.applicationUrl) throw new ServiceError("This posting has no application form link.", "no_form", 409);
  if (!browserReady()) throw new ServiceError("Autofill isn't connected yet. Add the Browserbase keys in Vercel, or apply yourself and press I applied.", "browser_not_configured", 503);
  const missing = missingAnswers(app.questions);
  if (missing.length) throw new ServiceError(`Answer ${missing.length === 1 ? `"${missing[0].label}"` : `${missing.length} required questions`} first.`, "missing", 400);
  const claimed = await applications.transition(userId, app.id, ["extracted", "review", "failed"], { status: "filling", statusMessage: "Filling the form…", attempts: app.attempts + 1 });
  if (!claimed) throw new ServiceError("This application is already being filled or was submitted.", "state", 409);
  try {
    await ensureCharged(userId, app);
  } catch (error) {
    await applications.update(userId, app.id, { status: app.status, statusMessage: app.statusMessage });
    throw error;
  }
  if (app.browserSessionId) await releaseBrowserSession(app.browserSessionId);
  let sessionId: string | null = null;
  try {
    sessionId = await createBrowserSession();
    return await runFlow(userId, app, sessionId, true);
  } catch (error) {
    if (sessionId) await releaseBrowserSession(sessionId);
    const message = error instanceof ServiceError ? error.message : "The form couldn't be filled. Nothing was submitted.";
    await applications.update(userId, app.id, { status: "failed", browserSessionId: null, statusMessage: message });
    throw error instanceof ServiceError ? error : new ServiceError(message, "browser_failed", 502);
  }
}

/**
 * Saves the student's answers to questions autofill stopped on. They're kept by question label, so the
 * same question on any later application (Workday's are worded the same everywhere) fills itself.
 */
export async function answerPending(userId: string, raw: unknown) {
  const body = (raw ?? {}) as { applicationId?: unknown; answers?: Record<string, unknown> };
  const app = await requireApp(userId, body.applicationId);
  const pending = app.fillReport?.pending ?? [];
  const info = await student(userId);
  const saved = { ...info.profile.saved };
  let count = 0;
  for (const [label, value] of Object.entries(body.answers ?? {})) {
    const question = pending.find((item) => item.label === label);
    const answer = String(value ?? "").trim().slice(0, 2000);
    if (!question || !answer) continue;
    if (question.options.length && !question.options.includes(answer)) throw new ServiceError(`Pick one of the options for "${label}".`, "answer", 400);
    saved[normalizeLabel(label)] = { label, answer, updatedAt: nowIso() };
    count += 1;
  }
  if (!count) throw new ServiceError("Answer at least one question first.", "answer", 400);
  await applicationProfiles.put(userId, { ...info.profile, saved });
  return { saved: count };
}

/** Picks up in the same browser after the student verified an email or finished a page themselves. */
export async function continueAutofill(userId: string, raw: unknown) {
  const app = await requireApp(userId, (raw as { applicationId?: unknown } | null)?.applicationId);
  if (!app.browserSessionId) throw new ServiceError("The browser for this application has closed. Press Autofill application to start again.", "state", 409);
  const claimed = await applications.transition(userId, app.id, ["review"], { status: "filling", statusMessage: "Continuing…" });
  if (!claimed) throw new ServiceError("This application isn't waiting on you right now.", "state", 409);
  try {
    return await runFlow(userId, app, app.browserSessionId, false);
  } catch (error) {
    const message = error instanceof ServiceError ? error.message : "Couldn't continue in the browser. Nothing was submitted.";
    await applications.update(userId, app.id, { status: "review", statusMessage: message });
    throw error instanceof ServiceError ? error : new ServiceError(message, "browser_failed", 502);
  }
}

function startContacts(userId: string, applicationId: string) {
  defer(async () => {
    await runContactDiscovery(userId, applicationId).catch((error) => console.error("contact discovery failed", error));
  });
}

/** Clicks submit after the student approves, then waits for the site's own confirmation. */
export async function approveAndSubmit(userId: string, raw: unknown) {
  const app = await requireApp(userId, (raw as { applicationId?: unknown } | null)?.applicationId);
  if (!app.browserSessionId) throw new ServiceError("Run autofill first.", "state", 409);
  if (app.fillReport?.stoppedAt && app.fillReport.stoppedAt !== "review") {
    throw new ServiceError("Autofill hasn't reached the final page yet. Finish the step it stopped on, then press Continue autofill.", "state", 409);
  }
  const claimed = await applications.transition(userId, app.id, ["review"], { status: "submitting", statusMessage: "Submitting…" });
  if (!claimed) throw new ServiceError("This application isn't waiting for approval.", "state", 409);
  try {
    const confirmation = await withSessionPage(app.browserSessionId, (page) => submitAndConfirm(page));
    return { application: summary((await recordSubmitResult(userId, app, confirmation))!) };
  } catch (error) {
    await applications.update(userId, app.id, { status: "unconfirmed", statusMessage: error instanceof ServiceError ? error.message : "Couldn't confirm the submission. Check the live view." });
    throw error;
  }
}

async function recordSubmitResult(userId: string, app: JobApplication, confirmation: JobApplication["confirmation"]) {
  if (!confirmation) {
    return applications.update(userId, app.id, {
      status: "unconfirmed",
      statusMessage: "The site didn't show a confirmation yet. Check the live view: finish any CAPTCHA or fix any errors and submit there, then press Check again.",
    });
  }
  const updated = await applications.update(userId, app.id, { status: "submitted", confirmation, submittedAt: confirmation.detectedAt, statusMessage: "Submitted. The site confirmed your application." });
  if (app.browserSessionId) await releaseBrowserSession(app.browserSessionId);
  await applications.update(userId, app.id, { browserSessionId: null });
  startContacts(userId, app.id);
  return updated;
}

/** Looks at the live page again for a confirmation, after the student finished a step themselves. */
export async function checkSubmission(userId: string, raw: unknown) {
  const app = await requireApp(userId, (raw as { applicationId?: unknown } | null)?.applicationId);
  if (app.status !== "unconfirmed" && app.status !== "review") throw new ServiceError("Nothing to check for this application.", "state", 409);
  if (!app.browserSessionId) throw new ServiceError("The browser for this application has closed. If you submitted it, press I applied.", "state", 409);
  const confirmation = await withSessionPage(app.browserSessionId, (page) => detectConfirmation(page));
  if (!confirmation) return { application: summary(app), confirmed: false, message: "Still no confirmation on the page." };
  return { application: summary((await recordSubmitResult(userId, app, confirmation))!), confirmed: true, message: "Confirmed." };
}

/** The student applied on their own. Shown as "Applied (you)", never as confirmed by Unnepo. */
export async function markApplied(userId: string, raw: unknown) {
  const app = await requireApp(userId, (raw as { applicationId?: unknown } | null)?.applicationId);
  if (app.status === "submitted" || app.status === "applied_manual") return { application: summary(app) };
  if (app.status === "filling" || app.status === "submitting") throw new ServiceError("Wait for the current step to finish.", "state", 409);
  await ensureCharged(userId, app);
  if (app.browserSessionId) await releaseBrowserSession(app.browserSessionId);
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
  if (app.browserSessionId) await releaseBrowserSession(app.browserSessionId);
  await applications.remove(userId, app.id);
  return { ok: true };
}
