"use client";

import { useEffect, useState } from "react";
import { HOW_LABEL, appliedSince, bySite, duration, feed } from "@/lib/apply/activity-stats";
import type { ActivityEvent } from "@/lib/apply/types";

/**
 * The Applied tab's Activity view: applying as it happens. A line for today, an applying session, the jobs
 * waiting on the student ("Did you apply?", "Which company?"), every event newest first with how it was caught,
 * and each site's pace and how often Unnepo confirmed it by itself.
 */

type ActivityApp = {
  id: string;
  title: string;
  company: string;
  status: string;
  submittedAt: string | null;
  companyMissing?: boolean;
  fillReport?: { activity?: ActivityEvent[] } | null;
  contacts?: Array<{ outreachStatus: string }>;
};
export type Maybe = { id: string; title: string; company: string; site: string; at: string };
export type Session = { startedAt: string; lastAt: string; active: boolean } | null;

const btn = "inline-flex items-center justify-center gap-2 rounded-xl px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-40";
const secondary = `${btn} border border-line text-ink hover:bg-white/5`;

const when = (at: string) => new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const startOfToday = () => {
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  return day.getTime();
};

function line(event: ActivityEvent) {
  if (event.kind === "applied") return { tag: "Applied", color: "#4ADE80", how: event.how ? HOW_LABEL[event.how] : "" };
  if (event.kind === "filled") {
    const parts = [`${event.fields ?? 0} fields`, event.ms ? `in ${duration(Math.round(event.ms / 1000))}` : "", event.needs ? `${event.needs} needed you` : ""].filter(Boolean);
    return { tag: "Filled", color: "#3D8BFF", how: parts.join(" · ") };
  }
  return { tag: "Not confirmed", color: "#F5A524", how: "" };
}

