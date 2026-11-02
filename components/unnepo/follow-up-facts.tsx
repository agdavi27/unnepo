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

export function FollowUpFacts({ applied, school, onOpen }: { applied: FollowApp[]; school: string; onOpen: (appId: string) => void }) {
  const [index, setIndex] = useState(0);
  const [talking, setTalking] = useState(false);
  const [still, setStill] = useState(false);

  useEffect(() => {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read once, after the page is in the browser
    setStill(reduce);
    if (reduce) return;
    const facts = setInterval(() => setIndex((at) => (at + 1) % FOLLOW_UP_FACTS.length), ROTATE_MS);
    const mouth = setInterval(() => setTalking((open) => !open), 450);
    return () => {
      clearInterval(facts);
      clearInterval(mouth);
    };
  }, []);

  const followed = applied.filter((app) => (app.contacts ?? []).some((contact) => contact.outreachStatus !== "not_contacted")).length;
  const next = applied.find((app) => !(app.contacts ?? []).some((contact) => contact.outreachStatus !== "not_contacted"));
  const spider = useMemo(() => ({ open: spiderSvg({ skin: "school", school }, { open: true, size: 64 }), shut: spiderSvg({ skin: "school", school }, { size: 64 }) }), [school]);
  const fact = FOLLOW_UP_FACTS[index];

  return (
    <section aria-label="Why following up helps" className="flex flex-col gap-4 rounded-2xl border border-line bg-panel p-4 sm:flex-row sm:items-center sm:p-5">
      <style>{`
        @keyframes fact-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        .fact-in { animation: fact-in .45s ease-out both; }
        @keyframes spider-hang { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(3px); } }
        .spider-hang { animation: spider-hang 2.4s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .fact-in, .spider-hang { animation: none; } }
      `}</style>
      <span aria-hidden className={`flex-none self-center ${still ? "" : "spider-hang"}`} dangerouslySetInnerHTML={{ __html: talking && !still ? spider.open : spider.shut }} />
      <div className="min-w-0 flex-1">
        <div key={index} className="fact-in relative rounded-xl bg-[#F7F7F8] px-4 py-3 text-[#0A0A0B] shadow-[3px_3px_0_#3D8BFF]" aria-live="polite">
          <p className="m-0 text-sm font-semibold leading-snug">{fact.text}</p>
          <a href={fact.url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[11px] text-[#55555E] underline-offset-2 hover:underline">{fact.source}</a>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <p className="m-0 text-muted">
            {applied.length ? <>You&apos;ve followed up on <strong className="text-ink tabular-nums">{followed} of {applied.length}</strong> {applied.length === 1 ? "application" : "applications"}.</> : "Once you apply, follow up with someone at the company."}
          </p>
          {next && <button type="button" onClick={() => onOpen(next.id)} className="text-sm font-medium text-ink underline-offset-4 hover:underline">Find people at {next.company} →</button>}
          <span className="ml-auto flex items-center gap-1.5" aria-label={`Fact ${index + 1} of ${FOLLOW_UP_FACTS.length}`}>
            {FOLLOW_UP_FACTS.map((_, dot) => (
              <button key={dot} type="button" aria-label={`Fact ${dot + 1}`} aria-current={dot === index} onClick={() => setIndex(dot)} className={`h-1.5 rounded-full transition-all ${dot === index ? "w-4 bg-white" : "w-1.5 bg-zinc-600 hover:bg-zinc-400"}`} />
            ))}
          </span>
        </div>
      </div>
    </section>
  );
}
