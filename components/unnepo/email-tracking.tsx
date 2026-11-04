"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * The Email tracking page: the student's own forwarding address, step-by-step guides for setting up a
 * forwarding rule in Gmail, Outlook and Yahoo/AOL, the forwarding confirmation code once it arrives, a box to
 * paste an email by hand, the Review Inbox for what Unnepo wasn't sure about, and what emails changed lately.
 */

type Named = { id: string; title: string; company: string };
type Item = {
  id: string; at: string; kind: string; company: string; jobTitle: string | null; confidence: number; summary: string;
  outcome: string; reason: "low_confidence" | "several_matches" | "no_match" | null; source: "forward" | "paste";
  application: Named | null; candidates: Named[];
};
type State = {
  address: string; ready: boolean; gmailQuery: string; atsDomains: string[]; phrases: string[];
  verification: { provider: "gmail" | "outlook"; code: string | null; link: string | null; at: string } | null;
  review: Item[]; recent: Item[]; applications: Named[];
  skipped: { read: Array<{ id: string; at: string; summary: string }>; dropped: number; droppedAt: string | null };
};

const btn = "inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const primary = `${btn} bg-white text-black hover:bg-zinc-200`;
const secondary = `${btn} border border-line bg-transparent text-ink hover:bg-white/5`;
const card = "rounded-2xl border border-line bg-panel p-5 sm:p-6";

