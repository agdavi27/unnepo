import { FOLLOW_UPS_AT_MOST } from "@/lib/apply/follow-ups";

/**
 * The student's emails to people at a company where they applied, built to what gets replies (research notes:
 * research_notes/…/email_structure.md). Short (a first email of 45–100 words, follow-ups of 50 and 40 or fewer),
 * plain, one question as the only ask, and shaped by who it's to:
 *
 *   recruiter (or whoever posted the job): who the student is and the exact role and job ID, one proof point,
 *     "Is there anything else that would help your review?"
 *   hiring manager: their team's work, the application and a proof point, a 10-minute chat about the team
 *   alum: the shared school first, the application in a clause, 15 minutes about their path. Never asks for a job.
 *   someone on the team: their work, the application in a clause, 15 minutes about what the work is like
 *
 * The AI writes at most two sentences of it (`connection`, `proof`), and each is checked: too long, a question, an
 * exclamation or a stock phrase, and it's dropped for a plain line that's always true. Everything else comes from
 * the student's profile and the job, so the shape, length and ask never drift.
 *
 * A sequence is the first email and at most two follow-ups (MAX_FOLLOW_UPS); a fourth email gets more
 * complaints than replies.
 */

export type Audience = "recruiter" | "manager" | "alum" | "peer";

/** The contact's role, as the people search labels it, to who the email is written for. */
export function audienceOf(role: string): Audience {
  if (role === "recruiter" || role === "job_poster") return "recruiter";
  if (role === "hiring_manager") return "manager";
  if (role === "alumni") return "alum";
  return "peer";
}

export type OutreachFields = {
  firstName: string;
  studentName: string;
  /** "Junior", "Graduate student". */
  year: string;
  school: string;
  /** "Economics", "Economics and Computer Science". */
  major: string;
  /** The posting's title, as written. */
  role: string;
  company: string;
  jobId: string;
  audience: Audience;
  /** One sentence the AI wrote about the person's work or team, or the shared school. Checked by `usable`. */
  connection: string;
  /** One sentence with a concrete fact from the student's resume that fits the role. Checked by `usable`. */
  proof: string;
};

/** Words that mark an email as a template or as written by AI. A sentence with one of these is dropped. */
export const BANNED = /\b(hope (this|you)|reaching out|reach out|came across|my name is|passionate|excited|thrilled|delve|leverage|innovative|cutting[- ]edge|pick your brain|aligns? perfectly|look forward|just (following|checking)|circling back|bump(ing)? this|synerg|dynamic|i am writing)\b/i;

