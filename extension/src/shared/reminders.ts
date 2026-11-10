import { nextUp, type NextItem } from "@/lib/apply/next-up";
import { isApplied } from "@/lib/apply/stats";
import type { OpenedEmails, ReminderMarks, Tracker } from "./types";

/**
 * Home's reminders, worked out in the extension from the tracker, in the student's own time. No email is read:
 * follow-ups come from people the student marked as emailed, check-ins from how long a job has been quiet.
 * Snoozed and done ones stay hidden; "Did you send it?" comes an hour after an email link was opened.
 */

export type Reminder = Omit<NextItem, "kind"> & { kind: NextItem["kind"] | "sent" };

/** A follow-up is offered at most this many times per person; then the reminder offers to stop. */
export const MAX_FOLLOW_UPS = 2;
const SENT_ASK_MS = 60 * 60 * 1000;
const DAY = 86_400_000;

function goalCounts(tracker: Tracker, now: Date) {
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const weekStart = new Date(dayStart - ((now.getDay() + 6) % 7) * DAY).getTime();
  const applied = tracker.jobs.filter((job) => isApplied(job.status as never) && !job.fillReport?.notCounted).map((job) => Date.parse(job.submittedAt ?? job.createdAt));
  const weekly = tracker.weeklyGoal ?? 0;
  return { today: applied.filter((at) => at >= dayStart).length, daily: weekly ? Math.ceil(weekly / 5) : 0, week: applied.filter((at) => at >= weekStart).length, weekly };
}

export function reminders(tracker: Tracker, marks: ReminderMarks, opened: OpenedEmails, followUps: Record<string, number>, now = new Date()) {
  const next = nextUp(tracker.jobs as never, { now, goal: goalCounts(tracker, now), shown: 100 });
  const hidden = (key: string) => Boolean(marks[key]?.done || (marks[key]?.until && marks[key].until! > now.getTime()));
  const contact = (id: string) => tracker.jobs.flatMap((job) => job.contacts).find((person) => person.id === id);
  const sent: Reminder[] = Object.entries(opened)
    .filter(([id, item]) => now.getTime() - item.at >= SENT_ASK_MS && (item.followUp || contact(id)?.outreachStatus === "not_contacted"))
    .map(([id, item]) => ({
      key: `sent:${id}:${item.at}`, kind: "sent", applicationId: item.applicationId, contactId: id,
      title: `Did you send your ${item.followUp ? "follow-up" : "email"} to ${item.name}?`, detail: item.company, when: "", action: "Yes, I sent it",
    }));
  // A person followed up with twice already gets "No reply, stop" instead of a third nudge.
  const follow = next.follow_ups.items.map((item): Reminder => (item.kind === "follow_up" && item.contactId && (followUps[item.contactId] ?? 0) >= MAX_FOLLOW_UPS
    ? { ...item, title: `No reply from ${item.title.replace(/^Follow up with /, "")}`, detail: `${item.detail} · followed up ${MAX_FOLLOW_UPS} times`, action: "Stop following up" }
    : item));
  const today = [...sent, ...follow, ...next.applications.items].filter((item) => !hidden(item.key));
  return { goal: next.goals, items: today };
}

/** What the badge and the daily notification count: everything on Home that asks for something, but the goal. */
export function dueCount(items: Reminder[]) {
  return items.filter((item) => item.kind !== "finish").length;
}
