import { id, repo } from "@/lib/db/file-store";
import type { CareerGoals, JobPosting, ResumeFact } from "@/lib/db/types";
import { parseLinkedInGuestHtml } from "@/lib/jobs/linkedin";
import { suggestRoles } from "@/lib/roles";

const GREENHOUSE = ["stripe", "airbnb", "figma", "databricks", "robinhood", "discord", "hubspot", "instacart"];
const LEVER = ["spotify", "palantir"];

type SearchLink = { source: "linkedin" | "ziprecruiter"; label: string; url: string; domain: string };

type CacheEntry = { at: number; payload: Awaited<ReturnType<typeof loadLive>> };
let cache: { key: string; entry: CacheEntry } | null = null;
const CACHE_MS = 10 * 60 * 1000;

const PAGE_SIZE = 12;

export async function listJobPostings(goals: CareerGoals | null, facts: ResumeFact[] = [], page = 1) {
  const queries = searchQueries(goals, facts);
  const where = goals?.locations?.[0] || "United States";
  const key = `${queries.join("|")}|${where}|${(goals?.tracks ?? []).join(",")}`;
  const hit = cache && cache.key === key && Date.now() - cache.entry.at < CACHE_MS ? cache.entry : null;
  const live = hit ? hit.payload : await loadLive(queries, where);
  if (live.jobs.length) cache = { key, entry: { at: hit?.at ?? Date.now(), payload: live } };
  return paginate(live.jobs, queries, where, live.notice, page);
}

function paginate(jobs: JobPosting[], queries: string[], where: string, notice: string | null, page: number) {
  const safe = Math.max(1, page);
  const start = (safe - 1) * PAGE_SIZE;
  return {
    ...finish(jobs.slice(start, start + PAGE_SIZE), queries, where, notice),
    total: jobs.length,
    page: safe,
    pageSize: PAGE_SIZE,
  };
}

function finish(jobs: JobPosting[], queries: string[], where: string, notice: string | null) {
  const query = queries[0] || "internship";
  const searches: SearchLink[] = [
    {
      source: "linkedin",
      label: "LinkedIn",
      domain: "linkedin.com",
      url: `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(query)}&location=${encodeURIComponent(where)}`,
    },
    {
      source: "ziprecruiter",
      label: "ZipRecruiter",
      domain: "ziprecruiter.com",
      url: `https://www.ziprecruiter.com/jobs-search?search=${encodeURIComponent(query)}&location=${encodeURIComponent(where)}`,
    },
  ];
  return { jobs, source: jobs.some((job) => job.provider !== "sample") ? "live" as const : "empty" as const, notice, searches, queries };
}

function searchQueries(goals: CareerGoals | null, facts: ResumeFact[]) {
  const chosen = (goals?.roles ?? []).map((role) => role.trim()).filter(Boolean);
  const suggested = suggestRoles(facts);
  const fromResume = [...suggested.fromResume, ...suggested.similar];
  const base = (chosen.length ? chosen : fromResume).slice(0, 3);
  const intern = (goals?.tracks ?? []).some((track) => /intern/i.test(track));
  return base.map((role) => (intern && !/intern/i.test(role) ? `${role} intern` : role));
}

async function loadLive(queries: string[], where: string) {
  const settled = await Promise.allSettled([
    linkedIn(queries[0] || "intern", where, [0, 10, 20, 30, 40, 50]),
    queries[1] ? linkedIn(queries[1], where, [0, 10, 20]) : Promise.resolve([]),
    remotive(queries[0] || "intern"),
    arbeitnow(queries),
    greenhouse(queries),
    lever(queries),
    adzuna(queries[0] || "intern", where),
  ]);
  const jobs = settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  const unique = rankLive(dedupe(jobs), queries, where).slice(0, 120);
  if (!unique.length) {
    return {
      jobs: [] as JobPosting[],
      notice: "No live postings came back for those roles. Open LinkedIn or ZipRecruiter with the buttons above, or add a role on Home.",
    };
  }
  const stored = await repo.upsertJobs(unique);
  return {
    jobs: stored,
    notice: "Live postings from LinkedIn’s public job feed and company career pages. ZipRecruiter blocks automated reads, so that button opens their site for the same search.",
  };
}

