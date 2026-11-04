"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HomeHero, HomeTiles, MoreStats, NextSpider, PerDayCard } from "@/components/unnepo/home";
import { SessionBar, type Maybe, type Session } from "@/components/unnepo/activity";
import { extensionHere, readLinksInBrowser } from "@/lib/extension-bridge";
import { followUpsDue } from "@/lib/apply/follow-ups";
import { PeopleSearching } from "@/components/unnepo/people-searching";
import { Spiders } from "@/components/unnepo/stats";
import { stageOf, appliedOn, applicationStats, type Stage } from "@/lib/apply/stats";
import { HOW_LABEL } from "@/lib/apply/activity-stats";
import { SORTS, WHENS, arrange, postingLink, siteFor, sitesIn, type SortBy, type When } from "@/lib/apply/applied-list";
import type { ApplicationContact, ApplicationProfile, JobApplication, OutreachState } from "@/lib/apply/types";

const btn = "inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const primary = `${btn} bg-white text-black hover:bg-zinc-200`;
const secondary = `${btn} border border-line bg-transparent text-ink hover:bg-white/5`;
const card = "rounded-2xl border border-line bg-panel p-5 sm:p-6";

export type App = JobApplication & { missing: string[]; contacts?: ApplicationContact[]; companyMissing?: boolean; titleMissing?: boolean };
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
  no_response: { label: "No response", color: "#6B6B74" },
  assessment: { label: "Assessment", color: "#A78BFA" },
  interviewing: { label: "Interviewing", color: "#3D8BFF" },
  offer: { label: "Offer", color: "#4ADE80" },
  rejected: { label: "Rejected", color: "#8B8B94" },
};

/** An error from Unnepo's API, with its code ("in_browser": a job board the extension has to read). */
class CallError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
  }
}

