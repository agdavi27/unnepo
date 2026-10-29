import { serverConfig } from "@/lib/config";
import { id, nowIso, readAnthropicKey, readApolloKey, repo } from "@/lib/db/file-store";
import type { Contact } from "@/lib/db/types";
import { contactFetch } from "@/lib/providers/contacts/http";
import { assertSpendAllowed, enrichPeopleBatch, isPersonalWorkEmail, looksLikePerson, resolveCompanyDomains, searchPeopleQuery } from "@/lib/providers/contacts/router";
import { RECRUITER_TITLES } from "@/lib/providers/contacts/apollo";
import type { ApplicationContact, ContactRole, JobApplication } from "@/lib/apply/types";

/**
 * After a student applies, finds up to five real people tied to the role and their verified work
 * emails. Order: the person the posting names, recruiters, likely hiring managers, then the team.
 * Every person comes from Apollo or the posting itself. Nobody is invented.
 */

export const MAX_CONTACTS = 5;
/** A couple of extra candidates, so people without a verified email can be swapped out. */
const MAX_CANDIDATES = 7;
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

function relevanceFor(role: ContactRole, person: { title: string }, app: JobApplication) {
  const team = mainDepartment(app.department);
  if (role === "job_poster") return `Named on the ${app.title} posting${person.title ? ` as ${person.title}` : ""}.`;
  if (role === "recruiter") return `Recruits for ${app.company}${team ? `, which may include the ${team} team` : ""}.`;
  if (role === "hiring_manager") return `${person.title} — may lead the team hiring for this role.`;
  return `${person.title} — works in the same kind of role or team.`;
}

function asFound(contact: Contact, role: ContactRole, app: JobApplication): FoundPerson {
  return {
    rank: 0,
    role,
    name: contact.fullName,
    title: contact.title,
    email: null,
    emailSource: null,
    relevance: relevanceFor(role, contact, app),
    linkedinUrl: contact.profileUrl,
    photoUrl: contact.photoUrl ?? null,
  };
}

/** Runs the Apollo searches for one company, strictest first, and returns people by role. */
export async function findPeopleForApplication(userId: string, app: JobApplication): Promise<{ people: FoundPerson[]; domain: string | null; notes: string[] }> {
  const notes: string[] = [];
  let domain = app.companyDomain;
  if (!domain) {
    const resolved = await resolveCompanyDomains(userId, [app.company], 1);
    domain = resolved.domains[0] ?? null;
  }
  const chosen: Array<{ person: FoundPerson; source?: Contact }> = [];
  const seen = new Set<string>();
  const take = (person: FoundPerson, source?: Contact) => {
    const key = person.name.toLowerCase();
    if (seen.has(key) || chosen.length >= MAX_CANDIDATES) return;
    seen.add(key);
    chosen.push({ person, source });
  };

  if (app.postedRecruiter) {
    const match = await apolloMatchByName(userId, app.postedRecruiter.name, domain, app.company);
    take({
      rank: 0,
      role: "job_poster",
      name: app.postedRecruiter.name,
      title: match?.title || app.postedRecruiter.title || "",
      email: match?.email ?? null,
      emailSource: match?.email ? "apollo" : null,
      relevance: relevanceFor("job_poster", { title: match?.title || app.postedRecruiter.title || "" }, app),
      linkedinUrl: match?.linkedinUrl ?? null,
      photoUrl: match?.photoUrl ?? null,
    });
    const listed = app.postedRecruiter.email;
    if (listed && !chosen[0].person.email && (await hunterVerify(userId, listed))) {
      chosen[0].person.email = listed;
      chosen[0].person.emailSource = "job_posting";
    }
  } else {
    notes.push("The posting doesn't name who posted it, so recruiters and the team are shown instead.");
  }

  if (!domain) {
    notes.push(`Couldn't match ${app.company} to a company in Apollo, so no one else could be looked up.`);
    return { people: chosen.map((item) => item.person), domain, notes };
  }

  const team = mainDepartment(app.department);
  const core = coreTitle(app.title);
  const steps: Array<{ role: ContactRole; limit: number; query: Parameters<typeof searchPeopleQuery>[1] }> = [
    { role: "recruiter", limit: 3, query: { q_organization_domains_list: [domain], person_titles: RECRUITER_TITLES } },
    {
      role: "hiring_manager",
      limit: 2,
      query: {
        q_organization_domains_list: [domain],
        person_titles: [team && `${team} manager`, team && `head of ${team}`, team && `${team} director`, core && `${core} manager`].filter(Boolean) as string[],
        person_seniorities: ["manager", "director", "head"],
      },
    },
    { role: "team_member", limit: MAX_CANDIDATES, query: { q_organization_domains_list: [domain], person_titles: [core || app.title] } },
    { role: "team_member", limit: MAX_CANDIDATES, query: { q_organization_domains_list: [domain], person_titles: team ? [team] : [] } },
  ];
  for (const step of steps) {
    if (chosen.length >= MAX_CANDIDATES) break;
    if (!step.query.person_titles?.length) continue;
    const { people } = await searchPeopleQuery(userId, step.query, 1, 10);
    let added = 0;
    for (const contact of people) {
      if (added >= step.limit) break;
      if (!looksLikePerson(contact.firstName, contact.lastName, contact.company)) continue;
      const before = chosen.length;
      take(asFound(contact, step.role, app), contact);
      if (chosen.length > before) added += 1;
    }
  }

  // Verified emails: Apollo first, then Hunter for anyone Apollo couldn't verify.
  const fromApollo = chosen.filter((item) => item.source && !item.person.email).map((item) => item.source!);
  const enriched = await enrichPeopleBatch(fromApollo, userId);
  for (const item of chosen) {
    if (!item.source) continue;
    const result = enriched.get(item.source.id);
    if (!result) continue;
    // Photo, LinkedIn, and full last name are kept even when Apollo couldn't verify the email.
    if (result.patch.lastName) item.person.name = `${item.source.firstName} ${result.patch.lastName}`.trim();
    if (result.patch.photoUrl) item.person.photoUrl = result.patch.photoUrl;
    if (result.patch.profileUrl) item.person.linkedinUrl = result.patch.profileUrl;
    if (!item.person.email && result.email && result.emailStatus === "verified") {
      item.person.email = result.email;
      item.person.emailSource = "apollo";
    }
  }
  // Hunter only for as many people as it takes to reach five verified emails.
  for (const item of chosen) {
    if (chosen.filter((entry) => entry.person.email).length >= MAX_CONTACTS) break;
    if (item.person.email || !hunterReady()) continue;
    const [first, ...rest] = item.person.name.split(" ");
    const email = await hunterFindEmail(userId, first, rest.join(" "), domain).catch(() => null);
    if (email) {
      item.person.email = email;
      item.person.emailSource = "hunter";
    }
  }
  if (!hunterReady()) notes.push("Hunter isn't connected, so only emails Apollo verified are shown.");
  if (!chosen.length) notes.push(`Apollo didn't find anyone at ${app.company} for this role.`);
  // People with a verified email come first; within each group the role order stays (posting, recruiters, managers, team).
  const ranked = [...chosen.filter((item) => item.person.email), ...chosen.filter((item) => !item.person.email)].slice(0, MAX_CONTACTS);
  return { people: ranked.map((item, index) => ({ ...item.person, rank: index + 1 })), domain, notes };
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
