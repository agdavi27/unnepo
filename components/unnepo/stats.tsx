"use client";

import { useMemo, useState } from "react";
import type { App } from "@/components/unnepo/apply";
import { AtsBadge } from "@/components/unnepo/company";
import { applicationStats } from "@/lib/apply/stats";

const card = "rounded-2xl border border-line bg-panel p-5";
const sectionTitle = "text-xs font-semibold uppercase tracking-wider text-faint";
const NEUTRAL = "#3A3A42";
const ACCENT = "#3D8BFF";

function dayLabel(key: string, style: "short" | "long" = "short") {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return style === "long" ? date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function duration(minutes: number | null) {
  if (minutes === null) return "—";
  if (minutes < 1) return `${Math.max(1, Math.round(minutes * 60))}s`;
  if (minutes < 60) return `${Math.round(minutes)} min`;
  return `${(minutes / 60).toFixed(1)} h`;
}

export function StatsPage({ applications, weeklyGoal, onGoal }: { applications: App[]; weeklyGoal: number | null; onGoal: (goal: number) => Promise<void> }) {
  const stats = useMemo(() => applicationStats(applications), [applications]);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Stats</h1>
        <p className="mt-2 text-sm text-muted">How your search is going. Set an outcome on each job in Applied to fill in responses.</p>
      </div>
      <Goal thisWeek={stats.thisWeek} daysLeft={stats.daysLeft} streak={stats.streak} goal={weeklyGoal} onGoal={onGoal} />
      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line lg:grid-cols-4" aria-label="Totals">
        <Tile label="Applications" value={String(stats.applied)} note={stats.inProgress ? `${stats.inProgress} in progress` : "submitted"} />
        <Tile label="Responses" value={String(stats.responses)} note={stats.applied ? `${Math.round(stats.responseRate * 100)}% response rate` : "none yet"} />
        <Tile label="People reached" value={String(stats.peopleReached)} note="emailed or replied" />
        <Tile label="Time per app" value={duration(stats.medianMinutes)} note="typical, open to submit" />
      </section>
      <PerDay days={stats.perDay} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Funnel steps={[["Applied", stats.applied], ["Responded", stats.responses], ["Interviews", stats.interviews], ["Offers", stats.offers]]} />
        <Systems rows={stats.bySystem} />
      </div>
    </div>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="bg-panel p-5">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-2 text-3xl font-semibold tabular-nums tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-faint">{note}</p>
    </div>
  );
}

function Goal({ thisWeek, daysLeft, streak, goal, onGoal }: { thisWeek: number; daysLeft: number; streak: number; goal: number | null; onGoal: (goal: number) => Promise<void> }) {
  const [editing, setEditing] = useState(goal === null);
  const [draft, setDraft] = useState(String(goal ?? 10));
  const [state, setState] = useState("");
  const share = goal ? Math.min(1, thisWeek / goal) : 0;
  async function save() {
    const value = Math.round(Number(draft));
    if (!Number.isFinite(value) || value < 1 || value > 200) return setState("Pick a number from 1 to 200.");
    setState("Saving…");
    try {
      await onGoal(value);
      setEditing(false);
      setState("");
    } catch (reason) {
      setState(reason instanceof Error ? reason.message : "Couldn't save.");
    }
  }
  return (
    <section className={`${card} flex flex-col gap-4`} aria-label="Weekly goal">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className={sectionTitle}>This week</h2>
          <p className="mt-2 text-3xl font-semibold tabular-nums tracking-tight">
            {thisWeek}
            {goal !== null && <span className="text-lg font-normal text-muted"> / {goal} applications</span>}
          </p>
          <p className="mt-1 text-sm text-muted">
            {goal === null ? "Set a weekly goal to track your pace." : thisWeek >= goal ? "Goal reached. Nice work." : `${goal - thisWeek} to go, ${daysLeft} ${daysLeft === 1 ? "day" : "days"} left.`}
          </p>
        </div>
        <div className="text-right">
          <h2 className={sectionTitle}>Streak</h2>
          <p className="mt-2 text-3xl font-semibold tabular-nums tracking-tight">{streak}<span className="text-lg font-normal text-muted"> {streak === 1 ? "day" : "days"}</span></p>
          <p className="mt-1 text-sm text-muted">{streak ? "in a row with an application" : "apply today to start one"}</p>
        </div>
      </div>
      {goal !== null && (
        <div className="h-2 overflow-hidden rounded-full bg-card-2" role="progressbar" aria-valuemin={0} aria-valuemax={goal} aria-valuenow={Math.min(thisWeek, goal)} aria-label="Progress toward weekly goal">
          <div className="h-full rounded-full transition-[width]" style={{ width: `${share * 100}%`, background: share >= 1 ? "#4ADE80" : ACCENT }} />
        </div>
      )}
      {editing ? (
        <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <label className="text-sm text-muted" htmlFor="weekly-goal">Weekly goal</label>
          <input id="weekly-goal" type="number" min={1} max={200} inputMode="numeric" value={draft} onChange={(event) => setDraft(event.target.value)} className="w-20 rounded-lg border border-line bg-card px-2.5 py-1.5 text-sm tabular-nums text-ink outline-none focus:border-zinc-500" />
          <span className="text-sm text-muted">applications</span>
          <button type="submit" className="rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-black hover:bg-zinc-200">Save</button>
          {goal !== null && <button type="button" className="px-2 text-sm text-muted hover:text-white" onClick={() => { setEditing(false); setState(""); }}>Cancel</button>}
          {state && <span className="text-xs text-muted">{state}</span>}
        </form>
      ) : (
        <button type="button" className="self-start text-sm text-muted underline-offset-4 hover:text-white hover:underline" onClick={() => { setDraft(String(goal ?? 10)); setEditing(true); }}>Change goal</button>
      )}
    </section>
  );
}

