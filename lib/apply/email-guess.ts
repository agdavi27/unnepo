import { id, nowIso, repo } from "@/lib/db/file-store";
import { safeGet } from "@/lib/apply/safe-fetch";
import { contactFetch } from "@/lib/providers/contacts/http";
import { assertSpendAllowed, isPersonalWorkEmail } from "@/lib/providers/contacts/router";

/**
 * Work emails Apollo doesn't have: Unnepo learns the company's email format (from an email it already
 * knows there, the company's own website, or Hunter), builds the person's address from it, and checks it
 * with Hunter's verifier. Only a "valid" check counts as verified. A company whose mail server accepts
 * every address can't be checked, so its guess is shown as likely, not verified.
 */

export const HUNTER_CENTS = 3;

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

/** A format from addresses alone, when no names go with them: "jane.doe" looks like {first}.{last}. */
export function patternFromLocals(locals: string[]) {
  const votes = new Map<string, number>();
  for (const local of locals) {
    const pattern = /^[a-z]{2,}\.[a-z]{2,}$/.test(local) ? "{first}.{last}" : /^[a-z]\.[a-z]{2,}$/.test(local) ? "{f}.{last}" : /^[a-z]{2,}_[a-z]{2,}$/.test(local) ? "{first}_{last}" : null;
    if (pattern) votes.set(pattern, (votes.get(pattern) ?? 0) + 1);
  }
  const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= 2 ? best[0] : null;
}

/** Personal addresses at this company's domain in a page's HTML, including "jane [at] acme.com". */
export function emailsOnPage(html: string, domain: string) {
  const text = html.replace(/&#64;|&commat;|%40|\s*\[at\]\s*|\s*\(at\)\s*/gi, "@").replace(/&#46;|\s*\[dot\]\s*/gi, ".");
  const wanted = domain.toLowerCase();
  const found = (text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? [])
    .map((email) => email.toLowerCase().replace(/^mailto:/, ""))
    .filter((email) => email.split("@")[1] === wanted && isPersonalWorkEmail(email));
  return [...new Set(found)];
}

/** Whether robots.txt lets any crawler read this path (the "User-agent: *" rules, longest match wins). */
export function robotsAllows(robots: string, path: string) {
  let applies = false;
  let grouping = false;
  const rules: Array<{ allow: boolean; prefix: string }> = [];
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const [key, ...rest] = line.split(":");
    const value = rest.join(":").trim();
    if (!key) continue;
    const field = key.trim().toLowerCase();
    if (field === "user-agent") {
      if (!grouping) applies = false;
      grouping = true;
      if (value === "*") applies = true;
      continue;
    }
    grouping = false;
    if (applies && (field === "allow" || field === "disallow") && value) rules.push({ allow: field === "allow", prefix: value.replace(/\*$/, "") });
  }
  const match = rules.filter((rule) => path.startsWith(rule.prefix)).sort((a, b) => b.prefix.length - a.prefix.length)[0];
  return match ? match.allow : true;
}

const SITE_PAGES = ["/", "/about", "/about-us", "/team", "/our-team", "/people", "/leadership", "/contact", "/contact-us"];
const MAX_SITE_PAGES = 5;

/** Personal addresses on the company's own home, about, team and contact pages, as robots.txt allows. */
export async function siteEmails(domain: string) {
  let robots = "";
  try {
    const page = await safeGet(`https://${domain}/robots.txt`, "text/plain", 200_000);
    if (page.ok) robots = page.text;
  } catch {
    robots = "";
  }
  const emails = new Set<string>();
  let read = 0;
  for (const path of SITE_PAGES) {
    if (read >= MAX_SITE_PAGES) break;
    if (!robotsAllows(robots, path)) continue;
    read += 1;
    try {
      const page = await safeGet(`https://${domain}${path}`, "text/html");
      if (page.ok) for (const email of emailsOnPage(page.text, domain)) emails.add(email);
    } catch {
      // A missing page is normal.
    }
  }
  return [...emails];
}

