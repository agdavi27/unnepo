/**
 * The student's outreach email, always in the same shape:
 *
 *   Subject: {school} student, applied to {role} at {company}
 *   Hi {first_name},
 *   I'm {name}, a {year} at {school} studying {major}. I just applied for the {role} position at {company}
 *   ({job id}) and wanted to reach out directly.
 *   I was excited to learn more about {company}'s work on {detail}. {link}
 *   If you have a few minutes sometime this week, … I've also attached my resume for your reference.
 *   Best,
 *   {name}
 *
 * Everything but {detail} and {link} comes from the student's profile and the job; the AI writes only those two.
 * A missing piece drops its words instead of leaving a gap.
 */

export type OutreachFields = {
  firstName: string;
  studentName: string;
  /** "Junior", "Graduate student". */
  year: string;
  school: string;
  /** "Economics", "Economics and Computer Science". */
  major: string;
  role: string;
  company: string;
  jobId: string;
  /** A product, project, deal or kind of work at the company: "its esports partnerships". */
  detail: string;
  /** One sentence tying that to the student's own experience or interest. */
  link: string;
};

const tidy = (text: string) => text.replace(/\s+/g, " ").trim();

export function outreachEmail(fields: OutreachFields) {
  const f = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, tidy(value ?? "")])) as OutreachFields;
  const subject = f.school ? `${f.school} student, applied to ${f.role} at ${f.company}` : `Applied to ${f.role} at ${f.company}`;
  const who = f.year && f.school ? `a ${f.year.toLowerCase()} at ${f.school}`
    : f.school ? `a student at ${f.school}`
    : f.year ? `a ${f.year.toLowerCase()}`
    : "";
  const studying = f.major ? `${who ? " " : "a student "}studying ${f.major}` : "";
  const intro = who || studying ? `I’m ${f.studentName}, ${who}${studying}.` : `I’m ${f.studentName}.`;
  const detail = f.detail.replace(/[.!\s]+$/, "");
  const link = f.link && !/[.!?]$/.test(f.link) ? `${f.link}.` : f.link;
  const body = [
    `Hi ${f.firstName || "there"},`,
    `${intro} I just applied for the ${f.role} position at ${f.company}${f.jobId ? ` (${f.jobId})` : ""} and wanted to reach out directly.`,
    [detail ? `I was excited to learn more about ${possessive(f.company)} work on ${detail}.` : `I was excited to learn more about the work ${f.company} is doing.`, link].filter(Boolean).join(" "),
    "If you have a few minutes sometime this week, it would be great to learn more. Happy to connect whenever is most convenient for you. I’ve also attached my resume for your reference.",
    `Best,\n${f.studentName}`,
  ].join("\n\n");
  return { subject: subject.slice(0, 200), body };
}

const possessive = (name: string) => (/s$/i.test(name) ? `${name}’` : `${name}’s`);

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
