import { ServiceError } from "@/lib/errors";
import { applications } from "@/lib/apply/store";
import { addressFor, inboundReady } from "@/lib/email/address";
import { ATS_DOMAINS, JOB_PHRASES, gmailFilterQuery, type InboundEmail } from "@/lib/email/filter";
import { processEmail, reviewEmail } from "@/lib/email/process";
import { emailEvents, emailInboxes } from "@/lib/email/store";
import { unwrapForward } from "@/lib/email/inbound";

/** What the Email tracking page shows, and what it can do: regenerate the address, paste an email, review. */

const VERIFICATION_DAYS = 3;

export async function emailState(userId: string) {
  const [inbox, events, apps] = await Promise.all([emailInboxes.forUser(userId), emailEvents.list(userId, 200), applications.list(userId)]);
  const name = new Map(apps.map((app) => [app.id, { id: app.id, title: app.title, company: app.company }]));
  // The newest forwarding confirmation from the last few days: its code and link, to finish setting up.
  const verification = events.find((event) => event.outcome === "verification" && Date.now() - Date.parse(event.createdAt) < VERIFICATION_DAYS * 86_400_000);
  const show = (event: (typeof events)[number]) => ({
    id: event.id, at: event.receivedAt, kind: event.kind, company: event.company, jobTitle: event.jobTitle, confidence: event.confidence, summary: event.summary,
    outcome: event.outcome, reason: event.reason ?? null, source: event.source, application: event.applicationId ? name.get(event.applicationId) ?? null : null,
    candidates: (event.candidates ?? []).map((id) => name.get(id)).filter(Boolean),
  });
  return {
    address: addressFor(inbox.token),
    ready: inboundReady(),
    gmailQuery: gmailFilterQuery(),
    atsDomains: ATS_DOMAINS,
    phrases: JOB_PHRASES,
    verification: verification?.verification ? { ...verification.verification, at: verification.createdAt } : null,
    review: events.filter((event) => event.outcome === "review").map(show),
    recent: events.filter((event) => ["created", "updated", "approved"].includes(event.outcome)).slice(0, 20).map(show),
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
