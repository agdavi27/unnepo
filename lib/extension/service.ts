import { dataDir, nowIso, repo } from "@/lib/db/file-store";
import { ServiceError } from "@/lib/errors";
import { coverLetterPdf, writeCoverLetter } from "@/lib/apply/cover-letter";
import { createApplication, answerWith, ensureCharged, learnAnswers, requireApp, runContext, startContacts, student, summary } from "@/lib/apply/service";
import { jobKeyFor, parseJobUrl } from "@/lib/apply/extract";
import { buildMapping, greenhouseSchema, knownAnswers, logTimings } from "@/lib/apply/fast/pipeline";
import type { FormSchema, SchemaField, SchemaFieldType } from "@/lib/apply/fast/schema";
import { classifyQuestion, normalizeLabel } from "@/lib/apply/questions";
import { applicationProfiles, applications } from "@/lib/apply/store";
import type { JobApplication } from "@/lib/apply/types";
import { profileState } from "@/lib/profile/service";
import { readStoredResume, saveResumeBytes } from "@/lib/services/resume";

/**
 * What the Chrome extension calls. The extension fills forms in the student's own browser; the server
 * holds the profile, reads job boards, prepares answers (at most one AI call per form, cached by
 * question), and records submissions.
 */

/** AI mapping calls a student can make in a day before Unnepo stops calling the model for them. */
const DAILY_AI_CALLS = Number(process.env.EXTENSION_DAILY_AI_CALLS || 60);
/** Answers the model wrote, cached by question so the same question never costs a second call. */
const CACHE_LIMIT = 400;

export async function extensionMe(userId: string) {
  const [user, credits, state] = await Promise.all([repo.getUserById(userId), repo.getAccount(userId), profileState(userId)]);
  return {
    user: { name: user?.name ?? "", email: user?.email ?? "" },
    credits: credits?.balance ?? 0,
    profileReady: state.ready,
    completeness: state.profile.completeness,
  };
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
  if (!resume || !bytes) throw new ServiceError("Upload a resume in Unnepo first.", "no_resume", 404);
  return { bytes, fileName: resume.fileName, mime: resume.mime || "application/pdf" };
}

function keyFor(url: string) {
  try {
    return jobKeyFor(parseJobUrl(url));
  } catch {
    const parsed = new URL(url);
    return `url:${parsed.hostname}${parsed.pathname}`.toLowerCase().slice(0, 300);
  }
}

/** A job the extension is on. Unnepo reads it when it can; otherwise it keeps what the page showed. */
async function minimalApplication(userId: string, input: { url: string; title: string; company: string }) {
  const { app } = await applications.insert({
    userId, jobKey: keyFor(input.url), jobUrl: input.url, ats: "other", title: input.title.slice(0, 200), company: input.company.slice(0, 200), companyDomain: null,
    department: null, location: null, description: "", requirements: [], applicationUrl: input.url, postedRecruiter: null, status: "extracted",
    statusMessage: "Opened from the extension.", questions: [], browserSessionId: null, fillReport: null, confirmation: null, submittedAt: null,
    contactsStatus: "idle", contactsMessage: "", charged: false, attempts: 0,
  });
  await ensureCharged(userId, app);
  return (await applications.get(userId, app.id))!;
}

