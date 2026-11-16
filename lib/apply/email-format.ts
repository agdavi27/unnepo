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
