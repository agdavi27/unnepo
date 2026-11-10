"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { State } from "@/components/unnepo/email-tracking";

/**
 * Setting up forwarding, one step at a time: pick the inbox, follow its steps, then forward one test email. Unnepo
 * shows the forwarding code and the test email when they really arrive, so the student knows each step worked.
 */

export type Provider = "gmail" | "outlook" | "yahoo";
/** Where the student is: `baseline` is what had already arrived when the test step opened. */
export type Progress = { provider: Provider; step: number; baseline: string | null };

type StepKind = "address" | "code" | "filter" | "test" | "manual";
type WizardStep = {
  kind: StepKind; rail: string; title: string;
  /** One or two sentences: why this step, in plain words. */
  body: string;
  /** Exactly what to click, in order. */
  how: string[];
  /** A tip under the steps, for the thing people most often get wrong. */
  tip?: string;
  next: string;
  link?: { label: string; href: string };
  copy?: { show: string; text: string };
  mock?: { title: string; tabs: string[]; active: number; hint: string; action: string };
};

const GMAIL_TABS = ["General", "Labels", "Filters and Blocked Addresses", "Forwarding and POP/IMAP"];
const OUTLOOK_TABS = ["Layout", "Compose and reply", "Rules", "Forwarding"];
const GMAIL_FORWARDING = { label: "Open Gmail forwarding settings", href: "https://mail.google.com/mail/u/0/#settings/fwdandpop" };
const GMAIL_FILTERS = { label: "Open Gmail filters", href: "https://mail.google.com/mail/u/0/#settings/filters" };
const OUTLOOK_RULES = { label: "Open Outlook rules", href: "https://outlook.live.com/mail/0/options/mail/rules" };
const TEST: WizardStep = {
  kind: "test", rail: "Send a test", title: "Send one test email",
  body: "This proves everything works. Unnepo shows the email here the moment it arrives.",
  how: [
    "Press Copy address above.",
    "In your inbox, open a job email you already have, like \"Thank you for applying\". Pick one you haven't sent to Unnepo before.",
    "Press Forward, paste your Unnepo address in To, and press Send.",
    "Come back to this page. The email shows up below in about a minute.",
  ],
  next: "Finish",
};
const NAME: Record<Provider, string> = { gmail: "Gmail", outlook: "Outlook", yahoo: "Yahoo or AOL" };