/** Applications per day, the last 14 days. Today is the accent bar. */
function PerDay({ days }: { days: Array<{ date: string; count: number }> }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...days.map((day) => day.count));
  const top = max <= 4 ? max : Math.ceil(max / 2) * 2;
  const total = days.reduce((sum, day) => sum + day.count, 0);
  return (
    <section className={card} aria-labelledby="per-day-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="per-day-title" className="text-sm font-semibold">Applications per day</h2>
        <p className="text-xs text-faint tabular-nums">{total} in the last 14 days</p>
      </div>
      <div className="relative mt-5" onMouseLeave={() => setHover(null)} aria-hidden>
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-2">
          <span className="text-[10px] tabular-nums text-faint">{top}</span>
          <span className="h-px flex-1 border-t border-dashed border-line/70" />
        </div>
        <div className="flex h-40 items-end gap-[2px] border-b border-line pt-4 sm:gap-1.5">
          {days.map((day, index) => {
            const today = index === days.length - 1;
            return (
              <div key={day.date} className="relative flex h-full flex-1 items-end justify-center" onMouseEnter={() => setHover(index)} onFocus={() => setHover(index)}>
                <div
                  className="w-full max-w-7 rounded-t transition-opacity"
                  style={{ height: day.count ? `${(day.count / top) * 100}%` : 2, background: day.count ? (today ? ACCENT : NEUTRAL) : "#26262C", opacity: hover === null || hover === index ? 1 : 0.55 }}
                />
                {hover === index && (
                  <div className={`pointer-events-none absolute bottom-full z-10 mb-1 whitespace-nowrap rounded-lg border border-line bg-card px-2.5 py-1.5 text-xs shadow-lg ${index < 3 ? "left-0" : index > days.length - 4 ? "right-0" : "left-1/2 -translate-x-1/2"}`} style={{ bottom: `calc(${(day.count / top) * 100}% + 4px)` }}>
                    <span className="text-muted">{dayLabel(day.date, "long")}</span>
                    <span className="ml-2 font-semibold tabular-nums text-ink">{day.count}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex justify-between text-[11px] text-faint">
          <span>{dayLabel(days[0].date)}</span>
          <span>{dayLabel(days[7].date)}</span>
          <span style={{ color: ACCENT }}>Today</span>
        </div>
      </div>
      <table className="sr-only">
        <caption>Applications per day, last 14 days</caption>
        <thead><tr><th>Day</th><th>Applications</th></tr></thead>
        <tbody>{days.map((day) => <tr key={day.date}><td>{dayLabel(day.date, "long")}</td><td>{day.count}</td></tr>)}</tbody>
      </table>
    </section>
  );
}

function Bar({ share, color }: { share: number; color: string }) {
  return (
    <div className="h-2 flex-1 overflow-hidden rounded-full bg-card-2">
      <div className="h-full rounded-full" style={{ width: share ? `max(${share * 100}%, 4px)` : 0, background: color }} />
    </div>
  );
}

function Funnel({ steps }: { steps: Array<[string, number]> }) {
  const base = steps[0][1];
  return (
    <section className={card} aria-labelledby="funnel-title">
      <h2 id="funnel-title" className="text-sm font-semibold">From applied to offer</h2>
      <ul className="mt-4 space-y-3.5">
        {steps.map(([label, count], index) => (
          <li key={label} className="grid grid-cols-[6.5rem_minmax(0,1fr)_4.5rem] items-center gap-3 text-sm">
            <span className="text-muted">{label}</span>
            <Bar share={base ? count / base : 0} color={index === 0 ? NEUTRAL : ACCENT} />
            <span className="text-right tabular-nums">{count}{index > 0 && base > 0 && <span className="ml-1.5 text-xs text-faint">{Math.round((count / base) * 100)}%</span>}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Systems({ rows }: { rows: Array<{ ats: App["ats"]; count: number }> }) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  return (
    <section className={card} aria-labelledby="systems-title">
      <h2 id="systems-title" className="text-sm font-semibold">By job system</h2>
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-muted">Nothing submitted yet.</p>
      ) : (
        <ul className="mt-4 space-y-3.5">
          {rows.map((row) => (
            <li key={row.ats} className="grid grid-cols-[6.5rem_minmax(0,1fr)_4.5rem] items-center gap-3 text-sm">
              <span className="flex min-w-0 items-center text-muted"><AtsBadge ats={row.ats} label /></span>
              <Bar share={row.count / max} color={NEUTRAL} />
              <span className="text-right tabular-nums">{row.count}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
