import { serverConfig } from "@/lib/config";
import { id, nowIso, readAnthropicKey, repo } from "@/lib/db/file-store";
import type { Contact } from "@/lib/db/types";
import { contactFetch } from "@/lib/providers/contacts/http";
import { ServiceError } from "@/lib/errors";
import { safeGet } from "@/lib/apply/safe-fetch";
import { HUNTER_CENTS, buildEmail, checkerReady, guessEmail, hunterCheck, hunterCount, hunterDomain, hunterReady, learnFormat, nameParts, patternOf, siteEmails, type EmailFormat, type KnownEmail } from "@/lib/apply/email-guess";
import { sameCompany } from "@/lib/apply/match";
import { peopleFromWeb } from "@/lib/apply/people-web";
import { assertSpendAllowed, enrichPeopleBatch, isPersonalWorkEmail, looksLikePerson, searchCompanies, searchPeopleQuery, spentTodayCents } from "@/lib/providers/contacts/router";
import { COMPANY_DOMAINS, RECRUITER_TITLES, type ApolloPeopleQuery } from "@/lib/providers/contacts/apollo";
import type { ApplicationContact, ContactRole, HiddenPerson, JobApplication, PeopleSearch } from "@/lib/apply/types";

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
/** Paid reveals: the search stops after this many on its own, and "Show person" stops at the second number. */
export const AUTO_REVEALS = 2;
export const MAX_REVEALS = 3;
// A search has 60 seconds. Past this it stops starting new work and keeps what it has.
const TIME_BUDGET_MS = 45_000;

/** Campus and university recruiters before the rest: they hire students. */
const CAMPUS = /\b(campus|university|college|early (career|talent)|emerging talent|intern)/i;
const TOO_SENIOR = /\b(chief|ceo|cfo|coo|cto|president|founder|owner|board|vp|vice president|svp|evp|partner)\b/i;
const RECRUITING = /recruit|talent|sourcer|\bhr\b|human resources|head of people|people (ops|operations|partner|team)/i;
const MANAGES = /\b(manager|head|lead|director|supervisor)\b/i;
const HR_TITLES = ["human resources", "hr manager", "hr business partner", "people operations", "talent partner", "hiring manager"];
const WORKING_LEVELS = ["entry", "senior", "manager", "director"];
const ABROAD_PLACE = /\b(uk|united kingdom|london|ireland|dublin|germany|berlin|france|paris|spain|netherlands|amsterdam|canada|toronto|india|bangalore|bengaluru|hyderabad|singapore|japan|tokyo|china|shanghai|australia|sydney|philippines|manila|poland|brazil|mexico)\b/i;

/** A full name Unnepo can build an address from (Apollo hides last names until it enriches them: "Jane D."). */
const fullName = (name: string) => /^\S{2,}( \S+)* [^\s*.]{2,}$/.test(name.trim()) && !name.includes("*");

/** What a student has that someone at the company might share. */
export type StudentFacts = { school?: string; pastEmployers?: string[]; city?: string };

/**
 * Who's most worth emailing first: the person the posting names, then recruiters and HR (campus first), then a
 * hiring manager (a manager on the job's team), then a school connection, then the team; executives last. An alum
 * who recruits or manages counts nearly as much as a recruiter. `bonus` adds what was found about this person.
 */
export function relevance(person: Pick<FoundPerson, "role" | "title">, bonus = 0) {
  const manages = MANAGES.test(person.title);
  const base = person.role === "job_poster" ? 100
    : person.role === "recruiter" ? 80 + (CAMPUS.test(person.title) ? 10 : 0)
    : person.role === "alumni" ? 60 + (RECRUITING.test(person.title) ? 25 : manages ? 10 : 0)
    : 45 + (manages ? 25 : 0);
  return base + bonus - (TOO_SENIOR.test(person.title) ? 30 : 0);
}

// Words in a job's title that say nothing about the kind of work.
const GENERIC_TITLE_WORDS = new Set(["intern", "internship", "assistant", "associate", "specialist", "coordinator", "manager", "senior", "junior", "entry", "level", "summer", "fall", "spring", "winter", "part", "time", "full", "remote", "hybrid", "temporary", "contract"]);

/**
 * Whether someone's title is about this job: recruiting, HR or hiring, the job's department, or a word from the
 * job's own title ("Data Analyst Intern" fits a "Senior Data Scientist"; an "Office Coordinator" doesn't).
 */
