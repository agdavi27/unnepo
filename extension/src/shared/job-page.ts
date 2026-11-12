/**
 * Whether a page is really a job, before the extension remembers it as one. Detected jobs only come from
 * pages that pass: a known application system, a job board, a posting Unnepo could read, an application form,
 * or an address that says job. News articles, shops and search pages with a title and a site name don't.
 */

// Application systems and job boards, by their address.
const JOB_HOSTS = /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|workday\.com|icims\.com|smartrecruiters\.com|jobvite\.com|taleo\.net|bamboohr\.com|workable\.com|recruitee\.com|jazzhr\.com|applytojob\.com|breezy\.hr|successfactors\.(com|eu)|oraclecloud\.com|paylocity\.com|ultipro\.com|adp\.com|rippling\.com|dover\.com|teamtailor\.com|personio\.(de|com)|pinpointhq\.com|joinhandshake\.com|ziprecruiter\.com|indeed\.com|simplyhired\.com|wellfound\.com|glassdoor\.com|dice\.com|builtin\.com|monster\.com|careerbuilder\.com|wayup\.com|simplify\.jobs|idealist\.org|usajobs\.gov)$/i;
// Paths and subdomains that say job: /careers/123, /jobs/view, /apply, careers.acme.com, jobs.acme.com.
const JOB_PATH = /\/(jobs?|careers?|positions?|openings?|vacanc(y|ies)|requisitions?|opportunit(y|ies)|apply|postings?|job-?details?|roles?)(\/|$|[?#-])/i;
const JOB_SUBDOMAIN = /^(jobs|careers|apply|boards|job-boards|hire|recruiting|talent)\./i;
// Pages that say job but are lists or searches, not one job.
const LIST_PATH = /\/(jobs|careers)\/?(search|results)?\/?$|[?&](q|keywords?|query)=/i;

export type JobPageSigns = { url: string; ats?: string; description?: string; fields?: number };

export function isJobPage(page: JobPageSigns): boolean {
  let url: URL;
  try { url = new URL(page.url); } catch { return false; }
  if (!/^https?:$/.test(url.protocol)) return false;
  if (page.ats && page.ats !== "other") return true;
  // LinkedIn is mostly a feed and searches: only a job it has open (/jobs/view/<id>, or a search's currentJobId).
  if (/(^|\.)linkedin\.com$/i.test(url.hostname)) return /\/jobs\/view\/|[?&]currentJobId=\d/.test(url.pathname + url.search);
  if (JOB_HOSTS.test(url.hostname)) return true;
  // A posting read from the page (schema.org JobPosting, Handshake's pane) is a job wherever it is.
  if ((page.description ?? "").trim().length >= 200) return true;
  // An application form: three or more boxes on a page whose address says job.
  const saysJob = JOB_PATH.test(url.pathname + url.search) || JOB_SUBDOMAIN.test(url.hostname);
  if (saysJob && (page.fields ?? 0) >= 3) return true;
  return saysJob && !LIST_PATH.test(url.pathname + url.search);
}

/**
 * An Apply press that sends the application, not one that opens a form or a filter: "Submit application",
 * "1-Click Apply", "Easy Apply". A bare "Apply" or "Submit" (search filters, newsletter boxes) doesn't count.
 */
export function sendsApplication(label: string): boolean {
  const text = label.replace(/\s+/g, " ").trim();
  return /^(1-click apply|one-click apply|quick apply|easy apply|instant apply|submit( my)? application|send( my)? application|apply with (my )?(profile|resume))$/i.test(text);
}
