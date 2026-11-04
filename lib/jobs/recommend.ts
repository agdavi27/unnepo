/**
 * Recommended jobs from official public job feeds: company career boards on Greenhouse, Lever,
 * and Ashby, plus Remotive, The Muse, and Adzuna when keys are set. LinkedIn is not scraped.
 * Results stay in memory for a short time and are never written to the app's data record.
 */

import { categoryOf } from "@/lib/jobs/category";

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
  /** Only remote jobs. */
  remoteOnly?: boolean;
  /** Happy to go anywhere in the US: a job elsewhere doesn't lose points. */
  anywhere?: boolean;
  jobType?: "internship" | "full_time" | "either";
  classYear?: string | null;
  needsSponsorship?: boolean;
  /** Skills from the student's resume, matched against each posting's text. */
  skills?: string[];
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
// Internships stay open for months, so a posting from two or three months ago is often still good.
const MAX_AGE_DAYS = 120;
const cache = new Map<string, { at: number; jobs: RecommendedJob[] }>();

export type JobFetcher = (url: string, init?: RequestInit) => Promise<Response>;
let fetcher: JobFetcher = (url, init) => fetch(url, init);

export function setJobFetcherForTests(next: JobFetcher | null) {
  fetcher = next ?? ((url, init) => fetch(url, init));
  cache.clear();
}

