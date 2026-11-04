"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AddressRow, CopyButton, EmailWizard, guessProvider, type Progress, type Provider } from "@/components/unnepo/email-wizard";

/**
 * The Email tracking part of Setup. Until forwarding is set up, the step-by-step wizard. After that: the student's
 * address, the Review Inbox for what Unnepo wasn't sure about, a box to paste an email by hand, and what emails
 * changed lately. Where they are in the wizard is kept in this browser, so going off to Gmail or reloading keeps it.
 */

type Named = { id: string; title: string; company: string };
type Item = {
  id: string; at: string; kind: string; company: string; jobTitle: string | null; confidence: number; summary: string;
  outcome: string; reason: "low_confidence" | "several_matches" | "no_match" | null; source: "forward" | "paste";
  application: Named | null; candidates: Named[];
};
export type State = {
  address: string; ready: boolean; forwarded: boolean;
  lastEmail: { id: string; at: string; outcome: string; company: string; jobTitle: string | null; summary: string } | null;
  gmailQuery: string; atsDomains: string[]; phrases: string[];
  verification: { provider: "gmail" | "outlook"; code: string | null; link: string | null; at: string } | null;
  review: Item[]; recent: Item[]; applications: Named[];
  skipped: { read: Array<{ id: string; at: string; summary: string }>; dropped: number; droppedAt: string | null };
};

const btn = "inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const primary = `${btn} bg-white text-black hover:bg-zinc-200`;
const secondary = `${btn} border border-line bg-transparent text-ink hover:bg-white/5`;
const part = "flex flex-col gap-3 rounded-2xl border border-[#1F1F24] p-5";
const partTitle = "m-0 text-sm font-semibold";

