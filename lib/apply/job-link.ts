import { nowIso } from "@/lib/db/file-store";
import { ServiceError } from "@/lib/errors";
import { companyFromDescription, extractJob, isJobSiteName } from "@/lib/apply/extract";
import { postingLink } from "@/lib/apply/applied-list";
import { applications } from "@/lib/apply/store";
import { companyMissing, requireApp, summary, titleMissing } from "@/lib/apply/service";
import { cleanCompanyName, notJobTitle } from "@/lib/apply/job-title";
import type { JobApplication } from "@/lib/apply/types";

/**
 * Reading a job's link for its details: the title, company, place and description. Company career sites and job
 * systems (Greenhouse, Lever, Workday…) are read here, on the server. Job boards (Indeed, Handshake, ZipRecruiter,
 * Glassdoor) don't let servers read them, so the extension reads those in the student's own browser and sends
 * back what the page showed. LinkedIn is never read.
 */

export type LinkInfo = { title: string; company: string; location: string; description: string; url: string };

const LINKEDIN = /(^|\.)linkedin\.com$/i;

function hostOf(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/** The job at a link, read on the server. Job boards answer with code "in_browser": the extension reads those. */
export async function readJobLink(raw: unknown): Promise<{ info: LinkInfo }> {
  const url = String((raw as { url?: unknown } | null)?.url ?? "").trim().slice(0, 2000);
  if (!/^https:\/\/\S+\.\S+/i.test(url)) throw new ServiceError("The link should start with https://.", "url", 400);
  if (LINKEDIN.test(hostOf(url))) throw new ServiceError("Unnepo doesn't read LinkedIn. Type the job title and company.", "linkedin", 422);
  try {
    const job = await extractJob(url);
    return { info: { title: job.title, company: isJobSiteName(job.company) ? "" : job.company, location: job.location ?? "", description: job.description.slice(0, 8000), url } };
  } catch (error) {
    if (error instanceof ServiceError && error.code === "job_url_blocked") {
      throw new ServiceError("This job board only shows its jobs in your browser. The Unnepo extension reads it there.", "in_browser", 422);
    }
    throw error;
  }
}

/** What a page or the extension says about a job, kept to plain text of sensible length. */
export function cleanInfo(raw: unknown, url: string): LinkInfo {
  const value = (raw ?? {}) as Record<string, unknown>;
  const text = (key: string, max: number) => String(value[key] ?? "").replace(/[ \t]+/g, " ").trim().slice(0, max);
  return { title: text("title", 200), company: text("company", 200), location: text("location", 200), description: text("description", 8000), url };
}

/**
 * Fills in a saved job from its link: the company when it was saved without one, the title when it was only a
 * stand-in, the place and the description when they're empty. Never replaces what the student typed or a real
 * company. `info` is what the extension read in the browser; without it, the server reads the link itself.
 */
/** A job just saved without its company: named from its description, when the description says. */
export async function nameCompanyFromDescription(userId: string, applicationId: string) {
  const app = await applications.get(userId, applicationId);
  if (!app || !companyMissing(app) || app.description.trim().length < 80) return;
  const company = await companyFromDescription(app.title, app.description);
  if (company && !companyMissing({ company, jobUrl: app.jobUrl })) await applications.update(userId, app.id, { company, companyDomain: null });
}

export async function fillFromLink(userId: string, raw: unknown) {
  const body = (raw ?? {}) as { applicationId?: unknown; info?: unknown };
  const app = await requireApp(userId, body.applicationId);
  const link = postingLink(app) || app.applicationUrl || "";
  if (!link) throw new ServiceError("This job has no link to read. Type the company instead.", "url", 400);
  let info: LinkInfo;
  try {
    info = body.info ? cleanInfo(body.info, link) : (await readJobLink({ url: link })).info;
  } catch (error) {
    // A job board the server can't read: the description saved with the job may still name the company.
    const named = companyMissing(app) && error instanceof ServiceError && error.code === "in_browser" ? await companyFromDescription(app.title, app.description) : "";
    if (!named) throw error;
    info = { title: "", company: named, location: "", description: "", url: link };
  }
  const patch: Partial<JobApplication> = {};
  const changed: string[] = [];
  // The page didn't say who's hiring: the description usually does.
  if (companyMissing(app) && (info.company.length < 2 || companyMissing({ company: info.company, jobUrl: link }))) {
    info.company = await companyFromDescription(info.title || app.title, info.description.length > app.description.length ? info.description : app.description);
  }
  info.company = cleanCompanyName(info.company);
  const goodCompany = info.company.length >= 2 && !companyMissing({ company: info.company, jobUrl: link });
  if (companyMissing(app) && goodCompany) {
    patch.company = info.company;
    patch.companyDomain = null;
    changed.push("company");
  }
  if (info.title.length >= 2 && !notJobTitle(info.title) && titleMissing(app.title)) {
    patch.title = info.title;
    changed.push("title");
  }
  if (info.location && !app.location) {
    patch.location = info.location;
    changed.push("location");
  }
  // Anything beats nothing. Otherwise only a much fuller one, so a good description isn't replaced by a stub.
  if ((!app.description.trim() && info.description.trim()) || info.description.length > app.description.length + 200) {
    patch.description = info.description;
    changed.push("description");
  }
  const report = app.fillReport ?? { filled: [], failed: [], liveViewUrl: null, screenshotAt: null };
  const updated = await applications.update(userId, app.id, { ...patch, fillReport: { ...report, infoReadAt: nowIso() } });
  return { application: summary(updated ?? app), changed, info };
}
