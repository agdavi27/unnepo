/**
 * Draws the /get demo: Unnepo's spider drops in big, shrinks onto a job application, then shows what the extension
 * does: fills the form, attaches your resume and portfolio, writes the cover letter, finds people to follow up with,
 * and logs the job in your tracker. It ends on the pitch.
 * Writes public/get/demo.webp (the page), demo.gif (emails, 480 px) and demo.jpg (the still for reduced motion).
 * Run: npx jiti scripts/demo-animation.ts
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { ART_W, artRects, spiderArt, spiderPalette } from "../lib/spiders";

const W = 720;
const H = 450;
const FPS = 12.5;
const OUT = path.join(process.cwd(), "public/get");

const BG = "#070708", CARD = "#0C0C0E", LINE = "#26262C", INK = "#F7F7F8", MUTED = "#9A9AA3", SOFT = "#B4B4BC", BLUE = "#3D8BFF", GREEN = "#4ADE80";
const SANS = "Helvetica Neue, Helvetica, Arial, sans-serif";
const MONO = "Menlo, monospace";

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
/** 0→1 over [from, to]. */
const span = (t: number, from: number, to: number) => clamp((t - from) / (to - from));
const easeOut = (k: number) => 1 - (1 - k) ** 3;
const easeInOut = (k: number) => (k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const type = (s: string, k: number) => s.slice(0, Math.round(s.length * clamp(k)));

function text(x: number, y: number, s: string, o: { size?: number; fill?: string; weight?: number; font?: string; anchor?: string; opacity?: number } = {}) {
  return `<text x="${x}" y="${y}" font-family="${o.font ?? SANS}" font-size="${o.size ?? 14}" font-weight="${o.weight ?? 400}" fill="${o.fill ?? INK}" text-anchor="${o.anchor ?? "start"}" opacity="${o.opacity ?? 1}">${esc(s)}</text>`;
}
const rect = (x: number, y: number, w: number, h: number, fill: string, extra = "") => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" ${extra}/>`;
const check = (x: number, y: number, color = GREEN) => `<path d="M${x} ${y + 5} l4 4 l8 -9" stroke="${color}" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
const cursor = (x: number, y: number) => `<path d="M${x} ${y} l0 18 l5 -5 l4 9 l3 -1.5 l-4 -8.5 l7 0 z" fill="#fff" stroke="#000" stroke-width="1.2"/>`;
const fileIcon = (x: number, y: number, color = BLUE) => rect(x, y, 9, 12, color, `rx="1"`);
const linkIcon = (x: number, y: number) => `<circle cx="${x + 5}" cy="${y + 6}" r="5" fill="none" stroke="${GREEN}" stroke-width="2"/>`;

const PALETTE = spiderPalette({ skin: "classic" });
const SPIDER = { shut: artRects(spiderArt(false, { skin: "classic" }), PALETTE), open: artRects(spiderArt(true, { skin: "classic" }), PALETTE) };

/** The spider centered at (cx, top), `scale` px per art pixel, hanging from a thread down from `threadTop`. */
function spider(cx: number, top: number, scale: number, open: boolean, threadTop = 0) {
  const x = cx - (ART_W * scale) / 2;
  const thread = top > threadTop ? rect(cx - Math.max(1, scale / 2), threadTop, Math.max(2, scale), top - threadTop + scale * 2, "#D4D4DA") : "";
  return `${thread}<g transform="translate(${x} ${top}) scale(${scale})" shape-rendering="crispEdges">${open ? SPIDER.open : SPIDER.shut}</g>`;
}

/** The scenes, in seconds. */
const T = {
  click: 1.6, fill: 2.3, step: 0.38,
  attach: 4.4, resumeClick: 5.1, portfolioClick: 5.9,
  letter: 6.8, people: 9.0, tracker: 11.1, end: 13.4,
  length: 15.0,
};

type Field = { label: string; value: string; kind?: "file" | "link"; at: number };
const FILL_ORDER = [0, 1, 2, 5, 6];
const FIELDS: Field[] = [
  { label: "First name", value: "Jordan", at: 0 },
  { label: "Last name", value: "Lee", at: 0 },
  { label: "Email", value: "jordan.lee@school.edu", at: 0 },
  { label: "Resume", value: "Jordan_Lee_SWE_Resume.pdf", kind: "file", at: T.resumeClick + 0.05 },
  { label: "Portfolio", value: "jordanlee.dev", kind: "link", at: T.portfolioClick + 0.05 },
  { label: "Why do you want to work at Stripe?", value: "I built a payments app for my campus club and…", at: 0 },
  { label: "Are you authorized to work in the US?", value: "Yes", at: 0 },
];
FILL_ORDER.forEach((field, i) => { FIELDS[field].at = T.fill + i * T.step; });
const FILL_DONE = T.fill + FILL_ORDER.length * T.step;
const FIELD_Y = (i: number) => 112 + i * 38;
/** Where the small spider hangs: between the form and the panel, beside the field being filled. */
const SPIDER_X = 412;

const FILES = [
  ["Resume · Software engineering", "Jordan_Lee_SWE_Resume.pdf"],
  ["Resume · Product", "Jordan_Lee_PM_Resume.pdf"],
  ["Portfolio", "jordanlee.dev"],
  ["Transcript", "Transcript_Fall_2025.pdf"],
];
const LETTER = [
  "Dear Stripe team,",
  "",
  "I'm a junior studying computer",
  "science, and I'd love to join as",
  "a Software Engineering Intern.",
  "Last spring I built a payments",
  "app my club now uses for dues,",
  "which taught me how much good",
  "infrastructure matters…",
];
const PEOPLE = [
  ["Priya Nair", "Hiring manager"],
  ["Maya Chen", "University recruiter"],
  ["Sam Patel", "Engineer · From your school"],
];
const BOARD: Array<[string, string, Array<[string, string]>]> = [
  ["SAVED", MUTED, [["Ramp", "Finance Intern"], ["Figma", "Design Intern"]]],
  ["APPLIED", INK, [["Patagonia", "Marketing Intern"], ["Notion", "Ops Intern"]]],
  ["INTERVIEW", BLUE, [["Duolingo", "Product Intern"]]],
  ["OFFER", GREEN, [["Spotify", "Data Intern"]]],
];

function windowFrame(url: string) {
  const x = 20, y = 14, w = 680, h = 370;
  let s = rect(x, y, w, h, CARD, `rx="12" stroke="${LINE}" stroke-width="2"`);
  s += rect(x + 1, y + 1, w - 2, 30, "#141418", `rx="11"`) + rect(x + 1, y + 20, w - 2, 12, "#141418");
  for (const [i, c] of ["#FF5F57", "#FEBC2E", "#28C840"].entries()) s += `<circle cx="${x + 18 + i * 16}" cy="${y + 16}" r="5" fill="${c}"/>`;
  return s + rect(x + 80, y + 7, 380, 18, "#0A0A0C", `rx="9"`) + text(x + 94, y + 20, url, { size: 11, fill: MUTED });
}

/** The job application in the window. */
function application(t: number) {
  const x = 20;
  let s = text(x + 28, 72, "Software Engineering Intern", { size: 20, weight: 700 });
  s += text(x + 28, 91, "Stripe · New York · Summer 2026", { size: 12, fill: MUTED });
  FIELDS.forEach((field, i) => {
    const fy = FIELD_Y(i);
    const k = span(t, field.at, field.at + (field.kind ? 0.3 : T.step * 0.8));
    const active = k > 0 && k < 1;
    s += text(x + 28, fy, field.label, { size: 11, fill: SOFT });
    s += rect(x + 28, fy + 5, 330, 22, BG, `rx="6" stroke="${active ? BLUE : k >= 1 ? "#1F4D33" : LINE}" stroke-width="${active ? 2 : 1}"`);
    if (k > 0) {
      const value = field.kind ? type(field.value, k * 1.5) : type(field.value, k);
      if (field.kind === "file") s += fileIcon(x + 38, fy + 10) + text(x + 54, fy + 21, value, { size: 12 });
      else if (field.kind === "link") s += linkIcon(x + 37, fy + 10) + text(x + 54, fy + 21, value, { size: 12, fill: "#9CC3FF" });
      else s += text(x + 38, fy + 21, value, { size: 12 });
    } else if (field.kind) {
      s += text(x + 38, fy + 21, field.kind === "file" ? "Attach a file" : "https://", { size: 12, fill: "#4A4A52" });
    }
    if (k >= 1) s += check(x + 336, fy + 11);
  });
  return s;
}

