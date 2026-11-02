"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AtsBadge, CompanyLogo } from "@/components/unnepo/company";
import { FollowUpFacts } from "@/components/unnepo/follow-up-facts";
import { ActivityView, type Maybe, type Session } from "@/components/unnepo/activity";
import { followUpsDue } from "@/lib/apply/follow-ups";
import { PeopleSearching } from "@/components/unnepo/people-searching";
import { StatsPage } from "@/components/unnepo/stats";
import { stageOf, appliedOn, applicationStats, type Stage } from "@/lib/apply/stats";
import { SORTS, WHENS, arrange, postingLink, siteFor, sitesIn, type SortBy, type When } from "@/lib/apply/applied-list";
import type { ApplicationContact, ApplicationProfile, JobApplication, OutreachState } from "@/lib/apply/types";

const btn = "inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const primary = `${btn} bg-white text-black hover:bg-zinc-200`;
const secondary = `${btn} border border-line bg-transparent text-ink hover:bg-white/5`;
const card = "rounded-2xl border border-line bg-panel p-5 sm:p-6";

export type App = JobApplication & { missing: string[]; contacts?: ApplicationContact[]; companyMissing?: boolean };
export type PublicProfile = Omit<ApplicationProfile, "jobSitePasswordEncrypted"> & { hasJobSitePassword: boolean };
export type ApplyData = {
  applications: App[];
  profile: PublicProfile;
  resume: { fileName: string; stored: boolean } | null;
  ready: { hunter: boolean; profile: boolean };
  freeApplications: number;
  school: string;
  plan?: string;
  maybe?: Maybe[];
  session?: Session;
};
export type TrackerView = "applied" | "stats";

const ROLE_LABEL: Record<ApplicationContact["role"], string> = {
  alumni: "From your school",
  job_poster: "Named on posting",
  recruiter: "Recruiter",
  hiring_manager: "Hiring manager",
  team_member: "Team",
};

