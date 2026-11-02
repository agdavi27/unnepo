"use client";

import { useEffect, useMemo, useState } from "react";
import { spiderSvg } from "@/lib/spiders";

/**
 * Above the Applied list: the spider talking through why following up pays off, one fact at a time, each
 * with its source, then the student's own count and a button to the next job they haven't followed up on.
 * Only facts with a named survey or study. With reduced motion the spider holds still and the facts change
 * only when the student presses Next.
 */

export const FOLLOW_UP_FACTS: Array<{ text: string; source: string; url: string }> = [
  {
    text: "Every HR manager surveyed said applicants should check back after sending a resume. Most said within two weeks.",
    source: "Accountemps survey of 300+ U.S. HR managers, 2017",
    url: "https://press.roberthalf.com/2017-09-19-The-Art-of-Following-Up",
  },
  {
    text: "Email is how most of them want to hear from you: 64% picked it over a phone call.",
    source: "Accountemps survey of 300+ U.S. HR managers, 2017",
    url: "https://press.roberthalf.com/2017-09-19-The-Art-of-Following-Up",
  },
  {
    text: "80% of HR managers said a thank-you note helps when deciding who to hire, but only 24% of applicants send one.",
    source: "Accountemps survey of 300+ U.S. HR managers, 2017",
    url: "https://press.roberthalf.com/2017-11-20-Thank-You-Notes-Can-Tip-Scale-in-Job-Candidates-Favor-Yet-Few-Write-Them",
  },
  {
    text: "Knowing someone inside helps: at one large U.S. company, referred applicants were more likely to be hired, and stayed longer.",
    source: "Brown, Setren & Topa, Journal of Labor Economics, 2016",
    url: "https://www.newyorkfed.org/medialibrary/media/research/staff_reports/sr568.html",
  },
];

const ROTATE_MS = 7000;

type FollowApp = { id: string; company: string; contacts?: Array<{ outreachStatus: string }> };

const HIDDEN_KEY = "unnepo-follow-up-hidden";
const today = () => new Date().toISOString().slice(0, 10);

/** A small card for the corner of the Applied page. The × folds it down to the spider for the rest of the day. */
export function FollowUpFacts({ applied, school, onOpen }: { applied: FollowApp[]; school: string; onOpen: (appId: string) => void }) {
  const [index, setIndex] = useState(0);
  const [talking, setTalking] = useState(false);
  const [still, setStill] = useState(false);
  const [folded, setFolded] = useState(false);

  useEffect(() => {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let hidden = false;
    try {
      hidden = localStorage.getItem(HIDDEN_KEY) === today();
    } catch {
      hidden = false;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read once, after the page is in the browser
    setStill(reduce);
    setFolded(hidden);
    if (reduce) return;
    const facts = setInterval(() => setIndex((at) => (at + 1) % FOLLOW_UP_FACTS.length), ROTATE_MS);
    const mouth = setInterval(() => setTalking((open) => !open), 450);
    return () => {
      clearInterval(facts);
      clearInterval(mouth);
    };
  }, []);

  const fold = (value: boolean) => {
    setFolded(value);
    try {
      if (value) localStorage.setItem(HIDDEN_KEY, today());
      else localStorage.removeItem(HIDDEN_KEY);
    } catch {
      // Remembering it is a nicety; the card still folds.
    }
  };

  const followed = applied.filter((app) => (app.contacts ?? []).some((contact) => contact.outreachStatus !== "not_contacted")).length;
  const next = applied.find((app) => !(app.contacts ?? []).some((contact) => contact.outreachStatus !== "not_contacted"));
  const spider = useMemo(() => ({ open: spiderSvg({ skin: "school", school }, { open: true, size: 34 }), shut: spiderSvg({ skin: "school", school }, { size: 34 }) }), [school]);
  const fact = FOLLOW_UP_FACTS[index];
  const face = <span aria-hidden className={`flex-none ${still ? "" : "spider-hang"}`} dangerouslySetInnerHTML={{ __html: talking && !still && !folded ? spider.open : spider.shut }} />;
  const motion = (
    <style>{`
      @keyframes fact-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
      .fact-in { animation: fact-in .4s ease-out both; }
      @keyframes spider-hang { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(2px); } }
      .spider-hang { animation: spider-hang 2.4s ease-in-out infinite; }
      @media (prefers-reduced-motion: reduce) { .fact-in, .spider-hang { animation: none; } }
    `}</style>
  );

  if (folded) {
    return (
      <button type="button" onClick={() => fold(false)} className="inline-flex items-center gap-2 self-start rounded-full border border-line bg-panel py-1 pl-1 pr-3 text-xs text-muted hover:text-white sm:self-auto" aria-label="Show why following up helps">
        {motion}{face}<span className="tabular-nums">{followed}/{applied.length} followed up</span>
      </button>
    );
  }
  return (
    <aside aria-label="Why following up helps" className="relative flex w-full items-start gap-2.5 rounded-xl border border-line bg-panel p-2.5 pr-7 sm:w-72">
      {motion}
      {face}
      <div className="min-w-0 flex-1">
        <p key={index} className="fact-in m-0 text-xs font-medium leading-snug text-ink" aria-live="polite">
          {fact.text}{" "}
          <a href={fact.url} target="_blank" rel="noreferrer" title={fact.source} className="text-[10px] font-normal text-faint underline-offset-2 hover:text-muted hover:underline">Source</a>
        </p>
        <p className="m-0 mt-1.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted">
          <span className="tabular-nums">{applied.length ? `${followed} of ${applied.length} followed up` : "Follow up after you apply"}</span>
          {next && <button type="button" onClick={() => onOpen(next.id)} className="font-medium text-ink underline-offset-2 hover:underline">Find people at {next.company} →</button>}
        </p>
      </div>
      <button type="button" onClick={() => fold(true)} aria-label="Fold this card for today" className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded text-faint hover:text-white">×</button>
    </aside>
  );
}