function panelShell(title: string, heading: string) {
  const x = 440, y = 46, w = 252, h = 330;
  return rect(x, y, w, h, "#101014", `rx="10" stroke="${LINE}" stroke-width="1.5"`)
    + text(x + 16, y + 26, "unnepo", { size: 15, weight: 700 }) + text(x + 66, y + 26, ".", { size: 15, weight: 700, fill: BLUE })
    + text(x + 16, y + 58, title, { size: 11, fill: MUTED }) + text(x + 16, y + 78, heading, { size: 14, weight: 600 });
}

/** The extension's panel down the right of the window, one view per scene. */
function panel(t: number) {
  const x = 440, y = 46, w = 252;
  if (t < T.attach) {
    const pressed = t >= 1.95 && t < 2.15;
    const done = t >= FILL_DONE;
    let s = panelShell("On this page", "Stripe · SWE Intern");
    s += rect(x + 16, y + 94 + (pressed ? 2 : 0), w - 32, 44, done ? "#0B1F14" : BLUE, `rx="10" ${done ? `stroke="#1F4D33"` : ""}`);
    s += done
      ? check(x + 34, y + 110) + text(x + 56, y + 122, "Filled in seconds", { size: 14, weight: 700, fill: GREEN })
      : text(x + w / 2, y + 122 + (pressed ? 2 : 0), t < T.fill ? "Fill application" : "Filling…", { size: 15, weight: 700, fill: "#000", anchor: "middle" });
    const filled = FILL_ORDER.filter((i) => t >= FIELDS[i].at + 0.1).length;
    s += rect(x + 16, y + 156, w - 32, 6, LINE, `rx="3"`) + rect(x + 16, y + 156, ((w - 32) * filled) / FILL_ORDER.length, 6, done ? GREEN : BLUE, `rx="3"`);
    s += text(x + 16, y + 182, `${filled} of ${FILL_ORDER.length} answers filled`, { size: 11, fill: MUTED, font: MONO });
    ["Details from your profile", "Questions answered"].forEach((line, i) => {
      const on = filled >= [3, 5][i];
      s += (on ? check(x + 16, y + 202 + i * 24) : rect(x + 18, y + 204 + i * 24, 10, 10, "none", `stroke="${LINE}" rx="2"`)) + text(x + 38, y + 214 + i * 24, line, { size: 12, fill: on ? INK : MUTED });
    });
    return s;
  }
  if (t < T.letter) {
    let s = `<g opacity="${span(t, T.attach, T.attach + 0.25)}">` + panelShell("Your files", "Attach in one click");
    FILES.forEach(([label, name], i) => {
      const ry = y + 94 + i * 52;
      const attachedAt = i === 0 ? T.resumeClick : i === 2 ? T.portfolioClick : Infinity;
      const attached = t >= attachedAt;
      const pressed = t >= attachedAt - 0.1 && t < attachedAt + 0.1;
      s += rect(x + 16, ry, w - 32, 44, attached ? "#0B1F14" : CARD, `rx="8" stroke="${attached ? "#1F4D33" : LINE}"`);
      s += (i === 2 ? linkIcon(x + 26, ry + 16) : fileIcon(x + 27, ry + 16, i === 3 ? MUTED : BLUE));
      s += text(x + 44, ry + 19, label, { size: 11, fill: MUTED }) + text(x + 44, ry + 35, name.length > 22 ? `${name.slice(0, 21)}…` : name, { size: 12, weight: 600 });
      s += attached
        ? check(x + w - 42, ry + 16)
        : rect(x + w - 74, ry + 11 + (pressed ? 1 : 0), 50, 22, i === 0 || i === 2 ? BLUE : "#1A1A20", `rx="6"`) + text(x + w - 49, ry + 26 + (pressed ? 1 : 0), "Attach", { size: 11, weight: 700, fill: i === 0 || i === 2 ? "#000" : SOFT, anchor: "middle" });
    });
    if (t >= T.portfolioClick + 0.4) s += text(x + 16, y + 314, "2 files attached", { size: 11, fill: GREEN, font: MONO });
    return s + "</g>";
  }
  if (t < T.people) {
    let s = `<g opacity="${span(t, T.letter, T.letter + 0.25)}">` + panelShell("Cover letter", "Written for this job");
    const shown = LETTER.length * span(t, T.letter + 0.3, T.letter + 1.7);
    LETTER.forEach((line, i) => {
      if (i > shown) return;
      s += text(x + 16, y + 104 + i * 18, i + 1 > shown ? type(line, shown - i) : line, { size: 12, fill: SOFT });
    });
    const attached = t >= T.letter + 1.8;
    s += rect(x + 16, y + 280, w - 32, 34, attached ? "#0B1F14" : "#1A1A20", `rx="8" ${attached ? `stroke="#1F4D33"` : ""}`);
    s += attached ? check(x + 70, y + 291) + text(x + 92, y + 302, "Attached", { size: 13, weight: 700, fill: GREEN }) : text(x + w / 2, y + 302, "Attach to application", { size: 13, weight: 600, anchor: "middle" });
    return s + "</g>";
  }
  let s = `<g opacity="${span(t, T.people, T.people + 0.25)}">` + panelShell("Follow up", "People at Stripe");
  PEOPLE.forEach(([name, role], i) => {
    const k = easeOut(span(t, T.people + 0.35 + i * 0.3, T.people + 0.65 + i * 0.3));
    if (!k) return;
    const py = y + 96 + i * 62 + (1 - k) * 12;
    s += `<g opacity="${k}">` + rect(x + 16, py, w - 32, 52, CARD, `rx="8" stroke="${LINE}"`);
    s += `<circle cx="${x + 38}" cy="${py + 26}" r="12" fill="#1F2A44"/>` + text(x + 38, py + 30, name[0], { size: 12, weight: 700, fill: BLUE, anchor: "middle" });
    s += text(x + 58, py + 22, name, { size: 13, weight: 700 }) + text(x + 58, py + 39, role, { size: 11, fill: MUTED });
    s += rect(x + w - 74, py + 15, 46, 22, BLUE, `rx="6"`) + text(x + w - 51, py + 30, "Email", { size: 11, weight: 700, fill: "#000", anchor: "middle" }) + "</g>";
  });
  if (t >= T.people + 1.4) s += text(x + 16, y + 300, "Emails checked · drafts ready", { size: 11, fill: GREEN, font: MONO });
  return s + "</g>";
}

