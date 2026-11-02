import { serverConfig } from "@/lib/config";
import { id, nowIso, readAnthropicKey, repo } from "@/lib/db/file-store";
import type { Contact } from "@/lib/db/types";
import { contactFetch } from "@/lib/providers/contacts/http";
import { ServiceError } from "@/lib/errors";
import { safeGet } from "@/lib/apply/safe-fetch";
import { HUNTER_CENTS, buildEmail, hunterCheck, hunterDomain, hunterReady, learnFormat, nameParts, patternOf, type EmailFormat } from "@/lib/apply/email-guess";
import { assertSpendAllowed, enrichPeopleBatch, isPersonalWorkEmail, looksLikePerson, searchCompanies, searchPeopleQuery } from "@/lib/providers/contacts/router";
import { COMPANY_DOMAINS, RECRUITER_TITLES, type ApolloPeopleQuery } from "@/lib/providers/contacts/apollo";
import type { ApplicationContact, ContactRole, JobApplication, PeopleSearch } from "@/lib/apply/types";

/**
 * After a student applies, finds the one best real person to email about the role: someone from their
 * school at the company, else a recruiter, else someone in the job's department. Every person comes from
 * Apollo or the posting itself. Nobody is invented.
 */

/** Company websites tried, best match first, until one turns up people. */
const MAX_DOMAINS = 3;


export { hunterReady };

export type FoundPerson = Omit<ApplicationContact, "id" | "applicationId" | "userId" | "createdAt" | "updatedAt" | "outreachStatus" | "emailSubject" | "emailBody">;

const SENIORITY_WORDS = /\b(senior|sr\.?|junior|jr\.?|lead|principal|staff|associate|intern(ship)?|entry[- ]level|i{1,3}|iv|[0-9])\b/gi;

