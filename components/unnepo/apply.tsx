"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ApplicationContact, ApplicationProfile, ApplicationQuestion, JobApplication, OutreachState } from "@/lib/apply/types";

const btn = "inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const primary = `${btn} bg-white text-black hover:bg-zinc-200`;
const secondary = `${btn} border border-line bg-transparent text-ink hover:bg-white/5`;
const field = "w-full rounded-xl border border-line bg-card px-3 py-2.5 text-sm text-ink outline-none placeholder:text-faint focus:border-zinc-500";
const card = "rounded-2xl border border-line bg-panel p-5 sm:p-6";
const labelClass = "mb-1.5 block text-xs font-medium text-muted";

type App = JobApplication & { missing: string[]; contacts?: ApplicationContact[] };
type ApplyData = {
  applications: App[];
  profile: ApplicationProfile;
  resume: { fileName: string; stored: boolean } | null;
  ready: { autofill: boolean; hunter: boolean; profile: boolean };
  applicationsPerCredit: number;
};

const STATUS: Record<JobApplication["status"], { label: string; tone: string }> = {
  extracted: { label: "Not applied yet", tone: "text-muted border-line" },
  filling: { label: "Filling…", tone: "text-sky-300 border-sky-900" },
  review: { label: "Waiting for your approval", tone: "text-amber-300 border-amber-900" },
  submitting: { label: "Submitting…", tone: "text-sky-300 border-sky-900" },
  submitted: { label: "Applied · confirmed", tone: "text-emerald-300 border-emerald-900" },
  unconfirmed: { label: "Not confirmed yet", tone: "text-amber-300 border-amber-900" },
  applied_manual: { label: "Applied (marked by you)", tone: "text-emerald-300 border-emerald-900" },
  failed: { label: "Needs attention", tone: "text-red-300 border-red-900" },
};

const ROLE_LABEL: Record<ApplicationContact["role"], string> = {
  job_poster: "Named on posting",
  recruiter: "Recruiter",
  hiring_manager: "Hiring manager",
  team_member: "Team",
};

const OUTREACH: Array<[OutreachState, string]> = [["not_contacted", "Not contacted"], ["emailed", "Emailed"], ["replied", "Replied"], ["no_response", "No response"]];

const SOURCE_LABEL: Record<string, string> = {
  profile: "From your profile",
  resume_file: "Your resume file",
  saved: "Your saved answer",
  student: "Your answer",
  ai: "AI, from your resume",
};

async function call<T>(path: string, method: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/apply${path}`, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Something went wrong (${response.status}).`);
  return payload as T;
}

function when(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
}

