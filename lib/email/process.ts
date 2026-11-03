import { createHash } from "node:crypto";
import { id, nowIso } from "@/lib/db/file-store";
import { applications } from "@/lib/apply/store";
import { minimalApplication } from "@/lib/apply/service";
import type { ApplicationOutcome, FillReport, JobApplication, StatusChange } from "@/lib/apply/types";
import { cleanCompanyName } from "@/lib/apply/job-title";
import { classifyEmail, type Classification } from "@/lib/email/classify";
import { passesPrefilter, senderDomain, type InboundEmail } from "@/lib/email/filter";
import { matchApplication } from "@/lib/email/match";
import { emailEvents, messageKey } from "@/lib/email/store";
import type { EmailEvent } from "@/lib/email/types";
import { forwardingVerification } from "@/lib/email/verification";

/**
 * One email, start to finish: skipped if it was processed before (same Message-ID); a forwarding confirmation
 * keeps its code for the setup page; anything that isn't about a job is dropped before any AI call; the rest is
 * read by the AI and saved: a new application ("applied", no match), a status change, or the Review Inbox when
 * Unnepo isn't sure (confidence under 0.7) or more than one job fits. The email's text is only held in memory
 * while this runs. What's kept is the extracted fields and a one-line summary.
 */

export const MIN_CONFIDENCE = 0.7;
const EMPTY_REPORT: FillReport = { filled: [], failed: [], liveViewUrl: null, screenshotAt: null };
const OUTCOME_FOR: Record<Exclude<Classification["type"], "applied" | "not_job_related">, ApplicationOutcome> = {
  interview: "interviewing", assessment: "assessment", offer: "offer", rejected: "rejected",
};

export type Processed = { outcome: EmailEvent["outcome"] | "duplicate" | "dropped"; event?: EmailEvent; applicationId?: string | null };

/** A key for an email with no Message-ID (one pasted in): its sender, subject, date and text. */
function keyOf(email: InboundEmail) {
  if (email.messageId?.trim()) return messageKey(email.messageId);
  return createHash("sha256").update(`${email.from}\n${email.subject}\n${email.date ?? ""}\n${email.text.slice(0, 4000)}`).digest("hex");
}

function receivedAt(email: InboundEmail) {
  const at = Date.parse(email.date ?? "");
  return Number.isNaN(at) ? nowIso() : new Date(at).toISOString();
}

/** Adds a status change to a job, marks it as changed by email, and notes when its last email came. */
export function withEmailChange(report: FillReport | null, change: StatusChange, mark: "added" | "updated", outcome?: ApplicationOutcome): FillReport {
  const base = report ?? EMPTY_REPORT;
  return {
    ...base,
    ...(outcome ? { outcome } : {}),
    statusHistory: [...(base.statusHistory ?? []), change].slice(-50),
    lastEmailAt: change.at,
    fromEmail: base.fromEmail === "added" ? "added" : mark,
  };
}

/** Saves the job the email confirms: an application of its own, marked applied, added from email. */
async function createFromEmail(userId: string, job: Classification, at: string) {
  const company = cleanCompanyName(job.company) || job.company;
  const title = job.job_title || "Unknown role";
  // No link to the posting: a key of its own, so two emailed jobs at one company stay two jobs.
  const app = await minimalApplication(userId, { url: `https://unnepo.local/email/${id()}`, title, company });
  const updated = await applications.update(userId, app.id, {
    jobUrl: "", applicationUrl: null, status: "applied_manual", submittedAt: at, statusMessage: "Added from a forwarded email.",
    fillReport: withEmailChange(app.fillReport, { at, status: "applied", source: "email", summary: job.summary }, "added"),
  });
  return updated ?? app;
}

/**
 * Applies what an email said to the student's applications. Also used when the student approves an email
 * from the Review Inbox (`pick`: the application they picked, or null to save it as a new one).
 */
export async function applyEmail(userId: string, job: Classification, at: string, pick?: JobApplication | null): Promise<{ outcome: "created" | "updated" | "review"; applicationId: string | null; reason?: EmailEvent["reason"]; candidates?: string[] }> {
  const apps = await applications.list(userId);
  let target: JobApplication | null = pick ?? null;
  if (pick === undefined) {
    const match = matchApplication(apps, { company: job.company, jobTitle: job.job_title });
    if (match.kind === "several") return { outcome: "review", applicationId: null, reason: "several_matches", candidates: match.candidates.map((app) => app.id) };
    if (match.kind === "one") target = match.app;
    // A status email about a job that isn't saved: the student says which one, or saves it.
    if (match.kind === "none" && job.type !== "applied") return { outcome: "review", applicationId: null, reason: "no_match", candidates: match.atCompany.map((app) => app.id) };
  }
  if (job.type === "applied") {
    if (!target) return { outcome: "created", applicationId: (await createFromEmail(userId, job, at)).id };
    // A confirmation for a job already saved: it's applied, and its title fills in when it was unknown.
    const applied = target.status === "submitted" || target.status === "applied_manual";
    await applications.update(userId, target.id, {
      ...(applied ? {} : { status: "applied_manual", submittedAt: at, statusMessage: "Confirmed by a forwarded email." }),
      ...(job.job_title && /^(unknown role|job title missing)$/i.test(target.title.trim()) ? { title: job.job_title } : {}),
      fillReport: withEmailChange(target.fillReport, { at, status: "applied", source: "email", summary: job.summary }, "updated"),
    });
    return { outcome: "updated", applicationId: target.id };
  }
  if (job.type === "not_job_related") return { outcome: "review", applicationId: null, reason: "low_confidence" };
  const outcome = OUTCOME_FOR[job.type];
  if (!target) {
    // Approved from the Review Inbox with no job to put it on: saved as a new one, already at this status.
    const created = await createFromEmail(userId, { ...job, type: "applied" }, at);
    await applications.update(userId, created.id, { fillReport: withEmailChange(created.fillReport, { at, status: outcome, source: "email", summary: job.summary }, "added", outcome) });
    return { outcome: "created", applicationId: created.id };
  }
  await applications.update(userId, target.id, {
    // An email about a job means it was applied to.
    ...(target.status === "submitted" || target.status === "applied_manual" ? {} : { status: "applied_manual", submittedAt: target.submittedAt ?? at }),
    fillReport: withEmailChange(target.fillReport, { at, status: outcome, source: "email", summary: job.summary }, "updated", outcome),
  });
  return { outcome: "updated", applicationId: target.id };
}

