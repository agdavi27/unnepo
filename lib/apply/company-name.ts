/**
 * Words a job page shows near the company that aren't a company: badges ("Verified listing", "Promoted"), how the job
 * is posted ("Easy Apply", "Remote", "Full-time"), counts ("200 applicants", "3 days ago") and the page's own buttons.
 * A name like these is read as no company, so the student is asked which company it is. No imports: the extension
 * uses it too.
 */
const NOT_A_COMPANY = new RegExp(
  [
    String.raw`^(verified|unverified)( (listing|job|posting|employer|company|business|account|recruiter))?$`,
    String.raw`^(promoted|sponsored|featured|highlighted|premium|top)( (job|listing|posting|employer|company|pick))?$`,
    String.raw`^(easy apply|quick apply|apply( now| here| on company site)?|1-click apply|one click apply)$`,
    String.raw`^(actively|urgently|now) (hiring|recruiting)$|^hiring( now| fast)?$|^we're hiring$`,
    String.raw`^(new|reposted|just posted|be an early applicant|early applicant|top applicant|in your network)$`,
    String.raw`^(over |about )?\d[\d,+]* (applicants?|clicks?|people clicked apply|employees|followers|reviews?|jobs?)$`,
    String.raw`^(posted |reposted |active )?(\d+|an?|one) (minutes?|hours?|days?|weeks?|months?) ago$|^(posted )?(today|yesterday)$`,
    String.raw`^(remote|hybrid|on-?site|in person|full[- ]time|part[- ]time|internship|intern|contract|temporary|seasonal|entry level)$`,
    String.raw`^(view|save|share|report|hide|show|see) (job|this job|more|less|all|details|company|profile)$|^(save|share|more|menu|close|dismiss)$`,
    String.raw`^(company logo|logo|about (us|the company|the job)|company (name|overview|info)|employer (name|info))$`,
    String.raw`^(confidential|undisclosed|private|hidden|anonymous|unknown|not specified|stealth)( (company|employer|client))?$`,
    String.raw`^(jobs|careers|openings|positions) (at|with|for)\b`,
    // LinkedIn's lines under a job: "No response insights available yet", "Response insights", "Applicants insights".
    String.raw`^(no )?(response|applicant|hiring|job|company) insights?\b|\binsights? (are )?(not )?(available|unavailable)\b|^no response|^responses? (managed|usually)|^(be among|among) the first`,
  ].join("|"),
  "i",
);

/** Whether a page's company name is really one of its badges, buttons or counts ("Verified listing"). */
export function notCompanyName(name: string) {
  const plain = name.replace(/[•·|★✓✔]/g, " ").replace(/\s+/g, " ").trim().replace(/[.!:]+$/, "");
  if (!plain) return true;
  // A price, a rating or a plain number: "$25/hr", "4.2", "4.2 ★".
  if (/^[$€£]|^\d+(\.\d+)?$|\/(hr|hour|yr|year)$/i.test(plain)) return true;
  return NOT_A_COMPANY.test(plain);
}

/** Job sites' own names: a page on Handshake that reads "Handshake" as the company hasn't named the company. */
const JOB_BOARD = /^(handshake|joinhandshake|ziprecruiter|zip recruiter|indeed|glassdoor|linkedin|linked in|wellfound|angellist|dice|simplify|built ?in|monster|simplyhired|careerbuilder|wayup|idealist|usajobs|app|www|jobs?|careers?|unknown|n\/a|company|employer|\?)$/i;

/** Whether a name read off a page is no company at all: a badge, a count, a LinkedIn line or a job site's name. Blank is left for the student to fill. */
export function junkCompanyName(name: string) {
  const plain = name.replace(/[•·|★✓✔]/g, " ").replace(/\s+/g, " ").trim().replace(/[.!:]+$/, "");
  return notCompanyName(plain) || JOB_BOARD.test(plain) || /\bresponse insights\b/i.test(name);
}

/**
 * The company to show for the student to check: the real name from what the page read, with job sites' names and
 * LinkedIn's lines dropped ("Stripe · LinkedIn" → "Stripe"), or blank when nothing left is a company.
 */
export function companyGuess(read: string) {
  const parts = read.split(/\s*[·•|]\s*|\s+[–—-]\s+/).map((part) => part.trim()).filter(Boolean);
  const kept = parts.filter((part) => !junkCompanyName(part));
  return kept.length === 1 ? kept[0]! : "";
}
