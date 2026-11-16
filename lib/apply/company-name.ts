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