/** "Account Executive - Commercial, Spotify Technology" → "Account Executive" */
export function coreTitle(title: string) {
  return title.split(/\s[-–|,(]\s?|,|\(/)[0].replace(SENIORITY_WORDS, " ").replace(/\s+/g, " ").trim();
}

function mainDepartment(department: string | null) {
  return (department ?? "").split(/,|&|\band\b|\//)[0].trim();
}

async function recordHunter(userId: string, operation: string, success: boolean, started: number, error?: string) {
  await repo.insertUsage({ id: id(), userId, provider: "hunter", operation, success, latencyMs: Date.now() - started, costCents: success ? HUNTER_CENTS : 0, estimated: true, error: error ?? null, createdAt: nowIso() });
}

/** Hunter's email finder. Keeps the email only when Hunter verified it as deliverable. */
export async function hunterFindEmail(userId: string, firstName: string, lastName: string, domain: string) {
  const key = process.env.HUNTER_API_KEY?.trim() || "";
  if (!key || !firstName || !lastName || !domain) return null;
  await assertSpendAllowed(userId, HUNTER_CENTS);
  const started = Date.now();
  try {
    const url = `https://api.hunter.io/v2/email-finder?${new URLSearchParams({ domain, first_name: firstName, last_name: lastName, api_key: key })}`;
    const response = await contactFetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`hunter_${response.status}`);
    const body = (await response.json()) as { data?: { email?: string | null; verification?: { status?: string | null } } };
    const email = body.data?.email ?? null;
    const valid = Boolean(email) && body.data?.verification?.status === "valid" && isPersonalWorkEmail(email!);
    await recordHunter(userId, "email_finder", true, started);
    return valid ? email : null;
  } catch (error) {
    await recordHunter(userId, "email_finder", false, started, error instanceof Error ? error.message : "hunter_failed");
    return null;
  }
}

/** Hunter's verifier, for an email printed on the posting. */
export async function hunterVerify(userId: string, email: string) {
  return (await hunterCheck(userId, email)) === "valid";
}

// Job boards: a posting on these says nothing about the company's own website.
const JOB_BOARDS = /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|myworkday(jobs|site)?\.com|workday\.com|icims\.com|smartrecruiters\.com|joinhandshake\.com|jobvite\.com|taleo\.net|successfactors\.(com|eu)|paycomonline\.net|workable\.com|bamboohr\.com|recruitee\.com|applytojob\.com|ultipro\.com|ukg\.com|adp\.com|linkedin\.com|indeed\.com|breezy\.hr|teamtailor\.com|rippling\.com|wellfound\.com|ziprecruiter\.com|glassdoor\.com|builtin\.com|handshake\.com)$/i;

/** The company's own website from a posting on it ("careers.globex.com" is "globex.com"); null for job boards. */
export function siteDomain(url: string | null) {
  let host = "";
  try {
    host = new URL(url ?? "").hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!host.includes(".") || JOB_BOARDS.test(host)) return null;
  const labels = host.split(".");
  // "acme.co.uk" keeps three parts.
  const keep = labels.length > 2 && labels.at(-1)!.length === 2 && labels.at(-2)!.length <= 3 ? 3 : 2;
  return labels.slice(-keep).join(".");
}

/** "Modjeski & Masters" and "Modjeski and Masters" read the same. */
const plain = (text: string) => text.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");

/** The same name with "&" and "and" swapped, since Apollo searches the name as written. */
export function swapAnd(name: string) {
  if (/\s&\s/.test(name)) return name.replace(/\s&\s/g, " and ");
  if (/\sand\s/i.test(name)) return name.replace(/\sand\s/gi, " & ");
  return null;
}

const NAME_FILLER = new Set(["and", "the", "of", "inc", "llc", "ltd", "co", "corp", "company", "group", "holdings"]);

/** The name's real words: "Modjeski and Masters, Inc." is ["modjeski", "masters"]. */
const nameWords = (name: string) => name.toLowerCase().replace(/&/g, " ").split(/[^a-z0-9]+/).filter((word) => word && !NAME_FILLER.has(word));

/** A website plausibly the company's: its name holds the company's first word, or all their initials. */
export function domainFits(domain: string, name: string) {
  const label = plain(domain.split(".")[0]);
  const words = nameWords(name);
  if (!words.length || !label) return false;
  return label.includes(words[0]) || (words.length > 1 && label === words.map((word) => word[0]).join(""));
}

const SOCIAL = /(^|\.)(facebook|twitter|x|instagram|youtube|tiktok|eeoc|dol|e-verify|google|bit|apple|microsoft)\.(com|gov|ly)$/i;

/** Company websites the posting itself links to ("Learn more at modjeski.com"), when they fit the name. */
export function postingDomains(description: string, name: string) {
  const links = description.match(/\b(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|io|co|us|ai|edu)\b/gi) ?? [];
  const domains = links.map((link) => siteDomain(/^https?:/i.test(link) ? link : `https://${link}`)).filter((domain): domain is string => Boolean(domain) && !SOCIAL.test(domain!));
  return [...new Set(domains)].filter((domain) => domainFits(domain, name));
}

/** Likely websites from the name alone: "Modjeski and Masters" tries modjeskiandmasters.com, modjeskimasters.com, modjeski.com. */
export function guessedDomains(name: string) {
  const words = nameWords(name);
  if (!words.length) return [];
  const joined = name.toLowerCase().replace(/&/g, "and").replace(/[,.]?\s*\b(inc|llc|ltd|corp(oration)?|co|company|plc|group|holdings?)\b\.?/gi, "").replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, "");
  const guesses = [joined, words.join(""), words[0].length >= 4 ? words[0] : ""].filter(Boolean).map((label) => `${label}.com`);
  return [...new Set(guesses)].slice(0, 3);
}

/** A website counts when its home page loads and mentions the company's first word. */
async function siteMentions(domain: string, name: string) {
  const word = nameWords(name)[0];
  if (!word) return false;
  try {
    const page = await safeGet(`https://${domain}`, "text/html");
    return page.ok && page.text.slice(0, 200_000).toLowerCase().includes(word);
  } catch {
    return false;
  }
}

