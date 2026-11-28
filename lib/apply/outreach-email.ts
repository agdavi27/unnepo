import { FOLLOW_UPS_AT_MOST } from "@/lib/apply/follow-ups";

/**
 * The student's emails to people at a company where they applied. The first email to anyone (recruiter, hiring
 * manager, alum or someone on the team) is three sentences, no warm-up and no filler:
 *
 *   Subject: Thank you! - [Role]
 *
 *   Hi [Name],
 *
 *   I just applied for the [Role] role at [Company]. I've been following your team's work in [part of the field],
 *   especially [initiative]. My experience in [1], [2], and [3] lines up with what the role needs. I'm really excited about the chance to join the team, so please reach out if you have any questions about my application.
 *
 *   Best,
 *   [Student]
 *
 * The skeleton is built here; the AI fills only the slots (`field`, `initiative`, `skills`), and each slot is
 * checked: too long, a question, an exclamation, a stock phrase or a placeholder, and it's dropped for a plain
 * wording that's always true. So the shape never drifts.
 *
 * A sequence is the first email and at most two follow-ups (MAX_FOLLOW_UPS); a fourth email gets more
 * complaints than replies. Follow-ups keep their own short shape (`followUpEmail`).
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
  /** The contact's first name. */
  firstName: string;
  studentName: string;
  /** The posting's title, as written. */
  role: string;
  company: string;
  /** The specific part of the field the team works in ("live sports media analytics"), from the posting. Checked by `slot`. */
  field: string;
  /** Something real the company or team does that the posting or company info names (a product, project, initiative, article, podcast). Checked by `slot`. Never invented: empty when there's none. */
  initiative: string;
  /** Up to three skills or experiences the posting names that the student's resume shows. Each checked by `slot`. */
  skills: string[];
};

/** The email's last sentence: the student's excitement, and an open door for questions. Written here, so BANNED (which checks the AI's slots) doesn't apply. */
export const CLOSING = "I'm really excited about the chance to join the team, so please reach out if you have any questions about my application.";

/** Words that mark an AI-written sentence or phrase as a template or as written by AI. One with these is dropped. */
export const BANNED = /\b(hope (this|you)|reaching out|reach out|came across|my name is|passionate|excited|thrilled|delve|leverage|innovative|cutting[- ]edge|pick your brain|aligns? perfectly|look forward|just (following|checking)|circling back|bump(ing)? this|synerg|dynamic|i am writing)\b/i;

const tidy = (text: string) => text.replace(/\s+/g, " ").trim();
export const wordCount = (text: string) => (text.match(/[A-Za-z0-9'’]+/g) ?? []).length;

/** An AI sentence fit to send: one statement, `max` words or fewer, no question or exclamation, no stock phrase. */
export function usable(sentence: string, max = 25) {
  const text = tidy(sentence ?? "");
  if (!text || wordCount(text) > max || /[?!]/.test(text) || BANNED.test(text) || /\[|\{|\bTODO\b/.test(text)) return "";
  return /[.]$/.test(text) ? text : `${text}.`;
}

/** An AI phrase fit to drop into a slot mid-sentence: `max` words or fewer, no sentence punctuation, no stock phrase, no placeholder. */
export function slot(phrase: string, max = 12) {
  const text = tidy(String(phrase ?? "")).replace(/^[-–—,;:\s]+|[.,;:\s]+$/g, "");
  if (!text || wordCount(text) > max || /[?!]|--|[—–]|[a-z]{3,}\.\s/.test(text) || BANNED.test(text) || /\[|\{|\bTODO\b|\bN\/A\b|^none$/i.test(text)) return "";
  return text;
}

/** "a, b, and c"; "a and b"; "a". */
function list(items: string[]) {
  if (items.length <= 2) return items.join(" and ");
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

/** "Investment Banking Summer Analyst – New York, 2027" → "Investment Banking Summer Analyst", for a subject line. */
export function shortRole(role: string) {
  return tidy(role.split(/\s[-–|,(]\s?|,|\(/)[0]).replace(/\b(20\d\d)\b/g, "").replace(/\s+/g, " ").trim() || role;
}

/** "Thank you! - Sports Analyst". */
export function subjectFor(f: Pick<OutreachFields, "role">) {
  return `Thank you! - ${shortRole(tidy(f.role))}`.slice(0, 200);
}

/** The first email, to anyone at the company: four sentences, ending with the ask. */
export function outreachEmail(fields: OutreachFields) {
  const role = shortRole(tidy(fields.role ?? ""));
  const company = tidy(fields.company ?? "");
  const field = slot(fields.field);
  const initiative = slot(fields.initiative, 14);
  const skills = [...new Set((fields.skills ?? []).map((skill) => slot(skill, 6)).filter(Boolean))].slice(0, 3);
  const applied = `I just applied for the ${role} role${company ? ` at ${company}` : ""}.`;
  const work = field ? `your team's work in ${field}` : company ? `the work your team is doing at ${company}` : "the work your team is doing";
  // No real initiative to name: the sentence stops at the team's work rather than make one up.
  const following = `I've been following ${work}${initiative ? `, especially ${initiative}` : ""}.`;
  const fit = skills.length ? `My experience in ${list(skills)} lines up with what the role needs` : "My background lines up with what the role needs";
  const body = [
    `Hi ${tidy(fields.firstName ?? "") || "there"},`,
    `${applied} ${following} ${fit}. ${CLOSING}`,
    `Best,\n${tidy(fields.studentName ?? "")}`,
  ].join("\n\n");
  return { subject: subjectFor({ role }), body };
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
