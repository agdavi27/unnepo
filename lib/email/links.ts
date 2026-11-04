import { decodeEntities, parseJobUrl } from "@/lib/apply/extract";
import type { InboundEmail } from "@/lib/email/filter";

/**
 * The links in an email that lead to a job posting. These get opened by the server, so anything that could do
 * something when opened is left out: a link to withdraw, unsubscribe, sign in or schedule, one carrying a personal
 * token, and tracking links, which could go anywhere.
 */

const ACTION = /unsubscribe|withdraw|decline|cancel|confirm|verify|login|log-in|signin|sign-in|password|reset|schedule|calendly|preferences|privacy|terms|survey|feedback|accept|reject/i;
const PERSONAL = /[?&](token|auth|key|session|sig|signature|code|otp|email|candidate|user)[a-z_]*=/i;
const TRACKER = /(^|\.)(sendgrid\.net|mandrillapp\.com|mailgun\.org|list-manage\.com|hubspotlinks\.com|hs-sales-engage\.com|mailchimp\.com|awstrack\.me|sparkpostmail\.com|pstmrk\.it|linkedin\.com|indeed\.com|glassdoor\.com|ziprecruiter\.com|joinhandshake\.com)$|^(click|clicks|links?|email|em|t|track|trk|url\d*)\./i;
const OTHER_POSTING_PATH = /\/(jobs?|careers?|positions?|openings?|requisitions?|vacanc(y|ies))\/[^/]*\d[^/]*\/?$/i;

function isPostingLink(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || TRACKER.test(url.hostname) || ACTION.test(url.pathname) || PERSONAL.test(url.search)) return false;
  try {
    const parsed = parseJobUrl(raw);
    if (parsed.ats !== "other") return Boolean(parsed.jobId);
  } catch {
    return false;
  }
  return OTHER_POSTING_PATH.test(url.pathname) || url.searchParams.has("gh_jid");
}

export function jobLinksIn(email: Pick<InboundEmail, "html" | "text">) {
  const found = [
    ...[...(email.html ?? "").matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)].map((match) => decodeEntities(match[1]).trim()),
    ...[...email.text.matchAll(/https:\/\/[^\s<>()"']+/gi)].map((match) => match[0].replace(/[.,;:!?]+$/, "")),
  ];
  return [...new Set(found.filter(isPostingLink))].slice(0, 5);
}
