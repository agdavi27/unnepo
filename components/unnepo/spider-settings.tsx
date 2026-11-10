"use client";

import { useEffect, useState } from "react";
import { applicationStats } from "@/lib/apply/stats";
import type { JobApplication } from "@/lib/apply/types";
import { SKINS, schoolStyle, skinUnlocked, spiderSvg, wornSkin, type SkinId } from "@/lib/spiders";

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
