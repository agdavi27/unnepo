"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { SpiderLoader } from "@/components/unnepo/spider-loader";
import { H, ON_DARK, W, spiderRects } from "@/extension/src/shared/sprite";
import { STEPS, STEP_LABEL, emailedCount, progressOf, type Progress } from "@/lib/apply/progress";
import { appliedOn, countsTowardGoals, dayKey, weekStart } from "@/lib/apply/stats";
import type { TrackerJob } from "@/lib/extension/service";
import { ACTIVITY_HEAT, ACTIVITY_MARK, activityByDay, activityGrid, activityOf, longestRun } from "@/lib/apply/calendar";

/**
 * The website's Jobs tab: a calendar of every day the student did something (applied, emailed someone, heard
 * back), then every job with where it is (Applied → Reach out → Waiting → Follow up → Interview). A job's More
 * info opens its details over the page. Jobs can be added by hand and deleted here; the extension does the rest.
 */

type Tracker = { jobs: TrackerJob[]; weeklyGoal: number | null };
type Row = { job: TrackerJob; progress: Progress };
type Filter = "all" | "reach" | "waiting" | "follow" | "interview";
const FILTERS: Array<[Filter, string]> = [["all", "All"], ["reach", "Reach out"], ["waiting", "Waiting"], ["follow", "Follow up"], ["interview", "Interview"]];
const isApplied = (job: TrackerJob) => job.status === "submitted" || job.status === "applied_manual";

function matches({ job, progress }: Row, filter: Filter) {
  if (filter === "all") return true;
  if (progress.ended === "Rejected" || !isApplied(job)) return false;
  if (filter === "reach") return progress.done === 1;
  if (filter === "waiting") return !progress.due && (progress.done === 2 || progress.done === 4);
  if (filter === "follow") return progress.due;
  return progress.done >= 5;
}