/** Where each email came from, and whether it was checked. */
const EMAIL_SOURCE: Record<NonNullable<ApplicationContact["emailSource"]>, string> = {
  apollo: "Verified · via Apollo",
  hunter: "Verified · via Hunter",
  job_posting: "Verified · from the posting",
  pattern: "Verified · built from the company's email format",
  website: "Verified · from the company's website",
  likely: "Guessed from the company's email format · not checked",
  guess: "Best guess (first.last) · not checked",
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
    const timer = setInterval(() => void load(), 2000);
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
        school={data.school}
        spiderSkin={data.profile.spiderSkin ?? null}
        onSpider={async (spiderSkin) => {
          const result = await call<{ profile: PublicProfile }>("/profile", "PUT", { spiderSkin });
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
  const [autoPeople, setAutoPeople] = useState<boolean | null>(null);
  const [state, setState] = useState("");
  useEffect(() => {
    call<ApplyData>("", "GET").then((data) => {
      setConsent(Boolean(data.profile.accountConsentAt));
      // Paid plans look for people on applying unless turned off; Free only when turned on.
      setAutoPeople(data.plan && data.plan !== "free" ? data.profile.autoFindPeople !== false : data.profile.autoFindPeople === true);
    }, () => setConsent(false));
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
  async function saveAutoPeople(value: boolean) {
    setAutoPeople(value);
    setState("Saving…");
    try {
      await call("/profile", "PUT", { autoFindPeople: value });
      setState("Saved.");
    } catch (reason) {
      setAutoPeople(!value);
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
      <label className="mt-3 flex items-start gap-2.5 text-sm">
        <input type="checkbox" className="mt-1" checked={Boolean(autoPeople)} disabled={autoPeople === null} onChange={(event) => void saveAutoPeople(event.target.checked)} />
        <span>Find people at the company as soon as a job is saved as applied, so the list is ready when I open it. 1 credit per job, only when someone with an email is found.</span>
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
  // The extension's My jobs opens /home?job=<id>: that job's details, scrolled into view.
  const linked = useRef(false);
  useEffect(() => {
    if (linked.current || !apps.length) return;
    const wanted = new URLSearchParams(window.location.search).get("job");
    if (!wanted) return;
    linked.current = true;
    window.history.replaceState(null, "", "/home");
    if (!apps.some((app) => app.id === wanted)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- opening from a link, once
    setOpen(wanted);
    requestAnimationFrame(() => document.getElementById(`job-${wanted}`)?.scrollIntoView({ block: "center" }));
  }, [apps]);
  const [filter, setFilter] = useState<"all" | Stage>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortBy>("recent");
  const [site, setSite] = useState("");
  const [period, setPeriod] = useState<When>("all");
  const [notFollowed, setNotFollowed] = useState(false);
  const sites = useMemo(() => sitesIn(apps), [apps]);
  const [problem, setProblem] = useState("");
  const [adding, setAdding] = useState(false);
  // List: every job. Activity: applying as it happens, reloaded every few seconds while it's open.
  const [mode, setMode] = useState<"list" | "activity">("list");
  useEffect(() => {
    if (mode !== "activity") return;
    const id = setInterval(() => void onReload().catch(() => undefined), 5000);
    return () => clearInterval(id);
  }, [mode, onReload]);
  const stats = useMemo(() => applicationStats(apps), [apps]);
  const counts = useMemo(() => {
    const result: Record<string, number> = { all: apps.length };
    for (const app of apps) result[stageOf(app)] = (result[stageOf(app)] ?? 0) + 1;
    return result;
  }, [apps]);
  const shown = useMemo(() => {
    const words = query.trim().toLowerCase();
    const matching = apps
      .filter((app) => filter === "all" || stageOf(app) === filter)
      .filter((app) => !words || `${app.company} ${app.title} ${app.location ?? ""}`.toLowerCase().includes(words));
    return arrange(matching, { sort, site, when: period, notFollowed });
  }, [apps, filter, query, sort, site, period, notFollowed]);
  const narrowed = Boolean(site || period !== "all" || notFollowed);
  const clearFilters = () => {
    setFilter("all");
    setQuery("");
    setSite("");
    setPeriod("all");
    setNotFollowed(false);
  };

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

  const named = shown.filter((app) => !app.companyMissing);
  const unnamed = shown.filter((app) => app.companyMissing);
  const row = (app: App) => {
            const expanded = open === app.id;
            const stage = stageOf(app);
            const people = app.contacts?.length ?? 0;
            const posting = postingLink(app);
            const toggle = () => setOpen(expanded ? null : app.id);
            return (
              <li key={app.id} id={`job-${app.id}`} className="group border-b border-line">
                <div className="flex items-center gap-3 py-3.5 sm:grid sm:grid-cols-[minmax(0,1fr)_7rem_9rem_6.5rem_2rem] sm:gap-4">
                  <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={toggle} aria-expanded={expanded}>
                    <CompanyLogo app={app} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{app.companyMissing ? <span className="text-faint">{app.company || "No company"}</span> : app.company}</span>
                      <span className="flex min-w-0 items-center gap-2 text-sm text-muted">
                        <span className="truncate">{app.title}</span>
                        <span aria-hidden className="hidden text-faint sm:inline">·</span>
                        <span className="hidden sm:inline-flex"><AtsBadge ats={app.ats} /></span>
                      </span>
                      <span className="mt-1 flex items-center gap-2 text-xs text-faint sm:hidden">
                        <AtsBadge ats={app.ats} label />
                        <span aria-hidden>·</span>
                        <span>{when(appliedOn(app))}</span>
                        <span aria-hidden>·</span>
                        <span>{siteFor(app)}</span>
                      </span>
                    </span>
                  </button>
                  <span className="hidden min-w-0 text-sm text-muted tabular-nums sm:block">
                    <span className="block">{when(appliedOn(app))}</span>
                    {posting ? <a href={posting} target="_blank" rel="noreferrer" className="block truncate text-xs text-faint hover:text-white hover:underline" title={`Open the job posting on ${siteFor(app)}`}>{siteFor(app)} ↗</a> : <span className="block truncate text-xs text-faint">{siteFor(app)}</span>}
                  </span>
                  <StageControl app={app} onChange={(next) => void setStage(app, next)} />
                  <button type="button" onClick={toggle} aria-expanded={expanded} className="hidden items-center justify-end gap-1 text-sm text-muted hover:text-white sm:inline-flex">
                    {stage === "in_progress" ? "Details" : `${people} ${people === 1 ? "person" : "people"}`}
                    <span aria-hidden className={`transition-transform ${expanded ? "rotate-90" : ""}`}>→</span>
                  </button>
                  <button type="button" onClick={() => remove(app)} aria-label={`Remove ${app.title} at ${app.company}`} title="Remove" className="-mr-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-faint transition-colors hover:bg-red-500/10 hover:text-red-300 sm:justify-self-end sm:opacity-40 sm:group-hover:opacity-100 sm:focus-visible:opacity-100">
                    <svg aria-hidden viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2.5 4h11M6.5 4V2.75h3V4M4 4l.7 9.25h6.6L12 4M6.75 6.75v4M9.25 6.75v4" /></svg>
                  </button>
                </div>
                {app.companyMissing && <AddCompany app={app} onSaved={onReplace} />}
                {expanded && (
                  <div className="mb-4 space-y-4 rounded-xl border border-line bg-panel p-4">
                    {stage === "in_progress" && <PostedBy app={app} />}
                    {stage === "in_progress" ? (
                      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
                        <p>Not submitted yet. Open the application and press Fill in the Unnepo extension, or mark it applied if you sent it yourself.</p>
                        <button type="button" className={secondary} onClick={() => void act("/applied", "POST", { applicationId: app.id })}>I applied</button>
                      </div>
                    ) : (
                      <ContactsPanel app={app} school={data.school} onStatus={(contactId, status) => void act("/contact", "PATCH", { contactId, status })} onRetry={(website) => void act("/retry-contacts", "POST", { applicationId: app.id, ...(website ? { website } : {}) })} onEmail={(contactId, edit) => act("/contact-email", "POST", { applicationId: app.id, contactId, ...edit })} />
                    )}
                    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line pt-3 text-xs text-faint">
                      <span className="min-w-0">
                        {app.status === "submitted" && app.confirmation
                          ? app.confirmation.confidence === "likely" ? "Looks submitted: the page said so." : "Confirmed: the site accepted the submission."
                          : app.status === "applied_manual" ? "Marked applied by you." : app.statusMessage}
                      </span>
                      <span className="flex flex-wrap gap-4">
                        {app.confirmation?.receiptPath && <a className="hover:text-white" href={`/api/apply/receipt?applicationId=${encodeURIComponent(app.id)}`} target="_blank" rel="noreferrer">Receipt ↗</a>}
                        {posting && <a className="hover:text-white" href={posting} target="_blank" rel="noreferrer">Job posting ↗</a>}
                        {app.applicationUrl && app.applicationUrl !== posting && <a className="hover:text-white" href={app.applicationUrl} target="_blank" rel="noreferrer">Application ↗</a>}
                        <button type="button" className="hover:text-red-300" onClick={() => remove(app)}>Remove</button>
                      </span>
                    </div>
                  </div>
                )}
              </li>
            );
  };

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
          <FollowUpFacts
            applied={apps.filter((app) => app.status === "submitted" || app.status === "applied_manual")}
            school={data.school}
            onOpen={(appId) => {
              setFilter("all");
              setQuery("");
              setOpen(appId);
              requestAnimationFrame(() => document.getElementById(`job-${appId}`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
            }}
          />
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex flex-wrap items-center gap-2">
          <span className="inline-flex rounded-xl border border-line p-0.5" role="group" aria-label="View">
            {(["list", "activity"] as const).map((item) => (
              <button key={item} type="button" aria-pressed={mode === item} onClick={() => setMode(item)} className={`rounded-lg px-3 py-1 text-sm ${mode === item ? "bg-white text-black" : "text-muted hover:text-white"}`}>{item === "list" ? "List" : "Activity"}{item === "activity" && (data.maybe?.length ?? 0) > 0 ? ` · ${data.maybe!.length}` : ""}</button>
            ))}
          </span>
          <button type="button" className={secondary} onClick={() => setAdding((on) => !on)} aria-expanded={adding}>+ Add job</button>
        </span>
        {apps.length > 0 && (
          <label className="relative w-full sm:w-64">
            <span className="sr-only">Search applications</span>
            <svg aria-hidden viewBox="0 0 16 16" className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" /></svg>
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search company or role" className="w-full rounded-xl border border-line bg-card py-2 pl-9 pr-3 text-sm text-ink outline-none placeholder:text-faint focus:border-zinc-500" />
          </label>
        )}
      </div>

      {mode === "activity" ? (
        <ActivityView
          apps={apps}
          maybe={data.maybe ?? []}
          session={data.session ?? null}
          onMaybe={(id, applied) => act("/maybe", "POST", { id, applied })}
          onSession={(start) => act("/session", "POST", { start })}
          onCompany={(appId, company) => act("/company", "PATCH", { applicationId: appId, company })}
          onOpen={(appId) => {
            setMode("list");
            setFilter("all");
            setQuery("");
            setOpen(appId);
            requestAnimationFrame(() => document.getElementById(`job-${appId}`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
          }}
        />
      ) : (
        <>
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
      {apps.length > 1 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <label className="flex items-center gap-2 text-muted">Sort
            <select value={sort} onChange={(event) => setSort(event.target.value as SortBy)} className="rounded-lg border border-line bg-card px-2 py-1.5 text-ink">
              {SORTS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-muted">Applied
            <select value={period} onChange={(event) => setPeriod(event.target.value as When)} className="rounded-lg border border-line bg-card px-2 py-1.5 text-ink">
              {WHENS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
          {sites.length > 1 && (
            <label className="flex items-center gap-2 text-muted">Site
              <select value={site} onChange={(event) => setSite(event.target.value)} className="rounded-lg border border-line bg-card px-2 py-1.5 text-ink">
                <option value="">All sites</option>
                {sites.map((item) => <option key={item.site} value={item.site}>{item.site} ({item.count})</option>)}
              </select>
            </label>
          )}
          <label className="flex items-center gap-2 text-muted">
            <input type="checkbox" checked={notFollowed} onChange={(event) => setNotFollowed(event.target.checked)} className="h-4 w-4 accent-white" />
            Not followed up yet
          </label>
          <span className="text-faint tabular-nums">{shown.length} shown</span>
          {(narrowed || filter !== "all" || query) && <button type="button" onClick={clearFilters} className="text-ink underline-offset-4 hover:underline">Clear filters</button>}
        </div>
      )}

      <FollowUpsDue
        apps={apps}
        onOpen={(appId) => {
          setFilter("all");
          setQuery("");
          setOpen(appId);
          requestAnimationFrame(() => document.getElementById(`job-${appId}`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
        }}
        onWrite={(appId, contactId) => act("/contact-email", "POST", { applicationId: appId, contactId, followUp: true })}
        onSent={(contactId) => act("/contact", "PATCH", { contactId, status: "emailed", followedUp: true })}
      />
      {adding && <AddJobForm onDone={async (added) => { setAdding(false); if (added) await onReload(); }} />}
      {problem && <p role="alert" className="text-sm text-red-300">{problem}</p>}

      {apps.length === 0 ? (
        <div className={`${card} flex flex-col items-start gap-3`}>
          <p className="font-medium">No applications yet</p>
          <p className="max-w-xl text-sm text-muted">Open a job application in Chrome and press Fill in the Unnepo extension. Every job you submit shows up here, with people at the company to email.</p>
          <a href="/extension/connect" className={primary}>Connect the extension</a>
        </div>
      ) : shown.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">Nothing matches. <button type="button" onClick={clearFilters} className="text-ink underline underline-offset-4">Clear filters</button></p>
      ) : (
        <>
          {named.length > 0 && <ul className="border-t border-line">{named.map(row)}</ul>}
          {unnamed.length > 0 && (
            <section aria-labelledby="no-company" className="flex flex-col gap-2 pt-2">
              <div>
                <h2 id="no-company" className="text-base font-semibold">Missing the company <span className="text-sm font-normal text-faint tabular-nums">{unnamed.length}</span></h2>
                <p className="text-sm text-muted">These were saved without the company&apos;s name. Add it to find people there and keep your stats right.</p>
              </div>
              <ul className="border-t border-line">{unnamed.map(row)}</ul>
            </section>
          )}
        </>
      )}
        </>
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

/** The person the posting names, shown as soon as the job is saved, with the posting's own label for them. */
function PostedBy({ app }: { app: App }) {
  const named = app.postedRecruiter;
  if (!named || (app.contacts ?? []).some((contact) => contact.name.toLowerCase() === named.name.toLowerCase())) return null;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-panel p-3">
      <Avatar name={named.name} photoUrl={null} />
      <div className="min-w-0 text-sm">
        <p className="truncate font-medium">{named.name} <span className="ml-1 rounded-full border border-line px-2 py-0.5 align-middle text-[10px] text-muted">{named.title || "Named on posting"}</span></p>
        <p className="truncate text-muted">{named.linkedinUrl ? "Hiring team on LinkedIn" : "Named on the job posting"}{named.email ? ` · ${named.email}` : ""}</p>
      </div>
      {named.linkedinUrl && (
        <a className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs text-ink hover:bg-white/5" href={named.linkedinUrl} target="_blank" rel="noreferrer" aria-label={`${named.name} on LinkedIn`}>
          <span aria-hidden className="flex h-4 w-4 items-center justify-center rounded-[3px] bg-[#0A66C2] text-[9px] font-bold text-white">in</span>
          LinkedIn
        </a>
      )}
    </div>
  );
}

/** People emailed five business days ago or more with no reply yet: write the follow-up, or say it's sent. */
function FollowUpsDue({ apps, onOpen, onWrite, onSent }: { apps: App[]; onOpen: (appId: string) => void; onWrite: (appId: string, contactId: string) => Promise<void>; onSent: (contactId: string) => Promise<void> }) {
  const [busy, setBusy] = useState("");
  const due = followUpsDue(apps);
  if (!due.length) return null;
  return (
    <section aria-labelledby="follow-ups" className="rounded-xl border border-[#3D8BFF]/50 bg-panel p-3">
      <h2 id="follow-ups" className="text-sm font-semibold">Follow-ups due <span className="font-normal text-faint tabular-nums">{due.length}</span></h2>
      <ul className="mt-2 flex flex-col gap-2">
        {due.slice(0, 5).map((item) => (
          <li key={item.contactId} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="min-w-0 flex-1"><span className="font-medium">{item.name}</span> <span className="text-muted">at {item.company} · emailed {item.days} business days ago</span></span>
            <button type="button" className="text-sm font-medium text-ink underline-offset-4 hover:underline disabled:opacity-50" disabled={busy === item.contactId} onClick={async () => { setBusy(item.contactId); await onWrite(item.applicationId, item.contactId); setBusy(""); onOpen(item.applicationId); }}>{busy === item.contactId ? "Writing…" : "Write follow-up"}</button>
            <button type="button" className="text-xs text-muted hover:text-white" onClick={() => void onSent(item.contactId)}>I sent it</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A job saved without its company: the student types it in, and the job moves up to the main list. */
function AddCompany({ app, onSaved }: { app: App; onSaved: (app: App) => void }) {
  const [company, setCompany] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  return (
    <form
      className="mb-3 flex flex-wrap items-center gap-2 text-sm"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setProblem("");
        try {
          const result = await call<{ application: App }>("/company", "PATCH", { applicationId: app.id, company });
          onSaved({ ...app, ...result.application, contacts: app.contacts });
        } catch (reason) {
          setProblem(reason instanceof Error ? reason.message : "Couldn't save it.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="sr-only" htmlFor={`company-${app.id}`}>Company for {app.title}</label>
      <input id={`company-${app.id}`} value={company} onChange={(event) => setCompany(event.target.value)} placeholder="Company name, like MealPal" maxLength={200} className="min-w-0 flex-1 rounded-lg border border-line bg-card px-3 py-2 text-sm sm:max-w-xs" />
      <button type="submit" className={secondary} disabled={busy || company.trim().length < 2}>{busy ? "Saving…" : "Add company"}</button>
      {problem && <span role="alert" className="text-xs text-red-300">{problem}</span>}
    </form>
  );
}

/** "+ Add job": a job applied to somewhere Unnepo didn't see, or one to keep track of. Title and company are enough. */
function AddJobForm({ onDone }: { onDone: (added: boolean) => void | Promise<void> }) {
  const [job, setJob] = useState({ title: "", company: "", url: "", stage: "applied", appliedOn: new Date().toISOString().slice(0, 10), description: "" });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const set = (patch: Partial<typeof job>) => setJob((before) => ({ ...before, ...patch }));
  const input = "w-full rounded-lg border border-line bg-card px-3 py-2 text-sm";
  const label = "mb-1 block text-xs font-medium text-muted";
  return (
    <form
      className={`${card} grid gap-3 sm:grid-cols-2`}
      aria-label="Add a job"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setProblem("");
        try {
          await call("/add-job", "POST", job);
          await onDone(true);
        } catch (reason) {
          setProblem(reason instanceof Error ? reason.message : "Couldn't add it.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <div><label className={label} htmlFor="add-title">Job title</label><input id="add-title" className={input} value={job.title} onChange={(event) => set({ title: event.target.value })} placeholder="Growth Marketing Intern" maxLength={200} required /></div>
      <div><label className={label} htmlFor="add-company">Company</label><input id="add-company" className={input} value={job.company} onChange={(event) => set({ company: event.target.value })} placeholder="MealPal" maxLength={200} required /></div>
      <div><label className={label} htmlFor="add-url">Job link (optional)</label><input id="add-url" type="url" className={input} value={job.url} onChange={(event) => set({ url: event.target.value })} placeholder="https://…" /></div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label} htmlFor="add-stage">Status</label>
          <select id="add-stage" className={input} value={job.stage} onChange={(event) => set({ stage: event.target.value })}>
            <option value="applied">Applied</option><option value="in_progress">Not applied yet</option><option value="interviewing">Interviewing</option><option value="offer">Offer</option><option value="rejected">Rejected</option>
          </select>
        </div>
        <div><label className={label} htmlFor="add-date">Applied on</label><input id="add-date" type="date" className={input} value={job.appliedOn} max={new Date().toISOString().slice(0, 10)} onChange={(event) => set({ appliedOn: event.target.value })} disabled={job.stage === "in_progress"} /></div>
      </div>
      <div className="sm:col-span-2"><label className={label} htmlFor="add-description">Job description (optional)</label><textarea id="add-description" rows={3} className={input} value={job.description} onChange={(event) => set({ description: event.target.value })} placeholder="Paste it to keep it with the job, for cover letters and finding people" maxLength={8000} /></div>
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
        <button type="submit" className={primary} disabled={busy || job.title.trim().length < 2 || job.company.trim().length < 2}>{busy ? "Adding…" : "Add to tracker"}</button>
        <button type="button" className={secondary} onClick={() => void onDone(false)}>Cancel</button>
        {problem && <span role="alert" className="text-sm text-red-300">{problem}</span>}
      </div>
    </form>
  );
}

/** Each step of the last people search: the websites tried, what every search found, and any error. */
function HowWeSearched({ app }: { app: App }) {
  const search = app.fillReport?.peopleSearch;
  if (!search?.steps.length) return null;
  return (
    <details className="text-xs text-faint">
      <summary className="cursor-pointer select-none hover:text-muted">How we searched</summary>
      <p className="mt-1">Websites tried: {search.domains.length ? search.domains.join(", ") : "none found"}{search.domain ? `. People found on ${search.domain}.` : "."}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        {search.steps.map((step, index) => (
          <li key={index}>{step.step}{step.domain ? ` (${step.domain})` : ""}: {step.step === "Full names" ? `${step.found} revealed` : `${step.found} found`}{step.error ? `. Error: ${step.error}` : ""}</li>
        ))}
      </ul>
    </details>
  );
}

/** Links that open the email ready to send in Gmail, Outlook on the web, or the computer's own mail app. */
function composeLinks(to: string, subject: string, body: string) {
  const q = (pairs: Record<string, string>) => Object.entries(pairs).map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&");
  return [
    { label: "Gmail", url: `https://mail.google.com/mail/?${q({ view: "cm", fs: "1", to, su: subject, body })}` },
    { label: "Outlook", url: `https://outlook.office.com/mail/deeplink/compose?${q({ to, subject, body })}` },
    { label: "Mail app", url: `mailto:${encodeURIComponent(to).replace(/%40/g, "@")}?${q({ subject, body })}` },
  ];
}

type EmailEdit = { subject?: string; body?: string };

/** One person's email: nothing until the student presses Write email, then editable, with links to send it. */
function EmailBox({ contact, onEmail }: { contact: NonNullable<App["contacts"]>[number]; onEmail: (contactId: string, edit?: EmailEdit) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [subject, setSubject] = useState(contact.emailSubject ?? "");
  const [body, setBody] = useState(contact.emailBody ?? "");
  const [copied, setCopied] = useState(false);
  const run = async (edit?: EmailEdit) => {
    setBusy(true);
    await onEmail(contact.id, edit);
    setBusy(false);
  };
  if (!contact.emailBody) {
    return <button type="button" className={`${secondary} mt-3`} disabled={busy} onClick={() => void run()}>{busy ? "Writing…" : "✦ Write email"}</button>;
  }
  const changed = subject !== (contact.emailSubject ?? "") || body !== contact.emailBody;
  return (
    <div className="mt-3 space-y-2">
      <label className="sr-only" htmlFor={`subject-${contact.id}`}>Subject</label>
      <input id={`subject-${contact.id}`} value={subject} onChange={(event) => setSubject(event.target.value)} className="w-full rounded-lg border border-line bg-card px-3 py-2 text-sm" />
      <label className="sr-only" htmlFor={`body-${contact.id}`}>Email to {contact.name}</label>
      <textarea id={`body-${contact.id}`} rows={8} value={body} onChange={(event) => setBody(event.target.value)} className="w-full rounded-lg border border-line bg-card p-3 text-sm leading-relaxed text-zinc-300" />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {changed && <button type="button" className={primary} disabled={busy || !body.trim()} onClick={() => void run({ subject, body })}>{busy ? "Saving…" : "Save edits"}</button>}
        {composeLinks(contact.email ?? "", subject, body).map((link) => (
          <a key={link.label} className={secondary} href={link.url} target={link.url.startsWith("mailto:") ? undefined : "_blank"} rel="noreferrer">Open in {link.label}</a>
        ))}
        <button type="button" className={secondary} onClick={() => void navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}>{copied ? "Copied ✓" : "Copy"}</button>
        <button type="button" className="text-xs text-muted hover:text-ink" disabled={busy} onClick={() => void run()}>Rewrite</button>
      </div>
    </div>
  );
}

function ContactsPanel({ app, school, onStatus, onRetry, onEmail }: { app: App; school: string; onStatus: (contactId: string, status: OutreachState) => void; onRetry: (website?: string) => void; onEmail: (contactId: string, edit?: EmailEdit) => Promise<void> }) {
  const contacts = app.contacts ?? [];
  const [copied, setCopied] = useState("");
  const [website, setWebsite] = useState("");
  // No website means Apollo had nowhere to look, so the student can give one.
  const needsSite = !app.companyDomain && contacts.length === 0 && (app.contactsStatus === "done" || app.contactsStatus === "failed");
  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      setCopied("");
    }
  }
  // Nobody is looked up until the student asks.
  if (app.contactsStatus === "idle") {
    return (
      <div className="space-y-3">
        <PostedBy app={app} />
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
          <button type="button" className={primary} onClick={() => onRetry()}>Find relevant people</button>
          <p>Up to 5 people at {app.company}: from your school, recruiters, and the team, with their emails and links.</p>
        </div>
      </div>
    );
  }
  if (app.contactsStatus === "finding") return <PeopleSearching message={app.contactsMessage || `Searching for relevant people at ${app.company}…`} school={school} />;
  const links = app.fillReport?.peopleLinks ?? {};
  return (
    <div className="space-y-3">
      <PostedBy app={app} />
      {app.contactsMessage && <p className="text-xs text-faint">{app.contactsMessage}</p>}
      <HowWeSearched app={app} />
      {needsSite ? (
        <form className="flex flex-wrap items-center gap-2 text-sm" onSubmit={(event) => { event.preventDefault(); onRetry(website.trim()); }}>
          <label className="sr-only" htmlFor={`site-${app.id}`}>{app.company}&apos;s website</label>
          <input id={`site-${app.id}`} value={website} onChange={(event) => setWebsite(event.target.value)} placeholder={`${app.company}'s website, like acme.com`} className="min-w-0 flex-1 rounded-lg border border-line bg-card px-3 py-2 text-sm" />
          <button type="submit" className={secondary} disabled={!website.trim()}>Search again</button>
        </form>
      ) : (
        <>
          {app.contactsStatus === "failed" && <button type="button" className={secondary} onClick={() => onRetry()}>Try again</button>}
          {contacts.length === 0 && app.contactsStatus === "done" && (
            <div className="flex flex-wrap items-center gap-3 text-sm text-muted"><p>No one found yet.</p><button type="button" className={secondary} onClick={() => onRetry()}>Search again</button></div>
          )}
        </>
      )}
      {contacts.map((contact) => {
        // The one to email first: the most relevant person with an email (the list is ranked).
        const first = contact.id === (contacts.find((item) => item.email) ?? contacts[0])?.id && contacts.length > 1;
        return (
          <article key={contact.id} className={`rounded-xl border bg-panel p-4 ${first ? "border-[#3D8BFF]" : "border-line"}`}>
            {first && <p className="mb-2 text-xs font-semibold text-[#3D8BFF]">★ Start here: {contact.email ? "the most relevant person with an email." : "the most relevant person."}</p>}
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
              ) : <span className="text-muted">No email yet</span>}
              {contact.emailSource && (
                <span className={`text-[11px] ${contact.emailSource === "likely" ? "rounded-full border border-[#F5A524]/50 px-2 py-0.5 text-[#F5A524]" : "text-faint"}`}>
                  {EMAIL_SOURCE[contact.emailSource]}
                </span>
              )}
              {contact.linkedinUrl && (
                <a className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs text-ink hover:bg-white/5" href={contact.linkedinUrl} target="_blank" rel="noreferrer" aria-label={`${contact.name} on LinkedIn`}>
                  <span aria-hidden className="flex h-4 w-4 items-center justify-center rounded-[3px] bg-[#0A66C2] text-[9px] font-bold text-white">in</span>
                  LinkedIn
                </a>
              )}
              {(links[contact.name.toLowerCase()] ?? []).filter((link) => link.label !== "LinkedIn").map((link) => (
                <a key={link.url} className="inline-flex items-center rounded-lg border border-line px-2.5 py-1 text-xs text-ink hover:bg-white/5" href={link.url} target="_blank" rel="noreferrer" aria-label={`${contact.name} on ${link.label}`}>{link.label}</a>
              ))}
            </div>
            {/* Keyed on the saved email, so a newly written one replaces what's in the boxes. */}
            <EmailBox key={`${contact.id}:${contact.emailSubject ?? ""}:${contact.emailBody ?? ""}`} contact={contact} onEmail={onEmail} />
          </article>
        );
      })}
    </div>
  );
}