/** Words an interest brings to job titles and descriptions. */
export const INTEREST_WORDS: Record<string, string[]> = {
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
const SENIOR_LEVEL = /\b(senior|sr\.?|staff|principal|director|vp|vice president|head of|lead|leader|chief|partner)\b/i;

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

async function theMuse(category: string | undefined, round = 0, jobType: JobPreferences["jobType"] = "either"): Promise<RawJob[]> {
  // Each refresh reads the next pages, wrapping. Internships are read further: their pages have more for students,
  // while entry-level pages are often one employer's store jobs.
  const read = (level: string, count: number) => {
    const first = (round % 4) * count + 1;
    return Array.from({ length: count }, (_, index) => {
      const url = new URL("https://www.themuse.com/api/public/jobs");
      url.searchParams.set("page", String(first + index));
      url.searchParams.set("level", level);
      if (category) url.searchParams.set("category", category);
      return getJson<{ results?: Array<Record<string, unknown>> }>(url.toString());
    });
  };
  const pages = await Promise.all([...(jobType === "full_time" ? [] : read("Internship", 5)), ...(jobType === "internship" ? [] : read("Entry Level", 2))]);
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

async function adzuna(query: string, location: string | null, round = 0): Promise<RawJob[]> {
  if (!process.env.ADZUNA_APP_ID || !process.env.ADZUNA_APP_KEY) return [];
  const url = new URL(`https://api.adzuna.com/v1/api/jobs/us/search/${(round % 3) + 1}`);
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

// Words in a role that don't say what the work is. "Marketing Intern" is about marketing.
const ROLE_FILLER = new Set(["intern", "internship", "interns", "associate", "assistant", "specialist", "coordinator", "manager", "representative", "rep", "junior", "senior", "entry", "level", "new", "grad", "graduate", "program", "summer", "trainee", "apprentice", "co", "op", "coop", "the", "and", "of", "for", "in", "at", "to", "role", "position", "team", "lead"]);
// Words that only count with another: "Data Analyst" isn't a match for any analyst.
const ROLE_SHAPE = new Set(["analyst", "engineer", "developer", "designer", "consultant", "officer", "executive", "advisor", "administrator"]);
const SAME_WORD: Record<string, string> = { financial: "finance", marketer: "marketing", operational: "operations", ecommerce: "commerce", "e-commerce": "commerce", sale: "sales" };
const words = (text: string) => text.toLowerCase().replace(/&/g, " and ").split(/[^a-z0-9+#-]+/).flatMap((word) => word.split(/-(?=[a-z])/).length > 1 && word !== "e-commerce" ? word.split("-") : [word]).filter(Boolean).map((word) => SAME_WORD[word] ?? word);

/** How well a job's title fits a role: "full" has every word that says what the work is, "part" has at least one. */
export function roleFit(title: string, role: string): "full" | "part" | null {
  const inTitle = new Set(words(title));
  const core = words(role).filter((word) => !ROLE_FILLER.has(word));
  if (!core.length) return null;
  if (core.every((word) => inTitle.has(word))) return "full";
  return core.some((word) => !ROLE_SHAPE.has(word) && inTitle.has(word)) ? "part" : null;
}

// Places outside the US. A student who didn't ask for one of these can't use the job.
const ABROAD = /\b(uk|gbr|united kingdom|england|scotland|london|ireland|dublin|germany|berlin|munich|france|paris|spain|madrid|barcelona|portugal|lisbon|italy|milan|rome|netherlands|amsterdam|belgium|brussels|sweden|stockholm|switzerland|zurich|poland|warsaw|czech|prague|romania|austria|vienna|denmark|copenhagen|norway|finland|helsinki|emea|apac|latam|canada|toronto|vancouver|montreal|mexico|brazil|sao paulo|argentina|colombia|chile|india|bangalore|bengaluru|hyderabad|mumbai|delhi|singapore|japan|tokyo|seoul|korea|china|shanghai|beijing|hong kong|taiwan|australia|sydney|melbourne|new zealand|philippines|manila|indonesia|jakarta|malaysia|thailand|vietnam|israel|tel aviv|dubai|uae|south africa|nigeria|kenya|turkey|istanbul|europe)\b/i;
const HOME = /\b(us|usa|u\.s\.|united states|north america|americas)\b/i;
const NO_SPONSORSHIP = /(not|unable to|cannot|can't|won't|will not|does not|do not|don't)\s+(be able to\s+)?(offer|provide|sponsor)[^.]{0,40}(sponsor|visa)|without (the need for )?(current or future )?(visa )?sponsorship|no (visa )?sponsorship/i;
const YEARS_NEEDED = /\b([4-9]|1\d)\+?\s*(-\s*\d+\s*)?years?\b[^.\n]{0,40}\b(experience|exp\b)/i;
const INTERNSHIP = /\b(intern|internship|co-?op|apprentice)\b/i;

/**
 * Scores a posting against the student's profile, as a match from 0 to 99. A job has to fit the work they want:
 * being an internship or being nearby isn't enough on its own. It drops out when it's too senior, stale, the wrong
 * type, somewhere they can't work, or says it won't sponsor a student who needs that.
 */
export function scoreJob(job: RawJob, prefs: JobPreferences, now = Date.now()): RecommendedJob | null {
  if (!job.url || !job.title) return null;
  const age = job.postedAt ? (now - new Date(job.postedAt).getTime()) / 86400000 : null;
  if (age !== null && age > MAX_AGE_DAYS) return null;
  if (SENIOR_LEVEL.test(job.title)) return null;
  const internship = INTERNSHIP.test(job.title);
  if (prefs.jobType === "internship" && !internship) return null;
  if (prefs.jobType === "full_time" && internship) return null;
  // Graduation is too far off for a new-grad job.
  const earlyYears = prefs.classYear === "freshman" || prefs.classYear === "sophomore" || prefs.classYear === "junior";
  if (earlyYears && /\b(new grad|graduate program)\b/i.test(job.title)) return null;
  if (prefs.classYear !== "graduate" && /\b(ph\.?d|master'?s|mba)\b/i.test(job.title)) return null;
  const remote = /remote|anywhere/i.test(job.location);
  if (prefs.remoteOnly && !remote) return null;
  if (!prefs.remoteOk && remote) return null;
  const place = prefs.locations.find((item) => job.location.toLowerCase().includes(item.split(",")[0].trim().toLowerCase()));
  if (!place && !HOME.test(job.location) && (ABROAD.test(job.location) || ABROAD.test(job.title))) return null;
  const title = job.title.toLowerCase();
  const description = job.description.slice(0, 4000);
  const text = `${title} ${description.toLowerCase()}`;
  if (prefs.needsSponsorship && NO_SPONSORSHIP.test(description)) return null;
  const dream = prefs.companies.some((company) => company.toLowerCase() === job.company.toLowerCase());
  if (!dream && !internship && YEARS_NEEDED.test(description)) return null;

  const reasons: string[] = [];
  let score = 0;
  const fits = prefs.roles.map((role) => ({ role, fit: roleFit(job.title, role) }));
  // Asking for "Marketing Intern" isn't asking for "Marketing Manager": right field, wrong level.
  const wantsIntern = (role: string) => INTERNSHIP.test(role);
  const full = fits.find((item) => item.fit === "full" && (internship || !wantsIntern(item.role)));
  const part = fits.find((item) => item.fit === "part") ?? fits.find((item) => item.fit === "full");
  if (full) {
    score += 50;
    reasons.push(`Matches your role: ${full.role}`);
  } else if (part) {
    score += 28;
    reasons.push(`Close to your role: ${part.role}`);
  }
  if (dream) {
    score += 20;
    reasons.push(`At ${job.company}, one of your dream companies`);
  } else if (prefs.suggestedCompanies?.some((company) => company.toLowerCase() === job.company.toLowerCase())) {
    score += 4;
    reasons.push(`At ${job.company}, a brand that fits your interests`);
  }
  const wordsFor = (interest: string) => INTEREST_WORDS[interest] ?? [interest.toLowerCase()];
  const titleInterest = prefs.interests.find((item) => wordsFor(item).some((word) => new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(title)));
  const bodyInterest = titleInterest ?? prefs.interests.find((item) => wordsFor(item).some((word) => text.includes(word)));
  if (titleInterest) score += 12;
  else if (bodyInterest) score += 3;
  if (bodyInterest && (titleInterest || full || part)) reasons.push(`Fits your interest in ${bodyInterest}`);
  const skills = (prefs.skills ?? []).filter((skill) => skill.length > 1 && new RegExp(`(^|[^a-z0-9+#])${skill.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9+#])`).test(text)).slice(0, 3);
  if (skills.length) {
    score += skills.length * 5;
    reasons.push(`Uses your skills: ${skills.join(", ")}`);
  }
  // It has to be the student's kind of work. With no roles to go on, their skills or interests say what that is.
  // A dream company raises a job that fits. It doesn't make an unrelated job fit.
  const fieldFits = Boolean(full || part || titleInterest || skills.length >= 2);
  if (!fieldFits) return null;
  if (place) {
    score += 10;
    reasons.push(`In ${place.split(",")[0]}`);
  } else if (remote && prefs.remoteOk) {
    score += 5;
    reasons.push("Remote");
  } else if (prefs.locations.length && !prefs.anywhere) {
    score -= 12;
  }
  if (STUDENT_LEVEL.test(job.title)) {
    score += 10;
    reasons.push(internship ? "Internship" : "Early-career role");
  } else if (/\bmanagers?\b/i.test(job.title)) {
    score -= 20;
  }
  if (earlyYears && !internship && prefs.jobType !== "full_time") score -= 10;
  // Freshness only breaks ties between postings that already match something.
  if (age !== null) score += Math.max(0, 3 - Math.floor(age / 7));
  if (score < 15) return null;
  return { ...job, reasons, score: Math.min(99, Math.round(score)) };
}

/**
 * `round` counts the student's refreshes: each one searches with the next of their roles and locations, the
 * next pages of the big feeds, and the next suggested brands' career pages, so a refresh finds other openings.
 */
export async function recommendJobs(cacheKey: string, prefs: JobPreferences, { refresh = false, round = 0 } = {}) {
  const hit = cache.get(`${cacheKey}:${round}`);
  if (hit && !refresh && Date.now() - hit.at < CACHE_MS) return { jobs: hit.jobs, cachedAt: new Date(hit.at).toISOString() };
  const pick = <T,>(items: T[]) => (items.length ? items[round % items.length] : undefined);
  const query = pick(prefs.roles) ?? pick(prefs.interests) ?? "internship";
  const location = pick(prefs.locations) ?? null;
  const brands = prefs.suggestedCompanies ?? [];
  const start = brands.length > 8 ? (round * 8) % brands.length : 0;
  const rotated = [...brands.slice(start), ...brands.slice(0, start)];
  const companies = [...new Set([...prefs.companies, ...rotated])].slice(0, 12);
  const fromRound = prefs.roles.length ? round % prefs.roles.length : 0;
  const museCategories = [...new Set([...prefs.roles.slice(fromRound), ...prefs.roles.slice(0, fromRound)].map((role) => categoryOf(role).museCategory).filter(Boolean))].slice(0, 3);
  const settled = await Promise.allSettled([
    ...companies.flatMap((company) => [greenhouse(company), lever(company), ashby(company)]),
    remotive(query),
    // The kinds of work the student wants, up to three at a time, so a list isn't all one role.
    ...(museCategories.length ? museCategories : [undefined]).map((category) => theMuse(category, round, prefs.jobType)),
    adzuna(query, location, round),
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
  cache.set(`${cacheKey}:${round}`, { at: Date.now(), jobs });
  return { jobs, cachedAt: new Date().toISOString() };
}
