import { id, repo } from "@/lib/db/file-store";
import type { CareerGoals, JobPosting } from "@/lib/db/types";

const SAMPLE_JOBS: JobPosting[] = [
  job("patagonia-marketing-intern", "Marketing Intern", "Patagonia", "New York, NY", 2, "https://www.patagonia.com/jobs/", "Outdoor / Apparel"),
  job("tnf-brand-intern", "Brand Marketing Intern", "The North Face", "Denver, CO", 3, "https://www.thenorthface.com/en-us/about-us/careers", "Outdoor / Apparel"),
  job("rei-campus", "Campus Recruiter Intern", "REI", "Seattle, WA", 4, "https://www.rei.com/jobs", "Outdoor / Apparel"),
  job("yeti-product", "Product Marketing Intern", "YETI", "Austin, TX", 5, "https://www.yeti.com/careers.html", "Outdoor / Apparel"),
  job("lulu-content", "Content & Social Intern", "Lululemon", "Vancouver, BC", 6, "https://careers.lululemon.com/", "Outdoor / Apparel"),
  job("arcteryx-pm", "Product Marketing Coordinator", "Arc'teryx", "New York, NY", 8, "https://arcteryx.com/us/en/explore/careers", "Outdoor / Apparel"),
];

function job(externalId: string, title: string, company: string, location: string, daysAgo: number, url: string, industry: string): JobPosting {
  return {
    id: `sample_job_${externalId}`,
    externalId,
    provider: "sample",
    title,
    company,
    location,
    postedAt: new Date(Date.now() - daysAgo * 86400000).toISOString(),
    url,
    industry,
    dataSource: "sample",
    description: "Sample listing for local development. Confirm the role on the company careers page before applying.",
  };
}

export async function listJobPostings(goals: CareerGoals | null) {
  if (process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY) {
    try {
      const live = await adzuna(goals);
      await repo.upsertJobs(live);
      return { jobs: live, source: "adzuna" as const, notice: null };
    } catch {
      return { jobs: [] as JobPosting[], source: "adzuna" as const, notice: "The jobs provider did not respond. Sample listings were not mixed in." };
    }
  }
  await repo.upsertJobs(SAMPLE_JOBS);
  const jobs = rank(SAMPLE_JOBS, goals);
  return {
    jobs,
    source: "sample" as const,
    notice: "Sample listings for local development. They are not a live feed. Connect Adzuna for current postings, and open the company careers page before you apply.",
  };
}

function rank(jobs: JobPosting[], goals: CareerGoals | null) {
  if (!goals) return jobs;
  return [...jobs].sort((a, b) => score(b, goals) - score(a, goals));
}

function score(job: JobPosting, goals: CareerGoals) {
  let value = 0;
  const blob = `${job.title} ${job.company} ${job.location} ${job.industry ?? ""}`.toLowerCase();
  for (const role of goals.roles) if (role && blob.includes(role.toLowerCase())) value += 3;
  for (const location of goals.locations) if (location && blob.includes(location.toLowerCase())) value += 2;
  for (const industry of goals.industries) if (industry && blob.includes(industry.toLowerCase())) value += 2;
  for (const company of goals.companies) if (company && blob.includes(company.toLowerCase())) value += 2;
  return value;
}

async function adzuna(goals: CareerGoals | null) {
  const what = goals?.roles[0] || "marketing intern";
  const where = goals?.locations[0] || "New York";
  const url = new URL("https://api.adzuna.com/v1/api/jobs/us/search/1");
  url.searchParams.set("app_id", process.env.ADZUNA_APP_ID || "");
  url.searchParams.set("app_key", process.env.ADZUNA_APP_KEY || "");
  url.searchParams.set("results_per_page", "15");
  url.searchParams.set("what", what);
  url.searchParams.set("where", where);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Adzuna ${response.status}`);
  const body = (await response.json()) as { results?: Array<Record<string, unknown>> };
  return (body.results ?? []).map((item) => ({
    id: id(),
    externalId: String(item.id),
    provider: "adzuna" as const,
    title: String(item.title ?? "Role"),
    company: String((item.company as { display_name?: string } | undefined)?.display_name ?? "Company"),
    location: String((item.location as { display_name?: string } | undefined)?.display_name ?? ""),
    postedAt: String(item.created ?? new Date().toISOString()),
    url: String(item.redirect_url ?? ""),
    industry: goals?.industries[0] ?? null,
    dataSource: "provider" as const,
    description: String(item.description ?? "").slice(0, 400),
  }));
}
