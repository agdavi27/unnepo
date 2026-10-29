"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Unnepo's autofill bots: small pixel spiders that drop on a thread, then crawl around the screen while
 * applications fill. Purely decorative: they never block clicks, and they stay still for people who
 * prefer reduced motion.
 */

const PX = 2;
const COLORS: Record<string, string> = { B: "#3b3446", H: "#6b6280", W: "#eef6f3", K: "#141118", P: "#f2a3b3", L: "#2a2432" };

// 13 × 10 pixels. Face at the top, so the sprite "faces" up.
const BODY = [
  "....BBBBB....",
  "...BWWBWWB...",
  "...BWKBKWB...",
  "...PBBBBBP...",
  "...BBBBBBB...",
  "...BBHBBBB...",
  "...BBBBBBB...",
  "....BBBBB....",
  ".....BBB.....",
];
type Pixel = [number, number];
const LEGS_A: Pixel[][] = [[[2, 2], [1, 1], [1, 0]], [[2, 4], [1, 4], [0, 3]], [[2, 5], [1, 6], [0, 7]], [[2, 7], [1, 8], [1, 9]]];
const LEGS_B: Pixel[][] = [[[2, 2], [1, 2], [0, 1]], [[2, 4], [1, 3], [0, 3]], [[2, 5], [1, 5], [0, 6]], [[2, 7], [2, 8], [1, 9]]];

function legRects(legs: Pixel[][], key: string) {
  return legs.flat().flatMap(([x, y]) => [
    <rect key={`${key}l${x}-${y}`} x={x * PX} y={y * PX} width={PX} height={PX} fill={COLORS.L} />,
    <rect key={`${key}r${x}-${y}`} x={(12 - x) * PX} y={y * PX} width={PX} height={PX} fill={COLORS.L} />,
  ]);
}

/** One spider sprite. Legs alternate between two poses while it walks. */
export function SpiderSprite({ walking = false, className = "" }: { walking?: boolean; className?: string }) {
  return (
    <svg width={13 * PX} height={10 * PX} viewBox={`0 0 ${13 * PX} ${10 * PX}`} shapeRendering="crispEdges" className={`overflow-visible [filter:drop-shadow(0_0_1px_rgba(255,255,255,0.55))] ${className}`} aria-hidden>
      <g className={walking ? "unnepo-legs-a" : undefined}>{legRects(LEGS_A, "a")}</g>
      {walking && <g className="unnepo-legs-b">{legRects(LEGS_B, "b")}</g>}
      {BODY.flatMap((row, y) => row.split("").map((cell, x) => (cell === "." ? null : <rect key={`b${x}-${y}`} x={x * PX} y={y * PX} width={PX} height={PX} fill={COLORS[cell]} />)))}
    </svg>
  );
}

type Bug = { x: number; y: number; dropTo: number; heading: number; speed: number; turn: number; startedAt: number; dropMs: number };

const DROP_MS = 1600;

/** The swarm: `count` spiders (3 to 8) while `active`; they leave when work stops. */
export function SpiderSwarm({ active, count }: { active: boolean; count: number }) {
  const [shown, setShown] = useState(false);
  const [reduced, setReduced] = useState(false);
  const bugs = useRef<Bug[]>([]);
  const nodes = useRef<Array<HTMLDivElement | null>>([]);
  const threads = useRef<Array<HTMLDivElement | null>>([]);
  const n = Math.max(3, Math.min(8, count));

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!active || reduced) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hide the swarm when work stops
      setShown(false);
      return;
    }
    const now = performance.now();
    const width = window.innerWidth;
    const height = window.innerHeight;
    bugs.current = Array.from({ length: n }, (_, index) => ({
      x: ((index + 0.5) / n) * width + (Math.random() - 0.5) * 60,
      y: -24,
      dropTo: height * (0.25 + Math.random() * 0.5),
      heading: Math.random() * Math.PI * 2,
      speed: 28 + Math.random() * 26,
      turn: 0,
      startedAt: now + index * 220,
      dropMs: DROP_MS + Math.random() * 600,
    }));
    setShown(true);
    let frame = 0;
    let last = now;
    const tick = (time: number) => {
      const dt = Math.min(0.05, (time - last) / 1000);
      last = time;
      const w = window.innerWidth;
      const h = window.innerHeight;
      bugs.current.forEach((bug, index) => {
        const node = nodes.current[index];
        const thread = threads.current[index];
        if (!node) return;
        const elapsed = time - bug.startedAt;
        if (elapsed < 0) {
          node.style.opacity = "0";
          return;
        }
        node.style.opacity = "1";
        if (elapsed < bug.dropMs) {
          // Rappelling: hanging head-down on a thread, easing to a stop with a little sway.
          const t = elapsed / bug.dropMs;
          const eased = 1 - Math.pow(1 - t, 3);
          bug.y = -24 + (bug.dropTo + 24) * eased;
          const sway = Math.sin(elapsed / 220) * 6 * (1 - t);
          node.style.transform = `translate(${bug.x + sway}px, ${bug.y}px) rotate(180deg)`;
          if (thread) {
            thread.style.opacity = "1";
            thread.style.transform = `translateX(${bug.x + sway + 12}px)`;
            thread.style.height = `${Math.max(0, bug.y + 4)}px`;
          }
          return;
        }
        if (thread) thread.style.opacity = String(Math.max(0, 1 - (elapsed - bug.dropMs) / 700));
        // Crawling: wander with gentle turns, steering away from the edges.
        bug.turn += (Math.random() - 0.5) * 2.4 * dt;
        bug.turn *= 0.96;
        bug.heading += bug.turn;
        const margin = 30;
        if (bug.x < margin || bug.x > w - margin - 26 || bug.y < margin || bug.y > h - margin - 20) {
          const toCenter = Math.atan2(h / 2 - bug.y, w / 2 - bug.x);
          bug.heading += Math.atan2(Math.sin(toCenter - bug.heading), Math.cos(toCenter - bug.heading)) * 3 * dt;
        }
        bug.x = Math.min(w - 26, Math.max(0, bug.x + Math.cos(bug.heading) * bug.speed * dt));
        bug.y = Math.min(h - 20, Math.max(0, bug.y + Math.sin(bug.heading) * bug.speed * dt));
        node.style.transform = `translate(${bug.x}px, ${bug.y}px) rotate(${(bug.heading * 180) / Math.PI + 90}deg)`;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, reduced, n]);

  if (!shown) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-40 overflow-hidden" aria-hidden>
      <style>{`
        @keyframes unnepo-step { 0%, 49% { opacity: 1 } 50%, 100% { opacity: 0 } }
        .unnepo-legs-a { animation: unnepo-step 0.28s steps(1) infinite; }
        .unnepo-legs-b { animation: unnepo-step 0.28s steps(1) infinite reverse; }
      `}</style>
      {Array.from({ length: n }, (_, index) => (
        <div key={index}>
          <div ref={(node) => { threads.current[index] = node; }} className="absolute left-0 top-0 w-px bg-sky-100/80" style={{ height: 0, opacity: 0 }} />
          <div ref={(node) => { nodes.current[index] = node; }} className="absolute left-0 top-0 will-change-transform" style={{ opacity: 0 }}>
            <SpiderSprite walking />
          </div>
        </div>
      ))}
    </div>
  );
}
