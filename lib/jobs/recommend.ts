/**
 * Recommended jobs from official public job feeds: company career boards on Greenhouse, Lever,
 * and Ashby, plus Remotive, The Muse, and Adzuna when keys are set. LinkedIn is not scraped.
 * Results stay in memory for a short time and are never written to the app's data record.
 */

export type JobSource = "greenhouse" | "lever" | "ashby" | "remotive" | "themuse" | "adzuna";

export type RecommendedJob = {
  id: string;
  title: string;
  company: string;
  location: string;
  /** ISO date the posting went up, or was last updated when the board only gives that. */
  postedAt: string;
  postedKind: "posted" | "updated";
  url: string;
  source: JobSource;
  description: string;
  reasons: string[];
  score: number;
};

export type JobPreferences = {
  roles: string[];
  companies: string[];
  /** Brands suggested from interests. Their boards are searched, but they aren't dream companies. */
  suggestedCompanies?: string[];
  locations: string[];
  interests: string[];
  remoteOk: boolean;
};

export const SOURCE_LABEL: Record<JobSource, string> = {
  greenhouse: "Company careers page",
  lever: "Company careers page",
  ashby: "Company careers page",
  remotive: "Remotive",
  themuse: "The Muse",
  adzuna: "Adzuna",
};

const CACHE_MS = 20 * 60 * 1000;
const MAX_AGE_DAYS = 60;
const cache = new Map<string, { at: number; jobs: RecommendedJob[] }>();

export type JobFetcher = (url: string, init?: RequestInit) => Promise<Response>;
let fetcher: JobFetcher = (url, init) => fetch(url, init);

export function setJobFetcherForTests(next: JobFetcher | null) {
  fetcher = next ?? ((url, init) => fetch(url, init));
  cache.clear();
}

/** Words an interest brings to job titles and descriptions. */
const INTEREST_WORDS: Record<string, string[]> = {
  Technology: ["software", "engineer", "developer", "data", "product"],
  Marketing: ["marketing", "brand", "growth", "content", "social media"],
  Finance: ["finance", "financial", "analyst", "investment", "accounting"],
  Consulting: ["consultant", "consulting", "strategy"],
  Entrepreneurship: ["startup", "founder", "operations", "business development"],
  Music: ["music", "audio", "artist"],
  Sports: ["sports", "athletic", "athlete"],
  "Outdoor & Adventure": ["outdoor", "apparel", "retail"],
  Fashion: ["fashion", "apparel", "merchandising", "retail"],
  Design: ["design", "designer", "ux", "creative"],
  Healthcare: ["health", "clinical", "medical"],
  Media: ["media", "editorial", "content", "production"],
  Engineering: ["engineer", "engineering", "mechanical", "hardware"],
  "Real Estate": ["real estate", "property"],
  Education: ["education", "teaching", "learning"],
  Nonprofits: ["nonprofit", "program", "community"],
  Government: ["policy", "government", "public"],
  "Food & Beverage": ["food", "beverage", "culinary"],
  Gaming: ["game", "gaming"],
  Sustainability: ["sustainability", "climate", "environmental"],
};

const STUDENT_LEVEL = /\b(intern|internship|new grad|graduate|entry[- ]level|junior|associate|apprentice|co-?op|early career|fellow)\b/i;
const SENIOR_LEVEL = /\b(senior|sr\.?|staff|principal|director|vp|vice president|head of|lead|chief|partner)\b/i;

function slug(company: string) {
  return company.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
}

