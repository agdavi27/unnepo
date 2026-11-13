"use client";

import { useEffect, useMemo, useState } from "react";
import { SpiderLoader } from "@/components/unnepo/spider-loader";
import { appliedOn, countsTowardGoals, dayKey, weekStart } from "@/lib/apply/stats";

/**
 * Goals: what the student is aiming for, each with how far along they are right now. The weekly goal is the main
 * one (it fills the bar on the extension's Jobs tab); the rest are optional, and a blank box turns one off.
 * Saved to the profile, the same place the extension reads them from.
 */

type Key = "dailyGoal" | "weeklyGoal" | "monthlyGoal" | "streakGoal" | "weeklyEmailGoal" | "monthlyInterviewGoal";
type App = {
  status: string; createdAt: string; submittedAt: string | null; updatedAt?: string;
  fillReport?: { notCounted?: boolean; outcome?: string | null; emailedAt?: Record<string, string>; reachedOut?: { count: number; at: string } } | null;
};
type Profile = Partial<Record<Key, number>>;

type Goal = { key: Key; label: string; unit: string; least: number; most: number; hint: string; required?: boolean; main?: boolean };
const GROUPS: Array<{ title: string; note: string; goals: Goal[] }> = [
  {
    title: "Applications",
    note: "How many jobs you want to apply to.",
    goals: [
      { key: "weeklyGoal", label: "Per week", unit: "applications", least: 1, most: 200, hint: "Fills the bar on the extension's Jobs tab, Monday to Sunday.", required: true, main: true },
      { key: "dailyGoal", label: "Per day", unit: "applications", least: 1, most: 50, hint: "Today's bar in the extension. Until you set one, it's a fifth of your weekly goal.", required: true },
      { key: "monthlyGoal", label: "Per month", unit: "applications", least: 1, most: 800, hint: "Optional. Counts from the 1st of the month." },
    ],
  },
  {
    title: "Momentum",
    note: "Optional. Leave a box empty to turn that goal off.",
    goals: [
      { key: "streakGoal", label: "Streak", unit: "days in a row", least: 2, most: 365, hint: "Days in a row with at least one application." },
      { key: "weeklyEmailGoal", label: "People emailed", unit: "per week", least: 1, most: 100, hint: "Recruiters and people on the team you reached out to." },
      { key: "monthlyInterviewGoal", label: "Interviews", unit: "per month", least: 1, most: 50, hint: "Jobs that moved to Interviewing this month." },
    ],
  },
];
const ALL = GROUPS.flatMap((group) => group.goals);

const isApplied = (app: App) => app.status === "submitted" || app.status === "applied_manual";

/** Where the student is now, for each goal. */
function progressNow(apps: App[], now = new Date()) {
  const counted = apps.filter((app) => isApplied(app) && countsTowardGoals(app as never));
  const days = new Set(counted.map((app) => dayKey(appliedOn(app as never))));
  const today = dayKey(now);
  const week = weekStart(now).getTime();
  const month = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const since = (from: number) => counted.filter((app) => appliedOn(app as never).getTime() >= from).length;
  // Days in a row, ending today, or yesterday so it lasts until tonight.
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!days.has(today)) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (days.has(dayKey(cursor))) { streak += 1; cursor.setDate(cursor.getDate() - 1); }
  const emails = apps.reduce((sum, app) => {
    const sent = Object.values(app.fillReport?.emailedAt ?? {}).filter((at) => Date.parse(at) >= week).length;
    const own = app.fillReport?.reachedOut && !sent && Date.parse(app.fillReport.reachedOut.at) >= week ? app.fillReport.reachedOut.count : 0;
    return sum + sent + own;
  }, 0);
  const interviews = apps.filter((app) => app.fillReport?.outcome === "interviewing" && Date.parse(app.updatedAt ?? app.createdAt) >= month).length;
  return {
    dailyGoal: { now: counted.filter((app) => dayKey(appliedOn(app as never)) === today).length, when: "today" },
    weeklyGoal: { now: since(week), when: "this week" },
    monthlyGoal: { now: since(month), when: "this month" },
    streakGoal: { now: streak, when: streak === 1 ? "day now" : "days now" },
    weeklyEmailGoal: { now: emails, when: "this week" },
    monthlyInterviewGoal: { now: interviews, when: "this month" },
  } satisfies Record<Key, { now: number; when: string }>;
}