function StatusChip({ status }: { status: JobApplication["status"] }) {
  const item = STATUS[status];
  return <span className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs ${item.tone}`}>{item.label}</span>;
}

/** The two V1 pages share one data load: Apply to Job and Jobs Applied To. */
export function ApplyArea({ view, onNavigate, onCreditsChanged }: { view: "apply" | "applied"; onNavigate: (view: "apply" | "applied") => void; onCreditsChanged: () => void }) {
  const [data, setData] = useState<ApplyData | null>(null);
  const [error, setError] = useState("");
  const [currentId, setCurrentId] = useState<string | null>(null);

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
  }, [load]);

  const busy = useMemo(() => (data?.applications ?? []).some((app) => app.status === "filling" || app.status === "submitting" || app.contactsStatus === "finding" || app.contactsStatus === "writing"), [data]);
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => void load(), 4000);
    return () => clearInterval(timer);
  }, [busy, load]);

  const replace = useCallback((app: App) => {
    setData((previous) => {
      if (!previous) return previous;
      const known = previous.applications.some((item) => item.id === app.id);
      const applications = known ? previous.applications.map((item) => (item.id === app.id ? { ...item, ...app, contacts: item.contacts } : item)) : [app, ...previous.applications];
      return { ...previous, applications };
    });
  }, []);

  if (error && !data) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
        <p>{error}</p>
        <button type="button" className="rounded-lg border border-red-900/70 px-3 py-1 text-red-200" onClick={() => void load()}>Try again</button>
      </div>
    );
  }
  if (!data) return <p className="text-sm text-muted">Loading your applications…</p>;

  const current = data.applications.find((app) => app.id === currentId) ?? null;
  return view === "apply" ? (
    <ApplyPage
      data={data}
      current={current}
      error={error}
      onPick={setCurrentId}
      onChanged={(app) => { replace(app); setCurrentId(app.id); void load(); onCreditsChanged(); }}
      onProfile={(profile) => setData({ ...data, profile })}
      onDone={() => onNavigate("applied")}
    />
  ) : (
    <AppliedPage data={data} onReload={load} onContinue={(appId) => { setCurrentId(appId); onNavigate("apply"); }} />
  );
}

function ApplyPage({ data, current, error, onPick, onChanged, onProfile, onDone }: {
  data: ApplyData; current: App | null; error: string;
  onPick: (id: string | null) => void; onChanged: (app: App) => void; onProfile: (profile: ApplicationProfile) => void; onDone: () => void;
}) {
  const [url, setUrl] = useState("");
  const [reading, setReading] = useState(false);
  const [notice, setNotice] = useState("");
  const [problem, setProblem] = useState("");
  const inProgress = data.applications.filter((app) => ["extracted", "review", "unconfirmed", "failed", "filling", "submitting"].includes(app.status));

  async function read(event: React.FormEvent) {
    event.preventDefault();
    if (!url.trim()) return;
    setReading(true);
    setProblem("");
    setNotice("");
    try {
      const result = await call<{ application: App; duplicate: boolean; message: string }>("/applications", "POST", { url });
      onChanged(result.application);
      setNotice(result.message);
      setUrl("");
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : "Couldn't read that job.");
    } finally {
      setReading(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Apply to a job</h1>
        <p className="mt-2 text-sm text-muted">Paste a job link. Unnepo reads the posting, fills what it can from your profile, and asks you for the rest.</p>
      </div>
      <form onSubmit={read} className="flex flex-col gap-3 sm:flex-row">
        <input className={field} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://jobs.lever.co/company/…" inputMode="url" aria-label="Job posting link" />
        <button className={`${primary} shrink-0 px-5`} disabled={reading || !url.trim()}>{reading ? "Reading job…" : "Read job"}</button>
      </form>
      <p className="-mt-3 text-xs text-faint">Works best with Greenhouse, Lever, and Ashby links. LinkedIn and Indeed don&apos;t allow automated applications. Paste the company&apos;s own application link instead.</p>
      {problem && <p role="alert" className="rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">{problem}</p>}
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      {notice && <p className="text-sm text-muted">{notice}</p>}
      {!data.ready.autofill && (
        <p className="rounded-xl border border-line bg-card px-4 py-3 text-sm text-muted">Autofill isn&apos;t connected yet. You can still read jobs, prepare answers, apply on the company&apos;s site, and press <span className="text-ink">I applied</span> to find people and get emails.</p>
      )}
      {inProgress.length > 0 && !current && (
        <section className={card}>
          <h2 className="text-sm font-semibold">In progress</h2>
          <ul className="mt-3 divide-y divide-line">
            {inProgress.map((app) => (
              <li key={app.id} className="flex items-center justify-between gap-3 py-2.5">
                <button type="button" className="min-w-0 text-left" onClick={() => onPick(app.id)}>
                  <p className="truncate text-sm font-medium">{app.title}</p>
                  <p className="truncate text-xs text-muted">{app.company}</p>
                </button>
                <StatusChip status={app.status} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {current && <ApplicationCard key={current.id} app={current} data={data} onChanged={onChanged} onClose={() => onPick(null)} onDone={onDone} />}
      <ProfileDetails profile={data.profile} resume={data.resume} onSaved={onProfile} />
    </div>
  );
}

function ApplicationCard({ app, data, onChanged, onClose, onDone }: { app: App; data: ApplyData; onChanged: (app: App) => void; onClose: () => void; onDone: () => void }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [save, setSave] = useState<Set<string>>(new Set());
  const [working, setWorking] = useState("");
  const [problem, setProblem] = useState("");
  const [message, setMessage] = useState("");
  const [showReqs, setShowReqs] = useState(false);
  const editable = ["extracted", "review", "unconfirmed", "failed"].includes(app.status);
  const dirty = Object.keys(answers).length > 0;
  const missing = app.questions.filter((q) => q.required && !(answers[q.key] ?? q.answer ?? "").trim());

  async function run(name: string, path: string, method = "POST", body: Record<string, unknown> = { applicationId: app.id }) {
    setWorking(name);
    setProblem("");
    setMessage("");
    try {
      const result = await call<{ application?: App; message?: string }>(path, method, body);
      if (result.application) onChanged(result.application);
      if (result.message) setMessage(result.message);
      return true;
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : "That didn't work.");
      return false;
    } finally {
      setWorking("");
    }
  }

  async function saveAnswers() {
    if (await run("save", "/answers", "PATCH", { applicationId: app.id, answers, save: [...save] })) {
      setAnswers({});
      setSave(new Set());
    }
  }

  const done = app.status === "submitted" || app.status === "applied_manual";
  const live = app.fillReport?.liveViewUrl;
  return (
    <section className={`${card} space-y-5`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-tight">{app.title}</h2>
          <p className="mt-1 text-sm text-muted">{[app.company, app.department, app.location].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2"><StatusChip status={app.status} /><button type="button" aria-label="Close" className="text-faint hover:text-white" onClick={onClose}>✕</button></div>
      </div>
      {app.postedRecruiter && <p className="text-sm text-muted">Posting names <span className="text-ink">{app.postedRecruiter.name}</span>{app.postedRecruiter.title ? `, ${app.postedRecruiter.title}` : ""}.</p>}
      {app.requirements.length > 0 && (
        <div>
          <button type="button" className="text-sm text-muted underline-offset-4 hover:text-white hover:underline" onClick={() => setShowReqs(!showReqs)}>{showReqs ? "Hide" : "Show"} {app.requirements.length} requirements</button>
          {showReqs && <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">{app.requirements.map((item) => <li key={item}>{item}</li>)}</ul>}
        </div>
      )}
      {app.statusMessage && <p className="rounded-xl bg-card px-4 py-3 text-sm text-zinc-300">{app.statusMessage}</p>}

      {app.questions.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Application questions</h3><span className="text-xs text-faint">{missing.length ? `${missing.length} required left` : "All required answered"}</span></div>
          {app.questions.map((question) => (
            <QuestionField
              key={question.key}
              question={question}
              value={answers[question.key] ?? question.answer ?? ""}
              disabled={!editable}
              saveChecked={save.has(question.key)}
              onChange={(value) => setAnswers((prev) => ({ ...prev, [question.key]: value }))}
              onSaveToggle={() => setSave((prev) => { const next = new Set(prev); if (next.has(question.key)) next.delete(question.key); else next.add(question.key); return next; })}
            />
          ))}
          {editable && <button type="button" className={secondary} disabled={!dirty || Boolean(working)} onClick={() => void saveAnswers()}>{working === "save" ? "Saving…" : "Save answers"}</button>}
        </div>
      )}

      {(app.status === "review" || app.status === "unconfirmed") && app.fillReport && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Check the filled form</h3>
          {live ? (
            <iframe title="Live application browser" src={live} className="h-[560px] w-full rounded-xl border border-line bg-black" sandbox="allow-same-origin allow-scripts" allow="clipboard-read; clipboard-write" />
          ) : <p className="text-sm text-muted">The live view isn&apos;t available for this session.</p>}
          {app.fillReport.failed.length > 0 && (
            <div className="rounded-xl border border-amber-900/60 bg-amber-950/20 p-3 text-sm">
              <p className="font-medium text-amber-200">Finish these in the live view</p>
              <ul className="mt-1 list-disc pl-5 text-amber-100/80">{app.fillReport.failed.map((item) => <li key={item.label}>{item.label}: {item.reason}</li>)}</ul>
            </div>
          )}
          <p className="text-xs text-faint">Unnepo doesn&apos;t solve CAPTCHAs. If one appears, complete it in the live view.</p>
        </div>
      )}

      {problem && <p role="alert" className="text-sm text-red-300">{problem}</p>}
      {message && <p className="text-sm text-muted">{message}</p>}

      <div className="flex flex-wrap gap-2 border-t border-line pt-4">
        {(app.status === "extracted" || app.status === "failed") && (
          <button type="button" className={primary} disabled={!data.ready.autofill || dirty || missing.length > 0 || Boolean(working)} title={!data.ready.autofill ? "Autofill isn't connected yet" : missing.length ? "Answer the required questions first" : dirty ? "Save your answers first" : undefined} onClick={() => void run("fill", "/autofill")}>
            {working === "fill" ? "Filling the form… (up to a minute)" : "Autofill application"}
          </button>
        )}
        {app.status === "review" && (
          <button type="button" className={primary} disabled={Boolean(working)} onClick={() => { if (window.confirm(`Submit your application for ${app.title} at ${app.company}? Check the form in the live view first.`)) void run("submit", "/submit"); }}>
            {working === "submit" ? "Submitting…" : "Approve & submit"}
          </button>
        )}
        {(app.status === "unconfirmed" || app.status === "review") && app.browserSessionId && (
          <button type="button" className={secondary} disabled={Boolean(working)} onClick={() => void run("check", "/check")}>{working === "check" ? "Checking…" : "Check again"}</button>
        )}
        {app.applicationUrl && !done && <a className={secondary} href={app.applicationUrl} target="_blank" rel="noreferrer">Open application form ↗</a>}
        {!done && !["filling", "submitting"].includes(app.status) && (
          <button type="button" className={secondary} disabled={Boolean(working)} onClick={() => { if (window.confirm("Mark this job as applied? Only do this if you submitted the application yourself.")) void run("applied", "/applied"); }}>I applied</button>
        )}
        {done && <button type="button" className={primary} onClick={onDone}>See people to email →</button>}
      </div>
    </section>
  );
}

function QuestionField({ question, value, disabled, saveChecked, onChange, onSaveToggle }: { question: ApplicationQuestion; value: string; disabled: boolean; saveChecked: boolean; onChange: (value: string) => void; onSaveToggle: () => void }) {
  const id = `q-${question.key}`;
  const source = question.source ? SOURCE_LABEL[question.source] : null;
  const changed = value !== (question.answer ?? "");
  return (
    <div>
      <label htmlFor={id} className={labelClass}>{question.label}{question.required && <span className="text-red-300"> *</span>}</label>
      {question.kind === "file" ? (
        <p className="rounded-xl border border-line bg-card px-3 py-2.5 text-sm text-muted">{question.answer ? `📎 ${question.answer}` : question.required ? "Upload a resume in Settings first." : "Optional. Not attached."}</p>
      ) : question.options.length > 0 ? (
        <select id={id} className={field} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
          <option value="">Choose…</option>
          {question.options.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      ) : question.kind === "textarea" ? (
        <textarea id={id} className={`${field} min-h-24`} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input id={id} className={field} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
      )}
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-faint">
        {question.sensitive && !question.answer && <span>Only you can answer this one.</span>}
        {source && !changed && <span>{source}</span>}
        {question.source === "ai" && question.evidence && !changed && <span className="italic">“{question.evidence}”</span>}
        {question.kind !== "file" && !disabled && changed && value.trim() && (
          <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={saveChecked} onChange={onSaveToggle} /> Save for future applications</label>
        )}
      </div>
    </div>
  );
}

function ProfileDetails({ profile, resume, onSaved }: { profile: ApplicationProfile; resume: ApplyData["resume"]; onSaved: (profile: ApplicationProfile) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(profile);
  const [state, setState] = useState("");
  const fields: Array<[keyof ApplicationProfile, string]> = [["firstName", "First name"], ["lastName", "Last name"], ["email", "Email for applications"], ["phone", "Phone"], ["linkedin", "LinkedIn URL"], ["website", "Website or portfolio"], ["github", "GitHub URL"], ["city", "City"]];
  async function save() {
    setState("Saving…");
    try {
      const result = await call<{ profile: ApplicationProfile }>("/profile", "PUT", draft);
      onSaved(result.profile);
      setState("Saved. New jobs will use these details.");
    } catch (reason) {
      setState(reason instanceof Error ? reason.message : "Couldn't save.");
    }
  }
  return (
    <section className={card}>
      <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => { setDraft(profile); setOpen(!open); }}>
        <span>
          <span className="block text-sm font-semibold">Your application details</span>
          <span className="block text-xs text-muted">Used to fill forms. Resume: {resume ? resume.fileName : "none uploaded"}</span>
        </span>
        <span className="text-faint">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {fields.map(([key, title]) => (
              <div key={key}>
                <label className={labelClass} htmlFor={`profile-${key}`}>{title}</label>
                <input id={`profile-${key}`} className={field} value={String(draft[key] ?? "")} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} />
              </div>
            ))}
          </div>
          <p className="text-xs text-faint">Phone, LinkedIn, and GitHub are pulled from your resume when it lists them. Unnepo never makes up details.</p>
          <div className="flex items-center gap-3"><button type="button" className={primary} onClick={() => void save()}>Save details</button>{state && <span className="text-xs text-muted">{state}</span>}</div>
        </div>
      )}
    </section>
  );
}

function AppliedPage({ data, onReload, onContinue }: { data: ApplyData; onReload: () => Promise<void>; onContinue: (id: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [problem, setProblem] = useState("");
  const apps = data.applications;
  async function act(path: string, method: string, body: unknown) {
    setProblem("");
    try {
      await call(path, method, body);
      await onReload();
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : "That didn't work.");
    }
  }
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Jobs applied to</h1>
        <p className="mt-2 text-sm text-muted">Open an application to see up to five people to email and a ready-to-copy message for each.</p>
      </div>
      {problem && <p role="alert" className="text-sm text-red-300">{problem}</p>}
      {apps.length === 0 ? (
        <div className={`${card} text-sm text-muted`}>No applications yet. Paste a job link on Apply to Job to start.</div>
      ) : (
        <ul className="overflow-hidden rounded-2xl border border-line">
          {apps.map((app) => {
            const expanded = open === app.id;
            const applied = app.status === "submitted" || app.status === "applied_manual";
            return (
              <li key={app.id} className="border-b border-line last:border-b-0">
                <button type="button" className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3.5 text-left hover:bg-white/[0.03] sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_7rem_auto]" onClick={() => setOpen(expanded ? null : app.id)} aria-expanded={expanded}>
                  <span className="min-w-0"><span className="block truncate font-medium">{app.company}</span><span className="block truncate text-sm text-muted sm:hidden">{app.title}</span></span>
                  <span className="hidden truncate text-sm text-muted sm:block">{app.title}</span>
                  <span className="hidden text-sm text-muted sm:block">{when(app.submittedAt ?? app.createdAt)}</span>
                  <StatusChip status={app.status} />
                </button>
                {expanded && (
                  <div className="space-y-4 border-t border-line bg-card/40 px-4 py-4">
                    {!applied ? (
                      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
                        <p>People are found after you apply.</p>
                        <button type="button" className={secondary} onClick={() => onContinue(app.id)}>Continue application</button>
                      </div>
                    ) : (
                      <ContactsPanel app={app} onStatus={(contactId, status) => void act("/contact", "PATCH", { contactId, status })} onRetry={() => void act("/retry-contacts", "POST", { applicationId: app.id })} />
                    )}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-xs text-faint">
                      <span>{app.status === "submitted" && app.confirmation ? `Confirmed by the site: “${app.confirmation.text.slice(0, 120)}”` : app.status === "applied_manual" ? "Marked applied by you. Unnepo didn't see the confirmation." : app.statusMessage}</span>
                      <span className="flex gap-3">
                        <a className="hover:text-white" href={app.jobUrl} target="_blank" rel="noreferrer">Job posting ↗</a>
                        <button type="button" className="hover:text-red-300" onClick={() => { if (window.confirm(`Remove ${app.title} at ${app.company} and its contacts from your list?`)) void act("/applications", "DELETE", { applicationId: app.id }); }}>Remove</button>
                      </span>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
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
                {contact.photoUrl ? <img src={contact.photoUrl} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" /> : <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-card text-sm text-muted">{contact.name.slice(0, 1)}</span>}
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
              {contact.linkedinUrl && <a className="text-xs text-muted hover:text-white" href={contact.linkedinUrl} target="_blank" rel="noreferrer">LinkedIn ↗</a>}
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