async function call<T>(path: string, method: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/apply${path}`, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new CallError(payload.error || `Something went wrong (${response.status}).`, payload.code ?? "");
  return payload as T;
}

/**
 * Fills saved jobs in from their links: the server reads company sites; job boards go to the extension, which
 * reads them in this browser. What's left over says why.
 */
async function fillJobsFromLinks(apps: App[]) {
  const inBrowser: Array<{ id: string; url: string }> = [];
  let filled = 0;
  let failed = 0;
  for (const app of apps) {
    const url = postingLink(app) || app.applicationUrl || "";
    if (!url) { failed += 1; continue; }
    try {
      const result = await call<{ changed: string[] }>("/fill-from-link", "POST", { applicationId: app.id });
      if (result.changed.length) filled += 1;
    } catch (reason) {
      if (reason instanceof CallError && reason.code === "in_browser") inBrowser.push({ id: app.id, url });
      else failed += 1;
    }
  }
  let noExtension = 0;
  if (inBrowser.length) {
    if (await extensionHere()) {
      for (const result of await readLinksInBrowser(inBrowser)) {
        if (result.ok && result.changed?.length) filled += 1;
        else if (!result.ok) failed += 1;
      }
    } else noExtension = inBrowser.length;
  }
  return { filled, failed, noExtension };
}

function when(date: Date) {
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

/** The Home tab: the day so far, the totals, and the list of jobs, from one data load. */
export function ApplyArea({ refreshKey = 0, userName, onSetup, onSpiders }: { refreshKey?: number; userName: string; onSetup: () => void; onSpiders: () => void }) {
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

  return (
    <AppliedPage
      data={data}
      userName={userName}
      onSetup={onSetup}
      onSpiders={onSpiders}
      onGoal={async (weeklyGoal) => {
        const result = await call<{ profile: PublicProfile }>("/profile", "PUT", { weeklyGoal });
        setData((previous) => (previous ? { ...previous, profile: result.profile } : previous));
      }}
      onReload={load}
      onReplace={(app) => setData({ ...data, applications: data.applications.map((item) => (item.id === app.id ? { ...item, ...app, contacts: item.contacts } : item)) })}
      onApps={(change) => setData((previous) => (previous ? { ...previous, applications: change(previous.applications) } : previous))}
    />
  );
}

/** Settings: the spiders to wear. Loads its own data. */
export function SpiderSettings() {
  const [data, setData] = useState<ApplyData | null>(null);
  useEffect(() => {
    call<ApplyData>("", "GET").then(setData, () => undefined);
  }, []);
  if (!data) return null;
  return (
    <Spiders
      applied={applicationStats(data.applications).applied}
      school={data.school}
      picked={data.profile.spiderSkin ?? null}
      onPick={async (spiderSkin) => {
        const result = await call<{ profile: PublicProfile }>("/profile", "PUT", { spiderSkin });
        setData({ ...data, profile: result.profile });
      }}
    />
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
        {/* "No response" is worked out (28 days with no email), so it shows only while it's true. */}
        {([...(stage === "no_response" ? ["no_response" as const] : []), "submitted", "assessment", "interviewing", "offer", "rejected"] as const).map((value) => <option key={value} value={value} className="bg-card text-ink">{STAGE[value].label}</option>)}
      </select>
      <span aria-hidden className="pointer-events-none absolute right-2 text-[10px] text-faint">▾</span>
    </span>
  );
}

const FILTERS: Array<["all" | Stage, string]> = [["all", "All"], ["submitted", "Submitted"], ["assessment", "Assessment"], ["interviewing", "Interviewing"], ["offer", "Offer"], ["rejected", "Rejected"], ["no_response", "No response"], ["in_progress", "In progress"]];

const UNDO_MS = 5000;
const deleteNow = (applicationId: string, keepalive = false) =>
  fetch("/api/apply/applications", { method: "DELETE", keepalive, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ applicationId }) });

function AppliedPage({ data, userName, onSetup, onSpiders, onGoal, onReload, onReplace, onApps }: { data: ApplyData; userName: string; onSetup: () => void; onSpiders: () => void; onGoal: (goal: number) => Promise<void>; onReload: () => Promise<void>; onReplace: (app: App) => void; onApps: (change: (apps: App[]) => App[]) => void }) {
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
  const [reading, setReading] = useState<string | null>(null);
  const [readNote, setReadNote] = useState({ key: "", text: "" });
  // Jobs saved by the extension show up without reloading: the list is read again every few seconds while a session runs.
  useEffect(() => {
    if (!data.session?.active) return;
    const id = setInterval(() => void onReload().catch(() => undefined), 8000);
    return () => clearInterval(id);
  }, [data.session?.active, onReload]);
  async function readLinks(list: App[], key: string) {
    setReading(key);
    setReadNote({ key, text: "" });
    const { filled, failed, noExtension } = await fillJobsFromLinks(list);
    await onReload().catch(() => undefined);
    setReading(null);
    setReadNote({ key, text: [
      `Filled in ${filled} of ${list.length} from ${list.length === 1 ? "its link" : "their links"}.`,
      failed ? `${failed} couldn't be read: type the company for ${failed === 1 ? "it" : "those"}.` : "",
      noExtension ? `${noExtension} ${noExtension === 1 ? "is a job board link" : "are job board links"}, which the Unnepo extension reads in Chrome. Open this page in Chrome with the extension connected.` : "",
    ].filter(Boolean).join(" ") });
  }
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
    if (stage === "no_response") return;
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

  const named = shown.filter((app) => !app.companyMissing && !app.titleMissing);
  const unnamed = shown.filter((app) => app.companyMissing || app.titleMissing);
  const stageCell = (app: App) => <StageControl app={app} onChange={(next) => void setStage(app, next)} />;
  const row = (app: App) => {
    const expanded = open === app.id;
    const stage = stageOf(app);
    const posting = postingLink(app);
    const people = app.contacts?.length ?? 0;
    // Applied, nobody looked up yet: one press finds people to email there.
    const canFind = stage !== "in_progress" && !app.companyMissing && app.contactsStatus === "idle" && !people;
    const finding = app.contactsStatus === "finding" || app.contactsStatus === "writing";
    const toggle = () => setOpen(expanded ? null : app.id);
    const role = app.titleMissing ? <span className="text-faint">No job title</span> : app.title;
    return (
      <Fragment key={app.id}>
        <tr id={`job-${app.id}`} className="border-t border-[#17171B]">
          <td className="py-3.5 pr-2 align-middle font-medium">
            <button type="button" onClick={toggle} aria-expanded={expanded} className="flex max-w-full items-start gap-1.5 text-left hover:text-white">
              <span aria-hidden className={`mt-[3px] text-[10px] text-[#8B8B94] transition-transform ${expanded ? "rotate-90" : ""}`}>▶</span>
              <span className="min-w-0 break-words">{app.companyMissing ? <span className="text-faint">{app.company || "No company"}</span> : app.company}</span>
            </button>
            <span className="mt-0.5 block pl-4 text-[13px] font-normal text-[#B4B4BC] sm:hidden">{role}</span>
            <span className="mt-0.5 block pl-4 font-mono text-xs font-normal text-[#8B8B94] sm:hidden">{when(appliedOn(app))}</span>
          </td>
          <td className="hidden px-2 py-3.5 align-middle text-[#B4B4BC] sm:table-cell">
            {role}
            <span className="text-[#8B8B94]"> · {posting ? <a href={posting} target="_blank" rel="noreferrer" className="hover:text-white hover:underline" title={`Open the job posting on ${siteFor(app)}`}>{siteFor(app)} ↗</a> : siteFor(app)}</span>
            {app.fillReport?.fromEmail && <span className="ml-2 inline-block align-middle"><EmailBadge mark={app.fillReport.fromEmail} /></span>}
          </td>
          <td className="hidden whitespace-nowrap px-2 py-3.5 align-middle font-mono text-xs text-[#8B8B94] sm:table-cell">{when(appliedOn(app))}</td>
          <td className="px-1 py-3.5 align-middle sm:px-2">{stageCell(app)}</td>
          <td className="py-2 pl-1 text-right align-middle sm:pl-2">
            {people > 0 ? (
              <button type="button" onClick={toggle} aria-expanded={expanded} className="whitespace-nowrap text-[13px] text-[#F7F7F8] hover:underline">{people} {people === 1 ? "person" : "people"} →</button>
            ) : finding ? (
              <span className="whitespace-nowrap text-xs text-[#8B8B94]">Finding…</span>
            ) : canFind ? (
              <button type="button" className="h-8 whitespace-nowrap rounded-lg border border-[#26262C] px-3 text-xs font-medium text-[#F7F7F8] hover:bg-white/5" onClick={() => { setOpen(app.id); void act("/retry-contacts", "POST", { applicationId: app.id }); }}>Find people</button>
            ) : <span className="text-xs text-[#8B8B94]">—</span>}
          </td>
        </tr>
        {(app.companyMissing || app.titleMissing) && <tr><td colSpan={5} className="pb-2"><AddCompany app={app} onSaved={onReplace} /></td></tr>}
        {expanded && (
          <tr>
            <td colSpan={5} className="pb-4">
              <div className="space-y-4 rounded-xl border border-line bg-panel p-4">
                <JobInfo app={app} reading={reading === app.id} disabled={reading !== null} note={readNote.key === app.id && reading === null ? readNote.text : ""} onRead={() => void readLinks([app], app.id)} onSaved={onReplace} />
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
            </td>
          </tr>
        )}
      </Fragment>
    );
  };
  const table = (list: App[], caption: string) => (
    <div className="border-t border-[#1F1F24]">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="text-left font-mono text-[11px] uppercase tracking-[1.2px] text-[#8B8B94]">
            <th scope="col" className="py-3 pr-2 font-medium">Company</th>
            <th scope="col" className="hidden px-2 py-3 font-medium sm:table-cell">Role</th>
            <th scope="col" className="hidden px-2 py-3 font-medium sm:table-cell">Applied</th>
            <th scope="col" className="px-1 py-3 font-medium sm:px-2">Stage</th>
            <th scope="col" className="py-3 pl-1 text-right font-medium sm:pl-2">People</th>
          </tr>
        </thead>
        <tbody>{list.map(row)}</tbody>
      </table>
    </div>
  );
  const openJob = (appId: string) => {
    setFilter("all");
    setQuery("");
    setOpen(appId);
    requestAnimationFrame(() => document.getElementById(`job-${appId}`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
  };

  return (
    <div className="flex flex-col gap-8">
      <HomeHero name={userName} apps={apps} weeklyGoal={data.profile.weeklyGoal ?? null} onGoal={onGoal} school={data.school} spiderSkin={data.profile.spiderSkin ?? null} onSetup={onSetup} />
      <HomeTiles apps={apps} />
      <div className="flex flex-wrap items-start gap-8">
        <section aria-labelledby="applied-title" className="flex min-w-0 flex-[999_1_640px] flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="applied-title" className="m-0 text-[22px] font-bold tracking-[-0.5px]">Applied <span className="text-sm font-medium tracking-normal text-[#8B8B94] tabular-nums">{stats.applied}</span></h2>
            {apps.length > 0 && (
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by stage">
                {FILTERS.filter(([id]) => id === "all" || counts[id]).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={filter === id}
                    onClick={() => setFilter(id)}
                    className={`h-8 rounded-full border px-3 text-xs font-medium ${filter === id ? "border-[#F7F7F8] bg-[#F7F7F8] text-[#070708]" : "border-[#26262C] text-[#9A9AA3] hover:text-white"}`}
                  >
                    {label} <span className={`tabular-nums ${filter === id ? "text-black/60" : "text-[#8B8B94]"}`}>{counts[id] ?? 0}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex flex-wrap items-center gap-2">
              <button type="button" className={secondary} onClick={() => setAdding((on) => !on)} aria-expanded={adding}>+ Add job</button>
              <SessionBar apps={apps} session={data.session ?? null} onSession={(start) => act("/session", "POST", { start })} />
            </span>
            {apps.length > 0 && (
              <label className="relative w-full sm:w-64">
                <span className="sr-only">Search applications</span>
                <svg aria-hidden viewBox="0 0 16 16" className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" /></svg>
                <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search company or role" className="w-full rounded-xl border border-line bg-card py-2 pl-9 pr-3 text-sm text-ink outline-none placeholder:text-faint focus:border-zinc-500" />
              </label>
            )}
          </div>
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
              {named.length > 0 && table(named, "Your applications")}
              {unnamed.length > 0 && (
                <section aria-labelledby="no-company" className="flex flex-col gap-2 pt-2">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 id="no-company" className="text-base font-semibold">Missing the company or job title <span className="text-sm font-normal text-faint tabular-nums">{unnamed.length}</span></h2>
                      <p className="text-sm text-muted">These were saved without the company&apos;s name or the job&apos;s title. Unnepo can read each job&apos;s link for them, or type them in.</p>
                    </div>
                    <button type="button" className={secondary} disabled={reading !== null} onClick={() => void readLinks(unnamed, "unnamed")}>{reading === "unnamed" ? "Reading their links…" : "Fill in from their links"}</button>
                  </div>
                  {readNote.key === "unnamed" && readNote.text && reading === null && <p role="status" className="text-sm text-muted">{readNote.text}</p>}
                  {table(unnamed, "Applications missing the company or job title")}
                </section>
              )}
            </>
          )}
        </section>

        <aside className="flex min-w-0 flex-[1_1_320px] flex-col gap-6">
          <PerDayCard apps={apps} />
          <FollowUpsDue
            apps={apps}
            onOpen={openJob}
            onWrite={(appId, contactId) => act("/contact-email", "POST", { applicationId: appId, contactId, followUp: true })}
            onSent={(contactId) => act("/contact", "PATCH", { contactId, status: "emailed", followedUp: true })}
          />
          <NextSpider apps={apps} school={data.school} onSpiders={onSpiders} />
        </aside>
      </div>
      <MoreStats apps={apps} />

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
  const initials = (name: string) => name.split(/\s+/).map((part) => part[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
  return (
    <section aria-labelledby="follow-ups" className="flex flex-col gap-3 rounded-2xl border border-[#1F1F24] p-5">
      <h2 id="follow-ups" className="m-0 text-sm font-semibold">Follow-ups due <span className="font-medium text-[#8B8B94] tabular-nums">{due.length}</span></h2>
      {due.length === 0 && <p className="m-0 text-[13px] text-[#8B8B94]">Nothing due. People you email show up here after five business days with no reply.</p>}
      {due.slice(0, 5).map((item) => (
        <div key={item.contactId} className="flex flex-wrap items-center gap-3">
          <span aria-hidden className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-[#16161A] text-[11px] font-semibold">{initials(item.name)}</span>
          <span className="flex min-w-0 flex-1 basis-32 flex-col gap-px">
            <span className="text-[13px] font-medium">{item.name}</span>
            <span className="text-xs text-[#8B8B94]">{item.company} · emailed {item.days} business days ago</span>
          </span>
          <span className="flex items-center gap-2">
            <button type="button" className="h-8 rounded-lg bg-[#F7F7F8] px-3 text-xs font-semibold text-[#070708] hover:bg-white disabled:opacity-50" disabled={busy === item.contactId} onClick={async () => { setBusy(item.contactId); await onWrite(item.applicationId, item.contactId); setBusy(""); onOpen(item.applicationId); }}>{busy === item.contactId ? "Writing…" : "Draft"}</button>
            <button type="button" className="text-xs text-[#8B8B94] hover:text-white" onClick={() => void onSent(item.contactId)}>I sent it</button>
          </span>
        </div>
      ))}
    </section>
  );
}

/** A job saved without its company: the student types it in, and the job moves up to the main list. */
function AddCompany({ app, onSaved }: { app: App; onSaved: (app: App) => void }) {
  const [company, setCompany] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const needsCompany = Boolean(app.companyMissing);
  const needsTitle = Boolean(app.titleMissing);
  const ready = (!needsCompany || company.trim().length >= 2) && (!needsTitle || title.trim().length >= 2);
  return (
    <form
      className="mb-3 flex flex-wrap items-center gap-2 text-sm"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setProblem("");
        try {
          const result = await call<{ application: App }>("/company", "PATCH", { applicationId: app.id, ...(needsCompany ? { company } : {}), ...(needsTitle ? { title } : {}) });
          onSaved({ ...app, ...result.application, contacts: app.contacts });
        } catch (reason) {
          setProblem(reason instanceof Error ? reason.message : "Couldn't save it.");
        } finally {
          setBusy(false);
        }
      }}
    >
      {needsTitle && (
        <>
          <label className="sr-only" htmlFor={`title-${app.id}`}>Job title</label>
          <input id={`title-${app.id}`} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Job title, like Growth Intern" maxLength={200} className="min-w-0 flex-1 rounded-lg border border-line bg-card px-3 py-2 text-sm sm:max-w-xs" />
        </>
      )}
      {needsCompany && (
        <>
          <label className="sr-only" htmlFor={`company-${app.id}`}>Company for {app.title}</label>
          <input id={`company-${app.id}`} value={company} onChange={(event) => setCompany(event.target.value)} placeholder="Company name, like MealPal" maxLength={200} className="min-w-0 flex-1 rounded-lg border border-line bg-card px-3 py-2 text-sm sm:max-w-xs" />
        </>
      )}
      <button type="submit" className={secondary} disabled={busy || !ready}>{busy ? "Saving…" : needsCompany && needsTitle ? "Save" : needsTitle ? "Add job title" : "Add company"}</button>
      {problem && <span role="alert" className="text-xs text-red-300">{problem}</span>}
    </form>
  );
}

/** "+ Add job": a job applied to somewhere Unnepo didn't see, or one to keep track of. Title and company are enough. */
function AddJobForm({ onDone }: { onDone: (added: boolean) => void | Promise<void> }) {
  const [job, setJob] = useState({ title: "", company: "", url: "", location: "", stage: "applied", appliedOn: new Date().toISOString().slice(0, 10), description: "" });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [linkNote, setLinkNote] = useState("");
  const [readFor, setReadFor] = useState("");
  const set = (patch: Partial<typeof job>) => setJob((before) => ({ ...before, ...patch }));
  // A job link fills in the rest: read on the server (company sites) or by the extension (job boards).
  // Only empty boxes are filled, so nothing typed is replaced.
  async function readLink(url: string) {
    const link = url.trim();
    if (!/^https:\/\/\S+\.\S+/i.test(link) || link === readFor) return;
    setReadFor(link);
    setLinkNote("Reading the link…");
    let info: { title: string; company: string; location: string; description: string } | null = null;
    let note = "";
    try {
      info = (await call<{ info: typeof info }>("/read-link", "POST", { url: link })).info;
    } catch (reason) {
      if (reason instanceof CallError && reason.code === "in_browser") {
        if (await extensionHere()) {
          const [result] = await readLinksInBrowser([{ id: "", url: link }]);
          info = result?.info ?? null;
          if (!info) note = result?.error ?? "Couldn't find the job on that page. Type the details instead.";
        } else note = "Job boards only show their jobs in your browser. Open this page in Chrome with the Unnepo extension connected to fill it in, or type the details.";
      } else note = reason instanceof Error ? reason.message : "Couldn't read the link.";
    }
    if (info) {
      const found = info;
      setJob((before) => ({ ...before, title: before.title || found.title, company: before.company || found.company, location: before.location || found.location, description: before.description || found.description }));
      note = `Filled in from the link${found.company ? "" : ". Type the company: the page didn't say"}.`;
    }
    setLinkNote(note);
  }
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
      <div className="sm:col-span-2">
        <label className={label} htmlFor="add-url">Job link (fills in the rest)</label>
        <input id="add-url" type="url" className={input} value={job.url} onChange={(event) => set({ url: event.target.value })} onBlur={(event) => void readLink(event.target.value)} onPaste={(event) => { const pasted = event.clipboardData.getData("text"); setTimeout(() => void readLink(pasted), 0); }} placeholder="https://… (optional)" />
        {linkNote && <p role="status" className="mt-1 text-xs text-muted">{linkNote}</p>}
      </div>
      <div><label className={label} htmlFor="add-title">Job title</label><input id="add-title" className={input} value={job.title} onChange={(event) => set({ title: event.target.value })} placeholder="Growth Marketing Intern" maxLength={200} required /></div>
      <div><label className={label} htmlFor="add-company">Company</label><input id="add-company" className={input} value={job.company} onChange={(event) => set({ company: event.target.value })} placeholder="MealPal" maxLength={200} required /></div>
      <div><label className={label} htmlFor="add-location">Location (optional)</label><input id="add-location" className={input} value={job.location} onChange={(event) => set({ location: event.target.value })} placeholder="Boston, MA" maxLength={200} /></div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label} htmlFor="add-stage">Status</label>
          <select id="add-stage" className={input} value={job.stage} onChange={(event) => set({ stage: event.target.value })}>
            <option value="applied">Applied</option><option value="in_progress">Not applied yet</option><option value="assessment">Assessment</option><option value="interviewing">Interviewing</option><option value="offer">Offer</option><option value="rejected">Rejected</option>
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

/** "Auto-added from email" or "Updated from email": a forwarded email saved or changed this job. */
function EmailBadge({ mark }: { mark: "added" | "updated" }) {
  return <span className="shrink-0 rounded-full border border-[#3D8BFF]/50 px-2 py-0.5 text-[11px] font-medium text-[#7FB2FF]" title={mark === "added" ? "Saved from a forwarded email" : "Its status changed from a forwarded email"}>{mark === "added" ? "Auto-added from email" : "Updated from email"}</span>;
}

const HISTORY_LABEL: Record<string, string> = { applied: "Applied", incomplete: "Not finished", assessment: "Assessment", interviewing: "Interviewing", offer: "Offer", rejected: "Rejected" };

/**
 * A job's info: what Unnepo knows about it, from the page it was saved from or its link, with the posting and
 * application as links. "Edit" changes any of it; "Fill in from the link" reads the link again for whatever is
 * missing. Below, the student's own quick notes, saved when they press Save.
 */
function JobInfo({ app, reading, disabled, note, onRead, onSaved }: { app: App; reading: boolean; disabled: boolean; note: string; onRead: () => void; onSaved: (app: App) => void }) {
  const posting = postingLink(app);
  const applied = app.fillReport?.activity?.find((event) => event.kind === "applied");
  const link = posting || app.applicationUrl || "";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: "", company: "", location: "", url: "", description: "" });
  const [notes, setNotes] = useState(app.fillReport?.notes ?? "");
  const [busy, setBusy] = useState("");
  const [problem, setProblem] = useState("");
  const [saidSaved, setSaidSaved] = useState(false);
  const save = async (key: string, body: Record<string, string>) => {
    setBusy(key);
    setProblem("");
    try {
      const result = await call<{ application: App }>("/details", "PATCH", { applicationId: app.id, ...body });
      onSaved({ ...app, ...result.application, contacts: app.contacts });
      return true;
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : "Couldn't save it.");
      return false;
    } finally {
      setBusy("");
    }
  };
  const startEdit = () => {
    setDraft({ title: app.titleMissing ? "" : app.title, company: app.companyMissing ? "" : app.company, location: app.location ?? "", url: posting, description: app.description });
    setEditing(true);
  };
  const box = "w-full rounded-lg border border-line bg-card px-3 py-2 text-sm";
  const rows: Array<[string, React.ReactNode]> = [
    ["Company", app.companyMissing ? <span key="company" className="text-[#F5A524]">Missing</span> : app.company],
    ["Job", app.titleMissing ? <span key="title" className="text-[#F5A524]">Missing</span> : app.title],
    ["Location", app.location || <span key="location" className="text-faint">Not known</span>],
    ["Found on", siteFor(app)],
    ["Applied", app.submittedAt ? `${new Date(app.submittedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}${applied?.how ? ` · ${HOW_LABEL[applied.how]}` : ""}` : "Not yet"],
  ];
  const links = [
    posting ? <a key="posting" href={posting} target="_blank" rel="noreferrer" className="text-ink underline underline-offset-4 hover:text-white">Job posting ↗</a> : null,
    app.applicationUrl && app.applicationUrl !== posting ? <a key="application" href={app.applicationUrl} target="_blank" rel="noreferrer" className="text-ink underline underline-offset-4 hover:text-white">Application ↗</a> : null,
  ].filter(Boolean);
  if (links.length) rows.push(["Links", <span key="links" className="flex flex-wrap gap-4">{links}</span>]);
  return (
    <section aria-label={`Info for ${app.title}`} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Info</h3>
        {!editing && (
          <span className="flex flex-wrap gap-4 text-xs">
            {link && <button type="button" className="text-muted underline-offset-4 hover:text-white hover:underline disabled:opacity-40" disabled={disabled} onClick={onRead}>{reading ? "Reading the link…" : "Fill in from the link"}</button>}
            <button type="button" className="text-muted underline-offset-4 hover:text-white hover:underline" onClick={startEdit}>Edit</button>
          </span>
        )}
      </div>
      {editing ? (
        <form
          className="grid gap-3 sm:grid-cols-2"
          aria-label={`Edit ${app.title}`}
          onSubmit={async (event) => {
            event.preventDefault();
            if (await save("edit", draft)) setEditing(false);
          }}
        >
          <label className="text-xs font-medium text-muted">Job title<input className={`${box} mt-1`} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} maxLength={200} required /></label>
          <label className="text-xs font-medium text-muted">Company<input className={`${box} mt-1`} value={draft.company} onChange={(event) => setDraft({ ...draft, company: event.target.value })} maxLength={200} required /></label>
          <label className="text-xs font-medium text-muted">Location<input className={`${box} mt-1`} value={draft.location} onChange={(event) => setDraft({ ...draft, location: event.target.value })} maxLength={200} placeholder="Boston, MA" /></label>
          <label className="text-xs font-medium text-muted">Job posting link<input type="url" className={`${box} mt-1`} value={draft.url} onChange={(event) => setDraft({ ...draft, url: event.target.value })} placeholder="https://…" /></label>
          <label className="text-xs font-medium text-muted sm:col-span-2">Job description<textarea rows={5} className={`${box} mt-1`} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} maxLength={8000} /></label>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            <button type="submit" className={primary} disabled={busy === "edit" || draft.title.trim().length < 2 || draft.company.trim().length < 2}>{busy === "edit" ? "Saving…" : "Save changes"}</button>
            <button type="button" className={secondary} onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <>
          <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
            {rows.map(([term, value]) => (
              <div key={term} className="contents"><dt className="text-faint">{term}</dt><dd className="min-w-0">{value}</dd></div>
            ))}
          </dl>
          {app.fillReport?.statusHistory?.length ? (
            <div className="text-sm">
              <h4 className="mb-1 text-xs font-medium text-faint">Status history</h4>
              <ol className="flex flex-col gap-1">
                {[...app.fillReport.statusHistory].reverse().map((change, index) => (
                  <li key={`${change.at}-${index}`} className="flex flex-wrap gap-x-2 text-muted">
                    <span className="w-16 flex-none text-faint tabular-nums">{new Date(change.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                    <span className="text-ink">{HISTORY_LABEL[change.status] ?? change.status}</span>
                    <span className="text-faint">{change.source === "email" ? "from email" : "by you"}</span>
                    {change.source === "email" && change.summary && <span className="min-w-0">· {change.summary}</span>}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
          {app.description.trim() ? (
            <details className="text-sm">
              <summary className="cursor-pointer select-none text-muted hover:text-white">Job description</summary>
              <p className="mt-2 max-h-72 overflow-y-auto whitespace-pre-line text-muted">{app.description}</p>
            </details>
          ) : <p className="text-xs text-faint">No job description saved{link ? ". Fill in from the link to add it." : "."}</p>}
        </>
      )}
      <form
        className="flex flex-col gap-2"
        onSubmit={async (event) => {
          event.preventDefault();
          if (await save("notes", { notes })) {
            setSaidSaved(true);
            setTimeout(() => setSaidSaved(false), 2500);
          }
        }}
      >
        <label htmlFor={`notes-${app.id}`} className="text-sm font-semibold">Quick notes</label>
        <textarea id={`notes-${app.id}`} rows={3} className={box} value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={4000} placeholder="Who you talked to, the next step, anything to remember…" />
        <span className="flex items-center gap-3">
          <button type="submit" className={secondary} disabled={busy === "notes" || notes === (app.fillReport?.notes ?? "")}>{busy === "notes" ? "Saving…" : "Save notes"}</button>
          {saidSaved && <span role="status" className="text-xs text-muted">Saved.</span>}
        </span>
      </form>
      {(note || problem) && <p role={problem ? "alert" : "status"} className={`text-xs ${problem ? "text-red-300" : "text-muted"}`}>{problem || note}</p>}
    </section>
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
          <button type="button" className={primary} onClick={() => onRetry()}>Find people to reach out to</button>
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