export function ActivityView({ apps, maybe, session, onMaybe, onSession, onCompany, onOpen }: {
  apps: ActivityApp[];
  maybe: Maybe[];
  session: Session;
  onMaybe: (id: string, applied: boolean) => Promise<void>;
  onSession: (start: boolean) => Promise<void>;
  onCompany: (appId: string, company: string) => Promise<void>;
  onOpen: (appId: string) => void;
}) {
  const [busy, setBusy] = useState("");
  const [names, setNames] = useState<Record<string, string>>({});
  // A clock for the session's minutes; the page reloads the data itself.
  const [now, setNow] = useState(0);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the clock starts once the page is in the browser
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const today = appliedSince(apps, now ? startOfToday() : Infinity);
  const inSession = session?.active ? appliedSince(apps, Date.parse(session.startedAt)) : null;
  const minutes = session?.active && now ? Math.max(1, Math.round((now - Date.parse(session.startedAt)) / 60000)) : 0;
  const unnamed = apps.filter((app) => app.companyMissing);
  const waiting = maybe.length + unnamed.length;
  const events = feed(apps);
  const sites = bySite(apps);
  const run = async (key: string, task: () => Promise<void>) => {
    setBusy(key);
    await task();
    setBusy("");
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-panel px-4 py-3">
        <p className="m-0 text-sm text-muted tabular-nums">
          <strong className="text-ink">{today.count} applied today</strong>
          {today.averageSeconds !== null && <> · avg <strong className="text-ink">{duration(today.averageSeconds)}</strong> each</>}
          {today.sites > 0 && <> · {today.sites} {today.sites === 1 ? "site" : "sites"}</>}
          {waiting > 0 && <> · <span className="text-[#F5A524]">{waiting} waiting on you</span></>}
        </p>
        {session?.active ? (
          <span className="flex items-center gap-3 text-sm tabular-nums">
            <span><strong>Session:</strong> {inSession?.count ?? 0} applied in {minutes} min{inSession?.count ? ` · ${duration(Math.round((minutes * 60) / inSession.count))} each` : ""}</span>
            <button type="button" className={secondary} disabled={busy === "session"} onClick={() => void run("session", () => onSession(false))}>End</button>
          </span>
        ) : (
          <button type="button" className={secondary} disabled={busy === "session"} onClick={() => void run("session", () => onSession(true))}>Start session</button>
        )}
      </div>

      {waiting > 0 && (
        <section aria-labelledby="waiting" className="flex flex-col gap-2">
          <h2 id="waiting" className="text-sm font-semibold">Waiting on you</h2>
          <ul className="flex flex-col divide-y divide-line rounded-xl border border-line">
            {maybe.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm">
                <span className="min-w-0 flex-1"><span className="text-[#F5A524]">Did you apply?</span> <span className="font-medium">{item.title}</span>{item.company && <span className="text-muted"> at {item.company}</span>}<span className="text-faint"> · {item.site} · {when(item.at)}</span></span>
                <button type="button" className={secondary} disabled={busy === item.id} onClick={() => void run(item.id, () => onMaybe(item.id, true))}>✓ Yes</button>
                <button type="button" className="text-sm text-muted hover:text-white" disabled={busy === item.id} onClick={() => void run(item.id, () => onMaybe(item.id, false))} aria-label={`No, I didn't apply to ${item.title}`}>✕ No</button>
              </li>
            ))}
            {unnamed.map((app) => (
              <li key={app.id}>
                <form className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm" onSubmit={(event) => { event.preventDefault(); void run(app.id, () => onCompany(app.id, names[app.id] ?? "")); }}>
                  <span className="min-w-0 flex-1"><span className="text-[#F5A524]">Which company?</span> <span className="font-medium">{app.title}</span></span>
                  <label className="sr-only" htmlFor={`which-${app.id}`}>Company for {app.title}</label>
                  <input id={`which-${app.id}`} value={names[app.id] ?? ""} onChange={(event) => setNames({ ...names, [app.id]: event.target.value })} placeholder="Company" maxLength={200} className="w-40 rounded-lg border border-line bg-card px-2.5 py-1.5 text-sm" />
                  <button type="submit" className={secondary} disabled={busy === app.id || (names[app.id] ?? "").trim().length < 2}>Save</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="feed" className="flex flex-col gap-2">
        <h2 id="feed" className="text-sm font-semibold">What happened</h2>
        {events.length === 0 ? (
          <p className="text-sm text-muted">Nothing yet. Apply with the extension open and each application shows up here as it happens.</p>
        ) : (
          <ol className="flex flex-col divide-y divide-line rounded-xl border border-line">
            {events.map(({ app, event }, index) => {
              const said = line(event);
              const people = app.contacts?.length ?? 0;
              return (
                <li key={`${app.id}-${event.at}-${index}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm">
                  <span className="w-16 flex-none text-xs text-faint tabular-nums">{when(event.at)}</span>
                  <span className="flex-none rounded-full border px-2 py-0.5 text-[11px] font-semibold" style={{ color: said.color, borderColor: said.color }}>{said.tag}</span>
                  <button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => onOpen(app.id)}><span className="font-medium">{app.title}</span><span className="text-muted"> at {app.company}</span></button>
                  <span className="text-xs text-muted">{event.site}{said.how ? ` · ${said.how}` : ""}</span>
                  {event.kind === "applied" && <button type="button" className="text-xs text-ink underline-offset-4 hover:underline" onClick={() => onOpen(app.id)}>{people ? `${people} ${people === 1 ? "person" : "people"} →` : "Find people →"}</button>}
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {sites.length > 0 && (
        <section aria-labelledby="sites" className="flex flex-col gap-2">
          <h2 id="sites" className="text-sm font-semibold">By site</h2>
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-left text-sm tabular-nums">
              <thead className="text-xs text-faint"><tr><th className="px-3 py-2 font-medium">Site</th><th className="px-3 py-2 font-medium">Applied</th><th className="px-3 py-2 font-medium">Avg time</th><th className="px-3 py-2 font-medium" title="Caught by Unnepo itself, without you marking it">Auto-confirmed</th></tr></thead>
              <tbody className="divide-y divide-line">
                {sites.map((row) => (
                  <tr key={row.site}>
                    <td className="px-3 py-2">{row.site}</td>
                    <td className="px-3 py-2">{row.count}</td>
                    <td className="px-3 py-2">{row.averageSeconds === null ? "—" : duration(row.averageSeconds)}</td>
                    <td className={`px-3 py-2 ${row.confirmedShare < 70 ? "text-[#F5A524]" : ""}`}>{row.confirmedShare}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-faint">A low auto-confirmed share means Unnepo is missing applications on that site. Press &ldquo;It missed an application&rdquo; in the extension there, so it can be fixed.</p>
        </section>
      )}
    </div>
  );
}
