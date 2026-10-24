"use client";

import { useEffect, useState } from "react";
import { Avatar, StatusPill } from "@/components/product/bits";
import { STATUS_LABEL } from "@/lib/catalog";
import { Composer } from "@/components/product/contacts-view";

type Row = {
  saved: { id: string; status: string; notes: string; followUpAt: string | null; listName: string; contactId: string };
  contact: { fullName: string; title: string; company: string; location: string; email: string | null; school: string | null; dataSource: string } | null;
};

export function SavedView() {
  const [rows, setRows] = useState<Row[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [compose, setCompose] = useState<string | null>(null);

  function load() {
    fetch("/api/saved").then((response) => response.json()).then((data) => setRows(data.rows ?? []));
  }
  useEffect(load, []);

  async function patch(id: string, body: Record<string, unknown>) {
    await fetch("/api/saved", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...body }) });
    load();
  }

  const visible = rows.filter((row) => {
    const blob = `${row.contact?.fullName} ${row.contact?.company} ${row.contact?.title}`.toLowerCase();
    if (query && !blob.includes(query.toLowerCase())) return false;
    if (status !== "all" && row.saved.status !== status) return false;
    return true;
  });

  return (
    <div className="px-4 py-6 lg:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.18em] text-faint">SAVED CONTACTS</p>
          <h1 className="mt-2 text-4xl font-semibold">People you unlocked.</h1>
        </div>
        <a href="/api/saved/export" className="rounded-xl border border-line px-4 py-2 text-sm">Export CSV</a>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search saved contacts" className="field max-w-sm" />
        <select value={status} onChange={(event) => setStatus(event.target.value)} className="field max-w-xs">
          <option value="all">All statuses</option>
          {Object.entries(STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>
      <div className="mt-4 space-y-3">
        {visible.length === 0 ? <p className="text-muted">Unlocked contacts land here automatically. Searches stay free.</p> : null}
        {visible.map((row) => (
          <article key={row.saved.id} className="rounded-2xl border border-line bg-card p-4">
            <div className="flex flex-wrap items-center gap-3">
              <Avatar name={row.contact?.fullName || "Contact"} />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{row.contact?.fullName}</p>
                <p className="text-sm text-faint">{row.contact?.title} · {row.contact?.company} · {row.contact?.location}</p>
                <p className="text-sm text-muted">{row.contact?.email}</p>
              </div>
              <StatusPill status={row.saved.status} />
              <button onClick={() => setCompose(row.saved.contactId)} className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-black">Write email</button>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-3">
              <select value={row.saved.status} onChange={(event) => patch(row.saved.id, { status: event.target.value })} className="field">
                {Object.entries(STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <input defaultValue={row.saved.listName} onBlur={(event) => patch(row.saved.id, { listName: event.target.value })} className="field" placeholder="List name" />
              <input type="date" defaultValue={row.saved.followUpAt?.slice(0, 10) || ""} onChange={(event) => patch(row.saved.id, { followUpAt: event.target.value ? new Date(event.target.value).toISOString() : null })} className="field" />
              <textarea defaultValue={row.saved.notes} onBlur={(event) => patch(row.saved.id, { notes: event.target.value })} className="field md:col-span-3" placeholder="Notes" />
            </div>
          </article>
        ))}
      </div>
      {compose ? <Composer contactId={compose} onClose={() => setCompose(null)} /> : null}
    </div>
  );
}
