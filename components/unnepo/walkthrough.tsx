"use client";

import { useEffect, useState } from "react";

/**
 * "How it works": a short click-through the first time a student reaches their dashboard. It starts by getting the
 * extension open (an arrow points up at Chrome's toolbar), then walks the three tabs of the side panel. Reopened
 * from the account menu.
 */

export const WALKTHROUGH_SEEN = "unnepo:walkthrough-seen";

type Tab = "Jobs" | "Tools" | "Me";
type Step = { tab: Tab | null; title: string; body: string; points: string[] };

const STEPS: Step[] = [
  {
    tab: "Tools", title: "Tools: where the panel opens",
    body: "Everything you do while applying is one tap away.",
    points: ["Cover letter: written for the job on your tab, from your resume.", "Answer a question: drafts \"Why do you want to work here?\" and the rest.", "Add a job: log one you applied to. Most are caught by themselves."],
  },
  {
    tab: "Jobs", title: "Jobs: your tracker",
    body: "Unnepo catches the jobs you apply to and keeps them here.",
    points: ["Your week at a glance, and every job you've applied to.", "Each job shows its next step: email someone, follow up, or wait.", "Mark a job as interviewing, offer or rejected as you hear back."],
  },
  {
    tab: "Jobs", title: "Find people to email",
    body: "Open a job and press Find people.",
    points: ["Recruiters, the team, and alumni from your school, with their emails.", "Write email drafts a short note you send from Gmail or Outlook.", "Tell Unnepo how many people you emailed, and it reminds you when to follow up."],
  },
  {
    tab: "Me", title: "Me: friends and settings",
    body: "Add a friend by email and compete each week.",
    points: ["See who applied, emailed and followed up the most this week. Never where.", "Your plan, your resume and how Unnepo behaves.", "Your profile and goals are on this website, under the menu at the top right."],
  },
];

function PanelMock({ tab }: { tab: Tab | null }) {
  return (
    <div className="flex items-stretch justify-around rounded-xl border border-[#26262C] bg-[#0A0A0C] p-1.5" aria-hidden="true">
      {(["Jobs", "Tools", "Me"] as Tab[]).map((name) => (
        <span key={name} className={`flex-1 rounded-lg py-2 text-center text-xs font-medium transition-colors ${tab === name ? "bg-[#3D8BFF] text-white" : "text-[#8B8B94]"}`}>{name}</span>
      ))}
    </div>
  );
}

/** The arrow at the top right of the page, pointing up at Chrome's extensions button. */
function ToolbarArrow() {
  return (
    <div className="pointer-events-none fixed right-3 top-1 z-[60] flex flex-col items-end sm:right-8" aria-hidden="true">
      <svg className="animate-bounce" width="44" height="56" viewBox="0 0 44 56" fill="none">
        <path d="M22 54V6M22 6L6 22M22 6l16 16" stroke="#FFD34D" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="-mt-1 max-w-[220px] rounded-lg bg-[#FFD34D] px-3 py-1.5 text-right text-xs font-semibold text-black shadow-lg">Click 🧩 in Chrome&apos;s toolbar, then Unnepo</span>
    </div>
  );
}

export function Walkthrough({ open, installed, onClose }: { open: boolean; installed: boolean | null; onClose: () => void }) {
  // -1: open the extension first. 0 and up: the steps.
  const [step, setStep] = useState(-1);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- starts over each time it opens
    if (open) setStep(-1);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  const current = step >= 0 ? STEPS[step] : null;
  const last = step === STEPS.length - 1;
  const button = "inline-flex min-h-10 items-center justify-center rounded-[10px] px-4 text-sm font-medium";

  return (
    <>
      {step === -1 && <ToolbarArrow />}
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="walkthrough-title">
        <div className="relative w-full max-w-md rounded-2xl border border-[#26262C] bg-[#0C0C0E] p-6 text-[#F7F7F8] shadow-2xl">
          <button type="button" aria-label="Close" onClick={onClose} className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-lg text-lg text-[#8B8B94] hover:bg-white/5 hover:text-white">×</button>
          <p className="font-mono text-[11px] uppercase tracking-[1.2px] text-[#8B8B94]">How Unnepo works{current ? ` · ${step + 1} of ${STEPS.length}` : ""}</p>

          {!current ? (
            <div className="mt-3 space-y-4">
              <h2 id="walkthrough-title" className="text-2xl font-bold tracking-[-0.6px]">First, open the extension</h2>
              <p className="text-sm leading-relaxed text-[#B4B4BC]">Unnepo lives in a side panel in Chrome, so open it next to this page and follow along.</p>
              <ol className="list-decimal space-y-1.5 pl-5 text-sm text-[#B4B4BC]">
                <li>Click the puzzle piece <span aria-hidden="true">🧩</span> at the top right of Chrome.</li>
                <li>Click <strong className="text-white">Unnepo</strong>. Pin it (📌) so it&apos;s always one click away.</li>
                <li>The panel opens on the right, on the Tools tab.</li>
              </ol>
              {installed === false && <p className="rounded-lg border border-[#3A2F12] bg-[#1A1508] px-3 py-2 text-xs text-[#FFD34D]">Unnepo couldn&apos;t find the extension in this browser. <a href="/extension/install" className="underline underline-offset-2">Add it to Chrome</a> first.</p>}
              <div className="flex flex-wrap gap-2 pt-1">
                <button type="button" onClick={() => setStep(0)} className={`${button} bg-white text-black hover:bg-zinc-200`}>It&apos;s open, show me around</button>
                <button type="button" onClick={onClose} className={`${button} text-[#9A9AA3] hover:text-white`}>Skip</button>
              </div>
            </div>
          ) : (
            <div className="mt-3 space-y-4">
              <h2 id="walkthrough-title" className="text-2xl font-bold tracking-[-0.6px]">{current.title}</h2>
              <PanelMock tab={current.tab} />
              <p className="text-sm text-[#B4B4BC]">{current.body}</p>
              <ul className="space-y-2 text-sm text-[#B4B4BC]">
                {current.points.map((point) => <li key={point} className="flex gap-2"><span aria-hidden="true" className="text-[#3D8BFF]">●</span><span>{point}</span></li>)}
              </ul>
              <div className="flex items-center justify-between gap-3 pt-1">
                <div className="flex gap-1.5">
                  {STEPS.map((item, index) => (
                    <button key={item.title} type="button" aria-label={`Step ${index + 1}: ${item.title}`} aria-current={index === step ? "step" : undefined} onClick={() => setStep(index)} className={`h-2 rounded-full transition-all ${index === step ? "w-6 bg-[#3D8BFF]" : "w-2 bg-[#26262C] hover:bg-[#3A3A42]"}`} />
                  ))}
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setStep(step - 1)} className={`${button} border border-[#26262C] hover:bg-white/5`}>Back</button>
                  <button type="button" onClick={() => (last ? onClose() : setStep(step + 1))} className={`${button} bg-white text-black hover:bg-zinc-200`}>{last ? "Done" : "Next"}</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
