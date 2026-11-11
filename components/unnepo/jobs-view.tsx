"use client";

import { useEffect, useMemo, useState } from "react";
import { SpiderLoader } from "@/components/unnepo/spider-loader";
import { STEPS, STEP_LABEL, progressOf, type Progress } from "@/lib/apply/progress";
import { appliedOn, countsTowardGoals, weekStart } from "@/lib/apply/stats";
import type { TrackerJob } from "@/lib/extension/service";

/**
 * The website's Jobs tab: every job applied to, with where each one is (Applied → Reach out → Waiting →
 * Follow up → Interview). The extension does the tracking; this is the same list, read from the server.
 */

type Tracker = { jobs: TrackerJob[]; weeklyGoal: number | null };
type Filter = "all" | "reach" | "waiting" | "follow" | "interview";
const FILTERS: Array<[Filter, string]> = [["all", "All"], ["reach", "Reach out"], ["waiting", "Waiting"], ["follow", "Follow up"], ["interview", "Interview"]];
const isApplied = (job: TrackerJob) => job.status === "submitted" || job.status === "applied_manual";

function matches(progress: Progress, job: TrackerJob, filter: Filter) {
  if (filter === "all") return true;
  if (progress.ended === "Rejected" || !isApplied(job)) return false;
  if (filter === "reach") return progress.done === 1;
  if (filter === "waiting") return !progress.due && (progress.done === 2 || progress.done === 4);
  if (filter === "follow") return progress.due;
  return progress.done >= 5;
}

const day = (at: string) => new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const PERSON_STATUS: Record<string, string> = { emailed: "Emailed", replied: "Replied", no_response: "No reply" };

function Bars({ progress }: { progress: Progress }) {
  return (
    <span aria-hidden className="flex gap-[3px]">
      {STEPS.map((step, index) => {
        const color = index < progress.done ? "bg-[#4ADE80]" : index === progress.done && !progress.ended ? (progress.due ? "bg-[#F5A524]" : "bg-[#3D8BFF]") : "bg-[#26262C]";
        return <i key={step} className={`h-1 w-4 rounded-sm ${color}`} />;
      })}
    </span>
  );
}

function StepsLine({ progress }: { progress: Progress }) {
  return (
    <ol aria-label="Progress" className={`m-0 flex list-none p-0 ${progress.ended === "Rejected" ? "opacity-45" : ""}`}>
      {STEPS.map((step, index) => {
        const state = index < progress.done ? "done" : index === progress.done && !progress.ended ? (progress.due ? "due" : "now") : "";
        const dot = state === "done" ? "border-[#4ADE80] bg-[#4ADE80] text-[#052E14]" : state === "now" ? "border-[#3D8BFF] bg-[#0C0C0E] shadow-[0_0_0_4px_rgba(61,139,255,.18)]" : state === "due" ? "border-[#F5A524] bg-[#0C0C0E] shadow-[0_0_0_4px_rgba(245,165,36,.18)]" : "border-[#26262C] bg-[#0C0C0E]";
        const line = index < progress.done ? "bg-[#4ADE80]" : "bg-[#26262C]";
        return (
          <li key={step} aria-current={state === "now" || state === "due" ? "step" : undefined} className={`relative flex min-w-0 flex-1 flex-col items-center gap-1.5 text-center text-[11px] ${state ? "text-[#F7F7F8]" : "text-[#8B8B94]"}`}>
            {index < STEPS.length - 1 && <span aria-hidden className={`absolute left-1/2 top-[10px] h-[1.5px] w-full ${line}`} />}
            <i aria-hidden className={`relative z-10 grid h-5 w-5 place-items-center rounded-full border-[1.5px] text-[11px] font-semibold not-italic ${dot}`}>{state === "done" ? "✓" : ""}</i>
            {step}
          </li>
        );
      })}
    </ol>
  );
}

