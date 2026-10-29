import type { ApplicationContact, ApplicationOutcome, ApplicationStatus, Ats, JobApplication } from "@/lib/apply/types";

/** What the Applied tracker and Stats page show for one application. */
export type Stage = "in_progress" | "submitted" | ApplicationOutcome;

type Item = Pick<JobApplication, "status" | "ats" | "createdAt" | "submittedAt" | "fillReport"> & { contacts?: Array<Pick<ApplicationContact, "outreachStatus">> };

export const isApplied = (status: ApplicationStatus) => status === "submitted" || status === "applied_manual";

export function stageOf(app: Pick<JobApplication, "status" | "fillReport">): Stage {
  if (!isApplied(app.status)) return "in_progress";
  return app.fillReport?.outcome ?? "submitted";
}

/** The day an application counts for: when it was submitted, else when it was added. */
export const appliedOn = (app: Pick<JobApplication, "createdAt" | "submittedAt">) => new Date(app.submittedAt ?? app.createdAt);

/** A local calendar day as YYYY-MM-DD. */
export function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Monday 00:00 of the week `now` is in, local time. */
export function weekStart(now: Date) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}

export function applicationStats(items: Item[], now = new Date(), days = 14) {
  const applied = items.filter((app) => isApplied(app.status));
  const stages = applied.map(stageOf);
  const interviewing = stages.filter((stage) => stage === "interviewing").length;
  const offers = stages.filter((stage) => stage === "offer").length;
  const rejected = stages.filter((stage) => stage === "rejected").length;
  const responses = interviewing + offers + rejected;

  const perDayCount = new Map<string, number>();
  for (const app of applied) perDayCount.set(dayKey(appliedOn(app)), (perDayCount.get(dayKey(appliedOn(app))) ?? 0) + 1);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const perDay = Array.from({ length: days }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (days - 1 - index));
    return { date: dayKey(date), count: perDayCount.get(dayKey(date)) ?? 0 };
  });

  // Days in a row with at least one application, ending today (or yesterday, so the streak survives until tonight).
  let streak = 0;
  const cursor = new Date(today);
  if (!perDayCount.get(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (perDayCount.get(dayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  // From opening the job to submitting it. Longer than six hours means the student came back later, so it's left out.
  const minutes = applied
    .filter((app) => app.submittedAt)
    .map((app) => (Date.parse(app.submittedAt!) - Date.parse(app.createdAt)) / 60_000)
    .filter((value) => value > 0 && value < 360)
    .sort((a, b) => a - b);
  const medianMinutes = minutes.length ? (minutes.length % 2 ? minutes[(minutes.length - 1) / 2] : (minutes[minutes.length / 2 - 1] + minutes[minutes.length / 2]) / 2) : null;

  const systems = new Map<Ats, number>();
  for (const app of applied) systems.set(app.ats, (systems.get(app.ats) ?? 0) + 1);

  return {
    applied: applied.length,
    inProgress: items.length - applied.length,
    thisWeek: applied.filter((app) => appliedOn(app) >= weekStart(now)).length,
    /** Days left in this week, today included. */
    daysLeft: 7 - Math.round((today.getTime() - weekStart(now).getTime()) / 86_400_000),
    responses,
    responseRate: applied.length ? responses / applied.length : 0,
    interviews: interviewing + offers,
    offers,
    rejected,
    peopleReached: applied.reduce((sum, app) => sum + (app.contacts ?? []).filter((contact) => contact.outreachStatus !== "not_contacted").length, 0),
    medianMinutes,
    streak,
    perDay,
    bySystem: [...systems.entries()].map(([ats, count]) => ({ ats, count })).sort((a, b) => b.count - a.count),
  };
}