/** Last try: Haiku names the company's website, and it counts only once the site checks out. */
async function aiDomain(userId: string, app: JobApplication) {
  const apiKey = await readAnthropicKey();
  if (!apiKey) return null;
  const config = serverConfig();
  const model = process.env.ANTHROPIC_FAST_MODEL || "claude-haiku-4-5";
  const started = Date.now();
  try {
    await assertSpendAllowed(userId, 1);
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const response = await new Anthropic({ apiKey }).messages.create({
      model,
      max_tokens: 30,
      messages: [{ role: "user", content: `What is the official website domain of the company "${app.company}"${app.location ? `, which is hiring in ${app.location}` : ""}? The job is "${app.title}". Reply with only the domain, like example.com, or "unknown".` }],
    });
    const text = response.content.map((block) => (block.type === "text" ? block.text : "")).join("").trim().toLowerCase();
    const costCents = ((response.usage?.input_tokens ?? 0) * config.fastInputCentsPerMillion + (response.usage?.output_tokens ?? 0) * config.fastOutputCentsPerMillion) / 1_000_000;
    await repo.insertUsage({ id: id(), userId, provider: "anthropic", operation: "company_website", success: true, latencyMs: Date.now() - started, costCents, estimated: true, error: null, createdAt: nowIso() });
    const domain = text.match(/[a-z0-9-]+(\.[a-z0-9-]+)+/)?.[0]?.replace(/^www\./, "") ?? null;
    return domain && siteDomain(`https://${domain}`) ? siteDomain(`https://${domain}`) : null;
  } catch (error) {
    await repo.insertUsage({ id: id(), userId, provider: "anthropic", operation: "company_website", success: false, latencyMs: Date.now() - started, costCents: 0, estimated: true, error: error instanceof Error ? error.message : "anthropic_failed", createdAt: nowIso() });
    return null;
  }
}

/** Names to look the company up by: as written, without "Inc." and the like, and the job board's name for it. */
export function companyNames(app: Pick<JobApplication, "company" | "jobUrl">) {
  const written = app.company.replace(/\s+/g, " ").trim();
  const bare = written.replace(/[,.]?\s*\b(inc|llc|ltd|corp(oration)?|co|company|plc|gmbh|l\.?p|holdings?|group)\b\.?/gi, "").replace(/^the\s+/i, "").replace(/\s+/g, " ").trim();
  let fromBoard = "";
  try {
    const url = new URL(app.jobUrl);
    // "acme.wd5.myworkdayjobs.com", "boards.greenhouse.io/acme", "jobs.lever.co/acme".
    fromBoard = url.hostname.match(/^([a-z0-9-]+)\.wd\d+\.myworkday(jobs|site)\.com$/i)?.[1]
      ?? (/(greenhouse\.io|lever\.co|ashbyhq\.com)$/i.test(url.hostname) ? url.pathname.split("/").filter(Boolean)[0] ?? "" : "");
  } catch {
    fromBoard = "";
  }
  const names = [written, bare, fromBoard.replace(/[-_]+/g, " ")].filter((name) => name.length >= 2);
  return names.filter((name, index) => names.findIndex((other) => plain(other) === plain(name)) === index);
}

/**
 * The company's possible websites, most likely first: one that found people before, the posting's own
 * site, Unnepo's list of known companies, then Apollo's matches whose name fits. A guess that found nobody
 * is never kept, so a wrong match can't stick.
 */