export function JobsView() {
  const [tracker, setTracker] = useState<Tracker | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/app/tracker")
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || "Couldn't load your jobs.");
        if (!cancelled) setTracker(body as Tracker);
      })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Couldn't load your jobs."); });
    return () => { cancelled = true; };
  }, []);

  const rows = useMemo(() => (tracker?.jobs ?? []).map((job) => ({ job, progress: progressOf(job) })), [tracker]);
  const stats = useMemo(() => {
    const since = weekStart(new Date()).getTime();
    const applied = rows.filter(({ job }) => isApplied(job));
    return {
      applied: applied.length,
      week: applied.filter(({ job }) => countsTowardGoals(job as never) && appliedOn(job as never).getTime() >= since).length,
      reach: rows.filter(({ job, progress }) => matches(progress, job, "reach")).length,
      interview: rows.filter(({ job, progress }) => matches(progress, job, "interview")).length,
    };
  }, [rows]);

  if (error) return <p className="rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">{error}</p>;
  if (!tracker) return <SpiderLoader label="Loading your jobs…" />;

  const words = query.trim().toLowerCase();
  const shown = rows.filter(({ job, progress }) => matches(progress, job, filter) && (!words || `${job.title} ${job.company}`.toLowerCase().includes(words)));

  return (
    <section className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Jobs</h1>
        <p className="text-[15px] text-[#9A9AA3]">Every job you applied to and where it stands. The extension keeps this up to date as you apply and email people.</p>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["Applied", stats.applied], ["This week", tracker.weeklyGoal ? `${stats.week} / ${tracker.weeklyGoal}` : stats.week], ["Need an email", stats.reach], ["Interviewing", stats.interview]].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-[#1F1F24] bg-[#0C0C0E] px-4 py-3">
            <dt className="font-mono text-[11px] uppercase tracking-[1.4px] text-[#8B8B94]">{label}</dt>
            <dd className="m-0 mt-1 text-2xl font-bold tabular-nums tracking-tight">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-col gap-3">
        <input id="jobs-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search jobs or companies" aria-label="Search jobs or companies" className="h-11 w-full rounded-xl border border-[#26262C] bg-[#0C0C0E] px-4 text-sm text-[#F7F7F8] placeholder:text-[#8B8B94] focus:border-[#3D8BFF] focus:outline-none" />
        <div role="group" aria-label="Show" className="flex flex-wrap gap-2">
          {FILTERS.map(([value, label]) => {
            const count = rows.filter(({ job, progress }) => matches(progress, job, value)).length;
            return (
              <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)} className={`h-8 rounded-full border px-3 text-[13px] font-medium ${filter === value ? "border-[#F7F7F8] bg-[#F7F7F8] text-[#070708]" : "border-[#26262C] text-[#B4B4BC] hover:text-white"}`}>
                {label} <b className="font-mono text-[11px] opacity-70">{count}</b>
              </button>
            );
          })}
        </div>
      </div>

      {shown.length ? (
        <ul className="m-0 flex list-none flex-col overflow-hidden rounded-2xl border border-[#1F1F24] bg-[#0C0C0E] p-0">
          {shown.map(({ job, progress }) => {
            const expanded = open === job.id;
            const emailed = job.contacts.filter((person) => person.outreachStatus !== "not_contacted");
            return (
              <li key={job.id} className="border-t border-[#17171B] first:border-t-0">
                <button type="button" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : job.id)} className="flex w-full items-center justify-between gap-4 px-4 py-3.5 text-left hover:bg-white/[.03] sm:px-5">
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-[15px] font-medium">{job.titleMissing ? "Job title missing" : job.title}</span>
                    <span className="truncate text-[13px] text-[#8B8B94]">{job.company} · {isApplied(job) ? day(job.submittedAt ?? job.createdAt) : "Not applied yet"}</span>
                  </span>
                  <span className="flex flex-none flex-col items-end gap-1.5">
                    <Bars progress={progress} />
                    <span className={`font-mono text-[10.5px] uppercase tracking-[.5px] ${progress.due ? "text-[#F5A524]" : progress.done >= 5 || progress.ended === "Offer" ? "text-[#4ADE80]" : "text-[#9A9AA3]"}`}>{progress.ended ?? STEP_LABEL[progress.done]}</span>
                  </span>
                </button>
                {expanded && (
                  <div className="flex flex-col gap-4 border-t border-[#17171B] bg-[#09090B] px-4 py-4 sm:px-5">
                    <StepsLine progress={progress} />
                    <p className={`m-0 text-sm ${progress.due ? "text-[#F5A524]" : "text-[#B4B4BC]"}`}>{progress.next}</p>
                    {emailed.length > 0 && (
                      <div className="flex flex-col gap-1">
                        <span className="font-mono text-[11px] uppercase tracking-[1.4px] text-[#8B8B94]">People you emailed</span>
                        {emailed.map((person) => (
                          <div key={person.id} className="flex items-center justify-between gap-3 text-sm">
                            <span className="min-w-0 truncate">{person.name}{person.title ? <span className="text-[#8B8B94]"> · {person.title}</span> : null}</span>
                            <span className={`flex-none font-mono text-[10.5px] uppercase ${person.outreachStatus === "replied" ? "text-[#4ADE80]" : "text-[#9A9AA3]"}`}>{PERSON_STATUS[person.outreachStatus] ?? ""}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
                      {job.url && <a href={job.url} target="_blank" rel="noreferrer" className="underline underline-offset-4">Job posting ↗</a>}
                      <span className="text-[#8B8B94]">Email people and change its status in the extension.</span>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rounded-2xl border border-[#1F1F24] bg-[#0C0C0E] px-5 py-8 text-center text-sm text-[#9A9AA3]">
          {rows.length ? "No jobs match that." : "No jobs yet. Apply somewhere with the extension open and it shows up here."}
        </p>
      )}
    </section>
  );
}