function stepsFor(provider: Provider, state: State): WizardStep[] {
  if (provider === "gmail") return [
    {
      kind: "address", rail: "Add the forwarding address", title: "Add Unnepo as a forwarding address",
      body: "This lets Gmail send emails to Unnepo. Nothing gets forwarded yet: you choose which emails in step 4.",
      how: [
        "Press Copy address above.",
        "Press Open Gmail forwarding settings below. Gmail opens on the Forwarding and POP/IMAP tab.",
        "Press Add a forwarding address.",
        "Paste your Unnepo address and press Next.",
        "A small window opens. Press Proceed, then OK.",
      ],
      tip: "Signed in to more than one Gmail? Check the picture in Gmail's top right is the account you apply with before you start.",
      next: "I've added it", link: GMAIL_FORWARDING,
      mock: { title: "Gmail · Settings (illustration)", tabs: GMAIL_TABS, active: 3, hint: "Forwarding:", action: "Add a forwarding address" },
    },
    {
      kind: "code", rail: "Confirm the code", title: "Paste the code Gmail sends",
      body: "Gmail emails a code to Unnepo to check the address is real. It shows up right here, usually in under a minute.",
      how: [
        "Wait for the code to appear below, then press Copy code.",
        "Go back to Gmail's Forwarding and POP/IMAP tab (or press Open Gmail forwarding settings below).",
        "Paste the code in the box next to Verify and press Verify.",
        "Leave Disable forwarding selected. That is fine: your filter in the next step forwards only job emails.",
      ],
      tip: "No code after two minutes? Go back a step and check you added the address exactly as shown, with no extra spaces.",
      next: "I've verified it", link: GMAIL_FORWARDING,
    },
    {
      kind: "filter", rail: "Forward only job emails", title: "Only send job emails to Unnepo",
      body: "A Gmail filter picks out emails from job sites and emails like \"Thank you for applying\", and sends only those. Everything else stays private in your inbox.",
      how: [
        "Press Copy above to copy the job-email search.",
        "Press Open Gmail filters below, then Create a new filter.",
        "Paste into the Has the words box. Leave every other box empty.",
        "Press Create filter at the bottom right of that box.",
        "Tick Forward it to, and pick your Unnepo address from the list.",
        "Press Create filter again. You're done with Gmail.",
      ],
      tip: "Don't see your Unnepo address in the Forward it to list? The code in step 3 isn't verified yet. Press Back and verify it.",
      next: "Filter is on", link: GMAIL_FILTERS,
      copy: { show: state.gmailQuery, text: state.gmailQuery },
      mock: { title: "Gmail · Create filter (illustration)", tabs: GMAIL_TABS, active: 2, hint: `Has the words: (pasted) · Forward it to: ${state.address}`, action: "Create filter" },
    },
    TEST,
  ];
  if (provider === "outlook") return [
    {
      kind: "address", rail: "Start a forwarding rule", title: "Start a rule that forwards to Unnepo",
      body: "An Outlook rule forwards job emails to Unnepo. First you tell it where to send them.",
      how: [
        "Press Copy address above.",
        "Press Open Outlook rules below.",
        "Press + Add new rule and name it Unnepo jobs.",
        "Under Add an action, choose Forward to, and paste your Unnepo address.",
        "Don't press Save yet. The next step picks which emails.",
      ],
      next: "Rule started", link: OUTLOOK_RULES,
      mock: { title: "Outlook · Settings (illustration)", tabs: OUTLOOK_TABS, active: 2, hint: "Rules", action: "Add new rule" },
    },
    {
      kind: "filter", rail: "Pick which emails", title: "Only forward emails from job sites",
      body: "This keeps everything else private: only emails from job application systems go to Unnepo.",
      how: [
        "Press Copy above to copy the list of job sites.",
        "In the same rule, under Add a condition, choose Sender address includes.",
        "Paste the list. If Outlook keeps it as one line, add each site one at a time.",
        "Press Save.",
      ],
      next: "Rule saved", link: OUTLOOK_RULES,
      copy: { show: state.atsDomains.join(", "), text: state.atsDomains.join("\n") },
      mock: { title: "Outlook · Add new rule (illustration)", tabs: OUTLOOK_TABS, active: 2, hint: "Condition: Sender address includes (pasted)", action: "Save" },
    },
    {
      kind: "filter", rail: "Catch the rest", title: "Catch emails from other senders",
      body: "Some companies send job emails from their own address. A second rule catches those by what they say.",
      how: [
        "Press Copy above to copy the phrases.",
        "Press + Add new rule again and name it Unnepo jobs 2.",
        "Under Add a condition, choose Subject or body includes, and add the phrases.",
        "Under Add an action, choose Forward to and paste your Unnepo address.",
        "Press Save.",
      ],
      next: "Second rule saved", link: OUTLOOK_RULES,
      copy: { show: state.phrases.map((phrase) => `"${phrase}"`).join(", "), text: state.phrases.join("\n") },
    },
    {
      kind: "code", rail: "Confirm if asked", title: "Confirm, if Outlook asks",
      body: "Some Outlook accounts ask to confirm a new forwarding address. Most don't.",
      how: [
        "If Outlook asked you to confirm, the code or link shows up below in about a minute. Copy it into Outlook.",
        "If Outlook didn't ask, press Done or not asked.",
      ],
      next: "Done or not asked",
    },
    TEST,
  ];
  return [
    {
      kind: "manual", rail: "Forward by hand", title: "Forward job emails by hand",
      body: "Free Yahoo and AOL accounts can't forward on their own, so you forward job emails yourself. It takes a few seconds each.",
      how: [
        "Press Copy address above and save it as a contact named Unnepo, so it's quick to pick.",
        "When a job email arrives (application received, interview, rejection), press Forward.",
        "Send it to Unnepo. Unnepo reads who it was originally from and updates that job.",
      ],
      next: "Got it",
    },
    TEST,
  ];
}

/** What's arrived so far, as one string: it changes whenever another forwarded email lands. */
export const arrivals = (state: State) => `${state.lastEmail?.id ?? ""}:${state.skipped.dropped}`;

export function guessProvider(email: string | null | undefined): Provider | null {
  const domain = (email ?? "").split("@")[1]?.toLowerCase().trim();
  if (!domain) return null;
  if (/^(gmail|googlemail)\.com$/.test(domain)) return "gmail";
  if (/^(outlook|hotmail|live|msn)\./.test(domain)) return "outlook";
  if (/^(yahoo|ymail|aol)\./.test(domain)) return "yahoo";
  return null;
}

