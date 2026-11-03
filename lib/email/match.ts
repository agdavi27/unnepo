import { stageOf } from "@/lib/apply/stats";
import type { JobApplication } from "@/lib/apply/types";

/**
 * Which saved application an email is about. Companies are compared by a plain form of their name ("P&G",
 * "Procter & Gamble" and "The Procter and Gamble Company" are one company), titles by their words.
 */

// Names people and emails use for the same company. Each list is one company.
const SAME_COMPANY: string[][] = [
  ["procter and gamble", "p and g", "pg"],
  ["johnson and johnson", "j and j", "jnj"],
  ["jpmorgan chase", "jp morgan", "jpmorgan", "jpmc", "chase", "j p morgan"],
  ["bank of america", "bofa", "boa", "bank of america merrill lynch"],
  ["ernst and young", "ey"],
  ["pricewaterhousecoopers", "pwc"],
  ["boston consulting group", "bcg"],
  ["mckinsey", "mckinsey and company"],
  ["international business machines", "ibm"],
  ["general electric", "ge", "ge aerospace", "ge vernova", "ge healthcare"],
  ["hewlett packard", "hp", "hewlett packard enterprise", "hpe"],
  ["at and t", "att"],
  ["alphabet", "google"],
  ["meta", "facebook", "meta platforms"],
  ["amazon", "amazon web services", "aws"],
  ["3m", "minnesota mining and manufacturing"],
  ["l oreal", "loreal"],
];

// Words that don't tell two companies apart.
const SUFFIX = /\b(the|inc|incorporated|llc|l l c|ltd|limited|corp|corporation|co|company|companies|plc|gmbh|ag|sa|lp|llp|group|holdings|usa|us|na|north america|global|international|worldwide)\b/g;

/** A company's name in a plain form: lowercase, "&" as "and", punctuation and legal words gone. */
export function normalizeCompany(name: string) {
  const plain = name.toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // "JPMorgan Chase & Co." loses "& Co." whole, not just the "Co.".
  const bare = plain.replace(SUFFIX, " ").replace(/\s+/g, " ").trim().replace(/^and\b\s*|\s*\band$/g, "").trim();
  return bare || plain;
}

const KNOWN = new Map<string, number>();
SAME_COMPANY.forEach((names, index) => names.forEach((name) => KNOWN.set(normalizeCompany(name), index)));

/** "procter and gamble" → "pg": the first letters of its words, leaving out "and" and "of". */
const initials = (plain: string) => plain.split(" ").filter((word) => word && !/^(and|of|the|for)$/.test(word)).map((word) => word[0]).join("");

function closeEnough(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 2 || Math.min(a.length, b.length) < 6) return false;
  // Levenshtein distance, for a typo or a dropped letter ("Deloite", "Accenture" / "Accentur").
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const saved = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = saved;
    }
  }
  return row[b.length] <= 1;
}

/** Whether two names are the same company. */
export function sameCompany(a: string, b: string) {
  const [x, y] = [normalizeCompany(a), normalizeCompany(b)];
  if (!x || !y) return false;
  if (x === y) return true;
  const [knownX, knownY] = [KNOWN.get(x), KNOWN.get(y)];
  if (knownX !== undefined && knownX === knownY) return true;
  // An abbreviation of the other's words: "P&G" and "Procter & Gamble", "BCG" and "Boston Consulting Group".
  const [squashedX, squashedY] = [x.replace(/ /g, ""), y.replace(/ /g, "")];
  if (squashedX.length >= 2 && squashedX.length <= 5 && !x.includes(" ") && y.includes(" ") && initials(y) === squashedX) return true;
  if (squashedY.length >= 2 && squashedY.length <= 5 && !y.includes(" ") && x.includes(" ") && initials(x) === squashedY) return true;
  // One name is the other's start, word for word: "Workday" and "Workday Talent Acquisition".
  if (x.length >= 4 && y.length >= 4 && (`${y} `.startsWith(`${x} `) || `${x} `.startsWith(`${y} `))) return true;
  return squashedX === squashedY || closeEnough(squashedX, squashedY);
}

// Words that say nothing about which job it is.
const TITLE_FILLER = /\b(the|a|an|of|for|and|to|in|at|role|position|job|opening|opportunity|req|requisition|\d{4,}|r\d+|jr\d+)\b/g;
const titleWords = (title: string) => new Set(title.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(TITLE_FILLER, " ").split(/\s+/).filter(Boolean));

/** Whether two titles name the same job: the same words, or most of them ("Data Analyst Intern" and "Intern, Data Analyst"). */
export function sameTitle(a: string, b: string) {
  const [x, y] = [titleWords(a), titleWords(b)];
  if (!x.size || !y.size) return false;
  const shared = [...x].filter((word) => y.has(word)).length;
  return shared / Math.min(x.size, y.size) >= 0.8 || shared / Math.max(x.size, y.size) >= 0.6;
}

type Candidate = Pick<JobApplication, "id" | "company" | "title" | "status" | "fillReport" | "createdAt" | "submittedAt">;

/** Still in play: not rejected and not an offer already. */
const open = (app: Candidate) => {
  const stage = stageOf(app);
  return stage !== "rejected" && stage !== "offer";
};
const UNKNOWN_TITLE = /^(unknown role|job title missing)$/i;

export type Match<T> = { kind: "one"; app: T } | { kind: "none"; atCompany: T[] } | { kind: "several"; candidates: T[] };

/**
 * The application an email is about. With a title: the one at that company with the same title. Without one: the
 * open application at that company. Two or more that fit: several, for the student to pick in the Review Inbox.
 */
export function matchApplication<T extends Candidate>(apps: T[], email: { company: string; jobTitle: string | null }): Match<T> {
  const atCompany = apps.filter((app) => sameCompany(app.company, email.company));
  if (!atCompany.length) return { kind: "none", atCompany };
  if (email.jobTitle) {
    const titled = atCompany.filter((app) => sameTitle(app.title, email.jobTitle!));
    if (titled.length === 1) return { kind: "one", app: titled[0] };
    if (titled.length > 1) {
      const stillOpen = titled.filter(open);
      return stillOpen.length === 1 ? { kind: "one", app: stillOpen[0] } : { kind: "several", candidates: titled };
    }
    // Saved before its title was known ("Unknown role"): that one, when it's the only one.
    const untitled = atCompany.filter((app) => UNKNOWN_TITLE.test(app.title.trim()) && open(app));
    if (untitled.length === 1) return { kind: "one", app: untitled[0] };
    return { kind: "none", atCompany };
  }
  const stillOpen = atCompany.filter(open);
  if (stillOpen.length === 1) return { kind: "one", app: stillOpen[0] };
  if (stillOpen.length > 1) return { kind: "several", candidates: stillOpen };
  return { kind: "none", atCompany };
}
