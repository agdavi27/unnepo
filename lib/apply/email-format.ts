/**
 * Email formats with no server parts, so the extension can build addresses too: a format like "{first}.{last}",
 * a person's name in plain letters, and the address the two make at a company's domain.
 */

/** Formats in the order companies use them most. Hunter writes them the same way. */
export const COMMON_FORMATS = ["{first}.{last}", "{f}{last}", "{first}", "{first}{last}", "{first}_{last}", "{first}{l}", "{f}.{last}", "{last}", "{last}.{first}", "{last}{f}"];

const SUFFIXES = /^(jr|sr|ii|iii|iv|phd|md|mba|cpa)$/i;

/** "José De la Cruz-Ortiz, Jr." is { first: "jose", last: "ortiz" }: plain letters, the last real word. */
export function nameParts(name: string) {
  const words = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[\s,]+/).map((word) => word.replace(/[^a-z-]/g, "")).filter((word) => word && !SUFFIXES.test(word));
  const first = (words[0] ?? "").replace(/-/g, "");
  const lastWord = words.length > 1 ? words[words.length - 1] : "";
  const last = lastWord.split("-").pop() ?? "";
  return { first, last };
}

/** An address from a format: "{f}{last}" for Jane Doe at acme.com is jdoe@acme.com. */
export function buildEmail(pattern: string, name: string, domain: string) {
  const { first, last } = nameParts(name);
  if (!first || (/\{(last|l)\}/.test(pattern) && !last)) return null;
  const local = pattern.replace("{first}", first).replace("{last}", last).replace("{f}", first[0]).replace("{l}", last[0] ?? "");
  return /^[a-z0-9._-]+$/.test(local) ? `${local}@${domain.toLowerCase()}` : null;
}

/** The format a known address follows for that person's name, if it's one Unnepo knows. */
export function patternOf(email: string, name: string) {
  const [local, domain] = email.toLowerCase().split("@");
  if (!local || !domain) return null;
  return COMMON_FORMATS.find((pattern) => buildEmail(pattern, name, domain) === `${local}@${domain}`) ?? null;
}

/**
 * Addresses at this company's domain in any text or HTML (a page, search results), including "jane [at] acme.com"
 * and "jane.doe<b>@acme.com</b>" as search engines bold it. Lowercase, each once.
 */
export function emailsInText(text: string, domain: string) {
  const plain = text
    // A mailto link's address is kept before the tags go.
    .replace(/<a\b[^>]*href=["']?mailto:([^"'?>\s]+)[^>]*>/gi, " $1 ")
    .replace(/<\/?(b|strong|em|i|span|mark|wbr)\b[^>]*>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#64;|&commat;|%40|\s*\[at\]\s*|\s*\(at\)\s*/gi, "@")
    .replace(/&#46;|\s*\[dot\]\s*/gi, ".");
  const wanted = domain.toLowerCase();
  const found = (plain.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? [])
    .map((email) => email.toLowerCase().replace(/^mailto:/, "").replace(/^[._%+-]+/, ""))
    .filter((email) => email.split("@")[1] === wanted);
  return [...new Set(found)];
}

/** The likeliest addresses for someone when the company's format isn't known, most likely first. */
export function likelyEmails(name: string, domain: string, count = 3) {
  return COMMON_FORMATS.slice(0, count).map((pattern) => buildEmail(pattern, name, domain)).filter((email): email is string => Boolean(email));
}
