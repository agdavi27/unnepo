import { serverConfig } from "@/lib/config";
import { repo, id, nowIso, readApolloKey } from "@/lib/db/file-store";
import type { Contact } from "@/lib/db/types";
import { ServiceError } from "@/lib/errors";
import { expandSchools } from "@/lib/schools";
import { COMPANY_DOMAINS, type ApolloPeopleQuery } from "@/lib/search/apollo-query";
import { contactFetch } from "./http";
import { closestSampleContacts, filterSampleDirectory, SAMPLE_CONTACTS, type SearchFilters } from "./sample-directory";

export type PeopleSearchResult = {
  people: Contact[];
  total: number;
  source: "sample" | "apollo";
  notice: string | null;
  estimated: boolean;
};

export type EnrichResult =
  | {
      ok: true;
      email: string | null;
      phone: string | null;
      emailStatus: Contact["emailStatus"];
      phoneStatus: Contact["phoneStatus"];
      costCents: number;
      estimated: boolean;
      provider: string;
      patch?: Partial<Contact>;
    }
  | { ok: false; reason: string; message: string; costCents: number; estimated: boolean; provider: string };

async function recordUsage(input: {
  userId: string | null;
  provider: string;
  operation: string;
  success: boolean;
  latencyMs: number;
  costCents: number;
  estimated: boolean;
  error?: string | null;
}) {
  await repo.insertUsage({
    id: id(),
    userId: input.userId,
    provider: input.provider,
    operation: input.operation,
    success: input.success,
    latencyMs: input.latencyMs,
    costCents: input.costCents,
    estimated: input.estimated,
    error: input.error ?? null,
    createdAt: nowIso(),
  });
}

class ApolloError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(`Apollo search failed (${status})${detail ? `: ${detail}` : ""}`);
  }
}

/** Turns an Apollo failure into a message the student can act on. */
function apolloSearchMessage(error: unknown) {
  const status = error instanceof ApolloError ? error.status : 0;
  if (status === 401) return "Apollo rejected the API key (401). Check the key under Apollo Settings > Integrations > API.";
  if (status === 403) return "Apollo refused the search (403). People search through the API needs a master API key and a plan that includes API access.";
  if (status === 422) return `Apollo could not run this search (422)${error instanceof ApolloError && error.detail ? `: ${error.detail}` : "."}`;
  if (status === 429) return "Apollo's rate limit was reached (429). Try again in a minute.";
  if (status) return `Apollo search failed (${status}).`;
  return "Apollo could not be reached.";
}

export async function spentTodayCents(userId?: string) {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const usage = await repo.listUsage(start.toISOString());
  return usage
    .filter((item) => item.provider !== "sample")
    .filter((item) => (userId ? item.userId === userId : true))
    .reduce((sum, item) => sum + item.costCents, 0);
}

export async function assertSpendAllowed(userId: string | null, additionalCents: number) {
  const config = serverConfig();
  const [globalSpend, userSpend] = await Promise.all([spentTodayCents(), userId ? spentTodayCents(userId) : Promise.resolve(0)]);
  if (globalSpend + additionalCents > config.dailyGlobalSpendCents) {
    throw new ServiceError("Daily contact provider budget has been reached. Try again tomorrow.", "spend_limit", 429);
  }
  if (userId && userSpend + additionalCents > config.dailyUserSpendCents) {
    throw new ServiceError("Your daily lookup budget has been reached.", "user_spend_limit", 429);
  }
}

export function estimateRequestCost(operation: "search" | "enrich") {
  const config = serverConfig();
  if (operation === "search") return { cents: config.apolloSearchCostCents, provider: "apollo", estimated: true };
  return { cents: config.apolloEnrichCostCents, provider: "apollo", estimated: true };
}