/** Opens (or reuses) the application for the job the extension is on. A new job spends credits as usual. */
export async function extensionJob(userId: string, raw: unknown) {
  const body = (raw ?? {}) as { url?: unknown; title?: unknown; company?: unknown };
  const url = String(body.url ?? "").trim().slice(0, 2000);
  if (!/^https:\/\//i.test(url)) throw new ServiceError("Open a job application page first.", "job_url", 400);
  const existing = await applications.findByKey(userId, keyFor(url));
  if (existing) return { application: summary(existing), created: false };
  try {
    const result = await createApplication(userId, { url });
    return { application: result.application, created: !result.duplicate };
  } catch (error) {
    // Pages Unnepo can't read on its own (a signed-in portal, an unknown job system) still get tracked.
    const title = String(body.title ?? "").trim();
    const company = String(body.company ?? "").trim();
    if (error instanceof ServiceError && (error.code === "credits" || error.code === "profile" || error.code === "job_url")) throw error;
    if (!title || !company) throw error;
    return { application: summary(await minimalApplication(userId, { url, title, company })), created: true };
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
  return (await repo.listUsage(start.toISOString())).filter((row) => row.userId === userId && row.operation === "application_mapping").length;
}

/**
 * Answers for every field on the form. Greenhouse forms are read from Greenhouse itself; other forms use
 * the fields the extension scanned. The student's own data answers first, then cached AI answers, then at
 * most one AI call for what's left.
 */
export async function extensionMap(userId: string, raw: unknown) {
  const body = (raw ?? {}) as { applicationId?: unknown; fields?: unknown };
  const app = await requireApp(userId, body.applicationId);
  const fields = Array.isArray(body.fields) ? (body.fields as PageField[]) : [];
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
    const hit = cache[cacheKey(field)];
    if (!hit) return null;
    fromCache.add(field.id);
    return { value: hit.values.join("\n"), source: "ai" };
  };
  const ai = (await aiCallsToday(userId)) < DAILY_AI_CALLS;
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
  await applications.update(userId, app.id, { fillReport: { ...(app.fillReport ?? { filled: [], failed: [], liveViewUrl: null, screenshotAt: null }), timings } });
  return {
    applicationId: app.id,
    ats: schema.ats,
    answers: schema.fields.map((field) => {
      const answer = mapped.answers.get(field.id);
      return { id: field.id, label: field.label, type: field.type, required: field.required, values: answer?.values ?? [], source: answer ? (fromCache.has(field.id) ? "cache" : answer.source) : null, why: answer?.why ?? null };
    }),
    llmCalls: mapped.llmCalls,
    aiAvailable: ai,
    ms: Date.now() - started,
  };
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
  const app = await requireApp(userId, (raw as { applicationId?: unknown } | null)?.applicationId);
  const info = await student(userId);
  const name = [info.profile.firstName, info.profile.lastName].filter(Boolean).join(" ") || info.user.name;
  const text = app.fillReport?.coverLetter || (await writeCoverLetter(userId, app, { name, resumeText: info.resumeText, profile: info.profileText }));
  if (!text) throw new ServiceError("Couldn't write a cover letter. Add your resume and profile first.", "cover_letter", 409);
  if (!app.fillReport?.coverLetter) await applications.update(userId, app.id, { fillReport: { ...(app.fillReport ?? { filled: [], failed: [], liveViewUrl: null, screenshotAt: null }), coverLetter: text } });
  const pdf = await coverLetterPdf(text, { name, contact: [info.profile.email, info.profile.phone, info.profile.city, info.profile.linkedin.replace(/^https?:\/\/(www\.)?/, "")] });
  return { text, fileName: `${name} Cover Letter.pdf`, pdfBase64: pdf.toString("base64") };
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
 * said so after a submit click ("likely"). Records it, keeps the screenshot, and finds people to email.
 */
export async function extensionSubmission(userId: string, raw: unknown) {
  const body = (raw ?? {}) as { applicationId?: unknown; url?: unknown; title?: unknown; company?: unknown; confidence?: unknown; screenshot?: unknown; text?: unknown };
  const confidence = body.confidence === "confirmed" ? "confirmed" : body.confidence === "likely" ? "likely" : null;
  if (!confidence) throw new ServiceError("Say whether the submission was confirmed or likely.", "confidence", 400);
  const url = String(body.url ?? "").trim().slice(0, 2000);
  let app = body.applicationId ? await applications.get(userId, String(body.applicationId).slice(0, 80)) : null;
  if (!app && url) app = await applications.findByKey(userId, keyFor(url));
  if (!app) {
    const title = String(body.title ?? "").trim();
    const company = String(body.company ?? "").trim();
    if (!/^https:\/\//i.test(url) || !title || !company) throw new ServiceError("Couldn't tell which job this was.", "job", 400);
    app = await minimalApplication(userId, { url, title, company });
  }
  await ensureCharged(userId, app);
  const receiptPath = await saveScreenshot(userId, app.id, body.screenshot);
  const detectedAt = nowIso();
  const updated = await applications.update(userId, app.id, {
    status: "submitted",
    submittedAt: app.submittedAt ?? detectedAt,
    confirmation: { url: url || app.applicationUrl || app.jobUrl, text: String(body.text ?? "").slice(0, 240) || `Detected by the Unnepo extension (${confidence}).`, detectedAt, receiptPath, confidence },
    statusMessage: confidence === "confirmed" ? "Submitted. The site accepted your application." : "Submitted, as far as the page shows. Check your email for the site's confirmation.",
  });
  startContacts(userId, app.id);
  return { application: summary(updated!) };
}

/** The student says they didn't actually apply. Puts the job back to not applied. */
export async function extensionUndoSubmission(userId: string, raw: unknown) {
  const app = await requireApp(userId, (raw as { applicationId?: unknown } | null)?.applicationId);
  const updated = await applications.update(userId, app.id, { status: "extracted", submittedAt: null, confirmation: null, statusMessage: "You said you didn't apply to this one." });
  return { application: summary(updated!) };
}
