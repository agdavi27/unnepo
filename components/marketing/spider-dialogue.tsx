"use client";

import { useEffect, useReducer, useState } from "react";

/**
 * The home page centerpiece: Unnepo's original pixel spider hanging on a thread, talking through a retro
 * dialogue box. Lines type out while his mouth moves; a click finishes the line or moves to the next one.
 * With reduced motion, lines appear whole and nothing bobs or blinks. Poke him and he gets mad.
 */

const LINES = [
  "Applying to internships is brutal. Same resume, retyped into 200 forms.",
  "Then Workday wants a new account. For every. Single. Company.",
  "So I crawl them for you. Every field, every dropdown, every Next button.",
  "I make the accounts, hit submit, and log it the second it lands.",
  "Then I find the recruiters behind the role and write the email.",
  "Your job? Pick the jobs. I'll do the crawling.",
];

/** What he says when poked, getting crankier each time. */
const OUCH = ["Ouch!", "Hey! Quit poking me.", "I have eight legs and I'm not afraid to use them.", "OK, that's it. I'm telling the recruiters."];
const MAD_MS = 2200;

const ACCENT = "#3D8BFF";
const PALETTE: Record<string, string> = {
  o: "#000000", b: "#6E5B6E", h: "#B48FAE", d: "#4E3549", a: ACCENT, k: "#7E6580", K: "#5A4258",
  l: "#6E5B6E", L: "#4E3549", e: ACCENT, w: "#FFFFFF", m: "#1A0E14", f: "#F7F7F8", p: "#965E8C", r: "#FF4D4D",
};

const W = 40;
const H = 30;

/** The 40×30 spider, drawn from shapes so it's easy to tweak. `open` is the talking frame; `angry` is after a poke. */
function buildSpider(open: boolean, angry = false): string[] {
  const g: string[][] = Array.from({ length: H }, () => Array<string>(W).fill(""));
  const set = (x: number, y: number, c: string) => { if (x >= 0 && x < W && y >= 0 && y < H) g[y][x] = c; };
  const brush = (x: number, y: number, c: string) => { set(x, y, c); set(x + 1, y, c); set(x, y + 1, c); set(x + 1, y + 1, c); };
  const line = (x0: number, y0: number, x1: number, y1: number, c: string) => {
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1, dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      brush(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  };
  const legs: Array<Array<[number, number]>> = [
    [[13, 10], [7, 4], [3, 13]],
    [[12, 13], [5, 9], [1, 19]],
    [[12, 16], [5, 15], [2, 24]],
    [[14, 19], [9, 21], [6, 27]],
  ];
  for (const leg of legs) for (const side of [0, 1]) {
    const mirror = (p: [number, number]): [number, number] => (side ? [W - 2 - p[0], p[1]] : p);
    const [hip, knee, foot] = leg.map(mirror);
    line(hip[0], hip[1], knee[0], knee[1], "l");
    line(knee[0], knee[1], foot[0], foot[1], "L");
    set(knee[0] + (side ? 1 : 0), knee[1], "h");
  }
  const blob = (cx: number, cy: number, rx: number, ry: number, base: string, hi: string, lo: string) => {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry;
      if (nx * nx + ny * ny <= 1) g[y][x] = nx < -0.25 && ny < -0.3 ? hi : ny > 0.55 || nx > 0.6 ? lo : base;
    }
  };
  blob(20, 9, 8.6, 7.2, "b", "h", "d"); // abdomen
  set(17, 4, "w"); set(18, 4, "h");
  for (const [x, y] of [[19, 7], [20, 7], [18, 8], [21, 8], [19, 9], [20, 9], [19, 10], [20, 10]]) set(x, y, "a"); // blue mark
  blob(20, 17.8, 6.8, 5.2, "k", "h", "K"); // head
  for (const [x, y] of [[16, 15], [17, 15], [16, 16], [17, 16], [22, 15], [23, 15], [22, 16], [23, 16]]) set(x, y, "e");
  set(16, 15, "w"); set(22, 15, "w"); set(14, 14, "e"); set(25, 14, "e");
  if (angry) {
    // Red eyes under brows that slant down toward the middle.
    for (const [x, y] of [[16, 15], [17, 15], [16, 16], [17, 16], [22, 15], [23, 15], [22, 16], [23, 16], [14, 14], [25, 14]]) set(x, y, "r");
    set(17, 16, "w"); set(22, 16, "w");
    for (const [x, y] of [[15, 13], [16, 13], [17, 14], [18, 14], [24, 13], [23, 13], [22, 14], [21, 14]]) set(x, y, "m");
  }
  if (open) {
    for (let x = 17; x <= 22; x++) { set(x, 19, "m"); set(x, 20, "m"); }
    for (let x = 18; x <= 21; x++) set(x, 21, "m");
    set(19, 21, "p"); set(20, 21, "p");
    set(18, 19, "f"); set(18, 20, "f"); set(21, 19, "f"); set(21, 20, "f");
  } else {
    for (let x = 18; x <= 21; x++) set(x, 20, "m");
    set(18, 21, "f"); set(21, 21, "f");
  }
  // A one-pixel black outline around everything.
  const out = g.map((row) => row.slice());
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (g[y][x]) continue;
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => g[y + dy]?.[x + dx])) out[y][x] = "o";
  }
  return out.flat();
}

