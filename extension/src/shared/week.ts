import { appliedOn, countsTowardGoals, dayKey, weekStart } from "@/lib/apply/stats";
import { escape, isAppliedJob, progressDots, progressOf, redraw, store } from "./tracker-view";
import { friendsWeekCard } from "./friends";
import { ACTIVITY_HEAT_FINE, ACTIVITY_MARK, activityByDay, activityGrid } from "@/lib/apply/calendar";
import type { TrackerJob } from "./types";

/**
 * The side panel's Week tab and Jobs tab. Week: a 12-week calendar of every day something happened, this
 * week's count and streak, and what happened on the day picked. Jobs: every job with its progress, searchable and
 * filtered by the step it's on. All of it is worked out here from the tracker, in the student's own time.
 */

const DAY = 86_400_000;

/** The day picked on the calendar (YYYY-MM-DD); none until one is tapped. */
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

const WEEKS = 12;

/** How much the calendar shows: this week, the last 5 weeks, or the last 12. Kept on this computer. */
type Range = "1w" | "1m" | "3m";
const RANGES: Array<[Range, string, number, string]> = [["1w", "1W", 1, "This week"], ["1m", "1M", 5, "Last 5 weeks"], ["3m", "3M", WEEKS, `Last ${WEEKS} weeks`]];
let range: Range = "3m";
void chrome.storage.local.get("graphRange").then((stored) => {
  const saved = stored.graphRange as Range | undefined;
  if (saved && saved !== range && RANGES.some(([value]) => value === saved)) { range = saved; redraw(); }
});
const shortDate = (date: Date) => date.toLocaleDateString("en-US", { month: "short", day: "numeric" });

/**
 * Week: every day you did something over the last 12 weeks (applied, emailed someone, heard back), brighter for
 * a busier day, with this week's count, the goal and the streak on top. Tapping a day shows what happened.
 */
/**
 * `under` goes right below the calendar, above friends: the job list on Week. Given as a function, it gets the
 * friends card to place itself (the home screen puts it at the end of its scrolling job list).
 */
