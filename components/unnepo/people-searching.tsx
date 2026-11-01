"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ART_W, artRects, spiderArt, spiderPalette } from "@/lib/spiders";

/**
 * While Unnepo looks for people: the spider typing away on a laptop, and speech bubbles that float up as
 * each real step starts ("Searching for Acme's email format…"). The step text comes from the server as the
 * search runs. With reduced motion, the bubbles appear without floating and nothing bobs.
 */

const W = 60;
const H = 48;
const LIFT = 11;

/** The laptop, seen from behind its lid, in front of the spider: lid, glowing logo dot, and the base. */
function laptop() {
  const rects: string[] = [];
  const rect = (x: number, y: number, w: number, h: number, fill: string, extra = "") => rects.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"${extra}/>`);
  rect(13, 27, 34, 16, "#000000");
  rect(14, 28, 32, 14, "#C9CDD6");
  rect(14, 28, 32, 2, "#E6E9EF");
  rect(14, 40, 32, 2, "#A9AEB9");
  rect(29, 34, 2, 2, "#3D8BFF", ` class="logo"`);
  rect(8, 43, 44, 3, "#000000");
  rect(9, 43, 42, 2, "#9AA0AC");
  rect(26, 43, 8, 1, "#7D8390");
  return rects.join("");
}

/** The spider's two front feet, tapping on the keys in turn. */
const FEET = `<g class="foot left"><rect x="10" y="40" width="4" height="3" fill="#000"/><rect x="11" y="40" width="2" height="2" fill="currentColor"/></g>`
  + `<g class="foot right"><rect x="46" y="40" width="4" height="3" fill="#000"/><rect x="47" y="40" width="2" height="2" fill="currentColor"/></g>`;

export function PeopleSearching({ message, school }: { message: string; school?: string }) {
  const svg = useMemo(() => {
    const look = { skin: "school" as const, school };
    const palette = spiderPalette(look);
    const spider = artRects(spiderArt(false, look), palette);
    return `<svg viewBox="0 0 ${W} ${H}" width="168" height="${Math.round((168 * H) / W)}" shape-rendering="crispEdges" aria-hidden="true" style="color:${palette.l}">`
      + `<g class="spider" transform="translate(${(W - ART_W) / 2} ${LIFT - 10})">${spider}</g>`
      + `<rect x="18" y="26" width="24" height="2" fill="#3D8BFF" opacity=".35" class="glow"/>`
      + laptop() + FEET + `</svg>`;
  }, [school]);

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
        @keyframes spider-bob { 0%, 100% { transform: translate(${(W - ART_W) / 2}px, ${LIFT - 10}px); } 50% { transform: translate(${(W - ART_W) / 2}px, ${LIFT - 9}px); } }
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
