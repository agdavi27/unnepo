"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AtsBadge, CompanyLogo } from "@/components/unnepo/company";
import { StatsPage } from "@/components/unnepo/stats";
import { stageOf, appliedOn, applicationStats, type Stage } from "@/lib/apply/stats";
import type { ApplicationContact, ApplicationProfile, JobApplication, OutreachState } from "@/lib/apply/types";

const btn = "inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const primary = `${btn} bg-white text-black hover:bg-zinc-200`;
const secondary = `${btn} border border-line bg-transparent text-ink hover:bg-white/5`;
const card = "rounded-2xl border border-line bg-panel p-5 sm:p-6";

export type App = JobApplication & { missing: string[]; contacts?: ApplicationContact[] };
export type PublicProfile = Omit<ApplicationProfile, "jobSitePasswordEncrypted"> & { hasJobSitePassword: boolean };
export type ApplyData = {
  applications: App[];
  profile: PublicProfile;
  resume: { fileName: string; stored: boolean } | null;
  ready: { hunter: boolean; profile: boolean };
  applicationsPerCredit: number;
};
export type TrackerView = "applied" | "stats";

const ROLE_LABEL: Record<ApplicationContact["role"], string> = {
  alumni: "From your school",
  job_poster: "Named on posting",
  recruiter: "Recruiter",
  hiring_manager: "Hiring manager",
  team_member: "Team",
};

const OUTREACH: Array<[OutreachState, string]> = [["not_contacted", "Not contacted"], ["emailed", "Emailed"], ["replied", "Replied"], ["no_response", "No response"]];

export const STAGE: Record<Stage, { label: string; color: string }> = {
  in_progress: { label: "In progress", color: "#F5A524" },
  submitted: { label: "Submitted", color: "#9A9AA3" },
  interviewing: { label: "Interviewing", color: "#3D8BFF" },
  offer: { label: "Offer", color: "#4ADE80" },
  rejected: { label: "Rejected", color: "#8B8B94" },
};

async function call<T>(path: string, method: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/apply${path}`, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Something went wrong (${response.status}).`);
  return payload as T;
}

function when(date: Date) {
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

/** The tracker's two pages share one data load: Applied and Stats. */
export function ApplyArea({ view, refreshKey = 0 }: { view: TrackerView; refreshKey?: number }) {
  const [data, setData] = useState<ApplyData | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await call<ApplyData>("", "GET"));
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't load your applications.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- first load of server data
    void load();
  }, [load, refreshKey]);

  // Contact discovery runs after the response; check back until it's done.
  const busy = useMemo(() => (data?.applications ?? []).some((app) => app.contactsStatus === "finding" || app.contactsStatus === "writing"), [data]);
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => void load(), 4000);
    return () => clearInterval(timer);
  }, [busy, load]);

  if (error && !data) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
        <p>{error}</p>
        <button type="button" className="rounded-lg border border-red-900/70 px-3 py-1 text-red-200" onClick={() => void load()}>Try again</button>
      </div>
    );
  }
  if (!data) return <p className="text-sm text-muted">Loading your applications…</p>;

  if (view === "stats") {
    return (
      <StatsPage
        applications={data.applications}
        weeklyGoal={data.profile.weeklyGoal ?? null}
        onGoal={async (weeklyGoal) => {
          const result = await call<{ profile: PublicProfile }>("/profile", "PUT", { weeklyGoal });
          setData({ ...data, profile: result.profile });
        }}
      />
    );
  }
  return (
    <AppliedPage
      data={data}
      onReload={load}
      onReplace={(app) => setData({ ...data, applications: data.applications.map((item) => (item.id === app.id ? { ...item, ...app, contacts: item.contacts } : item)) })}
      onApps={(change) => setData((previous) => (previous ? { ...previous, applications: change(previous.applications) } : previous))}
    />
  );
}