async function companyDomains(userId: string, app: JobApplication) {
  const found: string[] = [];
  const add = (domain: string | null | undefined) => {
    const clean = (domain ?? "").trim().toLowerCase().replace(/^www\./, "");
    if (clean && !found.includes(clean)) found.push(clean);
  };
  add(app.companyDomain);
  add(siteDomain(app.applicationUrl) ?? siteDomain(app.jobUrl));
  const names = companyNames(app);
  const cached = await repo.getCompanyDomains(names);
  for (const name of names) for (const domain of [...(COMPANY_DOMAINS[name.toLowerCase()] ?? []), ...(cached[name.toLowerCase()] ?? [])]) add(domain);
  // Websites the posting links to that fit the name ("Learn more at modjeski.com").
  postingDomains(app.description ?? "", app.company).forEach(add);
  if (found.length >= MAX_DOMAINS) return found.slice(0, MAX_DOMAINS);
  const fits: string[] = [];
  const others: string[] = [];
  const searchNames = [...new Set(names.slice(0, 2).flatMap((name) => [name, swapAnd(name)].filter((item): item is string => Boolean(item))))];
  for (const name of searchNames) {
    for (const org of await searchCompanies(userId, name)) {
      const same = plain(org.name) === plain(name) || plain(org.domain.split(".")[0]) === plain(name);
      const close = plain(org.name).startsWith(plain(name)) || plain(name).startsWith(plain(org.name));
      (same || close ? fits : others).push(org.domain);
    }
    if (fits.length) break;
  }
  fits.forEach(add);
  // Apollo's top result counts only when nothing fit by name, and only if its website fits the name
  // ("thebreadwinners.club" is never Fillout's).
  if (!fits.length && others[0] && domainFits(others[0], app.company)) add(others[0]);
  // Apollo didn't know the company: guess its website from the name, then ask Haiku, keeping only sites that check out.
  if (!found.length) {
    for (const guess of guessedDomains(app.company)) {
      if (await siteMentions(guess, app.company)) {
        add(guess);
        break;
      }
    }
  }
  if (!found.length) {
    const named = await aiDomain(userId, app);
    if (named && (await siteMentions(named, app.company))) add(named);
  }
  return found.slice(0, MAX_DOMAINS);
}

const DEPARTMENTS: Array<[RegExp, string]> = [
  [/software|engineer|developer|devops|\bsre\b|firmware|hardware/i, "Engineering"],
  [/data|analytics|analyst|scien|machine learning|\bml\b|\bai\b/i, "Data"],
  [/product manag|product owner/i, "Product"],
  [/design|\bux\b|\bui\b/i, "Design"],
  [/market|brand|growth|content|social media|communications/i, "Marketing"],
  [/sales|account exec|business develop|\bsdr\b|\bbdr\b|partnership/i, "Sales"],
  [/financ|accounting|accountant|investment|banking|fp&a|audit|tax/i, "Finance"],
  [/consult|strategy/i, "Consulting"],
  [/operation|supply chain|logistic|procurement/i, "Operations"],
  [/people|human resources|\bhr\b|talent/i, "People"],
  [/legal|counsel|paralegal|compliance/i, "Legal"],
  [/research/i, "Research"],
];

/** The job's department: what the posting says, or else what the title suggests ("Data Analyst Intern" is Data). */
export function departmentOf(app: Pick<JobApplication, "department" | "title">) {
  return mainDepartment(app.department) || DEPARTMENTS.find(([pattern]) => pattern.test(app.title))?.[1] || "";
}

function found(contact: Contact, role: ContactRole, relevance: string): FoundPerson {
  return { rank: 1, role, name: contact.fullName, title: contact.title, email: null, emailSource: null, relevance, linkedinUrl: contact.profileUrl, photoUrl: contact.photoUrl ?? null };
}

/** How many people the list shows for a job. */
export const LIST_SIZE = 5;

/** Campus and university recruiters before the rest: they hire students. */
const CAMPUS = /\b(campus|university|college|early (career|talent)|emerging talent|intern)/i;
const TOO_SENIOR = /\b(chief|ceo|cfo|coo|cto|president|founder|owner|board|vp|vice president|svp|evp|partner)\b/i;