function dedupe(jobs: JobPosting[]) {
  const seen = new Set<string>();
  const out: JobPosting[] = [];
  for (const job of jobs) {
    const key = `${job.company.toLowerCase()}|${job.title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(job);
  }
  return out;
}

function rankLive(jobs: JobPosting[], queries: string[], where: string) {
  const needles = tokens(queries.join(" "));
  const city = where.split(",")[0]?.trim().toLowerCase() ?? "";
  return [...jobs].sort((a, b) => relevance(b) - relevance(a) || b.postedAt.localeCompare(a.postedAt));

  function relevance(job: JobPosting) {
    const blob = `${job.title} ${job.location}`.toLowerCase();
    let value = needles.reduce((sum, needle) => sum + (blob.includes(needle) ? 5 : 0), 0);
    if (city && city !== "united states" && blob.includes(city)) value += 4;
    if (job.provider === "linkedin") value += 2;
    if (job.provider === "greenhouse" || job.provider === "lever") value += 1;
    return value;
  }
}

async function linkedIn(query: string, where: string, starts: number[]) {
  const pages = await Promise.allSettled(starts.map((start) => linkedInPage(query, where, start)));
  return pages.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
}

async function linkedInPage(query: string, where: string, start: number) {
  const url = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${encodeURIComponent(query)}&location=${encodeURIComponent(where)}&start=${start}`;
  const html = await getText(url);
  return parseLinkedInGuestHtml(html).map((job) => posting({
    externalId: job.externalId,
    provider: "linkedin",
    title: job.title,
    company: job.company,
    location: job.location,
    postedAt: job.postedAt,
    url: job.url,
    description: `Live LinkedIn posting for ${query}.`,
    logoUrl: job.logoUrl,
  }));
}

async function remotive(query: string) {
  const url = `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(query)}`;
  const body = await getJson<{ jobs?: Array<Record<string, unknown>> }>(url);
  return (body.jobs ?? []).slice(0, 15).map((item) => posting({
    externalId: String(item.id),
    provider: "remotive",
    title: String(item.title ?? "Role"),
    company: String(item.company_name ?? "Company"),
    location: String(item.candidate_required_location ?? "Remote"),
    postedAt: String(item.publication_date ?? new Date().toISOString()),
    url: String(item.url ?? ""),
    description: strip(String(item.description ?? "")).slice(0, 280),
    logoUrl: item.company_logo ? String(item.company_logo) : null,
  })).filter((job) => job.url);
}

async function arbeitnow(queries: string[]) {
  const body = await getJson<{ data?: Array<Record<string, unknown>> }>("https://www.arbeitnow.com/api/job-board-api");
  const needles = tokens(queries.join(" "));
  return (body.data ?? []).filter((item) => {
    const blob = `${item.title ?? ""} ${item.company_name ?? ""}`.toLowerCase();
    return needles.some((needle) => blob.includes(needle));
  }).slice(0, 12).map((item) => posting({
    externalId: String(item.slug ?? item.title),
    provider: "arbeitnow",
    title: String(item.title ?? "Role"),
    company: String(item.company_name ?? "Company"),
    location: String(item.location ?? "Remote"),
    postedAt: posted(item.created_at),
    url: String(item.url ?? ""),
    description: strip(String(item.description ?? "")).slice(0, 280),
    logoUrl: null,
  })).filter((job) => job.url);
}

async function greenhouse(queries: string[]) {
  const needles = tokens(queries.join(" "));
  const boards = await Promise.allSettled(GREENHOUSE.map(async (board) => {
    const body = await getJson<{ jobs?: Array<Record<string, unknown>> }>(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs`);
    return (body.jobs ?? []).filter((job) => needles.some((needle) => String(job.title ?? "").toLowerCase().includes(needle))).slice(0, 8).map((job) => posting({
      externalId: `${board}-${job.id}`,
      provider: "greenhouse",
      title: String(job.title ?? "Role"),
      company: boardName(board),
      location: String((job.location as { name?: string } | undefined)?.name ?? ""),
      postedAt: String(job.updated_at ?? new Date().toISOString()),
      url: String(job.absolute_url ?? ""),
      description: `From the ${titleCase(board)} careers page.`,
      logoUrl: null,
    }));
  }));
  return boards.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
}

async function lever(queries: string[]) {
  const needles = tokens(queries.join(" "));
  const boards = await Promise.allSettled(LEVER.map(async (board) => {
    const rows = await getJson<Array<Record<string, unknown>>>(`https://api.lever.co/v0/postings/${board}?mode=json`);
    return (Array.isArray(rows) ? rows : []).filter((job) => needles.some((needle) => String(job.text ?? "").toLowerCase().includes(needle))).slice(0, 8).map((job) => posting({
      externalId: `${board}-${job.id}`,
      provider: "lever",
      title: String(job.text ?? "Role"),
      company: boardName(board),
      location: String((job.categories as { location?: string } | undefined)?.location ?? ""),
      postedAt: job.createdAt ? new Date(Number(job.createdAt)).toISOString() : new Date().toISOString(),
      url: String(job.hostedUrl ?? ""),
      description: strip(String(job.descriptionPlain ?? "")).slice(0, 280) || `From the ${titleCase(board)} careers page.`,
      logoUrl: null,
    }));
  }));
  return boards.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
}

async function adzuna(query: string, where: string) {
  if (!process.env.ADZUNA_APP_ID || !process.env.ADZUNA_APP_KEY) return [];
  const url = new URL("https://api.adzuna.com/v1/api/jobs/us/search/1");
  url.searchParams.set("app_id", process.env.ADZUNA_APP_ID);
  url.searchParams.set("app_key", process.env.ADZUNA_APP_KEY);
  url.searchParams.set("results_per_page", "10");
  url.searchParams.set("what", query);
  url.searchParams.set("where", where);
  const body = await getJson<{ results?: Array<Record<string, unknown>> }>(url.toString());
  return (body.results ?? []).map((item) => posting({
    externalId: String(item.id),
    provider: "adzuna",
    title: String(item.title ?? "Role"),
    company: String((item.company as { display_name?: string } | undefined)?.display_name ?? "Company"),
    location: String((item.location as { display_name?: string } | undefined)?.display_name ?? ""),
    postedAt: String(item.created ?? new Date().toISOString()),
    url: String(item.redirect_url ?? ""),
    description: strip(String(item.description ?? "")).slice(0, 280),
    logoUrl: null,
  }));
}

function posting(input: Omit<JobPosting, "id" | "industry" | "dataSource">): JobPosting {
  return {
    id: id(),
    industry: null,
    dataSource: "provider",
    ...input,
  };
}

function tokens(value: string) {
  return [...new Set(value.toLowerCase().split(/[^a-z0-9+]+/).filter((word) => word.length > 3 && !["intern", "full", "time", "role"].includes(word)))];
}

function titleCase(value: string) {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

const BOARD_NAMES: Record<string, string> = { airbnb: "Airbnb", hubspot: "HubSpot", instacart: "Instacart" };

function boardName(slug: string) {
  return BOARD_NAMES[slug] || titleCase(slug);
}

function posted(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value > 10_000_000_000 ? value : value * 1000).toISOString();
  }
  if (typeof value === "string" && value) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return new Date().toISOString();
}

function strip(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

async function getText(url: string) {
  const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.text();
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { "User-Agent": "Unnepo/1.0", Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json() as Promise<T>;
}
