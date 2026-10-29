"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Little "someone just applied" cards that pop up around the spider on wide screens, then pop away and
 * come back somewhere else. They're decoration for the hero, so they're hidden from screen readers and
 * left out on narrow screens where they'd cover the dialogue box.
 */

const NAMES = ["Avery B.", "Sophie K.", "Noah T.", "Liam M.", "Maya R.", "Ethan J.", "Priya S.", "Jordan L.", "Chloe W.", "Marcus D.", "Ana P.", "Sam O.", "Grace H.", "Leo C."];

// Where a card can sit, measured from the hero's edges. Kept clear of the spider and the dialogue box.
const SLOTS: Array<{ side: "left" | "right"; x: number; y: number }> = [
  { side: "left", x: 110, y: 70 },
  { side: "left", x: 24, y: 260 },
  { side: "left", x: 60, y: 430 },
  { side: "right", x: 100, y: 60 },
  { side: "right", x: 24, y: 210 },
  { side: "right", x: 50, y: 400 },
];

const SHOWN = 4;
const SWAP_MS = 2600;
const LEAVE_MS = 350;

type Card = { id: number; slot: number; name: string; jobs: number; minutes: number; site: "linkedin" | "handshake"; just: boolean; leaving: boolean };

const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];

function LinkedInMark() {
  return <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[5px] bg-[#0A66C2] font-sans text-lg font-bold leading-none text-white">in</span>;
}

function HandshakeMark() {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#1F9D61]">
      <svg viewBox="0 0 16 16" width="16" height="16" fill="#fff"><path d="M6 3h4a1 1 0 0 1 1 1v1h2.5A1.5 1.5 0 0 1 15 6.5V12a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12V6.5A1.5 1.5 0 0 1 2.5 5H5V4a1 1 0 0 1 1-1Zm0 2h4V4H6v1Zm1 3v1h2V8H7Z" /></svg>
    </span>
  );
}

export function ActivityToasts() {
  const [cards, setCards] = useState<Card[]>([]);
  const nextId = useRef(1);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const make = (taken: number[]): Card => {
      const free = SLOTS.map((_, index) => index).filter((index) => !taken.includes(index));
      return { id: nextId.current++, slot: pick(free), name: pick(NAMES), jobs: 5 + Math.floor(Math.random() * 26), minutes: 1 + Math.floor(Math.random() * 8), site: Math.random() < 0.55 ? "linkedin" : "handshake", just: Math.random() < 0.4, leaving: false };
    };
    const add = () => setCards((list) => (list.filter((card) => !card.leaving).length >= SHOWN ? list : [...list, make(list.map((card) => card.slot))]));
    const timers: number[] = [];
    // The first few pop in one after another.
    for (let index = 0; index < SHOWN; index += 1) timers.push(window.setTimeout(add, 400 + index * 450));
    if (reduced) return () => timers.forEach(clearTimeout);
    // Then the oldest card pops away and a new one shows up in another spot.
    const swap = window.setInterval(() => {
      setCards((list) => {
        const oldest = list.find((card) => !card.leaving);
        return oldest ? list.map((card) => (card.id === oldest.id ? { ...card, leaving: true } : card)) : list;
      });
      timers.push(window.setTimeout(() => setCards((list) => list.filter((card) => !card.leaving)), LEAVE_MS));
      timers.push(window.setTimeout(add, LEAVE_MS + 250));
    }, SWAP_MS);
    return () => {
      clearInterval(swap);
      timers.forEach(clearTimeout);
    };
  }, []);

  const dismiss = (id: number) => {
    setCards((list) => list.map((card) => (card.id === id ? { ...card, leaving: true } : card)));
    window.setTimeout(() => setCards((list) => list.filter((card) => card.id !== id)), LEAVE_MS);
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 hidden h-[560px] min-[1360px]:block" aria-hidden>
      <style>{`
        @keyframes unnepo-pop-in { 0% { opacity: 0; transform: translateY(10px) scale(.92) } 60% { opacity: 1; transform: translateY(-2px) scale(1.02) } 100% { opacity: 1; transform: none } }
        @keyframes unnepo-pop-out { to { opacity: 0; transform: translateY(-8px) scale(.94) } }
        .unnepo-pop-in { animation: unnepo-pop-in .38s steps(5) both; }
        .unnepo-pop-out { animation: unnepo-pop-out ${LEAVE_MS}ms steps(4) both; }
        @media (prefers-reduced-motion: reduce) { .unnepo-pop-in, .unnepo-pop-out { animation: none; } }
      `}</style>
      {cards.map((card) => {
        const slot = SLOTS[card.slot];
        return (
          <div
            key={card.id}
            className={`pointer-events-auto absolute flex w-[300px] items-start gap-3.5 border-[3px] border-[#26262C] bg-[#0C0C0E] py-4 pl-4 pr-9 font-mono text-[14px] leading-[1.5] text-[#F7F7F8] shadow-[5px_5px_0_#000] ${card.leaving ? "unnepo-pop-out" : "unnepo-pop-in"}`}
            style={{ [slot.side]: slot.x, top: slot.y }}
          >
            {card.site === "linkedin" ? <LinkedInMark /> : <HandshakeMark />}
            <p className="m-0">
              {card.name} {card.just ? "just applied" : "applied"} to {card.jobs} jobs
              <span className="block text-[12px] text-[#6B6B74]">{card.minutes} {card.minutes === 1 ? "minute" : "minutes"} ago</span>
            </p>
            <button type="button" tabIndex={-1} onClick={() => dismiss(card.id)} className="absolute right-2.5 top-2 px-1 text-[15px] leading-none text-[#8B8B94] hover:text-white">×</button>
          </div>
        );
      })}
    </div>
  );
}
