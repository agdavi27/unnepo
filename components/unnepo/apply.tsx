"use client";

import { SpiderLoader } from "@/components/unnepo/spider-loader";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FileText, GraduationCap, Mail, Plus, Star, StickyNote, User, X } from "lucide-react";
import { ReviewInboxButton } from "@/components/unnepo/email-tracking";
import { guessProvider } from "@/components/unnepo/email-wizard";
import { HomePage, HomeTiles, MoreStats, PerDayCard, type Goals } from "@/components/unnepo/home";
import type { Maybe, Session } from "@/components/unnepo/activity";
import { extensionHere, readLinksInBrowser } from "@/lib/extension-bridge";
import { followUpsDue } from "@/lib/apply/follow-ups";
import { PeopleSearching } from "@/components/unnepo/people-searching";
import { Spiders } from "@/components/unnepo/stats";
import { stageOf, appliedOn, applicationStats, type Stage } from "@/lib/apply/stats";
import { HOW_LABEL } from "@/lib/apply/activity-stats";
import { WHENS, arrange, postingLink, siteFor, sitesIn, sortByColumn, type Column, type When } from "@/lib/apply/applied-list";
import type { ApplicationContact, ApplicationProfile, JobApplication, OutreachState } from "@/lib/apply/types";
import type { planUsage } from "@/lib/apply/limits";

const btn = "inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const primary = `${btn} bg-white text-black hover:bg-zinc-200`;
const secondary = `${btn} border border-line bg-transparent text-ink hover:bg-white/5`;
const card = "rounded-2xl border border-line bg-panel p-5 sm:p-6";

export type App = JobApplication & { missing: string[]; contacts?: ApplicationContact[]; companyMissing?: boolean; titleMissing?: boolean; descriptionCut?: boolean };
export type PublicProfile = Omit<ApplicationProfile, "jobSitePasswordEncrypted"> & { hasJobSitePassword: boolean };
export type PlanUsage = Awaited<ReturnType<typeof planUsage>>;
export type ApplyData = {
  applications: App[];
  profile: PublicProfile;
  resume: { fileName: string; stored: boolean } | null;
  ready: { hunter: boolean; profile: boolean };
  usage?: PlanUsage;
  school: string;
  plan?: string;
  maybe?: Maybe[];
  session?: Session;
};

const ROLE_LABEL: Record<ApplicationContact["role"], string> = {
  alumni: "School connection",
  job_poster: "Named on posting",
  recruiter: "Recruiter",
  hiring_manager: "Hiring manager",
  team_member: "Team",
};

/** Where each email came from, and whether it was checked. */
const EMAIL_SOURCE: Record<NonNullable<ApplicationContact["emailSource"]>, string> = {
  apollo: "Verified",
  hunter: "Verified",
  job_posting: "From the job posting",
  pattern: "Verified",
  website: "From the company's website",
  likely: "Likely · follows the company's format, not checked yet",
  cant_check: "Can't be checked · this company accepts every address",
  guess: "Best guess · the company's format isn't known",
};

const OUTREACH: Array<[OutreachState, string]> = [["not_contacted", "Not contacted"], ["emailed", "Emailed"], ["replied", "Replied"], ["no_response", "No response"]];