async function call<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`/api/email${path}`, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Something went wrong (${response.status}).`);
  return payload as T;
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={secondary}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1800);
        } catch {
          setDone(false);
        }
      }}
    >
      {done ? "Copied" : label}
    </button>
  );
}

const KIND: Record<string, string> = { applied: "Applied", incomplete: "Not finished", interview: "Interview", assessment: "Assessment", offer: "Offer", rejected: "Rejected", not_job_related: "Not about a job" };
const REASON: Record<string, string> = {
  low_confidence: "Unnepo wasn't sure what this email says.",
  several_matches: "More than one of your applications fits. Pick the right one.",
  no_match: "No saved application matches. Approve to save it as a new one, or pick one.",
};
const when = (at: string) => new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" });

function Guides({ state }: { state: State }) {
  const [tab, setTab] = useState<"gmail" | "outlook" | "yahoo">("gmail");
  const step = (n: number, body: React.ReactNode) => (
    <li className="flex gap-3"><span className="flex h-6 w-6 flex-none items-center justify-center rounded-full border border-line text-xs tabular-nums text-muted">{n}</span><div className="min-w-0 flex-1 text-sm leading-relaxed text-zinc-300">{body}</div></li>
  );
  const code = (text: string) => <code className="break-all rounded bg-card px-1.5 py-0.5 font-mono text-xs text-ink">{text}</code>;
  return (
    <section className={card} aria-labelledby="guides">
      <h2 id="guides" className="text-lg font-semibold">Set up forwarding</h2>
      <p className="mt-1 text-sm text-muted">Keep applying with your own email. A rule in your inbox sends job emails to Unnepo, and your tracker updates by itself.</p>
      <div className="mt-4 flex gap-2" role="tablist" aria-label="Your email">
        {([["gmail", "Gmail"], ["outlook", "Outlook / Hotmail"], ["yahoo", "Yahoo / AOL"]] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`rounded-full border px-3 py-1 text-sm ${tab === id ? "border-white bg-white text-black" : "border-line text-muted hover:text-white"}`}>{label}</button>
        ))}
      </div>
      {tab === "gmail" && (
        <ol className="mt-5 flex flex-col gap-4">
          {step(1, <>In Gmail, open <strong>Settings</strong> (the gear) → <strong>See all settings</strong> → <strong>Forwarding and POP/IMAP</strong> → <strong>Add a forwarding address</strong>. Paste your Unnepo address, then press Next and Proceed.</>)}
          {step(2, <>Gmail sends a confirmation code to Unnepo. <strong>It shows up at the top of this page</strong> within a minute. Type it into Gmail and press <strong>Verify</strong>. Leave &ldquo;Disable forwarding&rdquo; selected: only job emails should go to Unnepo.</>)}
          {step(3, <><div>Make a filter. Click the sliders at the right of Gmail&apos;s search bar, and paste this into <strong>Has the words</strong>:</div><div className="mt-2 flex flex-wrap items-start gap-2">{code(state.gmailQuery)}<CopyButton text={state.gmailQuery} label="Copy search" /></div></>)}
          {step(4, <>Press <strong>Create filter</strong>, tick <strong>Forward it to</strong>, choose your Unnepo address, and press <strong>Create filter</strong>. New job emails now go to Unnepo too. Older ones don&apos;t: paste those below.</>)}
        </ol>
      )}
      {tab === "outlook" && (
        <ol className="mt-5 flex flex-col gap-4">
          {step(1, <>In Outlook.com, open <strong>Settings</strong> (the gear) → <strong>Mail</strong> → <strong>Rules</strong> → <strong>Add new rule</strong>. Name it &ldquo;Unnepo jobs&rdquo;.</>)}
          {step(2, <><div>Condition: <strong>From</strong> → <strong>Sender address includes</strong>, and add each of these:</div><div className="mt-2 flex flex-wrap items-start gap-2">{code(state.atsDomains.join(", "))}<CopyButton text={state.atsDomains.join("\n")} label="Copy list" /></div></>)}
          {step(3, <>Action: <strong>Forward to</strong> → paste your Unnepo address. Save the rule.</>)}
          {step(4, <><div>Make a second rule the same way, with the condition <strong>Subject or body includes</strong> and these phrases:</div><div className="mt-2 flex flex-wrap items-start gap-2">{code(state.phrases.map((phrase) => `"${phrase}"`).join(", "))}<CopyButton text={state.phrases.join("\n")} label="Copy phrases" /></div></>)}
          {step(5, <>If Outlook asks to confirm the forwarding address, the code shows up at the top of this page.</>)}
          <li className="rounded-xl border border-[#F5A524]/40 bg-[#F5A524]/5 px-4 py-3 text-sm text-zinc-300"><strong className="text-[#F5A524]">School or work email?</strong> Microsoft 365 accounts from schools and companies often block forwarding outside the organization. If the rule doesn&apos;t forward, apply with a personal email (Gmail or Outlook.com) instead, or paste emails below.</li>
        </ol>
      )}
      {tab === "yahoo" && (
        <div className="mt-5 flex flex-col gap-3 text-sm text-zinc-300">
          <p>Free Yahoo and AOL accounts can&apos;t forward email automatically. Two ways that still work:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li><strong>Forward each job email by hand</strong> to your Unnepo address. Unnepo reads who it was originally from.</li>
            <li><strong>Paste the email</strong> into the box below.</li>
          </ul>
        </div>
      )}
    </section>
  );
}

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
    <li className="flex flex-col gap-3 px-4 py-4">
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
          <button type="button" className={secondary} disabled={busy} onClick={() => void act("dismiss")}>Dismiss</button>
        </div>
      )}
      {problem && <p role="alert" className="m-0 text-xs text-red-300">{problem}</p>}
    </li>
  );
}

export function EmailTracking() {
  const [state, setState] = useState<State | null>(null);
  const [problem, setProblem] = useState("");
  const [pasted, setPasted] = useState("");
  const [pasteNote, setPasteNote] = useState("");
  const [busy, setBusy] = useState("");
  const load = useCallback(async () => {
    try {
      setState(await call<State>("/state"));
      setProblem("");
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : "Couldn't load email tracking.");
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the page reads its data once it's in the browser
    void load();
    // The forwarding code and forwarded emails show up without reloading.
    const timer = setInterval(() => void load(), 15_000);
    return () => clearInterval(timer);
  }, [load]);

  if (!state) return problem ? <p role="alert" className="text-sm text-red-300">{problem}</p> : <p className="text-sm text-muted">Loading email tracking…</p>;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Email tracking</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">Unnepo reads the job emails you forward to it (confirmations, interviews, assessments, offers, rejections) and updates your applications. It keeps only the company, the job, the status and a one-line summary, never the email itself.</p>
      </div>
      {!state.ready && <p className="rounded-xl border border-[#F5A524]/40 bg-[#F5A524]/5 px-4 py-3 text-sm text-zinc-300">Email forwarding isn&apos;t switched on for Unnepo yet, so forwarded emails won&apos;t arrive. You can still paste emails below.</p>}

      <section className={card} aria-labelledby="address">
        <h2 id="address" className="text-lg font-semibold">Your Unnepo address</h2>
        <p className="mt-1 text-sm text-muted">Forward job emails here. It&apos;s yours alone; anyone with it could send emails into your tracker, so keep it private.</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <code className="min-w-0 break-all rounded-lg border border-line bg-card px-3 py-2 font-mono text-sm text-ink">{state.address}</code>
          <CopyButton text={state.address} />
          <button
            type="button"
            className={secondary}
            disabled={busy === "regenerate"}
            onClick={async () => {
              if (!window.confirm("Make a new address? The old one stops working right away, so you'll need to update your forwarding rule.")) return;
              setBusy("regenerate");
              try {
                await call("/regenerate", "POST", {});
                await load();
              } catch (reason) {
                setProblem(reason instanceof Error ? reason.message : "Couldn't make a new address.");
              } finally {
                setBusy("");
              }
            }}
          >
            {busy === "regenerate" ? "Making a new one…" : "Regenerate"}
          </button>
        </div>
      </section>

      {state.verification && (
        <section className={`${card} border-[#3D8BFF]/60`} aria-labelledby="confirm" role="status">
          <h2 id="confirm" className="text-lg font-semibold">{state.verification.provider === "gmail" ? "Gmail" : "Outlook"} sent a confirmation code</h2>
          <p className="mt-1 text-sm text-muted">Type it into {state.verification.provider === "gmail" ? "Gmail's forwarding settings" : "Outlook"} to finish setting up forwarding. Received {when(state.verification.at)}.</p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {state.verification.code && <><code className="rounded-lg border border-line bg-card px-4 py-2 font-mono text-2xl tracking-widest text-ink">{state.verification.code}</code><CopyButton text={state.verification.code} label="Copy code" /></>}
            {state.verification.link && <a href={state.verification.link} target="_blank" rel="noreferrer" className={secondary}>Or open the confirmation link ↗</a>}
          </div>
        </section>
      )}

      <Guides state={state} />

      <section className={card} aria-labelledby="review">
        <h2 id="review" className="text-lg font-semibold">Review Inbox <span className="text-sm font-normal text-faint tabular-nums">{state.review.length}</span></h2>
        <p className="mt-1 text-sm text-muted">Emails Unnepo wasn&apos;t sure about. Nothing changes until you say.</p>
        {state.review.length ? (
          <ul className="mt-4 flex flex-col divide-y divide-line rounded-xl border border-line">
            {state.review.map((item) => <ReviewItem key={item.id} item={item} applications={state.applications} onDone={load} />)}
          </ul>
        ) : <p className="mt-4 text-sm text-faint">Nothing to review.</p>}
      </section>

      <section className={card} aria-labelledby="paste">
        <h2 id="paste" className="text-lg font-semibold">Paste an email</h2>
        <p className="mt-1 text-sm text-muted">For an email that wasn&apos;t forwarded. Include the From and Subject lines if you can.</p>
        <form
          className="mt-4 flex flex-col gap-3"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy("paste");
            setPasteNote("");
            try {
              const result = await call<{ message: string }>("/paste", "POST", { text: pasted });
              setPasteNote(result.message);
              setPasted("");
              await load();
            } catch (reason) {
              setPasteNote(reason instanceof Error ? reason.message : "Couldn't read it.");
            } finally {
              setBusy("");
            }
          }}
        >
          <label className="sr-only" htmlFor="paste-email">Email</label>
          <textarea id="paste-email" rows={7} value={pasted} onChange={(event) => setPasted(event.target.value)} maxLength={30000} placeholder={"From: Acme Careers <no-reply@myworkday.com>\nSubject: Thank you for applying\n\nThank you for applying to the Data Analyst Intern role…"} className="w-full rounded-lg border border-line bg-card px-3 py-2 font-mono text-sm" />
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className={primary} disabled={busy === "paste" || pasted.trim().length < 40}>{busy === "paste" ? "Reading…" : "Add from this email"}</button>
            {pasteNote && <span role="status" className="text-sm text-muted">{pasteNote}</span>}
          </div>
        </form>
      </section>

      <section className={card} aria-labelledby="recent">
        <h2 id="recent" className="text-lg font-semibold">Recent changes from email</h2>
        {state.recent.length ? (
          <ul className="mt-4 flex flex-col divide-y divide-line rounded-xl border border-line">
            {state.recent.map((item) => (
              <li key={item.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 text-sm">
                <span className="min-w-0"><span className="mr-2 rounded-full border border-line px-2 py-0.5 text-[11px] text-muted">{item.outcome === "created" ? "Auto-added" : "Updated"}</span>{item.summary}{item.application && <a href={`/home?job=${encodeURIComponent(item.application.id)}`} className="ml-2 text-ink underline-offset-4 hover:underline">{item.application.company} — {item.application.title} →</a>}</span>
                <span className="text-xs text-faint tabular-nums">{when(item.at)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="mt-4 text-sm text-faint">No changes from email yet.</p>}
      </section>

      <section className={card} aria-labelledby="skipped">
        <h2 id="skipped" className="text-lg font-semibold">Skipped emails</h2>
        <p className="mt-1 text-sm text-muted">These reached Unnepo but didn&apos;t look like they were about a job application, so your tracker didn&apos;t change.</p>
        {state.skipped.read.length || state.skipped.dropped ? (
          <ul className="mt-4 flex flex-col divide-y divide-line rounded-xl border border-line">
            {state.skipped.read.map((item) => (
              <li key={item.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 text-sm">
                <span className="min-w-0">{item.summary || "Not about a job application."}</span>
                <span className="text-xs text-faint tabular-nums">{when(item.at)}</span>
              </li>
            ))}
            {state.skipped.dropped > 0 && (
              <li className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 text-sm">
                <span className="min-w-0">{state.skipped.dropped === 1 ? "1 email" : `${state.skipped.dropped} emails`} with no job words. Nothing from {state.skipped.dropped === 1 ? "it" : "them"} was kept.</span>
                {state.skipped.droppedAt && <span className="text-xs text-faint tabular-nums">Last: {when(state.skipped.droppedAt)}</span>}
              </li>
            )}
          </ul>
        ) : <p className="mt-4 text-sm text-faint">No skipped emails yet.</p>}
      </section>
      {problem && <p role="alert" className="text-sm text-red-300">{problem}</p>}
    </div>
  );
}