async function call<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`/api/email${path}`, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Something went wrong (${response.status}).`);
  return payload as T;
}

const KIND: Record<string, string> = { applied: "Applied", incomplete: "Not finished", interview: "Interview", assessment: "Assessment", offer: "Offer", rejected: "Rejected", not_job_related: "Not about a job" };
const REASON: Record<string, string> = {
  low_confidence: "Unnepo wasn't sure what this email says.",
  several_matches: "More than one of your applications fits. Pick the right one.",
  no_match: "No saved application matches. Approve to save it as a new one, or pick one.",
};
const when = (at: string) => new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" });

function ReviewItem({ item, applications, onDone }: { item: Item; applications: Named[]; onDone: () => Promise<void> }) {
  const [picking, setPicking] = useState(false);
  const [choice, setChoice] = useState(item.candidates[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const act = async (action: "approve" | "pick" | "dismiss") => {
    setBusy(true);
    setProblem("");
    try {
      await call("/review", "POST", { eventId: item.id, action, ...(action === "pick" ? { applicationId: choice } : {}) });
      await onDone();
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  };
  // The jobs it could be first, then every other open application.
  const options = [...item.candidates, ...applications.filter((app) => !item.candidates.some((candidate) => candidate.id === app.id))];
  const readable = item.kind !== "not_job_related" && Boolean(item.company);
  return (
    <li className="flex flex-col gap-2 border-t border-[#17171B] py-3 first:border-t-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="m-0 text-sm font-medium">{item.summary || "An email Unnepo couldn't read."}</p>
        <span className="text-xs text-faint tabular-nums">{when(item.at)} · {Math.round(item.confidence * 100)}% sure</span>
      </div>
      <p className="m-0 text-xs text-muted">{[KIND[item.kind] ?? item.kind, item.company, item.jobTitle].filter(Boolean).join(" · ")}{item.reason ? ` — ${REASON[item.reason]}` : ""}</p>
      {picking ? (
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={`pick-${item.id}`}>Application</label>
          <select id={`pick-${item.id}`} value={choice} onChange={(event) => setChoice(event.target.value)} className="min-w-0 max-w-full rounded-lg border border-line bg-card px-2.5 py-2 text-sm">
            <option value="">Choose an application…</option>
            {options.map((app) => <option key={app.id} value={app.id}>{app.company} — {app.title}</option>)}
          </select>
          <button type="button" className={primary} disabled={busy || !choice || !readable} onClick={() => void act("pick")}>Use this one</button>
          <button type="button" className={secondary} onClick={() => setPicking(false)}>Cancel</button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={primary} disabled={busy || !readable || item.reason === "several_matches"} onClick={() => void act("approve")} title={item.reason === "several_matches" ? "More than one application fits: pick one" : undefined}>Approve</button>
          <button type="button" className={secondary} disabled={busy || !readable || !options.length} onClick={() => setPicking(true)}>Pick application</button>
          <button type="button" className={secondary} disabled={busy} onClick={() => void act("dismiss")}>Skip</button>
        </div>
      )}
      {problem && <p role="alert" className="m-0 text-xs text-red-300">{problem}</p>}
    </li>
  );
}

function PasteBox({ focus, onDone }: { focus?: boolean; onDone: () => Promise<void> }) {
  const [pasted, setPasted] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <section className={part} aria-labelledby="paste">
      <h3 id="paste" className={partTitle}>Paste an email</h3>
      <p className="m-0 text-[13px] text-[#9A9AA3]">For an older email, or one that wasn&apos;t forwarded. Include the From and Subject lines if you can.</p>
      <form
        className="flex flex-col gap-3"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setNote("");
          try {
            const result = await call<{ message: string }>("/paste", "POST", { text: pasted });
            setNote(result.message);
            setPasted("");
            await onDone();
          } catch (reason) {
            setNote(reason instanceof Error ? reason.message : "Couldn't read it.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="sr-only" htmlFor="paste-email">Email</label>
        <textarea id="paste-email" autoFocus={focus} rows={5} value={pasted} onChange={(event) => setPasted(event.target.value)} maxLength={30000} placeholder={"From: Acme Careers <no-reply@myworkday.com>\nSubject: Thank you for applying\n\nThank you for applying to the Data Analyst Intern role…"} className="w-full rounded-lg border border-[#26262C] bg-[#070708] px-3 py-2 font-mono text-sm" />
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className={primary} disabled={busy || pasted.trim().length < 40}>{busy ? "Reading…" : "Add from this email"}</button>
          {note && <span role="status" className="text-sm text-muted">{note}</span>}
        </div>
      </form>
    </section>
  );
}

function ReviewInbox({ state, onDone }: { state: State; onDone: () => Promise<void> }) {
  return (
    <section className={part} aria-labelledby="review">
      <h3 id="review" className={partTitle}>Review Inbox <span className="font-normal text-[#8B8B94] tabular-nums">{state.review.length}</span></h3>
      <p className="m-0 text-[13px] text-[#9A9AA3]">Emails Unnepo wasn&apos;t sure about. Nothing changes until you say.</p>
      {state.review.length ? (
        <ul className="m-0 flex list-none flex-col p-0">
          {state.review.map((item) => <ReviewItem key={item.id} item={item} applications={state.applications} onDone={onDone} />)}
        </ul>
      ) : <p className="m-0 text-[13px] text-[#8B8B94]">Nothing to review.</p>}
    </section>
  );
}

const headingClass = "m-0 text-[32px] font-extrabold leading-[1.05] tracking-[-1.2px] sm:text-[40px] sm:tracking-[-1.4px]";
const introClass = "m-0 max-w-[640px] text-base leading-normal text-[#9A9AA3]";

function readSaved(key: string): Progress | "finished" | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (saved === "finished") return "finished";
    return saved && ["gmail", "outlook", "yahoo"].includes(saved.provider) && Number.isInteger(saved.step) ? saved : null;
  } catch {
    return null;
  }
}
function writeSaved(key: string, value: Progress | "finished") {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private windows can refuse this. The wizard still works, it just won't remember its place.
  }
}
const savedKey = (address: string) => `unnepo-email-setup:${address}`;

export function EmailTracking({ applyEmail, spider, onState, onNext }: { applyEmail?: string | null; spider: string; onState?: (state: { received: boolean; toReview: number }) => void; onNext?: () => void }) {
  const [state, setState] = useState<State | null>(null);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState("");
  // null: finished, showing the tracker. Otherwise where they are in the wizard.
  const [progress, setProgress] = useState<Progress | null>(null);
  const [placed, setPlaced] = useState(false);
  const [pasting, setPasting] = useState(false);
  const loaded = useRef(false);
  const guess: Provider | null = guessProvider(applyEmail);

  const load = useCallback(async () => {
    try {
      const next = await call<State>("/state");
      setState(next);
      const received = Boolean(next.lastEmail || next.skipped.dropped);
      onState?.({ received, toReview: next.review.length });
      setProblem("");
      if (!loaded.current) {
        loaded.current = true;
        // Back where they were, on the tracker if forwarding already works, and otherwise at the start.
        const saved = readSaved(savedKey(next.address));
        setProgress(saved === "finished" ? null : saved ?? (received ? null : { provider: guess ?? "gmail", step: 0, baseline: null }));
        setPlaced(true);
      }
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : "Couldn't load email tracking.");
      if (!loaded.current) onState?.({ received: false, toReview: 0 });
    }
  }, [onState, guess]);

  // The forwarding code and the test email should show up quickly while the wizard's waiting on them.
  const inWizard = progress !== null;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the page reads its data once it's in the browser
    void load();
    const timer = setInterval(() => void load(), inWizard ? 5_000 : 15_000);
    return () => clearInterval(timer);
  }, [load, inWizard]);

  function moveTo(next: Progress) {
    if (state) writeSaved(savedKey(state.address), next);
    setProgress(next);
  }
  function finish() {
    if (state) writeSaved(savedKey(state.address), "finished");
    setProgress(null);
    setPasting(false);
    window.scrollTo({ top: 0 });
  }
  async function regenerate() {
    if (!window.confirm("Make a new address? The old one stops working right away, so you'll need to set up forwarding again.")) return;
    setBusy("regenerate");
    try {
      const made = await call<{ address: string }>("/regenerate", "POST", {});
      const start: Progress = { provider: guess ?? "gmail", step: 0, baseline: null };
      writeSaved(savedKey(made.address), start);
      setProgress(start);
      await load();
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : "Couldn't make a new address.");
    } finally {
      setBusy("");
    }
  }

  if (!state || !placed) return problem ? <p role="alert" className="text-sm text-red-300">{problem}</p> : <p className="text-sm text-muted">Loading email tracking…</p>;
  const offWarning = !state.ready && <p className="m-0 rounded-xl border border-[#F5A524]/40 bg-[#F5A524]/5 px-4 py-3 text-sm text-zinc-300">Email forwarding isn&apos;t switched on for Unnepo yet, so forwarded emails won&apos;t arrive. You can still paste emails.</p>;
  const problemLine = problem && <p role="alert" className="m-0 text-sm text-red-300">{problem}</p>;

  if (progress) {
    return (
      <div className="flex flex-col gap-7">
        <div className="flex flex-col gap-2">
          <h1 className={headingClass}>Connect your email in about 3 minutes.</h1>
          <p className={introClass}>One step at a time. Unnepo shows you when each email arrives, so you&apos;ll know it worked before moving on.</p>
        </div>
        {offWarning}
        <EmailWizard state={state} progress={progress} guess={guess} spider={spider} onProgress={moveTo} onFinish={finish} onCheck={load} onPaste={() => setPasting(true)} />
        {state.review.length > 0 && <ReviewInbox state={state} onDone={load} />}
        {pasting && <PasteBox focus onDone={load} />}
        {problemLine}
      </div>
    );
  }

  const working = Boolean(state.lastEmail || state.skipped.dropped);
  const codeIsNew = state.verification && (!state.lastEmail || state.verification.at > state.lastEmail.at);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h1 className={headingClass}>{working ? "Your tracker updates itself." : "Almost there."}</h1>
        <p className={introClass}>{working ? "New job emails update your applications on their own. Anything Unnepo isn't sure about waits in your Review Inbox." : "Forward one job email to your Unnepo address to check that it works."}</p>
      </div>
      {offWarning}

      <section className="flex flex-col gap-5 rounded-[20px] border border-[#26262C] bg-[#0C0C0E] p-5 sm:p-7" aria-labelledby="email-on">
        <div className="flex items-center gap-3.5">
          <div aria-hidden className="dash-bob h-[60px] w-20 flex-none" dangerouslySetInnerHTML={{ __html: spider }} />
          <div className="flex min-w-0 flex-col gap-1">
            <span className="font-mono text-[11px] tracking-[1.4px] text-[#8B8B94]">{working ? "ALL DONE" : "NO EMAILS YET"}</span>
            <h2 id="email-on" className="m-0 text-2xl font-bold tracking-[-0.5px]">{working ? "Email tracking is on." : "Waiting for your first email."}</h2>
          </div>
        </div>
        <AddressRow address={state.address}>
          <button type="button" disabled={busy === "regenerate"} onClick={() => void regenerate()} className="h-[38px] rounded-[10px] border border-[#26262C] px-3.5 text-[13px] font-medium hover:bg-white/5 disabled:opacity-40">{busy === "regenerate" ? "Making a new one…" : "New address"}</button>
        </AddressRow>
        <p className="m-0 text-xs leading-normal text-[#8B8B94]">It&apos;s yours alone. Anyone with it could send emails into your tracker, so keep it private. Unnepo saves the text of emails about a job, encrypted, so you can read them on that job. It doesn&apos;t keep emails that aren&apos;t about a job, or any attachments.</p>
        {codeIsNew && state.verification && (
          <div role="status" className="flex flex-wrap items-center gap-3.5 rounded-xl border border-[#3D8BFF] bg-[#070708] p-4">
            <span className="basis-full text-[13px] text-[#9A9AA3]">{state.verification.provider === "gmail" ? "Gmail" : "Outlook"} sent a confirmation code on {when(state.verification.at)}.</span>
            {state.verification.code && <><span className="break-all font-mono text-2xl tracking-[4px]">{state.verification.code}</span><CopyButton text={state.verification.code} label="Copy code" /></>}
            {state.verification.link && <a href={state.verification.link} target="_blank" rel="noreferrer" className="text-[13px] underline underline-offset-4">Open the confirmation link ↗</a>}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2.5">
          {onNext && <button type="button" onClick={onNext} className="h-11 rounded-[11px] bg-[#F7F7F8] px-[18px] text-sm font-semibold text-[#070708] hover:bg-white">Next: follow-up contacts →</button>}
          <button type="button" onClick={() => document.getElementById("paste-email")?.focus()} className="h-11 rounded-[11px] border border-[#26262C] px-[18px] text-sm font-medium hover:bg-white/5">Paste older emails</button>
          <button type="button" onClick={() => moveTo({ provider: guess ?? "gmail", step: 0, baseline: null })} className="px-2 py-1 text-[13px] text-[#9A9AA3] underline underline-offset-4 hover:text-white">Go through setup again</button>
        </div>
      </section>

      <ReviewInbox state={state} onDone={load} />
      <PasteBox onDone={load} />

      <details className={part}>
        <summary className="cursor-pointer text-sm font-semibold">Recent changes from email <span className="font-normal text-[#8B8B94] tabular-nums">{state.recent.length}</span></summary>
        {state.recent.length ? (
          <ul className="m-0 mt-3 flex list-none flex-col divide-y divide-[#17171B] p-0">
            {state.recent.map((item) => (
              <li key={item.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5 text-[13px]">
                <span className="min-w-0"><span className="mr-2 rounded-full border border-line px-2 py-0.5 text-[11px] text-muted">{item.outcome === "created" ? "Auto-added" : "Updated"}</span>{item.summary}{item.application && <a href={`/home?job=${encodeURIComponent(item.application.id)}`} className="ml-2 text-ink underline-offset-4 hover:underline">{item.application.company} — {item.application.title} →</a>}</span>
                <span className="text-xs text-faint tabular-nums">{when(item.at)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="m-0 mt-3 text-[13px] text-[#8B8B94]">No changes from email yet.</p>}
      </details>

      <details className={part}>
        <summary className="cursor-pointer text-sm font-semibold">Skipped emails <span className="font-normal text-[#8B8B94] tabular-nums">{state.skipped.read.length + state.skipped.dropped}</span></summary>
        <p className="m-0 mt-2 text-[13px] text-[#9A9AA3]">These reached Unnepo but didn&apos;t look like they were about a job application, so your tracker didn&apos;t change.</p>
        {state.skipped.read.length || state.skipped.dropped ? (
          <ul className="m-0 mt-2 flex list-none flex-col divide-y divide-[#17171B] p-0">
            {state.skipped.read.map((item) => (
              <li key={item.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5 text-[13px]">
                <span className="min-w-0">{item.summary || "Not about a job application."}</span>
                <span className="text-xs text-faint tabular-nums">{when(item.at)}</span>
              </li>
            ))}
            {state.skipped.dropped > 0 && (
              <li className="flex flex-wrap items-baseline justify-between gap-2 py-2.5 text-[13px]">
                <span className="min-w-0">{state.skipped.dropped === 1 ? "1 email" : `${state.skipped.dropped} emails`} with no job words. Nothing from {state.skipped.dropped === 1 ? "it" : "them"} was kept.</span>
                {state.skipped.droppedAt && <span className="text-xs text-faint tabular-nums">Last: {when(state.skipped.droppedAt)}</span>}
              </li>
            )}
          </ul>
        ) : <p className="m-0 mt-2 text-[13px] text-[#8B8B94]">No skipped emails yet.</p>}
      </details>
      {problemLine}
    </div>
  );
}
