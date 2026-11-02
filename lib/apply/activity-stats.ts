import type { ActivityEvent, AppliedHow } from "@/lib/apply/types";

/**
 * The numbers the Activity view shows, worked out from each job's events: today's count, time per application,
 * each site's confirmation rate, and a session's pace. No server imports, so the web app runs it too.
 */

type WithActivity = { id: string; title: string; company: string; status: string; submittedAt: string | null; fillReport?: { activity?: ActivityEvent[] } | null };

export const HOW_LABEL: Record<AppliedHow, string> = {
  site_confirmed: "Site confirmed",
  page_said: "Page said so",
  button_changed: "Button changed to Applied",
  board_saved: "Job board saved it",
  linkedin_easy_apply: "LinkedIn Easy Apply",
  you_marked: "You marked it",
  added_by_hand: "Added by you",
};

/** Caught by Unnepo itself, as opposed to the student saying so. */
export const AUTOMATIC: AppliedHow[] = ["site_confirmed", "page_said", "button_changed", "board_saved", "linkedin_easy_apply"];

/** How long a job took, from the first thing that happened to it until it was applied. Null when unknown. */
export function secondsToApply(app: { fillReport?: { activity?: ActivityEvent[] } | null }) {
  const list = app.fillReport?.activity ?? [];
  const applied = list.find((item) => item.kind === "applied");
  const first = list[0];
  if (!applied || !first || first === applied || !["opened", "filled"].includes(first.kind)) return null;
  const seconds = Math.round((Date.parse(applied.at) - Date.parse(first.at)) / 1000);
  // Longer than two hours isn't one sitting.
  return seconds > 0 && seconds < 2 * 3600 ? seconds : null;
}

export const appliedEvent = (app: WithActivity) => app.fillReport?.activity?.find((item) => item.kind === "applied") ?? null;
const appliedAt = (app: WithActivity) => appliedEvent(app)?.at ?? (app.status === "submitted" || app.status === "applied_manual" ? app.submittedAt : null);

/** "1m 40s", "25s", "4m". */
export function duration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest && minutes < 10 ? `${minutes}m ${rest}s` : `${minutes}m`;
}

const average = (values: number[]) => (values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null);

/** Applied since `from`: how many, average time each, and on how many sites. */
export function appliedSince(apps: WithActivity[], from: number) {
  const done = apps.filter((app) => {
    const at = appliedAt(app);
    return at && Date.parse(at) >= from;
  });
  const sites = new Set(done.map((app) => appliedEvent(app)?.site ?? "").filter(Boolean));
  return { count: done.length, averageSeconds: average(done.map(secondsToApply).filter((value): value is number => value !== null)), sites: sites.size };
}

/** Each site: applications, average time each, and the share Unnepo caught by itself. Busiest first. */
export function bySite(apps: WithActivity[]) {
  const rows = new Map<string, { site: string; count: number; times: number[]; automatic: number }>();
  for (const app of apps) {
    const event = appliedEvent(app);
    if (!event) continue;
    const site = event.site || "Other";
    const row = rows.get(site) ?? { site, count: 0, times: [], automatic: 0 };
    row.count += 1;
    const seconds = secondsToApply(app);
    if (seconds !== null) row.times.push(seconds);
    if (event.how && AUTOMATIC.includes(event.how)) row.automatic += 1;
    rows.set(site, row);
  }
  return [...rows.values()]
    .map((row) => ({ site: row.site, count: row.count, averageSeconds: average(row.times), confirmedShare: Math.round((row.automatic / row.count) * 100) }))
    .sort((a, b) => b.count - a.count);
}

/** Every event, newest first, with its job. */
export function feed<T extends WithActivity>(apps: T[], limit = 60) {
  return apps
    .flatMap((app) => (app.fillReport?.activity ?? []).filter((event) => event.kind !== "opened").map((event) => ({ app, event })))
    .sort((a, b) => b.event.at.localeCompare(a.event.at))
    .slice(0, limit);
}

/** The site a job is on, as people say it: "Workday", "ZipRecruiter", "Handshake", or the company's own site. */
export function siteOf(url: string) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const named: Array<[RegExp, string]> = [
      [/myworkday(jobs|site)\.com$/, "Workday"], [/greenhouse\.io$/, "Greenhouse"], [/lever\.co$/, "Lever"], [/ashbyhq\.com$/, "Ashby"],
      [/joinhandshake\.com$/, "Handshake"], [/ziprecruiter\.com$/, "ZipRecruiter"], [/linkedin\.com$/, "LinkedIn"], [/indeed\.com$/, "Indeed"],
      [/glassdoor\.com$/, "Glassdoor"], [/wellfound\.com$/, "Wellfound"], [/icims\.com$/, "iCIMS"], [/smartrecruiters\.com$/, "SmartRecruiters"],
      [/workable\.com$/, "Workable"], [/jobvite\.com$/, "Jobvite"], [/taleo\.net$/, "Taleo"], [/dice\.com$/, "Dice"], [/simplify\.jobs$/, "Simplify"], [/builtin\.com$/, "Built In"], [/monster\.com$/, "Monster"], [/simplyhired\.com$/, "SimplyHired"], [/unnepo\.local$/, "Added by you"],
    ];
    return named.find(([pattern]) => pattern.test(host))?.[1] ?? host.split(".").slice(-2, -1)[0]?.replace(/^\w/, (c) => c.toUpperCase()) ?? "";
  } catch {
    return "";
  }
}