/** A full name Unnepo can build an address from (Apollo hides last names until it enriches them: "Jane D."). */
const fullName = (name: string) => /^\S{2,}( \S+)* [^\s*.]{2,}$/.test(name.trim()) && !name.includes("*");

/** Who's most worth emailing first: the student's school, then recruiters (campus first), then the team; executives last. */
export function relevance(person: Pick<FoundPerson, "role" | "title">) {
  const base = person.role === "job_poster" ? 100 : person.role === "alumni" ? 80 : person.role === "recruiter" ? 60 + (CAMPUS.test(person.title) ? 10 : 0) : 40;
  return base - (TOO_SENIOR.test(person.title) ? 30 : 0);
}

export type ListedPerson = FoundPerson & { links: Array<{ label: string; url: string }> };

/** Progress the page shows in the spider's bubbles while the search runs. */
type Progress = (text: string) => Promise<void> | void;

/**
 * Lists up to LIST_SIZE people who work at the company, most relevant first: the person the posting names,
 * people from the student's school, recruiters, then people on the job's team. Each gets an email built from
 * the company's email format (or the one Apollo or Hunter already has for them) and their social links.
 * Emails aren't checked yet: each says where it came from. Every person comes from the posting, Apollo or
 * Hunter. Nobody is invented. Each search is recorded, so "no one found" says why.
 */
