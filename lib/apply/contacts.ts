import { serverConfig } from "@/lib/config";
import { id, nowIso, readAnthropicKey, readApolloKey, repo } from "@/lib/db/file-store";
import type { Contact } from "@/lib/db/types";
import { contactFetch } from "@/lib/providers/contacts/http";
import { ServiceError } from "@/lib/errors";
import { assertSpendAllowed, enrichPeopleBatch, isPersonalWorkEmail, looksLikePerson, searchCompanies, searchPeopleQuery } from "@/lib/providers/contacts/router";
import { COMPANY_DOMAINS, RECRUITER_TITLES, type ApolloPeopleQuery } from "@/lib/providers/contacts/apollo";
import type { ApplicationContact, ContactRole, JobApplication, PeopleSearch } from "@/lib/apply/types";

/**
 * After a student applies, finds the one best real person to email about the role: someone from their
 * school at the company, else a recruiter, else someone in the job's department. Every person comes from
 * Apollo or the posting itself. Nobody is invented.
 */

export const MAX_CONTACTS = 1;
/** People in the chosen group checked for a verified email, so one without an email can be passed over. */
const CHECK_PER_GROUP = 3;
/** Company websites tried, best match first, until one turns up people. */
const MAX_DOMAINS = 3;

const HUNTER_CENTS = 3;

export type FoundPerson = Omit<ApplicationContact, "id" | "applicationId" | "userId" | "createdAt" | "updatedAt" | "outreachStatus" | "emailSubject" | "emailBody">;

const SENIORITY_WORDS = /\b(senior|sr\.?|junior|jr\.?|lead|principal|staff|associate|intern(ship)?|entry[- ]level|i{1,3}|iv|[0-9])\b/gi;

