import { id, nowIso } from "@/lib/db/file-store";
import { ServiceError } from "@/lib/errors";
import { applicationProfiles, applications } from "@/lib/apply/store";
import type { ActivityEvent, AppliedHow, MaybeApplied } from "@/lib/apply/types";
export { secondsToApply } from "@/lib/apply/activity-stats";

/**
 * What the student's applying looks like as it happens: each job's events (opened, filled, applied and how
 * that was caught), the jobs nobody could confirm ("Did you apply?"), and applying sessions. Each job keeps
 * its own events, so the web app's Activity view and stats read them straight from the tracker. Events never
 * hold the student's answers: only the site, the time, how many fields, and how it was caught.
 */

const EVENTS_PER_JOB = 20;
const MAYBE_KEPT = 40;
const MAYBE_DAYS = 7;
export const SESSION_IDLE_MS = 15 * 60 * 1000;

export const APPLIED_HOW: AppliedHow[] = ["site_confirmed", "page_said", "button_changed", "board_saved", "linkedin_easy_apply", "you_marked", "added_by_hand"];

/** The site a job is on, as people say it: "Workday", "ZipRecruiter", "Handshake", or the company's own site. */
export function siteOf(url: string) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const named: Array<[RegExp, string]> = [
      [/myworkday(jobs|site)\.com$/, "Workday"], [/greenhouse\.io$/, "Greenhouse"], [/lever\.co$/, "Lever"], [/ashbyhq\.com$/, "Ashby"],
      [/joinhandshake\.com$/, "Handshake"], [/ziprecruiter\.com$/, "ZipRecruiter"], [/linkedin\.com$/, "LinkedIn"], [/indeed\.com$/, "Indeed"],
      [/glassdoor\.com$/, "Glassdoor"], [/wellfound\.com$/, "Wellfound"], [/icims\.com$/, "iCIMS"], [/smartrecruiters\.com$/, "SmartRecruiters"],
      [/workable\.com$/, "Workable"], [/jobvite\.com$/, "Jobvite"], [/taleo\.net$/, "Taleo"], [/dice\.com$/, "Dice"], [/unnepo\.local$/, "Added by you"],
    ];
    return named.find(([pattern]) => pattern.test(host))?.[1] ?? host.split(".").slice(-2, -1)[0]?.replace(/^\w/, (c) => c.toUpperCase()) ?? "";
  } catch {
    return "";
  }
}

/** Adds one event to a job, reading the job fresh so nothing saved meanwhile is lost. */
export async function addActivity(userId: string, applicationId: string, event: Omit<ActivityEvent, "at" | "site"> & { site?: string }) {
  const app = await applications.get(userId, applicationId);
  if (!app) return null;
  const report = app.fillReport ?? { filled: [], failed: [], liveViewUrl: null, screenshotAt: null };
  const list = report.activity ?? [];
  // "Opened" once per job; an applied event once per way it was caught.
  if (event.kind === "opened" && list.some((item) => item.kind === "opened")) return app;
  if (event.kind === "applied" && list.some((item) => item.kind === "applied")) return app;
  const full: ActivityEvent = { ...event, at: nowIso(), site: event.site || siteOf(app.applicationUrl || app.jobUrl) };
  const updated = await applications.update(userId, app.id, { fillReport: { ...report, activity: [...list, full].slice(-EVENTS_PER_JOB) } });
  await touchSession(userId);
  return updated;
}

// "Did you apply?" and sessions live with the student's profile, read fresh right before each save.
async function updateProfile(userId: string, change: (profile: NonNullable<Awaited<ReturnType<typeof applicationProfiles.get>>>) => void) {
  const stored = await applicationProfiles.get(userId);
  if (!stored) return null;
  const next = structuredClone(stored);
  change(next);
  await applicationProfiles.put(userId, next);
  return next;
}

export function liveMaybe(list: MaybeApplied[] | undefined) {
  return (list ?? []).filter((item) => Date.now() - Date.parse(item.at) < MAYBE_DAYS * 86_400_000);
}

export async function addMaybe(userId: string, raw: unknown) {
  const item = (raw ?? {}) as Partial<MaybeApplied>;
  const url = String(item.url ?? "").slice(0, 2000);
  const title = String(item.title ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  const company = String(item.company ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (!/^https:\/\//.test(url) || !title) throw new ServiceError("Couldn't tell which job this was.", "job", 400);
  const entry: MaybeApplied = {
    id: id(), url, title, company, site: siteOf(url), at: nowIso(),
    ...(typeof item.description === "string" && item.description.trim() ? { description: item.description.trim().slice(0, 8000) } : {}),
    ...(typeof item.applicationId === "string" && item.applicationId ? { applicationId: item.applicationId.slice(0, 80) } : {}),
  };
  await updateProfile(userId, (profile) => {
    const kept = liveMaybe(profile.maybeApplied).filter((other) => other.url !== url && !(entry.applicationId && other.applicationId === entry.applicationId));
    profile.maybeApplied = [entry, ...kept].slice(0, MAYBE_KEPT);
  });
  return { maybe: entry };
}

/** Takes jobs off the list: by id, or every one for this job (it was confirmed some other way). */
export async function dropMaybe(userId: string, match: { id?: string; url?: string; applicationId?: string }) {
  let dropped: MaybeApplied | null = null;
  await updateProfile(userId, (profile) => {
    const list = liveMaybe(profile.maybeApplied);
    const keep = list.filter((item) => {
      const hit = (match.id && item.id === match.id) || (match.url && item.url === match.url) || (match.applicationId && item.applicationId === match.applicationId);
      if (hit) dropped ??= item;
      return !hit;
    });
    if (keep.length !== list.length || (profile.maybeApplied?.length ?? 0) !== list.length) profile.maybeApplied = keep;
  });
  return dropped as MaybeApplied | null;
}

/** The session as it stands: still going when something happened in the last 15 minutes. */
export function sessionNow(session: { startedAt: string; lastAt: string } | null | undefined) {
  if (!session) return null;
  const active = Date.now() - Date.parse(session.lastAt) < SESSION_IDLE_MS;
  return { ...session, active };
}

export async function setSession(userId: string, start: boolean) {
  const at = nowIso();
  const profile = await updateProfile(userId, (next) => {
    next.session = start ? { startedAt: at, lastAt: at } : null;
  });
  return { session: sessionNow(profile?.session) };
}

/** Something happened while a session is going: it stays going. An idle session isn't restarted. */
async function touchSession(userId: string) {
  const stored = await applicationProfiles.get(userId);
  const session = sessionNow(stored?.session);
  if (!session?.active) return;
  await updateProfile(userId, (next) => {
    if (next.session) next.session = { ...next.session, lastAt: nowIso() };
  });
}