export function weekView(now = new Date(), under: string | ((friends: string) => string) = "", goalsUrl = "") {
  if (!store.tracker) return `<section class="page"><span class="eyebrow">Every day you did something</span><p class="note">${escape(store.error || "Loading your week…")}</p></section>`;
  const jobs = store.tracker.jobs;
  const applied = perDay(jobs);
  const byDay = activityByDay(jobs);
  const [, , weeks, rangeLabel] = RANGES.find(([value]) => value === range)!;
  const grid = activityGrid(now, weeks);
  const start = weekStart(now);
  const today = dayKey(now);
  if (pickedDay && (pickedDay > today || pickedDay < dayKey(grid[0][0]))) pickedDay = "";
  const weekly = store.tracker.weeklyGoal ?? 0;
  let week = 0;
  for (let index = 0; index < 7; index += 1) week += applied.get(dayKey(new Date(start.getFullYear(), start.getMonth(), start.getDate() + index)))?.length ?? 0;
  const streak = streakOf(applied, now);
  const emails = emailsBetween(jobs, start.getTime(), start.getTime() + 7 * DAY);

  const day = (date: Date, inside = "") => {
    const key = dayKey(date);
    if (key > today) return `<span class="heat-day future">${inside}</span>`;
    const count = byDay.get(key)?.length ?? 0;
    return `<button type="button" class="heat-day${key === today ? " today" : ""}${key === pickedDay ? " on" : ""}" data-week-day="${key}" aria-pressed="${key === pickedDay}" aria-label="${escape(shortDate(date))}: ${count} ${count === 1 ? "thing" : "things"}" style="background:${ACTIVITY_HEAT_FINE[Math.min(count, 8)]}">${inside && count ? count : ""}</button>`;
  };
  const LETTERS = ["M", "T", "W", "T", "F", "S", "S"];
  const letters = LETTERS.map((letter) => `<span>${letter}</span>`).join("");
  // One week: seven big squares in a row, each with its count. More: a column per week, Monday at the top.
  const calendar = weeks === 1
    ? `<div class="heat-week" role="group" aria-label="This week, day by day">${grid[0].map((date, index) => `<div class="heat-week-day">${day(date, " ")}<span>${LETTERS[index]}</span></div>`).join("")}</div>`
    : `<div class="heat${weeks < WEEKS ? " roomy" : ""}" role="group" aria-label="Every day you did something, ${rangeLabel.toLowerCase()}" style="grid-template-columns: 12px repeat(${weeks}, minmax(0, ${weeks < WEEKS ? "26px" : "1fr"}))">
        <div class="heat-col heat-letters"><span class="heat-month"></span>${letters}</div>
        ${grid.map((days, index) => `<div class="heat-col"><span class="heat-month">${index % (weeks < WEEKS ? 2 : 4) === 0 ? escape(shortDate(days[0])) : ""}</span>${days.map((date) => day(date)).join("")}</div>`).join("")}
      </div>`;
  const ranges = RANGES.map(([value, label, , title]) => `<button type="button" class="range-btn${value === range ? " on" : ""}" data-graph-range="${value}" aria-pressed="${value === range}" title="${title}">${label}</button>`).join("");

  const picked = pickedDay ? byDay.get(pickedDay) ?? [] : [];
  const pickedDate = pickedDay ? new Date(`${pickedDay}T00:00:00`) : null;
  const detail = pickedDate ? `
      <div class="heat-detail">
        <div class="row-between"><span class="small"><b>${escape(shortDate(pickedDate))}</b>${pickedDay === today ? " · today" : ""}</span><button type="button" class="quiet-link tight" data-week-day="">Close</button></div>
        ${picked.length ? `<ul class="heat-events">${picked.map((event) => {
          const mark = ACTIVITY_MARK[event.kind];
          const title = event.job.titleMissing ? "Job title missing" : event.job.title;
          return `<li><button type="button" class="heat-event" data-open-job="${event.job.id}"><span class="heat-glyph" style="color:${mark.color}">${mark.glyph}</span><span>${mark.label}</span><span class="sub">· ${escape(event.job.company)}, ${escape(title)}</span></button></li>`;
        }).join("")}</ul>` : `<p class="small">A quiet day. Nothing logged.</p>`}
      </div>` : "";

  const friends = friendsWeekCard(week);
  return `
    <section class="page week-card" aria-label="Every day you did something">
      <div class="week-head">
        <span class="eyebrow" title="${weekly ? (week >= weekly ? "Weekly goal hit" : `${weekly - week} to go this week`) : "Set a weekly goal on unnepo.com"}">${week}${weekly ? ` / ${weekly}` : ""} this week</span>
        <span class="streak${streak ? " lit" : ""}" title="Days in a row with an application">${FLAME}${streak} ${streak === 1 ? "day" : "days"}</span>
      </div>
      ${weekly ? `<div class="bar" role="progressbar" aria-label="Weekly goal" aria-valuemin="0" aria-valuemax="${weekly}" aria-valuenow="${Math.min(week, weekly)}"><div style="width:${Math.min(100, Math.round((week / weekly) * 100))}%"></div></div>` : ""}
      ${calendar}
      ${detail}
      <div class="heat-foot">
        <button type="button" class="heat-how-toggle" id="heat-how" aria-expanded="${keyOpen}"><span aria-hidden="true">${keyOpen ? "▾" : "▸"}</span> How it works</button>
        ${goalsUrl ? `<a class="heat-goals" href="${escape(goalsUrl)}" target="_blank" rel="noreferrer">${weekly ? "Edit goals" : "Set a goal"} ↗</a>` : ""}
        <span class="range" role="group" aria-label="Show">${ranges}</span>
      </div>
      ${keyOpen ? heatKey(emails, weekly ? (week >= weekly ? "Weekly goal hit." : `${weekly - week} to go this week.`) : "No weekly goal yet. Set one with Set a goal.", rangeLabel) : ""}
    </section>
    ${typeof under === "function" ? under(friends) : `${under}${friends}`}`;
}

/** Whether "How it works" under the calendar is open; kept across redraws. */
let keyOpen = false;
/**
 * The calendar's key: each square is a day, darker for nothing done and brighter the more happened (applying,
 * emailing someone, a follow-up, an interview, an offer or a no each count as one), plus today's ring.
 */
