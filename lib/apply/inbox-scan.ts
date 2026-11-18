/**
 * Scan my email: emails that ask the student to do something next, read off their own inbox (sender, subject and
 * the preview line) and sorted into a to-do list. It all runs in the extension; no email is sent anywhere. No
 * imports, so the extension bundles it. Plain "thanks for applying" confirmations are left out.
 *
 *   reply      someone the student emailed wrote back               → Mark replied
 *   offer      an offer                                             → Set Offer
 *   interview  an interview, a screen or an assessment               → Set Interviewing
 *   followup   any other next step or follow-up (reply, schedule,    (open the email)
 *              complete a form, checking in)
 *   rejected   "unfortunately", "other candidates"                  → Set Rejected
 *
 * Emails about a company that isn't in Unnepo count too; they just have no status to set.
 */

export type MailRow = { id: string; fromName: string; fromEmail: string; subject: string; snippet: string; at: number; url: string };
export type InboxKind = "reply" | "interview" | "offer" | "followup" | "rejected";
export type InboxItem = {
  key: string; kind: InboxKind; company: string; jobTitle: string; applicationId: string; contactId: string; contactName: string;
  fromName: string; subject: string; snippet: string; at: number; url: string;
  /** How many emails this one stands for: everything from one person, about one job, or from one company not in Unnepo. */
  count: number;
};
/** What Scan my email found last, kept on this computer for the Follow up tab. */
export type InboxScan = { at: number; looked: number; items: InboxItem[]; error?: string };
export type ScanJob = {
  id: string; title: string; company: string; stage: string; createdAt: string;
  contacts: Array<{ id: string; name: string; email: string | null; outreachStatus: string }>;
};