export function GoalsView() {
  const [apps, setApps] = useState<App[] | null>(null);
  const [saved, setSaved] = useState<Profile>({});
  const [draft, setDraft] = useState<Record<Key, string>>(() => Object.fromEntries(ALL.map((goal) => [goal.key, ""])) as Record<Key, string>);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/apply")
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || "Couldn't load your goals.");
        return body as { applications: App[]; profile: Profile };
      })
      .then((body) => {
        if (cancelled) return;
        setApps(body.applications);
        const profile = Object.fromEntries(ALL.map((goal) => [goal.key, body.profile[goal.key]])) as Profile;
        setSaved(profile);
        setDraft(Object.fromEntries(ALL.map((goal) => [goal.key, profile[goal.key] ? String(profile[goal.key]) : ""])) as Record<Key, string>);
      })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Couldn't load your goals."); });
    return () => { cancelled = true; };
  }, []);

  const progress = useMemo(() => (apps ? progressNow(apps) : null), [apps]);

  /** What changed, and whether each box holds a number the server will take. */
  const changes = useMemo(() => {
    const out: Partial<Record<Key, number | null>> = {};
    const problems: string[] = [];
    for (const goal of ALL) {
      const text = draft[goal.key].trim();
      const before = saved[goal.key];
      if (!text) {
        // The weekly and daily goals can't be turned off once set; the others can.
        if (before && goal.required) problems.push(`${goal.label} can't be empty. Pick a number from ${goal.least} to ${goal.most}.`);
        else if (before) out[goal.key] = null;
        continue;
      }
      const value = Number(text);
      if (!Number.isInteger(value) || value < goal.least || value > goal.most) {
        problems.push(`${GROUPS.find((group) => group.goals.includes(goal))!.title === "Applications" ? `${goal.label} (applications)` : goal.label}: pick a whole number from ${goal.least} to ${goal.most}.`);
        continue;
      }
      if (value !== before) out[goal.key] = value;
    }
    return { out, problems };
  }, [draft, saved]);
  const dirty = Object.keys(changes.out).length > 0;

  async function save() {
    if (!dirty || busy || changes.problems.length) return;
    setBusy(true);
    setStatus("");
    const response = await fetch("/api/apply/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changes.out) }).catch(() => null);
    const body = await response?.json().catch(() => ({}));
    setBusy(false);
    if (!response?.ok) { setStatus(body?.error || "Couldn't save. Try again."); return; }
    const next = { ...saved };
    for (const [key, value] of Object.entries(changes.out) as Array<[Key, number | null]>) {
      if (value === null) delete next[key];
      else next[key] = value;
    }
    setSaved(next);
    setStatus("Saved. The extension shows the new goals the next time it refreshes.");
  }

  const step = (goal: Goal, by: number) => {
    const current = Number(draft[goal.key]) || (by > 0 ? goal.least - 1 : goal.least);
    const next = Math.min(goal.most, Math.max(goal.least, current + by));
    setDraft((old) => ({ ...old, [goal.key]: String(next) }));
    setStatus("");
  };

  if (error) return <p className="text-sm text-[#F87171]">{error}</p>;
  if (!progress) return <SpiderLoader label="Loading your goals…" />;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        <h1 className="m-0 text-3xl font-bold tracking-tight md:text-4xl">Goals</h1>
        <p className="m-0 mt-2 text-sm text-muted">What you&apos;re aiming for, and where you are right now. Your weekly goal is the bar on the extension&apos;s Jobs tab.</p>
      </div>

      {GROUPS.map((group) => (
        <section key={group.title} className="rounded-2xl border border-[#1F1F24] bg-[#0C0C0E] p-4 sm:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="m-0 font-mono text-[11px] font-semibold uppercase tracking-[1.4px] text-[#8B8B94]">{group.title}</h2>
            <p className="m-0 text-xs text-[#8B8B94]">{group.note}</p>
          </div>
          <ul className="m-0 mt-2 flex list-none flex-col p-0">
            {group.goals.map((goal) => {
              const { now, when } = progress[goal.key];
              const target = Number(draft[goal.key]) || 0;
              const pct = target ? Math.min(100, Math.round((now / target) * 100)) : 0;
              const done = target > 0 && now >= target;
              return (
                <li key={goal.key} className="flex flex-col gap-2 border-t border-[#17171B] py-4 first:border-t-0">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <div className="min-w-0 flex-1">
                      <p className="m-0 flex items-center gap-2 font-medium">
                        {goal.label}
                        {goal.main && <span className="rounded-md border border-[#3D8BFF] px-1.5 text-[11px] font-semibold text-[#3D8BFF]">Main goal</span>}
                      </p>
                      <p className="m-0 mt-0.5 text-[13px] text-[#8B8B94]">{goal.hint}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => step(goal, -1)} aria-label={`Lower ${goal.label.toLowerCase()} goal`} className="h-9 w-9 rounded-full border border-[#26262C] text-lg leading-none text-[#B4B4BC] hover:text-white">−</button>
                      <input
                        inputMode="numeric"
                        aria-label={`${goal.label} goal, ${goal.unit}`}
                        value={draft[goal.key]}
                        placeholder={goal.required ? String(goal.least) : "Off"}
                        onChange={(event) => { setDraft((old) => ({ ...old, [goal.key]: event.target.value.replace(/[^\d]/g, "").slice(0, 3) })); setStatus(""); }}
                        className="field !h-9 !w-16 !px-2 text-center tabular-nums"
                      />
                      <button type="button" onClick={() => step(goal, 1)} aria-label={`Raise ${goal.label.toLowerCase()} goal`} className="h-9 w-9 rounded-full border border-[#26262C] text-lg leading-none text-[#B4B4BC] hover:text-white">+</button>
                      <span className="w-28 whitespace-nowrap text-[13px] text-[#8B8B94]">{goal.unit}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#1C1C21]" role="progressbar" aria-label={`${goal.label} progress`} aria-valuemin={0} aria-valuemax={target || 1} aria-valuenow={Math.min(now, target || now)}>
                      <div className="h-full rounded-full" style={{ width: `${target ? pct : 0}%`, background: done ? "#4ADE80" : "#3D8BFF" }} />
                    </div>
                    <span className={`w-36 text-right font-mono text-xs ${done ? "text-[#4ADE80]" : "text-[#9A9AA3]"}`}>{target ? `${now} / ${target} ${when}` : `${now} ${when}`}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <div className="flex flex-wrap items-center justify-end gap-3">
        {changes.problems.length > 0 && <p className="m-0 mr-auto text-sm text-[#F5A524]">{changes.problems[0]}</p>}
        {!changes.problems.length && status && <p className="m-0 mr-auto text-sm text-[#9A9AA3]" role="status">{status}</p>}
        <button type="button" onClick={() => void save()} disabled={!dirty || busy || changes.problems.length > 0} className="h-10 rounded-xl bg-white px-5 text-sm font-semibold text-black hover:bg-zinc-200 disabled:opacity-40">{busy ? "Saving…" : "Save goals"}</button>
      </div>
    </div>
  );
}
