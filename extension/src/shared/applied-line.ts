/** A job board's "you applied" line and the day it names. No page code: the background reads these too. */

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
export const APPLIED_BARE = /^([✓✔☑]\s*)?(applied|already applied|you(?:'|’)ve applied|application (submitted|sent))!?$/i;

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