export function relatedToJob(title: string, app: Pick<JobApplication, "department" | "title">) {
  if (!title.trim()) return false;
  if (RECRUITING.test(title) || /\bhiring\b/i.test(title)) return true;
  const team = departmentOf(app);
  const pattern = DEPARTMENTS.find(([, name]) => name.toLowerCase() === team.toLowerCase())?.[0];
  if (pattern?.test(title)) return true;
  const lower = title.toLowerCase();
  return coreTitle(app.title).toLowerCase().split(/[^a-z]+/).filter((word) => word.length >= 4 && !GENERIC_TITLE_WORDS.has(word)).some((word) => lower.includes(word));
}

/** What a person's place adds: near the job helps, and a recruiter on another continent doesn't hire for it. */
export function placeBonus(place: string, jobLocation: string | null) {
  const where = place.toLowerCase();
  const job = (jobLocation ?? "").toLowerCase();
  if (!where) return 0;
  const city = job.split(",")[0].trim();
  if (city.length >= 3 && where.includes(city)) return 6;
  return ABROAD_PLACE.test(where) && !ABROAD_PLACE.test(job) ? -25 : 0;
}

/** The list: most relevant first, with at most three recruiters, so it's a mix of who to talk to. */
export function mixedList<T extends { person: Pick<FoundPerson, "role" | "title">; bonus: number }>(pool: T[], size: number) {
  const ranked = [...pool].sort((a, b) => relevance(b.person, b.bonus) - relevance(a.person, a.bonus));
  const recruiters = ranked.filter((item) => item.person.role === "recruiter");
  const held = new Set(recruiters.slice(3));
  return [...ranked.filter((item) => !held.has(item)), ...recruiters.slice(3)].slice(0, size);
}

/** What's confirmed about a person once their history is known: "Also went to Colby College". Null if it isn't there. */
export function confirmed(maybe: string, history: string[]) {
  const wanted = maybe.toLowerCase();
  return history.some((place) => place.toLowerCase().includes(wanted) || wanted.includes(place.toLowerCase()) && place.length >= 4) ? maybe : null;
}

/** The sentence for why someone's on the list, saying only what's known. */
function whyLine(base: string, maybe: string[], history: string[] | null, school: string) {
  const parts = maybe.map((place) => {
    const sure = history ? confirmed(place, history) : null;
    const isSchool = place === school;
    return sure ? `Also ${isSchool ? "went to" : "worked at"} ${place}.` : `May have ${isSchool ? "gone to" : "worked at"} ${place}.`;
  });
  // What's confirmed goes first, so the email writer can tell.
  return [...parts.filter((part) => part.startsWith("Also")), ...parts.filter((part) => !part.startsWith("Also")), base].filter(Boolean).join(" ");
}

export type ListedPerson = FoundPerson & { links: Array<{ label: string; url: string }> };

/** Progress the page shows in the spider's bubbles while the search runs. */
type Progress = (text: string) => Promise<void> | void;