function heatKey(emails: number, goal: string, rangeLabel: string) {
  const steps = ["0", "1", "2", "3", "4", "5", "6", "7", "8+"];
  return `
      <div class="heat-how">
        <div class="heat-key" aria-label="Key: darker squares are days with less done, brighter ones more">
          <span class="small">Less</span>
          ${steps.map((label, index) => `<span class="heat-key-step"><span class="heat-key-swatch" style="background:${ACTIVITY_HEAT_FINE[index]}"></span><span class="heat-key-num">${label}</span></span>`).join("")}
          <span class="small">More</span>
          <span class="heat-key-step today-key"><span class="heat-key-swatch today"></span><span class="heat-key-num">Today</span></span>
        </div>
        <p class="small heat-key-note">${escape(goal)} ${emails} ${emails === 1 ? "email" : "emails"} sent this week.</p>
        <p class="small heat-key-note">Each square is a day (${escape(rangeLabel.toLowerCase())}). The brighter it is, the more you did that day: each application, email, follow-up, interview, offer or no counts as one, up to 8 or more. Tap a day to see what happened. 1W, 1M and 3M change how far back it shows.</p>
      </div>`;
}

export function wireWeek(root: HTMLElement) {
  root.querySelector("#heat-how")?.addEventListener("click", () => { keyOpen = !keyOpen; redraw(); });
  root.querySelectorAll<HTMLButtonElement>("[data-graph-range]").forEach((button) => button.addEventListener("click", () => {
    range = button.dataset.graphRange as Range;
    pickedDay = "";
    void chrome.storage.local.set({ graphRange: range });
    redraw();
  }));
  root.querySelectorAll<HTMLButtonElement>("[data-week-day]").forEach((button) => button.addEventListener("click", () => {
    const key = button.dataset.weekDay!;
    pickedDay = key && key !== pickedDay ? key : "";
    redraw();
  }));
}

// ---- The Jobs tab ----

type Filter = "all" | "reach" | "waiting" | "follow" | "interview";
const FILTERS: Array<[Filter, string]> = [["all", "All"], ["reach", "Reach out"], ["waiting", "Waiting"], ["follow", "Follow up"], ["interview", "Interview"]];
let filter: Filter = "all";
let query = "";
/** Whether the search box is open; it stays open while there's something typed in it. */
let searchOpen = false;
const SEARCH_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>`;

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

/**
 * Every job with its progress, in a box that scrolls on its own so the calendar above stays put: a chip per step
 * and a search button on top, applied jobs first, then the ones not applied yet. `tail` goes at the end of the list.
 */
export function jobsList(lead = "", tail = "") {
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
  // The group's name only when there are two groups to tell apart.
  const group = (label: string, list: TrackerJob[]) => list.length ? `
    ${applied.length && saved.length ? `<div class="row-between jobs-group"><span class="eyebrow">${label}</span><span class="mono">${list.length}</span></div>` : ""}
    <ul class="jobs-list">${list.map((job) => jobRow(job, when(job))).join("")}</ul>` : "";
  const searching = searchOpen || Boolean(query);
  return `
    <section class="page jobs-card jobs-pane" aria-label="Your jobs">
      ${lead}
      <div class="jobs-tools">
        <div class="chips" role="group" aria-label="Show">${chips}</div>
        <button type="button" class="icon-btn${searching ? " on" : ""}" id="job-search-toggle" aria-label="Search jobs" aria-expanded="${searching}">${SEARCH_ICON}</button>
      </div>
      ${searching ? `<input class="field search" id="job-search" type="search" placeholder="Search jobs or companies" aria-label="Search jobs or companies" value="${escape(query)}" autocomplete="off">` : ""}
      <div class="jobs-scroll">
        ${shown.length ? `${group("Applied", applied)}${group("Not applied yet", saved)}` : `<p class="note">${filter === "all" ? "Every job you apply to shows up here." : "No jobs on this step right now."}</p>`}
        <p class="note" id="job-search-none" hidden>No jobs match that.</p>
        ${tail}
      </div>
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
  root.querySelector("#job-search-toggle")?.addEventListener("click", () => {
    searchOpen = !(searchOpen || query);
    if (!searchOpen) query = "";
    redraw();
    if (searchOpen) document.querySelector<HTMLInputElement>("#job-search")?.focus();
  });
  const search = root.querySelector<HTMLInputElement>("#job-search");
  search?.addEventListener("input", () => { query = search.value; applySearch(root); });
  applySearch(root);
}
