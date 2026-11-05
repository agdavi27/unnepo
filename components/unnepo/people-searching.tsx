"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { typingSpiderSvg } from "@/extension/src/shared/hero-spider";

/**
 * While Unnepo works (looking for people, writing a cover letter): the spider typing away on a laptop, and speech bubbles that float up as
 * each real step starts ("Searching for Acme's email format…"). The step text comes from the server as the
 * search runs. With reduced motion, the bubbles appear without floating and nothing bobs.
 */

export function PeopleSearching({ message }: { message: string }) {
  const svg = useMemo(() => typingSpiderSvg(168), []);

  // Every step the search has reached, newest last; the last three float in the air.
  const [steps, setSteps] = useState<Array<{ id: number; text: string }>>([]);
  const next = useRef(0);
  useEffect(() => {
    const text = message.trim();
    if (!text) return;
    setSteps((previous) => (previous.at(-1)?.text === text ? previous : [...previous, { id: next.current++, text }].slice(-3)));
  }, [message]);

  return (
    <div className="people-searching flex flex-col items-center gap-2 py-2" role="status" aria-live="polite">
      <style>{`
        .people-searching .bubbles { position: relative; display: flex; flex-direction: column; align-items: center; gap: 6px; min-height: 104px; justify-content: flex-end; width: 100%; }
        .people-searching .bubble { position: relative; max-width: min(92%, 340px); padding: 7px 12px; border-radius: 14px; background: #F7F7F8; color: #0A0A0B; font-size: 13px; font-weight: 600; line-height: 1.3; text-align: center; box-shadow: 3px 3px 0 #3D8BFF; animation: bubble-in .5s ease-out both; }
        .people-searching .bubble.old { animation: none; opacity: .45; transform: scale(.94); transition: opacity .5s, transform .5s; box-shadow: none; }
        .people-searching .bubble.oldest { opacity: .2; transform: scale(.88); }
        .people-searching .bubble.now::after { content: ""; position: absolute; left: 50%; bottom: -6px; width: 10px; height: 10px; background: #F7F7F8; transform: translateX(-50%) rotate(45deg); }
        .people-searching .bubble.now { animation: bubble-in .5s ease-out both, bubble-bob 2.4s ease-in-out .5s infinite; }
        .people-searching .spider { animation: spider-bob 1.2s ease-in-out infinite; }
        .people-searching .foot.left { animation: tap .36s steps(2) infinite; }
        .people-searching .foot.right { animation: tap .36s steps(2) .18s infinite; }
        .people-searching .logo, .people-searching .glow { animation: glow 1.6s ease-in-out infinite; }
        @keyframes bubble-in { from { opacity: 0; transform: translateY(14px) scale(.9); } to { opacity: 1; transform: none; } }
        @keyframes bubble-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
        @keyframes spider-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(1px); } }
        @keyframes tap { 0% { transform: translateY(0); } 100% { transform: translateY(-1px); } }
        @keyframes glow { 0%, 100% { opacity: .5; } 50% { opacity: 1; } }
        @media (prefers-reduced-motion: reduce) {
          .people-searching .bubble, .people-searching .bubble.now, .people-searching .spider, .people-searching .foot, .people-searching .logo, .people-searching .glow { animation: none !important; }
        }
      `}</style>
      <div className="bubbles">
        {steps.map((step, index) => {
          const age = steps.length - 1 - index;
          return <p key={step.id} className={`bubble m-0 ${age === 0 ? "now" : age === 1 ? "old" : "old oldest"}`}>{step.text}</p>;
        })}
      </div>
      <span className="block" dangerouslySetInnerHTML={{ __html: svg }} />
      <span className="sr-only">{steps.at(-1)?.text ?? "Searching…"}</span>
    </div>
  );
}
