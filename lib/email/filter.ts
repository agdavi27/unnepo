/**
 * The quick check before any AI call: an email from a job system (Workday, Greenhouse, Lever…) or one that says
 * something only job emails say. Everything else is dropped at once and never stored.
 */

export const ATS_DOMAINS = [
  "myworkday.com", "myworkdayjobs.com", "greenhouse.io", "greenhouse-mail.io", "lever.co", "icims.com", "smartrecruiters.com", "ashbyhq.com",
  "jobvite.com", "taleo.net", "successfactors.com", "linkedin.com", "indeed.com",
];

// What the mail rule forwards: phrases job emails use, kept narrow so little else leaves the student's inbox.
export const JOB_PHRASES = [
  "thank you for applying", "thanks for applying", "application received", "application submitted", "your application", "your candidacy",
  "thank you for your interest", "thanks for your interest", "interview", "assessment", "offer",
];
// Unnepo's own check is wider, since the AI reads what passes and the student may forward anything by hand.
// "Thank you for your submission for the Sales position" says none of the phrases above.
const JOB_WORDS = [...JOB_PHRASES, "application", "applying", "applied", "candidacy", "candidate", "recruiter", "recruiting", "hiring", "position", "resume", "moving forward", "move forward"];

export type InboundEmail = { from: string; subject: string; date?: string; text: string; messageId?: string; html?: string };

/** The sender's domain: "jobs@mail.greenhouse.io" and "Acme <no-reply@acme.com>" give "mail.greenhouse.io" and "acme.com". */
export function senderDomain(from: string) {
  return from.toLowerCase().match(/@([a-z0-9.-]+\.[a-z]{2,})/)?.[1] ?? "";
}

const fromJobSystem = (domain: string) => ATS_DOMAINS.some((ats) => domain === ats || domain.endsWith(`.${ats}`));

// Whole words, with or without a plural s: "interviews" counts, "offered" and "unoffered" don't.
const PHRASE = new RegExp(`\\b(${JOB_WORDS.map((phrase) => phrase.replace(/ /g, "\\s+")).join("|")})s?\\b`, "i");

export function passesPrefilter(email: InboundEmail) {
  if (fromJobSystem(senderDomain(email.from))) return true;
  return PHRASE.test(`${email.subject}\n${email.text.slice(0, 20_000)}`);
}

/** The search for a Gmail filter that forwards these emails: the job systems' domains, or the phrases. */
export function gmailFilterQuery() {
  return `from:(${ATS_DOMAINS.join(" OR ")}) OR ${JOB_PHRASES.map((phrase) => `"${phrase}"`).join(" OR ")}`;
}
