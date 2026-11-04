"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ApplyData } from "@/components/unnepo/apply";
import { EmailTracking } from "@/components/unnepo/email-tracking";
import { FollowUpFacts } from "@/components/unnepo/follow-up-facts";
import { stageOf } from "@/lib/apply/stats";
import { spiderSvg, wornSkin } from "@/lib/spiders";

/**
 * The Setup tab: three parts, one on screen at a time, picked from the pills at the top. It opens on the first one
 * left to do. The parts are Autofill answers, Email tracking and Follow-up contacts.
 */

type Part = "answers" | "email" | "people";
const PARTS: Array<{ id: Part; label: string }> = [{ id: "answers", label: "Autofill answers" }, { id: "email", label: "Email tracking" }, { id: "people", label: "Follow-up contacts" }];
const heading = "m-0 text-[32px] font-extrabold leading-[1.05] tracking-[-1.2px] sm:text-[40px] sm:tracking-[-1.4px]";
const intro = "m-0 max-w-[640px] text-base leading-normal text-[#9A9AA3]";
const card = "flex min-w-0 flex-col gap-4 rounded-[20px] border border-[#26262C] bg-[#0C0C0E] p-5 sm:p-7";
const nextButton = "h-11 self-start rounded-[11px] bg-[#F7F7F8] px-[18px] text-sm font-semibold text-[#070708] hover:bg-white";

async function call<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`/api/apply${path}`, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Something went wrong (${response.status}).`);
  return payload as T;
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
  const [email, setEmail] = useState<{ received: boolean; toReview: number } | null>(null);
  const [picked, setPicked] = useState<Part | null>(null);
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

  const done: Record<Part, boolean> = { answers: Boolean(data.ready.profile), email: Boolean(email?.received), people: Boolean(autoPeople) || (applied.length > 0 && noPeople.length === 0) };
  // Waits for the email state, so it doesn't open on Email tracking and then jump past it.
  const opening: Part | null = !email ? null : email.toReview ? "email" : PARTS.find((item) => !done[item.id])?.id ?? "answers";
  const part = picked ?? opening;
  const open = (next: Part) => { setPicked(next); window.scrollTo({ top: 0 }); };
  const look = { skin: wornSkin(data.profile.spiderSkin ?? null, applied.length), school: data.school };
  const spider = spiderSvg(look, { size: 80 });
  const answers = Object.entries(data.profile.saved ?? {});
  const shownAnswers = showAll ? answers : answers.slice(0, 6);
  const check = "mt-0.5 h-4 w-4 flex-none accent-[#3D8BFF]";
  const toggleLabel = "flex items-start gap-2.5 text-[13px] leading-normal text-[#9A9AA3]";

  return (
    <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-7 pt-4 sm:pt-8">
      <nav aria-label="Setup" className="flex flex-wrap gap-2 text-[13px]">
        {PARTS.map((item, index) => {
          const now = part === item.id;
          return (
            <button key={item.id} type="button" aria-current={now ? "step" : undefined} onClick={() => open(item.id)} className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 hover:text-white ${now ? "border-[#3D8BFF] text-[#F7F7F8]" : done[item.id] ? "border-[#26262C] text-[#9A9AA3]" : "border-[#26262C] text-[#8B8B94]"}`}>
              {done[item.id] ? <span className="text-[#4ADE80]">✓<span className="sr-only"> Done:</span></span> : <span className={`font-mono ${now ? "text-[#3D8BFF]" : ""}`}>{index + 1}</span>}
              {item.label}
              {item.id === "email" && Boolean(email?.toReview) && <span className="text-[#F5A524]">{email?.toReview} to review</span>}
            </button>
          );
        })}
      </nav>
      {note && <p role="status" className="m-0 text-sm text-[#9A9AA3]">{note}</p>}
      {problem && <p role="alert" className="m-0 text-sm text-red-300">{problem}</p>}
      {!part && <p className="m-0 text-sm text-muted">Loading your setup…</p>}

      {part === "answers" && (
        <>
          <div className="flex flex-col gap-2">
            <h1 className={heading}>Fill every form from one set of answers.</h1>
            <p className={intro}>What the extension types into applications. Edit any answer and it&apos;s used on the next form. <a href="/demo" className="text-[#F7F7F8] underline underline-offset-4 hover:text-white">See it in action</a></p>
          </div>
          <section className={card} aria-label="Autofill answers">
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#26262C] bg-[#070708] px-3.5 py-3">
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
            <button type="button" onClick={() => open("email")} className={nextButton}>Next: email tracking →</button>
          </section>
        </>
      )}

      {/* Stays mounted on the other parts: it reports the pill's state and keeps its place in the wizard. */}
      <div hidden={part !== "email"}>
        <EmailTracking applyEmail={data.profile.email} spider={spider} onState={setEmail} onNext={() => open("people")} />
      </div>

      {part === "people" && (
        <>
          <div className="flex flex-col gap-2">
            <h1 className={heading}>Know who to follow up with.</h1>
            <p className={intro}>Unnepo looks up the company&apos;s email format, finds recruiters and the team behind the role, and drafts a short note you send from your own inbox.</p>
          </div>
          <section className={card} aria-label="Follow-up contacts">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <p className="m-0 text-[28px] font-bold leading-tight tracking-[-1px] tabular-nums">{followed} <span className="text-[15px] font-medium tracking-normal text-[#8B8B94]">of {applied.length} followed up</span></p>
              {applied.length > 0 && <FollowUpFacts applied={applied} school={data.school} onOpen={onOpenJob} />}
            </div>
            <label className={toggleLabel}>
              <input type="checkbox" className={check} checked={Boolean(autoPeople)} onChange={(event) => void toggle({ autoFindPeople: event.target.checked })} />
              <span>Find people as soon as a job is marked applied, so the list is ready when I open it. 1 credit per job, only when someone with an email is found.</span>
            </label>
            {noPeople.length > 0 && <button type="button" disabled={finding} onClick={() => void findForAll()} className={`${nextButton} disabled:opacity-50`}>{finding ? "Starting…" : `Find people for ${noPeople.length} ${noPeople.length === 1 ? "job" : "jobs"}`}</button>}
          </section>
        </>
      )}
    </div>
  );
}
