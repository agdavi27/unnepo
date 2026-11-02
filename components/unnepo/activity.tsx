"use client";

import { useEffect, useState } from "react";
import { appliedSince, duration } from "@/lib/apply/activity-stats";

/**
 * On the Applied page: the applying session (start it, see how many in how long, end it).
 */

export type Maybe = { id: string; title: string; company: string; site: string; at: string };
export type Session = { startedAt: string; lastAt: string; active: boolean } | null;

const btn = "inline-flex items-center justify-center gap-2 rounded-xl px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-40";
const secondary = `${btn} border border-line text-ink hover:bg-white/5`;

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