const tidy = (text: string) => text.replace(/\s+/g, " ").trim();
export const wordCount = (text: string) => (text.match(/[A-Za-z0-9'’]+/g) ?? []).length;

/** An AI sentence fit to send: one statement, `max` words or fewer, no question or exclamation, no stock phrase. */
export function usable(sentence: string, max = 25) {
  const text = tidy(sentence ?? "");
  if (!text || wordCount(text) > max || /[?!]/.test(text) || BANNED.test(text) || /\[|\{|\bTODO\b/.test(text)) return "";
  return /[.]$/.test(text) ? text : `${text}.`;
}

/** "Investment Banking Summer Analyst – New York, 2027" → "Investment Banking Summer Analyst", for a subject line. */
export function shortRole(role: string) {
  return tidy(role.split(/\s[-–|,(]\s?|,|\(/)[0]).replace(/\b(20\d\d)\b/g, "").replace(/\s+/g, " ").trim() || role;
}

/** A subject of 2 to 6 words and 40 characters or fewer, in sentence case, led by what the reader cares about. */
export function subjectFor(f: Pick<OutreachFields, "audience" | "school" | "role" | "company">) {
  const role = shortRole(f.role);
  const options = f.audience === "alum" && f.school ? [`Fellow ${f.school} student`, `${f.school} student`]
    : f.audience === "recruiter" ? [`${role} application`, `${f.company} application`]
    : [`${role} at ${f.company}`, `${role} application`, `${f.company} application`];
  return options.find((option) => option.length <= 40 && wordCount(option) <= 6) ?? options.at(-1)!.slice(0, 40).trim();
}

/** "a junior at Colby College studying Economics" */
function whoClause(f: OutreachFields) {
  const at = f.year && f.school ? `a ${f.year.toLowerCase()} at ${f.school}` : f.school ? `a student at ${f.school}` : f.year ? `a ${f.year.toLowerCase()}` : "a student";
  return f.major ? `${at} studying ${f.major}` : at;
}

const ASKS: Record<Audience, (f: OutreachFields) => string> = {
  recruiter: () => "Is there anything else that would help your review?",
  manager: () => "Would you be open to a 10-minute chat about the team’s work?",
  alum: (f) => `Would you be open to a 15-minute call about your path to ${f.company}?`,
  peer: () => "Would you be open to a 15-minute call about what the work is like?",
};

/** The first email. */
export function outreachEmail(fields: OutreachFields) {
  const f = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, tidy(String(value ?? ""))])) as OutreachFields;
  const connection = usable(f.connection);
  const proof = usable(f.proof);
  const job = f.jobId ? ` (${f.jobId})` : "";
  const who = whoClause(f);
  const opener = {
    recruiter: `I’m ${who}, and I just applied for the ${f.role} role${job}.`,
    manager: connection || `I just applied for the ${f.role} role on your team${job}.`,
    alum: connection || (f.school ? `I saw that you went to ${f.school} too, and I’d love to hear how you got to ${f.company}.` : `I’d love to hear how you got to ${f.company}.`),
    peer: connection || `I’d love to hear what your work at ${f.company} is like.`,
  }[f.audience];
  const middle = {
    recruiter: proof,
    manager: connection ? `I’m ${who}, and I just applied for the ${f.role} role${job}. ${proof}` : `I’m ${who}. ${proof}`,
    alum: `I’m ${who}, and I recently applied for the ${f.role} role there.`,
    peer: `I’m ${who}, and I recently applied for the ${f.role} role there.`,
  }[f.audience];
  const body = [`Hi ${f.firstName || "there"},`, opener, tidy(middle), ASKS[f.audience](f)].filter(Boolean).join("\n\n") + `\n\nThank you,\n${f.studentName}`;
  return { subject: subjectFor(f), body };
}

/** The most emails after the first: two follow-ups, then stop. */
export const MAX_FOLLOW_UPS = FOLLOW_UPS_AT_MOST;

/**
 * A follow-up in the same thread ("Re: …"). The first (50 words or fewer) adds one new detail and a smaller ask;
 * the second (40 or fewer) is the last note, and asks who else to talk to.
 */
export function followUpEmail(input: { firstName: string; studentName: string; role: string; audience: Audience; subject: string; number: 1 | 2; detail: string }) {
  const subject = /^re:/i.test(input.subject) ? input.subject : `Re: ${input.subject}`.slice(0, 200);
  const hi = `Hi ${tidy(input.firstName) || "there"},`;
  const sign = `Thank you,\n${tidy(input.studentName)}`;
  if (input.number === 2) {
    return { subject, body: [hi, `I know your inbox is busy, so this is my last note about the ${tidy(input.role)} role. Is there someone else on the team you’d suggest I talk to?`, sign].join("\n\n") };
  }
  const detail = usable(input.detail, 20) || `I’m still very interested in the ${tidy(input.role)} role.`;
  const ask = input.audience === "recruiter" ? "Is there anything I can send to help your review?" : "Would you have 10 minutes in the next couple of weeks?";
  return { subject, body: [hi, `${detail} ${ask}`, sign].join("\n\n") };
}

const SHORT_ID = /^[A-Z]{0,5}[-_]?\d{3,12}(?:[-_][A-Z0-9]{1,6})?$/i;

/**
 * The job's ID as the company would recognize it: a requisition number the posting states ("Job ID: R-12345"),
 * else the number in the job's link (Workday's req, Greenhouse's job, LinkedIn's and Handshake's job pages).
 * Long random IDs (Lever's, Ashby's) aren't worth putting in an email and are left out.
 */
export function jobIdOf(job: { jobUrl: string; description?: string }) {
  const stated = (job.description ?? "").match(/\b(?:job|req(?:uisition)?|posting|position)\s*(?:id|#|number|no\.?)\s*[:#.]?\s*([A-Z0-9][A-Z0-9_-]{2,19})\b/i)?.[1];
  if (stated && SHORT_ID.test(stated)) return `Job ID ${stated}`;
  let url: URL;
  try { url = new URL(job.jobUrl); } catch { return ""; }
  const host = url.hostname.replace(/^www\./, "");
  const path = url.pathname;
  const fromLink = /myworkday(jobs|site)\.com$/.test(host) ? path.split("/").pop()?.split("_").pop()
    : /greenhouse\.io$/.test(host) ? path.match(/\/jobs\/(\d+)/)?.[1] ?? url.searchParams.get("gh_jid")
    : /linkedin\.com$/.test(host) ? path.match(/\/jobs\/view\/(?:[^/]*-)?(\d{6,})/)?.[1] ?? url.searchParams.get("currentJobId")
    : /joinhandshake\.com$/.test(host) ? path.match(/\/(?:jobs|job-search)\/(\d+)/)?.[1]
    : url.searchParams.get("gh_jid") ?? url.searchParams.get("jobId") ?? url.searchParams.get("job_id");
  return fromLink && SHORT_ID.test(fromLink) ? `Job ID ${fromLink}` : "";
}
