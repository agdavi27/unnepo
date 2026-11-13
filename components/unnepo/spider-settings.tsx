"use client";

import { useEffect, useState } from "react";
import { applicationStats } from "@/lib/apply/stats";
import type { JobApplication } from "@/lib/apply/types";
import { SKINS, schoolStyle, nextSkin, skinUnlocked, spiderSvg, wornSkin, type SkinId } from "@/lib/spiders";

const card = "rounded-2xl border border-line bg-panel p-5";
const sectionTitle = "text-xs font-semibold uppercase tracking-wider text-faint";

type SpiderData = { applications: JobApplication[]; school: string; profile: { spiderSkin?: string | null } };

/** The spider the student wears in the extension. More unlock as they apply. */
export function SpiderSettings() {
  const [data, setData] = useState<SpiderData | null>(null);
  const [state, setState] = useState("");
  useEffect(() => {
    fetch("/api/apply").then((response) => (response.ok ? response.json() : null)).then((body) => body && setData(body as SpiderData), () => undefined);
  }, []);
  if (!data) return null;
  const applied = applicationStats(data.applications).applied;
  const school = data.school;
  const worn = wornSkin(data.profile.spiderSkin ?? null, applied);
  const style = schoolStyle(school);
  const next = nextSkin(applied);
  // The bar runs from the last spider unlocked to the next one.
  const from = next ? Math.max(0, ...SKINS.filter((skin) => skin.unlockAt <= applied).map((skin) => skin.unlockAt)) : 0;
  const percent = next ? Math.min(100, Math.round(((applied - from) / (next.skin.unlockAt - from)) * 100)) : 100;
  async function pick(skin: SkinId) {
    if (!data || skin === worn) return;
    setState("Saving…");
    try {
      const response = await fetch("/api/apply/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ spiderSkin: skin }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Couldn't save.");
      setData({ ...data, profile: body.profile });
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
      <div className="mt-4 flex items-center gap-4 rounded-xl border border-line bg-[#0C0C0E] p-3 sm:p-4">
        {next && <span aria-hidden className="block flex-none" dangerouslySetInnerHTML={{ __html: spiderSvg({ skin: next.skin.id, school }, { size: 52, grey: true }) }} />}
        <div className="min-w-0 flex-1">
          <p className="m-0 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
            {next
              ? <span><b className="font-semibold tabular-nums">{next.left}</b> {next.left === 1 ? "application" : "applications"} away from the <b className="font-semibold" style={{ color: next.skin.color }}>{next.skin.name}</b> spider</span>
              : <span className="font-semibold">Every spider unlocked. Legend.</span>}
            <span className="font-mono text-[11px] tabular-nums text-faint">{next ? `${applied} / ${next.skin.unlockAt}` : `${applied} applied`}</span>
          </p>
          <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-[#1F1F24]" role="progressbar" aria-label={next ? `Progress to the ${next.skin.name} spider` : "Every spider unlocked"} aria-valuemin={from} aria-valuemax={next?.skin.unlockAt ?? applied} aria-valuenow={applied}>
            <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${Math.max(percent, applied > from ? 3 : 0)}%`, background: next?.skin.color ?? "#F2B227" }} />
          </div>
        </div>
      </div>
      <ul className="mt-4 grid list-none grid-cols-3 gap-3 p-0 sm:grid-cols-7">
        {SKINS.map((skin) => {
          const open = skinUnlocked(skin, applied);
          const name = skin.id === "school" ? (school || "School spirit") : skin.name;
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
