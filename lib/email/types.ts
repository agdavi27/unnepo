/** What an email about a job says happened. */
export type EmailKind = "applied" | "interview" | "assessment" | "offer" | "rejected" | "not_job_related";

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
  | "verification"; // Gmail's or Outlook's forwarding confirmation

/**
 * One email Unnepo processed. Only what was taken from it is kept: never its body. The Message-ID is stored
 * as a hash, only to tell the same email from a new one.
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
  confidence: number;
  summary: string;
  outcome: EmailOutcome;
  applicationId: string | null;
  /** Why it's in the Review Inbox. */
  reason?: "low_confidence" | "several_matches" | "no_match";
  /** The jobs it could be, for "Pick application". */
  candidates?: string[];
  /** The forwarding confirmation's code and link, shown on the setup page until it's confirmed. */
  verification?: { provider: "gmail" | "outlook"; code: string | null; link: string | null };
  createdAt: string;
};