export async function searchPeople(userId: string, filters: SearchFilters, page: number, pageSize: number): Promise<PeopleSearchResult> {
  const schools = expandSchools(filters.schools, filters.includeSimilarSchools);
  const apolloKey = await readApolloKey();
  if (apolloKey) {
    const estimate = estimateRequestCost("search");
    await assertSpendAllowed(userId, estimate.cents);
    const started = Date.now();
    try {
      const people = await apolloSearch(apolloKey, filters, schools, page, pageSize);
      await recordUsage({
        userId,
        provider: "apollo",
        operation: "search",
        success: true,
        latencyMs: Date.now() - started,
        costCents: estimate.cents,
        estimated: true,
      });
      await repo.upsertContacts(people);
      return { people, total: people.length, source: "apollo", notice: null, estimated: true };
    } catch (error) {
      await recordUsage({
        userId,
        provider: "apollo",
        operation: "search",
        success: false,
        latencyMs: Date.now() - started,
        costCents: 0,
        estimated: true,
        error: error instanceof Error ? error.message : "apollo_failed",
      });
      throw new ServiceError(`${apolloSearchMessage(error)} No credits were used.`, "provider_failed", 502);
    }
  }

  if (!serverConfig().sampleDirectory) {
    return {
      people: [],
      total: 0,
      source: "sample",
      notice: "Add APOLLO_API_KEY to search live professionals. The sample directory is turned off.",
      estimated: true,
    };
  }

  let matched = filterSampleDirectory(filters, schools);
  let relaxed = false;
  if (!matched.length) {
    matched = closestSampleContacts(filters, Math.max(pageSize, 12));
    relaxed = true;
  }
  const start = Math.max(0, (page - 1) * pageSize);
  const people = matched.slice(start, start + pageSize);
  await repo.upsertContacts(people);
  await recordUsage({
    userId,
    provider: "sample",
    operation: "search",
    success: true,
    latencyMs: 1,
    costCents: 0,
    estimated: true,
  });
  return {
    people,
    total: matched.length,
    source: "sample",
    notice: relaxed
      ? "No exact match for those filters. These are the closest people in the sample directory, so you can keep going. They are not live Apollo results."
      : "Sample directory. These profiles are illustrative and are not live Apollo results. The list is saved to your contacts.",
    estimated: true,
  };
}

async function apolloSearch(apiKey: string, filters: SearchFilters, schools: string[], page: number, pageSize: number) {
  const keywords = [filters.companies.join(" "), filters.query].filter(Boolean).join(" ");
  const response = await contactFetch("https://api.apollo.io/api/v1/mixed_people/api_search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify({
      ...(filters.titles.length ? { person_titles: filters.titles } : {}),
      ...(filters.locations.length ? { person_locations: filters.locations } : {}),
      ...(filters.seniorities.length ? { person_seniorities: filters.seniorities.map((item) => item.toLowerCase()) } : {}),
      ...(keywords ? { q_keywords: keywords } : {}),
      page,
      per_page: pageSize,
    }),
  });
  if (!response.ok) throw new ApolloError(response.status, (await response.text().catch(() => "")).slice(0, 300));
  const body = (await response.json()) as { people?: Array<Record<string, unknown>> };
  return (body.people ?? []).map((person) => mapApolloPerson(person)).filter((person) => person !== null) as Contact[];
}

const ORGANIZATION_WORDS = /\b(inc|llc|ltd|corp|corporation|company|startups?|ventures|capital|labs?|studios?|agency|group|team|official|hq|careers|jobs|recruiting|hiring|foundation|association|university|college|club|network|solutions|consulting|partners|marketing|media|news|support|admin|info|store|shop)\b/i;
const GENERIC_INBOXES = new Set(["info", "hello", "hi", "contact", "contactus", "team", "support", "help", "admin", "office", "sales", "marketing", "press", "media", "pr", "hr", "jobs", "careers", "recruiting", "talent", "hiring", "founders", "partners", "partnerships", "billing", "accounts", "events", "general", "inquiries", "enquiries", "mail", "webmaster", "noreply", "no-reply", "donotreply"]);