const OFFER = /\b(offer letter|pleased to offer|happy to offer|excited to offer|extend (you )?an offer|job offer|offer of employment)\b/;
const REJECTED = /\b(unfortunately|regret to inform|not (to )?(be )?mov(e|ing) forward|decided (to )?(pursue|move forward with|proceed with) other|other candidates|no longer (being )?consider|position has been filled|will not be (moving|proceeding)|not (been )?selected|won't be moving forward|not a fit at this time)\b/;
const INTERVIEW = /\b(interview|phone screen|screening call|schedule (a|some) (time|call|chat)|your availability|times that work|move you forward|moving you forward|invite you to|coding (challenge|assessment)|online assessment|take-home|hirevue|codesignal|hackerrank)\b/;
/** Any other next step or follow-up: something the student is asked to do, or someone checking in. */
const FOLLOW_UP = /\b(next steps?|follow(ing)?[ -]up|checking in|check in|action (required|needed)|please (complete|submit|confirm|respond|reply|let (us|me) know|fill out|sign|review|schedule|book|select)|complete (your|the|this) (application|assessment|profile|form|questionnaire|survey)|get back to (you|us|me)|let (me|us) know|would (love|like) to (chat|connect|talk|speak|meet|hear|learn)|reach(ing)? out|update on your application|status of your application|application (status|update)|still interested|are you (still )?(available|free|interested)|when (are you|would you be) (free|available)|book a time|pick a time|calendly)\b/;
/** Words that say an email from a company not in Unnepo is about a job, so a "let me know" from anyone else isn't. */
const JOBISH = /\b(application|applied|applying|apply|role|position|candida(te|cy)|recruit(er|ing)?|interview|hiring|opportunit(y|ies)|internship|intern|job|offer|resume)\b/;
const CONFIRMED = /\b(thank(s| you) for (applying|your application|your interest|submitting)|application (has been |was )?(received|submitted)|received your application|we('ve| have) received|application confirmation|successfully (applied|submitted))\b/;

/** Mail services and job sites whose domain says nothing about the company. */
const SHARED_DOMAINS = /^(gmail|googlemail|outlook|hotmail|live|yahoo|icloud|me|aol|proton|protonmail|greenhouse|greenhouse-mail|lever|hire|myworkday|myworkdayjobs|workday|icims|smartrecruiters|ashbyhq|ashby|workable|jobvite|bamboohr|breezy|recruitee|teamtailor|rippling|successfactors|taleo|oracle|paylocity|ultipro|ukg|dayforce|ceridian|adp|jazzhr|applytojob|linkedin|indeed|indeedemail|glassdoor|ziprecruiter|handshake|joinhandshake|wellfound|angellist|dice|simplify|mail|email|notifications?|careers?|jobs?|talent|recruiting|noreply|no-reply)$/;

const plain = (text: string) => ` ${text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim()} `;
/** A company as words to look for: "Stripe, Inc." → "stripe". Too short or too plain to find safely: "". */
export function companyWords(company: string) {
  const words = plain(company).replace(/ (inc|llc|ltd|limited|corp|corporation|co|company|plc|gmbh|group|holdings|the|lp|llp)(?= )/g, " ").trim();
  return words.length >= 3 ? words : "";
}
/** The part of an email's domain that names the company: "careers.stripe.com" → "stripe". Job sites' and mail services' domains: "". */
export function domainName(email: string) {
  const host = (email.split("@")[1] ?? "").toLowerCase();
  const parts = host.split(".").filter(Boolean);
  if (parts.length < 2) return "";
  // "acme.co.uk" → "acme"; "careers.acme.com" → "acme".
  const second = parts.length > 2 && /^(co|com|ac|org|gov|edu|net)$/.test(parts[parts.length - 2]) ? parts[parts.length - 3] : parts[parts.length - 2];
  return second && !SHARED_DOMAINS.test(second) ? second : "";
}

/** The job in the tracker an email is about: its company in the sender, the domain, the subject or the preview. */
export function jobFor(row: MailRow, jobs: ScanJob[]) {
  const text = plain(`${row.fromName} ${row.subject} ${row.snippet}`);
  const domain = domainName(row.fromEmail);
  let best: { job: ScanJob; score: number } | null = null;
  for (const job of jobs) {
    const words = companyWords(job.company);
    if (!words) continue;
    const compact = words.replace(/ /g, "");
    const inText = text.includes(` ${words} `);
    const inDomain = Boolean(domain) && (domain === compact || (compact.length >= 4 && domain.startsWith(compact)) || (domain.length >= 4 && compact.startsWith(domain)));
    if (!inText && !inDomain) continue;
    // Longer names are surer; a job whose title is in the email too wins between two at one company.
    const titleWords = companyWords(job.title);
    const score = words.length + (inDomain ? 20 : 0) + (titleWords && text.includes(` ${titleWords} `) ? 50 : 0) + Date.parse(job.createdAt) / 1e13;
    if (!best || score > best.score) best = { job, score };
  }
  return best?.job ?? null;
}

/** "Thank you for applying to Notion!" → "Notion"; "Stripe Recruiting" → "Stripe". Blank when it can't tell. */
export function companyFromEmail(row: MailRow) {
  const said = /\b(?:applying|application|applied|interest) (?:to|at|with|for|in) (?:the )?(?:[\w ,&'-]{2,60}? (?:position|role|job) at )?([A-Z][\w&.'’-]*(?: [A-Z&][\w&.'’-]*){0,3})/.exec(`${row.subject} ${row.snippet}`);
  if (said?.[1] && !/^(the|our|this|your|a|an)$/i.test(said[1])) return said[1].replace(/[.,!]+$/, "");
  const name = row.fromName.replace(/\b(recruiting|recruitment|careers?|talent( acquisition)?|team|hiring|hr|jobs|people|no-?reply|notifications?|via \w+|at \w+)\b/gi, " ").replace(/[|·:-]+/g, " ").replace(/\s+/g, " ").trim();
  if (name && name.split(" ").length <= 4 && !/@/.test(name) && !SHARED_DOMAINS.test(name.toLowerCase().replace(/\s+/g, ""))) return name;
  const domain = domainName(row.fromEmail);
  return domain ? domain.replace(/^./, (letter) => letter.toUpperCase()) : "";
}

/**
 * Sorts the emails into to-dos, newest first, leaving out what's already true in the tracker (a job already marked
 * Rejected, someone already marked as having replied). Several emails from one person, about one job, or from one
 * company not in Unnepo are one to-do: the newest says what it is, and `count` says how many there were.
 */
export function sortInbox(rows: MailRow[], jobs: ScanJob[]): InboxItem[] {
  const contacts = new Map<string, { job: ScanJob; contact: ScanJob["contacts"][number] }>();
  for (const job of jobs) for (const contact of job.contacts) if (contact.email) contacts.set(contact.email.toLowerCase(), { job, contact });
  const seen = new Set<string>();
  const items: InboxItem[] = [];
  for (const row of [...rows].sort((a, b) => b.at - a.at)) {
    if (!row.id || seen.has(row.id)) continue;
    seen.add(row.id);
    const words = plain(`${row.subject} ${row.snippet}`);
    const person = contacts.get(row.fromEmail.toLowerCase());
    const job = person?.job ?? jobFor(row, jobs);
    // A "thanks for applying" that mentions what happens next ("next steps: we'll review it") is still only a
    // confirmation: nothing for the student to do.
    const confirmation = CONFIRMED.test(words);
    const kind: InboxKind | null = person ? "reply"
      : OFFER.test(words) ? "offer"
      : REJECTED.test(words) ? "rejected"
      : INTERVIEW.test(words) ? "interview"
      : FOLLOW_UP.test(words) && !confirmation ? "followup"
      : null;
    if (!kind) continue;
    // A company that isn't in Unnepo: only when the email is clearly about a job.
    if (!job && kind !== "reply" && !JOBISH.test(words)) continue;
    // Already true in the tracker: nothing to do.
    if (kind === "reply" && person && person.contact.outreachStatus === "replied") continue;
    if (kind === "rejected" && job?.stage === "rejected") continue;
    if (kind === "offer" && job?.stage === "offer") continue;
    if (kind === "interview" && (job?.stage === "interviewing" || job?.stage === "offer" || job?.stage === "rejected")) continue;
    if (kind === "followup" && job?.stage === "rejected") continue;
    const company = job?.company || companyFromEmail(row) || row.fromName;
    if (!company) continue;
    items.push({
      key: row.id, kind, company, jobTitle: job?.title ?? "", applicationId: job?.id ?? "", contactId: person?.contact.id ?? "", contactName: person?.contact.name ?? "",
      fromName: row.fromName, subject: row.subject, snippet: row.snippet, at: row.at, url: row.url, count: 1,
    });
  }
  // One to-do per person, job or company: the newest email is the one shown (they're already newest first).
  const groups = new Map<string, InboxItem>();
  for (const item of items) {
    const key = item.kind === "reply" ? `p:${item.contactId}` : item.applicationId ? `j:${item.applicationId}` : `n:${companyWords(item.company) || item.company.toLowerCase()}`;
    const first = groups.get(key);
    if (first) first.count += 1;
    else groups.set(key, { ...item, key });
  }
  return [...groups.values()];
}

/**
 * The Gmail searches a scan runs, in the inbox: emails about jobs or with a next step or follow-up from the last 60
 * days (promotions and social left out), and anything from the people the student emailed. No "in:chats": with
 * Google Chat on, Gmail opens a search that names chats on its Conversations tab, which shows no emails.
 */
export function gmailSearches(contactEmails: string[]) {
  const words = [
    'subject:(application OR applying OR applied OR interview OR candidacy OR "next steps" OR "next step" OR offer OR "follow up" OR "following up" OR "checking in" OR assessment OR availability)',
    '"next steps"', '"next step"', '"follow up"', '"following up"', '"checking in"', '"action required"',
    '"your application"', '"not moving forward"', '"other candidates"', '"phone screen"', '"your availability"', '"schedule a call"', '"schedule a time"',
  ];
  const searches = [`in:inbox newer_than:60d -category:promotions -category:social {${words.join(" ")}}`];
  const emails = [...new Set(contactEmails.map((email) => email.toLowerCase()).filter((email) => /^[^\s@()"]+@[^\s@()"]+\.[a-z]{2,}$/.test(email)))].slice(0, 40);
  if (emails.length) searches.push(`in:inbox newer_than:120d from:(${emails.join(" OR ")})`);
  return searches;
}