/** Columns of the tracker board, and where the new Stripe card lands. */
const COL_X = (i: number) => 36 + i * 164;
const NEW_CARD_Y = 152;

/** The tracker: every job you applied to, with the new one dropping into Applied. */
function tracker(t: number) {
  let s = text(48, 72, "Your applications", { size: 20, weight: 700 });
  const count = t >= T.tracker + 0.95 ? 13 : 12;
  s += text(48, 91, `${count} applied this week · logged automatically`, { size: 12, fill: MUTED });
  BOARD.forEach(([stage, color, cards], col) => {
    const cx = COL_X(col);
    s += rect(cx, 104, 152, 262, "#0A0A0C", `rx="8" stroke="#1F1F24"`) + text(cx + 12, 124, stage, { size: 10, weight: 700, fill: color, font: MONO });
    const shift = col === 1 ? easeOut(span(t, T.tracker + 0.6, T.tracker + 0.95)) * 54 : 0;
    cards.forEach(([company, role], i) => {
      const cy = 136 + i * 54 + shift;
      s += rect(cx + 8, cy, 136, 46, CARD, `rx="6" stroke="${LINE}"`) + text(cx + 18, cy + 20, company, { size: 13, weight: 700 }) + text(cx + 18, cy + 36, role, { size: 11, fill: MUTED });
    });
  });
  // The new card, carried down by the spider.
  const drop = easeOut(span(t, T.tracker + 0.4, T.tracker + 0.95));
  if (drop > 0) {
    const cx = COL_X(1) + 8, cy = lerp(40, NEW_CARD_Y - 16, drop);
    const glow = t >= T.tracker + 0.95 ? 1 - span(t, T.tracker + 1.6, T.tracker + 2.1) : 0;
    s += rect(cx, cy, 136, 46, "#0E1A2E", `rx="6" stroke="${BLUE}" stroke-width="${1 + glow}"`);
    s += text(cx + 10, cy + 20, "Stripe", { size: 13, weight: 700 }) + text(cx + 10, cy + 36, "SWE Intern", { size: 11, fill: MUTED });
    if (t >= T.tracker + 1.0) s += text(cx + 126, cy + 20, "just now", { size: 9, fill: GREEN, anchor: "end", font: MONO });
  }
  return s;
}

