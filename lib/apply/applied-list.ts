import { siteOf } from "@/lib/apply/activity-stats";
import { appliedOn, isApplied, stageOf, weekStart } from "@/lib/apply/stats";
import type { ActivityEvent, ApplicationContact, JobApplication } from "@/lib/apply/types";

/**
 * The Applied list's sort and filters: newest first by default, or oldest, recently added, company A–Z, or the
 * jobs most overdue for a follow-up. Filters by the site the job was found on, by when it was applied to, and
 * to jobs nobody has been emailed about yet. No server imports, so the web app runs it.
 */

export type SortBy = "recent" | "oldest" | "added" | "company" | "follow_up";
export type When = "all" | "today" | "week" | "month";

export const SORTS: Array<[SortBy, string]> = [["recent", "Most recent"], ["oldest", "Oldest"], ["added", "Recently added"], ["company", "Company A–Z"], ["follow_up", "Follow up first"]];
export const WHENS: Array<[When, string]> = [["all", "Any time"], ["today", "Today"], ["week", "This week"], ["month", "This month"]];

type ListApp = Pick<JobApplication, "company" | "jobUrl" | "applicationUrl" | "status" | "createdAt" | "submittedAt"> & {
  fillReport?: { postingUrl?: string; activity?: ActivityEvent[] } | null;
  contacts?: Array<Pick<ApplicationContact, "outreachStatus">>;
};

/** The job's posting: the job board page it came from when the student applied somewhere else, else its own link. */
export function postingLink(app: Pick<JobApplication, "jobUrl"> & { fillReport?: { postingUrl?: string } | null }) {
  const link = app.fillReport?.postingUrl || app.jobUrl;
  return /^https:\/\//i.test(link) && !/^https:\/\/unnepo\.local\//i.test(link) ? link : "";
}

/** Where the job was found: the board (Handshake, Indeed) when there was one, else the site it was applied on. */
export function siteFor(app: ListApp) {
  const posting = postingLink(app);
  return (posting ? siteOf(posting) : "") || app.fillReport?.activity?.find((item) => item.kind === "applied")?.site || siteOf(app.applicationUrl || app.jobUrl) || "Added by you";
}

const followedUp = (app: ListApp) => (app.contacts ?? []).some((contact) => contact.outreachStatus !== "not_contacted");

function since(when: When, now: Date) {
  if (when === "today") return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (when === "week") return weekStart(now).getTime();
  if (when === "month") return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  return -Infinity;
}

export function arrange<T extends ListApp>(apps: T[], options: { sort: SortBy; site: string; when: When; notFollowed: boolean; now?: Date }) {
  const from = since(options.when, options.now ?? new Date());
  const list = apps
    .filter((app) => !options.site || siteFor(app) === options.site)
    .filter((app) => appliedOn(app).getTime() >= from)
    .filter((app) => !options.notFollowed || (isApplied(app.status) && !followedUp(app)));
  const byDate = (app: T) => appliedOn(app).getTime();
  const sorts: Record<SortBy, (a: T, b: T) => number> = {
    recent: (a, b) => byDate(b) - byDate(a),
    oldest: (a, b) => byDate(a) - byDate(b),
    added: (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
    company: (a, b) => a.company.localeCompare(b.company, "en", { sensitivity: "base" }) || byDate(b) - byDate(a),
    // Applied and nobody emailed yet, longest waiting first; then the rest, newest first.
    follow_up: (a, b) => {
      const waiting = (app: T) => isApplied(app.status) && !followedUp(app);
      if (waiting(a) !== waiting(b)) return waiting(a) ? -1 : 1;
      return waiting(a) ? byDate(a) - byDate(b) : byDate(b) - byDate(a);
    },
  };
  return [...list].sort(sorts[options.sort]);
}

export type Column = "company" | "role" | "applied" | "stage";

/** Stage order: good news first, then what needs doing, then what's waiting, then what's over. */
const STAGE_ORDER: Record<ReturnType<typeof stageOf>, number> = { offer: 0, interviewing: 1, assessment: 2, in_progress: 3, submitted: 4, no_response: 5, rejected: 6 };
const FOLLOW_UP_DUE = STAGE_ORDER.in_progress;

type SortApp = Pick<JobApplication, "id" | "company" | "title" | "status" | "createdAt" | "submittedAt" | "fillReport"> & { companyMissing?: boolean; titleMissing?: boolean };

/**
 * Sorts by a column title. A job waiting on a follow-up (ids in `followUps`) ranks with those in progress. Blank
 * companies and titles stay last either way, and ties keep the order they came in.
 */
export function sortByColumn<T extends SortApp>(apps: T[], column: Column, ascending: boolean, followUps: ReadonlySet<string> = new Set(), now = Date.now()) {
  const direction = ascending ? 1 : -1;
  const words = (a: string, b: string) => a.localeCompare(b, "en", { sensitivity: "base" });
  const blankLast = (a: string, b: string) => (!a !== !b ? (a ? -1 : 1) : direction * words(a, b));
  const rank = (app: T) => {
    const stage = stageOf(app, now);
    return (stage === "submitted" || stage === "no_response") && followUps.has(app.id) ? FOLLOW_UP_DUE : STAGE_ORDER[stage];
  };
  const compare: Record<Column, (a: T, b: T) => number> = {
    company: (a, b) => blankLast(a.companyMissing ? "" : a.company, b.companyMissing ? "" : b.company),
    role: (a, b) => blankLast(a.titleMissing ? "" : a.title, b.titleMissing ? "" : b.title),
    applied: (a, b) => direction * (appliedOn(a).getTime() - appliedOn(b).getTime()),
    stage: (a, b) => direction * (rank(a) - rank(b)),
  };
  return [...apps].sort(compare[column]);
}

/** The sites in the list, most jobs first, for the site filter. */
export function sitesIn(apps: ListApp[]) {
  const counts = new Map<string, number>();
  for (const app of apps) counts.set(siteFor(app), (counts.get(siteFor(app)) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([site, count]) => ({ site, count }));
}
