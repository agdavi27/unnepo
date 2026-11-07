"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Lock, Pencil, X } from "lucide-react";
import type { App } from "@/components/unnepo/apply";
import { Funnel, PerDay, Systems, Tile, duration } from "@/components/unnepo/stats";
import { H as SPRITE_H, ON_DARK, W as SPRITE_W, spiderRects } from "@/extension/src/shared/sprite";
import { applicationStats } from "@/lib/apply/stats";
import { nextUp, type NextItem, type NextSection } from "@/lib/apply/next-up";
import { crawlerColors, nextSkin, wornSkin, type SpiderLook } from "@/lib/spiders";

/** The Home tab: what to do next, how it's going, and the next spider to unlock. */

export const DEFAULT_DAILY_GOAL = 3;
export const DEFAULT_WEEKLY_GOAL = 10;

const partOfDay = (hour: number) => (hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening");
const eyebrow = "m-0 font-mono text-[11px] font-medium uppercase tracking-[0.1em]";

/** The spider from job sites: it drops in on its thread and sways, with the same timing and colors. */
function DroppingSpider({ look }: { look: SpiderLook }) {
  const rects = useMemo(() => spiderRects(0, { ...ON_DARK, ...crawlerColors(look) }), [look]);
  return (
    <div aria-hidden className="site-spider-drop pointer-events-none absolute bottom-[calc(100%-7px-46px)] right-5 flex sm:right-9 flex-col items-center">
      <div className="h-[400px] w-0.5" style={{ background: "linear-gradient(90deg, #000 0 1px, #EAF6F2 1px 2px)" }} />
      <div className="site-spider-sway" style={{ width: 54, height: Math.round((54 * SPRITE_H) / SPRITE_W), filter: "drop-shadow(2px 3px 0 rgba(0,0,0,.2))" }}>
        <svg viewBox={`0 0 ${SPRITE_W} ${SPRITE_H}`} shapeRendering="crispEdges" className="block h-full w-full rotate-180" dangerouslySetInnerHTML={{ __html: rects }} />
      </div>
    </div>
  );
}

export type Goals = {
  dailyGoal?: number | null;
  weeklyGoal?: number | null;
  monthlyGoal?: number | null;
  weeklyEmailGoal?: number | null;
  monthlyInterviewGoal?: number | null;
  streakGoal?: number | null;
};

type HomeProps = {
  name: string;
  apps: App[];
  goals: Goals;
  onGoals: (goals: Goals) => Promise<void>;
  school: string;
  spiderSkin: string | null;
  onOpenJob: (appId: string, panel?: "emails") => void;
  onWrite: (appId: string, contactId: string) => Promise<void>;
  onSent: (contactId: string) => Promise<void>;
  onSetup: () => void;
  /** Opens the Review Inbox on the Applications page. */
  onReview: () => void;
  onJobs: () => void;
  onSpiders: () => void;
};

const SECTIONS: Array<{ id: NextSection; label: string }> = [
  { id: "goals", label: "Reach your goals" },
  { id: "follow_ups", label: "Follow ups" },
  { id: "applications", label: "Applications" },
  { id: "review", label: "Review emails" },
];

export function HomePage({ name, apps, goals, onGoals, school, spiderSkin, onOpenJob, onWrite, onSent, onReview, onJobs, onSpiders }: HomeProps) {
  const stats = useMemo(() => applicationStats(apps), [apps]);
  const [toReview, setToReview] = useState(0);
  const [busy, setBusy] = useState("");
  const [picked, setPicked] = useState<NextSection | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/email/state")
      .then((response) => (response.ok ? response.json() : null))
      .then((state: { review?: unknown[] } | null) => { if (!cancelled && state) setToReview(state.review?.length ?? 0); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  const next = useMemo(() => {
    const today = stats.perDay[stats.perDay.length - 1]?.count ?? 0;
    return nextUp(apps, { toReview, goal: { today, daily: goals.dailyGoal ?? DEFAULT_DAILY_GOAL, week: stats.thisWeek, weekly: goals.weeklyGoal ?? DEFAULT_WEEKLY_GOAL } });
  }, [apps, toReview, stats, goals.dailyGoal, goals.weeklyGoal]);
  const counts: Record<NextSection, number> = { goals: next.goals.items.length, follow_ups: next.follow_ups.count, applications: next.applications.count, review: next.review.count };
  // Opens on the first section with something to do, in the order shown.
  const section = picked ?? SECTIONS.find((item) => counts[item.id] > 0)?.id ?? "goals";
  const open = (item: NextItem) => {
    if (item.kind === "review") return onReview();
    if (item.kind === "goal") return onJobs();
    onOpenJob(item.applicationId!, item.kind === "reply" ? "emails" : undefined);
  };
  const write = async (item: NextItem) => {
    setBusy(item.key);
    await onWrite(item.applicationId!, item.contactId!);
    setBusy("");
    open(item);
  };
  const now = new Date();
  const first = name.trim().split(/\s+/)[0];
  const look: SpiderLook = { skin: wornSkin(spiderSkin, stats.applied), school };

  const heading = (() => {
    if (section === "goals") {
      const item = next.goals.items[0];
      return item ? { title: item.title, detail: item.detail } : { title: "Goals hit. Nice work.", detail: `${next.goals.today} today · ${next.goals.week} this week` };
    }
    if (section === "follow_ups") {
      const { replied, count } = next.follow_ups;
      const people = count - replied;
      if (replied) return { title: `${replied} ${replied === 1 ? "company" : "companies"} replied to your application`, detail: people ? `And ${people} ${people === 1 ? "person" : "people"} to follow up with` : "Read what they said and reply" };
      if (people) return { title: `Follow up with ${people} ${people === 1 ? "person" : "people"}`, detail: "You emailed them a week ago and haven't heard back" };
      return { title: "No follow ups right now", detail: "When a company writes back, it shows up here" };
    }
    if (section === "applications") {
      const finish = next.applications.items.filter((item) => item.kind === "finish").length;
      if (next.applications.count) return { title: finish ? `Finish ${finish} ${finish === 1 ? "application" : "applications"}` : "Update your applications", detail: "Finish what you started, and say how the older ones went" };
      return { title: "Your applications are up to date", detail: "Nothing started and left, and nothing waiting on an update" };
    }
    return next.review.count
      ? { title: next.review.items[0].title, detail: next.review.items[0].detail }
      : { title: "No emails to review", detail: "Emails Unnepo can't place on a job wait here" };
  })();
  const rows = section === "follow_ups" ? next.follow_ups.items : section === "applications" ? next.applications.items : [];

  return (
    <div className="mx-auto -mt-6 flex w-full max-w-[720px] flex-col overflow-y-clip pt-8 sm:pt-14">
      <p className="m-0 mb-2 font-mono text-xs uppercase tracking-[0.12em] text-[#9A9AA3]">{now.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}</p>
      <h1 className="m-0 mb-8 pr-16 text-[30px] font-bold tracking-[-0.03em] sm:pr-0">Good {partOfDay(now.getHours())}{first ? `, ${first}` : ""}.</h1>

      <section aria-labelledby="next-up" className="relative rounded-[20px] border border-[#222] bg-[#0F0F0F] p-7">
        <DroppingSpider look={look} />
        <p id="next-up" className={`${eyebrow} pr-16 text-[#3D8BFF]`}>Next up</p>
        <div role="tablist" aria-label="Next up" className="mt-4 flex flex-wrap gap-1.5 pr-16">
          {SECTIONS.map((item) => {
            const on = item.id === section;
            return (
              <button key={item.id} type="button" role="tab" id={`tab-${item.id}`} aria-selected={on} aria-controls="next-panel" onClick={() => setPicked(item.id)}
                className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium ${on ? "border-[#F5F5F5] bg-[#F5F5F5] text-[#0A0A0A]" : "border-[#2A2A2A] text-[#9A9AA3] hover:text-white"}`}>
                {item.label}
                {counts[item.id] > 0 && <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${on ? "bg-[#0A0A0A]/10" : item.id === "follow_ups" ? "bg-[#F5C518]/15 text-[#F5C518]" : "bg-white/5"}`}>{counts[item.id]}</span>}
              </button>
            );
          })}
        </div>

        <div id="next-panel" role="tabpanel" aria-labelledby={`tab-${section}`} className="mt-6">
          <h2 className="m-0 mb-1.5 pr-16 text-[22px] font-semibold tracking-[-0.02em]">{heading.title}</h2>
          <p className="m-0 pr-16 text-sm text-[#9A9AA3]">{heading.detail}</p>

          {section === "goals" && (
            <div className="mt-6 flex flex-wrap gap-2">
              <button type="button" onClick={onJobs} className={pill}>See suggested jobs</button>
            </div>
          )}
          {section === "review" && next.review.count > 0 && (
            <div className="mt-6 flex flex-wrap gap-2">
              <button type="button" onClick={onReview} className={pill}>Review emails</button>
            </div>
          )}
          {rows.length > 0 && (
            <ul className="m-0 mt-5 list-none border-t border-[#1A1A1A] p-0">
              {rows.map((item) => (
                <li key={item.key} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[#1A1A1A] py-3">
                  <span aria-hidden className={`h-2 w-2 flex-none rounded-full ${item.kind === "reply" || item.kind === "follow_up" ? "bg-[#F5C518]" : "border-[1.5px] border-[#8B8B94]"}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm">{item.title}</span>
                    {item.detail && <span className="block truncate text-[13px] text-[#8B8B94]">{item.detail}</span>}
                  </span>
                  <span className="flex flex-none items-center gap-2">
                    {item.kind === "follow_up" ? (
                      <>
                        <button type="button" disabled={busy === item.key} onClick={() => void write(item)} className={small}>{busy === item.key ? "Writing…" : item.action}</button>
                        <button type="button" onClick={() => void onSent(item.contactId!)} className={smallGhost}>I sent it</button>
                      </>
                    ) : (
                      <button type="button" onClick={() => open(item)} className={small}>{item.action}</button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <Progress stats={stats} goals={goals} onGoals={onGoals} />
      <UnlockStrip applied={stats.applied} school={school} onSpiders={onSpiders} />
    </div>
  );
}

const small = "h-8 rounded-full bg-[#F5F5F5] px-3.5 text-[13px] font-medium text-[#0A0A0A] hover:bg-white disabled:opacity-50";
const smallGhost = "h-8 rounded-full border border-[#2A2A2A] px-3 text-[13px] font-medium text-[#9A9AA3] hover:text-white";
const pill = "h-11 rounded-full bg-[#F5F5F5] px-[22px] text-sm font-medium text-[#0A0A0A] hover:bg-white disabled:opacity-50";

function Meter({ value, goal, label }: { value: number; goal: number; label: string }) {
  return (
    <div className="h-[3px] rounded-sm bg-[#1F1F1F]" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={goal} aria-valuenow={Math.min(value, goal)}>
      <div className="h-[3px] rounded-sm bg-[#3D8BFF]" style={{ width: `${Math.min(100, (value / goal) * 100)}%` }} />
    </div>
  );
}

type GoalKey = keyof Goals;

const GOAL_FIELDS: Array<{ key: GoalKey; label: string; hint: string; least: number; most: number; required?: boolean }> = [
  { key: "dailyGoal", label: "Applications a day", hint: "Shown as Today", least: 1, most: 50, required: true },
  { key: "weeklyGoal", label: "Applications a week", hint: "Shown as This week", least: 1, most: 200, required: true },
  { key: "monthlyGoal", label: "Applications a month", hint: "Leave blank to hide", least: 1, most: 800 },
  { key: "weeklyEmailGoal", label: "People emailed a week", hint: "Leave blank to hide", least: 1, most: 100 },
  { key: "monthlyInterviewGoal", label: "Interviews a month", hint: "Leave blank to hide", least: 1, most: 50 },
  { key: "streakGoal", label: "Streak to reach, in days", hint: "Leave blank for no target", least: 2, most: 365 },
];

/** Edit goals: a popup over the blurred page. Escape or a click outside closes it. */
function GoalsDialog({ goals, onGoals, onClose }: { goals: Goals; onGoals: HomeProps["onGoals"]; onClose: () => void }) {
  const [draft, setDraft] = useState<Record<string, string>>(() => ({
    ...Object.fromEntries(GOAL_FIELDS.map((field) => [field.key, goals[field.key] ? String(goals[field.key]) : ""])),
    dailyGoal: String(goals.dailyGoal ?? DEFAULT_DAILY_GOAL),
    weeklyGoal: String(goals.weeklyGoal ?? DEFAULT_WEEKLY_GOAL),
  }));
  const [problem, setProblem] = useState("");
  const [saving, setSaving] = useState(false);
  const box = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    box.current?.querySelector("input")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      // Tab stays inside the popup.
      if (event.key !== "Tab" || !box.current) return;
      const stops = [...box.current.querySelectorAll<HTMLElement>("input, button")];
      const edge = event.shiftKey ? stops[0] : stops[stops.length - 1];
      if (document.activeElement === edge) {
        event.preventDefault();
        (event.shiftKey ? stops[stops.length - 1] : stops[0]).focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      before?.focus();
    };
  }, [onClose]);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const next: Goals = {};
    for (const field of GOAL_FIELDS) {
      const text = draft[field.key].trim();
      if (!text && !field.required) { next[field.key] = null; continue; }
      const value = Math.round(Number(text));
      if (!text || !Number.isFinite(value) || value < field.least || value > field.most) return setProblem(`${field.label}: pick a number from ${field.least} to ${field.most}.`);
      next[field.key] = value;
    }
    setProblem("");
    setSaving(true);
    try {
      await onGoals(next);
      onClose();
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : "Couldn't save your goals.");
      setSaving(false);
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-md" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form ref={box} role="dialog" aria-modal="true" aria-labelledby="goals-title" onSubmit={(event) => void save(event)} className="w-full max-w-[480px] rounded-[20px] border border-[#222] bg-[#0F0F0F] p-6">
        <div className="mb-5 flex items-center justify-between">
          <h2 id="goals-title" className="m-0 text-lg font-semibold tracking-[-0.02em]">Edit goals</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full text-[#9A9AA3] hover:bg-white/5 hover:text-white"><X aria-hidden size={16} /></button>
        </div>
        <div className="flex flex-col">
          {GOAL_FIELDS.map((field) => (
            <label key={field.key} className="flex items-center justify-between gap-4 border-b border-[#1A1A1A] py-3 last:border-b-0">
              <span className="min-w-0 text-sm">{field.label}<span className="block text-xs text-[#8B8B94]">{field.hint}</span></span>
              <input type="number" min={field.least} max={field.most} required={field.required} value={draft[field.key]} onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })} className="w-20 flex-none rounded-lg border border-[#2A2A2A] bg-[#0A0A0A] px-2.5 py-1.5 text-right text-sm tabular-nums text-[#F5F5F5] outline-none focus:border-[#3D8BFF]" />
            </label>
          ))}
        </div>
        {problem && <p role="alert" className="m-0 mt-3 text-xs text-red-300">{problem}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-10 rounded-full border border-[#2A2A2A] px-4 text-sm font-medium text-[#9A9AA3] hover:text-white">Cancel</button>
          <button type="submit" disabled={saving} className="h-10 rounded-full bg-[#F5F5F5] px-5 text-sm font-medium text-[#0A0A0A] hover:bg-white disabled:opacity-50">{saving ? "Saving…" : "Save goals"}</button>
        </div>
      </form>
    </div>
  );
}

function Progress({ stats, goals, onGoals }: { stats: ReturnType<typeof applicationStats>; goals: Goals; onGoals: HomeProps["onGoals"] }) {
  const [editing, setEditing] = useState(false);
  const closeGoals = useCallback(() => setEditing(false), []);
  const dailyGoal = goals.dailyGoal ?? DEFAULT_DAILY_GOAL;
  const weeklyGoal = goals.weeklyGoal ?? DEFAULT_WEEKLY_GOAL;
  const today = stats.perDay[stats.perDay.length - 1]?.count ?? 0;
  const label = "m-0 font-mono text-[10px] uppercase tracking-[0.1em] text-[#9A9AA3]";
  const big = "m-0 text-[26px] font-bold tracking-[-0.02em] tabular-nums";
  const small = "text-sm font-normal tracking-normal text-[#8B8B94]";
  const note = "m-0 text-xs text-[#8B8B94]";
  const toGo = (value: number, goal: number) => (value >= goal ? "Goal met" : `${goal - value} to go`);
  const extra = (title: string, value: number, goal: number) => (
    <div key={title} className="flex flex-col gap-2">
      <p className={label}>{title}</p>
      <p className={big}>{value}<span className={small}>/{goal}</span></p>
      <Meter value={value} goal={goal} label={`${title} goal`} />
      <p className={note}>{toGo(value, goal)}</p>
    </div>
  );
  return (
    <section aria-labelledby="progress" className="mt-11">
      <div className="mb-4 flex items-center justify-between">
        <h2 id="progress" className={`${eyebrow} text-[#9A9AA3]`}>Progress</h2>
        <button type="button" aria-haspopup="dialog" onClick={() => setEditing(true)} className="flex h-8 items-center gap-1.5 rounded-full border border-[#2A2A2A] px-3 text-xs font-medium text-[#D4D4D4] hover:text-white">
          <Pencil aria-hidden size={13} />Edit goals
        </button>
      </div>
      {editing && <GoalsDialog goals={goals} onGoals={onGoals} onClose={closeGoals} />}
      <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-4">
        <div className="flex flex-col gap-2">
          <p className={label}>Today</p>
          <p className={big}>{today}<span className={small}>/{dailyGoal}</span></p>
          <Meter value={today} goal={dailyGoal} label="Today's goal" />
          <p className={note}>{toGo(today, dailyGoal)}</p>
        </div>
        <div className="flex flex-col gap-2">
          <p className={label}>This week</p>
          <p className={big}>{stats.thisWeek}<span className={small}>/{weeklyGoal}</span></p>
          <Meter value={stats.thisWeek} goal={weeklyGoal} label="This week's goal" />
          <p className={note}>{stats.daysLeft} {stats.daysLeft === 1 ? "day" : "days"} left</p>
        </div>
        <div className="flex flex-col gap-2">
          <p className={label}>Responses</p>
          <p className={big}>{stats.responses}</p>
          <p className={`${note} mt-1`}>{stats.applied ? `${Math.round(stats.responseRate * 100)}% rate` : "None yet"}</p>
        </div>
        <div className="flex flex-col gap-2">
          <p className={label}>Streak</p>
          <p className={big}>{stats.streak}<span className={small}>{goals.streakGoal ? `/${goals.streakGoal}` : ""} {stats.streak === 1 && !goals.streakGoal ? "day" : "days"}</span></p>
          {goals.streakGoal ? <Meter value={stats.streak} goal={goals.streakGoal} label="Streak goal" /> : null}
          <p className={`${note} mt-1`}>{today > 0 ? "Applied today" : stats.streak ? "Apply today to keep it" : "Apply today to start one"}</p>
        </div>
        {goals.monthlyGoal ? extra("This month", stats.thisMonth, goals.monthlyGoal) : null}
        {goals.weeklyEmailGoal ? extra("People emailed", stats.emailedThisWeek, goals.weeklyEmailGoal) : null}
        {goals.monthlyInterviewGoal ? extra("Interviews", stats.interviewsThisMonth, goals.monthlyInterviewGoal) : null}
      </div>
    </section>
  );
}

/** The next spider to collect, and the way to the ones already unlocked. */
function UnlockStrip({ applied, school, onSpiders }: { applied: number; school: string; onSpiders: () => void }) {
  const next = nextSkin(applied);
  const rects = useMemo(() => spiderRects(0, { ...ON_DARK, ...crawlerColors({ skin: next?.skin.id ?? "classic", school }) }), [next?.skin.id, school]);
  return (
    <button type="button" onClick={onSpiders} className="mt-7 flex w-full flex-wrap items-center gap-4 rounded-2xl border border-[#222] bg-[#0F0F0F] px-5 py-4 text-left hover:border-[#2A2A2A]">
      <span aria-hidden className="relative flex-none">
        <svg viewBox={`0 0 ${SPRITE_W} ${SPRITE_H}`} width={45} height={Math.round((45 * SPRITE_H) / SPRITE_W)} shapeRendering="crispEdges" className={`block rotate-180 ${next ? "opacity-55" : ""}`} dangerouslySetInnerHTML={{ __html: rects }} />
        {next && <span className="absolute -bottom-1.5 -right-1.5 flex h-[18px] w-[18px] items-center justify-center rounded-full border border-[#2A2A2A] bg-[#1A1A1A] text-[#9A9AA3]"><Lock size={10} strokeWidth={2.5} /></span>}
      </span>
      <span className="min-w-40 flex-1">
        <span className="flex justify-between gap-3 text-sm">
          <span className="font-semibold">{next ? `${next.skin.name} spider unlocks at ${next.skin.unlockAt}` : "Every spider unlocked"}</span>
          {next && <span className="flex-none text-[#9A9AA3]">{next.left} to go</span>}
        </span>
        <span className="mt-2.5 block h-1 rounded-sm bg-[#1F1F1F]"><span className="block h-1 rounded-sm bg-[#3D8BFF]" style={{ width: next ? `${Math.min(100, (applied / next.skin.unlockAt) * 100)}%` : "100%" }} /></span>
      </span>
      <span className="flex-none text-[13px] text-[#9A9AA3]">Your spiders →</span>
    </button>
  );
}

export function HomeTiles({ apps }: { apps: App[] }) {
  const stats = useMemo(() => applicationStats(apps), [apps]);
  return (
    <section aria-label="Totals" className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] border-y border-[#1F1F24] sm:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
      <Tile label="Applications" value={String(stats.applied)} note={stats.inProgress ? `${stats.inProgress} in progress` : "submitted"} />
      <Tile label="Responses" value={String(stats.responses)} note={stats.applied ? `${Math.round(stats.responseRate * 100)}% response rate` : "none yet"} />
      <Tile label="People reached" value={String(stats.peopleReached)} note="emailed or replied" />
      <Tile label="Time per app" value={duration(stats.medianMinutes)} note="typical, open to submit" />
    </section>
  );
}

export function PerDayCard({ apps }: { apps: App[] }) {
  const stats = useMemo(() => applicationStats(apps), [apps]);
  return <PerDay days={stats.perDay} />;
}

/** The fuller numbers that were on the old Stats page. */
export function MoreStats({ apps }: { apps: App[] }) {
  const stats = useMemo(() => applicationStats(apps), [apps]);
  return (
    <details className="group rounded-2xl border border-[#1F1F24] p-5">
      <summary className="cursor-pointer text-sm font-semibold">More stats</summary>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Funnel steps={[["Applied", stats.applied], ["Responded", stats.responses], ["Interviews", stats.interviews], ["Offers", stats.offers]]} />
        <Systems rows={stats.bySystem} />
      </div>
    </details>
  );
}
