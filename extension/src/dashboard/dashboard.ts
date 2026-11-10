import { followUpsDue } from "@/lib/apply/follow-ups";
import { stageOf } from "@/lib/apply/stats";
import { detectedMenu, escape, isAppliedJob, jobById, jobPage, loadTracker, refreshDetected, remindersCard, setHost, stageLabel, store, wireDetected, wireJobPage, wireReminders } from "../shared/tracker-view";
import type { TrackerJob } from "../shared/types";

/**
 * The dashboard, opened from the panel: every job in one table (search, filter, sort), today's reminders and the
 * Detected jobs menu beside it, and the job clicked on, with the people at the company, on the right.
 */

const side = document.getElementById("side")!;
const rows = document.getElementById("rows")!;
const detail = document.getElementById("detail")!;
const empty = document.getElementById("empty")!;
const count = document.getElementById("dash-count")!;
const search = document.getElementById("search") as HTMLInputElement;
const filter = document.getElementById("filter") as HTMLSelectElement;
const sort = document.getElementById("sort") as HTMLSelectElement;

let selected = { id: new URLSearchParams(location.search).get("job") ?? "", contact: "" };
let apiBase = "";
void chrome.storage.local.get("apiBase").then((stored) => { apiBase = (stored.apiBase as string | undefined) ?? ""; });

const when = (at: string | null) => (at ? new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" }) : "—");

function shownJobs(): TrackerJob[] {
  const jobs = store.tracker?.jobs ?? [];
  const words = search.value.trim().toLowerCase();
  const due = new Set(followUpsDue(jobs as never).map((item) => item.applicationId));
  const matches = jobs.filter((job) => {
    if (words && !`${job.title} ${job.company} ${job.location ?? ""}`.toLowerCase().includes(words)) return false;
    const stage = stageOf(job as never);
    switch (filter.value) {
      case "applied": return isAppliedJob(job);
      case "in_progress": return stage === "in_progress";
      case "follow_up": return stage === "follow_up" || due.has(job.id);
      case "interviewing": return stage === "interviewing" || stage === "assessment" || stage === "offer";
      case "rejected": return stage === "rejected";
      default: return true;
    }
  });
  const at = (job: TrackerJob) => Date.parse(job.submittedAt ?? job.createdAt);
  const order: Record<string, (a: TrackerJob, b: TrackerJob) => number> = {
    recent: (a, b) => at(b) - at(a),
    oldest: (a, b) => at(a) - at(b),
    company: (a, b) => a.company.localeCompare(b.company),
    follow: (a, b) => Number(due.has(b.id)) - Number(due.has(a.id)) || at(b) - at(a),
  };
  return [...matches].sort(order[sort.value] ?? order.recent);
}

function drawTable() {
  const jobs = shownJobs();
  const due = new Set(followUpsDue((store.tracker?.jobs ?? []) as never).map((item) => item.applicationId));
  count.textContent = store.tracker ? `${store.tracker.jobs.length} JOBS` : "";
  rows.innerHTML = jobs.map((job) => {
    const emailed = job.contacts.filter((person) => person.outreachStatus !== "not_contacted").length;
    const people = job.contacts.length ? `${job.contacts.length}${emailed ? ` · ${emailed} emailed` : ""}` : job.contactsStatus === "finding" ? "Searching…" : "—";
    return `<tr data-job="${job.id}" class="${job.id === selected.id ? "selected" : ""}${due.has(job.id) ? " due" : ""}" tabindex="0">
      <td><span class="cell-title">${escape(job.titleMissing ? "Job title missing" : job.title)}</span>${job.location ? `<span class="cell-sub">${escape(job.location)}</span>` : ""}${due.has(job.id) ? `<span class="due-tag">FOLLOW-UP DUE</span>` : ""}</td>
      <td>${escape(job.company)}</td>
      <td><span class="status${isAppliedJob(job) ? " done" : ""}">${escape(stageLabel(job))}</span></td>
      <td class="mono">${isAppliedJob(job) ? when(job.submittedAt ?? job.createdAt) : "—"}</td>
      <td class="mono">${escape(people)}</td>
    </tr>`;
  }).join("");
  empty.hidden = Boolean(jobs.length);
  empty.textContent = !store.tracker ? (store.error || "Loading your jobs…") : store.tracker.jobs.length ? "No jobs match." : "No jobs yet. Apply somewhere and the extension catches it.";
  rows.querySelectorAll<HTMLTableRowElement>("tr[data-job]").forEach((row) => {
    const open = () => openJob(row.dataset.job!);
    row.addEventListener("click", open);
    row.addEventListener("keydown", (event) => { if (event.key === "Enter") open(); });
  });
}

/** Typing in a box on the job's page isn't wiped by a redraw. */
const typing = () => Boolean(document.activeElement?.closest(".dash-detail, .dash-side") && document.activeElement.matches("input, textarea, select"));

function draw() {
  drawTable();
  if (typing()) return;
  side.innerHTML = detectedMenu() + remindersCard(12);
  wireDetected(side);
  wireReminders(side);
  const job = selected.id ? jobById(selected.id) : null;
  detail.innerHTML = job ? jobPage(job, selected.contact || undefined) : `<p class="placeholder">Click a job to see its status and the people to email there.</p>`;
  if (job) wireJobPage(detail, job);
}

function openJob(id: string, contact = "") {
  selected = { id, contact };
  history.replaceState(null, "", id ? `?job=${encodeURIComponent(id)}` : location.pathname);
  draw();
  if (id) detail.scrollIntoView({ block: "nearest" });
}

setHost({ redraw: draw, openJob, upgradeUrl: () => `${apiBase}/home?tab=settings#plans` });
for (const box of [search, filter, sort]) box.addEventListener(box === search ? "input" : "change", drawTable);
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "tracker-changed") void loadTracker();
  if (message?.type === "state-changed") void refreshDetected();
});
// Coming back to the tab: read again, in case the panel changed something.
document.addEventListener("visibilitychange", () => { if (!document.hidden) void loadTracker(); });
void loadTracker(true);