const sameSite = (a: string | null | undefined, b: string | null | undefined) => {
  const [x, y] = [(a ?? "").toLowerCase(), (b ?? "").toLowerCase()];
  return !x || !y || x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`);
};
const asApollo = (person: HiddenPerson) => ({ id: `apollo_${person.externalId}`, provider: "apollo", externalId: person.externalId, firstName: person.firstName, lastName: person.lastName, fullName: `${person.firstName} ${person.lastName}`, company: person.company, companyDomain: person.companyDomain }) as unknown as Contact;
const withLimit = async <T,>(work: Promise<T>, ms: number, otherwise: T) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((resolve) => { timer = setTimeout(() => resolve(otherwise), ms); });
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
};
const linkList = (values: Array<[string, unknown]>) => values.filter((pair): pair is [string, string] => typeof pair[1] === "string" && /^https?:\/\//.test(pair[1])).map(([label, url]) => ({ label, url }));
const linkedinSearch = (keywords: string) => `https://www.linkedin.com/search/results/people/?${new URLSearchParams({ keywords })}`;
const roleForTitle = (title: string): ContactRole => (RECRUITING.test(title) ? "recruiter" : "team_member");

/**
 * Lists up to LIST_SIZE people who work at the company, the cheapest way that works. Free first: the person the
 * posting names, Apollo's free searches (targeted, then wider), and the company's own pages. Then Hunter, which
 * can complete several people for one search. Then a paid Apollo reveal of the top person, and one more if that
 * person's email fails. Then, for a company none of these know, a web search of public pages. It stops paying as
 * soon as one person has a usable email: the rest of the list is revealed when the student asks.
 * Every person comes from one of these sources. Nobody is invented. Each search is recorded, so a result can be traced.
 */
export async function findPeopleForApplication(userId: string, app: JobApplication, options: { school?: string; facts?: StudentFacts; known?: KnownEmail[]; progress?: Progress; /** Free's preview: the free searches only, no emails, nothing paid. */ preview?: boolean } = {}): Promise<{ people: ListedPerson[]; domain: string | null; notes: string[]; search: PeopleSearch; hidden: Record<string, HiddenPerson>; reveals: number }> {
  const started = Date.now();
  const spentBefore = await spentTodayCents(userId).catch(() => 0);
  const over = () => Date.now() - started > TIME_BUDGET_MS;
  const school = (options.school ?? options.facts?.school ?? "").trim();
  const pastEmployers = (options.facts?.pastEmployers ?? []).filter((name) => name.trim().length >= 3 && !sameCompany(name, app.company)).slice(0, 2);
  const say = async (text: string) => { await options.progress?.(text); };
  await say(`Searching for ${app.company}'s website…`);
  const domains = await companyDomains(userId, app);
  const search: PeopleSearch = { at: nowIso(), company: app.company, domains, domain: null, school, steps: [], chosen: null };
  const team = departmentOf(app);
  const core = coreTitle(app.title);
  let failures: unknown = null;
  let lastFailed = false;

  /** One Apollo search (free). A hiccup gets one more try, and a failure is recorded and the next one runs anyway. */
  const look = async (step: string, domain: string, query: ApolloPeopleQuery) => {
    const ask = () => searchPeopleQuery(userId, { ...query, ...(domain ? { q_organization_domains_list: [domain] } : {}) }, 1, 10, { verifiedOnly: false });
    try {
      const { people } = await ask().catch(async (error) => {
        if (lastFailed) throw error;
        await new Promise((resolve) => setTimeout(resolve, 300));
        return ask();
      });
      lastFailed = false;
      // Not this company's people: a wrong website, or someone who just mentions it.
      const fits = (person: Contact) => !person.company || sameCompany(person.company, app.company) || Boolean(domain && (domainFits(domain, app.company) || domain === app.companyDomain));
      const kept = people.filter((person) => looksLikePerson(person.firstName, person.lastName, person.company || app.company) && fits(person));
      search.steps.push({ step, domain, found: kept.length });
      return kept;
    } catch (error) {
      failures ??= error;
      lastFailed = true;
      search.steps.push({ step, domain, found: 0, error: error instanceof Error ? error.message.replace(/\s*No credits were used\.?/i, "").slice(0, 200) : "failed" });
      return [];
    }
  };

  type Pooled = { person: FoundPerson; source: Contact; bonus: number; maybe: string[]; base: string };
  const trimmedCompany = app.company.trim();
  let pool: Pooled[] = [];
  let winner: string | null = null;
  const titles = [...new Set([team, core].filter(Boolean))];

  const gather = async (domain: string) => {
    const seen = new Map<string, Pooled>();
    const take = (people: Contact[], role: ContactRole | null, base: (person: Contact) => string, bonus: number, maybe?: string) => {
      for (const source of people) {
        const held = seen.get(source.id);
        if (held) {
          if (maybe && !held.maybe.includes(maybe)) { held.maybe.push(maybe); held.bonus += 15; }
          continue;
        }
        const pickedRole = role ?? roleForTitle(source.title);
        // Someone whose work has nothing to do with this job goes below everyone who does.
        const offTopic = pickedRole === "team_member" && role !== "team_member" && !relatedToJob(source.title, app) ? -25 : 0;
        seen.set(source.id, { person: found(source, pickedRole, ""), source, bonus: bonus + offTopic + (maybe ? (role === "alumni" ? 0 : 15) : 0) + placeBonus(source.location, app.location), maybe: maybe ? [maybe] : [], base: base(source) });
      }
    };
    const worksThere = (person: Contact) => `${person.title || "Works"} at ${trimmedCompany}.`;
    if (school) take(await look(`From ${school}`, domain, { q_keywords: school }), "alumni", (person) => (person.title ? `Now ${person.title}.` : ""), 0, school);
    for (const employer of pastEmployers) take(await look(`Also at ${employer}`, domain, { q_keywords: employer }), null, worksThere, 0, employer);
    take(await look("Recruiters", domain, { person_titles: RECRUITER_TITLES }), "recruiter", (person) => recruiterWhy(app, person), 0);
    if (titles.length) take(await look(team ? `${team} department` : `${core} roles`, domain, { person_titles: titles }), "team_member", (person) => `${person.title || "Works"} in ${team || "the same kind of role"}, the team this job is in.`, 0);
    // Not enough yet: wider, still free, and worth less on the list.
    if (seen.size < LIST_SIZE && !over()) take(await look("HR and people teams", domain, { person_titles: HR_TITLES }), "recruiter", worksThere, -5);
    if (seen.size < LIST_SIZE && !over()) {
      // Only people whose work is about this job, unless nobody at all has turned up.
      const anyone = await look("Anyone at the company", domain, { person_seniorities: WORKING_LEVELS });
      const fitting = anyone.filter((person) => relatedToJob(person.title, app));
      take(fitting.length || seen.size ? fitting : anyone, null, worksThere, -20);
    }
    return [...seen.values()];
  };

  for (const domain of domains) {
    if (over()) break;
    await say(`Searching for relevant people at ${app.company}…`);
    pool = await gather(domain);
    if (pool.length) {
      winner = domain;
      break;
    }
  }
  // No website worked: the company's name, keeping only people Apollo says work there.
  if (!pool.length && !over()) {
    const byName = (await look("By company name", "", { q_keywords: trimmedCompany })).filter((person) => person.company && sameCompany(person.company, app.company));
    pool = byName.map((source) => ({ person: found(source, roleForTitle(source.title), ""), source, bonus: -10 + (relatedToJob(source.title, app) ? 0 : -25) + placeBonus(source.location, app.location), maybe: [], base: `${source.title || "Works"} at ${trimmedCompany}.` }));
    const site = byName.map((person) => person.companyDomain).find(Boolean);
    if (site) winner = site;
  }
  await say("Ranking people by how relevant they are to you…");
  const top = mixedList(pool, LIST_SIZE - (app.postedRecruiter ? 1 : 0));
  const domain = winner ?? domains[0] ?? null;

  type Row = ListedPerson & { guess: string | null; source?: Contact; maybe: string[]; base: string; history: string[] | null; checked: boolean };
  const listed: Row[] = top.map(({ person, source, maybe, base }) => ({ ...person, email: null, emailSource: null, relevance: whyLine(base, maybe, null, school), links: linkList([["LinkedIn", source.profileUrl], ["X", source.twitterUrl], ["GitHub", source.githubUrl], ["Facebook", source.facebookUrl]]), guess: null, source, maybe, base, history: null, checked: false }));
  if (app.postedRecruiter) {
    const named = app.postedRecruiter;
    listed.unshift({
      rank: 1, role: "job_poster", name: named.name, title: named.title ?? "", email: named.email, emailSource: named.email ? "job_posting" : null,
      relevance: named.linkedinUrl ? "Shown under \"Meet the hiring team\" on this job." : "Named on the job posting.",
      linkedinUrl: named.linkedinUrl ?? null, photoUrl: null, links: named.linkedinUrl ? [{ label: "LinkedIn", url: named.linkedinUrl }] : [], guess: null, maybe: [], base: "", history: null, checked: Boolean(named.email),
    });
  }

  // Free's preview stops here: who's there, from the free searches, with no emails and nothing paid for.
  if (options.preview) {
    search.listed = listed.length;
    const people = listed.map((row, index): ListedPerson => ({ rank: index + 1, role: row.role, name: row.name, title: row.title, email: null, emailSource: null, relevance: row.relevance, linkedinUrl: null, photoUrl: null, links: [] }));
    return { people, domain: winner ?? domains[0] ?? null, notes: [], search, hidden: {}, reveals: 0 };
  }

  // Free again: addresses published on the company's own pages, when Apollo has no one.
  if (!top.length && domain && !over()) {
    const onSite = await withLimit(siteEmails(domain).catch(() => [] as string[]), 12_000, [] as string[]);
    for (const email of onSite.slice(0, LIST_SIZE)) {
      const words = email.split("@")[0].match(/^([a-z]{2,})[._]([a-z]{2,})$/);
      if (!words) continue;
      const name = `${words[1][0].toUpperCase()}${words[1].slice(1)} ${words[2][0].toUpperCase()}${words[2].slice(1)}`;
      listed.push({ rank: 1, role: "team_member", name, title: "", email, emailSource: "website", relevance: `Listed on ${app.company}'s website.`, linkedinUrl: null, photoUrl: null, links: [], guess: null, maybe: [], base: "", history: null, checked: true });
    }
    search.steps.push({ step: "Company website", domain, found: listed.filter((person) => person.emailSource === "website").length });
  }

  // Addresses this student already has at the company cost nothing to use again.
  const fromBefore: KnownEmail[] = (options.known ?? []).filter((item) => !domain || item.email.toLowerCase().endsWith(`@${domain.toLowerCase()}`));
  const complete = (person: Row, match: KnownEmail, source: FoundPerson["emailSource"]) => {
    person.name = match.name;
    person.email = match.email;
    person.emailSource = source;
    person.checked = source === "hunter" || source === "pattern" || source === "website" || source === "apollo";
    if (match.linkedin && !person.linkedinUrl) {
      person.linkedinUrl = match.linkedin;
      person.links.push({ label: "LinkedIn", url: match.linkedin });
    }
  };
  const blurredNow = () => listed.filter((person) => person.name.includes("*"));
  for (const person of blurredNow()) {
    const match = unblur(person.name, fromBefore);
    if (match) complete(person, match, match.verified ? "hunter" : "likely");
  }

  // The company's format, from what's free.
  let format: EmailFormat | null = null;
  if (domain) {
    await say(`Searching for ${app.company}'s email format…`);
    const known = [...listed.filter((person) => person.email && fullName(person.name)).map((person) => ({ email: person.email!, name: person.name })), ...fromBefore];
    format = await withLimit(learnFormat(userId, domain, known, listed.map((person) => person.name), { useHunter: false }).catch(() => null), 15_000, null);
  }

  // Hunter next: one search can complete several people, for less than one Apollo reveal. Its free count says
  // whether it's worth asking. It also lists people when Apollo had no one.
  let hunterKnown: KnownEmail[] = [];
  const stillNeedsHunter = () => domain && hunterReady() && !over() && (blurredNow().length > 0 || !listed.length || !format?.pattern);
  if (stillNeedsHunter() && (await hunterCount(domain!)) !== 0) {
    await say(`Checking who Hunter knows at ${app.company}…`);
    const hunter = await hunterDomain(userId, domain!).catch(() => null);
    hunterKnown = hunter?.emails ?? [];
    search.steps.push({ step: "Hunter", domain: domain!, found: hunterKnown.length });
    if (hunter && (hunter.pattern || hunter.acceptAll)) {
      format = { pattern: format?.pattern ?? hunter.pattern, acceptAll: hunter.acceptAll, source: format?.pattern ? format.source : "hunter", known: [...(format?.known ?? []), ...hunterKnown] };
      await repo.setEmailFormat(domain!, { pattern: format.pattern, acceptAll: format.acceptAll, source: format.source }).catch(() => undefined);
    } else if (format) format = { ...format, known: [...format.known, ...hunterKnown] };
    for (const person of blurredNow()) {
      const match = unblur(person.name, hunterKnown);
      if (match) complete(person, match, match.verified ? "hunter" : "likely");
    }
    if (!listed.length) {
      for (const item of hunterKnown.filter((entry) => fullName(entry.name) && isPersonalWorkEmail(entry.email)).slice(0, LIST_SIZE)) {
        const row: Row = { rank: 1, role: roleForTitle(item.title ?? ""), name: item.name, title: item.title ?? "", email: null, emailSource: null, relevance: `${item.title || "Works"} at ${trimmedCompany}.`, linkedinUrl: null, photoUrl: null, links: [], guess: null, maybe: [], base: "", history: null, checked: false };
        complete(row, item, item.verified ? "hunter" : "likely");
        listed.push(row);
      }
      listed.sort((a, b) => relevance(b) - relevance(a));
    }
  }

  // A web search of public pages, only when nobody at all has turned up.
  if (!listed.length && !over()) {
    await say(`Searching public pages for people at ${app.company}…`);
    const onWeb = await peopleFromWeb(userId, app);
    search.steps.push({ step: "Public web pages", domain: domain ?? "", found: onWeb.length });
    for (const item of onWeb) listed.push({ rank: 1, role: roleForTitle(item.title), name: item.name, title: item.title, email: null, emailSource: null, relevance: `${item.title || "Works"} at ${trimmedCompany}, named on a public page.`, linkedinUrl: null, photoUrl: null, links: [{ label: "Source", url: item.url }], guess: null, maybe: [], base: "", history: null, checked: false });
    listed.sort((a, b) => relevance(b) - relevance(a));
  }

  if (!listed.length && search.steps.length && search.steps.every((step) => step.error || step.found === 0) && search.steps.some((step) => step.error) && search.steps.filter((step) => !step.error).every((step) => ["Company website", "Public web pages", "Hunter"].includes(step.step))) {
    throw failures instanceof ServiceError ? failures : new ServiceError("Couldn't look up people right now.", "provider_failed", 502);
  }

  // Now pay, only as far as it takes: down the list until one person has a usable email.
  const reveal: { error?: string } = {};
  let reveals = 0;
  const dropped = new Set<Row>();
  const revealRow = async (person: Row) => {
    reveals += 1;
    const result = (await enrichPeopleBatch([person.source!], userId, reveal)).get(person.source!.id);
    if (!result) return;
    const patch = result.patch;
    // Apollo says they've moved on: they don't work here any more.
    if (domain && patch.companyDomain && !sameSite(patch.companyDomain, domain) && !sameSite(patch.companyDomain, person.source!.companyDomain)) {
      dropped.add(person);
      return;
    }
    if (patch.lastName) person.name = `${person.source!.firstName} ${patch.lastName}`.trim();
    person.photoUrl = patch.photoUrl ?? person.photoUrl;
    person.linkedinUrl = patch.profileUrl ?? person.linkedinUrl;
    person.links = linkList([["LinkedIn", patch.profileUrl ?? person.source!.profileUrl], ["X", patch.twitterUrl ?? person.source!.twitterUrl], ["GitHub", patch.githubUrl ?? person.source!.githubUrl], ["Facebook", patch.facebookUrl ?? person.source!.facebookUrl]]);
    person.history = result.history;
    person.relevance = whyLine(person.base, person.maybe, result.history, school);
    person.guess = result.guess ?? null;
    if (result.emailStatus === "verified" && result.email) {
      person.email = result.email;
      person.emailSource = "apollo";
      person.checked = true;
    }
  };
  const usable = (person: Row) => Boolean(person.email && person.checked);
  await say("Finding the best person's email…");
  for (const person of listed) {
    if (listed.some(usable) || over()) break;
    if (!fullName(person.name)) {
      if (reveals >= AUTO_REVEALS || reveal.error || !person.source) continue;
      await say("Getting their name and profile…");
      await revealRow(person);
      if (dropped.has(person) || usable(person) || !fullName(person.name)) continue;
    }
    if (!domain || !format) continue;
    const guess = await guessEmail(userId, person.name, domain, format, person.guess ? [person.guess] : [], { checks: 3 }).catch(() => null);
    if (guess) {
      person.email = guess.email;
      person.emailSource = guess.verified ? guess.source : guess.uncheckable ? "cant_check" : "likely";
      person.checked = guess.verified || Boolean(guess.uncheckable);
      // Nothing to check it with: this is as sure as it gets, so stop paying.
      if (!checkerReady()) break;
    } else if (checkerReady()) {
      person.email = null;
      person.emailSource = null;
    }
  }

  // Everyone else: an address from the format, labeled as not checked, and a first name until they're revealed.
  const hidden: Record<string, HiddenPerson> = {};
  const kept = listed.filter((person) => !dropped.has(person));
  for (const person of kept) {
    const blurred = person.name.includes("*");
    if (blurred) {
      person.name = person.name.replace(/\s(\S)\S*\*\S*$/, (_, initial: string) => ` ${initial.toUpperCase()}.`);
      if (!person.linkedinUrl) person.links.push({ label: "Find on LinkedIn", url: linkedinSearch(`${person.name.split(" ")[0]} ${app.company}`) });
      if (person.source?.externalId) hidden[person.name.toLowerCase()] = { externalId: person.source.externalId, firstName: person.source.firstName, lastName: person.source.lastName, company: person.source.company, companyDomain: person.source.companyDomain, maybe: person.maybe };
      continue;
    }
    if (person.email || !domain || !fullName(person.name)) continue;
    const onFile = format?.known.find((item) => item.name && plain(item.name) === plain(person.name));
    const apollo = person.guess && patternOf(person.guess, person.name) ? person.guess : null;
    const built = format?.pattern ? buildEmail(format.pattern, person.name, domain) : null;
    const fallback = buildEmail("{first}.{last}", person.name, domain);
    if (onFile) [person.email, person.emailSource] = [onFile.email, onFile.verified ? "hunter" : "likely"];
    else if (built) [person.email, person.emailSource] = [built, format?.acceptAll ? "cant_check" : "likely"];
    else if (apollo) [person.email, person.emailSource] = [apollo, "likely"];
    else if (fallback) [person.email, person.emailSource] = [fallback, "guess"];
  }

  const people: ListedPerson[] = kept.map((person, index) => {
    const { guess, source, maybe, base, history, checked, ...rest } = person;
    void guess; void source; void maybe; void base; void history; void checked;
    return { ...rest, rank: index + 1 };
  });
  const hiddenCount = Object.keys(hidden).length;
  search.steps.push({ step: "Full names", domain: domain ?? "", found: people.length - hiddenCount, ...(reveal.error ? { error: reveal.error.slice(0, 200) } : {}) });
  // Only a search that turned people up proves the website: the posting's own name says nothing about it.
  const proven = top.length || hunterKnown.length ? winner ?? domain : null;
  search.domain = proven;
  search.chosen = people[0] ? { name: people[0].name, role: people[0].role, email: Boolean(people[0].email) } : null;
  search.listed = people.length;
  search.withEmail = people.filter((person) => person.email).length;
  search.verified = people.filter((person) => person.emailSource === "apollo" || person.emailSource === "hunter" || person.emailSource === "pattern" || person.emailSource === "website").length;
  search.costCents = Math.max(0, Math.round(((await spentTodayCents(userId).catch(() => spentBefore)) - spentBefore) * 10) / 10);
  if (proven && proven !== app.companyDomain && top.length) await repo.setCompanyDomains(app.company, [proven]).catch(() => undefined);

  const notes: string[] = [];
  const apolloFailed = search.steps.some((step) => step.error && step.step !== "Full names");
  if (!domains.length && !people.length) notes.push(`Couldn't find ${app.company}'s website or anyone there. Add its website below, or try LinkedIn.`);
  else if (!people.length) notes.push(`${apolloFailed ? "The people search had trouble just now, and nobody else knows" : "None of the sources Unnepo checks know anyone at"} ${app.company}${domains.length ? ` (${domains.join(", ")})` : ""}. Check the website below, or try LinkedIn.`);
  else if (people.some((person) => person.emailSource === "likely" || person.emailSource === "guess")) notes.push(format?.pattern ? `Emails marked as not checked follow ${app.company}'s usual format (${format.pattern.replace(/[{}]/g, "")}@${domain}).` : `Couldn't learn ${app.company}'s email format, so some emails are a best guess (first.last).`);
  if (over()) notes.push("This search ran out of time, so it shows what it found. Search again for more.");
  if (hiddenCount && reveal.error) notes.push(`Apollo didn't reveal ${hiddenCount === 1 ? "1 person's last name" : `${hiddenCount} people's last names`}, so they show by first name with no email. Find them on LinkedIn. Apollo said: ${reveal.error.replace(/^Apollo bulk match failed /, "").slice(0, 160)}`);
  return { people, domain: proven, notes, search, hidden, reveals };
}

/** "Show person": pays to reveal one person on the list, then finds and checks their email. Null if they've left. */
export async function revealHiddenPerson(userId: string, app: JobApplication, hiddenPerson: HiddenPerson, school: string, base: string) {
  const report: { error?: string } = {};
  const source = asApollo(hiddenPerson);
  const result = (await enrichPeopleBatch([source], userId, report)).get(source.id);
  if (report.error) throw new ServiceError(/budget/i.test(report.error) ? "You've reached today's limit for looking people up. Try again tomorrow." : "Apollo couldn't show this person right now. Try again in a bit.", "reveal_failed", 502);
  if (!result?.patch.lastName) return null;
  const domain = app.companyDomain ?? hiddenPerson.companyDomain;
  if (domain && result.patch.companyDomain && !sameSite(result.patch.companyDomain, domain) && !sameSite(result.patch.companyDomain, hiddenPerson.companyDomain)) return null;
  const name = `${hiddenPerson.firstName} ${result.patch.lastName}`.trim();
  let email = result.emailStatus === "verified" ? result.email : null;
  let emailSource: FoundPerson["emailSource"] = email ? "apollo" : null;
  if (!email && domain) {
    const format = await learnFormat(userId, domain, [], [name], { useHunter: false }).catch(() => null);
    if (format) {
      const guess = await guessEmail(userId, name, domain, format, result.guess ? [result.guess] : [], { checks: 3 }).catch(() => null);
      if (guess) [email, emailSource] = [guess.email, guess.verified ? guess.source : guess.uncheckable ? "cant_check" : "likely"];
      else if (!checkerReady()) {
        const fallback = buildEmail("{first}.{last}", name, domain);
        if (fallback) [email, emailSource] = [fallback, "guess"];
      }
    }
  }
  return {
    name, email, emailSource,
    linkedinUrl: result.patch.profileUrl ?? null, photoUrl: result.patch.photoUrl ?? null,
    links: linkList([["LinkedIn", result.patch.profileUrl], ["X", result.patch.twitterUrl], ["GitHub", result.patch.githubUrl], ["Facebook", result.patch.facebookUrl]]),
    relevance: whyLine(base, hiddenPerson.maybe, result.history, school),
  };
}

/** Before an email is written to someone whose address was never checked: check it now. "bad": it won't arrive. */
export async function checkBeforeWriting(userId: string, name: string, domain: string, current: string): Promise<{ email: string | null; emailSource: FoundPerson["emailSource"] } | null> {
  if (!checkerReady() || !fullName(name)) return null;
  const format = await learnFormat(userId, domain, [], [name], { useHunter: false }).catch(() => null);
  if (!format) return null;
  const guess = await guessEmail(userId, name, domain, format, [current], { checks: 3 }).catch(() => null);
  if (!guess) return { email: null, emailSource: null };
  return { email: guess.email, emailSource: guess.verified ? guess.source : guess.uncheckable ? "cant_check" : "likely" };
}

/** A blurred name ("Sam Le***e") matched to a real one Hunter lists at the company: same first name, and a last name that fits the letters shown. */
export function unblur<T extends { email: string; name: string }>(name: string, known: T[]) {
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
Use only facts from the student's resume and profile, the job posting, and the person's name and title. Never invent experience, mutual connections, numbers, or anything about the person beyond their name and title. If a person has something "confirmed in common with the student", open with it. Otherwise don't claim anything in common.
Each email: mention the specific role the student applied to, one or two real experiences that fit the job's requirements, and a small ask fitting the person (a recruiter: a quick look at the application; a hiring manager or teammate: a short chat about the team). Under 120 words. Plain text, a greeting with the person's first name, and a sign-off with the student's name. No placeholders in brackets.
Return only JSON: {"emails":[{"index":1,"subject":"...","body":"..."}]} with one entry per person, using the index given.`;

/** One model call writes an email for every person, from the student's resume and the posting. */
export async function writeOutreachEmails(userId: string, app: JobApplication, people: Array<Pick<ApplicationContact, "name" | "title" | "role"> & { relevance?: string }>, student: { name: string; resumeText: string; profile: string }, options: { followUp?: { subject: string; body: string; sentAt: string | null } } = {}) {
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
    // Only what's confirmed goes to the writer: "May have gone to Colby" isn't a fact to put in an email.
    `People:\n${people.map((person, index) => {
      const shared = person.relevance?.match(/^Also [^.]+\./)?.[0];
      const role = person.role === "alumni" ? "works at the company" : person.role.replace("_", " ");
      return `${index + 1}. ${person.name}, ${person.title || "title unknown"} (${role})${shared ? `. Confirmed in common with the student: ${shared.replace(/^Also /, "they ")}` : ""}`;
    }).join("\n")}`,
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
