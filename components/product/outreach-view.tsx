"use client";

import { useEffect, useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PageLoading, StatusPill } from "@/components/product/bits";
import { timeAgo } from "@/lib/format";

type Payload = {
  summary: { unlocked: number; outreached: number; confirmedSends: number; demoOutbox: number; replies: number; replyRate: number; positiveRate: number; interviews: number };
  followups: Array<{ id: string; dueAt: string; note: string; status: string; savedContactId: string }>;
  messages: Array<{ id: string; subject: string; status: string; deliveryConfirmed: boolean; createdAt: string }>;
  chart: Array<{ week: string; sent: number; replies: number }>;
};

export function OutreachView() {
  const [data, setData] = useState<Payload | null>(null);
  const [message, setMessage] = useState("");

  function load() {
    fetch("/api/outreach").then((response) => response.json()).then(setData);
  }
  useEffect(load, []);

  async function sync() {
    const response = await fetch("/api/email/sync", { method: "POST" });
    const body = await response.json();
    setMessage(response.ok ? `Imported ${body.imported} repl${body.imported === 1 ? "y" : "ies"}.` : body.error);
    load();
  }

  if (!data?.summary) return <PageLoading label="Loading outreach…" />;
  const cards = [
    ["Unlocked", data.summary.unlocked],
    ["Outreached", data.summary.outreached],
    ["Confirmed sends", data.summary.confirmedSends],
    ["Demo outbox", data.summary.demoOutbox],
    ["Reply rate", `${Math.round(data.summary.replyRate * 100)}%`],
    ["Positive rate", `${Math.round(data.summary.positiveRate * 100)}%`],
    ["Interviews", data.summary.interviews],
  ];
  return (
    <div className="px-4 py-6 lg:px-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.18em] text-faint">OUTREACH & ANALYTICS</p>
          <h1 className="mt-2 text-4xl font-semibold">Track what you sent.</h1>
        </div>
        <button onClick={sync} className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black">Sync replies</button>
      </div>
      {message ? <p className="mt-3 text-sm text-cream">{message}</p> : null}
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(([label, value]) => (
          <article key={label} className="rounded-2xl border border-line bg-card p-4">
            <p className="text-3xl font-semibold">{value}</p>
            <p className="text-sm text-muted">{label}</p>
          </article>
        ))}
      </div>
      <section className="mt-4 h-64 rounded-2xl border border-line bg-card p-4">
        <h2 className="mb-2 font-semibold">Confirmed sends and replies</h2>
        <ResponsiveContainer width="100%" height="85%">
          <BarChart data={data.chart}>
            <XAxis dataKey="week" stroke="#71717a" fontSize={12} />
            <YAxis stroke="#71717a" fontSize={12} allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="sent" fill="#f7f7f8" radius={4} />
            <Bar dataKey="replies" fill="#e6c15a" radius={4} />
          </BarChart>
        </ResponsiveContainer>
      </section>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-line bg-card p-4">
          <h2 className="font-semibold">Follow-ups due</h2>
          {data.followups.length === 0 ? <p className="mt-3 text-sm text-muted">No open reminders. Scheduling a follow-up does not send email unless you explicitly authorize one.</p> : data.followups.map((item) => (
            <div key={item.id} className="mt-3 border-t border-line pt-3 text-sm">
              <p>{item.note}</p>
              <p className="text-faint">Due {timeAgo(item.dueAt)} · <StatusPill status={item.status === "open" ? "follow_up_needed" : "closed"} /></p>
            </div>
          ))}
        </section>
        <section className="rounded-2xl border border-line bg-card p-4">
          <h2 className="font-semibold">Activity</h2>
          {data.messages.length === 0 ? <p className="mt-3 text-sm text-muted">No messages yet.</p> : data.messages.slice(0, 8).map((item) => (
            <div key={item.id} className="mt-3 flex items-center justify-between border-t border-line pt-3 text-sm">
              <span>{item.subject || "(no subject)"}</span>
              <span className="text-faint">{item.deliveryConfirmed ? "Confirmed" : item.status} · {timeAgo(item.createdAt)}</span>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