function hunterKey() {
  return process.env.HUNTER_API_KEY?.trim() || "";
}

export const hunterReady = () => Boolean(hunterKey());

async function recordHunter(userId: string, operation: string, success: boolean, started: number, error?: string) {
  await repo.insertUsage({ id: id(), userId, provider: "hunter", operation, success, latencyMs: Date.now() - started, costCents: success ? HUNTER_CENTS : 0, estimated: true, error: error ?? null, createdAt: nowIso() });
}

export type CheckStatus = "valid" | "invalid" | "accept_all" | "unknown";

/** Hunter's verifier for one address. Null when Hunter isn't set up or the check failed. */
export async function hunterCheck(userId: string, email: string): Promise<CheckStatus | null> {
  const key = hunterKey();
  if (!key) return null;
  await assertSpendAllowed(userId, HUNTER_CENTS);
  const started = Date.now();
  try {
    const response = await contactFetch(`https://api.hunter.io/v2/email-verifier?${new URLSearchParams({ email, api_key: key })}`, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`hunter_${response.status}`);
    const body = (await response.json()) as { data?: { status?: string } };
    await recordHunter(userId, "email_verifier", true, started);
    const status = body.data?.status;
    return status === "valid" || status === "invalid" || status === "accept_all" ? status : "unknown";
  } catch (error) {
    await recordHunter(userId, "email_verifier", false, started, error instanceof Error ? error.message : "hunter_failed");
    return null;
  }
}

type HunterDomain = { pattern: string | null; acceptAll: boolean; emails: Array<{ email: string; name: string }> };

/** Hunter's domain search: the company's format, whether it accepts every address, and people it knows there. */
async function hunterDomain(userId: string, domain: string): Promise<HunterDomain | null> {
  const key = hunterKey();
  if (!key) return null;
  await assertSpendAllowed(userId, HUNTER_CENTS);
  const started = Date.now();
  try {
    const response = await contactFetch(`https://api.hunter.io/v2/domain-search?${new URLSearchParams({ domain, limit: "10", api_key: key })}`, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`hunter_${response.status}`);
    const body = (await response.json()) as { data?: { pattern?: string | null; accept_all?: boolean; emails?: Array<{ value?: string; first_name?: string | null; last_name?: string | null }> } };
    await recordHunter(userId, "domain_search", true, started);
    // Hunter writes formats the way Unnepo does: "{first}.{last}".
    const pattern = body.data?.pattern?.trim().toLowerCase() ?? null;
    return {
      pattern: pattern && COMMON_FORMATS.includes(pattern) ? pattern : null,
      acceptAll: Boolean(body.data?.accept_all),
      emails: (body.data?.emails ?? []).filter((item) => item.value).map((item) => ({ email: String(item.value).toLowerCase(), name: `${item.first_name ?? ""} ${item.last_name ?? ""}`.trim() })),
    };
  } catch (error) {
    await recordHunter(userId, "domain_search", false, started, error instanceof Error ? error.message : "hunter_failed");
    return null;
  }
}

export type EmailFormat = { pattern: string | null; acceptAll: boolean; source: string; known: Array<{ email: string; name: string }> };

/**
 * The company's email format, cheapest source first: a format learned before, an address Unnepo already
 * knows there with its owner's name, the company's own website, then Hunter. Saved for every student.
 */
