"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ApplyData } from "@/components/unnepo/apply";
import { EmailTracking } from "@/components/unnepo/email-tracking";
import { FollowUpFacts } from "@/components/unnepo/follow-up-facts";
import { stageOf } from "@/lib/apply/stats";
import { spiderSvg, wornSkin } from "@/lib/spiders";

/**
 * The Setup tab: how Unnepo works, then a thread with three steps that fills as each is done, with the spider at
 * the first one left. The steps are Autofill answers, Email tracking and Follow-up contacts.
 */

type Status = "done" | "next" | "later";
const ACCENT = "#3D8BFF";

async function call<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`/api/apply${path}`, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Something went wrong (${response.status}).`);
  return payload as T;
}

function Step({ id, number, title, status, tag, tagColor, intro, spider, children }: { id: string; number: number; title: string; status: Status; tag?: string; tagColor?: string; intro: string; spider: string; children: ReactNode }) {
  const current = status === "next";
  return (
    <section aria-labelledby={id} className={`relative flex min-w-0 flex-col gap-4 rounded-2xl border p-4 sm:p-6 ${current ? "border-[#3D8BFF] bg-[#0C0C0E]" : "border-[#1F1F24]"}`}>
      {current ? (
        <div aria-hidden className="dash-bob absolute -left-[46px] top-3 h-[30px] w-10 sm:-left-[68px]" dangerouslySetInnerHTML={{ __html: spider }} />
      ) : status === "done" ? (
        <span aria-hidden className="absolute -left-[41px] top-[22px] flex h-[30px] w-[30px] items-center justify-center rounded-full bg-[#3D8BFF] text-white sm:-left-[63px]">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg>
        </span>
      ) : (
        <span aria-hidden className="absolute -left-[41px] top-[22px] flex h-[30px] w-[30px] items-center justify-center rounded-full border-2 border-[#26262C] bg-[#070708] text-xs font-semibold text-[#8B8B94] sm:-left-[63px]">{number}</span>
      )}
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id={id} className="m-0 text-xl font-bold">{number}. {title}</h2>
        <span className="font-mono text-[11px] uppercase tracking-[1.2px]" style={{ color: tagColor ?? (status === "done" ? "#4ADE80" : current ? ACCENT : "#8B8B94") }}>{tag ?? (status === "done" ? "Done" : current ? "Next" : "To do")}</span>
      </div>
      <p className="m-0 text-sm leading-normal text-[#9A9AA3]">{intro}</p>
      {children}
    </section>
  );
}

/** One saved answer: what the extension types when a form asks this question. */
function SavedAnswer({ itemKey, label, answer, onSave }: { itemKey: string; label: string; answer: string; onSave: (key: string, answer: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(answer);
  const [state, setState] = useState("");
  async function save() {
    setState("Saving…");
    try {
      await onSave(itemKey, draft);
      setEditing(false);
      setState("");
    } catch (reason) {
      setState(reason instanceof Error ? reason.message : "Couldn't save.");
    }
  }
  if (editing) {
    return (
      <form className="flex flex-col gap-2 border-t border-[#17171B] py-3" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <label className="text-[13px] text-[#9A9AA3]" htmlFor={`answer-${itemKey}`}>{label}</label>
        <textarea id={`answer-${itemKey}`} rows={3} maxLength={4000} value={draft} onChange={(event) => setDraft(event.target.value)} className="w-full rounded-lg border border-[#26262C] bg-[#070708] px-3 py-2 text-[13px] text-ink outline-none focus:border-[#3D8BFF]" />
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className="h-8 rounded-lg bg-[#F7F7F8] px-3 text-xs font-semibold text-[#070708] hover:bg-white">Save</button>
          <button type="button" className="h-8 px-2 text-xs text-[#9A9AA3] hover:text-white" onClick={() => { setEditing(false); setDraft(answer); setState(""); }}>Cancel</button>
          {state && <span role="status" className="text-xs text-[#9A9AA3]">{state}</span>}
        </div>
      </form>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[#17171B] py-3 sm:flex-nowrap">
      <span className="min-w-0 flex-1 basis-full text-[13px] text-[#9A9AA3] sm:basis-1/2">{label}</span>
      <span className="min-w-0 flex-1 basis-40 truncate text-[13px] sm:basis-1/2">{answer}</span>
      <button type="button" aria-label={`Edit your answer to: ${label}`} className="h-8 px-2.5 text-xs font-medium text-[#B4B4BC] hover:text-white" onClick={() => { setDraft(answer); setEditing(true); }}>Edit</button>
    </div>
  );
}

type SetupProps = {
  resume: { fileName: string } | null;
  completeness: number;
  resumeBusy: boolean;
  onReplaceResume: (file: File) => void;
  onEditProfile: () => void;
  onOpenJob: (appId: string) => void;
  refreshKey: number;
};

export function SetupPage({ resume, completeness, resumeBusy, onReplaceResume, onEditProfile, onOpenJob, refreshKey }: SetupProps) {
  const [data, setData] = useState<ApplyData | null>(null);
  const [problem, setProblem] = useState("");
  const [note, setNote] = useState("");
  const [email, setEmail] = useState({ forwarded: false, toReview: 0 });
  const [finding, setFinding] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const load = useCallback(async () => {
    try {
      setData(await call<ApplyData>(""));
      setProblem("");
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : "Couldn't load your setup.");
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- first load of server data
    void load();
  }, [load, refreshKey]);

  const applied = useMemo(() => (data?.applications ?? []).filter((app) => app.status === "submitted" || app.status === "applied_manual"), [data]);
  const followed = applied.filter((app) => (app.contacts ?? []).some((contact) => contact.outreachStatus !== "not_contacted")).length;
  const noPeople = applied.filter((app) => stageOf(app) !== "in_progress" && !app.companyMissing && app.contactsStatus === "idle" && !app.contacts?.length);
  const consent = Boolean(data?.profile.accountConsentAt);
  // Paid plans look for people on applying unless turned off; Free only when turned on.
  const autoPeople = data?.plan && data.plan !== "free" ? data.profile.autoFindPeople !== false : data?.profile.autoFindPeople === true;

  if (!data) return problem ? <p role="alert" className="text-sm text-red-300">{problem}</p> : <p className="text-sm text-muted">Loading your setup…</p>;

  async function saveProfile(change: Record<string, unknown>) {
    const result = await call<{ profile: ApplyData["profile"] }>("/profile", "PUT", change);
    setData((previous) => (previous ? { ...previous, profile: result.profile } : previous));
  }
  async function toggle(change: Record<string, unknown>) {
    setNote("Saving…");
    try {
      await saveProfile(change);
      setNote("Saved.");
    } catch (reason) {
      setNote(reason instanceof Error ? reason.message : "Couldn't save.");
    }
  }
  async function findForAll() {
    const count = noPeople.length;
    if (!window.confirm(`Find people for ${count} ${count === 1 ? "job" : "jobs"}? This uses up to ${count} ${count === 1 ? "credit" : "credits"}: 1 per job, only when someone with an email is found.`)) return;
    setFinding(true);
    setNote("");
    let started = 0;
    try {
      for (const app of noPeople) {
        await call("/retry-contacts", "POST", { applicationId: app.id });
        started += 1;
      }
      setNote(`Looking for people at ${started} ${started === 1 ? "company" : "companies"}. They'll show up on Home.`);
    } catch (reason) {
      setNote(`${started ? `Started ${started}, then stopped: ` : ""}${reason instanceof Error ? reason.message : "That didn't work."}`);
    } finally {
      setFinding(false);
      await load();
    }
  }

  const statusDone = [Boolean(data.ready.profile), email.forwarded, autoPeople || (applied.length > 0 && noPeople.length === 0)];
  const doneCount = statusDone.filter(Boolean).length;
  const first = statusDone.indexOf(false);
  const status = (index: number): Status => (statusDone[index] ? "done" : index === first ? "next" : "later");
  const look = { skin: wornSkin(data.profile.spiderSkin ?? null, applied.length), school: data.school };
  const spider = spiderSvg(look, { size: 40 });
  const answers = Object.entries(data.profile.saved ?? {});
  const shownAnswers = showAll ? answers : answers.slice(0, 6);
  const check = "mt-0.5 h-4 w-4 flex-none accent-[#3D8BFF]";
  const toggleLabel = "flex items-start gap-2.5 text-[13px] leading-normal text-[#9A9AA3]";

  return (
    <div className="mx-auto flex w-full max-w-[960px] flex-col gap-10 pt-4 sm:pt-8">
      <div className="flex flex-col gap-3">
        <span className="font-mono text-xs uppercase tracking-[2px] text-[#8B8B94]">Setup · {doneCount} of 3 done</span>
        <h1 className="m-0 text-4xl font-extrabold leading-none tracking-[-1.6px] sm:text-[44px]">Spin your web once.<br /><span style={{ color: ACCENT }}>Unnepo does the rest.</span></h1>
        <p className="m-0 max-w-[620px] text-base leading-relaxed text-[#9A9AA3]">How it works: the extension fills applications from your answers, forwarded emails keep each job&apos;s stage up to date, and Unnepo finds the people to follow up with. <a href="/demo" className="text-[#F7F7F8] underline underline-offset-4 hover:text-white">See it in action</a></p>
      </div>
      {note && <p role="status" className="m-0 text-sm text-[#9A9AA3]">{note}</p>}
      {problem && <p role="alert" className="m-0 text-sm text-red-300">{problem}</p>}

      <div className="relative flex flex-col gap-7 pl-[50px] sm:pl-[72px]">
        <div aria-hidden className="absolute bottom-2 left-[23px] top-2 w-0.5 bg-[#26262C]" />
        <div aria-hidden className="absolute left-[23px] top-2 w-0.5 transition-[height] motion-reduce:transition-none" style={{ height: `calc((100% - 16px) * ${doneCount / 3})`, background: ACCENT }} />

        <Step id="setup-answers" number={1} title="Autofill answers" status={status(0)} spider={spider} intro="What the extension types into applications. Edit any answer and it's used on the next form.">
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#26262C] bg-[#0C0C0E] px-3.5 py-3">
            <span className="min-w-0 flex-1 basis-48 text-sm">{resume?.fileName ?? "No resume yet"} <span className="text-[#8B8B94]">· profile {completeness}% ready</span></span>
            <span className="flex flex-wrap items-center gap-2">
              <label className={`inline-flex h-[34px] cursor-pointer items-center rounded-[9px] border border-[#26262C] px-3 text-[13px] font-medium hover:bg-white/5 focus-within:outline focus-within:outline-2 focus-within:outline-[#3D8BFF] ${resumeBusy ? "pointer-events-none opacity-60" : ""}`}>
                {resumeBusy ? "Uploading…" : resume ? "Replace resume" : "Attach resume"}
                <input type="file" className="sr-only" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" disabled={resumeBusy} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) onReplaceResume(file); }} />
              </label>
              <button type="button" onClick={onEditProfile} className="h-[34px] rounded-[9px] border border-[#26262C] px-3 text-[13px] font-medium hover:bg-white/5">Edit my info</button>
            </span>
          </div>
          {answers.length ? (
            <div className="flex flex-col">
              {shownAnswers.map(([key, item]) => <SavedAnswer key={key} itemKey={key} label={item.label} answer={item.answer} onSave={(answerKey, answer) => saveProfile({ savedAnswer: { key: answerKey, answer } })} />)}
              {answers.length > 6 && <button type="button" onClick={() => setShowAll((on) => !on)} className="self-start border-t-0 py-2 text-xs text-[#9A9AA3] underline-offset-4 hover:text-white hover:underline">{showAll ? "Show fewer" : `Show all ${answers.length}`}</button>}
            </div>
          ) : <p className="m-0 text-[13px] text-[#8B8B94]">No saved answers yet. Questions you answer on application forms show up here.</p>}
          <label className={toggleLabel}>
            <input type="checkbox" className={check} checked={consent} onChange={(event) => void toggle({ accountConsent: event.target.checked })} />
            <span>Accept job sites&apos; terms, privacy notices, and acknowledgements on my behalf when an application asks. Arbitration, background-check, and non-compete agreements are always left for me, and Unnepo never opts me into marketing.</span>
          </label>
        </Step>

        <Step id="setup-email" number={2} title="Email tracking" status={status(1)} spider={spider} tag={email.toReview ? `${email.toReview} to review` : undefined} tagColor={email.toReview ? "#F5A524" : undefined} intro="Keep applying with your own email. Forward job emails to your Unnepo address and each application's stage updates on its own.">
          <EmailTracking onState={setEmail} />
        </Step>

        <Step id="setup-people" number={3} title="Follow-up contacts" status={status(2)} spider={spider} intro="Unnepo looks up the company's email format, finds recruiters and the team behind the role, and drafts a short note you send from your own inbox.">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <p className="m-0 text-[28px] font-bold leading-tight tracking-[-1px] tabular-nums">{followed} <span className="text-[15px] font-medium tracking-normal text-[#8B8B94]">of {applied.length} followed up</span></p>
            {applied.length > 0 && <FollowUpFacts applied={applied} school={data.school} onOpen={onOpenJob} />}
          </div>
          <label className={toggleLabel}>
            <input type="checkbox" className={check} checked={Boolean(autoPeople)} onChange={(event) => void toggle({ autoFindPeople: event.target.checked })} />
            <span>Find people as soon as a job is marked applied, so the list is ready when I open it. 1 credit per job, only when someone with an email is found.</span>
          </label>
          {noPeople.length > 0 && <button type="button" disabled={finding} onClick={() => void findForAll()} className="h-11 self-start rounded-[11px] bg-[#F7F7F8] px-[18px] text-sm font-semibold text-[#070708] hover:bg-white disabled:opacity-50">{finding ? "Starting…" : `Find people for ${noPeople.length} ${noPeople.length === 1 ? "job" : "jobs"}`}</button>}
        </Step>
      </div>
    </div>
  );
}
