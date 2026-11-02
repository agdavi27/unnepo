"use client";

import { useEffect, useState } from "react";
import { appliedSince, duration } from "@/lib/apply/activity-stats";

/**
 * On the Applied page: the applying session (start it, see how many in how long, end it), and the jobs where
 * Apply was pressed but nothing confirmed it ("Did you apply?"), each a tap to save or drop.
 */

export type Maybe = { id: string; title: string; company: string; site: string; at: string };
export type Session = { startedAt: string; lastAt: string; active: boolean } | null;

const btn = "inline-flex items-center justify-center gap-2 rounded-xl px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-40";
const secondary = `${btn} border border-line text-ink hover:bg-white/5`;

const when = (at: string) => new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

export function SessionBar({ apps, session, onSession }: { apps: Parameters<typeof appliedSince>[0]; session: Session; onSession: (start: boolean) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  // A clock for the session's minutes.
  const [now, setNow] = useState(0);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the clock starts once the page is in the browser
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const inSession = session?.active ? appliedSince(apps, Date.parse(session.startedAt)) : null;
  const minutes = session?.active && now ? Math.max(1, Math.round((now - Date.parse(session.startedAt)) / 60000)) : 0;
  const press = async (start: boolean) => {
    setBusy(true);
    await onSession(start);
    setBusy(false);
  };
  return session?.active ? (
    <span className="flex flex-wrap items-center gap-3 text-sm tabular-nums">
      <span><strong>Session:</strong> {inSession?.count ?? 0} applied in {minutes} min{inSession?.count ? ` · ${duration(Math.round((minutes * 60) / inSession.count))} each` : ""}</span>
      <button type="button" className={secondary} disabled={busy} onClick={() => void press(false)}>End session</button>
    </span>
  ) : (
    <button type="button" className={secondary} disabled={busy} onClick={() => void press(true)}>Start applying session</button>
  );
}

export function DidYouApply({ maybe, onMaybe }: { maybe: Maybe[]; onMaybe: (id: string, applied: boolean) => Promise<void> }) {
  const [busy, setBusy] = useState("");
  if (!maybe.length) return null;
  const answer = async (id: string, applied: boolean) => {
    setBusy(id);
    await onMaybe(id, applied);
    setBusy("");
  };
  return (
    <section aria-labelledby="did-you-apply" className="flex flex-col gap-2">
      <h2 id="did-you-apply" className="text-sm font-semibold">Did you apply? <span className="font-normal text-faint tabular-nums">{maybe.length}</span></h2>
      <ul className="flex flex-col divide-y divide-line rounded-xl border border-line">
        {maybe.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm">
            <span className="min-w-0 flex-1"><span className="font-medium">{item.title}</span>{item.company && <span className="text-muted"> at {item.company}</span>}<span className="text-faint"> · {item.site} · {when(item.at)}</span></span>
            <button type="button" className={secondary} disabled={busy === item.id} onClick={() => void answer(item.id, true)}>✓ Yes</button>
            <button type="button" className="text-sm text-muted hover:text-white" disabled={busy === item.id} onClick={() => void answer(item.id, false)} aria-label={`No, I didn't apply to ${item.title}`}>✕ No</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