const CAPTIONS: Array<[number, number, string, string]> = [
  [T.click, T.attach, "1", "Fills the whole application"],
  [T.attach, T.letter, "2", "Attaches your resume and portfolio"],
  [T.letter, T.people, "3", "Writes a cover letter for each job"],
  [T.people, T.tracker, "4", "Finds who to follow up with"],
  [T.tracker, T.end - 0.1, "5", "Logs every job you apply to"],
];

function caption(t: number) {
  for (const [from, to, n, words] of CAPTIONS) {
    if (t < from || t >= to) continue;
    const k = easeOut(span(t, from, from + 0.25)) * (1 - span(t, to - 0.2, to));
    const y = 422 + (1 - k) * 10;
    return `<g opacity="${k}">` + rect(28, y - 22, 30, 30, BLUE, `rx="6"`) + text(43, y - 1, n, { size: 16, weight: 800, fill: "#000", anchor: "middle" }) + text(70, y, words, { size: 22, weight: 700 }) + "</g>";
  }
  return "";
}

/** Where the small spider hangs at time t (on the page, between the form and the panel). */
function smallSpider(t: number, talk: boolean) {
  if (t >= T.tracker) {
    // Over the Applied column, carrying the new card down, then back up.
    const move = easeInOut(span(t, T.tracker, T.tracker + 0.35));
    const back = easeInOut(span(t, T.tracker + 1.3, T.tracker + 1.8));
    const down = easeOut(span(t, T.tracker + 0.4, T.tracker + 0.95)) * (1 - back);
    // Then off to the empty top-right, clear of the heading.
    const cx = lerp(lerp(SPIDER_X, COL_X(1) + 76, move), 640, back);
    return spider(cx, lerp(52, NEW_CARD_Y - 44, down), 1.3, down > 0 && down < 1, 46);
  }
  const filling = FILL_ORDER.find((i) => t >= FIELDS[i].at && t < FIELDS[i].at + T.step);
  const attaching = t >= T.resumeClick - 0.3 && t < T.portfolioClick + 0.5 ? (t < T.portfolioClick - 0.3 ? 3 : 4) : undefined;
  const at = filling ?? attaching;
  return spider(SPIDER_X, at === undefined ? 52 : FIELD_Y(at) + 2, 1.3, at !== undefined && talk, 46);
}

