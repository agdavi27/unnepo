import { followUpsDue } from "@/lib/apply/follow-ups";
import { isApplied, stageOf } from "@/lib/apply/stats";
import type { ApplicationContact, JobApplication } from "@/lib/apply/types";

/**
 * The extension's reminders on Home, in three sections:
 * - goals: how many more to apply to for today's (and this week's) goal;
 * - follow_ups: jobs the student marked Follow up, and people whose follow-up email is due;
 * - applications: applications left unfinished, and applied ones quiet long enough to ask how they went.
 * No server imports, so the extension bundles it and works it out in the student's own time.
 */

export type NextKind = "goal" | "reply" | "follow_up" | "finish" | "update";
export type NextSection = "goals" | "follow_ups" | "applications";

export type NextItem = {
  key: string;
  kind: NextKind;
  applicationId?: string;
  contactId?: string;
  title: string;
  detail: string;
  /** The short note on the right of the row. */
  when: string;
  action: string;
};

type NextApp = Pick<JobApplication, "id" | "company" | "title" | "status" | "createdAt" | "submittedAt" | "fillReport" | "contactsStatus"> & {
  companyMissing?: boolean;
  titleMissing?: boolean;
  contacts?: ApplicationContact[];
};

const DAY = 86_400_000;
const FINISH_DAYS = 30;
/** Applied this long ago with nothing heard: time to say how it went. */
const UPDATE_DAYS = 14;
const SHOWN = 5;

function daysAgo(at: number, now: Date) {
  const start = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return Math.round((start(now) - start(new Date(at))) / DAY);
}

function dayWords(at: number, now: Date) {
  const days = daysAgo(at, now);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export type NextUp = {
  goals: { today: number; daily: number; week: number; weekly: number; items: NextItem[] };
  follow_ups: { replied: number; count: number; items: NextItem[] };
  applications: { count: number; items: NextItem[] };
};

export function nextUp(apps: NextApp[], options: { now?: Date; goal?: { today: number; daily: number; week?: number; weekly?: number }; shown?: number } = {}): NextUp {
  const shown = options.shown ?? SHOWN;
  const now = options.now ?? new Date();
  const role = (app: NextApp) => (app.titleMissing ? "" : app.title);
  const named = apps.filter((app) => !app.companyMissing);

  // Reach your goals.
  const goal = { today: options.goal?.today ?? 0, daily: options.goal?.daily ?? 0, week: options.goal?.week ?? 0, weekly: options.goal?.weekly ?? 0 };
  const goalItems: NextItem[] = [];
  const leftToday = Math.max(0, goal.daily - goal.today);
  const leftWeek = Math.max(0, goal.weekly - goal.week);
  if (leftToday > 0 || leftWeek > 0) {
    const left = leftToday || leftWeek;
    goalItems.push({
      key: `goal:${goal.today}:${goal.week}`, kind: "goal",
      title: `Apply to ${left} more ${left === 1 ? "job" : "jobs"}${leftToday ? " today" : " this week"}`,
      detail: [goal.daily ? `${goal.today} of ${goal.daily} today` : "", goal.weekly ? `${goal.week} of ${goal.weekly} this week` : ""].filter(Boolean).join(" · "),
      when: `${left} to go`, action: "Find a job",
    });
  }

  // Follow ups: jobs marked Follow up, newest first, then people to nudge.
  const replied = named
    .filter((app) => stageOf(app) === "follow_up")
    .map((app) => {
      const change = [...(app.fillReport?.statusHistory ?? [])].reverse().find((item) => item.status !== "applied" && item.status !== "incomplete");
      return { app, at: Date.parse(change?.at ?? app.fillReport?.lastEmailAt ?? app.submittedAt ?? app.createdAt), summary: change?.summary ?? "" };
    })
    .sort((a, b) => b.at - a.at);
  const followItems: NextItem[] = replied.map(({ app, at, summary }) => ({
    key: `reply:${app.id}`, kind: "reply", applicationId: app.id,
    title: `Follow up with ${app.company}`,
    detail: [role(app), summary].filter(Boolean).join(" · "), when: dayWords(at, now), action: "Open job",
  }));
  for (const due of followUpsDue(named, now)) {
    followItems.push({
      key: `follow:${due.contactId}`, kind: "follow_up", applicationId: due.applicationId, contactId: due.contactId,
      title: `Follow up with ${due.name}`, detail: `${due.company} · emailed ${due.days} business days ago`, when: `${due.days} business days`, action: "Write follow-up",
    });
  }

  // Applications: unfinished ones first, then applied ones quiet for two weeks.
  const appItems: NextItem[] = named
    .filter((app) => !isApplied(app.status) && now.getTime() - Date.parse(app.createdAt) <= FINISH_DAYS * DAY)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .map((app) => ({
      key: `finish:${app.id}`, kind: "finish" as const, applicationId: app.id,
      title: role(app) ? `Finish ${role(app)} at ${app.company}` : `Finish your application at ${app.company}`,
      detail: "Started, not submitted", when: "In progress", action: "Finish application",
    }));
  const dueIds = new Set(followItems.map((item) => item.applicationId));
  for (const app of named
    .filter((app) => ["submitted", "no_response"].includes(stageOf(app, now.getTime())) && !dueIds.has(app.id))
    .filter((app) => now.getTime() - Date.parse(app.fillReport?.lastEmailAt ?? app.submittedAt ?? app.createdAt) >= UPDATE_DAYS * DAY)
    .sort((a, b) => Date.parse(a.submittedAt ?? a.createdAt) - Date.parse(b.submittedAt ?? b.createdAt))) {
    appItems.push({
      key: `update:${app.id}`, kind: "update", applicationId: app.id,
      title: `Heard back from ${app.company}?`, detail: [role(app), `applied ${daysAgo(Date.parse(app.submittedAt ?? app.createdAt), now)} days ago`].filter(Boolean).join(" · "),
      when: "Update status", action: "Update status",
    });
  }

  return {
    goals: { ...goal, items: goalItems },
    follow_ups: { replied: replied.length, count: followItems.length, items: followItems.slice(0, shown) },
    applications: { count: appItems.length, items: appItems.slice(0, shown) },
  };
}