type Run = { x: number; y: number; w: number; fill: string };

/** Same-color pixels in a row become one rectangle. */
function runs(cells: string[], keep: (index: number) => boolean): Run[] {
  const out: Run[] = [];
  for (let y = 0; y < H; y++) {
    let x = 0;
    while (x < W) {
      const i = y * W + x;
      const c = cells[i];
      if (!c || !keep(i)) { x++; continue; }
      let w = 1;
      while (x + w < W && cells[i + w] === c && keep(i + w)) w++;
      out.push({ x, y, w, fill: PALETTE[c] });
      x += w;
    }
  }
  return out;
}

const OPEN = buildSpider(true);
const CLOSED = buildSpider(false);
// Pixels both frames share are drawn once; only the mouth changes while he talks.
const SAME = (i: number) => OPEN[i] === CLOSED[i];
const BASE = runs(CLOSED, SAME);
const MOUTH_OPEN = runs(OPEN, (i) => !SAME(i));
const MOUTH_CLOSED = runs(CLOSED, (i) => !SAME(i));
const ANGRY = runs(buildSpider(true, true), () => true);

function Rects({ list }: { list: Run[] }) {
  return <>{list.map((run) => <rect key={`${run.x}-${run.y}`} x={run.x} y={run.y} width={run.w} height={1} fill={run.fill} />)}</>;
}

function Spider({ talking, mad, onPoke }: { talking: boolean; mad: number; onPoke: () => void }) {
  return (
    <div className="unnepo-bob relative w-[min(400px,82vw)]">
      <div className="absolute bottom-[calc(100%-18px)] left-[calc(50%-3px)] h-[44px] w-[6px] bg-[#3A3A44]" />
      <button type="button" onClick={onPoke} aria-label="Poke the spider" className="relative block w-full cursor-pointer focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-4 focus-visible:outline-[#3D8BFF]">
        {/* A new key on each poke restarts the shake. */}
        <svg key={mad} viewBox={`0 0 ${W} ${H}`} className={`block w-full ${mad ? "unnepo-shake" : ""}`} shapeRendering="crispEdges" aria-hidden>
          {mad ? <Rects list={ANGRY} /> : (
            <>
              <Rects list={BASE} />
              <g style={{ display: talking ? "inline" : "none" }}><Rects list={MOUTH_OPEN} /></g>
              <g style={{ display: talking ? "none" : "inline" }}><Rects list={MOUTH_CLOSED} /></g>
            </>
          )}
        </svg>
      </button>
    </div>
  );
}

const TYPE_MS = 42;
/** Ticks to wait on a finished line before the next one (about 2.5 seconds). */
const HOLD_TICKS = 60;

type Typing = { line: number; shown: number; hold: number };

/** One step of the dialogue: type a letter, wait on a finished line, or skip ahead on a click. */
function step(state: Typing, action: "tick" | "advance"): Typing {
  const length = LINES[state.line].length;
  const next = { line: (state.line + 1) % LINES.length, shown: 0, hold: 0 };
  if (action === "advance") return state.shown < length ? { ...state, shown: length, hold: 0 } : next;
  if (state.shown < length) return { ...state, shown: state.shown + 1 };
  return state.hold >= HOLD_TICKS ? next : { ...state, hold: state.hold + 1 };
}

