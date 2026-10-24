"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bookmark } from "lucide-react";
import { CompanyMark, Notice } from "@/components/product/bits";
import { timeAgo } from "@/lib/format";

type Job = { id: string; title: string; company: string; location: string; postedAt: string; url: string; dataSource: string; description: string; saved?: boolean };

export function JobsView() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState<string[]>([]);

  function load() {
    fetch("/api/jobs").then((response) => response.json()).then((data) => {
      setJobs(data.jobs ?? []);
      setNotice(data.notice);
      setSaved(data.savedIds ?? []);
    });
  }
  useEffect(load, []);

  async function toggle(job: Job) {
    await fetch("/api/jobs/save", { method: saved.includes(job.id) ? "DELETE" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId: job.id }) });
    load();
  }

  return (
    <div className="px-4 py-6 lg:px-6">
      <p className="text-[11px] font-semibold tracking-[0.18em] text-faint">JOB POSTINGS</p>
      <h1 className="mt-2 text-4xl font-semibold">Roles that match your goals.</h1>
      {notice ? <div className="mt-4"><Notice>{notice}</Notice></div> : null}
      <div className="mt-5 space-y-3">
        {jobs.map((job) => (
          <article key={job.id} className="flex flex-col gap-3 rounded-2xl border border-line bg-card p-4 md:flex-row md:items-center">
            <CompanyMark company={job.company} />
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold">{job.title}</h2>
              <p className="text-sm text-muted">{job.company} · {job.location} · {timeAgo(job.postedAt)}</p>
              <p className="mt-1 line-clamp-2 text-sm text-faint">{job.description}</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => toggle(job)} className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm"><Bookmark className="h-4 w-4" /> {saved.includes(job.id) ? "Saved" : "Save"}</button>
              <Link href={`/contacts?company=${encodeURIComponent(job.company)}`} className="rounded-lg bg-white px-3 py-2 text-sm font-semibold text-black">Find people</Link>
              <a href={job.url} target="_blank" rel="noreferrer" className="rounded-lg border border-line px-3 py-2 text-sm">Apply</a>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
