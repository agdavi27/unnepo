import { followUpsDue } from "@/lib/apply/follow-ups";
import { isApplied, stageOf } from "@/lib/apply/stats";
import type { ApplicationContact, JobApplication } from "@/lib/apply/types";

/**
 * Home's list of what to do next, most urgent first: replies from companies, emails Unnepo wasn't sure about,
 * follow-ups that are due, applications left unfinished, and recent jobs with nobody looked up yet.
 * No server imports, so the web app runs it.
 */

export type NextKind = "reply" | "review" | "follow_up" | "finish" | "find_people";

export type NextItem = {
  key: string;
  kind: NextKind;
  applicationId?: string;
  contactId?: string;
  title: string;
  detail: string;
  /** The short note on the right of the "Then" list. */
  when: string;
  action: string;
};

type NextApp = Pick<JobApplication, "id" | "company" | "title" | "status" | "createdAt" | "submittedAt" | "fillReport" | "contactsStatus"> & {
  companyMissing?: boolean;
  titleMissing?: boolean;
  contacts?: ApplicationContact[];
};

const DAY = 86_400_000;
const REPLY_DAYS = 14;
const FIND_PEOPLE_DAYS = 14;
const FIND_PEOPLE_MOST = 3;
const FINISH_DAYS = 30;
const GOOD_NEWS = new Set(["assessment", "interviewing", "offer"]);

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

export function nextUp(apps: NextApp[], options: { toReview?: number; read?: ReadonlySet<string>; now?: Date } = {}): NextItem[] {
  const now = options.now ?? new Date();
  const read = options.read ?? new Set<string>();
  const items: NextItem[] = [];
  const role = (app: NextApp) => (app.titleMissing ? "" : app.title);

  const replies = apps.flatMap((app) => {
    const change = [...(app.fillReport?.statusHistory ?? [])].reverse().find((item) => item.source === "email" && GOOD_NEWS.has(item.status));
    if (!change || app.companyMissing || stageOf(app) !== change.status) return [];
    const at = Date.parse(change.at);
    const key = `reply:${app.id}:${change.at}`;
    return now.getTime() - at <= REPLY_DAYS * DAY && !read.has(key) ? [{ app, at, key }] : [];
  }).sort((a, b) => b.at - a.at);
  for (const { app, at, key } of replies) {
    const when = dayWords(at, now);
    items.push({
      key, kind: "reply", applicationId: app.id, title: `${app.company} replied to your application`,
      detail: [role(app), `arrived ${/^[TY]/.test(when) ? when.toLowerCase() : when}`].filter(Boolean).join(" · "), when, action: "Read email",
    });
  }

  const toReview = options.toReview ?? 0;
  if (toReview > 0) {
    items.push({
      key: "review", kind: "review", title: toReview === 1 ? "1 email needs a look" : `${toReview} emails need a look`,
      detail: "Unnepo wasn't sure which job these belong to", when: "To review", action: "Review emails",
    });
  }

  for (const due of followUpsDue(apps, now)) {
    items.push({
      key: `follow:${due.contactId}`, kind: "follow_up", applicationId: due.applicationId, contactId: due.contactId,
      title: `Follow up with ${due.name}`, detail: `${due.company} · emailed ${due.days} business days ago`, when: `${due.days} business days`, action: "Write email",
    });
  }

  const unfinished = apps
    .filter((app) => !isApplied(app.status) && !app.companyMissing && now.getTime() - Date.parse(app.createdAt) <= FINISH_DAYS * DAY)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  for (const app of unfinished) {
    items.push({
      key: `finish:${app.id}`, kind: "finish", applicationId: app.id,
      title: role(app) ? `Finish ${role(app)} at ${app.company}` : `Finish your application at ${app.company}`,
      detail: "In progress", when: "In progress", action: "Finish application",
    });
  }

  const noPeople = apps
    .filter((app) => stageOf(app) === "submitted" && !app.companyMissing && app.contactsStatus === "idle" && !app.contacts?.length)
    .filter((app) => now.getTime() - Date.parse(app.submittedAt ?? app.createdAt) <= FIND_PEOPLE_DAYS * DAY)
    .sort((a, b) => Date.parse(b.submittedAt ?? b.createdAt) - Date.parse(a.submittedAt ?? a.createdAt))
    .slice(0, FIND_PEOPLE_MOST);
  for (const app of noPeople) {
    items.push({
      key: `people:${app.id}`, kind: "find_people", applicationId: app.id, title: `Find people at ${app.company}`,
      detail: role(app) || "Someone to reach out to", when: "No one yet", action: "Find people",
    });
  }
  return items;
}
