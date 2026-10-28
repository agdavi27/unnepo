"use client";

import { useCallback, useEffect, useState } from "react";
import type { Highlight } from "@/components/unnepo/UnnepoForms";

export type Job = {
  id: string;
  title: string;
  company: string;
  location: string;
  postedAt: string;
  postedKind: "posted" | "updated";
  url: string;
  source: string;
  sourceLabel: string;
  description: string;
  reasons: string[];
};

type LetterInput = { job: { title: string; company: string; description: string; url?: string }; studentFactIds: string[]; detailFactIds: string[]; tone: string; length: string; notes: string };

const btn = "inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40";
const primary = `${btn} bg-white text-black hover:bg-zinc-200`;
const secondary = `${btn} border border-line bg-transparent text-ink hover:bg-white/5`;
const field = "w-full rounded-xl border border-line bg-card px-3 py-2.5 text-sm text-ink outline-none placeholder:text-faint focus:border-zinc-500";
const label = "mb-1.5 block text-xs font-medium text-muted";

/** "Posted today", "Posted 3 days ago", "Updated Oct 2". */
export function postedLabel(job: Pick<Job, "postedAt" | "postedKind">, now: number) {
  if (!job.postedAt) return "Date not listed";
  const verb = job.postedKind === "updated" ? "Updated" : "Posted";
  const date = new Date(job.postedAt);
  const days = Math.floor((now - date.getTime()) / 86400000);
  if (days <= 0) return `${verb} today`;
  if (days === 1) return `${verb} yesterday`;
  if (days < 7) return `${verb} ${days} days ago`;
  return `${verb} ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

export function JobsPage({ onCoverLetter }: { onCoverLetter: (job: Job | null, jobs: Job[]) => void }) {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [companies, setCompanies] = useState<string[]>([]);
  const [now, setNow] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [studentOnly, setStudentOnly] = useState(false);

  const load = useCallback(async (refresh: boolean) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/app/jobs${refresh ? "?refresh=1" : ""}`, { signal: AbortSignal.timeout(45_000) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Jobs could not be loaded.");
      setJobs(payload.jobs ?? []);
      setCompanies(payload.searchedCompanies ?? []);
      setNow(Date.now());
    } catch (reason) {
      setError(reason instanceof Error && reason.name !== "TimeoutError" ? reason.message : "Job boards took too long to answer. Try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void load(false));
  }, [load]);

  const shown = (jobs ?? []).filter((job) => !studentOnly || job.reasons.some((reason) => reason === "Internship" || reason === "Early-career role"));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Recommended Jobs</h1>
          <p className="mt-1 text-sm text-muted">Matched to your roles, dream companies, cities, and interests.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void load(true)} disabled={loading} className={secondary}>{loading ? "Searching…" : "Refresh"}</button>
          <button type="button" onClick={() => onCoverLetter(null, jobs ?? [])} className={primary}>✦ Write me a cover letter</button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-faint">
        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input type="checkbox" checked={studentOnly} onChange={(event) => setStudentOnly(event.target.checked)} />
          Internships and early-career only
        </label>
        <span>From company career pages (Greenhouse, Lever, Ashby), Remotive, and The Muse.{companies.length ? ` Checked: ${companies.slice(0, 6).join(", ")}${companies.length > 6 ? "…" : ""}` : ""}</span>
      </div>

      {error && <p role="alert" className="rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">{error}</p>}
      {loading && !jobs && <p className="rounded-2xl border border-line bg-panel p-8 text-center text-sm text-muted">Looking across job boards… this can take up to 20 seconds.</p>}
      {jobs && shown.length === 0 && !loading && (
        <p className="rounded-2xl border border-line bg-panel p-8 text-center text-sm text-muted">No matching openings right now. Add more roles or dream companies to your profile, or try Refresh later.</p>
      )}

      {shown.length > 0 && (
        <ul className="grid gap-3 lg:grid-cols-2">
          {shown.map((job) => (
            <li key={job.id} className="flex flex-col rounded-2xl border border-line bg-panel p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-semibold leading-snug">{job.title}</h2>
                  <p className="mt-0.5 truncate text-sm text-muted">{job.company}{job.location ? ` · ${job.location}` : ""}</p>
                </div>
                <span className="shrink-0 rounded-full border border-line px-2.5 py-0.5 text-[11px] text-zinc-300">{postedLabel(job, now)}</span>
              </div>
              {job.reasons.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {job.reasons.map((reason) => <span key={reason} className="rounded-full bg-card px-2.5 py-0.5 text-[11px] text-muted">{reason}</span>)}
                </div>
              )}
              {open === job.id && job.description && <p className="mt-3 max-h-60 overflow-auto whitespace-pre-line text-sm text-zinc-300">{job.description}</p>}
              <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
                <a href={job.url} target="_blank" rel="noopener noreferrer" className={primary}>Apply ↗</a>
                <button type="button" onClick={() => onCoverLetter(job, jobs ?? [])} className={secondary}>Cover letter</button>
                {job.description && <button type="button" onClick={() => setOpen(open === job.id ? null : job.id)} className="text-xs text-muted hover:text-white">{open === job.id ? "Hide details" : "Details"}</button>}
                <span className="ml-auto text-[11px] text-faint">{job.sourceLabel}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function CoverLetterModal({ jobs, initialJob, highlights, highlightsLoading, onClose, onGenerate }: {
  jobs: Job[];
  initialJob: Job | null;
  highlights: Highlight[];
  highlightsLoading: boolean;
  onClose: () => void;
  onGenerate: (input: LetterInput) => Promise<string>;
}) {
  const [step, setStep] = useState(initialJob ? 1 : 0);
  const [jobId, setJobId] = useState(initialJob?.id ?? "");
  const [custom, setCustom] = useState({ title: "", company: "", description: "" });
  const [mine, setMine] = useState<string[]>([]);
  const [details, setDetails] = useState<string[]>([]);
  const [tone, setTone] = useState("professional");
  const [length, setLength] = useState("standard");
  const [notes, setNotes] = useState("");
  const [letter, setLetter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const picked = jobs.find((item) => item.id === jobId) ?? (initialJob?.id === jobId ? initialJob : null);
  const job = picked ? { title: picked.title, company: picked.company, description: picked.description, url: picked.url } : custom;
  const jobReady = Boolean(job.title.trim() && job.company.trim());
  const toggle = (value: string, list: string[], set: (next: string[]) => void) => set(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);

  async function generate() {
    setBusy(true);
    setError("");
    try {
      setLetter(await onGenerate({ job, studentFactIds: mine, detailFactIds: details.filter((item) => mine.includes(item)), tone, length, notes }));
      setStep(3);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not write the letter.");
    } finally {
      setBusy(false);
    }
  }

  function download() {
    const blob = new Blob([letter], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Cover letter - ${job.company} - ${job.title}.txt`.replace(/[\\/:*?"<>|]+/g, " ");
    link.click();
    URL.revokeObjectURL(url);
  }

  const steps = ["Job", "Highlights", "Style", "Review"];
  return (
    <div role="presentation" className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-3 sm:p-6">
      <div role="dialog" aria-modal="true" aria-label="Write a cover letter" className="max-h-[calc(100vh-1.5rem)] w-full max-w-3xl space-y-5 overflow-y-auto rounded-2xl border border-line bg-panel p-5 shadow-2xl sm:p-7">
        <div className="flex justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-2xl font-bold">✦ Write a cover letter</h2>
            <p className="truncate text-sm text-muted">{jobReady ? `${job.title} · ${job.company}` : "Pick a job or paste one in"}</p>
          </div>
          <button aria-label="Close" className={secondary} onClick={onClose}>✕</button>
        </div>
        <div className="grid grid-cols-4 gap-1">
          {steps.map((name, index) => (
            <div key={name}>
              <div className={`h-1.5 rounded-full ${index <= step ? "bg-white" : "bg-line"}`} />
              <div className="mt-1 text-center text-[10px] text-muted">{name}</div>
            </div>
          ))}
        </div>

        {step === 0 && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Which job is this for?</h3>
            {jobs.length > 0 && (
              <div>
                <label className={label} htmlFor="letter-job">From your recommended jobs</label>
                <select id="letter-job" className={field} value={jobId} onChange={(event) => setJobId(event.target.value)}>
                  <option value="">Paste a different job instead…</option>
                  {jobs.map((item) => <option key={item.id} value={item.id}>{item.title} · {item.company}</option>)}
                </select>
              </div>
            )}
            {!picked && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={label} htmlFor="letter-title">Job title</label>
                  <input id="letter-title" className={field} value={custom.title} onChange={(event) => setCustom({ ...custom, title: event.target.value })} placeholder="Marketing Intern" />
                </div>
                <div>
                  <label className={label} htmlFor="letter-company">Company</label>
                  <input id="letter-company" className={field} value={custom.company} onChange={(event) => setCustom({ ...custom, company: event.target.value })} placeholder="Patagonia" />
                </div>
                <div className="sm:col-span-2">
                  <label className={label} htmlFor="letter-description">Job description</label>
                  <textarea id="letter-description" rows={6} className={field} value={custom.description} onChange={(event) => setCustom({ ...custom, description: event.target.value })} placeholder="Paste the posting so the letter can speak to what they're looking for." />
                </div>
              </div>
            )}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">What should the letter feature?</h3>
            <p className="text-sm text-muted">Pick two or three highlights that fit this job. The letter also draws on your uploaded resume.</p>
            {highlightsLoading ? (
              <p className="rounded-xl border border-line px-3 py-3 text-sm text-muted">Picking highlights from your profile…</p>
            ) : highlights.length ? (
              <div className="flex flex-wrap gap-2">
                {highlights.map((item) => (
                  <button key={item.id} type="button" title={item.detail} onClick={() => toggle(item.id, mine, setMine)} className={`${btn} border text-left ${mine.includes(item.id) ? "border-white bg-white text-black" : "border-line text-zinc-300 hover:bg-white/5"}`}>
                    {mine.includes(item.id) ? "✓ " : "+ "}{item.label}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">No highlights yet. The letter will use your resume and profile.</p>
            )}
            {highlights.filter((item) => item.experienceDetails && mine.includes(item.id)).map((item) => (
              <label key={item.id} className="flex items-start gap-3 rounded-xl border border-line p-3 text-sm">
                <input type="checkbox" className="mt-1" checked={details.includes(item.id)} onChange={() => toggle(item.id, details, setDetails)} />
                <span><span className="font-medium">Include details about {item.label}</span><span className="mt-0.5 block text-xs text-muted">{item.experienceDetails}</span></span>
              </label>
            ))}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">How should it sound?</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={label} htmlFor="letter-tone">Tone</label>
                <select id="letter-tone" className={field} value={tone} onChange={(event) => setTone(event.target.value)}>
                  <option value="professional">Professional and polished</option>
                  <option value="friendly">Warm and personable</option>
                  <option value="confident">Confident and direct</option>
                  <option value="enthusiastic">Enthusiastic</option>
                </select>
              </div>
              <div>
                <label className={label} htmlFor="letter-length">Length</label>
                <select id="letter-length" className={field} value={length} onChange={(event) => setLength(event.target.value)}>
                  <option value="short">Short (about 200 words)</option>
                  <option value="standard">Standard (about 300 words)</option>
                  <option value="detailed">Detailed (about 400 words)</option>
                </select>
              </div>
            </div>
            <div>
              <label className={label} htmlFor="letter-notes">Anything else to mention?</label>
              <textarea id="letter-notes" rows={3} className={field} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="e.g. I can start in June, or why this company matters to me" />
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            <h3 className="text-lg font-semibold">Review your letter</h3>
            <textarea aria-label="Cover letter" rows={16} className={`${field} leading-relaxed`} value={letter} onChange={(event) => setLetter(event.target.value)} />
            <div className="flex flex-wrap gap-2">
              <button type="button" className={secondary} disabled={busy} onClick={() => void generate()}>{busy ? "Writing…" : "↻ Regenerate"}</button>
              <button type="button" className={secondary} onClick={() => void navigator.clipboard.writeText(letter).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}>{copied ? "Copied" : "Copy"}</button>
              <button type="button" className={secondary} onClick={download}>Download .txt</button>
            </div>
            <p className="text-xs text-muted">Check every claim before you send it. The letter only uses your profile and resume, but always read it over.</p>
          </div>
        )}

        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        <div className="flex justify-between border-t border-line pt-4">
          <button className={secondary} disabled={step === 0} onClick={() => setStep((current) => Math.max(0, current - 1))}>← Back</button>
          {step < 2 ? (
            <button className={primary} disabled={step === 0 && !jobReady} onClick={() => setStep((current) => current + 1)}>Continue →</button>
          ) : step === 2 ? (
            <button className={primary} disabled={busy || !jobReady} onClick={() => void generate()}>{busy ? "Writing…" : "✦ Write my letter"}</button>
          ) : (
            <button className={primary} onClick={onClose}>Done</button>
          )}
        </div>
      </div>
    </div>
  );
}