/** Job-site preferences that used to sit on the Apply page. Loads its own data. */
export function ApplicationSettings() {
  const [consent, setConsent] = useState<boolean | null>(null);
  const [state, setState] = useState("");
  useEffect(() => {
    call<ApplyData>("", "GET").then((data) => setConsent(Boolean(data.profile.accountConsentAt)), () => setConsent(false));
  }, []);
  async function save(value: boolean) {
    setConsent(value);
    setState("Saving…");
    try {
      await call("/profile", "PUT", { accountConsent: value });
      setState("Saved.");
    } catch (reason) {
      setConsent(!value);
      setState(reason instanceof Error ? reason.message : "Couldn't save.");
    }
  }
  return (
    <div className="rounded-2xl border border-line bg-panel p-5">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-faint">Applications</h2>
      <label className="mt-3 flex items-start gap-2.5 text-sm">
        <input type="checkbox" className="mt-1" checked={Boolean(consent)} disabled={consent === null} onChange={(event) => void save(event.target.checked)} />
        <span>Accept job sites&apos; terms, privacy notices, and acknowledgements on my behalf when an application asks. Arbitration, background-check, and non-compete agreements are always left for me, and Unnepo never opts me into marketing.</span>
      </label>
      {state && <p className="mt-2 text-xs text-muted">{state}</p>}
    </div>
  );
}

function StageDot({ stage }: { stage: Stage }) {
  const color = STAGE[stage].color;
  return <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={stage === "rejected" ? { boxShadow: `inset 0 0 0 1.5px ${color}` } : { background: color }} />;
}

/** The status of an applied job, changeable by the student. Jobs not submitted yet just say so. */
function StageControl({ app, onChange }: { app: App; onChange: (outcome: Stage) => void }) {
  const stage = stageOf(app);
  if (stage === "in_progress") {
    return <span className="inline-flex shrink-0 items-center gap-2 text-sm" style={{ color: STAGE.in_progress.color }}><StageDot stage={stage} />In progress</span>;
  }
  return (
    <span className="relative inline-flex shrink-0 items-center justify-self-start">
      <span className="pointer-events-none absolute left-2.5 top-1/2 flex -translate-y-1/2"><StageDot stage={stage} /></span>
      <select
        aria-label={`Status for ${app.title} at ${app.company}`}
        className={`cursor-pointer appearance-none rounded-lg border border-transparent bg-transparent py-1 pl-6 pr-6 text-sm hover:border-line focus:border-line focus:outline-none ${stage === "rejected" ? "text-faint" : "text-ink"}`}
        value={stage}
        onChange={(event) => onChange(event.target.value as Stage)}
      >
        {(["submitted", "interviewing", "offer", "rejected"] as const).map((value) => <option key={value} value={value} className="bg-card text-ink">{STAGE[value].label}</option>)}
      </select>
      <span aria-hidden className="pointer-events-none absolute right-2 text-[10px] text-faint">▾</span>
    </span>
  );
}

const FILTERS: Array<["all" | Stage, string]> = [["all", "All"], ["submitted", "Submitted"], ["interviewing", "Interviewing"], ["offer", "Offer"], ["rejected", "Rejected"], ["in_progress", "In progress"]];

const UNDO_MS = 5000;
const deleteNow = (applicationId: string, keepalive = false) =>
  fetch("/api/apply/applications", { method: "DELETE", keepalive, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ applicationId }) });

