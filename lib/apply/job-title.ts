/**
 * Lines a job's page shows about the student's application or the posting, which are never the job's name:
 * "Applied on November 2, 2026", "Application submitted", "Posted 3 days ago", and an apply pop-up's headings
 * ("Apply to Runway Services", "Details from Runway Services"), and a site's page names ("Jobs", "Job search"). A real title that starts the same way ("Applied
 * Scientist", "Application Engineer") still counts. No server imports, so the extension uses it too.
 */

const MONTH = "(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?";
const WHEN = `( on .+| \\d+ ?(m|min|minutes?|h|hours?|d|days?|w|weeks?|months?) ago| today| yesterday| just now| ${MONTH} \\d{1,2}.*| \\d{1,2}/\\d{1,2}.*)`;
const STATUS = new RegExp(
  `^([✓✔☑]\\s*)?(`
  + `applied${WHEN}?[.!]?`
  + `|you(?:'|’| ha)ve applied.*|you applied.*|already applied.*|application (sent|submitted|received|complete|completed|viewed|in progress)\\b.*`
  + `|your application (was |has been )?(sent|submitted|received).*|(saved|viewed|submitted|withdrawn|archived|not interested)${WHEN}?`
  + `|(posted|updated|reposted|closes|closing|deadline)\\b.*|no longer accepting.*|this job (has )?(expired|closed).*`
  // An apply pop-up's own headings (Handshake): "Apply to The Black Sheep", "Details from The Black Sheep".
  + `|(apply|applying) (to|for|at) .+|(details|questions|documents|attachments|information|info) (from|for) .+`
  + `)$`,
  "i",
);
const DATE_ONLY = new RegExp(`^${MONTH} \\d{1,2}(, \\d{4})?$`, "i");
// A site's own page names, the heading over a job board's search or menu: "Jobs", "Job search", "Saved jobs".
const PAGE_NAME = /^(jobs?|job search|search( jobs| results)?|find (a )?jobs?|browse jobs|all jobs|saved jobs|recommended( jobs)?|jobs for you|job (postings?|board|listings?)|postings?|listings?|careers?|career (center|centre|services)|home|explore|discover|internships?( and jobs)?|opportunities|open (roles|positions)|positions|(my )?applications|messages|inbox|events|employers|companies|dashboard|feed|notifications|profile)$/i;

// A site's menu bar and counters: LinkedIn's "0 notifications", "3 new messages", "My Network", "Messaging".
const SITE_MENU = /^(\d+\+? (new |unread )?(notifications?|messages?|alerts?)|(new |unread )?(notifications?|messages?) \(\d+\)|my network|messaging|me|for business|try premium.*|skip to (main )?content|home|jobs home)$/i;

/** Whether this text is a status or date line rather than a job's name. */
export function notJobTitle(text: string) {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length < 2 || STATUS.test(line) || DATE_ONLY.test(line) || PAGE_NAME.test(line) || SITE_MENU.test(line);
}

// Words around an employer's name on job pages: links ("See more jobs at …", "Follow …"), labels, ratings.
const COMPANY_BEFORE = [
  /^(see|view|browse|explore|find|show|discover|check out)( all| more| other| open)? (jobs|openings|roles|positions|careers|opportunities|internships)( at| from| with| by)\s+/i,
  /^(more|other|all|open|similar)? ?(jobs|openings|roles|positions|careers|opportunities|internships) (at|from|with|by)\s+/i,
  /^(learn more about|more about|about|visit|follow|following|followed|work at|working at|life at|careers at|go to|company:|employer:|posted by|hiring company:?)\s+/i,
  /^(company |employer )?(logo|image|avatar|picture)( of| for)?\s+/i,
  // An apply pop-up's headings: "Details from Runway Services", "Apply to Runway Services".
  /^(details|questions|documents|attachments|information|info) from\s+/i,
  /^(apply|applying) (to|at)\s+/i,
];
const COMPANY_AFTER = [
  /\s*[·|•–—-]\s*(follow|following|view profile|\d[\d.,]*\s*(reviews?|followers?|employees|ratings?|jobs?)).*$/i,
  /\s*\d(\.\d)?\s*(★|☆|stars?|out of 5).*$/i,
  /\s*\(opens in a new (tab|window)\)$/i,
  /['’]s\s+(logo|jobs|careers|profile|page)$/i,
  /\s+(jobs|careers|careers page|job openings|openings|company profile|profile|reviews|logo|page)$/i,
  /\s+(is hiring|hiring now|is now hiring|now hiring)$/i,
  /\s*[→›»>]+$/,
];

/**
 * An employer's name without the words around it on job pages: "See more jobs at Anderson Equipment Company"
 * is "Anderson Equipment Company", "MealPal · Follow" is "MealPal", "Acme 4.2 ★" is "Acme".
 */
export function cleanCompanyName(raw: string) {
  let name = raw.replace(/\s+/g, " ").trim();
  for (let round = 0; round < 4; round += 1) {
    const before = name;
    for (const pattern of [...COMPANY_BEFORE, ...COMPANY_AFTER]) name = name.replace(pattern, "").trim();
    name = name.replace(/^[\s:,.–—-]+|[\s:,–—-]+$/g, "").trim();
    if (name === before) break;
  }
  return name;
}

/** The employer an apply pop-up names in its heading: "Apply to Runway Services" is "Runway Services". */
export function companyFromApplyHeading(text: string) {
  return text.replace(/\s+/g, " ").trim().match(/^(?:apply|applying) (?:to|at) (.{2,80})$/i)?.[1].trim() ?? "";
}
