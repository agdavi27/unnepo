"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { SpiderLoader } from "@/components/unnepo/spider-loader";
import { PeoplePanel } from "@/components/unnepo/people-panel";
import { Popup } from "@/components/unnepo/popup";
import { H, ON_DARK, W, spiderRects } from "@/extension/src/shared/sprite";
import { STEPS, STEP_LABEL, progressOf, type Progress } from "@/lib/apply/progress";
import { appliedOn, countsTowardGoals, dayKey, weekStart } from "@/lib/apply/stats";
import type { TrackerJob } from "@/lib/extension/service";
import { ACTIVITY_HEAT, ACTIVITY_MARK, activityByDay, activityGrid, activityOf, longestRun } from "@/lib/apply/calendar";

/**
 * The website's Jobs tab: a calendar of every day the student did something (applied, emailed someone, heard
 * back), then every job with where it is (Applied → Reach out → Waiting → Follow up → Interview). A job's More
 * info opens its details over the page, with the people at the company: find them, write each an email and send it
 * in Gmail. Jobs can be added by hand and deleted here; the extension does the rest.
 */

type Tracker = { jobs: TrackerJob[]; weeklyGoal: number | null; free?: boolean; peopleBadge?: string; peopleNote?: string };
type Row = { job: TrackerJob; progress: Progress };
type Filter = "all" | "reach" | "waiting" | "follow" | "interview" | "hidden";
const FILTERS: Array<[Filter, string]> = [["all", "All"], ["reach", "Reach out"], ["waiting", "Waiting"], ["follow", "Follow up"], ["interview", "Interview"], ["hidden", "Hidden"]];
const isApplied = (job: TrackerJob) => job.status === "submitted" || job.status === "applied_manual";
/** Hidden by the student: off every list but "Hidden", still counted as applied. */
const isHidden = (job: TrackerJob) => job.fillReport?.jobHidden === true;