export function SpiderDialogue() {
  const [state, dispatch] = useReducer(step, { line: 0, shown: 0, hold: 0 });
  const [reduced, setReduced] = useState(false);
  // Pokes so far; `mad` is non-zero (the poke number) while he's still cross.
  const [pokes, setPokes] = useState(0);
  const [mad, setMad] = useState(0);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (reduced || mad) return;
    const timer = setInterval(() => dispatch("tick"), TYPE_MS);
    return () => clearInterval(timer);
  }, [reduced, mad]);

  useEffect(() => {
    if (!mad) return;
    const timer = setTimeout(() => setMad(0), MAD_MS);
    return () => clearTimeout(timer);
  }, [mad]);

  const poke = () => {
    const count = pokes + 1;
    setPokes(count);
    setMad(count);
  };

  const { line } = state;
  const text = mad ? OUCH[Math.min(mad, OUCH.length) - 1] : LINES[line];
  const typed = reduced || mad ? text.length : state.shown;
  const typing = typed < text.length;
  // With reduced motion every line is shown whole, so a click always moves on.
  const advance = () => (reduced ? (dispatch("advance"), dispatch("advance")) : dispatch("advance"));

  // The mouth opens on every other pair of letters, and stays shut on spaces and once the line is done.
  const talking = typing && text.charAt(typed) !== " " && Math.floor(typed / 2) % 2 === 0;

  return (
    <>
      <style>{`
        @keyframes unnepo-bob { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(14px) } }
        @keyframes unnepo-blink { 0%, 49% { opacity: 1 } 50%, 100% { opacity: 0 } }
        .unnepo-bob { animation: unnepo-bob 3.2s steps(4) infinite; }
        .unnepo-blink { animation: unnepo-blink 0.9s steps(1) infinite; }
        @keyframes unnepo-shake { 0%, 100% { transform: translateX(0) } 20%, 60% { transform: translateX(-10px) rotate(-3deg) } 40%, 80% { transform: translateX(10px) rotate(3deg) } }
        .unnepo-shake { animation: unnepo-shake .45s steps(5); }
        @media (prefers-reduced-motion: reduce) { .unnepo-bob, .unnepo-blink, .unnepo-shake { animation: none; } }
      `}</style>
      <Spider talking={talking} mad={mad} onPoke={poke} />
      {/* Buttons take their font from the page (globals.css), so the box's font is set on this wrapper. */}
      <div className="flex w-full max-w-[760px] flex-col font-[family-name:var(--font-pixel)] text-[clamp(13px,1.7vw,17px)] leading-[2]">
        <div className={`relative z-[1] -mb-2 ml-6 self-start border-4 border-bg ${mad ? "bg-[#FF4D4D]" : "bg-[#3D8BFF]"} px-3.5 pb-2 pt-2.5 text-[13px] leading-normal text-white shadow-[0_0_0_4px_#F7F7F8]`}>UNNEPO</div>
        <button
          type="button"
          onClick={() => (mad ? setMad(0) : advance())}
          aria-label={typing ? "Show the whole line" : "Next line"}
          className="relative min-h-[150px] cursor-pointer border-4 border-bg bg-[#F7F7F8] px-8 pb-[34px] pt-[30px] text-left text-bg shadow-[0_0_0_4px_#F7F7F8,12px_12px_0_4px_#1E1E26] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-[10px] focus-visible:outline-[#3D8BFF]"
        >
          <span aria-hidden className={mad ? "text-[#C81E2E]" : undefined}>{text.slice(0, typed)}</span>
          <span className="sr-only" aria-live="polite">{text}</span>
          {!typing && <span aria-hidden className="unnepo-blink absolute bottom-4 right-[22px] h-0 w-0 border-x-8 border-t-[10px] border-x-transparent border-t-bg" />}
        </button>
        <div className="mt-7 flex justify-center gap-2" aria-hidden>
          {LINES.map((item, index) => <span key={item} className={`h-2 w-2 ${index === line ? "bg-[#3D8BFF]" : "bg-[#2A2A31]"}`} />)}
        </div>
      </div>
    </>
  );
}
