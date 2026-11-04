/** What an email about a job says happened. */
export type EmailKind = "applied" | "incomplete" | "interview" | "assessment" | "offer" | "rejected" | "not_job_related";

/** A student's forwarding address: `token` is the "u_..." part, unique and hard to guess. */
export type EmailInbox = { token: string; userId: string; active: boolean; createdAt: string };

/** What happened with one email. */
export type EmailOutcome =
  | "created" // a new application, saved as applied
  | "updated" // an application's status changed
  | "review" // waiting in the Review Inbox: not sure enough, or more than one matching job
  | "approved" // the student approved it from the Review Inbox
  | "dismissed" // the student dismissed it
  | "ignored" // not about a job application
  | "skipped" // the one running count of emails dropped before the AI: holds a number and a time, nothing from any email
  | "verification"; // Gmail's or Outlook's forwarding confirmation

/**
 * One email Unnepo processed: what was taken from it. The text of an email about a job is kept apart, encrypted
 * (EmailText). The Message-ID is stored as a hash, only to tell the same email from a new one.
 */
export type EmailEvent = {
  id: string;
  userId: string;
  messageKey: string;
  receivedAt: string;
  source: "forward" | "paste";
  fromDomain: string;
  kind: EmailKind | "verification";
  company: string;
  jobTitle: string | null;
  /** Where the job is, and its posting number, when the email says. */
  location?: string | null;
  jobNumber?: string | null;
  /** Links in the email that lead to a job posting. */
  jobLinks?: string[];
  confidence: number;
  summary: string;
  outcome: EmailOutcome;
  applicationId: string | null;
  /** Why it's in the Review Inbox. */
  reason?: "low_confidence" | "several_matches" | "no_match";
  /** The jobs it could be, for "Pick application". */
  candidates?: string[];
  /** On the "skipped" row: how many emails were dropped before the AI read them. */
  skippedCount?: number;
  /** The forwarding confirmation's code and link, shown on the setup page until it's confirmed. */
  verification?: { provider: "gmail" | "outlook"; code: string | null; link: string | null };
  createdAt: string;
};

/** The text of an email about a job, encrypted in `data`. Saved under its event's id. */
export type EmailText = { eventId: string; userId: string; data: string; createdAt: string };
