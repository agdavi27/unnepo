"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bookmark, ExternalLink } from "lucide-react";
import { CompanyLogo, Notice, PageLoading } from "@/components/product/bits";
import { timeAgo } from "@/lib/format";

type Job = {
  id: string;
  title: string;
  company: string;
  location: string;
  postedAt: string;
  url: string;
  provider: string;
  dataSource: string;
  description: string;
  logoUrl?: string | null;
};

type SearchLink = { source: string; label: string; url: string; domain: string };

const SOURCE: Record<string, string> = {
  linkedin: "LinkedIn",
  ziprecruiter: "ZipRecruiter",
  greenhouse: "Career page",
  lever: "Career page",
  remotive: "Remotive",
  arbeitnow: "Career page",
        adzuna: "Job board",
  ashby: "Career page",
  sample: "Sample",
};

export function JobsView() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [savedJobs, setSavedJobs] = useState<Job[]>([]);
  const [searches, setSearches] = useState<SearchLink[]>([]);
  const [queries, setQueries] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(12);
  const [letter, setLetter] = useState<{ id: string; body: string } | null>(null);
  const [letterError, setLetterError] = useState("");

  function load(nextPage = page) {
    setLoading(true);
    fetch(`/api/jobs?page=${nextPage}`)
      .then((response) => response.json())
      .then((data) => {
        setJobs(data.jobs ?? []);
        setSavedJobs(data.savedJobs ?? []);
        setSearches(data.searches ?? []);
        setQueries(data.queries ?? []);
        setNotice(data.notice);
        setSaved(data.savedIds ?? []);
        setPage(data.page || nextPage);
        setTotal(data.total ?? (data.jobs?.length ?? 0));
        setPageSize(data.pageSize || 12);
      })
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    load(1);
    // First page only. Later pages go through the pager.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggle(job: Job) {
    await fetch("/api/jobs/save", {
      method: saved.includes(job.id) ? "DELETE" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: job.id }),
    });
    load();
  }

  async function downloadLetter(body: string) {
    const response = await fetch("/api/cover-letter/pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, company: "", role: "" }),
    });
    if (!response.ok) {
      setLetterError("The PDF could not be created.");
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "cover-letter.pdf";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function writeLetter(job: Job) {
    setLetterError("");
    const response = await fetch("/api/cover-letter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: job.id, company: job.company, role: job.title, description: job.description, tone: "professional" }),
    });
    const data = await response.json();
    if (!response.ok) {
      setLetterError(data.error || "Cover letters are on Pro and Premium.");
      return;
    }
    setLetter({ id: data.letter.id, body: data.letter.body });
  }

  const savedIds = new Set(savedJobs.map((job) => job.id));
  const feed = jobs.filter((job) => !savedIds.has(job.id));

  return (
    <div className="px-4 py-6 lg:px-6">
      <p className="text-[11px] font-semibold tracking-[0.18em] text-faint">JOB POSTINGS</p>
      <h1 className="mt-2 text-4xl font-semibold">Roles that match your resume.</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted">
        {queries.length ? <>Searching {queries.join(", ")}.</> : "Pick roles on Home and these listings follow your resume."} Pulled from LinkedIn and company career pages.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {searches.map((search) => (
          <a key={search.source} href={search.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full border border-line bg-card px-3 py-2 text-sm">
            <CompanyLogo company={search.label} src={`https://www.google.com/s2/favicons?domain=${search.domain}&sz=64`} className="h-5 w-5 p-0.5" />
            Open {search.label}
            <ExternalLink className="h-3.5 w-3.5 text-faint" />
          </a>
        ))}
      </div>
      {notice ? <div className="mt-4"><Notice>{notice}</Notice></div> : null}
      {letterError ? <p className="mt-3 text-sm text-cream">{letterError}</p> : null}
      {letter ? (
        <section className="mt-4 rounded-2xl border border-line bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold">Cover letter</h2>
            <button type="button" className="text-sm text-cream" onClick={() => downloadLetter(letter.body)}>Download PDF</button>
          </div>
          <textarea value={letter.body} onChange={(event) => setLetter({ ...letter, body: event.target.value })} className="mt-3 h-56 w-full rounded-xl border border-line bg-transparent px-3 py-2 text-sm outline-none" />
        </section>
      ) : null}

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Saved jobs</h2>
        {savedJobs.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Nothing saved yet. Bookmark a role and it stays here.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {savedJobs.map((job) => <JobCard key={job.id} job={job} saved onToggle={() => toggle(job)} onLetter={() => writeLetter(job)} />)}
          </div>
        )}
      </section>

      <section className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{loading ? "Looking up live postings…" : "Open roles"}</h2>
          <Pager page={page} total={total} pageSize={pageSize} loading={loading} onPage={load} />
        </div>
        {loading && jobs.length === 0 ? <PageLoading label="Looking up live postings…" /> : (
        <div className="mt-3 space-y-3">
          {feed.map((job) => <JobCard key={job.id} job={job} saved={saved.includes(job.id)} onToggle={() => toggle(job)} onLetter={() => writeLetter(job)} />)}
          {!loading && feed.length === 0 ? <p className="text-sm text-muted">No new matches. Try another role on Home, or open LinkedIn and ZipRecruiter above.</p> : null}
        </div>
        )}
        <div className="mt-4">
          <Pager page={page} total={total} pageSize={pageSize} loading={loading} onPage={load} />
        </div>
      </section>
    </div>
  );
}

function Pager({ page, total, pageSize, loading, onPage }: { page: number; total: number; pageSize: number; loading: boolean; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center gap-2 text-sm text-muted">
      <span>{total} roles</span>
      <button type="button" disabled={page <= 1 || loading} onClick={() => onPage(page - 1)} className="rounded-lg border border-line px-3 py-1 disabled:opacity-40">Previous</button>
      <span>{page} / {pages}</span>
      <button type="button" disabled={page >= pages || loading} onClick={() => onPage(page + 1)} className="rounded-lg border border-line px-3 py-1 disabled:opacity-40">Next</button>
    </div>
  );
}

function JobCard({ job, saved, onToggle, onLetter }: { job: Job; saved: boolean; onToggle: () => void; onLetter: () => void }) {
  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-line bg-card p-4 md:flex-row md:items-center">
      <CompanyLogo company={job.company} src={job.logoUrl} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold">{job.title}</h2>
          <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted">{SOURCE[job.provider] || "Listing"}</span>
        </div>
        <p className="text-sm text-muted">{job.company} · {job.location || "Location on the posting"} · {timeAgo(job.postedAt)}</p>
        <p className="mt-1 line-clamp-2 text-sm text-faint">{job.description}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={onToggle} className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${saved ? "border-gold text-cream" : "border-line"}`}>
          <Bookmark className={`h-4 w-4 ${saved ? "fill-current" : ""}`} /> {saved ? "Saved" : "Save"}
        </button>
        <Link href={`/contacts?company=${encodeURIComponent(job.company)}`} className="rounded-lg bg-white px-3 py-2 text-sm font-semibold text-black">Find people</Link>
        <a href={job.url} target="_blank" rel="noreferrer" className="rounded-lg border border-line px-3 py-2 text-sm">Apply</a>
        <button type="button" onClick={onLetter} className="rounded-lg border border-line px-3 py-2 text-sm">Cover letter</button>
      </div>
    </article>
  );
}