/** True when an Apollo record reads like one person, not a company page or shared account. */
export function looksLikePerson(first: string, last: string, company: string) {
  const name = `${first} ${last}`.trim();
  if (!/^[\p{L}][\p{L}'.-]*$/u.test(first) || first.length < 2) return false;
  if (!last) return false;
  if (ORGANIZATION_WORDS.test(name)) return false;
  const lowerName = name.toLowerCase();
  const lowerCompany = company.trim().toLowerCase();
  if (lowerCompany && (lowerName === lowerCompany || lowerCompany.startsWith(lowerName) || first.toLowerCase() === lowerCompany)) return false;
  return true;
}

/** A person's own work inbox, not a shared one like info@ or careers@. */
export function isPersonalWorkEmail(email: string) {
  const local = email.split("@")[0]?.toLowerCase().replace(/[^a-z0-9-]/g, "") ?? "";
  return Boolean(local) && !GENERIC_INBOXES.has(local) && !local.startsWith("noreply");
}

function mapApolloPerson(raw: Record<string, unknown>): Contact | null {
  const first = String(raw.first_name ?? "").trim();
  const last = String(raw.last_name || raw.last_name_obfuscated || "").trim();
  const fullName = `${first} ${last}`.trim();
  const externalId = String(raw.id ?? "");
  if (!fullName || !externalId) return null;
  const organization = (raw.organization ?? {}) as Record<string, unknown>;
  if (raw.has_email === false) return null;
  if (!looksLikePerson(first, last, String(organization.name ?? raw.organization_name ?? ""))) return null;
  // People search returns no education, so a school is never assumed for the contact.
  const school = null;
  return {
    id: `apollo_${externalId}`,
    externalId,
    provider: "apollo",
    fullName,
    firstName: first,
    lastName: last,
    title: String(raw.title ?? "Professional"),
    company: String(organization.name ?? raw.organization_name ?? ""),
    companyDomain: organization.primary_domain ? String(organization.primary_domain) : null,
    location: [raw.city, raw.state].filter(Boolean).join(", ") || String(raw.country ?? ""),
    school,
    profileUrl: typeof raw.linkedin_url === "string" ? raw.linkedin_url : null,
    email: null,
    emailStatus: raw.has_email ? "available" : "unknown",
    phone: null,
    phoneStatus: raw.has_direct_phone === "Yes" || raw.has_direct_phone === true ? "available" : "unknown",
    tags: [],
    seniority: raw.seniority ? String(raw.seniority) : null,
    department: Array.isArray(raw.departments) ? String(raw.departments[0] ?? "") : null,
    industry: organization.industry ? String(organization.industry) : null,
    companySize: null,
    interests: [],
    previousRoles: [],
    achievements: [],
    publicPosts: [],
    verifiedMutuals: [],
    shareable: false,
    licenseNote: "Cached for the unlocking user under the connected Apollo account. Not cleared for redistribution.",
    dataSource: "provider",
    fetchedAt: nowIso(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    costCents: serverConfig().apolloSearchCostCents,
    costEstimated: true,
  };
}

export async function enrichPerson(contact: Contact, userId: string): Promise<EnrichResult> {
  if (contact.provider === "sample" || contact.dataSource === "sample") {
    if (!contact.email && !contact.phone) {
      return {
        ok: false,
        reason: "no_contact_method",
        message: "No verified email or business phone is on file. You were not charged.",
        costCents: 0,
        estimated: true,
        provider: "sample",
      };
    }
    return {
      ok: true,
      email: contact.email,
      phone: contact.phone,
      emailStatus: contact.email ? "verified" : "unavailable",
      phoneStatus: contact.phone ? "verified" : "unavailable",
      costCents: 0,
      estimated: true,
      provider: "sample",
    };
  }

  const apolloKey = await readApolloKey();
  let email = contact.email;
  let phone = contact.phone;
  let emailStatus = contact.emailStatus;
  let phoneStatus = contact.phoneStatus;
  let cost = 0;
  let provider = contact.provider;
  let patch: Partial<Contact> = {};

  if (apolloKey) {
    const estimate = estimateRequestCost("enrich");
    await assertSpendAllowed(userId, estimate.cents);
    const started = Date.now();
    try {
      const matched = await apolloMatch(apolloKey, contact);
      cost += estimate.cents;
      patch = matched.patch;
      email = matched.email ?? email;
      phone = matched.phone ?? phone;
      emailStatus = matched.emailStatus;
      phoneStatus = matched.phoneStatus;
      await recordUsage({
        userId,
        provider: "apollo",
        operation: "enrich",
        success: Boolean(email || phone),
        latencyMs: Date.now() - started,
        costCents: estimate.cents,
        estimated: true,
      });
      provider = "apollo";
    } catch (error) {
      await recordUsage({
        userId,
        provider: "apollo",
        operation: "enrich",
        success: false,
        latencyMs: Date.now() - started,
        costCents: 0,
        estimated: true,
        error: error instanceof Error ? error.message : "enrich_failed",
      });
    }
  }

  if (!email && !phone) {
    return {
      ok: false,
      reason: "no_contact_method",
      message: "The lookup finished without a verified email or business phone. You were not charged.",
      costCents: cost,
      estimated: true,
      provider,
    };
  }

  return { ok: true, email, phone, emailStatus, phoneStatus, costCents: cost, estimated: true, provider, patch };
}

async function apolloMatch(apiKey: string, contact: Contact) {
  const response = await contactFetch("https://api.apollo.io/api/v1/people/match", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify({
      id: contact.externalId,
      first_name: contact.firstName,
      last_name: contact.lastName,
      organization_name: contact.company,
      domain: contact.companyDomain,
      reveal_personal_emails: false,
    }),
  });
  if (!response.ok) throw new Error(`Apollo match failed (${response.status})`);
  const body = (await response.json()) as { person?: Record<string, unknown> };
  const person = body.person ?? {};
  const email = typeof person.email === "string" ? person.email : null;
  const phones = Array.isArray(person.phone_numbers) ? person.phone_numbers : [];
  const phone = phones.length && typeof (phones[0] as { sanitized_number?: string }).sanitized_number === "string"
    ? (phones[0] as { sanitized_number: string }).sanitized_number
    : null;
  return {
    email,
    phone,
    emailStatus: email ? (person.email_status === "verified" ? "verified" : "unverified") : "unavailable",
    phoneStatus: phone ? "verified" : "unavailable",
    patch: personPatch(person, contact),
  } as const;
}

const urlOrNull = (value: unknown) => (typeof value === "string" && /^https?:\/\//i.test(value) ? value : null);

/** Fields Apollo's person lookup adds beyond the email: full last name, city, links, and photo. */
function personPatch(person: Record<string, unknown>, contact: Contact): Partial<Contact> {
  const patch: Partial<Contact> = {};
  const last = String(person.last_name ?? "").trim();
  if (last) {
    patch.lastName = last;
    patch.fullName = `${contact.firstName} ${last}`.trim();
  }
  const place = [person.city, person.state].filter(Boolean).join(", ") || String(person.country ?? "");
  if (place) patch.location = place;
  const organization = (person.organization ?? {}) as Record<string, unknown>;
  if (typeof organization.primary_domain === "string") patch.companyDomain = organization.primary_domain;
  const links: Array<[keyof Contact, unknown]> = [
    ["profileUrl", person.linkedin_url],
    ["photoUrl", person.photo_url],
    ["twitterUrl", person.twitter_url],
    ["githubUrl", person.github_url],
    ["facebookUrl", person.facebook_url],
  ];
  for (const [key, value] of links) {
    const url = urlOrNull(value);
    if (url) (patch as Record<string, unknown>)[key] = url;
  }
  return patch;
}

/** Apollo bulk match takes at most 10 people per request. */
const APOLLO_BULK_SIZE = 10;

/**
 * Looks up work emails for people a search just returned. Stops early, without failing the
 * search, when Apollo errors or the daily spend limit is reached.
 */
export async function enrichPeopleBatch(contacts: Contact[], userId: string) {
  const results = new Map<string, { email: string | null; emailStatus: Contact["emailStatus"]; patch: Partial<Contact> }>();
  const apolloKey = await readApolloKey();
  if (!apolloKey) return results;
  const perPerson = estimateRequestCost("enrich").cents;
  const people = contacts.filter((contact) => contact.provider === "apollo" && contact.externalId);
  for (let start = 0; start < people.length; start += APOLLO_BULK_SIZE) {
    const batch = people.slice(start, start + APOLLO_BULK_SIZE);
    const costCents = perPerson * batch.length;
    try {
      await assertSpendAllowed(userId, costCents);
    } catch {
      break;
    }
    const started = Date.now();
    try {
      const response = await contactFetch("https://api.apollo.io/api/v1/people/bulk_match", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apolloKey },
        body: JSON.stringify({
          details: batch.map((contact) => ({
            id: contact.externalId,
            first_name: contact.firstName,
            last_name: contact.lastName,
            organization_name: contact.company,
            domain: contact.companyDomain,
          })),
          reveal_personal_emails: false,
        }),
      });
      if (!response.ok) throw new Error(`Apollo bulk match failed (${response.status})`);
      const body = (await response.json()) as { matches?: Array<Record<string, unknown> | null> };
      const matches = body.matches ?? [];
      batch.forEach((contact, index) => {
        const person = matches.find((item) => item && String(item.id ?? "") === contact.externalId) ?? matches[index] ?? null;
        const email = person && typeof person.email === "string" ? person.email : null;
        const verified = Boolean(email) && person?.email_status === "verified" && isPersonalWorkEmail(email ?? "");
        const patch = person ? personPatch(person, contact) : {};
        results.set(contact.id, { email: verified ? email : null, emailStatus: verified ? "verified" : email ? "unverified" : "unavailable", patch });
      });
      await recordUsage({ userId, provider: "apollo", operation: "enrich", success: true, latencyMs: Date.now() - started, costCents, estimated: true });
    } catch (error) {
      await recordUsage({
        userId,
        provider: "apollo",
        operation: "enrich",
        success: false,
        latencyMs: Date.now() - started,
        costCents: 0,
        estimated: true,
        error: error instanceof Error ? error.message : "bulk_enrich_failed",
      });
      break;
    }
  }
  return results;
}

/** Turns company names into Apollo domains: known list, then cache, then one Apollo company search per new name. */
export async function resolveCompanyDomains(userId: string, names: string[], maxLookups = 6) {
  const domains = new Set<string>();
  const unresolved: string[] = [];
  const unique = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  const cached = await repo.getCompanyDomains(unique);
  const apolloKey = await readApolloKey();
  let lookups = 0;
  for (const name of unique) {
    const key = name.toLowerCase();
    const known = COMPANY_DOMAINS[key] ?? cached[key];
    if (known) {
      known.forEach((domain) => domains.add(domain));
      continue;
    }
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(name)) {
      domains.add(name.toLowerCase().replace(/^www\./, ""));
      continue;
    }
    if (!apolloKey || lookups >= maxLookups) {
      unresolved.push(name);
      continue;
    }
    lookups += 1;
    const estimate = estimateRequestCost("enrich");
    const started = Date.now();
    try {
      await assertSpendAllowed(userId, estimate.cents);
      const response = await contactFetch("https://api.apollo.io/api/v1/mixed_companies/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apolloKey },
        body: JSON.stringify({ q_organization_name: name, page: 1, per_page: 1 }),
      });
      if (!response.ok) throw new ApolloError(response.status, (await response.text().catch(() => "")).slice(0, 200));
      const body = (await response.json()) as { organizations?: Array<Record<string, unknown>> };
      const domain = String(body.organizations?.[0]?.primary_domain ?? "").trim().toLowerCase();
      await recordUsage({ userId, provider: "apollo", operation: "company_lookup", success: Boolean(domain), latencyMs: Date.now() - started, costCents: estimate.cents, estimated: true });
      if (domain) {
        domains.add(domain);
        await repo.setCompanyDomains(name, [domain]);
      } else {
        unresolved.push(name);
      }
    } catch (error) {
      await recordUsage({
        userId, provider: "apollo", operation: "company_lookup", success: false, latencyMs: Date.now() - started, costCents: 0, estimated: true,
        error: error instanceof Error ? error.message : "company_lookup_failed",
      });
      unresolved.push(name);
    }
  }
  return { domains: [...domains], unresolved };
}

