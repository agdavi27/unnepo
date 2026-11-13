import { notJobTitle } from "@/lib/apply/job-title";
import { APPLIED_BARE, APPLIED_LINE, appliedDay } from "../shared/applied-line";
import { APPLY_LABEL, JOB_HREF, distinctJobLinks, employerOf, jobLink, jobPane } from "./scan";

/**
 * What a job board itself says about the student's application, which is the surest sign there is:
 * the open job's "Applied on November 12, 2026" / "Applied 3 days ago" line, and the board's own list of
 * applications (Handshake's Applications, LinkedIn's Applied jobs, ZipRecruiter's My jobs, Indeed's My jobs).
 * Reads the page only; the extension decides what to save.
 */

export { APPLIED_LINE, appliedDay };

const clean = (text: string | null | undefined) => (text ?? "").replace(/\s+/g, " ").trim();
const shown = (el: Element) => (el as HTMLElement).getBoundingClientRect().height > 0;

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
  if (/(^|\.)joinhandshake\.com$/.test(host)) return /^\/(stu\/)?(applications|apps|job-tracker)\b/.test(path) && !/status=saved/i.test(search);
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
  const table = handshakeTracker();
  if (table.length) return table;
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

/**
 * Handshake's Job Tracker: a table, one row per job, with Company, Role, Date updated and Status cells. Saved
 * jobs weren't applied to and are left out; Applied, Interviewing, Hired and Declined all were.
 */
function handshakeTracker(): ListedApplication[] {
  const out: ListedApplication[] = [];
  for (const row of Array.from(document.querySelectorAll<HTMLTableRowElement>("tr"))) {
    const cell = (name: string) => clean(row.querySelector(`td[headers='${name}']`)?.textContent);
    const link = row.querySelector<HTMLAnchorElement>("a[href*='/jobs/']");
    const company = clean(row.querySelector("td[headers='company'] [title]")?.getAttribute("title")) || cell("company");
    const title = cell("role");
    const status = cell("status");
    if (!link || !title || !company || !status || /^(saved|not interested)$/i.test(status)) continue;
    out.push({ title: title.slice(0, 200), company: company.slice(0, 200), url: jobLink(link.href), day: appliedDay(cell("date")) });
  }
  return out;
}