export async function findPeopleForApplication(userId: string, app: JobApplication, options: { school?: string; progress?: Progress } = {}): Promise<{ people: ListedPerson[]; domain: string | null; notes: string[]; search: PeopleSearch }> {
  const school = (options.school ?? "").trim();
  const say = async (text: string) => { await options.progress?.(text); };
  await say(`Searching for ${app.company}'s website…`);
  const domains = await companyDomains(userId, app);
  const search: PeopleSearch = { at: nowIso(), company: app.company, domains, domain: null, school, steps: [], chosen: null };
  const team = departmentOf(app);
  const core = coreTitle(app.title);
  let failures: unknown = null;

  /** One Apollo search (free); a failure is recorded and the next one runs anyway. */
  const look = async (step: string, domain: string, query: ApolloPeopleQuery) => {
    try {
      const { people } = await searchPeopleQuery(userId, { ...query, q_organization_domains_list: [domain] }, 1, 10, { verifiedOnly: false });
      const kept = people.filter((person) => looksLikePerson(person.firstName, person.lastName, person.company || app.company));
      search.steps.push({ step, domain, found: kept.length });
      return kept;
    } catch (error) {
      failures ??= error;
      search.steps.push({ step, domain, found: 0, error: error instanceof Error ? error.message.replace(/\s*No credits were used\.?/i, "").slice(0, 200) : "failed" });
      return [];
    }
  };

  let pool: Array<{ person: FoundPerson; source: Contact }> = [];
  let winner: string | null = null;
  for (const domain of domains) {
    await say(`Searching for relevant people at ${app.company}…`);
    const titles = [...new Set([team, core].filter(Boolean))];
    const groups: Array<[ContactRole, Contact[], (person: Contact) => string]> = [
      ["alumni", school ? await look(`From ${school}`, domain, { q_keywords: school }) : [], (person) => `From ${school}${person.title ? `, now ${person.title}` : ""}.`],
      ["recruiter", await look("Recruiters", domain, { person_titles: RECRUITER_TITLES }), (person) => recruiterWhy(app, person)],
      ["team_member", titles.length ? await look(team ? `${team} department` : `${core} roles`, domain, { person_titles: titles }) : [], (person) => `${person.title || "Works"} in ${team || "the same kind of role"}, the team this job is in.`],
    ];
    const seen = new Set<string>();
    pool = groups.flatMap(([role, people, why]) => people.map((source) => ({ person: found(source, role, why(source)), source })))
      .filter(({ source }) => (seen.has(source.id) ? false : (seen.add(source.id), true)));
    if (pool.length) {
      winner = domain;
      break;
    }
  }
  if (!pool.length && domains.length && search.steps.length && search.steps.every((step) => step.error)) {
    throw failures instanceof ServiceError ? failures : new ServiceError("Couldn't look up people right now.", "provider_failed", 502);
  }

  await say("Ranking people by how relevant they are to you…");
  const top = pool.sort((a, b) => relevance(b.person) - relevance(a.person)).slice(0, LIST_SIZE - (app.postedRecruiter ? 1 : 0));
  const domain = winner ?? domains[0] ?? null;

  // Full names, LinkedIn and other links for the people shown (Apollo reveals them per person).
  await say("Getting their names and profiles…");
  const reveal: { error?: string } = {};
  const enriched = top.length ? await enrichPeopleBatch(top.map((item) => item.source), userId, reveal) : new Map();
  const listed: Array<ListedPerson & { guess: string | null }> = top.map(({ person, source }) => {
    const result = enriched.get(source.id);
    const patch = result?.patch ?? {};
    const links = [["LinkedIn", patch.profileUrl ?? source.profileUrl], ["X", patch.twitterUrl ?? source.twitterUrl], ["GitHub", patch.githubUrl ?? source.githubUrl], ["Facebook", patch.facebookUrl ?? source.facebookUrl]]
      .filter((pair): pair is [string, string] => typeof pair[1] === "string" && /^https?:\/\//.test(pair[1]))
      .map(([label, url]) => ({ label, url }));
    const verified = result?.emailStatus === "verified" && result.email ? result.email : null;
    return {
      ...person,
      name: patch.lastName ? `${source.firstName} ${patch.lastName}`.trim() : person.name,
      photoUrl: patch.photoUrl ?? person.photoUrl,
      linkedinUrl: patch.profileUrl ?? person.linkedinUrl,
      email: verified,
      emailSource: verified ? "apollo" as const : null,
      links,
      guess: result?.guess ?? null,
    };
  });
  // Anyone Apollo didn't reveal still has a blurred last name ("Sm***h"): look for them among the people
  // Hunter lists at the company, and otherwise show just the first name and initial, with no email.
  let hunterKnown: Array<{ email: string; name: string }> = [];
  const blurred = listed.filter((person) => person.name.includes("*"));
  if (blurred.length && domain) {
    hunterKnown = (await hunterDomain(userId, domain).catch(() => null))?.emails ?? [];
    for (const person of blurred) {
      const match = unblur(person.name, hunterKnown);
      if (match) {
        person.name = match.name;
        person.email = match.email;
        person.emailSource = "hunter";
      } else {
        person.name = person.name.replace(/\s(\S)\S*\*\S*$/, (_, initial: string) => ` ${initial.toUpperCase()}.`);
        if (!person.linkedinUrl) person.links.push({ label: "Find on LinkedIn", url: `https://www.linkedin.com/search/results/people/?${new URLSearchParams({ keywords: `${person.name.split(" ")[0]} ${app.company}` })}` });
      }
    }
  }
  const hidden = listed.filter((person) => / \S\.$/.test(person.name)).length;
  search.steps.push({ step: "Full names", domain: domain ?? "", found: listed.length - hidden, ...(reveal.error ? { error: reveal.error.slice(0, 200) } : {}) });

  // The person the posting names goes first, as the posting gives them.
  if (app.postedRecruiter) {
    const named = app.postedRecruiter;
    listed.unshift({
      rank: 1, role: "job_poster", name: named.name, title: named.title ?? "", email: named.email, emailSource: named.email ? "job_posting" : null,
      relevance: named.linkedinUrl ? "Shown under \"Meet the hiring team\" on this job." : "Named on the job posting.",
      linkedinUrl: named.linkedinUrl ?? null, photoUrl: null, links: named.linkedinUrl ? [{ label: "LinkedIn", url: named.linkedinUrl }] : [], guess: null,
    });
  }

  // Emails from the company's format, for everyone without one.
  let format: EmailFormat | null = null;
  if (domain && listed.some((person) => !person.email)) {
    await say(`Searching for ${app.company}'s email format…`);
    const known = [...listed.filter((person) => person.email).map((person) => ({ email: person.email!, name: person.name })), ...hunterKnown];
    format = await learnFormat(userId, domain, known, listed.map((person) => person.name)).catch(() => null);
    await say("Writing out their emails…");
    for (const person of listed) {
      if (person.email || !fullName(person.name)) continue;
      const hunter = format?.known.find((item) => item.name && plain(item.name) === plain(person.name))?.email;
      const apollo = person.guess && patternOf(person.guess, person.name) ? person.guess : null;
      const built = format?.pattern ? buildEmail(format.pattern, person.name, domain) : null;
      const fallback = buildEmail("{first}.{last}", person.name, domain);
      if (hunter) [person.email, person.emailSource] = [hunter, "hunter"];
      else if (built) [person.email, person.emailSource] = [built, "likely"];
      else if (apollo) [person.email, person.emailSource] = [apollo, "likely"];
      else if (fallback) [person.email, person.emailSource] = [fallback, "guess"];
    }
  }

  const people: ListedPerson[] = listed.map((person, index) => {
    const { guess, ...rest } = person;
    void guess;
    return { ...rest, rank: index + 1 };
  });
  // Only a search that turned people up proves the website: the posting's own name says nothing about it.
  const proven = top.length ? winner : null;
  search.domain = proven;
  search.chosen = people[0] ? { name: people[0].name, role: people[0].role, email: Boolean(people[0].email) } : null;
  if (proven && proven !== app.companyDomain) await repo.setCompanyDomains(app.company, [proven]).catch(() => undefined);

  const notes: string[] = [];
  if (!domains.length && !people.length) notes.push(`Couldn't find ${app.company}'s website, so there was nowhere to look for people. Add it under the job and search again.`);
  else if (!people.length) notes.push(`Apollo found no one at ${app.company} (${domains.join(", ")})${school ? ` from ${school},` : ""} in recruiting, or in ${team || "this kind of role"}.`);
  else if (people.some((person) => person.emailSource === "likely" || person.emailSource === "guess")) notes.push(format?.pattern ? `Emails follow ${app.company}'s usual format (${format.pattern.replace(/[{}]/g, "")}@${domain}). They aren't checked yet.` : `Couldn't learn ${app.company}'s email format, so emails are a best guess (first.last). They aren't checked yet.`);
  if (hidden) notes.push(`Apollo didn't reveal ${hidden === 1 ? "1 person's last name" : `${hidden} people's last names`}, so they show by first name with no email. Find them on LinkedIn.${reveal.error ? ` Apollo said: ${reveal.error.replace(/^Apollo bulk match failed /, "").slice(0, 160)}` : ""}`);
  return { people, domain: proven, notes, search };
}

/** A blurred name ("Sam Le***e") matched to a real one Hunter lists at the company: same first name, and a last name that fits the letters shown. */
export function unblur(name: string, known: Array<{ email: string; name: string }>) {
  const [first, ...rest] = name.trim().split(/\s+/);
  const blurred = rest.join(" ").toLowerCase();
  const [start, end] = [blurred.split("*")[0].replace(/[^a-z]/g, ""), blurred.split("*").pop()!.replace(/[^a-z]/g, "")];
  const matches = known.filter((item) => {
    const parts = nameParts(item.name);
    return parts.first === nameParts(first).first && parts.last.startsWith(start) && parts.last.endsWith(end) && parts.last.length > start.length + end.length;
  });
  return matches.length === 1 ? matches[0] : null;
}

function recruiterWhy(app: JobApplication, person: Contact) {
  const team = mainDepartment(app.department);
  return `${person.title || "Recruiter"} at ${app.company}${team ? `, which may include the ${team} team` : ""}.`;
}

export const OUTREACH_EMAIL_PROMPT = `You write short cold emails from a college student to people at a company where the student just applied.
Use only facts from the student's resume and profile, the job posting, and the person's name and title. Never invent experience, mutual connections, numbers, or anything about the person beyond their name and title.
Each email: mention the specific role the student applied to, one or two real experiences that fit the job's requirements, and a small ask fitting the person (a recruiter: a quick look at the application; a hiring manager or teammate: a short chat about the team). Under 120 words. Plain text, a greeting with the person's first name, and a sign-off with the student's name. No placeholders in brackets.
Return only JSON: {"emails":[{"index":1,"subject":"...","body":"..."}]} with one entry per person, using the index given.`;

/** One model call writes an email for every person, from the student's resume and the posting. */
export async function writeOutreachEmails(userId: string, app: JobApplication, people: Array<Pick<ApplicationContact, "name" | "title" | "role">>, student: { name: string; resumeText: string; profile: string }, options: { followUp?: { subject: string; body: string; sentAt: string | null } } = {}) {
  if (!people.length) return [];
  const apiKey = await readAnthropicKey();
  if (!apiKey) throw new Error("AI writing is not configured.");
  const config = serverConfig();
  const prompt = [
    `Student: ${student.name}`,
    `Role applied to: ${app.title} at ${app.company}${app.department ? ` (${app.department})` : ""}`,
    app.requirements.length ? `Requirements from the posting:\n${app.requirements.slice(0, 12).map((item) => `- ${item}`).join("\n")}` : `Job description:\n${app.description.slice(0, 3000)}`,
    student.resumeText ? `Resume:\n${student.resumeText.slice(0, 5000)}` : "",
    student.profile ? `Profile:\n${student.profile.slice(0, 3000)}` : "",
    `People:\n${people.map((person, index) => `${index + 1}. ${person.name}, ${person.title || "title unknown"} (${person.role.replace("_", " ")})`).join("\n")}`,
    options.followUp ? `This is a follow-up. The student sent this email${options.followUp.sentAt ? ` on ${options.followUp.sentAt.slice(0, 10)}` : ""} and hasn't heard back:\nSubject: ${options.followUp.subject}\n${options.followUp.body.slice(0, 1500)}\n\nWrite a polite follow-up of 2 to 3 sentences: a quick nudge that restates interest in the role and the small ask. No guilt, no "just checking in" cliché. Subject: "Re: " and the original subject.` : "",
  ].filter(Boolean).join("\n\n");
  const model = process.env.ANTHROPIC_FAST_MODEL || "claude-haiku-4-5";
  const started = Date.now();
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model,
    max_tokens: 3000,
    system: [{ type: "text", text: OUTREACH_EMAIL_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: prompt }],
  });
  if (response.stop_reason === "refusal") throw new Error("The AI declined to write these emails.");
  const text = response.content.map((block) => (block.type === "text" ? block.text : "")).join("");
  const inputTokens = response.usage?.input_tokens ?? 0;
  const outputTokens = response.usage?.output_tokens ?? 0;
  const costCents = (inputTokens * config.fastInputCentsPerMillion + outputTokens * config.fastOutputCentsPerMillion) / 1_000_000;
  await repo.insertUsage({ id: id(), userId, provider: "anthropic", operation: "outreach_emails", success: true, latencyMs: Date.now() - started, costCents, estimated: true, error: null, createdAt: nowIso() });
  await repo.insertGeneration({ id: id(), userId, purpose: "outreach_emails", model, inputTokens, outputTokens, costCents, estimated: true, createdAt: nowIso() });
  let parsed: { emails?: Array<{ index?: number; subject?: string; body?: string }> } = {};
  try {
    parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  } catch {
    throw new Error("The AI returned emails Unnepo couldn't read. Try again.");
  }
  return people.map((_, index) => {
    const email = parsed.emails?.find((item) => Number(item.index) === index + 1);
    return { subject: String(email?.subject ?? "").trim().slice(0, 200), body: String(email?.body ?? "").trim().slice(0, 4000) };
  });
}
