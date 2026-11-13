import { notJobTitle } from "@/lib/apply/job-title";
import { APPLY_LABEL, JOB_HREF, distinctJobLinks, employerOf, jobLink, jobPane } from "./scan";

/**
 * What a job board itself says about the student's application, which is the surest sign there is:
 * the open job's "Applied on November 12, 2026" / "Applied 3 days ago" line, and the board's own list of
 * applications (Handshake's Applications, LinkedIn's Applied jobs, ZipRecruiter's My jobs, Indeed's My jobs).
 * Reads the page only; the extension decides what to save.
 */

const clean = (text: string | null | undefined) => (text ?? "").replace(/\s+/g, " ").trim();
const shown = (el: Element) => (el as HTMLElement).getBoundingClientRect().height > 0;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH = "(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?";
const WHEN = `(${MONTH} \\d{1,2}(?:st|nd|rd|th)?(?:,? \\d{4})?|\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?|\\d{4}-\\d{2}-\\d{2}|\\d+ ?(?:s|sec|seconds?|m|mins?|minutes?|h|hrs?|hours?|d|days?|w|wks?|weeks?|mo|months?) ago|today|yesterday|just now)`;
/**
 * A board's line saying the student applied, with when: "Applied on November 12, 2026", "Applied 3 days ago",
 * "✓ Applied · Nov 2", "Application submitted on 11/02/2026", "You applied today". A title like "Applied
 * Scientist" never matches: the line has to end with the time.
 */
export const APPLIED_LINE = new RegExp(`^([✓✔☑]\\s*)?(you )?(applied|application (?:submitted|sent|received)|submitted)[\\s:·•,-]*(on\\s+)?${WHEN}\\.?$`, "i");
/** A bare "Applied" is only believed on a button or a status badge (the Apply button turned into it). */
const APPLIED_BARE = /^([✓✔☑]\s*)?(applied|already applied|you(?:'|’)ve applied|application (submitted|sent))!?$/i;

/** The day (YYYY-MM-DD, local) a "when" part names; "" when it can't tell. */
export function appliedDay(text: string, now = new Date()): string {
  const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const lower = text.toLowerCase();
  if (/\b(today|just now|\d+ ?(s|sec|seconds?|m|mins?|minutes?|h|hrs?|hours?) ago)\b/.test(lower)) return iso(now);
  if (/\byesterday\b/.test(lower)) return iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const ago = lower.match(/\b(\d+) ?(d|days?|w|wks?|weeks?|mo|months?) ago\b/);
  if (ago) {
    const n = Number(ago[1]);
    const days = /^d/.test(ago[2]) ? n : /^w/.test(ago[2]) ? n * 7 : n * 30;
    return iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - days));
  }
  const isoDay = lower.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoDay) return `${isoDay[1]}-${isoDay[2]}-${isoDay[3]}`;
  const named = lower.match(new RegExp(`\\b${MONTH} (\\d{1,2})(?:st|nd|rd|th)?(?:,? (\\d{4}))?`));
  if (named) {
    const month = MONTHS.indexOf(named[1].slice(0, 3));
    let date = new Date(named[3] ? Number(named[3]) : now.getFullYear(), month, Number(named[2]));
    // "Nov 30" with no year, read in early November, was last year.
    if (!named[3] && date.getTime() > now.getTime() + 86_400_000) date = new Date(now.getFullYear() - 1, month, Number(named[2]));
    return iso(date);
  }
  const slash = lower.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (slash) {
    const year = slash[3] ? (slash[3].length === 2 ? 2000 + Number(slash[3]) : Number(slash[3])) : now.getFullYear();
    return iso(new Date(year, Number(slash[1]) - 1, Number(slash[2])));
  }
  return "";
}

/** The board's "you applied" line in `root` (the open job's pane), and the day it names, or null. */
export function appliedStatus(root: ParentNode = jobPane()): { text: string; day: string } | null {
  const candidates = Array.from(root.querySelectorAll<HTMLElement>("span, p, div, li, time, strong, small, button, a, [role=status], [role=button], h2, h3, h4, h5"))
    .filter((el) => !el.closest("[role=dialog], [aria-modal='true'], dialog"));
  for (const el of candidates) {
    const text = clean(el.innerText || el.textContent);
    if (!text || text.length > 70 || !shown(el)) continue;
    if (APPLIED_LINE.test(text)) return { text, day: appliedDay(text) };
    const control = el.matches("button, a, [role=button], [role=status]") || el.getAttribute("aria-disabled") === "true" || (el as HTMLButtonElement).disabled;
    if (control && APPLIED_BARE.test(text)) return { text, day: "" };
  }
  return null;
}

/** The boards' pages that list the student's applications. */
export function isAppliedListPage(where: { hostname: string; pathname: string; search: string } = window.location) {
  const { hostname: host, pathname: path, search } = where;
  if (/(^|\.)joinhandshake\.com$/.test(host)) return /^\/(stu\/)?applications\b/.test(path);
  if (/(^|\.)linkedin\.com$/.test(host)) return (/^\/my-items\/saved-jobs/.test(path) && /cardType=APPLIED/i.test(search)) || (/^\/jobs-tracker/.test(path) && /stage=applied/i.test(search));
  if (/(^|\.)ziprecruiter\.com$/.test(host)) return /^\/(candidate\/)?(my-jobs|applications|applied)/.test(path);
  if (/(^|\.)indeed\.com$/.test(host)) return /^myjobs\./.test(host) || /^\/myjobs/.test(path);
  if (/(^|\.)glassdoor\.com$/.test(host)) return /applied/i.test(path);
  return false;
}

export type ListedApplication = { title: string; company: string; url: string; day: string };

/**
 * Every application on a board's list page: each card's job link, its name, the employer, and the day it
 * says it was applied. Cards are the largest box around a job link that holds no other job.
 */
export function appliedList(): ListedApplication[] {
  const out: ListedApplication[] = [];
  const seen = new Set<string>();
  for (const link of Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
    let path = "";
    try { const url = new URL(link.href); path = `${url.pathname}${url.search}`; } catch { continue; }
    if (!JOB_HREF.test(path) || !shown(link)) continue;
    const url = jobLink(link.href);
    if (seen.has(url)) continue;
    let card: HTMLElement = link;
    while (card.parentElement && card.parentElement !== document.body && distinctJobLinks(card.parentElement) <= 1) card = card.parentElement;
    const lines = (card.innerText || "").split("\n").map(clean).filter(Boolean);
    const ownText = clean(link.innerText || link.textContent || link.getAttribute("aria-label"));
    const usable = (line: string) => line.length >= 3 && line.length <= 150 && !notJobTitle(line) && !APPLY_LABEL.test(line) && !APPLIED_LINE.test(line) && !/^(new|applied|view|view job|see job|withdraw|archive|status|promoted|easy apply)$/i.test(line);
    const title = usable(ownText) ? ownText : lines.find(usable) ?? "";
    if (!title) continue;
    const company = employerOf(card, title) || lines[lines.indexOf(title) + 1] || "";
    if (!company || company === title) continue;
    const line = lines.find((text) => /\bappl(ied|ication)\b/i.test(text) && appliedDay(text)) ?? "";
    seen.add(url);
    out.push({ title: title.slice(0, 200), company: company.slice(0, 200), url, day: line ? appliedDay(line) : "" });
    if (out.length >= 100) break;
  }
  return out;
}
