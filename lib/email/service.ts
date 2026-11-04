import { ServiceError } from "@/lib/errors";
import { applications } from "@/lib/apply/store";
import { addressFor, inboundReady } from "@/lib/email/address";
import { ATS_DOMAINS, JOB_PHRASES, gmailFilterQuery, type InboundEmail } from "@/lib/email/filter";
import { SKIPPED_KEY, processEmail, reviewEmail } from "@/lib/email/process";
import { emailEvents, emailInboxes } from "@/lib/email/store";
import { unwrapForward } from "@/lib/email/inbound";

/** What the Email tracking page shows, and what it can do: regenerate the address, paste an email, review. */

const VERIFICATION_DAYS = 3;
const SKIPPED_SHOWN = 5;

export async function emailState(userId: string) {
  const [inbox, events, apps, count] = await Promise.all([emailInboxes.forUser(userId), emailEvents.list(userId, 200), applications.list(userId), emailEvents.byKey(userId, SKIPPED_KEY)]);
  const name = new Map(apps.map((app) => [app.id, { id: app.id, title: app.title, company: app.company }]));
  // The newest forwarding confirmation from the last few days: its code and link, to finish setting up.
  const verification = events.find((event) => event.outcome === "verification" && Date.now() - Date.parse(event.createdAt) < VERIFICATION_DAYS * 86_400_000);
  const lastEmail = events.find((event) => event.source === "forward" && event.outcome !== "verification" && event.messageKey !== SKIPPED_KEY);
  const show = (event: (typeof events)[number]) => ({
    id: event.id, at: event.receivedAt, kind: event.kind, company: event.company, jobTitle: event.jobTitle, confidence: event.confidence, summary: event.summary,
    outcome: event.outcome, reason: event.reason ?? null, source: event.source, application: event.applicationId ? name.get(event.applicationId) ?? null : null,
    candidates: (event.candidates ?? []).map((id) => name.get(id)).filter(Boolean),
  });
  return {
    address: addressFor(inbox.token),
    ready: inboundReady(),
    // Any forwarded email at all, the forwarding code or a skipped one included: forwarding works.
    forwarded: events.some((event) => event.source === "forward") || Boolean(count),
    // The newest real email forwarded in (not the forwarding code): the setup's test looks for a new one.
    lastEmail: lastEmail ? { id: lastEmail.id, at: lastEmail.createdAt, outcome: lastEmail.outcome, company: lastEmail.company, jobTitle: lastEmail.jobTitle, summary: lastEmail.summary } : null,
    gmailQuery: gmailFilterQuery(),
    atsDomains: ATS_DOMAINS,
    phrases: JOB_PHRASES,
    verification: verification?.verification ? { ...verification.verification, at: verification.createdAt } : null,
    review: events.filter((event) => event.outcome === "review").map(show),
    recent: events.filter((event) => ["created", "updated", "approved"].includes(event.outcome)).slice(0, 20).map(show),
    // Emails that arrived but weren't about a job, so the student knows they got here. The AI's one line for those
    // it read; only a count and a time for those dropped before it.
    skipped: {
      read: events.filter((event) => event.outcome === "ignored").slice(0, SKIPPED_SHOWN).map((event) => ({ id: event.id, at: event.receivedAt, summary: event.summary })),
      dropped: count?.skippedCount ?? 0,
      droppedAt: count?.receivedAt ?? null,
    },
    // Every open application, for "Pick application".
    applications: apps.filter((app) => app.status === "submitted" || app.status === "applied_manual").map((app) => ({ id: app.id, title: app.title, company: app.company })),
  };
}

export async function regenerateAddress(userId: string) {
  const inbox = await emailInboxes.regenerate(userId);
  return { address: addressFor(inbox.token) };
}

/**
 * A pasted email: its own "From:", "Subject:" and "Date:" lines are read when it has them (copied with its
 * headers, or a forwarded copy); otherwise it's all text. Runs through the same steps as a forwarded one.
 */
export function parsePasted(raw: string): InboundEmail {
  const text = raw.replace(/\r\n/g, "\n").trim().slice(0, 30_000);
  const head = text.slice(0, 1500);
  const field = (name: string) => head.match(new RegExp(`^\\s*${name}:\\s*(.+)$`, "im"))?.[1]?.trim() ?? "";
  const email: InboundEmail = { from: field("From"), subject: field("Subject"), date: field("Date") || field("Sent") || undefined, text };
  return email.subject.match(/^\s*(fwd?|fw)\s*:/i) ? unwrapForward(email) : email;
}

export async function pasteEmail(userId: string, raw: unknown) {
  const text = String((raw as { text?: unknown } | null)?.text ?? "");
  if (text.trim().length < 40) throw new ServiceError("Paste the whole email, with its sender and subject if you can.", "text", 400);
  const result = await processEmail(userId, parsePasted(text), "paste");
  const said: Record<string, string> = {
    created: "Saved as a new application.",
    updated: "Updated the application it's about.",
    review: "Not sure about this one: it's in your Review Inbox.",
    ignored: "This doesn't look like it's about a job application.",
    dropped: "This doesn't look like it's about a job application.",
    duplicate: "You've added this email already.",
    verification: "That's a forwarding confirmation: its code is at the top of this page.",
  };
  return { outcome: result.outcome, message: said[result.outcome] ?? "Done.", applicationId: result.applicationId ?? null };
}

export async function reviewInboxAction(userId: string, raw: unknown) {
  const result = await reviewEmail(userId, raw);
  if (!result.ok) throw new ServiceError("error" in result && result.error ? String(result.error) : "That email can't be changed now.", "review", 400);
  return { ok: true };
}