export async function processEmail(userId: string, email: InboundEmail, source: "forward" | "paste"): Promise<Processed> {
  const key = keyOf(email);
  if (await emailEvents.seen(userId, key)) return { outcome: "duplicate" };
  const at = receivedAt(email);
  const base = { userId, messageKey: key, receivedAt: at, source, fromDomain: senderDomain(email.from) };

  const verification = forwardingVerification(email);
  if (verification) {
    const event = await emailEvents.add({ ...base, kind: "verification", company: "", jobTitle: null, confidence: 1, outcome: "verification", applicationId: null, verification,
      summary: verification.provider === "gmail" ? "Gmail sent a code to confirm forwarding." : "Outlook sent a code to confirm forwarding." });
    return event ? { outcome: "verification", event } : { outcome: "duplicate" };
  }
  // Not about a job: dropped now, and nothing about it is kept.
  if (!passesPrefilter(email)) return { outcome: "dropped" };

  const job = await classifyEmail(email);
  const fields = { kind: job.type, company: cleanCompanyName(job.company) || job.company, jobTitle: job.job_title, confidence: job.confidence, summary: job.summary };
  if (job.type === "not_job_related" && job.confidence >= MIN_CONFIDENCE) {
    // Kept only as "seen", so the same email isn't read by the AI twice.
    const event = await emailEvents.add({ ...base, ...fields, company: "", jobTitle: null, outcome: "ignored", applicationId: null });
    return event ? { outcome: "ignored", event } : { outcome: "duplicate" };
  }
  if (job.confidence < MIN_CONFIDENCE || !job.company.trim()) {
    const event = await emailEvents.add({ ...base, ...fields, outcome: "review", applicationId: null, reason: "low_confidence", candidates: [] });
    return event ? { outcome: "review", event } : { outcome: "duplicate" };
  }
  // Saved as seen first, so a second copy arriving at the same moment can't apply it twice.
  const event = await emailEvents.add({ ...base, ...fields, outcome: "review", applicationId: null });
  if (!event) return { outcome: "duplicate" };
  const result = await applyEmail(userId, job, at);
  const saved = await emailEvents.update(userId, event.id, { outcome: result.outcome, applicationId: result.applicationId, reason: result.reason, candidates: result.candidates });
  return { outcome: result.outcome, event: saved ?? event, applicationId: result.applicationId };
}

/** The Review Inbox: Approve (as Unnepo read it), Pick application (the student's choice), or Dismiss. */
export async function reviewEmail(userId: string, raw: unknown) {
  const body = (raw ?? {}) as { eventId?: unknown; action?: unknown; applicationId?: unknown };
  const event = await emailEvents.get(userId, String(body.eventId ?? ""));
  if (!event || event.outcome !== "review") return { ok: false, event: null };
  if (body.action === "dismiss") return { ok: true, event: await emailEvents.update(userId, event.id, { outcome: "dismissed" }) };
  const job: Classification = { type: event.kind === "verification" ? "not_job_related" : event.kind, company: event.company, job_title: event.jobTitle, confidence: 1, summary: event.summary };
  if (job.type === "not_job_related" || !job.company.trim()) return { ok: false, event };
  let result: Awaited<ReturnType<typeof applyEmail>>;
  if (body.action === "pick") {
    const pick = await applications.get(userId, String(body.applicationId ?? ""));
    if (!pick) return { ok: false, event };
    result = await applyEmail(userId, job, event.receivedAt, pick);
  } else if (body.action === "approve") {
    // Approve: as Unnepo read it, matched as usual; with no job to match, saved as a new one. When more than
    // one job fits, the student picks.
    result = await applyEmail(userId, job, event.receivedAt);
    if (result.outcome === "review" && result.reason === "several_matches") return { ok: false, event, error: "More than one job fits. Pick the application." };
    if (result.outcome === "review") result = await applyEmail(userId, job, event.receivedAt, null);
  } else return { ok: false, event };
  return { ok: true, event: await emailEvents.update(userId, event.id, { outcome: "approved", applicationId: result.applicationId }) };
}
