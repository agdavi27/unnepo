import { serverConfig } from "@/lib/config";
import { repo, id, nowIso } from "@/lib/db/file-store";
import type { Contact } from "@/lib/db/types";
import { ServiceError } from "@/lib/errors";
import { expandSchools } from "@/lib/schools";
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
  const apolloKey = process.env.APOLLO_API_KEY;
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
      throw new ServiceError("Professional search is temporarily unavailable. No sample profiles were substituted.", "provider_failed", 502);
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
      : "Sample directory. These profiles are illustrative and are not live Apollo results. Emails stay hidden until you unlock a contact.",
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
  if (!response.ok) throw new Error(`Apollo search failed (${response.status})`);
  const body = (await response.json()) as { people?: Array<Record<string, unknown>> };
  return (body.people ?? []).map((person) => mapApolloPerson(person, schools)).filter((person) => person !== null) as Contact[];
}

function mapApolloPerson(raw: Record<string, unknown>, schools: string[]): Contact | null {
  const first = String(raw.first_name ?? "").trim();
  const last = String(raw.last_name ?? raw.last_name_obfuscated ?? "").trim();
  const fullName = `${first} ${last}`.trim();
  const externalId = String(raw.id ?? "");
  if (!fullName || !externalId) return null;
  const organization = (raw.organization ?? {}) as Record<string, unknown>;
  const school = schools[0] ?? null;
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

  const apolloKey = process.env.APOLLO_API_KEY;
  let email = contact.email;
  let phone = contact.phone;
  let emailStatus = contact.emailStatus;
  let phoneStatus = contact.phoneStatus;
  let cost = 0;
  let provider = contact.provider;

  if (apolloKey) {
    const estimate = estimateRequestCost("enrich");
    await assertSpendAllowed(userId, estimate.cents);
    const started = Date.now();
    try {
      const matched = await apolloMatch(apolloKey, contact);
      cost += estimate.cents;
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

  return { ok: true, email, phone, emailStatus, phoneStatus, costCents: cost, estimated: true, provider };
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
  } as const;
}

export function findSampleById(contactId: string) {
  return SAMPLE_CONTACTS.find((contact) => contact.id === contactId) ?? null;
}
