import { appliedOn, countsTowardGoals, dayKey, weekStart } from "./stats";

/**
 * What a student did, by day: applied, emailed someone, or heard back. Shared by the website's Jobs calendar and
 * the extension's Week calendar, so both light up the same days.
 */

export type ActivityKind = "applied" | "emailed" | "follow_up" | "interview" | "offer" | "rejected";
export type ActivityEvent<J> = { at: Date; day: string; kind: ActivityKind; job: J };

/** The few fields of a tracker job this reads. */
type ActivityJob = {
  status: string;
  fillReport?: {
    emailedAt?: Record<string, string>;
    reachedOut?: { at: string } | null;
    statusHistory?: Array<{ status: string; at: string }>;
  } | null;
};

export const ACTIVITY_MARK: Record<ActivityKind, { glyph: string; color: string; label: string }> = {
  applied: { glyph: "●", color: "#4ADE80", label: "Applied" },
  emailed: { glyph: "✉", color: "#C7D7FF", label: "Emailed someone" },
  follow_up: { glyph: "↺", color: "#F5A524", label: "Follow up" },
  interview: { glyph: "★", color: "#4ADE80", label: "Interview" },
  offer: { glyph: "◆", color: "#E6C15A", label: "Offer" },
  rejected: { glyph: "✕", color: "#F87171", label: "Said no" },
};

/** Empty, then four greens, brighter for a busier day. */
export const ACTIVITY_HEAT = ["#17171B", "#173A24", "#22603A", "#2F9A55", "#4ADE80"];

const HISTORY_KIND: Record<string, ActivityKind | undefined> = { follow_up: "follow_up", assessment: "interview", interviewing: "interview", offer: "offer", rejected: "rejected" };
const isApplied = (job: ActivityJob) => job.status === "submitted" || job.status === "applied_manual";

/** Everything that happened on a job, one per kind per day, oldest first. */
export function activityOf<J extends ActivityJob>(job: J): Array<ActivityEvent<J>> {
  const list: Array<{ at: Date; kind: ActivityKind }> = [];
  const report = job.fillReport;
  if (isApplied(job) && countsTowardGoals(job as never)) list.push({ at: appliedOn(job as never), kind: "applied" });
  for (const at of Object.values(report?.emailedAt ?? {})) list.push({ at: new Date(at), kind: "emailed" });
  if (report?.reachedOut?.at) list.push({ at: new Date(report.reachedOut.at), kind: "emailed" });
  for (const change of report?.statusHistory ?? []) {
    const kind = HISTORY_KIND[change.status];
    if (kind) list.push({ at: new Date(change.at), kind });
  }
  const seen = new Set<string>();
  return list
    .filter((event) => !Number.isNaN(event.at.getTime()))
    .map((event) => ({ ...event, day: dayKey(event.at), job }))
    .filter((event) => { const key = `${event.day}:${event.kind}`; if (seen.has(key)) return false; seen.add(key); return true; })
    .sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** Every job's events, by day. */
export function activityByDay<J extends ActivityJob>(jobs: J[]) {
  const map = new Map<string, Array<ActivityEvent<J>>>();
  for (const job of jobs) for (const event of activityOf(job)) map.set(event.day, [...(map.get(event.day) ?? []), event]);
  return map;
}

/** The calendar: `weeks` columns of Monday to Sunday, ending with this week. */
export function activityGrid(now: Date, weeks: number) {
  const first = weekStart(now);
  first.setDate(first.getDate() - (weeks - 1) * 7);
  return Array.from({ length: weeks }, (_, week) => Array.from({ length: 7 }, (_, weekday) => {
    const date = new Date(first);
    date.setDate(first.getDate() + week * 7 + weekday);
    return date;
  }));
}

/** The longest run of days in a row with something done, inside the grid. */
export function longestRun(grid: Date[][], byDay: Map<string, unknown>, now: Date) {
  let best = { length: 0, end: null as Date | null };
  let run = 0;
  for (const date of grid.flat()) {
    if (date > now) break;
    run = byDay.has(dayKey(date)) ? run + 1 : 0;
    if (run > best.length) best = { length: run, end: date };
  }
  return best;
}
