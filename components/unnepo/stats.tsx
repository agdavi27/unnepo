"use client";

import { useState } from "react";
import type { App } from "@/components/unnepo/apply";
import { AtsBadge } from "@/components/unnepo/company";
import { SKINS, schoolStyle, skinUnlocked, spiderSvg, wornSkin, type SkinId } from "@/lib/spiders";

const card = "rounded-2xl border border-line bg-panel p-5";
const sectionTitle = "text-xs font-semibold uppercase tracking-wider text-faint";
const NEUTRAL = "#3A3A42";
const ACCENT = "#3D8BFF";

function dayLabel(key: string, style: "short" | "long" = "short") {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return style === "long" ? date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function duration(minutes: number | null) {
  if (minutes === null) return "—";
  if (minutes < 1) return `${Math.max(1, Math.round(minutes * 60))}s`;
  if (minutes < 60) return `${Math.round(minutes)} min`;
  return `${(minutes / 60).toFixed(1)} h`;
}

/**
 * The six spiders to collect: the school one from the start, the rest at 50, 150, 300, 500 and 1,000
 * applications. Locked ones are grey and say when they unlock. Picking one dresses the extension's spiders.
 */
export function Spiders({ applied, school, picked, onPick }: { applied: number; school: string; picked: string | null; onPick: (skin: SkinId) => Promise<void> }) {
  const [state, setState] = useState("");
  const worn = wornSkin(picked, applied);
  const style = schoolStyle(school);
  async function pick(skin: SkinId) {
    if (skin === worn) return;
    setState("Saving…");
    try {
      await onPick(skin);
      setState("");
    } catch (reason) {
      setState(reason instanceof Error ? reason.message : "Couldn't save.");
    }
  }
  return (
    <section className={card} aria-label="Your spiders">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className={sectionTitle}>Your spiders</h2>
        <p className="text-xs text-faint" role="status">{state || "Pick one to wear in the extension."}</p>
      </div>
      <ul className="mt-4 grid list-none grid-cols-3 gap-3 p-0 sm:grid-cols-7">
        {SKINS.map((skin) => {
          const open = skinUnlocked(skin, applied);
          const name = skin.id === "school" ? (school ? `${school}` : "School spirit") : skin.name;
          const look = { skin: skin.id, school };
          return (
            <li key={skin.id}>
              <button
                type="button"
                disabled={!open}
                onClick={() => void pick(skin.id)}
                aria-pressed={worn === skin.id}
                aria-label={open ? `Wear the ${name} spider` : `${skin.name} spider, unlocks after ${skin.unlockAt} applications`}
                className={`flex w-full flex-col items-center gap-2 rounded-xl border p-3 text-center transition-colors ${worn === skin.id ? "border-[#3D8BFF] bg-[#0C1424]" : "border-line hover:bg-white/5"} disabled:cursor-not-allowed disabled:hover:bg-transparent`}
              >
                <span className={`block ${open ? "" : "opacity-60"}`} dangerouslySetInnerHTML={{ __html: spiderSvg(look, { size: 72, grey: !open }) }} />
                <span className="line-clamp-2 text-xs font-medium">{skin.id === "school" && style ? `${style.letters} sweater` : skin.name}</span>
                <span className="text-[11px] text-faint">{open ? (worn === skin.id ? "Wearing" : skin.unlockAt === 0 ? "Unlocked" : `${skin.unlockAt} apps`) : `Unlocks after ${skin.unlockAt} applications`}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="flex flex-col gap-1.5 border-r border-[#17171B] px-4 py-6 first:pl-0 last:border-r-0 sm:px-6">
      <p className="m-0 text-[13px] text-[#8B8B94]">{label}</p>
      <p className="m-0 text-[40px] font-bold leading-none tracking-[-1.6px] tabular-nums">{value}</p>
      <p className="m-0 text-xs text-[#8B8B94]">{note}</p>
    </div>
  );
}

/** Applications per day, the last 14 days. Today is the accent bar. */
export function PerDay({ days }: { days: Array<{ date: string; count: number }> }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...days.map((day) => day.count));
  const top = max <= 4 ? max : Math.ceil(max / 2) * 2;
  const total = days.reduce((sum, day) => sum + day.count, 0);
  return (
    <section className="rounded-2xl border border-[#1F1F24] p-5" aria-labelledby="per-day-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="per-day-title" className="m-0 text-sm font-semibold">Applications per day</h2>
        <p className="m-0 text-xs text-[#8B8B94] tabular-nums">{total} in 14 days</p>
      </div>
      <div className="relative mt-5" onMouseLeave={() => setHover(null)} aria-hidden>
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-2">
          <span className="text-[10px] tabular-nums text-faint">{top}</span>
          <span className="h-px flex-1 border-t border-dashed border-line/70" />
        </div>
        <div className="flex h-[110px] items-end gap-[3px] border-b border-[#26262C] pt-4">
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
        <div className="mt-2 flex justify-between font-mono text-[11px] uppercase text-[#8B8B94]">
          <span>{dayLabel(days[0].date)}</span>
          <span>Today</span>
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

export function Funnel({ steps }: { steps: Array<[string, number]> }) {
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

export function Systems({ rows }: { rows: Array<{ ats: App["ats"]; count: number }> }) {
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
