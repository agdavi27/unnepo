import { appliedOn, countsTowardGoals, dayKey, weekStart } from "@/lib/apply/stats";
import { escape, isAppliedJob, progressDots, progressOf, redraw, store } from "./tracker-view";
import { friendsWeekCard } from "./friends";
import type { TrackerJob } from "./types";

/**
 * The side panel's Week tab and Jobs tab. Week: seven squares for this week that fill in with each application,
 * the streak, and the jobs applied to on the day picked. Jobs: every job with its progress, searchable and
 * filtered by the step it's on. All of it is worked out here from the tracker, in the student's own time.
 */

const DAY = 86_400_000;
const LETTERS = ["M", "T", "W", "Th", "F", "Sa", "Su"];

/** The day picked under the squares (YYYY-MM-DD); today until another is tapped. */
let pickedDay = "";

/** Applied jobs that count toward goals, by the day they were applied. */
function perDay(jobs: TrackerJob[]) {
  const days = new Map<string, TrackerJob[]>();
  for (const job of jobs) {
    if (!isAppliedJob(job) || !countsTowardGoals(job as never)) continue;
    const key = dayKey(appliedOn(job as never));
    days.set(key, [...(days.get(key) ?? []), job]);
  }
  return days;
}

/** Days in a row with an application, ending today, or yesterday so it lasts until tonight. */
export function streakOf(days: Map<string, unknown[]>, now = new Date()) {
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!days.get(dayKey(cursor))?.length) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (days.get(dayKey(cursor))?.length) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/** Emails marked sent in a time range: each person's sent time, or the student's own count for a job. */
function emailsBetween(jobs: TrackerJob[], from: number, to: number) {
  return jobs.reduce((sum, job) => {
    const sent = Object.values(job.fillReport?.emailedAt ?? {}).filter((at) => { const time = Date.parse(at); return time >= from && time < to; }).length;
    const reached = job.fillReport?.reachedOut;
    const own = reached && !sent && Date.parse(reached.at) >= from && Date.parse(reached.at) < to ? reached.count : 0;
    return sum + sent + own;
  }, 0);
}

const FLAME = `<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2c1 4 5 6 5 11a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3 0-3-1-6 1-9.5z"/></svg>`;

/** A job as a row: its name, the company, and its progress as five bars. Opens its page. */
export function jobRow(job: TrackerJob, sub = "") {
  const title = job.titleMissing ? "Job title missing" : job.title;
  return `<li data-search="${escape(`${title} ${job.company}`.toLowerCase())}"><button type="button" class="job-row" data-open-job="${job.id}">
    <span class="job-row-text"><span class="job-row-title">${escape(title)}</span><span class="job-row-company">${escape(job.company)}${sub ? ` · ${escape(sub)}` : ""}</span></span>
    ${progressDots(job)}
  </button></li>`;
}

/** The week: seven squares, the streak, the weekly goal, then the jobs from the day picked. */
export function weekView(now = new Date()) {
  if (!store.tracker) return `<section class="page"><span class="eyebrow">This week</span><p class="note">${escape(store.error || "Loading your week…")}</p></section>`;
  const jobs = store.tracker.jobs;
  const days = perDay(jobs);
  const start = weekStart(now);
  const today = dayKey(now);
  if (!pickedDay || pickedDay > today || pickedDay < dayKey(start)) pickedDay = today;
  const weekly = store.tracker.weeklyGoal ?? 0;
  const daily = weekly ? Math.ceil(weekly / 5) : 0;
  const level = (count: number) => (!count ? "" : daily ? (count >= daily ? "l3" : count * 2 >= daily ? "l2" : "l1") : count >= 4 ? "l3" : count >= 2 ? "l2" : "l1");
  let week = 0;
  const squares = LETTERS.map((letter, index) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    const key = dayKey(date);
    const count = days.get(key)?.length ?? 0;
    week += count;
    const future = key > today;
    const name = date.toLocaleDateString("en-US", { weekday: "long" });
    return `<button type="button" class="day${future ? " future" : ""}${key === today ? " today" : ""}${key === pickedDay ? " on" : ""}" data-week-day="${key}" ${future ? "disabled" : ""} aria-pressed="${key === pickedDay}" aria-label="${name}: ${count} applied">
      <i class="${level(count)}">${future ? "" : count}</i><span>${letter}</span></button>`;
  }).join("");
  const streak = streakOf(days, now);
  const weekEnd = start.getTime() + 7 * DAY;
  const emails = emailsBetween(jobs, start.getTime(), weekEnd);

  const picked = new Date(`${pickedDay}T00:00:00`);
  const dayJobs = (days.get(pickedDay) ?? []).slice().sort((a, b) => Date.parse(b.submittedAt ?? b.createdAt) - Date.parse(a.submittedAt ?? a.createdAt));
  const dayEmails = emailsBetween(jobs, picked.getTime(), picked.getTime() + DAY);
  const dayName = pickedDay === today ? "Today" : picked.toLocaleDateString("en-US", { weekday: "long" });
  const time = (job: TrackerJob) => new Date(job.submittedAt ?? job.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  return `
    <section class="page week-card" aria-label="This week">
      <div class="row-between">
        <span class="eyebrow">This week · ${week}${weekly ? ` of ${weekly}` : " applied"}</span>
        <span class="streak${streak ? " lit" : ""}" title="Days in a row with an application">${FLAME}${streak} ${streak === 1 ? "day" : "days"}</span>
      </div>
      <div class="week-days" role="group" aria-label="Applications each day">${squares}</div>
      ${weekly ? `<div class="bar" role="progressbar" aria-label="Weekly goal" aria-valuemin="0" aria-valuemax="${weekly}" aria-valuenow="${Math.min(week, weekly)}"><div style="width:${Math.min(100, Math.round((week / weekly) * 100))}%"></div></div>` : ""}
      <div class="row-between"><span class="small">${weekly ? (week >= weekly ? "Weekly goal hit." : `${weekly - week} to go this week.`) : "Set a weekly goal on unnepo.com to fill these in."}</span><span class="small">${emails} ${emails === 1 ? "email" : "emails"} sent</span></div>
    </section>
    ${friendsWeekCard(week)}
    <section class="page day-card" aria-label="${dayName}">
      <div class="row-between"><span class="eyebrow">${dayName}</span><span class="small">${dayJobs.length} applied · ${dayEmails} emailed</span></div>
      ${dayJobs.length ? `<ul class="jobs-list">${dayJobs.map((job) => jobRow(job, time(job))).join("")}</ul>` : `<p class="note">${pickedDay === today ? "Nothing yet today. Apply somewhere and it shows up here." : "No applications that day."}</p>`}
    </section>`;
}