const PIXEL = "font-[family-name:var(--font-pixel)]";
const SPIDER = spiderRects(0, ON_DARK);
const GREEN = "#4ADE80", BLUE = "#3D8BFF", AMBER = "#F5A524", RED = "#F87171", GOLD = "#E6C15A", GRAY = "#8B8B94";
const TILE = ["#3D8BFF", "#8B5CF6", "#EC4899", "#14B8A6", "#F59E0B", "#22C55E", "#EF4444", "#06B6D4"];
const tileColor = (name: string) => TILE[[...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % TILE.length];
const HEAT = ACTIVITY_HEAT;
const WEEKS = 12;
const PERSON_STATUS: Record<string, string> = { emailed: "Emailed", replied: "Replied", no_response: "No reply" };

const short = (date: Date) => date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
const companyOf = (job: TrackerJob) => (job.companyMissing ? "Company missing" : job.company);
const titleOf = (job: TrackerJob) => (job.titleMissing ? "Job title missing" : job.title);
function ago(date: Date, now: Date) {
  const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()) / 86_400_000);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days}d ago`;
}

/* ───────────── What happened, by day ───────────── */

const MARK = ACTIVITY_MARK;
const eventsOf = (job: TrackerJob) => activityOf(job);

/* ───────────── Small pieces ───────────── */

function statusOf({ job, progress }: Row) {
  if (progress.ended === "Offer") return { label: "Offer", color: GOLD };
  if (progress.ended === "Rejected") return { label: "Rejected", color: RED };
  if (!isApplied(job)) return { label: "Not applied", color: GRAY };
  if (progress.done >= 5) return { label: "Interview", color: GREEN };
  if (progress.due) return { label: "Follow up", color: AMBER };
  return { label: STEP_LABEL[progress.done], color: BLUE };
}

function Status({ row }: { row: Row }) {
  const { label, color } = statusOf(row);
  return (
    <span className="inline-flex h-7 items-center gap-2 whitespace-nowrap rounded-full border px-2.5 text-[12px] font-medium" style={{ color, borderColor: `${color}55`, background: `${color}14` }}>
      <i className={`h-2 w-2 rounded-full ${row.progress.due ? "dash-pulse" : ""}`} style={{ background: color }} />
      {label}
    </span>
  );
}

function Tile({ name, size = 34 }: { name: string; size?: number }) {
  return (
    <span aria-hidden className={`${PIXEL} grid flex-none place-items-center text-white`} style={{ width: size, height: size, background: tileColor(name), fontSize: size * 0.36, boxShadow: "inset -2px -2px 0 rgba(0,0,0,.25)" }}>
      {(name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}

function Spider({ size = 44 }: { size?: number }) {
  return (
    <span aria-hidden className="block" style={{ width: size, height: Math.round((size * H) / W) }}>
      <svg viewBox={`0 0 ${W} ${H}`} shapeRendering="crispEdges" className="block h-full w-full" dangerouslySetInnerHTML={{ __html: SPIDER }} />
    </span>
  );
}

function StepsLine({ progress }: { progress: Progress }) {
  return (
    <ol aria-label="Progress" className={`m-0 flex list-none p-0 ${progress.ended === "Rejected" ? "opacity-45" : ""}`}>
      {STEPS.map((step, index) => {
        const state = index < progress.done ? "done" : index === progress.done && !progress.ended ? (progress.due ? "due" : "now") : "";
        const dot = state === "done" ? "border-[#4ADE80] bg-[#4ADE80] text-[#052E14]" : state === "now" ? "border-[#3D8BFF] bg-[#0C0C0E] shadow-[0_0_0_4px_rgba(61,139,255,.18)]" : state === "due" ? "border-[#F5A524] bg-[#0C0C0E] shadow-[0_0_0_4px_rgba(245,165,36,.18)]" : "border-[#26262C] bg-[#0C0C0E]";
        return (
          <li key={step} aria-current={state === "now" || state === "due" ? "step" : undefined} className={`relative flex min-w-0 flex-1 flex-col items-center gap-1.5 text-center text-[11px] ${state ? "text-[#F7F7F8]" : "text-[#8B8B94]"}`}>
            {index < STEPS.length - 1 && <span aria-hidden className={`absolute left-1/2 top-[10px] h-[1.5px] w-full ${index < progress.done ? "bg-[#4ADE80]" : "bg-[#26262C]"}`} />}
            <i aria-hidden className={`relative z-10 grid h-5 w-5 place-items-center rounded-full border-[1.5px] text-[11px] font-semibold not-italic ${dot}`}>{state === "done" ? "✓" : ""}</i>
            {step}
          </li>
        );
      })}
    </ol>
  );
}

/** A popup over the blurred page. Escape or a click outside closes it. */
function Popup({ label, onClose, children, width = "max-w-lg" }: { label: string; onClose: () => void; children: ReactNode; width?: string }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = overflow; };
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-3 backdrop-blur-md sm:items-center sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={label} className={`relative max-h-[90vh] w-full ${width} overflow-y-auto rounded-2xl border border-line bg-[#0C0C0E] p-5 text-[#F7F7F8] shadow-[0_30px_80px_-20px_rgba(0,0,0,.9)] sm:p-6`}>
        <button type="button" aria-label="Close" onClick={onClose} className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-lg text-lg leading-none text-[#8B8B94] hover:bg-white/5 hover:text-white">×</button>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/* ───────────── Popups ───────────── */

function InfoPopup({ row, now, onClose, onDelete }: { row: Row; now: Date; onClose: () => void; onDelete: () => void }) {
  const { job, progress } = row;
  const events = eventsOf(job);
  const emailed = job.contacts.filter((person) => person.outreachStatus !== "not_contacted");
  const count = emailedCount(job as never);
  return (
    <Popup label={`${companyOf(job)}, ${titleOf(job)}`} onClose={onClose}>
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-3 pr-8">
          <Tile name={companyOf(job)} size={40} />
          <div className="min-w-0">
            <h2 className="m-0 truncate text-lg font-semibold tracking-tight">{titleOf(job)}</h2>
            <p className="m-0 truncate text-sm text-muted">{companyOf(job)} · {isApplied(job) ? `applied ${short(appliedOn(job as never))}` : "not applied yet"}{job.location ? ` · ${job.location}` : ""}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3"><Status row={row} /><span className={`text-sm ${progress.due ? "text-[#F5A524]" : "text-[#B4B4BC]"}`}>{progress.next}</span></div>
        {isApplied(job) && <StepsLine progress={progress} />}
        {events.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="m-0 font-mono text-[11px] uppercase tracking-[1.4px] text-[#8B8B94]">What happened</p>
            <ol className="m-0 flex list-none flex-col p-0">
              {events.map((event, index) => (
                <li key={`${event.day}-${event.kind}`} className="relative flex items-center gap-3 py-1.5 text-sm">
                  {index < events.length - 1 && <i aria-hidden className="absolute left-[9px] top-[22px] h-full w-px bg-[#1F1F24]" />}
                  <span className="relative z-10 grid h-5 w-5 place-items-center rounded-full bg-[#141416] text-[11px]" style={{ color: MARK[event.kind].color }}>{MARK[event.kind].glyph}</span>
                  <span className="flex-1">{MARK[event.kind].label}</span>
                  <span className="font-mono text-[11px] text-[#8B8B94]">{short(event.at)} · {ago(event.at, now)}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
        {emailed.length > 0 ? (
          <div className="flex flex-col gap-1">
            <p className="m-0 font-mono text-[11px] uppercase tracking-[1.4px] text-[#8B8B94]">People you emailed</p>
            {emailed.map((person) => (
              <div key={person.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">{person.name}{person.title ? <span className="text-[#8B8B94]"> · {person.title}</span> : null}</span>
                <span className={`flex-none font-mono text-[10.5px] uppercase ${person.outreachStatus === "replied" ? "text-[#4ADE80]" : "text-[#9A9AA3]"}`}>{PERSON_STATUS[person.outreachStatus] ?? ""}</span>
              </div>
            ))}
          </div>
        ) : isApplied(job) && (
          <p className="m-0 text-sm text-muted">{count ? `You've emailed ${count} ${count === 1 ? "person" : "people"} here.` : "You haven't emailed anyone here yet."}</p>
        )}
        <p className="m-0 text-[13px] text-[#8B8B94]">Email people and change its status in the extension.</p>
        <div className="flex flex-wrap items-center gap-3 border-t border-[#1F1F24] pt-4">
          {job.url && <a href={job.url} target="_blank" rel="noreferrer" className="text-sm underline underline-offset-4">Job posting ↗</a>}
          <button type="button" onClick={onDelete} className="ml-auto h-9 rounded-xl border border-[#3A2020] px-3 text-sm text-[#F87171] hover:bg-[#2A1A1A]">Delete job</button>
          <button type="button" autoFocus onClick={onClose} className="h-9 rounded-xl bg-white px-4 text-sm font-semibold text-black hover:bg-zinc-200">Done</button>
        </div>
      </div>
    </Popup>
  );
}

function DeletePopup({ job, onCancel, onDeleted }: { job: TrackerJob; onCancel: () => void; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const confirm = async () => {
    setBusy(true);
    setError("");
    const response = await fetch("/api/apply/applications", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ applicationId: job.id }) }).catch(() => null);
    const body = await response?.json().catch(() => ({}));
    if (!response?.ok) { setBusy(false); setError(body?.error || "Couldn't delete it. Try again."); return; }
    onDeleted();
  };
  return (
    <Popup label="Delete this job?" onClose={onCancel} width="max-w-sm">
      <div className="flex flex-col gap-4">
        <span aria-hidden className="grid h-11 w-11 place-items-center rounded-full bg-[#2A1A1A] text-xl text-[#F87171]">!</span>
        <div>
          <h2 className="m-0 text-lg font-semibold tracking-tight">Delete this job?</h2>
          <p className="m-0 mt-1.5 text-sm leading-relaxed text-muted"><b className="font-medium text-ink">{titleOf(job)}</b> at <b className="font-medium text-ink">{companyOf(job)}</b> comes off your jobs, your calendar and the extension, with the people on it. You can&apos;t undo this.</p>
        </div>
        {error && <p className="m-0 text-sm text-[#F87171]">{error}</p>}
        <div className="flex gap-2">
          <button type="button" autoFocus onClick={onCancel} className="h-10 flex-1 rounded-xl border border-line text-sm hover:bg-white/5">Keep it</button>
          <button type="button" disabled={busy} onClick={() => void confirm()} className="h-10 flex-1 rounded-xl bg-[#EF4444] text-sm font-semibold text-white hover:bg-[#DC2626] disabled:opacity-50">{busy ? "Deleting…" : "Delete"}</button>
        </div>
      </div>
    </Popup>
  );
}

const STAGES: Array<{ id: string; label: string; color: string }> = [
  { id: "applied", label: "Applied", color: BLUE },
  { id: "in_progress", label: "Not applied yet", color: GRAY },
  { id: "follow_up", label: "Follow up", color: AMBER },
  { id: "interviewing", label: "Interview", color: GREEN },
  { id: "offer", label: "Offer", color: GOLD },
  { id: "rejected", label: "Rejected", color: RED },
];

function AddPopup({ onCancel, onAdded }: { onCancel: () => void; onAdded: (company: string) => void }) {
  const today = dayKey(new Date());
  const [company, setCompany] = useState("");
  const [title, setTitle] = useState("");
  const [appliedOnDay, setAppliedOnDay] = useState(today);
  const [stage, setStage] = useState("applied");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ready = company.trim().length >= 2 && title.trim().length >= 2;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError("");
    const response = await fetch("/api/apply/add-job", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company: company.trim(), title: title.trim(), url: url.trim() || undefined, stage, appliedOn: stage === "in_progress" ? undefined : appliedOnDay }),
    }).catch(() => null);
    const body = await response?.json().catch(() => ({}));
    if (!response?.ok) { setBusy(false); setError(body?.error || "Couldn't add it. Try again."); return; }
    onAdded(company.trim());
  };
  const label = "flex flex-col gap-1.5 text-[13px] text-[#B4B4BC]";
  return (
    <Popup label="Add a job" onClose={onCancel}>
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        <div>
          <h2 className="m-0 text-lg font-semibold tracking-tight">Add a job</h2>
          <p className="m-0 mt-1 text-sm text-muted">Applied somewhere the extension didn&apos;t catch? Add it here.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={label}>Company<input autoFocus required value={company} onChange={(event) => setCompany(event.target.value)} placeholder="Stripe" className="field" /></label>
          <label className={label}>Job title<input required value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Software Engineering Intern" className="field" /></label>
          {stage !== "in_progress" && <label className={label}>Date applied<input type="date" value={appliedOnDay} max={today} onChange={(event) => setAppliedOnDay(event.target.value)} className="field [color-scheme:dark]" /></label>}
          <label className={label}>Link<input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://… (optional)" className="field" /></label>
        </div>
        <fieldset className="m-0 border-0 p-0">
          <legend className="mb-2 text-[13px] text-[#B4B4BC]">Where is it?</legend>
          <div className="flex flex-wrap gap-2">
            {STAGES.map((option) => {
              const on = stage === option.id;
              return (
                <button key={option.id} type="button" aria-pressed={on} onClick={() => setStage(option.id)} className="inline-flex h-8 items-center gap-2 rounded-full border px-3 text-[13px]" style={on ? { color: option.color, borderColor: option.color, background: `${option.color}1A` } : { color: "#B4B4BC", borderColor: "#26262C" }}>
                  <i className="h-2 w-2 rounded-full" style={{ background: option.color }} />{option.label}
                </button>
              );
            })}
          </div>
        </fieldset>
        {error && <p className="m-0 text-sm text-[#F87171]">{error}</p>}
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onCancel} className="h-10 flex-1 rounded-xl border border-line text-sm hover:bg-white/5">Cancel</button>
          <button type="submit" disabled={!ready || busy} className="h-10 flex-1 rounded-xl bg-white text-sm font-semibold text-black hover:bg-zinc-200 disabled:opacity-40">{busy ? "Adding…" : "Add job"}</button>
        </div>
      </form>
    </Popup>
  );
}

/* ───────────── The tab ───────────── */

type Open = { kind: "info" | "delete"; id: string } | { kind: "add" } | null;

export function JobsView() {
  const [tracker, setTracker] = useState<Tracker | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [day, setDay] = useState<string | null>(null);
  const [open, setOpen] = useState<Open>(null);
  const [toast, setToast] = useState("");
  const [now] = useState(() => new Date());

  const load = useCallback(async () => {
    const response = await fetch("/api/app/tracker").catch(() => null);
    const body = await response?.json().catch(() => ({}));
    if (!response?.ok) throw new Error(body?.error || "Couldn't load your jobs.");
    return body as Tracker;
  }, []);

  useEffect(() => {
    let cancelled = false;
    load()
      .then((next) => { if (!cancelled) setTracker(next); })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Couldn't load your jobs."); });
    return () => { cancelled = true; };
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  const rows = useMemo<Row[]>(() => (tracker?.jobs ?? []).map((job) => ({ job, progress: progressOf(job) })), [tracker]);
  const byDay = useMemo(() => activityByDay(rows.map((row) => row.job)), [rows]);
  const grid = useMemo(() => activityGrid(now, WEEKS), [now]);
  const todayKey = dayKey(now);
  const streak = useMemo(() => longestRun(grid, byDay, now), [grid, byDay, now]);

  const stats = useMemo(() => {
    const since = weekStart(now).getTime();
    const applied = rows.filter(({ job }) => isApplied(job));
    return {
      applied: applied.length,
      week: applied.filter(({ job }) => countsTowardGoals(job as never) && appliedOn(job as never).getTime() >= since).length,
      reach: rows.filter((row) => matches(row, "reach")).length,
      interview: rows.filter((row) => matches(row, "interview")).length,
    };
  }, [rows, now]);

  const refresh = async (message: string) => {
    setOpen(null);
    setToast(message);
    try { setTracker(await load()); } catch { /* the list stays as it was */ }
  };

  if (error) return <p className="rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">{error}</p>;
  if (!tracker) return <SpiderLoader label="Loading your jobs…" />;

  const picked = day ? byDay.get(day) ?? [] : [];
  const pickedIds = new Set(picked.map((event) => event.job.id));
  const words = query.trim().toLowerCase();
  const shown = rows
    .filter((row) => (!day || pickedIds.has(row.job.id)) && matches(row, filter) && (!words || `${row.job.title} ${row.job.company}`.toLowerCase().includes(words)))
    .sort((a, b) => appliedOn(b.job as never).getTime() - appliedOn(a.job as never).getTime());
  const current = open && open.kind !== "add" ? rows.find((row) => row.job.id === open.id) ?? null : null;
  const pickedDate = day ? grid.flat().find((date) => dayKey(date) === day) : null;
  const streakStart = streak.end ? new Date(streak.end.getFullYear(), streak.end.getMonth(), streak.end.getDate() - streak.length + 1) : null;

  return (
    <section className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Jobs</h1>
          <p className="text-[15px] text-[#9A9AA3]">Every job you applied to, and every day you did something about it. The extension keeps this up to date.</p>
        </div>
        <button type="button" onClick={() => setOpen({ kind: "add" })} className="inline-flex h-11 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-black shadow-[3px_3px_0_#3D8BFF] transition-transform hover:translate-x-px hover:translate-y-px hover:shadow-[2px_2px_0_#3D8BFF]">
          <span className="text-lg leading-none">+</span> Add job
        </button>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["Applied", stats.applied], ["This week", tracker.weeklyGoal ? `${stats.week} / ${tracker.weeklyGoal}` : stats.week], ["Need an email", stats.reach], ["Interviewing", stats.interview]].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-[#1F1F24] bg-[#0C0C0E] px-4 py-3">
            <dt className="font-mono text-[11px] uppercase tracking-[1.4px] text-[#8B8B94]">{label}</dt>
            <dd className="m-0 mt-1 text-2xl font-bold tabular-nums tracking-tight">{value}</dd>
          </div>
        ))}
      </dl>

      {/* The calendar. */}
      <div className="flex flex-col gap-5 rounded-2xl border border-[#1F1F24] bg-[#0A0A0C] p-4 sm:p-5 lg:flex-row">
        <div className="flex flex-col gap-2">
          <p className="m-0 font-mono text-[11px] uppercase tracking-[1.4px] text-[#8B8B94]">Every day you did something</p>
          <div className="app-scroll flex gap-1 overflow-x-auto pb-1">
            <div className="flex flex-col gap-1 pr-1 pt-5 font-mono text-[10px] text-[#5C5C66]">
              {["M", "T", "W", "T", "F", "S", "S"].map((letter, index) => <span key={index} className="grid h-[20px] items-center">{letter}</span>)}
            </div>
            {grid.map((week, index) => (
              <div key={dayKey(week[0])} className="flex flex-col gap-1">
                <span className="h-4 w-[20px] overflow-visible whitespace-nowrap font-mono text-[10px] text-[#5C5C66]">{index % 3 === 0 ? short(week[0]) : ""}</span>
                {week.map((date) => {
                  const key = dayKey(date);
                  if (date > now && key !== todayKey) return <span key={key} className="h-[20px] w-[20px] rounded-[4px] border border-dashed border-[#1F1F24]" />;
                  const count = byDay.get(key)?.length ?? 0;
                  return (
                    <button key={key} type="button" aria-label={`${short(date)}: ${count} ${count === 1 ? "thing" : "things"}`} aria-pressed={day === key} onClick={() => setDay(day === key ? null : key)}
                      className={`h-[20px] w-[20px] rounded-[4px] outline-offset-1 transition-transform hover:scale-110 ${day === key ? "outline-2 outline-[#F7F7F8]" : ""} ${key === todayKey ? "ring-1 ring-[#3D8BFF]" : ""}`}
                      style={{ background: HEAT[Math.min(count, 4)] }} />
                  );
                })}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-1.5 font-mono text-[10px] text-[#5C5C66]">less {HEAT.map((color) => <i key={color} className="h-2.5 w-2.5 rounded-[2px]" style={{ background: color }} />)} more</div>
        </div>
        <div className="flex min-h-[150px] min-w-0 flex-1 flex-col gap-2 rounded-xl border border-[#1F1F24] bg-[#0C0C0E] p-4">
          {!day || !pickedDate ? (
            <>
              <p className="m-0 text-[15px] font-medium">Tap a day to see what happened</p>
              <p className="m-0 text-sm text-muted">
                Green days are days you applied, emailed someone or heard back.
                {streak.length > 1 && streakStart && streak.end ? <> Your longest run is <b className="text-cream">{streak.length} days</b> ({short(streakStart)} – {short(streak.end)}).</> : null}
              </p>
            </>
          ) : (
            <>
              <p className="m-0 flex items-center justify-between gap-2 text-[15px] font-medium">
                <span>{short(pickedDate)} <span className="text-muted">· {ago(pickedDate, now)}</span></span>
                <button type="button" onClick={() => setDay(null)} className="text-[13px] font-normal text-muted underline-offset-4 hover:text-white hover:underline">Show all days</button>
              </p>
              {picked.length ? picked.map((event) => (
                <p key={`${event.job.id}-${event.kind}`} className="m-0 flex min-w-0 items-center gap-2 text-sm">
                  <span className="w-4 flex-none text-center" style={{ color: MARK[event.kind].color }}>{MARK[event.kind].glyph}</span>
                  <span className="flex-none">{MARK[event.kind].label}</span><span className="truncate text-muted">· {companyOf(event.job)}, {titleOf(event.job)}</span>
                </p>
              )) : <p className="m-0 text-sm text-muted">A quiet day. Nothing logged.</p>}
            </>
          )}
        </div>
      </div>

      {/* The jobs. */}
      <div className="flex flex-col gap-3">
        <input id="jobs-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search jobs or companies" aria-label="Search jobs or companies" className="h-11 w-full rounded-xl border border-[#26262C] bg-[#0C0C0E] px-4 text-sm text-[#F7F7F8] placeholder:text-[#8B8B94] focus:border-[#3D8BFF] focus:outline-none" />
        <div role="group" aria-label="Show" className="flex flex-wrap gap-2">
          {FILTERS.map(([value, label]) => (
            <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)} className={`h-8 rounded-full border px-3 text-[13px] font-medium ${filter === value ? "border-[#F7F7F8] bg-[#F7F7F8] text-[#070708]" : "border-[#26262C] text-[#B4B4BC] hover:text-white"}`}>
              {label} <b className="font-mono text-[11px] opacity-70">{rows.filter((row) => matches(row, value)).length}</b>
            </button>
          ))}
          {day && pickedDate && <button type="button" onClick={() => setDay(null)} className="h-8 rounded-full border border-[#3D8BFF] px-3 text-[13px] text-[#C7D7FF]">{short(pickedDate)} ×</button>}
        </div>
      </div>

      {shown.length ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {shown.map((row) => (
            <li key={row.job.id} className={`flex items-center gap-3 rounded-xl border border-line bg-card px-3 py-3 transition-colors hover:border-[#3A3A42] sm:px-4 ${row.progress.ended === "Rejected" ? "opacity-60" : ""}`}>
              <Tile name={companyOf(row.job)} />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate text-[15px] font-medium">{titleOf(row.job)}</span>
                <span className="truncate text-[13px] text-[#8B8B94]">{companyOf(row.job)} · {isApplied(row.job) ? `applied ${short(appliedOn(row.job as never))}` : "not applied yet"}</span>
                <span className="sm:hidden"><Status row={row} /></span>
              </div>
              <span className="hidden sm:block"><Status row={row} /></span>
              <button type="button" onClick={() => setOpen({ kind: "info", id: row.job.id })} className="h-9 flex-none rounded-lg border border-line px-3 text-[13px] font-medium hover:border-[#F7F7F8] hover:bg-white/5">More info</button>
              <button type="button" aria-label={`Delete ${companyOf(row.job)}, ${titleOf(row.job)}`} onClick={() => setOpen({ kind: "delete", id: row.job.id })} className="grid h-9 w-9 flex-none place-items-center rounded-lg text-[#5C5C66] hover:bg-[#2A1A1A] hover:text-[#F87171]">
                <svg aria-hidden viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.8 6.5v4.5M9.2 6.5v4.5" /></svg>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-[#1F1F24] bg-[#0C0C0E] px-5 py-10 text-center">
          <Spider />
          <p className="m-0 text-sm text-[#9A9AA3]">{rows.length ? "No jobs match that." : "No jobs yet. Apply somewhere with the extension open, or add one here."}</p>
          {!rows.length && <button type="button" onClick={() => setOpen({ kind: "add" })} className="h-9 rounded-xl bg-white px-4 text-sm font-semibold text-black">+ Add job</button>}
        </div>
      )}

      {open?.kind === "add" && <AddPopup onCancel={() => setOpen(null)} onAdded={(company) => { setDay(null); void refresh(`Added ${company}.`); }} />}
      {open?.kind === "info" && current && <InfoPopup row={current} now={now} onClose={() => setOpen(null)} onDelete={() => setOpen({ kind: "delete", id: current.job.id })} />}
      {open?.kind === "delete" && current && (
        <DeletePopup job={current.job} onCancel={() => setOpen(null)} onDeleted={() => {
          setTracker((list) => (list ? { ...list, jobs: list.jobs.filter((job) => job.id !== current.job.id) } : list));
          setOpen(null);
          setToast(`Deleted ${companyOf(current.job)}.`);
        }} />
      )}
      {toast && <div role="status" className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full border border-line bg-[#141416] px-4 py-2 text-sm shadow-xl">{toast}</div>}
    </section>
  );
}
