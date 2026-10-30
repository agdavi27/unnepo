import { dataDir, nowIso, repo } from "@/lib/db/file-store";
import { ServiceError } from "@/lib/errors";
import { coverLetterPdf, writeCoverLetter, type CoverLetterStyle } from "@/lib/apply/cover-letter";
import { createApplication, answerWith, ensureCharged, learnAnswers, requireApp, runContext, runLater, startContacts, student, summary } from "@/lib/apply/service";
import { extractJob, jobKeyFor, parseJobUrl } from "@/lib/apply/extract";
import { buildMapping, greenhouseSchema, knownAnswers, logTimings } from "@/lib/apply/fast/pipeline";
import type { FormSchema, SchemaField, SchemaFieldType } from "@/lib/apply/fast/schema";
import { classifyQuestion, normalizeLabel } from "@/lib/apply/questions";
import { applicationProfiles, applications } from "@/lib/apply/store";
import { CVS_PER_CREDIT, cvUsesLeft } from "@/lib/apply/cv";
import type { JobApplication } from "@/lib/apply/types";
import { profileReady, profileState } from "@/lib/profile/service";
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
  const [user, credits, state, resume, stored] = await Promise.all([repo.getUserById(userId), repo.getAccount(userId), profileState(userId), repo.getLatestResume(userId), applicationProfiles.get(userId)]);
  return {
    user: { name: user?.name ?? "", email: user?.email ?? "" },
    credits: credits?.balance ?? 0,
    profileReady: state.ready,
    completeness: state.profile.completeness,
    // What the panel lists under "Missing": the parts of the profile still to fill in, required ones first.
    // CVs the student can still generate with the credits they have.
    cv: { usesLeft: cvUsesLeft(stored?.cvCount ?? 0, credits?.balance ?? 0), perCredit: CVS_PER_CREDIT },
    // The resume the extension attaches. `file` is false when only its text was kept, so it must be uploaded again.
    resume: resume ? { fileName: resume.fileName, uploadedAt: resume.createdAt, file: Boolean(resume.storagePath) && resume.byteSize > 0 } : null,
    missing: [...state.missing].sort((a, b) => Number(a.optional) - Number(b.optional)).map((gap) => gap.title).slice(0, 3),
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
  if (!resume) throw new ServiceError("Upload a resume in Unnepo first.", "no_resume", 404);
  if (!bytes?.byteLength) throw new ServiceError("Unnepo has your resume's text but not the file. Upload it again.", "no_resume_file", 404);
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
async function minimalApplication(userId: string, input: { url: string; title: string; company: string; description?: string }) {
  let ats: JobApplication["ats"] = "other";
  try { ats = parseJobUrl(input.url).ats; } catch { /* a page Unnepo can't parse is still tracked */ }
  const { app } = await applications.insert({
    userId, jobKey: keyFor(input.url), jobUrl: input.url, ats, title: input.title.slice(0, 200), company: input.company.slice(0, 200), companyDomain: null,
    department: null, location: null, description: input.description ?? "", requirements: [], applicationUrl: input.url, postedRecruiter: null, status: "extracted",
    statusMessage: "Opened from the extension.", questions: [], browserSessionId: null, fillReport: null, confirmation: null, submittedAt: null,
    contactsStatus: "idle", contactsMessage: "", charged: false, attempts: 0,
  });
  await ensureCharged(userId, app);
  return (await applications.get(userId, app.id))!;
}

/** Opens (or reuses) the application for the job the extension is on. A new job spends credits as usual. */
export async function extensionJob(userId: string, raw: unknown) {
  const body = (raw ?? {}) as { url?: unknown; title?: unknown; company?: unknown; description?: unknown };
  const url = String(body.url ?? "").trim().slice(0, 2000);
  if (!/^https:\/\//i.test(url)) throw new ServiceError("Open a job application page first.", "job_url", 400);
  // The posting's text as the page shows it (Handshake, which Unnepo can't read on its own).
  const pageDescription = typeof body.description === "string" ? body.description.trim().slice(0, 8000) : "";
  const existing = await applications.findByKey(userId, keyFor(url));
  if (existing) {
    if (pageDescription && !existing.description) return { application: summary((await applications.update(userId, existing.id, { description: pageDescription }))!), created: false };
    return { application: summary(existing), created: false };
  }
  // The fast way: open the job from what the page shows, so filling starts right away, and read the posting
  // (description, requirements, recruiter) in the background for the cover letter and the people search.
  const pageTitle = String(body.title ?? "").trim();
  const pageCompany = String(body.company ?? "").trim();
  if (pageTitle && pageCompany) {
    if (!(await profileReady(userId))) throw new ServiceError("Finish your profile first so Unnepo has your details to apply with.", "profile", 400);
    const app = await minimalApplication(userId, { url, title: pageTitle, company: pageCompany, description: pageDescription });
    if (!pageDescription) runLater(() => enrichFromPosting(userId, app.id, url));
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
    return { application: summary(await minimalApplication(userId, { url, title, company, description: pageDescription })), created: true };
  }
}

/** Fills in a quickly-opened job from its posting. Best effort: a posting Unnepo can't read keeps the page's details. */
async function enrichFromPosting(userId: string, applicationId: string, url: string) {
  try {
    const job = await extractJob(url);
    await applications.update(userId, applicationId, {
      ats: job.ats, department: job.department, location: job.location, description: job.description,
      requirements: job.requirements, applicationUrl: job.applicationUrl, postedRecruiter: job.postedRecruiter,
      ...(job.title ? { title: job.title } : {}), ...(job.company ? { company: job.company } : {}),
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
  return (await repo.listUsage(start.toISOString())).filter((row) => row.userId === userId && row.operation === "application_mapping").length;
}

/**
 * Answers for every field on the form. Greenhouse forms are read from Greenhouse itself; other forms use
 * the fields the extension scanned. The student's own data answers first, then cached AI answers, then at
 * most one AI call for what's left.
 */
export async function extensionMap(userId: string, raw: unknown) {
  const body = (raw ?? {}) as { applicationId?: unknown; fields?: unknown; ai?: unknown };
  const app = await requireApp(userId, body.applicationId);
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
    const hit = cache[cacheKey(field)];
    if (!hit) return null;
    fromCache.add(field.id);
    return { value: hit.values.join("\n"), source: "ai" };
  };
  const ai = !skipAi && (await aiCallsToday(userId)) < DAILY_AI_CALLS;
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
  const body = (raw ?? {}) as { applicationId?: unknown; length?: unknown; tone?: unknown; mention?: unknown; edit?: unknown; previous?: unknown };
  const app = await requireApp(userId, body.applicationId);
  const info = await student(userId);
  const name = [info.profile.firstName, info.profile.lastName].filter(Boolean).join(" ") || info.user.name;
  const pick = <T extends string>(value: unknown, allowed: readonly T[]) => (allowed.includes(value as T) ? (value as T) : undefined);
  const style: CoverLetterStyle = {
    length: pick(body.length, ["short", "standard", "detailed"] as const),
    tone: pick(body.tone, ["professional", "warm", "confident", "enthusiastic"] as const),
    mention: typeof body.mention === "string" ? body.mention.slice(0, 400) : undefined,
    edit: typeof body.edit === "string" ? body.edit.slice(0, 600) : undefined,
    previous: typeof body.previous === "string" ? body.previous.slice(0, 6000) : undefined,
  };
  if (style.edit !== undefined && !style.edit.trim()) throw new ServiceError("Say what you'd like changed.", "edit", 400);
  // The student's choices (or edits) always mean a new letter; otherwise the one already written is reused.
  const asked = Boolean(style.length || style.tone || style.mention?.trim() || style.edit?.trim());
  const text = (!asked && app.fillReport?.coverLetter) || (await writeCoverLetter(userId, app, { name, resumeText: info.resumeText, profile: info.profileText }, style));
  if (!text) throw new ServiceError("Couldn't write a cover letter. Add your resume and profile first.", "cover_letter", 409);
  // The newest letter is the one autofill attaches when the form asks for a cover letter.
  if (text !== app.fillReport?.coverLetter) await applications.update(userId, app.id, { fillReport: { ...(app.fillReport ?? { filled: [], failed: [], liveViewUrl: null, screenshotAt: null }), coverLetter: text } });
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