export function wireWeek(root: HTMLElement) {
  root.querySelectorAll<HTMLButtonElement>("[data-week-day]").forEach((button) => button.addEventListener("click", () => {
    pickedDay = button.dataset.weekDay!;
    redraw();
  }));
}

// ---- The Jobs tab ----

type Filter = "all" | "reach" | "waiting" | "follow" | "interview";
const FILTERS: Array<[Filter, string]> = [["all", "All"], ["reach", "Reach out"], ["waiting", "Waiting"], ["follow", "Follow up"], ["interview", "Interview"]];
let filter: Filter = "all";
let query = "";

function matches(job: TrackerJob, which: Filter) {
  if (which === "all") return true;
  const progress = progressOf(job);
  if (progress.ended === "Rejected" || !isAppliedJob(job)) return false;
  if (which === "reach") return progress.done === 1;
  if (which === "waiting") return !progress.due && (progress.done === 2 || progress.done === 4);
  if (which === "follow") return progress.due;
  return progress.done >= 5;
}

/** Opens the Jobs tab on one filter, like Reach out from Week. */
export function showJobs(which: Filter) { filter = which; }

/** Every job with its progress: a search box, a chip per step, applied jobs first, then the ones not applied yet. */
export function jobsList() {
  if (!store.tracker) return `<p class="note">${escape(store.error || "Loading your jobs…")}</p>`;
  const jobs = store.tracker.jobs;
  const chips = FILTERS.map(([value, label]) => {
    const count = jobs.filter((job) => matches(job, value)).length;
    return `<button type="button" class="chip${filter === value ? " on" : ""}" data-job-filter="${value}" aria-pressed="${filter === value}">${label}<b>${count}</b></button>`;
  }).join("");
  const shown = jobs.filter((job) => matches(job, filter));
  const applied = shown.filter(isAppliedJob);
  const saved = shown.filter((job) => !isAppliedJob(job));
  const when = (job: TrackerJob) => new Date(job.submittedAt ?? job.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const group = (label: string, list: TrackerJob[]) => list.length ? `
    <div class="row-between"><span class="eyebrow">${label}</span><span class="mono">${list.length}</span></div>
    <ul class="jobs-list">${list.map((job) => jobRow(job, when(job))).join("")}</ul>` : "";
  return `
    <section class="page jobs-card" aria-label="Your jobs">
      <input class="field search" id="job-search" type="search" placeholder="Search jobs or companies" aria-label="Search jobs or companies" value="${escape(query)}" autocomplete="off">
      <div class="chips" role="group" aria-label="Show">${chips}</div>
      ${shown.length ? `${group("Applied", applied)}${group("Not applied yet", saved)}` : `<p class="note">${filter === "all" ? "Every job you apply to shows up here." : "No jobs on this step right now."}</p>`}
      <p class="note" id="job-search-none" hidden>No jobs match that.</p>
    </section>`;
}

/** Search filters the rows as you type, without drawing the page again. */
function applySearch(root: HTMLElement) {
  const words = query.trim().toLowerCase();
  let any = false;
  root.querySelectorAll<HTMLLIElement>(".jobs-card li[data-search]").forEach((row) => {
    row.hidden = Boolean(words) && !row.dataset.search!.includes(words);
    any ||= !row.hidden;
  });
  const none = root.querySelector<HTMLElement>("#job-search-none");
  if (none) none.hidden = any || !words;
}

export function wireJobsList(root: HTMLElement) {
  root.querySelectorAll<HTMLButtonElement>("[data-job-filter]").forEach((button) => button.addEventListener("click", () => {
    filter = button.dataset.jobFilter as Filter;
    redraw();
  }));
  const search = root.querySelector<HTMLInputElement>("#job-search");
  search?.addEventListener("input", () => { query = search.value; applySearch(root); });
  applySearch(root);
}