export async function learnFormat(userId: string, domain: string, known: Array<{ email: string; name: string }>, people: string[]): Promise<EmailFormat> {
  const atDomain = known.filter((item) => item.email.toLowerCase().endsWith(`@${domain.toLowerCase()}`));
  const saved = await repo.getEmailFormat(domain);
  if (saved?.pattern || saved?.acceptAll) return { pattern: saved.pattern, acceptAll: saved.acceptAll, source: saved.source, known: atDomain };
  const keep = async (format: EmailFormat) => {
    if (format.pattern || format.acceptAll) await repo.setEmailFormat(domain, { pattern: format.pattern, acceptAll: format.acceptAll, source: format.source }).catch(() => undefined);
    return format;
  };
  for (const item of atDomain) {
    const pattern = patternOf(item.email, item.name);
    if (pattern) return keep({ pattern, acceptAll: false, source: "apollo", known: atDomain });
  }
  const site = await siteEmails(domain).catch(() => [] as string[]);
  const named = site.flatMap((email) => people.map((name) => ({ email, name, pattern: patternOf(email, name) }))).filter((item) => item.pattern);
  const fromSite = named[0]?.pattern ?? patternFromLocals(site.map((email) => email.split("@")[0]));
  const siteKnown = [...atDomain, ...named.map(({ email, name }) => ({ email, name }))];
  if (fromSite) return keep({ pattern: fromSite, acceptAll: false, source: "website", known: siteKnown });
  const hunter = await hunterDomain(userId, domain);
  if (hunter) return keep({ pattern: hunter.pattern, acceptAll: hunter.acceptAll, source: "hunter", known: [...siteKnown, ...hunter.emails] });
  return { pattern: null, acceptAll: false, source: "none", known: siteKnown };
}

export type Guess = { email: string; verified: boolean; source: "pattern" | "website" | "likely" };

/**
 * One person's address: one that's already known for them, else built from the format (or the most
 * common formats when the format is unknown), each checked with Hunter until one is valid. `budget`
 * counts the checks left for this search. A guess Hunter can't check comes back as likely.
 */
export async function guessEmail(userId: string, name: string, domain: string, format: EmailFormat, extra: string[], budget: { checks: number }): Promise<Guess | null> {
  const mine = format.known.filter((item) => item.name && nameParts(item.name).first === nameParts(name).first && nameParts(item.name).last === nameParts(name).last).map((item) => item.email);
  const built = (format.pattern ? [format.pattern] : COMMON_FORMATS.slice(0, 3)).map((pattern) => buildEmail(pattern, name, domain)).filter((email): email is string => Boolean(email));
  const candidates = [...new Set([...mine, ...extra.filter((email) => email.toLowerCase().endsWith(`@${domain.toLowerCase()}`)), ...built].map((email) => email.toLowerCase()))].filter(isPersonalWorkEmail);
  if (!candidates.length) return null;
  const fromSite = new Set(mine);
  // Nothing can be checked: an address counts as likely only when it was found for them, follows the
  // company's format, or is Apollo's guess and fits their name.
  const plausible = [...mine, ...(format.pattern ? built : []), ...extra.filter((email) => patternOf(email, name))].map((email) => email.toLowerCase()).filter(isPersonalWorkEmail);
  const likely = plausible.length ? { email: plausible[0], verified: false, source: "likely" as const } : null;
  if (format.acceptAll || !hunterReady()) return likely;
  let unchecked: Guess | null = null;
  for (const email of candidates) {
    if (budget.checks <= 0) break;
    budget.checks -= 1;
    const status = await hunterCheck(userId, email);
    if (status === "valid") {
      if (!format.pattern) {
        const pattern = patternOf(email, name);
        if (pattern) await repo.setEmailFormat(domain, { pattern, acceptAll: false, source: "verified" }).catch(() => undefined);
      }
      return { email, verified: true, source: fromSite.has(email) ? "website" : "pattern" };
    }
    if (status === "accept_all") {
      await repo.setEmailFormat(domain, { pattern: format.pattern, acceptAll: true, source: format.source }).catch(() => undefined);
      return likely ?? { email, verified: false, source: "likely" };
    }
    if (status === "unknown" && !unchecked && (format.pattern || fromSite.has(email))) unchecked = { email, verified: false, source: "likely" };
  }
  return unchecked;
}
