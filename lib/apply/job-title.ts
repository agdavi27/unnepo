/**
 * Lines a job's page shows about the student's application or the posting, which are never the job's name:
 * "Applied on November 2, 2026", "Application submitted", "Posted 3 days ago". A real title that starts the same
 * way ("Applied Scientist", "Application Engineer") still counts. No server imports, so the extension uses it too.
 */

const MONTH = "(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?";
const WHEN = `( on .+| \\d+ ?(m|min|minutes?|h|hours?|d|days?|w|weeks?|months?) ago| today| yesterday| just now| ${MONTH} \\d{1,2}.*| \\d{1,2}/\\d{1,2}.*)`;
const STATUS = new RegExp(
  `^([✓✔☑]\\s*)?(`
  + `applied${WHEN}?[.!]?`
  + `|you(?:'|’| ha)ve applied.*|you applied.*|already applied.*|application (sent|submitted|received|complete|completed|viewed|in progress)\\b.*`
  + `|your application (was |has been )?(sent|submitted|received).*|(saved|viewed|submitted|withdrawn|archived|not interested)${WHEN}?`
  + `|(posted|updated|reposted|closes|closing|deadline)\\b.*|no longer accepting.*|this job (has )?(expired|closed).*`
  + `)$`,
  "i",
);
const DATE_ONLY = new RegExp(`^${MONTH} \\d{1,2}(, \\d{4})?$`, "i");

/** Whether this text is a status or date line rather than a job's name. */
export function notJobTitle(text: string) {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length < 2 || STATUS.test(line) || DATE_ONLY.test(line);
}