/** One page of Apollo People API Search. It costs no Apollo credits. */
export async function searchPeopleQuery(userId: string, query: ApolloPeopleQuery, page: number, perPage: number) {
  const apolloKey = await readApolloKey();
  if (!apolloKey) throw new ServiceError("Live people search is not available right now. No credits were used.", "provider_missing", 503);
  const started = Date.now();
  try {
    const response = await contactFetch("https://api.apollo.io/api/v1/mixed_people/api_search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apolloKey },
      // Only people Apollo already holds a verified email for.
      body: JSON.stringify({ ...query, contact_email_status: ["verified"], ...(query.person_titles?.length ? { include_similar_titles: true } : {}), page, per_page: perPage }),
    });
    if (!response.ok) throw new ApolloError(response.status, (await response.text().catch(() => "")).slice(0, 300));
    const body = (await response.json()) as { people?: Array<Record<string, unknown>>; total_entries?: number };
    const people = (body.people ?? []).map((person) => mapApolloPerson(person)).filter((person) => person !== null) as Contact[];
    await recordUsage({ userId, provider: "apollo", operation: "search", success: true, latencyMs: Date.now() - started, costCents: 0, estimated: true });
    await repo.upsertContacts(people);
    return { people, total: Number(body.total_entries ?? people.length) };
  } catch (error) {
    await recordUsage({
      userId, provider: "apollo", operation: "search", success: false, latencyMs: Date.now() - started, costCents: 0, estimated: true,
      error: error instanceof Error ? error.message : "apollo_failed",
    });
    throw new ServiceError(`${apolloSearchMessage(error)} No credits were used.`, "provider_failed", 502);
  }
}

export function findSampleById(contactId: string) {
  return SAMPLE_CONTACTS.find((contact) => contact.id === contactId) ?? null;
}
