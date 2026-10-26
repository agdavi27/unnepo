import { createHash } from "node:crypto";
import { COMPANIES, INDUSTRIES, JOB_TITLES, LOCATIONS } from "@/lib/catalog";
import type { CareerGoals } from "@/lib/db/types";

export type SearchFilters = {
  titles: string[];
  industries: string[];
  locations: string[];
  schools: string[];
  includeSimilarSchools: boolean;
  companies: string[];
  seniorities: string[];
  departments: string[];
  companySizes: string[];
  query?: string;
};

export function emptyFilters(): SearchFilters {
  return {
    titles: [],
    industries: [],
    locations: [],
    schools: [],
    includeSimilarSchools: false,
    companies: [],
    seniorities: [],
    departments: [],
    companySizes: [],
  };
}

/** Same filters charge once. A different search gets a new key. */
export function searchChargeKey(userId: string, page: number, filters: SearchFilters) {
  const body = JSON.stringify({
    titles: [...filters.titles].map(norm).sort(),
    industries: [...filters.industries].map(norm).sort(),
    locations: [...filters.locations].map(norm).sort(),
    schools: [...filters.schools].map(norm).sort(),
    companies: [...filters.companies].map(norm).sort(),
    seniorities: [...filters.seniorities].map(norm).sort(),
    departments: [...filters.departments].map(norm).sort(),
    companySizes: [...filters.companySizes].map(norm).sort(),
    query: norm(filters.query || ""),
    similar: filters.includeSimilarSchools,
    page,
  });
  return `search:${userId}:${createHash("sha256").update(body).digest("hex").slice(0, 24)}`;
}

export function filtersFromProfile(goals: CareerGoals | null, school: string | null, note: string) {
  const filters = emptyFilters();
  filters.titles = unique(goals?.roles ?? []).slice(0, 5);
  filters.industries = unique(goals?.industries ?? []).slice(0, 5);
  filters.locations = unique((goals?.locations ?? []).filter((place) => !/^remote$/i.test(place))).slice(0, 5);
  filters.companies = unique(goals?.companies ?? []).slice(0, 5);
  if (school && (goals?.contactTypes ?? []).some((item) => /alumni/i.test(item))) {
    filters.schools = [school];
    filters.includeSimilarSchools = false;
  }
  const extra = interpretPrompt(note);
  filters.titles = unique([...filters.titles, ...extra.filters.titles]).slice(0, 6);
  filters.companies = unique([...filters.companies, ...extra.filters.companies]).slice(0, 6);
  filters.locations = unique([...filters.locations, ...extra.filters.locations]).slice(0, 6);
  filters.industries = unique([...filters.industries, ...extra.filters.industries]).slice(0, 6);
  return {
    filters,
    unsupported: extra.unsupported,
    note: filters.schools.length
      ? "Alumni is limited to the school on your profile. Apollo has to return that education on the person. Unnepo will not guess a college."
      : null,
  };
}

/**
 * Turns a sentence into Apollo-shaped filters using the catalogs we already search.
 * It does not call a model and it does not invent employers.
 */
export function interpretPrompt(prompt: string) {
  const text = prompt.trim();
  const filters = emptyFilters();
  const unsupported: string[] = [];
  if (!text) return { filters, unsupported, model: "rules" as const };
  const lower = text.toLowerCase();
  filters.titles = JOB_TITLES.filter((title) => lower.includes(title.toLowerCase()));
  filters.industries = INDUSTRIES.filter((industry) => lower.includes(industry.toLowerCase()));
  filters.locations = LOCATIONS.filter((location) => lower.includes(location.split(",")[0].toLowerCase()));
  filters.companies = COMPANIES.filter((company) => lower.includes(company.toLowerCase()));
  if (/\bnescac\b|\balumni\b|\bsame school\b/.test(lower) && filters.schools.length === 0) {
    unsupported.push("A conference or alumni group is not an Apollo filter. Add the school by name if you want that limit.");
  }
  if (/\bfollower|\bposted\b|\blinkedin url\b/.test(lower)) {
    unsupported.push("Posts and follower counts are not search filters.");
  }
  if (!filters.titles.length) {
    const role = text.split(/ at | in | who | with /i)[0]?.trim();
    if (role && role.length > 2 && role.length < 60) filters.titles = [role.replace(/\.$/, "")];
  }
  filters.query = text.slice(0, 180);
  return { filters, unsupported, model: "rules" as const };
}

export function matchReasons(
  person: { title: string; company: string; location: string; school: string | null; industry: string | null },
  goals: CareerGoals | null,
  studentSchool: string | null,
) {
  const reasons: string[] = [];
  const title = person.title.toLowerCase();
  const industry = (person.industry || "").toLowerCase();
  for (const role of goals?.roles ?? []) {
    const token = role.toLowerCase().split(/\s+/).find((word) => word.length > 3);
    if (token && title.includes(token)) {
      reasons.push("Has experience in a role you're looking for.");
      break;
    }
  }
  for (const wanted of goals?.industries ?? []) {
    if (industry && industry.includes(wanted.toLowerCase().slice(0, 12))) {
      reasons.push("Works in an industry you selected.");
      break;
    }
  }
  for (const place of goals?.locations ?? []) {
    if (place && person.location.toLowerCase().includes(place.toLowerCase().slice(0, 12))) {
      reasons.push("Works in a place you listed.");
      break;
    }
  }
  for (const company of goals?.companies ?? []) {
    if (company && person.company.toLowerCase().includes(company.toLowerCase())) {
      reasons.push("Works at a company you listed.");
      break;
    }
  }
  if (studentSchool && person.school && person.school.toLowerCase() === studentSchool.toLowerCase()) {
    reasons.push("Attended the same university.");
  }
  return unique(reasons).slice(0, 3);
}

function unique(values: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const text = value.trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function norm(value: string) {
  return value.trim().toLowerCase();
}