const solid = "h-[38px] flex-none rounded-[10px] bg-[#F7F7F8] px-4 text-[13px] font-semibold text-[#070708] hover:bg-white";

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={solid}
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

export function AddressRow({ address, children }: { address: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-[#26262C] bg-[#070708] px-4 py-3.5">
      <code className="min-w-0 flex-1 basis-56 break-all font-mono text-[15px]">{address}</code>
      <span className="flex flex-wrap items-center gap-2"><CopyButton text={address} label="Copy address" />{children}</span>
    </div>
  );
}

/** A picture of the page the student's about to open, with the button to press outlined. */
function Illustration({ mock, name }: { mock: NonNullable<WizardStep["mock"]>; name: string }) {
  return (
    <figure className="m-0 flex flex-col gap-2">
      <div aria-hidden className="overflow-hidden rounded-xl border border-[#26262C] bg-[#F4F5F7] text-[#1B1D24]">
        <div className="flex h-[30px] items-center gap-1.5 bg-[#E6E8EC] px-3">
          {[0, 1, 2].map((dot) => <span key={dot} className="h-2 w-2 rounded-full bg-[#C3C6CE]" />)}
          <span className="ml-2.5 truncate text-[11px] text-[#5B5F6B]">{mock.title}</span>
        </div>
        <div className="flex gap-[18px] overflow-x-auto border-b border-[#DADDE3] px-4 text-xs">
          {mock.tabs.map((tab, index) => (
            <span key={tab} className={`whitespace-nowrap border-b-2 py-2.5 ${index === mock.active ? "border-[#3D8BFF] font-semibold text-[#1B1D24]" : "border-transparent text-[#6B7080]"}`}>{tab}</span>
          ))}
        </div>
        <div className="flex flex-col gap-2.5 px-4 pb-5 pt-[18px] text-xs">
          <span className="break-words text-[#5B5F6B]">{mock.hint}</span>
          <span className="dash-pulse self-start rounded-md border-2 border-[#3D8BFF] bg-white px-3 py-2 font-semibold">{mock.action}</span>
        </div>
      </div>
      <figcaption className="text-xs text-[#8B8B94]">What you&apos;ll see in {name}. Click the button outlined in blue.</figcaption>
    </figure>
  );
}

/** What the test email did, in words. */
function TestResult({ state }: { state: State }) {
  const last = state.lastEmail;
  const job = last ? [last.company, last.jobTitle].filter(Boolean).join(" · ") : "";
  let said: ReactNode;
  if (last?.outcome === "review") said = <><strong>Got it.</strong> Unnepo wasn&apos;t sure what it says, so it&apos;s waiting in your Review Inbox below.</>;
  else if (last && (last.outcome === "created" || last.outcome === "updated" || last.outcome === "approved")) said = <><strong>Got it.</strong> {job ? `${job}: ` : ""}{last.summary}</>;
  else said = <><strong>It got here, so forwarding works.</strong> It didn&apos;t look like a job email, so your tracker didn&apos;t change.</>;
  return <div className="flex items-start gap-3 rounded-xl border border-[#1F4D2E] bg-[#0B1A11] p-4 text-sm leading-normal"><span aria-hidden className="text-lg leading-none text-[#4ADE80]">✓</span><span className="min-w-0">{said}</span></div>;
}

const quiet = "self-start p-0 text-[13px] text-[#9A9AA3] underline underline-offset-4 hover:text-white";

export function EmailWizard({ state, progress, guess, spider, onProgress, onFinish, onCheck, onPaste }: {
  state: State; progress: Progress; guess: Provider | null; spider: string;
  onProgress: (next: Progress) => void; onFinish: () => void; onCheck: () => Promise<void>; onPaste: () => void;
}) {
  const { provider, step } = progress;
  const steps = stepsFor(provider, state);
  const current = step >= 1 ? steps[step - 1] ?? null : null;
  const total = steps.length + 1;
  const name = NAME[provider];
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  const [checked, setChecked] = useState("");

  // A new step reads from its title: keyboard and screen reader users start there, and a phone scrolls to it.
  useEffect(() => {
    if (moved.current) heading.current?.focus();
    moved.current = false;
  }, [step, provider]);

  const go = (next: number) => {
    moved.current = true;
    const opening = next >= 1 ? steps[next - 1] : null;
    setChecked("");
    onProgress({ provider, step: next, baseline: opening?.kind === "test" ? progress.baseline ?? arrivals(state) : progress.baseline });
  };

  const kind = current?.kind;
  const landed = kind === "test" && progress.baseline !== null && arrivals(state) !== progress.baseline;
  const hasCode = Boolean(state.verification);
  const waitingForCode = kind === "code" && provider === "gmail" && !hasCode;
  const waitingForTest = kind === "test" && !landed;
  const canNext = !waitingForCode && !waitingForTest;
  const nextLabel = !current ? `Start with ${name}` : waitingForCode ? "Waiting for the code…" : waitingForTest ? "Waiting for your test…" : current.next;
  const rail = ["Pick your email", ...steps.map((item) => item.rail)];

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-wrap items-start gap-6">
        <ol aria-label="Steps" className="m-0 hidden w-60 flex-none list-none flex-col gap-1 p-0 md:flex">
          {rail.map((label, index) => {
            const done = index < step;
            const now = index === step;
            return (
              <li key={label} aria-current={now ? "step" : undefined} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${now ? "bg-[#111114]" : ""}`}>
                <span className={`flex h-[26px] w-[26px] flex-none items-center justify-center rounded-full border-2 font-mono text-[11px] ${done ? "border-[#3D8BFF] bg-[#3D8BFF] text-white" : now ? "border-[#3D8BFF] text-[#3D8BFF]" : "border-[#26262C] text-[#8B8B94]"}`}>{done ? "✓" : index + 1}</span>
                <span className={`text-sm ${now ? "font-semibold text-[#F7F7F8]" : done ? "text-[#B4B4BC]" : "text-[#8B8B94]"}`}>{label}</span>
              </li>
            );
          })}
        </ol>

        <section className="flex min-w-0 flex-[999_1_320px] flex-col gap-5 rounded-[20px] border border-[#26262C] bg-[#0C0C0E] p-5 sm:p-7" aria-labelledby="wizard-step">
          <div className="flex items-center gap-3.5">
            <div aria-hidden className="dash-bob h-[60px] w-20 flex-none" dangerouslySetInnerHTML={{ __html: spider }} />
            <div className="flex min-w-0 flex-col gap-1">
              <span className="font-mono text-[11px] tracking-[1.4px] text-[#8B8B94]">STEP {step + 1} OF {total}</span>
              <h2 id="wizard-step" ref={heading} tabIndex={-1} className="m-0 text-2xl font-bold tracking-[-0.5px] outline-none">{current?.title ?? "Which email do you apply with?"}</h2>
            </div>
          </div>
          <p className="m-0 text-[15px] leading-[1.55] text-[#B4B4BC]">{current?.body ?? "You set up a rule in your inbox once. From then on, job emails (application received, interview, rejection) are forwarded to your private Unnepo address, and your tracker updates on its own. Nothing else leaves your inbox. Pick the inbox you use to apply."}</p>

          {!current && (
            <>
              <div role="group" aria-label="Your email" className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-2.5">
                {([["gmail", "Gmail", "Personal or school Gmail"], ["outlook", "Outlook", "Outlook.com or Hotmail"], ["yahoo", "Yahoo or AOL", "Forward by hand"]] as const).map(([id, label, note]) => (
                  <button key={id} type="button" aria-pressed={provider === id} onClick={() => onProgress({ provider: id, step: 0, baseline: null })} className={`flex flex-col items-start gap-1.5 rounded-[14px] border-2 p-[18px] text-left hover:border-[#3D8BFF]/60 ${provider === id ? "border-[#3D8BFF] bg-[#111114]" : "border-[#26262C]"}`}>
                    <span className="text-base font-semibold">{label}</span>
                    <span className="text-xs text-[#8B8B94]">{note}</span>
                  </button>
                ))}
              </div>
              {guess && <p className="m-0 text-[13px] text-[#8B8B94]">We guessed <strong className="text-[#F7F7F8]">{NAME[guess]}</strong> from your email. Pick the inbox you apply with.</p>}
            </>
          )}

          {(kind === "address" || kind === "manual" || kind === "test") && <AddressRow address={state.address} />}

          {current?.copy && (
            <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-[#26262C] bg-[#070708] px-4 py-3.5">
              <code className="line-clamp-2 min-w-0 flex-1 basis-56 break-all font-mono text-[13px] text-[#B4B4BC]" title={current.copy.show}>{current.copy.show}</code>
              <CopyButton text={current.copy.text} />
            </div>
          )}

          {current && (
            <ol className="m-0 flex list-none flex-col gap-2.5 p-0" aria-label={`How to do step ${step + 1}`}>
              {current.how.map((line, index) => (
                <li key={line} className="flex items-start gap-3 text-[15px] leading-[1.5] text-[#E4E4E7]">
                  <span aria-hidden className="mt-px flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full bg-[#1F1F24] font-mono text-[11px] text-[#B4B4BC]">{index + 1}</span>
                  <span className="min-w-0">{line}</span>
                </li>
              ))}
            </ol>
          )}
          {current?.tip && <p className="m-0 rounded-xl border border-[#26262C] bg-[#070708] px-4 py-3 text-[13px] leading-normal text-[#9A9AA3]"><strong className="text-[#E4E4E7]">Tip:</strong> {current.tip}</p>}

          {current?.mock && <Illustration mock={current.mock} name={name} />}

          <div role="status" className="flex flex-col gap-3 empty:hidden">
            {kind === "code" && !state.verification && (
              <div className="flex items-center gap-3 rounded-xl border border-dashed border-[#26262C] p-[18px] text-sm text-[#9A9AA3]"><span className="dash-pulse h-2.5 w-2.5 flex-none rounded-full bg-[#3D8BFF]" />{provider === "gmail" ? "Waiting for Gmail's code. It usually takes under a minute." : "No code from Outlook yet. If it didn't ask, carry on."}</div>
            )}
            {kind === "code" && state.verification && (
              <div className="flex flex-wrap items-center gap-3.5 rounded-xl border border-[#3D8BFF] bg-[#070708] p-[18px]">
                {state.verification.code && <><span className="break-all font-mono text-[28px] tracking-[5px] sm:text-[32px] sm:tracking-[6px]">{state.verification.code}</span><CopyButton text={state.verification.code} label="Copy code" /></>}
                {state.verification.link && <a href={state.verification.link} target="_blank" rel="noreferrer" className="text-[13px] text-[#F7F7F8] underline underline-offset-4">{state.verification.code ? "Or open the confirmation link ↗" : "Open the confirmation link ↗"}</a>}
                {state.verification.code && <span className="basis-full text-[13px] text-[#8B8B94]">Paste it in {name} and press Verify.</span>}
              </div>
            )}
            {kind === "test" && landed && <TestResult state={state} />}
            {kind === "test" && !landed && checked && <p className="m-0 text-[13px] text-[#9A9AA3]">{checked}</p>}
          </div>

          {waitingForCode && <button type="button" className={quiet} onClick={() => go(step + 1)}>Already verified? Skip this step</button>}
          {kind === "test" && !landed && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
              <button
                type="button"
                className="h-11 rounded-[11px] border border-[#26262C] px-[18px] text-sm font-medium hover:bg-white/5"
                onClick={async () => {
                  setChecked("Checking…");
                  await onCheck();
                  setChecked("Nothing yet. An email can take a minute to get here, and Unnepo keeps checking.");
                }}
              >I forwarded one. Check for it</button>
              <button type="button" className={quiet} onClick={onFinish}>Skip the test</button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2.5 border-t border-[#17171B] pt-4">
            {step > 0 && <button type="button" className="h-11 px-4 text-sm font-medium text-[#9A9AA3] hover:text-white" onClick={() => go(step - 1)}>← Back</button>}
            {current?.link && <a href={current.link.href} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center gap-2 rounded-[11px] border border-[#26262C] px-4 text-sm font-medium text-[#F7F7F8] hover:bg-white/5">{current.link.label} <span aria-hidden>↗</span></a>}
            <button
              type="button"
              disabled={!canNext}
              className={`ml-auto h-11 rounded-[11px] px-5 text-sm font-semibold ${canNext ? "bg-[#F7F7F8] text-[#070708] hover:bg-white" : "cursor-not-allowed bg-[#1F1F24] text-[#8B8B94]"}`}
              onClick={() => (current?.kind === "test" ? onFinish() : go(step + 1))}
            >{nextLabel}</button>
          </div>
        </section>
      </div>
      <p className="m-0 text-[13px] leading-normal text-[#8B8B94]">Using a school email? Microsoft 365 school accounts often block forwarding. Apply with a personal Gmail or Outlook.com, or <button type="button" onClick={onPaste} className="p-0 text-[#F7F7F8] underline underline-offset-4 hover:text-white">paste emails instead</button>.</p>
    </div>
  );
}