function plain(html: string) {
  return html
    .replace(/<\s*(br|\/p|\/li|\/h\d)\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

function isoDate(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value > 10_000_000_000 ? value : value * 1000).toISOString();
  if (typeof value === "string" && value) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return null;
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetcher(url, { headers: { Accept: "application/json", "User-Agent": "Unnepo/1.0 (student job recommendations)" }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

type RawJob = Omit<RecommendedJob, "reasons" | "score">;

async function greenhouse(company: string): Promise<RawJob[]> {
  const board = slug(company);
  const body = await getJson<{ jobs?: Array<Record<string, unknown>> }>(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`);
  return (body?.jobs ?? []).map((job) => {
    const first = isoDate(job.first_published);
    return {
      id: `greenhouse:${board}:${job.id}`,
      title: String(job.title ?? "Role"),
      company,
      location: String((job.location as { name?: string } | undefined)?.name ?? ""),
      postedAt: first ?? isoDate(job.updated_at) ?? "",
      postedKind: first ? "posted" : "updated",
      url: String(job.absolute_url ?? ""),
      source: "greenhouse" as const,
      description: plain(String(job.content ?? "")).slice(0, 6000),
    };
  });
}

async function lever(company: string): Promise<RawJob[]> {
  const board = slug(company);
  const rows = await getJson<Array<Record<string, unknown>>>(`https://api.lever.co/v0/postings/${board}?mode=json`);
  return (Array.isArray(rows) ? rows : []).map((job) => ({
    id: `lever:${board}:${job.id}`,
    title: String(job.text ?? "Role"),
    company,
    location: String((job.categories as { location?: string } | undefined)?.location ?? ""),
    postedAt: isoDate(job.createdAt) ?? "",
    postedKind: "posted" as const,
    url: String(job.hostedUrl ?? ""),
    source: "lever" as const,
    description: String(job.descriptionPlain ?? plain(String(job.description ?? ""))).slice(0, 6000),
  }));
}

async function ashby(company: string): Promise<RawJob[]> {
  const board = slug(company);
  const body = await getJson<{ jobs?: Array<Record<string, unknown>> }>(`https://api.ashbyhq.com/posting-api/job-board/${board}`);
  return (body?.jobs ?? []).map((job) => ({
    id: `ashby:${board}:${job.id}`,
    title: String(job.title ?? "Role"),
    company,
    location: String(job.location ?? ""),
    postedAt: isoDate(job.publishedAt) ?? "",
    postedKind: "posted" as const,
    url: String(job.jobUrl ?? job.applyUrl ?? ""),
    source: "ashby" as const,
    description: String(job.descriptionPlain ?? plain(String(job.descriptionHtml ?? ""))).slice(0, 6000),
  }));
}

async function remotive(query: string): Promise<RawJob[]> {
  const body = await getJson<{ jobs?: Array<Record<string, unknown>> }>(`https://remotive.com/api/remote-jobs?search=${encodeURIComponent(query)}&limit=40`);
  return (body?.jobs ?? []).map((job) => ({
    id: `remotive:${job.id}`,
    title: String(job.title ?? "Role"),
    company: String(job.company_name ?? "Company"),
    location: String(job.candidate_required_location ?? "Remote"),
    postedAt: isoDate(job.publication_date) ?? "",
    postedKind: "posted" as const,
    url: String(job.url ?? ""),
    source: "remotive" as const,
    description: plain(String(job.description ?? "")).slice(0, 6000),
  }));
}

async function theMuse(location: string | null): Promise<RawJob[]> {
  const pages = await Promise.all([1, 2, 3].map((page) => {
    const url = new URL("https://www.themuse.com/api/public/jobs");
    url.searchParams.set("page", String(page));
    url.searchParams.append("level", "Internship");
    url.searchParams.append("level", "Entry Level");
    if (location) url.searchParams.set("location", location);
    return getJson<{ results?: Array<Record<string, unknown>> }>(url.toString());
  }));
  return pages.flatMap((body) => body?.results ?? []).map((job) => ({
    id: `themuse:${job.id}`,
    title: String(job.name ?? "Role"),
    company: String((job.company as { name?: string } | undefined)?.name ?? "Company"),
    location: ((job.locations as Array<{ name?: string }> | undefined) ?? []).map((item) => item.name).filter(Boolean).join(" · "),
    postedAt: isoDate(job.publication_date) ?? "",
    postedKind: "posted" as const,
    url: String((job.refs as { landing_page?: string } | undefined)?.landing_page ?? ""),
    source: "themuse" as const,
    description: plain(String(job.contents ?? "")).slice(0, 6000),
  }));
}

async function adzuna(query: string, location: string | null): Promise<RawJob[]> {
  if (!process.env.ADZUNA_APP_ID || !process.env.ADZUNA_APP_KEY) return [];
  const url = new URL("https://api.adzuna.com/v1/api/jobs/us/search/1");
  url.searchParams.set("app_id", process.env.ADZUNA_APP_ID);
  url.searchParams.set("app_key", process.env.ADZUNA_APP_KEY);
  url.searchParams.set("results_per_page", "30");
  url.searchParams.set("what", query);
  if (location) url.searchParams.set("where", location);
  const body = await getJson<{ results?: Array<Record<string, unknown>> }>(url.toString());
  return (body?.results ?? []).map((job) => ({
    id: `adzuna:${job.id}`,
    title: String(job.title ?? "Role"),
    company: String((job.company as { display_name?: string } | undefined)?.display_name ?? "Company"),
    location: String((job.location as { display_name?: string } | undefined)?.display_name ?? ""),
    postedAt: isoDate(job.created) ?? "",
    postedKind: "posted" as const,
    url: String(job.redirect_url ?? ""),
    source: "adzuna" as const,
    description: plain(String(job.description ?? "")).slice(0, 6000),
  }));
}

/** Scores a posting against the student's profile. Senior roles and stale postings drop out. */
export function scoreJob(job: RawJob, prefs: JobPreferences, now = Date.now()): RecommendedJob | null {
  if (!job.url || !job.title) return null;
  const age = job.postedAt ? (now - new Date(job.postedAt).getTime()) / 86400000 : null;
  if (age !== null && age > MAX_AGE_DAYS) return null;
  if (SENIOR_LEVEL.test(job.title)) return null;
  const title = job.title.toLowerCase();
  const text = `${title} ${job.description.slice(0, 2000).toLowerCase()}`;
  const reasons: string[] = [];
  let score = 0;
  const role = prefs.roles.find((item) => item.toLowerCase().split(/\s+/).filter((word) => word.length > 2).every((word) => title.includes(word)));
  if (role) {
    score += 8;
    reasons.push(`Matches your role: ${role}`);
  } else if (prefs.roles.some((item) => item.toLowerCase().split(/\s+/).some((word) => word.length > 3 && title.includes(word)))) {
    score += 3;
  }
  if (prefs.companies.some((company) => company.toLowerCase() === job.company.toLowerCase())) {
    score += 8;
    reasons.push(`At ${job.company}, one of your dream companies`);
  } else if (prefs.suggestedCompanies?.some((company) => company.toLowerCase() === job.company.toLowerCase())) {
    score += 2;
    reasons.push(`At ${job.company}, a brand that fits your interests`);
  }
  const interest = prefs.interests.find((item) => (INTEREST_WORDS[item] ?? [item.toLowerCase()]).some((word) => text.includes(word)));
  if (interest) {
    score += 2;
    reasons.push(`Fits your interest in ${interest}`);
  }
  const place = prefs.locations.find((item) => job.location.toLowerCase().includes(item.split(",")[0].trim().toLowerCase()));
  if (place) {
    score += 3;
    reasons.push(`In ${place.split(",")[0]}`);
  } else if (/remote|anywhere/i.test(job.location) && prefs.remoteOk) {
    score += 1;
    reasons.push("Remote");
  }
  if (STUDENT_LEVEL.test(job.title)) {
    score += 5;
    reasons.push(/intern/i.test(job.title) ? "Internship" : "Early-career role");
  }
  // Freshness only breaks ties between postings that already match something.
  if (score <= 2) return null;
  if (age !== null) score += Math.max(0, 3 - Math.floor(age / 7));
  return { ...job, reasons, score };
}

export async function recommendJobs(cacheKey: string, prefs: JobPreferences, { refresh = false } = {}) {
  const hit = cache.get(cacheKey);
  if (hit && !refresh && Date.now() - hit.at < CACHE_MS) return { jobs: hit.jobs, cachedAt: new Date(hit.at).toISOString() };
  const query = prefs.roles[0] ?? prefs.interests[0] ?? "internship";
  const location = prefs.locations[0] ?? null;
  const companies = [...prefs.companies, ...(prefs.suggestedCompanies ?? [])].slice(0, 12);
  const settled = await Promise.allSettled([
    ...companies.flatMap((company) => [greenhouse(company), lever(company), ashby(company)]),
    remotive(query),
    theMuse(location),
    adzuna(query, location),
  ]);
  const seen = new Set<string>();
  const jobs = settled
    .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
    .map((job) => scoreJob(job, prefs))
    .filter((job): job is RecommendedJob => {
      if (!job) return false;
      const key = `${job.company.toLowerCase()}|${job.title.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.score - a.score || (b.postedAt || "").localeCompare(a.postedAt || ""))
    // At most three openings per company, so one large employer can't fill the page.
    .filter((job, _index, all) => all.filter((other) => other.company === job.company).indexOf(job) < 3)
    .slice(0, 60);
  cache.set(cacheKey, { at: Date.now(), jobs });
  return { jobs, cachedAt: new Date().toISOString() };
}