export const STAGE: Record<Stage, { label: string; color: string }> = {
  in_progress: { label: "In progress", color: "#F5A524" },
  submitted: { label: "Applied", color: "#9A9AA3" },
  // Worked out after 28 quiet days; shown as plain Applied, which is all the student needs to know.
  no_response: { label: "Applied", color: "#9A9AA3" },
  follow_up: { label: "Follow up", color: "#F5C518" },
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

async function call<T>(path: string, method: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/apply${path}`, { method, signal, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new CallError(payload.error || `Something went wrong (${response.status}).`, payload.code ?? "");
  return payload as T;
}

/** The list of applications, giving up after 30 seconds so the page never waits forever. */
async function fetchApplications() {
  try {
    return await call<ApplyData>("", "GET", undefined, AbortSignal.timeout(30_000));
  } catch (reason) {
    if (reason instanceof DOMException && reason.name === "TimeoutError") throw new Error("Your applications are taking too long to load.");
    throw reason;
  }
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
export type AppPage = "home" | "applications";

/** How long a list fetched ahead of time is still worth showing. */
const EARLY_LOAD_MS = 15_000;
let earlyLoad: { at: number; list: Promise<ApplyData> } | null = null;

/** Starts fetching the applications as the dashboard opens, so they don't wait for the workspace to finish loading first. */
export function loadApplicationsEarly() {
  const list = fetchApplications();
  list.catch(() => undefined);
  earlyLoad = { at: Date.now(), list };
}

function takeEarlyLoad() {
  const early = earlyLoad;
  earlyLoad = null;
  return early && Date.now() - early.at < EARLY_LOAD_MS ? early.list : null;
}

/** The Home and Applications pages. They share their data, so moving between them is instant and nothing is lost. */
export function ApplyArea({ page, onPage, refreshKey = 0, userName, onUsage, onSetup, onJobs, onSpiders }: { page: AppPage; onPage: (page: AppPage) => void; refreshKey?: number; userName: string; onUsage?: (usage: PlanUsage) => void; onSetup: () => void; onJobs: () => void; onSpiders: () => void }) {
  const [data, setData] = useState<ApplyData | null>(null);
  const [error, setError] = useState("");
  const usage = data?.usage;
  useEffect(() => { if (usage) onUsage?.(usage); }, [usage, onUsage]);

  const load = useCallback(async () => {
    try {
      const early = takeEarlyLoad();
      setData(await (early ? early.catch(() => fetchApplications()) : fetchApplications()));
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
  if (!data) return <SpiderLoader label="Loading your applications…" />;

  return (
    <AppliedPage
      page={page}
      onPage={onPage}
      data={data}
      userName={userName}
      onSetup={onSetup}
      onJobs={onJobs}
      onSpiders={onSpiders}
      onGoals={async (goals) => {
        const result = await call<{ profile: PublicProfile }>("/profile", "PUT", goals);
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
    <>
    <Spiders
      applied={applicationStats(data.applications).applied}
      school={data.school}
      picked={data.profile.spiderSkin ?? null}
      onPick={async (spiderSkin) => {
        const result = await call<{ profile: PublicProfile }>("/profile", "PUT", { spiderSkin });
        setData({ ...data, profile: result.profile });
      }}
    />
    <section aria-labelledby="your-numbers" className="flex flex-col gap-4">
      <h2 id="your-numbers" className="m-0 text-xl font-semibold tracking-tight">Your numbers</h2>
      <HomeTiles apps={data.applications} />
      <PerDayCard apps={data.applications} />
      <MoreStats apps={data.applications} />
    </section>
    </>
  );
}

function StageDot({ stage }: { stage: Stage }) {
  const color = STAGE[stage].color;
  return <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={stage === "rejected" ? { boxShadow: `inset 0 0 0 1.5px ${color}` } : { background: color }} />;
}

/**
 * The status of an applied job, changeable by the student: Applied, Follow up or Rejected, and Interviewing when
 * they set it. A job with a follow-up email due shows Follow up. Jobs not submitted yet just say so.
 */
function StageControl({ app, due, onChange }: { app: App; due: boolean; onChange: (outcome: Stage) => void }) {
  const worked = stageOf(app);
  const stage: Stage = worked === "no_response" ? "submitted" : (worked === "submitted" && due) ? "follow_up" : worked;
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
        {/* Assessment and Offer stay listed only on jobs already set to them. */}
        {(["submitted", "follow_up", ...(stage === "assessment" ? ["assessment" as const] : []), "interviewing", ...(stage === "offer" ? ["offer" as const] : []), "rejected"] as const).map((value) => <option key={value} value={value} className="bg-card text-ink">{STAGE[value].label}</option>)}
      </select>
      <span aria-hidden className="pointer-events-none absolute right-2 text-[10px] text-faint">▾</span>
    </span>
  );
}

const UNDO_MS = 5000;
const deleteNow = (applicationId: string, keepalive = false) =>
  fetch("/api/apply/applications", { method: "DELETE", keepalive, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ applicationId }) });

function AppliedPage({ page, onPage, data, userName, onSetup, onJobs, onSpiders, onGoals, onReload, onReplace, onApps }: { page: AppPage; onPage: (page: AppPage) => void; data: ApplyData; userName: string; onSetup: () => void; onJobs: () => void; onSpiders: () => void; onGoals: (goals: Goals) => Promise<void>; onReload: () => Promise<void>; onReplace: (app: App) => void; onApps: (change: (apps: App[]) => App[]) => void }) {
  const apps = data.applications;
  // Removing is instant: the row goes away and is deleted for real after a few seconds, unless undone.
  const [removed, setRemoved] = useState<App[]>([]);
  const pending = useRef(new Map<string, number>());
  const [open, setOpen] = useState<string | null>(null);
  // The job Home sent the student to read the emails of.
  const [openOn, setOpenOn] = useState<string | null>(null);
  // The extension's My jobs opens /home?job=<id>, which lands on Applications: that job's details, scrolled into view.
  const linked = useRef(false);
  useEffect(() => {
    if (linked.current || !apps.length) return;
    const wanted = new URLSearchParams(window.location.search).get("job");
    if (!wanted) return;
    linked.current = true;
    window.history.replaceState(null, "", window.location.pathname);
    if (!apps.some((app) => app.id === wanted)) return;
    setOpen(wanted);
    requestAnimationFrame(() => document.getElementById(`job-${wanted}`)?.scrollIntoView({ block: "center" }));
  }, [apps]);
  const [query, setQuery] = useState("");
  // Best news first until the student presses a column title.
  const [sort, setSort] = useState<{ column: Column; ascending: boolean }>({ column: "stage", ascending: true });
  const [site, setSite] = useState("");
  const [period, setPeriod] = useState<When>("all");
  const [notFollowed, setNotFollowed] = useState(false);
  const [starredOnly, setStarredOnly] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  // Jobs with a follow-up email due: their rows are yellow, so it's obvious one needs sending.
  const followUpIds = useMemo(() => new Set(followUpsDue(apps).map((item) => item.applicationId)), [apps]);
  const sites = useMemo(() => sitesIn(apps), [apps]);
  const [problem, setProblem] = useState("");
  const [adding, setAdding] = useState(false);
  const [reading, setReading] = useState<string | null>(null);
  const [readNote, setReadNote] = useState({ key: "", text: "" });
  // Jobs saved by the extension show up when the student comes back to this page.
  useEffect(() => {
    const again = () => { if (document.visibilityState === "visible") void onReload().catch(() => undefined); };
    window.addEventListener("focus", again);
    document.addEventListener("visibilitychange", again);
    return () => {
      window.removeEventListener("focus", again);
      document.removeEventListener("visibilitychange", again);
    };
  }, [onReload]);
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
  const shown = useMemo(() => {
    const words = query.trim().toLowerCase();
    const matching = apps.filter((app) => !words || `${app.company} ${app.title} ${app.location ?? ""}`.toLowerCase().includes(words));
    const sorted = sortByColumn(arrange(matching.filter((app) => !starredOnly || app.fillReport?.starred), { sort: "recent", site, when: period, notFollowed }), sort.column, sort.ascending, followUpIds);
    // Starred jobs stay at the top, in the order the column gives them.
    return [...sorted.filter((app) => app.fillReport?.starred), ...sorted.filter((app) => !app.fillReport?.starred)];
  }, [apps, query, sort, site, period, notFollowed, starredOnly, followUpIds]);
  const clearFilters = () => {
    setQuery("");
    setSite("");
    setPeriod("all");
    setNotFollowed(false);
    setStarredOnly(false);
  };
  const pressColumn = (column: Column) => setSort((now) => (now.column === column ? { column, ascending: !now.ascending } : { column, ascending: column !== "applied" }));

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

  async function toggleStar(app: App) {
    setProblem("");
    const starred = !app.fillReport?.starred;
    const report = app.fillReport ?? { filled: [], failed: [], liveViewUrl: null, screenshotAt: null };
    onReplace({ ...app, fillReport: { ...report, starred } });
    try {
      const result = await call<{ application: App }>("/details", "PATCH", { applicationId: app.id, starred });
      onReplace({ ...app, ...result.application, contacts: app.contacts });
    } catch (reason) {
      onReplace(app);
      setProblem(reason instanceof Error ? reason.message : "Couldn't star it.");
    }
  }

  const stageCell = (app: App) => <StageControl app={app} due={followUpIds.has(app.id)} onChange={(next) => void setStage(app, next)} />;
  const row = (app: App) => {
    const expanded = open === app.id;
    const stage = stageOf(app);
    const posting = postingLink(app);
    const toggle = () => setOpen(expanded ? null : app.id);
    const role = app.titleMissing ? "" : app.title;
    const fromEmail = app.fillReport?.fromEmail ? <EmailMark mark={app.fillReport.fromEmail} /> : null;
    const starred = Boolean(app.fillReport?.starred);
    const followUp = followUpIds.has(app.id);
    return (
      <Fragment key={app.id}>
        <tr id={`job-${app.id}`} className={`border-t border-[#17171B] ${followUp ? "bg-[#F5C518]/[0.08] shadow-[inset_3px_0_0_#F5C518]" : ""}`}>
          <td className="py-3.5 pr-2 align-middle font-medium">
            <span className="flex items-start gap-1">
            <button type="button" onClick={() => void toggleStar(app)} aria-pressed={starred} aria-label={starred ? `Unstar ${app.company}` : `Star ${app.company}`} title={starred ? "Starred" : "Star this job"} className={`-ml-1 mt-[1px] flex h-5 w-5 flex-none items-center justify-center rounded hover:text-[#F5C518] ${starred ? "text-[#F5C518]" : "text-[#4A4A52]"}`}>
              <Star aria-hidden size={14} strokeWidth={1.8} fill={starred ? "currentColor" : "none"} />
            </button>
            <button type="button" onClick={toggle} aria-expanded={expanded} aria-label={app.companyMissing ? "Open this job's details" : undefined} className="flex max-w-full items-start gap-1.5 text-left hover:text-white">
              <span aria-hidden className={`mt-[3px] text-[10px] text-[#8B8B94] transition-transform ${expanded ? "rotate-90" : ""}`}>▶</span>
              <span className="min-w-0 break-words">{app.companyMissing ? "" : app.company}</span>
            </button>
            </span>
            {followUp && <span className="mt-1 ml-5 inline-flex items-center rounded-full bg-[#F5C518]/15 px-2 py-0.5 text-[11px] font-semibold text-[#F5C518]">Follow up due</span>}
            {(role || fromEmail) && <span className="mt-0.5 flex items-center gap-1.5 pl-4 text-[13px] font-normal text-[#B4B4BC] sm:hidden"><span className="min-w-0">{role}</span>{fromEmail}</span>}
            <span className="mt-0.5 block pl-4 font-mono text-xs font-normal text-[#8B8B94] sm:hidden">{when(appliedOn(app))}</span>
          </td>
          <td className="hidden px-2 py-3.5 align-middle text-[#B4B4BC] sm:table-cell">
            {role}
            <span className="text-[#8B8B94]">{role ? " · " : ""}{posting ? <a href={posting} target="_blank" rel="noreferrer" className="hover:text-white hover:underline" title={`Open the job posting on ${siteFor(app)}`}>{siteFor(app)} ↗</a> : foundOn(app)}</span>
            {fromEmail && <span className="ml-2 inline-block align-middle">{fromEmail}</span>}
          </td>
          <td className="hidden whitespace-nowrap px-2 py-3.5 align-middle font-mono text-xs text-[#8B8B94] sm:table-cell">{when(appliedOn(app))}</td>
          <td className="px-1 py-3.5 align-middle sm:px-2">{stageCell(app)}</td>
        </tr>
        {expanded && (
          <tr>
            <td colSpan={4} className="pb-4">
              <div className="space-y-4 rounded-xl border border-line bg-panel p-4">
                <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
                  <JobInfo app={app} studentEmail={data.profile.email} startOn={openOn === app.id ? "emails" : ""} reading={reading === app.id} disabled={reading !== null} note={readNote.key === app.id && reading === null ? readNote.text : ""} onRead={(next) => void readLinks([next ?? app], app.id)} onSaved={onReplace} />
                  {/* The people box stays this size whatever is in it, and scrolls inside. */}
                  <div className="relative min-w-0 lg:min-h-[24rem]">
                    <div className="h-full lg:absolute lg:inset-0">
                    {stage === "in_progress" ? (
                      <div className={peopleCard}>
                        <PeopleCircles />
                        <p className="m-0 text-sm font-medium">Not submitted yet</p>
                        <p className="m-0 max-w-xs text-[13px] text-muted">Open the application and press Fill in the Unnepo extension, or mark it applied if you sent it yourself.</p>
                        <button type="button" className={primary} onClick={() => void act("/applied", "POST", { applicationId: app.id })}>I applied</button>
                        <div className="w-full text-left empty:hidden"><PostedBy app={app} /></div>
                      </div>
                    ) : (
                      <ContactsPanel app={app} school={data.school} peopleNote={data.usage?.people.note ?? ""} onStatus={(contactId, status) => void act("/contact", "PATCH", { contactId, status })} onRetry={(website) => void act("/retry-contacts", "POST", { applicationId: app.id, ...(website ? { website } : {}) })} onEmail={(contactId, edit) => act("/contact-email", "POST", { applicationId: app.id, contactId, ...edit })} onReveal={(contactId) => act("/reveal-person", "POST", { applicationId: app.id, contactId })} onBounced={(contactId) => void act("/contact-bounced", "POST", { applicationId: app.id, contactId })} />
                    )}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line pt-3 text-xs text-faint">
                  <span className="min-w-0">
                    {app.status === "submitted" && app.confirmation
                      ? app.confirmation.confidence === "likely" ? "Looks submitted: the page said so." : "Confirmed: the site accepted the submission."
                      : app.status === "applied_manual" ? app.statusMessage || "Marked applied by you." : app.statusMessage}
                  </span>
                  <span className="flex flex-wrap gap-4">
                    {app.confirmation?.receiptPath && <a className="hover:text-white" href={`/api/apply/receipt?applicationId=${encodeURIComponent(app.id)}`} target="_blank" rel="noreferrer">Receipt ↗</a>}
                    <button type="button" className="hover:text-red-300" onClick={() => remove(app)}>Remove job</button>
                  </span>
                </div>
              </div>
            </td>
          </tr>
        )}
      </Fragment>
    );
  };
  const heading = (column: Column, label: string, className: string) => {
    const active = sort.column === column;
    return (
      <th scope="col" aria-sort={active ? (sort.ascending ? "ascending" : "descending") : "none"} className={`py-1.5 font-medium ${className}`}>
        <button type="button" onClick={() => pressColumn(column)} className={`inline-flex h-8 items-center gap-1.5 rounded-lg uppercase tracking-[1.2px] hover:text-white ${active ? "text-[#F7F7F8]" : ""}`}>
          {label}
          <span aria-hidden className={active ? "" : "text-[#4A4A52]"}>{active ? (sort.ascending ? "↑" : "↓") : "↕"}</span>
        </button>
      </th>
    );
  };
  const table = (list: App[]) => (
    <div className="border-t border-[#1F1F24]">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">Your applications</caption>
        <thead>
          <tr className="text-left font-mono text-[11px] text-[#8B8B94]">
            {heading("company", "Company", "pr-2")}
            {heading("role", "Role", "hidden px-2 sm:table-cell")}
            {heading("applied", "Applied", "hidden px-2 sm:table-cell")}
            {heading("stage", "Stage", "px-1 sm:px-2")}
          </tr>
        </thead>
        <tbody>{list.map(row)}</tbody>
      </table>
    </div>
  );
  const openJob = (appId: string, panel?: "emails") => {
    clearFilters();
    setOpenOn(panel ? appId : null);
    setOpen(appId);
    onPage("applications");
    requestAnimationFrame(() => document.getElementById(`job-${appId}`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
  };

  return (
    <div className="flex flex-col gap-8">
      {page === "home" && (
        <>
          <HomePage
            name={userName}
            apps={apps}
            goals={data.profile}
            onGoals={onGoals}
            school={data.school}
            spiderSkin={data.profile.spiderSkin ?? null}
            onOpenJob={openJob}
            onWrite={(appId, contactId) => act("/contact-email", "POST", { applicationId: appId, contactId, followUp: true })}
            onSent={(contactId) => act("/contact", "PATCH", { contactId, status: "emailed", followedUp: true })}
            onSetup={onSetup}
            onReview={() => { onPage("applications"); setReviewOpen(true); }}
            onJobs={onJobs}
            onSpiders={onSpiders}
          />
        </>
      )}
      {page === "applications" && (
        <section aria-labelledby="applied-title" className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 id="applied-title" className="m-0 text-3xl font-bold tracking-[-1px]">Applications <span className="text-sm font-medium tracking-normal text-[#8B8B94] tabular-nums">{apps.length}</span></h1>
            <div className="flex items-center gap-2">
              <ReviewInboxButton open={reviewOpen} onOpenChange={setReviewOpen} onChanged={onReload} />
              {apps.length > 0 && <FiltersMenu query={query} onQuery={setQuery} period={period} onPeriod={setPeriod} site={site} onSite={setSite} sites={sites} notFollowed={notFollowed} onNotFollowed={setNotFollowed} starredOnly={starredOnly} onStarredOnly={setStarredOnly} shown={shown.length} onClear={clearFilters} />}
              <button type="button" className={secondary} onClick={() => setAdding((on) => !on)} aria-expanded={adding}>+ Add job</button>
            </div>
          </div>
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
          ) : table(shown)}
        </section>
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

function Avatar({ name, photoUrl, className = "h-12 w-12 border-line text-sm" }: { name: string; photoUrl: string | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  const initials = name.split(/\s+/).map((part) => part[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
  if (photoUrl && !failed) {
    return <img src={photoUrl} alt="" className={`${className} shrink-0 rounded-full border object-cover`} onError={() => setFailed(true)} />;
  }
  return <span className={`${className} flex shrink-0 items-center justify-center rounded-full border bg-card font-medium text-muted`}>{initials}</span>;
}

const floatDelay = (index: number) => ({ animationDelay: `${index * 0.45}s` });

/** Empty circles floating above Find people: nobody's face until real people are found. */
function PeopleCircles() {
  const circles = [{ Icon: User, dashed: false }, { Icon: User, dashed: true }, { Icon: GraduationCap, dashed: false }, { Icon: Plus, dashed: true }];
  return (
    <div aria-hidden className="flex pt-1">
      {circles.map(({ Icon, dashed }, index) => (
        <span key={index} style={floatDelay(index)} className={`people-float flex h-11 w-11 items-center justify-center rounded-full border bg-panel text-muted ${index ? "-ml-2.5" : ""} ${dashed ? "border-dashed border-[#3A3A44]" : "border-[#3A3A44]"}`}>
          <Icon size={17} strokeWidth={1.7} />
        </span>
      ))}
    </div>
  );
}

const peopleCard = "flex h-full max-h-[32rem] min-h-56 flex-col items-center justify-center gap-3 overflow-y-auto rounded-xl border border-line bg-card p-5 text-center lg:max-h-none";

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
            <option value="applied">Applied</option><option value="in_progress">Not applied yet</option><option value="follow_up">Follow up</option><option value="interviewing">Interviewing</option><option value="rejected">Rejected</option>
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

/** A small Gmail icon: a forwarded email saved or changed this job. */
function EmailMark({ mark }: { mark: "added" | "updated" }) {
  const label = mark === "added" ? "Added from a forwarded email" : "Updated from a forwarded email";
  return (
    <span title={label} className="inline-flex shrink-0 align-middle">
      <span className="sr-only">{label}</span>
      <svg aria-hidden viewBox="0 0 48 48" className="h-3.5 w-3.5">
        <path fill="#4caf50" d="M45,16.2l-5,2.75l-5,4.75L35,40h7c1.657,0,3-1.343,3-3V16.2z" />
        <path fill="#1e88e5" d="M3,16.2l3.614,1.71L13,23.7V40H6c-1.657,0-3-1.343-3-3V16.2z" />
        <polygon fill="#e53935" points="35,11.2 24,19.45 13,11.2 12,17 13,23.7 24,31.95 35,23.7 36,17" />
        <path fill="#c62828" d="M3,12.298V16.2l10,7.5V11.2L9.876,8.859C9.132,8.301,8.228,8,7.298,8h0C4.924,8,3,9.924,3,12.298z" />
        <path fill="#fbc02d" d="M45,12.298V16.2l-10,7.5V11.2l3.124-2.341C38.868,8.301,39.772,8,40.702,8h0C43.076,8,45,9.924,45,12.298z" />
      </svg>
    </span>
  );
}

/** The search and every filter for the Applications list, folded into one button. */
function FiltersMenu({ query, onQuery, period, onPeriod, site, onSite, sites, notFollowed, onNotFollowed, starredOnly, onStarredOnly, shown, onClear }: {
  query: string; onQuery: (value: string) => void;
  period: When; onPeriod: (value: When) => void;
  site: string; onSite: (value: string) => void; sites: Array<{ site: string; count: number }>;
  notFollowed: boolean; onNotFollowed: (value: boolean) => void;
  starredOnly: boolean; onStarredOnly: (value: boolean) => void;
  shown: number; onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    const onClick = (event: MouseEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);
  const active = [query.trim(), site, period !== "all", notFollowed, starredOnly].filter(Boolean).length;
  const select = "w-full rounded-lg border border-line bg-card px-2 py-1.5 text-sm text-ink";
  return (
    <div ref={box} className="sm:relative">
      <button type="button" className={secondary} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((on) => !on)}>
        <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M2 4h12M4.5 8h7M7 12h2" /></svg>
        Filters
        {active > 0 && <span className="rounded-full bg-[#3D8BFF] px-1.5 text-[11px] font-semibold text-white tabular-nums"><span className="sr-only">, active: </span>{active}</span>}
      </button>
      {open && (
        <div role="dialog" aria-label="Filter applications" className="absolute inset-x-3 z-30 mt-2 flex flex-col gap-3 rounded-xl border border-[#26262C] bg-[#0C0C0E] p-3 shadow-2xl sm:inset-x-auto sm:right-0 sm:w-72">
          <label className="flex flex-col gap-1 text-xs text-muted">Search
            <input autoFocus type="search" value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Company or role" className="w-full rounded-lg border border-line bg-card px-2.5 py-1.5 text-sm text-ink outline-none placeholder:text-faint focus:border-zinc-500" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">Applied
            <select value={period} onChange={(event) => onPeriod(event.target.value as When)} className={select}>
              {WHENS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
          {sites.length > 1 && (
            <label className="flex flex-col gap-1 text-xs text-muted">Site
              <select value={site} onChange={(event) => onSite(event.target.value)} className={select}>
                <option value="">All sites</option>
                {sites.map((item) => <option key={item.site} value={item.site}>{item.site} ({item.count})</option>)}
              </select>
            </label>
          )}
          <label className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={notFollowed} onChange={(event) => onNotFollowed(event.target.checked)} className="h-4 w-4 accent-white" />
            Not followed up yet
          </label>
          <label className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={starredOnly} onChange={(event) => onStarredOnly(event.target.checked)} className="h-4 w-4 accent-white" />
            Starred only
          </label>
          <div className="flex items-center justify-between border-t border-line pt-2.5 text-xs text-faint">
            <span className="tabular-nums" role="status">{shown} shown</span>
            {active > 0 && <button type="button" onClick={onClear} className="text-ink underline-offset-4 hover:underline">Clear filters</button>}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * "See all emails from Acme": the student's own inbox (Gmail or Outlook, from their email address, Gmail when it
 * can't tell), searched for mail from the company's domain or, without one, its name.
 */
function companyEmailSearch(company: string, domain: string | null, provider: "gmail" | "outlook") {
  const name = company.replace(/["()]/g, "").trim();
  const query = domain ? `from:(${domain} OR "${name}")` : `from:("${name}")`;
  if (provider === "outlook") return `https://outlook.live.com/mail/0/search?q=${encodeURIComponent(domain ? `from:${domain}` : `from:"${name}"`)}`;
  return `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(query)}`;
}

function CompanyEmailsLink({ company, domain, studentEmail }: { company: string; domain: string | null; studentEmail?: string | null }) {
  const guessed = guessProvider(studentEmail);
  const main = guessed === "outlook" ? "outlook" : "gmail";
  const other = main === "gmail" ? "outlook" : "gmail";
  const label = { gmail: "Gmail", outlook: "Outlook" };
  return (
    <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
      <a href={companyEmailSearch(company, domain, main)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-ink underline-offset-4 hover:text-white hover:underline">
        <Mail aria-hidden size={13} strokeWidth={1.7} />See all emails from {company} in {label[main]} ↗
      </a>
      <a href={companyEmailSearch(company, domain, other)} target="_blank" rel="noreferrer" className="text-xs text-faint underline-offset-4 hover:text-white hover:underline">or {label[other]} ↗</a>
    </p>
  );
}

/** Where the job came from, in words. A job a forwarded email added wasn't added by the student. */
const foundOn = (app: App) => (siteFor(app) === "Added by you" && app.fillReport?.fromEmail === "added" ? "Forwarded email" : siteFor(app));

const historyColor = (status: string) => (status === "applied" ? STAGE.submitted.color : status === "incomplete" ? STAGE.in_progress.color : STAGE[status as Stage]?.color ?? STAGE.submitted.color);

const HISTORY_LABEL: Record<string, string> = { follow_up: "Follow up", applied: "Applied", incomplete: "Not finished", assessment: "Assessment", interviewing: "Interviewing", offer: "Offer", rejected: "Rejected" };

/**
 * A job's info: what Unnepo knows about it, from the page it was saved from or its link, with the posting and
 * application as links. "Edit" changes any of it; "Fill in from the link" reads the link again for whatever is
 * missing. Below, the student's own quick notes, saved when they press Save.
 */
function JobInfo({ app, studentEmail, startOn, reading, disabled, note, onRead, onSaved }: { app: App; studentEmail?: string | null; startOn: "" | "emails"; reading: boolean; disabled: boolean; note: string; onRead: (next?: App) => void; onSaved: (app: App) => void }) {
  const posting = postingLink(app);
  const applied = app.fillReport?.activity?.find((event) => event.kind === "applied");
  const link = posting || app.applicationUrl || "";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: "", company: "", location: "", url: "", description: "" });
  const [notes, setNotes] = useState(app.fillReport?.notes ?? "");
  const [busy, setBusy] = useState("");
  const [problem, setProblem] = useState("");
  const [saidSaved, setSaidSaved] = useState(false);
  const [linkDraft, setLinkDraft] = useState("");
  const [addingLink, setAddingLink] = useState(false);
  const [panel, setPanel] = useState<"" | "description" | "emails" | "notes">(startOn);
  const [pasted, setPasted] = useState("");
  const [choice, setChoice] = useState("");
  const [told, setTold] = useState("");
  const [full, setFull] = useState<string | null>(null);
  const reply = (result: { application: App | null }) => {
    if (result.application) onSaved({ ...app, ...result.application, contacts: app.contacts });
    setFull(null);
  };
  /** The whole description: the list only carries the start of a long one. */
  const wholeDescription = async () => {
    if (!app.descriptionCut) return app.description;
    if (full !== null) return full;
    const result = await call<{ description: string }>(`/description?applicationId=${encodeURIComponent(app.id)}`, "GET");
    setFull(result.description);
    return result.description;
  };
  const findPosting = async () => {
    setBusy("find");
    setProblem("");
    setTold("");
    try {
      const result = await call<{ found: boolean; choices: number; application: App | null }>("/find-posting", "POST", { applicationId: app.id });
      reply(result);
      setChoice("");
      setTold(result.found ? "Found the posting." : result.choices ? "" : "Couldn't find the posting. Add its link or paste the description.");
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : "Couldn't look for it.");
    } finally {
      setBusy("");
    }
  };
  const choose = async (url: string) => {
    setBusy("choose");
    setProblem("");
    try {
      reply(await call<{ application: App | null }>("/choose-posting", "POST", { applicationId: app.id, url }));
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : "Couldn't save it.");
    } finally {
      setBusy("");
    }
  };
  const save = async (key: string, body: Record<string, string>) => {
    setBusy(key);
    setProblem("");
    try {
      const result = await call<{ application: App }>("/details", "PATCH", { applicationId: app.id, ...body });
      const next = { ...app, ...result.application, contacts: app.contacts };
      onSaved(next);
      setFull(null);
      return next;
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : "Couldn't save it.");
      return null;
    } finally {
      setBusy("");
    }
  };
  const startEdit = async () => {
    setProblem("");
    try {
      const description = await wholeDescription();
      setDraft({ title: app.titleMissing ? "" : app.title, company: app.companyMissing ? "" : app.company, location: app.location ?? "", url: posting, description });
      setEditing(true);
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : "Couldn't open it.");
    }
  };
  const box = "w-full rounded-lg border border-line bg-card px-3 py-2 text-sm";
  const addMissing = (label: string) => <button key={label} type="button" className="text-faint underline-offset-4 hover:text-white hover:underline" onClick={() => void startEdit()}>{label}</button>;
  const rows: Array<[string, React.ReactNode]> = [
    ["Company", app.companyMissing ? addMissing("Add company") : app.company],
    ["Job", app.titleMissing ? addMissing("Add job title") : app.title],
    ["Location", app.location || addMissing("Add location")],
    ["Applied", app.submittedAt ? `${new Date(app.submittedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}${applied?.how ? ` · ${HOW_LABEL[applied.how]}` : ""}` : "Not yet"],
    ["Found on", foundOn(app)],
    ...(app.fillReport?.jobNumber ? [["Job number", app.fillReport.jobNumber] as [string, React.ReactNode]] : []),
  ];
  const links = [
    posting ? <a key="posting" href={posting} target="_blank" rel="noreferrer" className="text-ink underline underline-offset-4 hover:text-white">Job posting ↗</a> : null,
    app.applicationUrl && app.applicationUrl !== posting ? <a key="application" href={app.applicationUrl} target="_blank" rel="noreferrer" className="text-ink underline underline-offset-4 hover:text-white">Application ↗</a> : null,
  ].filter(Boolean);
  const choices = app.fillReport?.postingChoices ?? [];
  if (links.length) rows.push(["Links", <span key="links" className="flex flex-wrap gap-4">{links}</span>]);
  else rows.push(["Posting", !addingLink ? (
    <span key="posting-actions" className="text-faint">
      <button type="button" className="text-ink underline underline-offset-4 hover:text-white" onClick={() => setAddingLink(true)}>Add link</button>
      {" or "}
      <button type="button" className="text-ink underline underline-offset-4 hover:text-white disabled:opacity-40" disabled={busy === "find" || disabled} onClick={() => void findPosting()}>{busy === "find" ? "looking…" : "find it"}</button>
    </span>
  ) : (
    <form
      key="add-link"
      className="flex flex-wrap items-center gap-2"
      onSubmit={async (event) => {
        event.preventDefault();
        const next = await save("link", { url: linkDraft.trim() });
        if (next) {
          setLinkDraft("");
          setAddingLink(false);
          onRead(next);
        }
      }}
    >
      <label className="sr-only" htmlFor={`link-${app.id}`}>Job posting link for {app.title}</label>
      <input id={`link-${app.id}`} autoFocus type="url" value={linkDraft} onChange={(event) => setLinkDraft(event.target.value)} placeholder="https://…" className="min-w-0 flex-1 basis-40 rounded-lg border border-line bg-card px-2.5 py-1.5 text-sm" />
      <button type="submit" className={secondary} disabled={busy === "link" || !linkDraft.trim()}>{busy === "link" ? "Saving…" : "Add link"}</button>
      <button type="button" className={secondary} onClick={() => setAddingLink(false)}>Cancel</button>
    </form>
  )]);
  const fromEmails = (app.fillReport?.statusHistory ?? []).filter((change) => change.source === "email").length;
  // Newest first. One email can change the status twice; its sentence shows once, on the newest change.
  const history = [...(app.fillReport?.statusHistory ?? [])].reverse().map((change, index, list) => ({
    ...change,
    note: change.source === "email" && change.summary && !list.slice(0, index).some((newer) => newer.summary === change.summary) ? change.summary : "",
  }));
  const sections = [
    { id: "description" as const, label: "Description", Icon: FileText, count: 0, on: Boolean(app.description.trim()) },
    { id: "emails" as const, label: "Emails", Icon: Mail, count: fromEmails + sentEmails(app).length, on: false },
    { id: "notes" as const, label: "Notes", Icon: StickyNote, count: 0, on: Boolean((app.fillReport?.notes ?? "").trim()) },
  ];
  const closeEmails = useCallback(() => setPanel(""), []);
  const openPanel = (next: typeof panel) => {
    setPanel((now) => (now === next ? "" : next));
    if (next === "description") void wholeDescription().catch(() => undefined);
  };
  return (
    <section aria-label={`Details for ${app.title}`} className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Details</h3>
        {!editing && (
          <span className="flex flex-wrap gap-4 text-xs">
            {link && <button type="button" className="text-muted underline-offset-4 hover:text-white hover:underline disabled:opacity-40" disabled={disabled} onClick={() => onRead()}>{reading ? "Reading the link…" : "Fill in from the link"}</button>}
            <button type="button" className="text-muted underline-offset-4 hover:text-white hover:underline" onClick={() => void startEdit()}>Edit</button>
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
          <label className="text-xs font-medium text-muted sm:col-span-2">Job description<textarea rows={5} className={`${box} mt-1`} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} maxLength={20000} /></label>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            <button type="submit" className={primary} disabled={busy === "edit" || draft.title.trim().length < 2 || draft.company.trim().length < 2}>{busy === "edit" ? "Saving…" : "Save changes"}</button>
            <button type="button" className={secondary} onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <>
          <dl className="m-0 grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
            {rows.map(([term, value]) => (
              <div key={term} className="contents"><dt className="text-faint">{term}</dt><dd className="m-0 min-w-0">{value}</dd></div>
            ))}
          </dl>
          {told && <p role="status" className="m-0 text-xs text-muted">{told}</p>}
          {choices.length > 0 && (
            <form
              className="flex flex-col gap-2 rounded-lg border border-[#3D8BFF]/50 p-3"
              onSubmit={(event) => { event.preventDefault(); void choose(choice); }}
            >
              <label htmlFor={`choice-${app.id}`} className="text-sm font-medium">Is it one of these? {app.company} has {choices.length === 1 ? "this posting" : "these postings"}.</label>
              <select id={`choice-${app.id}`} value={choice} onChange={(event) => setChoice(event.target.value)} className="w-full min-w-0 rounded-lg border border-line bg-card px-2.5 py-2 text-sm">
                <option value="">Choose a posting…</option>
                {choices.map((item) => <option key={item.url} value={item.url}>{item.title}{item.location ? ` · ${item.location}` : ""}</option>)}
              </select>
              <span className="flex flex-wrap items-center gap-2">
                <button type="submit" className={primary} disabled={busy === "choose" || !choice}>{busy === "choose" ? "Saving…" : "Use this one"}</button>
                <button type="button" className={secondary} disabled={busy === "choose"} onClick={() => void choose("")}>None of these</button>
              </span>
            </form>
          )}
          {history.length > 0 && (
            <ol aria-label="Status history" className="m-0 flex list-none flex-col gap-1.5 border-t border-line p-0 pt-3 text-sm">
              {history.map((change, index) => (
                <li key={`${change.at}-${index}`} className="grid grid-cols-[0.5rem_minmax(0,1fr)] items-baseline gap-x-2.5">
                  <span aria-hidden className="h-[7px] w-[7px] rounded-full" style={{ background: historyColor(change.status) }} />
                  <span>
                    {HISTORY_LABEL[change.status] ?? change.status}
                    <span className="text-faint"> {new Date(change.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {change.source === "email" ? "from email" : "by you"}</span>
                  </span>
                  {change.note && <span className="col-start-2 text-xs text-muted">{change.note}</span>}
                </li>
              ))}
            </ol>
          )}
          <div className="flex flex-wrap gap-1 border-t border-line pt-2.5">
            {sections.map(({ id, label, Icon, count, on }) => (
              <button key={id} type="button" aria-expanded={id === "emails" ? undefined : panel === id} aria-haspopup={id === "emails" ? "dialog" : undefined} onClick={() => openPanel(id)} className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] hover:text-white ${panel === id ? "bg-white/5 text-ink" : "text-muted"}`}>
                <Icon aria-hidden size={14} strokeWidth={1.7} />
                {label}
                {count ? <span className="tabular-nums text-faint">{count}</span> : null}
                {on && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[#3D8BFF]" />}
              </button>
            ))}
          </div>
          {panel === "description" && (app.description.trim() ? (
            <div className="text-sm">
              <p className="m-0 max-h-72 overflow-y-auto whitespace-pre-line text-muted">{full ?? app.description}</p>
              <button type="button" className="mt-2 text-xs text-muted underline-offset-4 hover:text-white hover:underline" onClick={() => void startEdit()}>Edit description</button>
            </div>
          ) : (
            <form
              className="flex flex-col gap-2"
              onSubmit={async (event) => {
                event.preventDefault();
                if (await save("description", { description: pasted })) setPasted("");
              }}
            >
              <label htmlFor={`description-${app.id}`} className="text-xs text-muted">No description saved yet</label>
              <textarea id={`description-${app.id}`} autoFocus rows={6} className={box} value={pasted} onChange={(event) => setPasted(event.target.value)} maxLength={20000} placeholder="Paste the posting's text here" />
              <span className="flex flex-wrap gap-2">
                <button type="submit" className={primary} disabled={busy === "description" || pasted.trim().length < 2}>{busy === "description" ? "Saving…" : "Save description"}</button>
                <button type="button" className={secondary} onClick={() => setPanel("")}>Cancel</button>
              </span>
            </form>
          ))}
          {!app.companyMissing && <CompanyEmailsLink company={app.company} domain={app.companyDomain} studentEmail={studentEmail} />}
          {panel === "emails" && <JobEmailsDialog app={app} onClose={closeEmails} />}
          {panel === "notes" && (
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
              <label htmlFor={`notes-${app.id}`} className="sr-only">Quick notes</label>
              <textarea id={`notes-${app.id}`} autoFocus rows={3} className={box} value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={4000} placeholder="Who you talked to, the next step, anything to remember…" />
              <span className="flex items-center gap-3">
                <button type="submit" className={secondary} disabled={busy === "notes" || notes === (app.fillReport?.notes ?? "")}>{busy === "notes" ? "Saving…" : "Save notes"}</button>
                {saidSaved && <span role="status" className="text-xs text-muted">Saved.</span>}
              </span>
            </form>
          )}
        </>
      )}
      {(note || problem) && <p role={problem ? "alert" : "status"} className={`text-xs ${problem ? "text-red-300" : "text-muted"}`}>{problem || note}</p>}
    </section>
  );
}

type JobEmail = { id: string; at: string; kind: string; summary: string; from: string; subject: string; text: string };

const emailDate = (at: string) => new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** What the student emailed people about this job: written in Unnepo and marked as sent. */
const sentEmails = (app: App) => (app.contacts ?? [])
  .filter((contact) => contact.emailBody && (contact.outreachStatus === "emailed" || contact.outreachStatus === "replied"))
  .map((contact) => ({ id: contact.id, at: app.fillReport?.emailedAt?.[contact.id] ?? contact.updatedAt, to: contact.email ? `${contact.name} (${contact.email})` : contact.name, subject: contact.emailSubject ?? "", text: contact.emailBody ?? "" }));

/** Every email about one job, in a popup over the blurred page. The ones received are read only when it opens, since each can be long. */
function JobEmailsDialog({ app, onClose }: { app: App; onClose: () => void }) {
  const [received, setReceived] = useState<JobEmail[] | null>(null);
  const [problem, setProblem] = useState("");
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/email/job?applicationId=${encodeURIComponent(app.id)}`)
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "Couldn't load the emails.");
        if (!cancelled) setReceived(payload.emails as JobEmail[]);
      })
      .catch((reason) => { if (!cancelled) setProblem(reason instanceof Error ? reason.message : "Couldn't load the emails."); });
    return () => { cancelled = true; };
  }, [app.id]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    const before = document.body.style.overflow;
    const opener = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    close.current?.focus();
    return () => {
      document.body.style.overflow = before;
      document.removeEventListener("keydown", onKey);
      opener?.focus();
    };
  }, [onClose]);
  const emails = [
    ...(received ?? []).map((email) => ({ key: `in-${email.id}`, at: email.at, line: `From ${email.from}`, subject: email.subject || email.summary || "Email", summary: email.subject ? email.summary : "", text: email.text, sent: false })),
    ...sentEmails(app).map((email) => ({ key: `out-${email.id}`, at: email.at, line: `To ${email.to}`, subject: email.subject || "Email", summary: "", text: email.text, sent: true })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const loading = received === null && !problem;
  const job = [app.titleMissing ? "" : app.title, app.companyMissing ? "" : app.company].filter(Boolean).join(" at ");
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 backdrop-blur-md sm:p-6"
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => { event.stopPropagation(); if (event.target === event.currentTarget) onClose(); }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="job-emails-title" className="flex max-h-full w-full max-w-2xl flex-col rounded-[20px] border border-[#222] bg-[#0F0F0F]">
        <div className="flex items-start justify-between gap-3 border-b border-[#1A1A1A] p-5">
          <div className="min-w-0">
            <h2 id="job-emails-title" className="m-0 text-lg font-semibold tracking-[-0.02em]">Emails</h2>
            {job && <p className="m-0 mt-0.5 truncate text-sm text-muted">{job}</p>}
          </div>
          <button ref={close} type="button" aria-label="Close" onClick={onClose} className="flex h-8 w-8 flex-none items-center justify-center rounded-full text-[#9A9AA3] hover:bg-white/5 hover:text-white"><X aria-hidden size={16} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5 text-sm">
          {problem && <p role="alert" className="m-0 mb-3 text-xs text-red-300">{problem}</p>}
          {loading && <p className="m-0 text-muted">Loading…</p>}
          {!loading && !emails.length && !problem && <p className="m-0 text-muted">No emails about this job yet. Emails you forward to Unnepo and emails you send to people here show up in this list.</p>}
          {emails.length > 0 && (
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {emails.map((email) => (
                <li key={email.key} className="rounded-xl border border-line p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="m-0 min-w-0 break-words font-medium">{email.subject}</p>
                    <span className="flex-none text-xs tabular-nums text-faint">{emailDate(email.at)}</span>
                  </div>
                  <p className="m-0 mt-1 break-words text-xs text-faint"><span className={email.sent ? "text-[#3D8BFF]" : ""}>{email.sent ? "Sent" : "Received"}</span> · {email.line}</p>
                  {email.summary && <p className="m-0 mt-2 text-xs text-muted">{email.summary}</p>}
                  {email.text
                    ? <p className="m-0 mt-3 whitespace-pre-line break-words text-muted">{email.text}</p>
                    : <p className="m-0 mt-2 text-xs text-faint">Only this summary was saved. Forward the email again to read it here.</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body,
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

function ContactsPanel({ app, school, peopleNote, onStatus, onRetry, onEmail, onReveal, onBounced }: { app: App; school: string; peopleNote: string; onStatus: (contactId: string, status: OutreachState) => void; onRetry: (website?: string) => void; onEmail: (contactId: string, edit?: EmailEdit) => Promise<void>; onReveal: (contactId: string) => Promise<void>; onBounced: (contactId: string) => void }) {
  const contacts = app.contacts ?? [];
  const [copied, setCopied] = useState("");
  const [website, setWebsite] = useState("");
  const [showing, setShowing] = useState("");
  // Nobody found: the student can correct the website, and has LinkedIn searches to go on.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (app.contactsStatus !== "finding") return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [app.contactsStatus]);
  const cutOff = app.contactsStatus === "finding" && now - Date.parse(app.updatedAt) > 2 * 60 * 1000;
  const noOne = contacts.length === 0 && (app.contactsStatus === "done" || app.contactsStatus === "failed" || cutOff);
  const hidden = app.fillReport?.peopleHidden ?? {};
  const revealsLeft = (app.fillReport?.peopleReveals ?? 0) < 3;
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
      <div className={peopleCard}>
        <PeopleCircles />
        <p className="m-0 text-sm font-medium">People at {app.companyMissing ? "this company" : app.company}</p>
        <p className="m-0 max-w-xs text-[13px] text-muted">Recruiters, the team, and people you have something in common with</p>
        <button type="button" className={primary} onClick={() => onRetry()}>Find people</button>
        {peopleNote && <p role="status" className="m-0 text-xs font-medium text-[#F5A524]">{peopleNote}</p>}
        <div className="w-full text-left empty:hidden"><PostedBy app={app} /></div>
      </div>
    );
  }
  if (app.contactsStatus === "finding" && !cutOff) return <div className={peopleCard}><PeopleSearching message={app.contactsMessage || `Searching for relevant people at ${app.company}…`} /></div>;
  const links = app.fillReport?.peopleLinks ?? {};
  return (
    <div className="h-full max-h-[32rem] space-y-3 overflow-y-auto rounded-xl border border-line bg-card px-4 pb-4 lg:max-h-none">
      {contacts.length > 0 ? (
        <div className="sticky top-0 z-10 flex items-center gap-3 bg-card py-3">
          <div aria-hidden className="flex">
            {contacts.slice(0, 4).map((contact, index) => (
              <span key={contact.id} style={floatDelay(index)} className={`people-float ${index ? "-ml-2.5" : ""}`}><Avatar name={contact.name} photoUrl={contact.photoUrl} className="h-9 w-9 border-[#3A3A44] text-[11px]" /></span>
            ))}
          </div>
          <h3 className="m-0 min-w-0 text-sm font-semibold">{contacts.length} {contacts.length === 1 ? "person" : "people"} at {app.company}</h3>
        </div>
      ) : <div className="h-1" />}
      <PostedBy app={app} />
      {app.contactsMessage && <p className="text-xs text-faint">{app.contactsMessage}</p>}
      <HowWeSearched app={app} />
      {noOne ? (
        <div className="flex flex-col gap-3 rounded-xl border border-line p-4 text-sm">
          <p className="m-0 font-medium">{cutOff || app.contactsStatus === "failed" ? "That search didn't finish." : `Try these for ${app.company}:`}</p>
          <div className="flex flex-wrap gap-2">
            {[["Recruiters", `recruiter ${app.company}`], ["People on the team", `${app.department || app.title} ${app.company}`], ...(school ? [[`${school} alumni`, `${school} ${app.company}`]] : [])].map(([label, keywords]) => (
              <a key={label} className="inline-flex items-center rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink hover:bg-white/5" href={`https://www.linkedin.com/search/results/people/?${new URLSearchParams({ keywords })}`} target="_blank" rel="noreferrer">{label} on LinkedIn ↗</a>
            ))}
            <button type="button" className={secondary} onClick={() => onRetry()}>Search again</button>
          </div>
          <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); onRetry(website.trim()); }}>
            <label className="text-xs text-muted" htmlFor={`site-${app.id}`}>Wrong company? Give its website:</label>
            <input id={`site-${app.id}`} value={website} onChange={(event) => setWebsite(event.target.value)} placeholder="acme.com" className="min-w-0 flex-1 basis-40 rounded-lg border border-line bg-card px-3 py-2 text-sm" />
            <button type="submit" className={secondary} disabled={!website.trim()}>Search this site</button>
          </form>
        </div>
      ) : app.contactsStatus === "failed" ? <button type="button" className={secondary} onClick={() => onRetry()}>Try again</button> : null}
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
              ) : hidden[contact.name.toLowerCase()] ? (
                revealsLeft ? (
                  <button type="button" className={secondary} disabled={showing !== ""} onClick={async () => { setShowing(contact.id); await onReveal(contact.id); setShowing(""); }}>{showing === contact.id ? "Looking…" : "Show person"}</button>
                ) : <span className="text-muted">You&apos;ve shown 3 people for this job</span>
              ) : <span className="text-muted">No email yet</span>}
              {contact.email && <button type="button" aria-label={`The email to ${contact.name} bounced`} title="Tell Unnepo this email bounced, so it gets fixed for everyone" className="text-[11px] text-faint underline-offset-4 hover:text-white hover:underline" onClick={() => onBounced(contact.id)}>Bounced?</button>}
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
            {!hidden[contact.name.toLowerCase()] && <EmailBox key={`${contact.id}:${contact.emailSubject ?? ""}:${contact.emailBody ?? ""}`} contact={contact} onEmail={onEmail} />}
          </article>
        );
      })}
    </div>
  );
}