function frame(t: number) {
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` + rect(0, 0, W, H, BG);
  const windowIn = easeOut(span(t, 0.75, 1.25)) * (1 - span(t, T.end - 0.2, T.end + 0.1));
  const talk = Math.floor(t * 6) % 2 === 0;
  if (windowIn > 0) {
    const toTracker = span(t, T.tracker, T.tracker + 0.3);
    s += `<g opacity="${windowIn}">` + windowFrame(toTracker < 0.5 ? "boards.greenhouse.io/stripe/jobs/intern-2026" : "unnepo.com/applications");
    if (toTracker < 1) s += `<g opacity="${1 - toTracker}">${application(t)}${panel(t)}</g>`;
    if (toTracker > 0) s += `<g opacity="${toTracker}">${tracker(t)}</g>`;
    s += "</g>";
  }

  // The spider: drops in big, then shrinks onto the page, then comes back for the pitch.
  if (t < 1.25) {
    const drop = easeOut(span(t, 0, 0.4));
    const shrink = easeInOut(span(t, 0.55, 1.15));
    const scale = lerp(8, 1.3, shrink);
    s += spider(lerp(W / 2, SPIDER_X, shrink), lerp(lerp(-90, 70, drop), 52, shrink), scale, t < 0.55 ? talk : false, lerp(0, 46, shrink));
    if (t < 0.6) s += text(W / 2, 360, "unnepo.", { size: 44, weight: 800, anchor: "middle", opacity: 1 - span(t, 0.5, 0.6) });
  } else if (t < T.end) {
    s += `<g opacity="${windowIn}">${smallSpider(t, talk)}</g>`;
  } else {
    const k = easeOut(span(t, T.end, T.end + 0.35));
    s += spider(W / 2, lerp(-120, 34, k), 4, talk && t > T.end + 0.4, 0);
    s += text(W / 2, 228, "Apply to jobs in 1 minute, not 25.", { size: 30, weight: 800, anchor: "middle", opacity: span(t, T.end + 0.25, T.end + 0.55) });
    s += `<g opacity="${span(t, T.end + 0.45, T.end + 0.75)}">` + rect(W / 2 - 130, 256, 260, 52, BLUE, `rx="12"`) + text(W / 2, 289, "Add to Chrome, it's free", { size: 18, weight: 700, fill: "#000", anchor: "middle" }) + "</g>";
    s += text(W / 2, 340, "Free for students · unnepo.com", { size: 14, fill: MUTED, anchor: "middle", opacity: span(t, T.end + 0.6, T.end + 0.9) });
  }

  // The cursor: presses Fill, then Attach on the resume and the portfolio.
  const moves: Array<[number, number, number, number, number, number]> = [
    [T.click, 1.95, 300, 330, 566, 166],
    [T.resumeClick - 0.4, T.resumeClick, 566, 166, 650, 162],
    [T.portfolioClick - 0.4, T.portfolioClick, 650, 162, 650, 266],
  ];
  for (const [from, to, x0, y0, x1, y1] of moves) {
    if (t >= from && t < to + 0.35) {
      const k = easeInOut(span(t, from, to));
      s += cursor(lerp(x0, x1, k), lerp(y0, y1, k));
    }
  }
  s += caption(t);
  return s + "</svg>";
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const count = Math.round(T.length * FPS);
  const frames: Buffer[] = [];
  for (let i = 0; i < count; i++) frames.push(await sharp(Buffer.from(frame(i / FPS))).ensureAlpha().raw().toBuffer());

  // Merge runs of identical frames into one longer frame.
  const unique: Buffer[] = [];
  const delays: number[] = [];
  const step = Math.round(1000 / FPS);
  for (const buf of frames) {
    if (unique.length && unique[unique.length - 1].equals(buf)) delays[delays.length - 1] += step;
    else { unique.push(buf); delays.push(step); }
  }
  delays[delays.length - 1] += 1400; // hold the pitch before looping

  const png = (buf: Buffer, width = W) => sharp(buf, { raw: { width: W, height: H, channels: 4 } }).resize(width).png().toBuffer();
  const pngs = await Promise.all(unique.map((buf) => png(buf)));
  await sharp(pngs, { join: { animated: true } }).webp({ lossless: true, effort: 6, loop: 0, delay: delays }).toFile(path.join(OUT, "demo.webp"));
  const small = await Promise.all(unique.map((buf) => png(buf, 480)));
  await sharp(small, { join: { animated: true } }).gif({ loop: 0, delay: delays, colours: 64, effort: 10, dither: 0, interFrameMaxError: 0 }).toFile(path.join(OUT, "demo.gif"));
  const still = await sharp(Buffer.from(frame(FILL_DONE + 0.1))).flatten({ background: BG }).jpeg({ quality: 82, mozjpeg: true }).toFile(path.join(OUT, "demo.jpg"));
  console.log(`${unique.length} frames (${count} drawn), poster ${still.width}×${still.height}`);
}

main();
