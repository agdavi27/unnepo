"use client";

import { useEffect, useMemo, useState } from "react";
import type { App } from "@/components/unnepo/apply";
import { Funnel, GoalCard, PerDay, Systems, Tile, duration } from "@/components/unnepo/stats";
import { followUpsDue } from "@/lib/apply/follow-ups";
import { applicationStats } from "@/lib/apply/stats";
import { nextSkin, spiderSvg, wornSkin } from "@/lib/spiders";

/** The top and side of the Home tab: the day so far, the goal, the totals, and the next spider to unlock. */

const partOfDay = (hour: number) => (hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening");
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** The faint web behind the greeting. */
function Web() {
  return (
    <svg aria-hidden width="400" height="400" viewBox="0 0 400 400" fill="none" stroke="#1C1C22" strokeWidth="1.2" className="pointer-events-none absolute -right-10 -top-[140px]">
      <polygon points="240,200 228.3,228.3 200,240 171.7,228.3 160,200 171.7,171.7 200,160 228.3,171.7" />
      <polygon points="280,200 256.6,256.6 200,280 143.4,256.6 120,200 143.4,143.4 200,120 256.6,143.4" />
      <polygon points="320,200 284.8,284.8 200,320 115.2,284.8 80,200 115.2,115.2 200,80 284.8,115.2" />
      <polygon points="360,200 313.1,313.1 200,360 86.9,313.1 40,200 86.9,86.9 200,40 313.1,86.9" />
      <path d="M200 200L400 200M200 200L341.4 341.4M200 200L200 400M200 200L58.6 341.4M200 200L0 200M200 200L58.6 58.6M200 200L200 0M200 200L341.4 58.6" />
    </svg>
  );
}

type HeroProps = {
  name: string;
  apps: App[];
  weeklyGoal: number | null;
  onGoal: (goal: number) => Promise<void>;
  school: string;
  spiderSkin: string | null;
  onSetup: () => void;
};

export function HomeHero({ name, apps, weeklyGoal, onGoal, school, spiderSkin, onSetup }: HeroProps) {
  const stats = useMemo(() => applicationStats(apps), [apps]);
  const now = new Date();
  const today = stats.perDay[stats.perDay.length - 1]?.count ?? 0;
  const due = followUpsDue(apps).length;
  // How many emails wait in the Review Inbox. Home works without it.
  const [toReview, setToReview] = useState(0);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/email/state")
      .then((response) => (response.ok ? response.json() : null))
      .then((state: { review?: unknown[] } | null) => { if (!cancelled && state) setToReview(state.review?.length ?? 0); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  const look = { skin: wornSkin(spiderSkin, stats.applied), school };
  const first = name.trim().split(/\s+/)[0];
  return (
    <section aria-label="Today" className="relative flex min-h-[260px] flex-wrap items-end justify-between gap-6 pt-8 sm:pt-12">
      <Web />
      <div className="relative flex max-w-[620px] flex-col gap-2.5">
        <span className="font-mono text-xs uppercase tracking-[2px] text-[#8B8B94]">{now.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}</span>
        <h1 className="m-0 text-4xl font-extrabold leading-none tracking-[-1.8px] sm:text-5xl">Good {partOfDay(now.getHours())}{first ? `, ${first}` : ""}.</h1>
        <p className="m-0 text-[17px] leading-normal text-[#9A9AA3]">
          {plural(today, "application")} today.
          {due > 0 && <> <span className="text-[#F7F7F8]">{plural(due, "follow-up")} due.</span></>}
          {toReview > 0 && <> <button type="button" onClick={onSetup} className="text-[#F7F7F8] underline underline-offset-4 hover:text-white">{plural(toReview, "email")} need a look.</button></>}
        </p>
      </div>
      <div className="relative flex items-end gap-5">
        <GoalCard thisWeek={stats.thisWeek} daysLeft={stats.daysLeft} streak={stats.streak} goal={weeklyGoal} onGoal={onGoal} />
        <div aria-hidden className="dash-bob relative mb-10 hidden h-[90px] w-[120px] flex-none sm:block">
          <div className="absolute bottom-[calc(100%-9px)] left-[58px] h-[260px] w-[3px] bg-[#3A3A44]" />
          <div className="absolute inset-0" dangerouslySetInnerHTML={{ __html: spiderSvg(look, { size: 120 }) }} />
        </div>
      </div>
    </section>
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

/** The next spider to collect, and the way to the ones already unlocked. */
export function NextSpider({ apps, school, onSpiders }: { apps: App[]; school: string; onSpiders: () => void }) {
  const applied = useMemo(() => applicationStats(apps).applied, [apps]);
  const next = nextSkin(applied);
  return (
    <section aria-labelledby="next-spider" className="flex items-center gap-4 rounded-2xl border border-[#1F1F24] p-5">
      <span aria-hidden className="h-[60px] w-20 flex-none" dangerouslySetInnerHTML={{ __html: spiderSvg({ skin: next?.skin.id ?? wornSkin(null, applied), school }, { size: 80 }) }} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h2 id="next-spider" className="m-0 text-sm font-semibold">{next ? `${next.skin.name} spider unlocks at ${next.skin.unlockAt}` : "Every spider unlocked"}</h2>
        {next && (
          <div className="h-1 overflow-hidden rounded bg-[#1A1A1F]" role="progressbar" aria-label={`Progress to the ${next.skin.name} spider`} aria-valuemin={0} aria-valuemax={next.skin.unlockAt} aria-valuenow={Math.min(applied, next.skin.unlockAt)}>
            <div className="h-full bg-[#3D8BFF]" style={{ width: `${Math.min(100, (applied / next.skin.unlockAt) * 100)}%` }} />
          </div>
        )}
        <span className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs text-[#8B8B94]">
          {next && <span>{plural(next.left, "more application")} to go</span>}
          <button type="button" onClick={onSpiders} className="underline-offset-4 hover:text-white hover:underline">Your spiders</button>
        </span>
      </div>
    </section>
  );
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