function AppliedPage({ data, onReload, onReplace, onApps }: { data: ApplyData; onReload: () => Promise<void>; onReplace: (app: App) => void; onApps: (change: (apps: App[]) => App[]) => void }) {
  const apps = data.applications;
  // Removing is instant: the row goes away and is deleted for real after a few seconds, unless undone.
  const [removed, setRemoved] = useState<App[]>([]);
  const pending = useRef(new Map<string, number>());
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | Stage>("all");
  const [query, setQuery] = useState("");
  const [problem, setProblem] = useState("");
  const stats = useMemo(() => applicationStats(apps), [apps]);
  const counts = useMemo(() => {
    const result: Record<string, number> = { all: apps.length };
    for (const app of apps) result[stageOf(app)] = (result[stageOf(app)] ?? 0) + 1;
    return result;
  }, [apps]);
  const shown = useMemo(() => {
    const words = query.trim().toLowerCase();
    return apps
      .filter((app) => filter === "all" || stageOf(app) === filter)
      .filter((app) => !words || `${app.company} ${app.title} ${app.location ?? ""}`.toLowerCase().includes(words))
      .sort((a, b) => appliedOn(b).getTime() - appliedOn(a).getTime());
  }, [apps, filter, query]);

  function remove(app: App) {
    onApps((list) => list.filter((item) => item.id !== app.id));
    setRemoved((list) => [...list, app]);
    if (open === app.id) setOpen(null);
    pending.current.set(app.id, window.setTimeout(async () => {
      pending.current.delete(app.id);
      setRemoved((list) => list.filter((item) => item.id !== app.id));
      const response = await deleteNow(app.id).catch(() => null);
      if (!response?.ok) {
        onApps((list) => (list.some((item) => item.id === app.id) ? list : [app, ...list]));
        setProblem(`Couldn't remove ${app.company}. Try again.`);
      }
    }, UNDO_MS));
  }
  function undo() {
    for (const app of removed) {
      clearTimeout(pending.current.get(app.id));
      pending.current.delete(app.id);
    }
    onApps((list) => [...removed.filter((app) => !list.some((item) => item.id === app.id)), ...list]);
    setRemoved([]);
  }
  // Leaving the page (or the tab) finishes any removals still waiting.
  useEffect(() => {
    const timers = pending.current;
    const flush = () => {
      for (const [id, timer] of timers) {
        clearTimeout(timer);
        void deleteNow(id, true).catch(() => undefined);
      }
      timers.clear();
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

  async function act(path: string, method: string, body: unknown) {
    setProblem("");
    try {
      await call(path, method, body);
      await onReload();
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : "That didn't work.");
    }
  }
  async function setStage(app: App, stage: Stage) {
    setProblem("");
    const outcome = stage === "submitted" || stage === "in_progress" ? null : stage;
    onReplace({ ...app, fillReport: { ...(app.fillReport ?? { filled: [], failed: [], liveViewUrl: null, screenshotAt: null }), outcome } });
    try {
      const result = await call<{ application: App }>("/outcome", "PATCH", { applicationId: app.id, outcome });
      onReplace(result.application);
    } catch (reason) {
      onReplace(app);
      setProblem(reason instanceof Error ? reason.message : "Couldn't change the status.");
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Applied</h1>
          <p className="mt-2 text-sm text-muted tabular-nums">
            {stats.applied} {stats.applied === 1 ? "application" : "applications"} · {stats.thisWeek} this week
            {stats.inProgress > 0 && ` · ${stats.inProgress} in progress`}
          </p>
        </div>
        {apps.length > 0 && (
          <label className="relative w-full sm:w-64">
            <span className="sr-only">Search applications</span>
            <svg aria-hidden viewBox="0 0 16 16" className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" /></svg>
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search company or role" className="w-full rounded-xl border border-line bg-card py-2 pl-9 pr-3 text-sm text-ink outline-none placeholder:text-faint focus:border-zinc-500" />
          </label>
        )}
      </div>

      {apps.length > 0 && (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label="Filter by status">
          {FILTERS.filter(([id]) => id === "all" || counts[id]).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors ${filter === id ? "border-white bg-white text-black" : "border-line text-muted hover:text-white"}`}
            >
              {id !== "all" && filter !== id && <StageDot stage={id} />}
              {label}
              <span className={`tabular-nums ${filter === id ? "text-black/60" : "text-faint"}`}>{counts[id] ?? 0}</span>
            </button>
          ))}
        </div>
      )}

      {problem && <p role="alert" className="text-sm text-red-300">{problem}</p>}

      {apps.length === 0 ? (
        <div className={`${card} flex flex-col items-start gap-3`}>
          <p className="font-medium">No applications yet</p>
          <p className="max-w-xl text-sm text-muted">Open a job application in Chrome and press Fill in the Unnepo extension. Every job you submit shows up here, with people at the company to email.</p>
          <a href="/extension/connect" className={primary}>Connect the extension</a>
        </div>
      ) : shown.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">Nothing matches.</p>
      ) : (
        <ul className="border-t border-line">
          {shown.map((app) => {
            const expanded = open === app.id;
            const stage = stageOf(app);
            const people = app.contacts?.length ?? 0;
            const toggle = () => setOpen(expanded ? null : app.id);
            return (
              <li key={app.id} className="group border-b border-line">
                <div className="flex items-center gap-3 py-3.5 sm:grid sm:grid-cols-[minmax(0,1fr)_5.5rem_9rem_6.5rem_2rem] sm:gap-4">
                  <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={toggle} aria-expanded={expanded}>
                    <CompanyLogo app={app} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{app.company}</span>
                      <span className="flex min-w-0 items-center gap-2 text-sm text-muted">
                        <span className="truncate">{app.title}</span>
                        <span aria-hidden className="hidden text-faint sm:inline">·</span>
                        <span className="hidden sm:inline-flex"><AtsBadge ats={app.ats} /></span>
                      </span>
                      <span className="mt-1 flex items-center gap-2 text-xs text-faint sm:hidden">
                        <AtsBadge ats={app.ats} label />
                        <span aria-hidden>·</span>
                        <span>{when(appliedOn(app))}</span>
                      </span>
                    </span>
                  </button>
                  <span className="hidden text-sm text-muted tabular-nums sm:block">{when(appliedOn(app))}</span>
                  <StageControl app={app} onChange={(next) => void setStage(app, next)} />
                  <button type="button" onClick={toggle} aria-expanded={expanded} className="hidden items-center justify-end gap-1 text-sm text-muted hover:text-white sm:inline-flex">
                    {stage === "in_progress" ? "Details" : `${people} ${people === 1 ? "person" : "people"}`}
                    <span aria-hidden className={`transition-transform ${expanded ? "rotate-90" : ""}`}>→</span>
                  </button>
                  <button type="button" onClick={() => remove(app)} aria-label={`Remove ${app.title} at ${app.company}`} title="Remove" className="-mr-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-faint transition-colors hover:bg-red-500/10 hover:text-red-300 sm:justify-self-end sm:opacity-40 sm:group-hover:opacity-100 sm:focus-visible:opacity-100">
                    <svg aria-hidden viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2.5 4h11M6.5 4V2.75h3V4M4 4l.7 9.25h6.6L12 4M6.75 6.75v4M9.25 6.75v4" /></svg>
                  </button>
                </div>
                {expanded && (
                  <div className="mb-4 space-y-4 rounded-xl border border-line bg-panel p-4">
                    {stage === "in_progress" ? (
                      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
                        <p>Not submitted yet. Open the application and press Fill in the Unnepo extension, or mark it applied if you sent it yourself.</p>
                        <button type="button" className={secondary} onClick={() => void act("/applied", "POST", { applicationId: app.id })}>I applied</button>
                      </div>
                    ) : (
                      <ContactsPanel app={app} onStatus={(contactId, status) => void act("/contact", "PATCH", { contactId, status })} onRetry={() => void act("/retry-contacts", "POST", { applicationId: app.id })} />
                    )}
                    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line pt-3 text-xs text-faint">
                      <span className="min-w-0">
                        {app.status === "submitted" && app.confirmation
                          ? app.confirmation.confidence === "likely" ? "Looks submitted: the page said so." : "Confirmed: the site accepted the submission."
                          : app.status === "applied_manual" ? "Marked applied by you." : app.statusMessage}
                      </span>
                      <span className="flex flex-wrap gap-4">
                        {app.confirmation?.receiptPath && <a className="hover:text-white" href={`/api/apply/receipt?applicationId=${encodeURIComponent(app.id)}`} target="_blank" rel="noreferrer">Receipt ↗</a>}
                        <a className="hover:text-white" href={app.jobUrl} target="_blank" rel="noreferrer">Job posting ↗</a>
                        <button type="button" className="hover:text-red-300" onClick={() => remove(app)}>Remove</button>
                      </span>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {removed.length > 0 && (
        <div role="status" className="fixed inset-x-4 bottom-5 z-20 mx-auto flex max-w-md items-center justify-between gap-4 rounded-xl border border-line bg-card px-4 py-3 text-sm shadow-2xl">
          <span className="min-w-0 truncate">{removed.length === 1 ? `Removed ${removed[0].company}` : `Removed ${removed.length} applications`}</span>
          <button type="button" onClick={undo} className="shrink-0 font-semibold text-[#3D8BFF] hover:text-white">Undo</button>
        </div>
      )}
    </div>
  );
}

function Avatar({ name, photoUrl }: { name: string; photoUrl: string | null }) {
  const [failed, setFailed] = useState(false);
  const initials = name.split(/\s+/).map((part) => part[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
  if (photoUrl && !failed) {
    return <img src={photoUrl} alt="" className="h-12 w-12 shrink-0 rounded-full border border-line object-cover" onError={() => setFailed(true)} />;
  }
  return <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-line bg-card text-sm font-medium text-muted">{initials}</span>;
}

function ContactsPanel({ app, onStatus, onRetry }: { app: App; onStatus: (contactId: string, status: OutreachState) => void; onRetry: () => void }) {
  const contacts = app.contacts ?? [];
  const [copied, setCopied] = useState("");
  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      setCopied("");
    }
  }
  if (app.contactsStatus === "finding" || app.contactsStatus === "idle") return <p className="text-sm text-muted">Finding people for this role…</p>;
  return (
    <div className="space-y-3">
      {app.contactsStatus === "writing" && <p className="text-sm text-muted">Writing emails…</p>}
      {app.contactsMessage && <p className="text-xs text-faint">{app.contactsMessage}</p>}
      {app.contactsStatus === "failed" && <button type="button" className={secondary} onClick={onRetry}>Try again</button>}
      {contacts.length === 0 && app.contactsStatus === "done" && (
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted"><p>No one found for this role.</p><button type="button" className={secondary} onClick={onRetry}>Search again</button></div>
      )}
      {contacts.map((contact) => {
        const email = contact.emailBody ? `Subject: ${contact.emailSubject ?? ""}\n\n${contact.emailBody}` : "";
        return (
          <article key={contact.id} className="rounded-xl border border-line bg-panel p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar name={contact.name} photoUrl={contact.photoUrl} />
                <div className="min-w-0">
                  <p className="truncate font-medium">{contact.name} <span className="ml-1 rounded-full border border-line px-2 py-0.5 align-middle text-[10px] text-muted">{ROLE_LABEL[contact.role]}</span></p>
                  <p className="truncate text-sm text-muted">{contact.title}</p>
                </div>
              </div>
              <select aria-label={`Outreach status for ${contact.name}`} className="rounded-lg border border-line bg-card px-2 py-1 text-xs" value={contact.outreachStatus} onChange={(event) => onStatus(contact.id, event.target.value as OutreachState)}>
                {OUTREACH.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
              </select>
            </div>
            <p className="mt-2 text-xs text-faint">{contact.relevance}</p>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
              {contact.email ? (
                <button type="button" className="text-ink underline-offset-4 hover:underline" onClick={() => void copy(`${contact.id}:email`, contact.email!)}>{copied === `${contact.id}:email` ? "Copied ✓" : contact.email}</button>
              ) : <span className="text-muted">No verified email</span>}
              {contact.emailSource && <span className="text-[11px] text-faint">via {contact.emailSource === "job_posting" ? "the posting, verified by Hunter" : contact.emailSource === "hunter" ? "Hunter" : "Apollo"}</span>}
              {contact.linkedinUrl && (
                <a className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs text-ink hover:bg-white/5" href={contact.linkedinUrl} target="_blank" rel="noreferrer" aria-label={`${contact.name} on LinkedIn`}>
                  <span aria-hidden className="flex h-4 w-4 items-center justify-center rounded-[3px] bg-[#0A66C2] text-[9px] font-bold text-white">in</span>
                  LinkedIn
                </a>
              )}
            </div>
            {email && (
              <div className="mt-3">
                <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-card p-3 font-sans text-sm text-zinc-300">{email}</pre>
                <button type="button" className={`${secondary} mt-2`} onClick={() => void copy(contact.id, email)}>{copied === contact.id ? "Copied ✓" : "Copy email"}</button>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