/** "Account Executive - Commercial, Spotify Technology" → "Account Executive" */
export function coreTitle(title: string) {
  return title.split(/\s[-–|,(]\s?|,|\(/)[0].replace(SENIORITY_WORDS, " ").replace(/\s+/g, " ").trim();
}

function mainDepartment(department: string | null) {
  return (department ?? "").split(/,|&|\band\b|\//)[0].trim();
}

function hunterKey() {
  return process.env.HUNTER_API_KEY?.trim() || "";
}

export function hunterReady() {
  return Boolean(hunterKey());
}

async function recordHunter(userId: string, operation: string, success: boolean, started: number, error?: string) {
  await repo.insertUsage({ id: id(), userId, provider: "hunter", operation, success, latencyMs: Date.now() - started, costCents: success ? HUNTER_CENTS : 0, estimated: true, error: error ?? null, createdAt: nowIso() });
}

/** Hunter's email finder. Keeps the email only when Hunter verified it as deliverable. */
export async function hunterFindEmail(userId: string, firstName: string, lastName: string, domain: string) {
  const key = hunterKey();
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
  const key = hunterKey();
  if (!key) return false;
  await assertSpendAllowed(userId, HUNTER_CENTS);
  const started = Date.now();
  try {
    const response = await contactFetch(`https://api.hunter.io/v2/email-verifier?${new URLSearchParams({ email, api_key: key })}`, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`hunter_${response.status}`);
    const body = (await response.json()) as { data?: { status?: string } };
    await recordHunter(userId, "email_verifier", true, started);
    return body.data?.status === "valid";
  } catch (error) {
    await recordHunter(userId, "email_verifier", false, started, error instanceof Error ? error.message : "hunter_failed");
    return false;
  }
}

/** Apollo's match for one named person at a company. Costs one Apollo credit. */
async function apolloMatchByName(userId: string, name: string, domain: string | null, company: string) {
  const apolloKey = await readApolloKey();
  if (!apolloKey) return null;
  const [firstName, ...rest] = name.split(" ");
  const lastName = rest.join(" ");
  await assertSpendAllowed(userId, 8);
  try {
    const response = await contactFetch("https://api.apollo.io/api/v1/people/match", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apolloKey },
      body: JSON.stringify({ first_name: firstName, last_name: lastName, organization_name: company, domain: domain ?? undefined, reveal_personal_emails: false }),
    });
    if (!response.ok) return null;
    const person = ((await response.json()) as { person?: Record<string, unknown> | null }).person;
    if (!person) return null;
    const email = typeof person.email === "string" && person.email_status === "verified" && isPersonalWorkEmail(person.email) ? person.email : null;
    return {
      title: typeof person.title === "string" ? person.title : null,
      email,
      linkedinUrl: typeof person.linkedin_url === "string" ? person.linkedin_url : null,
      photoUrl: typeof person.photo_url === "string" ? person.photo_url : null,
    };
  } catch {
    return null;
  }
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

const plain = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "");

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
  if (found.length >= MAX_DOMAINS) return found.slice(0, MAX_DOMAINS);
  const fits: string[] = [];
  const others: string[] = [];
  for (const name of names.slice(0, 2)) {
    for (const org of await searchCompanies(userId, name)) {
      const same = plain(org.name) === plain(name) || plain(org.domain.split(".")[0]) === plain(name);
      const close = plain(org.name).startsWith(plain(name)) || plain(name).startsWith(plain(org.name));
      (same || close ? fits : others).push(org.domain);
    }
    if (fits.length) break;
  }
  fits.forEach(add);
  // Apollo's top result counts only when nothing fit by name.
  if (!fits.length) add(others[0]);
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

/**
 * Finds the one best person to email after applying, in this order:
 * 1. someone from the student's school who works at the company,
 * 2. a recruiter there (the one named on the posting first, then campus recruiters),
 * 3. someone in the job's department.
 * Only someone with a verified email counts, so a group without one gives way to the next. Their LinkedIn
 * comes along when Apollo has it. Every person comes from Apollo or the posting itself. Nobody is invented.
 * Each search is recorded, so "no one found" says why.
 */
export async function findPeopleForApplication(userId: string, app: JobApplication, options: { school?: string } = {}): Promise<{ people: FoundPerson[]; domain: string | null; notes: string[]; search: PeopleSearch }> {
  const school = (options.school ?? "").trim();
  const domains = await companyDomains(userId, app);
  const search: PeopleSearch = { at: nowIso(), company: app.company, domains, domain: null, school, steps: [], chosen: null };
  const team = departmentOf(app);
  const core = coreTitle(app.title);
  let searches = 0;
  let failures: unknown = null;

  /** One Apollo search; a failure is recorded and the next step runs anyway. */
  const look = async (step: string, domain: string, query: ApolloPeopleQuery) => {
    searches += 1;
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

  let chosen: FoundPerson | null = null;
  let winner: string | null = null;
  let poster: FoundPerson | null = null;
  for (const domain of domains) {
    // 1. Someone from the student's school.
    if (school) {
      const alumni = await look(`From ${school}`, domain, { q_keywords: school });
      chosen = await best(userId, domain, alumni.map((person) => found(person, "alumni", `Apollo's profile for them mentions ${school}, and they work at ${app.company}${person.title ? ` as ${person.title}` : ""}.`)), alumni);
    }
    // 2. A recruiter: the one the posting names first, when their email checks out.
    if (!chosen && app.postedRecruiter) {
      poster ??= await posterFor(userId, app, domain);
      search.steps.push({ step: "Named on the posting", domain, found: poster.email ? 1 : 0 });
      if (poster.email) chosen = poster;
    }
    if (!chosen) {
      const recruiters = await look("Recruiters", domain, { person_titles: RECRUITER_TITLES });
      chosen = await best(userId, domain, recruiters.map((person) => found(person, "recruiter", recruiterWhy(app, person))), recruiters);
    }
    // 3. Someone in the job's department.
    if (!chosen) {
      const titles = [...new Set([team, core].filter(Boolean))];
      const teamPeople = titles.length ? await look(team ? `${team} department` : `${core} roles`, domain, { person_titles: titles }) : [];
      chosen = await best(userId, domain, teamPeople.map((person) => found(person, "team_member", `${person.title || "Works"} in ${team || "the same kind of role"} at ${app.company}, the team this job is in.`)), teamPeople);
    }
    if (chosen) {
      winner = domain;
      break;
    }
  }

  // Every search failed: say so, so the student can try again, instead of "no one found".
  if (!chosen && searches > 0 && search.steps.every((step) => step.error)) {
    throw failures instanceof ServiceError ? failures : new ServiceError("Couldn't look up people right now.", "provider_failed", 502);
  }
  // Only a search that turned people up proves the website: the posting's own name says nothing about it.
  const proven = chosen && chosen.role !== "job_poster" ? winner : null;
  search.domain = proven;
  search.chosen = chosen ? { name: chosen.name, role: chosen.role, email: Boolean(chosen.email) } : null;
  // Remember the website that found people, for this company on every student's search.
  if (proven && proven !== app.companyDomain) await repo.setCompanyDomains(app.company, [proven]).catch(() => undefined);

  const notes: string[] = [];
  const seen = search.steps.reduce((sum, step) => sum + step.found, 0);
  if (!domains.length) notes.push(`Couldn't match ${app.company} to a company in Apollo.`);
  else if (!chosen && seen) notes.push(`Found ${seen} ${seen === 1 ? "person" : "people"} at ${app.company}, but none with a verified email yet.`);
  else if (!chosen) notes.push(`Apollo found no one at ${app.company} (${domains.join(", ")})${school ? ` from ${school},` : ""} in recruiting, or in ${team || "this kind of role"}.`);
  else if (chosen.role !== "alumni" && school) notes.push(`No one from ${school} with a verified email turned up at ${app.company}, so this is ${chosen.role === "team_member" ? `someone in ${team || "the team"}` : "a recruiter"}.`);
  return { people: chosen ? [chosen] : [], domain: proven, notes, search };
}

function recruiterWhy(app: JobApplication, person: Contact) {
  const team = mainDepartment(app.department);
  return `${person.title || "Recruiter"} at ${app.company}${team ? `, which may include the ${team} team` : ""}.`;
}

/** The person the posting names, matched in Apollo for their title and email (one Apollo credit). */
async function posterFor(userId: string, app: JobApplication, domain: string): Promise<FoundPerson> {
  const named = app.postedRecruiter!;
  const match = await apolloMatchByName(userId, named.name, domain, app.company);
  const title = match?.title || named.title || "";
  const poster: FoundPerson = {
    rank: 1, role: "job_poster", name: named.name, title, email: match?.email ?? null, emailSource: match?.email ? "apollo" : null,
    relevance: `Named on the ${app.title} posting${title ? ` as ${title}` : ""}.`, linkedinUrl: match?.linkedinUrl ?? null, photoUrl: match?.photoUrl ?? null,
  };
  if (!poster.email && named.email && (await hunterVerify(userId, named.email))) {
    poster.email = named.email;
    poster.emailSource = "job_posting";
  }
  return poster;
}

/** Campus and university recruiters before the rest: they hire students. */
const CAMPUS = /\b(campus|university|college|early (career|talent)|emerging talent|intern)/i;

/**
 * The best of one group: its first few people are checked for a verified email (Apollo, then Hunter) and the
 * first with one wins. Nobody without a verified email is chosen.
 */
async function best(userId: string, domain: string, people: FoundPerson[], sources: Contact[]): Promise<FoundPerson | null> {
  if (!people.length) return null;
  const order = people.map((person, index) => ({ person, source: sources[index] }))
    .sort((a, b) => (a.person.role === "recruiter" ? Number(CAMPUS.test(b.person.title)) - Number(CAMPUS.test(a.person.title)) : 0))
    .slice(0, CHECK_PER_GROUP);
  const enriched = await enrichPeopleBatch(order.map((item) => item.source), userId);
  for (const item of order) {
    const result = enriched.get(item.source.id);
    if (!result) continue;
    // Photo, LinkedIn, and full last name are kept even when Apollo couldn't verify the email.
    if (result.patch.lastName) item.person.name = `${item.source.firstName} ${result.patch.lastName}`.trim();
    if (result.patch.photoUrl) item.person.photoUrl = result.patch.photoUrl;
    if (result.patch.profileUrl) item.person.linkedinUrl = result.patch.profileUrl;
    if (result.email && result.emailStatus === "verified" && isPersonalWorkEmail(result.email)) {
      item.person.email = result.email;
      item.person.emailSource = "apollo";
    }
  }
  const withEmail = order.find((item) => item.person.email);
  if (withEmail) return withEmail.person;
  // Hunter for the top person only.
  const top = order[0].person;
  if (hunterReady()) {
    const [first, ...rest] = top.name.split(" ");
    const email = await hunterFindEmail(userId, first, rest.join(" "), domain).catch(() => null);
    if (email) {
      top.email = email;
      top.emailSource = "hunter";
      return top;
    }
  }
  return null;
}

export const OUTREACH_EMAIL_PROMPT = `You write short cold emails from a college student to people at a company where the student just applied.
Use only facts from the student's resume and profile, the job posting, and the person's name and title. Never invent experience, mutual connections, numbers, or anything about the person beyond their name and title.
Each email: mention the specific role the student applied to, one or two real experiences that fit the job's requirements, and a small ask fitting the person (a recruiter: a quick look at the application; a hiring manager or teammate: a short chat about the team). Under 120 words. Plain text, a greeting with the person's first name, and a sign-off with the student's name. No placeholders in brackets.
Return only JSON: {"emails":[{"index":1,"subject":"...","body":"..."}]} with one entry per person, using the index given.`;

/** One model call writes an email for every person, from the student's resume and the posting. */
export async function writeOutreachEmails(userId: string, app: JobApplication, people: Array<Pick<ApplicationContact, "name" | "title" | "role">>, student: { name: string; resumeText: string; profile: string }) {
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