function matches({ job, progress }: Row, filter: Filter) {
  if (filter === "hidden") return isHidden(job);
  if (isHidden(job)) return false;
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

const OUTCOME_LABEL: Array<[string, string]> = [["submitted", "Applied"], ["follow_up", "Follow up"], ["assessment", "Assessment"], ["interviewing", "Interviewing"], ["offer", "Offer"], ["rejected", "Rejected"]];

/**
 * The job's status as a menu, in its popup: Not applied (until it is), Applied, then what happened after. A job not
 * applied to yet is marked applied first; "Applied" clears an outcome. The list is read again after each change.
 */
function StatusMenu({ row, onChanged, wide = false }: { row: Row; onChanged: (note: string) => void; wide?: boolean }) {
  const { job } = row;
  const applied = isApplied(job);
  const current = applied ? job.fillReport?.outcome ?? "submitted" : "not_applied";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { color } = statusOf(row);
  const change = async (next: string) => {
    if (next === current) return;
    setBusy(true);
    setError("");
    const send = async (path: string, method: string, body: unknown) => {
      const response = await fetch(`/api/apply/${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
      const payload = await response?.json().catch(() => ({}));
      if (!response?.ok) throw new Error(payload?.error || "Couldn't change it. Try again.");
    };
    try {
      if (!applied) await send("applied", "POST", { applicationId: job.id });
      if (next !== "submitted" || applied) await send("outcome", "PATCH", { applicationId: job.id, outcome: next === "submitted" ? null : next });
      onChanged(`Status: ${OUTCOME_LABEL.find(([value]) => value === next)?.[1] ?? "Applied"}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't change it.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className={`${wide ? "flex" : "inline-flex"} flex-col gap-1`}>
      <select
        aria-label="Status"
        value={current}
        disabled={busy}
        onChange={(event) => void change(event.target.value)}
        className={`cursor-pointer border bg-[#0C0C0E] font-medium disabled:opacity-60 ${wide ? "h-10 w-full rounded-xl px-3 text-sm" : "h-8 rounded-full px-3 text-[13px]"}`}
        style={{ color, borderColor: `${color}66` }}
      >
        {!applied && <option value="not_applied">Not applied</option>}
        {OUTCOME_LABEL.filter(([value]) => value !== "assessment" || current === "assessment").map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      {error && <span role="alert" className="text-[12px] text-[#F87171]">{error}</span>}
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

/** The five steps down the side, each with the day it happened, and NOW (or DUE) on the one it's on. */
function StepsList({ job, progress }: { job: TrackerJob; progress: Progress }) {
  const events = eventsOf(job);
  const on = (kind: string) => events.find((event) => event.kind === kind)?.at ?? null;
  const dates = [appliedOn(job as never), on("emailed"), null, on("follow_up"), on("interview")];
  return (
    <ol aria-label="Progress" className={`m-0 flex list-none flex-col p-0 ${progress.ended === "Rejected" ? "opacity-50" : ""}`}>
      {STEPS.map((step, index) => {
        const state = index < progress.done ? "done" : index === progress.done && !progress.ended ? (progress.due ? "due" : "now") : "";
        const date = state === "done" ? dates[index] : null;
        return (
          <li key={step} aria-current={state === "now" || state === "due" ? "step" : undefined} className="relative flex items-center gap-3 pb-3 text-sm last:pb-0">
            {index < STEPS.length - 1 && <i aria-hidden className={`absolute left-[9px] top-5 h-[calc(100%-8px)] w-px ${index < progress.done ? "bg-[#4ADE80]/60" : "bg-[#1F1F24]"}`} />}
            {state === "done" ? <span className="relative grid h-5 w-5 flex-none place-items-center rounded-full bg-[#4ADE80] text-[11px] text-[#052E14]">✓</span>
              : state === "now" ? <span className="relative h-5 w-5 flex-none rounded-full border-2 border-[#3D8BFF] bg-[#0C0C0E] shadow-[0_0_0_4px_rgba(61,139,255,.15)]" />
              : state === "due" ? <span className="relative h-5 w-5 flex-none rounded-full border-2 border-[#F5A524] bg-[#0C0C0E] shadow-[0_0_0_4px_rgba(245,165,36,.15)]" />
              : <span className="relative h-5 w-5 flex-none rounded-full border border-[#26262C] bg-[#0C0C0E]" />}
            <span className={state === "now" ? "font-semibold text-[#8DB8FF]" : state === "due" ? "font-semibold text-[#F5A524]" : state === "done" ? "" : "text-[#5C5C66]"}>{step}</span>
            <span className={`ml-auto font-mono text-[11px] ${state === "now" ? "text-[#8DB8FF]" : state === "due" ? "text-[#F5A524]" : "text-[#5C5C66]"}`}>{state === "now" ? "NOW" : state === "due" ? "DUE" : date ? short(date) : ""}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** Hides a job from the lists, or shows it again. */
async function setJobHidden(jobId: string, hidden: boolean) {
  const response = await fetch("/api/apply/hide-job", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ applicationId: jobId, hidden }) }).catch(() => null);
  const body = await response?.json().catch(() => ({}));
  if (!response?.ok) throw new Error(body?.error || "Couldn't change it. Try again.");
}

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" /><circle cx="8" cy="8" r="2" />
      {off && <path d="M2.5 2.5l11 11" />}
    </svg>
  );
}

/** "Edit job info" in a job's popup: its title, company, location and posting link. Only what changed is sent. */
function EditJob({ job, onCancel, onSaved }: { job: TrackerJob; onCancel: () => void; onSaved: (note: string) => void }) {
  const [title, setTitle] = useState(job.titleMissing ? "" : job.title);
  const [company, setCompany] = useState(job.companyMissing ? "" : job.company);
  const [location, setLocation] = useState(job.location ?? "");
  const [url, setUrl] = useState(job.url ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const [t, c, l, u] = [title.trim(), company.trim(), location.trim(), url.trim()];
    if (t.length < 2) return setError("Type the job title.");
    if (c.length < 2) return setError("Type the company's name.");
    if (u && !/^https:\/\/\S+\.\S+/i.test(u)) return setError("The link should start with https://.");
    const changes = {
      ...(t !== job.title || job.titleMissing ? { title: t } : {}),
      ...(c !== job.company || job.companyMissing ? { company: c } : {}),
      ...(l !== (job.location ?? "") ? { location: l } : {}),
      ...(u !== (job.url ?? "") ? { url: u } : {}),
    };
    if (!Object.keys(changes).length) return onCancel();
    setBusy(true);
    setError("");
    const response = await fetch("/api/apply/details", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ applicationId: job.id, ...changes }) }).catch(() => null);
    const body = await response?.json().catch(() => ({}));
    setBusy(false);
    if (!response?.ok) return setError(body?.error || "Couldn't save it. Try again.");
    onSaved("company" in changes ? "Saved. A new company means a new search for its people." : "Saved.");
  };
  const label = "flex flex-col gap-1.5 text-[13px] text-[#B4B4BC]";
  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3 rounded-xl border border-[#1F1F24] bg-[#0A0A0C] p-4" aria-label="Edit job info">
      <p className="m-0 font-mono text-[11px] uppercase tracking-[1.4px] text-[#8B8B94]">Edit job info</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={label}>Job title<input autoFocus required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Software Engineering Intern" className="field" /></label>
        <label className={label}>Company<input required maxLength={200} value={company} onChange={(event) => setCompany(event.target.value)} placeholder="Stripe" className="field" /></label>
        <label className={label}>Location<input maxLength={200} value={location} onChange={(event) => setLocation(event.target.value)} placeholder="New York, NY (optional)" className="field" /></label>
        <label className={label}>Job link<input type="url" maxLength={2000} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://… (optional)" className="field" /></label>
      </div>
      {error && <p role="alert" className="m-0 text-sm text-[#F87171]">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="h-9 rounded-xl border border-line px-4 text-sm hover:bg-white/5">Cancel</button>
        <button type="submit" disabled={busy} className="h-9 rounded-xl bg-white px-4 text-sm font-semibold text-black hover:bg-zinc-200 disabled:opacity-50">{busy ? "Saving…" : "Save"}</button>
      </div>
    </form>
  );
}

/* ───────────── Popups ───────────── */

function InfoPopup({ row, now, tracker, onClose, onDelete, onHide, onChanged, reload, say }: { row: Row; now: Date; tracker: Tracker; onClose: () => void; onDelete: () => void; onHide: () => void; onChanged: (note: string) => void; reload: () => Promise<void>; say: (message: string) => void }) {
  const { job, progress } = row;
  const events = eventsOf(job);
  const [editing, setEditing] = useState(false);
  const label = "m-0 font-mono text-[11px] uppercase tracking-[1.4px] text-[#5C5C66]";
  const action = "flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm";
  return (
    <Popup label={`${companyOf(job)}, ${titleOf(job)}`} onClose={onClose} width="max-w-4xl" bare>
      <div className="grid md:grid-cols-[minmax(0,1fr)_300px]">
        {/* The job and its people. */}
        <div className="flex min-w-0 flex-col gap-7 p-5 sm:p-7">
          <div className="flex items-start gap-4 pr-8 md:pr-0">
            <Tile name={companyOf(job)} size={56} />
            <div className="min-w-0 flex-1">
              <p className="m-0 truncate font-mono text-[11px] uppercase tracking-[1.6px] text-[#8B8B94]">{companyOf(job)}</p>
              {job.titleMissing ? (
                <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-dashed border-[#F5A524]/50 bg-[#F5A524]/[0.06] px-3 py-2">
                  <span aria-hidden className="font-semibold text-[#F5A524]">!</span>
                  <span className="text-sm text-[#F5D79A]">The job title didn&apos;t come through.</span>
                  <button type="button" onClick={() => setEditing(true)} className="ml-auto flex-none text-sm font-semibold text-[#F5A524] underline underline-offset-4">Add it</button>
                </div>
              ) : (
                <h2 className="m-0 mt-1 text-xl font-semibold leading-snug tracking-tight sm:text-2xl">{job.title}</h2>
              )}
            </div>
          </div>
          {editing && <EditJob job={job} onCancel={() => setEditing(false)} onSaved={(note) => { setEditing(false); onChanged(note); }} />}
          <PeoplePanel job={job} free={Boolean(tracker.free)} badge={tracker.peopleBadge} note={tracker.peopleNote} reload={reload} say={say} />
        </div>

        {/* Where it is, its details, and what to do with it. */}
        <aside className="flex flex-col gap-6 border-t border-[#1F1F24] bg-[#08080A] p-5 sm:p-6 md:border-l md:border-t-0 md:pt-14">
          <div className="flex flex-col gap-2">
            <p className={label}>Status</p>
            <StatusMenu row={row} onChanged={onChanged} wide />
            <p className={`m-0 text-[13px] ${progress.due ? "text-[#F5A524]" : "text-[#9A9AA3]"}`}>{progress.next}</p>
          </div>
          {isApplied(job) && (
            <div className="flex flex-col gap-3">
              <p className={label}>Progress</p>
              <StepsList job={job} progress={progress} />
            </div>
          )}
          <div className="flex flex-col gap-2">
            <p className={label}>Details</p>
            <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
              <dt className="text-[#5C5C66]">Applied</dt><dd className="m-0 truncate text-right">{isApplied(job) ? `${short(appliedOn(job as never))}, ${ago(appliedOn(job as never), now)}` : "Not yet"}</dd>
              <dt className="text-[#5C5C66]">Location</dt><dd className={`m-0 truncate text-right ${job.location ? "" : "text-[#5C5C66]"}`}>{job.location || "—"}</dd>
              <dt className="text-[#5C5C66]">Posting</dt><dd className="m-0 text-right">{job.url ? <a href={job.url} target="_blank" rel="noreferrer" className="underline underline-offset-4">Open ↗</a> : <span className="text-[#5C5C66]">—</span>}</dd>
            </dl>
          </div>
          {events.length > 1 && (
            <div className="flex flex-col gap-2">
              <p className={label}>What happened</p>
              <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
                {events.map((event) => (
                  <li key={`${event.day}-${event.kind}`} className="flex items-center gap-2 text-[13px]">
                    <span className="w-4 flex-none text-center" style={{ color: MARK[event.kind].color }}>{MARK[event.kind].glyph}</span>
                    <span className="min-w-0 flex-1 truncate">{MARK[event.kind].label}</span>
                    <span className="font-mono text-[11px] text-[#5C5C66]">{short(event.at)}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          <div className="mt-auto flex flex-col gap-0.5 border-t border-[#1F1F24] pt-4">
            {!editing && (
              <button type="button" onClick={() => setEditing(true)} className={`${action} text-[#B4B4BC] hover:bg-white/5 hover:text-white`}>
                <svg aria-hidden viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 2.5l2.5 2.5L6 12.5H3.5V10z" /></svg>Edit job info
              </button>
            )}
            {isApplied(job) && <button type="button" onClick={onHide} className={`${action} text-[#B4B4BC] hover:bg-white/5 hover:text-white`}><EyeIcon off={!isHidden(job)} />{isHidden(job) ? "Show job" : "Hide job"}</button>}
            <button type="button" onClick={onDelete} className={`${action} text-[#F87171] hover:bg-[#2A1A1A]`}>
              <svg aria-hidden viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4" /></svg>Delete job
            </button>
          </div>
        </aside>
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

export function JobsView({ openJob }: { openJob?: string | null } = {}) {
  const [tracker, setTracker] = useState<Tracker | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [day, setDay] = useState<string | null>(null);
  // Home's "Email someone" opens a job's popup straight away.
  const [open, setOpen] = useState<Open>(openJob ? { kind: "info", id: openJob } : null);
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

  /** Reads the list again, for the people on an open job (it stays open). */
  const reload = useCallback(async () => {
    try { setTracker(await load()); } catch { /* the list stays as it was */ }
  }, [load]);

  /** Hide or show a job: moved at once, saved behind it. */
  const toggleHidden = async (job: TrackerJob) => {
    const hidden = !isHidden(job);
    const flip = (list: Tracker | null, value: boolean) => (list ? { ...list, jobs: list.jobs.map((item) => (item.id === job.id ? { ...item, fillReport: { ...(item.fillReport ?? { outcome: null, peopleReveals: 0 }), jobHidden: value } as TrackerJob["fillReport"] } : item)) } : list);
    setTracker((list) => flip(list, hidden));
    setOpen(null);
    setToast(hidden ? `Hid ${companyOf(job)}. It's under Hidden and still counts as applied.` : `${companyOf(job)} is back on your list.`);
    try { await setJobHidden(job.id, hidden); } catch (reason) {
      setTracker((list) => flip(list, !hidden));
      setToast(reason instanceof Error ? reason.message : "Couldn't change it.");
    }
  };

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
          {FILTERS.filter(([value]) => value !== "hidden" || filter === "hidden" || rows.some((row) => isHidden(row.job))).map(([value, label]) => (
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
              {isApplied(row.job) && (
                <button type="button" title={isHidden(row.job) ? "Show job" : "Hide job"} aria-label={`${isHidden(row.job) ? "Show" : "Hide"} ${companyOf(row.job)}, ${titleOf(row.job)}`} onClick={() => void toggleHidden(row.job)} className="grid h-9 w-9 flex-none place-items-center rounded-lg text-[#5C5C66] hover:bg-white/5 hover:text-white">
                  <EyeIcon off={!isHidden(row.job)} />
                </button>
              )}
              <button type="button" aria-label={`Delete ${companyOf(row.job)}, ${titleOf(row.job)}`} onClick={() => setOpen({ kind: "delete", id: row.job.id })} className="grid h-9 w-9 flex-none place-items-center rounded-lg text-[#5C5C66] hover:bg-[#2A1A1A] hover:text-[#F87171]">
                <svg aria-hidden viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.8 6.5v4.5M9.2 6.5v4.5" /></svg>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-[#1F1F24] bg-[#0C0C0E] px-5 py-10 text-center">
          <Spider />
          <p className="m-0 text-sm text-[#9A9AA3]">{filter === "hidden" ? "No hidden jobs." : rows.length ? "No jobs match that." : "No jobs yet. Apply somewhere with the extension open, or add one here."}</p>
          {!rows.length && <button type="button" onClick={() => setOpen({ kind: "add" })} className="h-9 rounded-xl bg-white px-4 text-sm font-semibold text-black">+ Add job</button>}
        </div>
      )}

      {open?.kind === "add" && <AddPopup onCancel={() => setOpen(null)} onAdded={(company) => { setDay(null); void refresh(`Added ${company}.`); }} />}
      {open?.kind === "info" && current && <InfoPopup row={current} now={now} tracker={tracker} onClose={() => setOpen(null)} onDelete={() => setOpen({ kind: "delete", id: current.job.id })} onHide={() => void toggleHidden(current.job)} onChanged={(note) => { void load().then(setTracker, () => undefined); setToast(note); }} reload={reload} say={setToast} />}
      {open?.kind === "delete" && current && (
        <DeletePopup job={current.job} onCancel={() => setOpen(null)} onDeleted={() => {
          setTracker((list) => (list ? { ...list, jobs: list.jobs.filter((job) => job.id !== current.job.id) } : list));
          setOpen(null);
          setToast(`Deleted ${companyOf(current.job)}.`);
        }} />
      )}
      {toast && <div role="status" className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-full border border-line bg-[#141416] px-4 py-2 text-sm shadow-xl">{toast}</div>}
    </section>
  );
}
