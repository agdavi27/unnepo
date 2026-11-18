/**
 * Draws the /get demo: Unnepo's spider drops in big, shrinks onto a job application, then shows the three things the
 * extension does (fills the form, writes the cover letter, finds people to follow up with) and ends on the pitch.
 * Writes public/get/demo.webp (the page), demo.gif (emails, 480 px) and demo.jpg (the still for reduced motion).
 * Run: npx jiti scripts/demo-animation.ts
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { ART_H, ART_W, artRects, spiderArt, spiderPalette } from "../lib/spiders";

const W = 720;
const H = 450;
const FPS = 12.5;
const LENGTH = 10.4;
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

const PALETTE = spiderPalette({ skin: "classic" });
const SPIDER = { shut: artRects(spiderArt(false, { skin: "classic" }), PALETTE), open: artRects(spiderArt(true, { skin: "classic" }), PALETTE) };

/** The spider centered at (cx, top), `scale` px per art pixel, hanging from a thread down from `threadTop`. */
function spider(cx: number, top: number, scale: number, open: boolean, threadTop = 0) {
  const x = cx - (ART_W * scale) / 2;
  const thread = top > threadTop ? rect(cx - Math.max(1, scale / 2), threadTop, Math.max(2, scale), top - threadTop + scale * 2, "#D4D4DA") : "";
  return `${thread}<g transform="translate(${x} ${top}) scale(${scale})" shape-rendering="crispEdges">${open ? SPIDER.open : SPIDER.shut}</g>`;
}

const FIELDS = [
  { label: "First name", value: "Jordan" },
  { label: "Last name", value: "Lee" },
  { label: "Email", value: "jordan.lee@school.edu" },
  { label: "Resume", value: "Jordan_Lee_Resume.pdf", file: true },
  { label: "Why do you want to work at Stripe?", value: "I built a payments app for my campus club and…" },
  { label: "Are you authorized to work in the US?", value: "Yes" },
];
const FILL_START = 2.3;
/** Where the small spider hangs: between the form and the panel, beside the field being filled. */
const SPIDER_X = 412;
const FIELD_STEP = 0.38;

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

/** The browser window with the job application in it. */
function browser(t: number, opacity: number) {
  const x = 20, y = 14, w = 680, h = 370;
  let s = `<g opacity="${opacity}">`;
  s += rect(x, y, w, h, CARD, `rx="12" stroke="${LINE}" stroke-width="2"`);
  s += rect(x + 1, y + 1, w - 2, 30, "#141418", `rx="11"`) + rect(x + 1, y + 20, w - 2, 12, "#141418");
  for (const [i, c] of ["#FF5F57", "#FEBC2E", "#28C840"].entries()) s += `<circle cx="${x + 18 + i * 16}" cy="${y + 16}" r="5" fill="${c}"/>`;
  s += rect(x + 80, y + 7, 380, 18, "#0A0A0C", `rx="9"`) + text(x + 94, y + 20, "boards.greenhouse.io/stripe/jobs/intern-2026", { size: 11, fill: MUTED });
  // The job and its form.
  s += text(x + 28, y + 64, "Software Engineering Intern", { size: 20, weight: 700 });
  s += text(x + 28, y + 84, "Stripe · New York · Summer 2026", { size: 12, fill: MUTED });
  FIELDS.forEach((field, i) => {
    const fy = y + 104 + i * 42;
    const at = FILL_START + i * FIELD_STEP;
    const k = span(t, at, at + FIELD_STEP * 0.8);
    s += text(x + 28, fy, field.label, { size: 11, fill: SOFT });
    const active = k > 0 && k < 1;
    s += rect(x + 28, fy + 6, 330, 24, "#070708", `rx="6" stroke="${active ? BLUE : k >= 1 ? "#1F4D33" : LINE}" stroke-width="${active ? 2 : 1}"`);
    if (k > 0) {
      if (field.file) s += rect(x + 38, fy + 12, 9, 12, BLUE, `rx="1"`) + text(x + 54, fy + 23, type(field.value, k * 1.6), { size: 12, fill: INK });
      else s += text(x + 38, fy + 23, type(field.value, k), { size: 12, fill: INK });
    }
    if (k >= 1) s += check(x + 336, fy + 13);
  });
  return s + "</g>";
}

/** The extension's panel down the right of the window: the Fill button, then the letter, then the people. */
function panel(t: number, opacity: number) {
  const x = 440, y = 46, w = 252, h = 330;
  let s = `<g opacity="${opacity}">`;
  s += rect(x, y, w, h, "#101014", `rx="10" stroke="${LINE}" stroke-width="1.5"`);
  s += text(x + 16, y + 26, "unnepo", { size: 15, weight: 700 }) + text(x + 66, y + 26, ".", { size: 15, weight: 700, fill: BLUE });

  const letterIn = span(t, 4.6, 4.9);
  const peopleIn = span(t, 6.9, 7.2);
  if (letterIn === 0) {
    // On this page: the Fill button, pressed, then the progress.
    const pressed = t >= 1.95 && t < 2.15;
    const done = t >= FILL_START + FIELDS.length * FIELD_STEP;
    s += text(x + 16, y + 58, "On this page", { size: 11, fill: MUTED });
    s += text(x + 16, y + 78, "Stripe · SWE Intern", { size: 14, weight: 600 });
    s += rect(x + 16, y + 94 + (pressed ? 2 : 0), w - 32, 44, done ? "#0B1F14" : BLUE, `rx="10" ${done ? `stroke="#1F4D33"` : ""}`);
    s += done
      ? check(x + 34, y + 110, GREEN) + text(x + 56, y + 122, "Ready to submit · 1 min", { size: 14, weight: 700, fill: GREEN })
      : text(x + w / 2, y + 122 + (pressed ? 2 : 0), t < FILL_START ? "Fill application" : "Filling…", { size: 15, weight: 700, fill: "#000", anchor: "middle" });
    const filled = clamp(Math.floor((t - FILL_START) / FIELD_STEP) + (t >= FILL_START ? 1 : 0), 0, FIELDS.length);
    s += rect(x + 16, y + 156, w - 32, 6, LINE, `rx="3"`) + rect(x + 16, y + 156, ((w - 32) * filled) / FIELDS.length, 6, done ? GREEN : BLUE, `rx="3"`);
    s += text(x + 16, y + 182, `${filled} of ${FIELDS.length} fields filled`, { size: 11, fill: MUTED, font: MONO });
    ["Details from your profile", "Resume attached", "Questions answered"].forEach((line, i) => {
      const on = filled >= [2, 4, 6][i];
      s += (on ? check(x + 16, y + 202 + i * 24) : rect(x + 18, y + 204 + i * 24, 10, 10, "none", `stroke="${LINE}" rx="2"`)) + text(x + 38, y + 214 + i * 24, line, { size: 12, fill: on ? INK : MUTED });
    });
  } else if (peopleIn === 0) {
    s += `<g opacity="${letterIn}">`;
    s += text(x + 16, y + 58, "Cover letter", { size: 11, fill: MUTED }) + text(x + 16, y + 78, "Written for this job", { size: 14, weight: 600 });
    const k = span(t, 4.9, 6.3);
    const shown = LETTER.length * k;
    LETTER.forEach((line, i) => {
      if (i > shown) return;
      s += text(x + 16, y + 104 + i * 18, i + 1 > shown ? type(line, shown - i) : line, { size: 12, fill: SOFT });
    });
    const attached = t >= 6.4;
    s += rect(x + 16, y + 280, w - 32, 34, attached ? "#0B1F14" : "#1A1A20", `rx="8" ${attached ? `stroke="#1F4D33"` : ""}`);
    s += attached ? check(x + 70, y + 291) + text(x + 92, y + 302, "Attached", { size: 13, weight: 700, fill: GREEN }) : text(x + w / 2, y + 302, "Attach to application", { size: 13, weight: 600, anchor: "middle" });
    s += "</g>";
  } else {
    s += `<g opacity="${peopleIn}">`;
    s += text(x + 16, y + 58, "Follow up", { size: 11, fill: MUTED }) + text(x + 16, y + 78, "People at Stripe", { size: 14, weight: 600 });
    PEOPLE.forEach(([name, role], i) => {
      const k = easeOut(span(t, 7.25 + i * 0.3, 7.55 + i * 0.3));
      if (!k) return;
      const py = y + 96 + i * 62 + (1 - k) * 12;
      s += `<g opacity="${k}">` + rect(x + 16, py, w - 32, 52, "#0C0C0E", `rx="8" stroke="${LINE}"`);
      s += `<circle cx="${x + 38}" cy="${py + 26}" r="12" fill="#1F2A44"/>` + text(x + 38, py + 30, name[0], { size: 12, weight: 700, fill: BLUE, anchor: "middle" });
      s += text(x + 58, py + 22, name, { size: 13, weight: 700 }) + text(x + 58, py + 39, role, { size: 11, fill: MUTED });
      s += rect(x + w - 74, py + 15, 46, 22, BLUE, `rx="6"`) + text(x + w - 51, py + 30, "Email", { size: 11, weight: 700, fill: "#000", anchor: "middle" });
      s += "</g>";
    });
    if (t >= 8.3) s += text(x + 16, y + 300, "Emails checked · drafts ready", { size: 11, fill: GREEN, font: MONO });
    s += "</g>";
  }
  return s + "</g>";
}

const CAPTIONS: Array<[number, number, string, string]> = [
  [1.6, 4.5, "1", "Fills the whole application"],
  [4.5, 6.8, "2", "Writes a cover letter for each job"],
  [6.8, 8.9, "3", "Finds who to follow up with"],
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

function frame(t: number) {
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` + rect(0, 0, W, H, BG);
  const windowIn = easeOut(span(t, 0.75, 1.25)) * (1 - span(t, 8.9, 9.2));
  if (windowIn > 0) s += browser(t, windowIn) + panel(t, windowIn);

  // The spider: drops in big, then shrinks onto the page (hanging over the panel), then comes back for the pitch.
  const talk = Math.floor(t * 6) % 2 === 0;
  if (t < 1.25) {
    const drop = easeOut(span(t, 0, 0.4));
    const shrink = easeInOut(span(t, 0.55, 1.15));
    const scale = lerp(8, 1.3, shrink);
    const cx = lerp(W / 2, SPIDER_X, shrink);
    const top = lerp(lerp(-ART_H * 8, 70, drop), 52, shrink);
    s += spider(cx, top, scale, t < 0.55 ? talk : false, lerp(0, 46, shrink));
    if (t < 0.6) s += text(W / 2, 360, "unnepo.", { size: 44, weight: 800, anchor: "middle", opacity: span(t, 0.15, 0.35) * (1 - span(t, 0.5, 0.6)) });
  } else if (t < 9.0) {
    // Small, hanging from the top of the panel; bobs down to the field being filled.
    const i = clamp(Math.floor((t - FILL_START) / FIELD_STEP), 0, FIELDS.length - 1);
    const filling = t >= FILL_START && t < FILL_START + FIELDS.length * FIELD_STEP;
    const target = filling ? 116 + i * 42 : 52;
    s += spider(SPIDER_X, target, 1.3, filling && talk, 46);
  } else {
    const k = easeOut(span(t, 9.0, 9.35));
    s += spider(W / 2, lerp(-120, 34, k), 4, talk && t > 9.4, 0);
    const a = span(t, 9.25, 9.55);
    s += text(W / 2, 228, "Apply to jobs in 1 minute, not 25.", { size: 30, weight: 800, anchor: "middle", opacity: a });
    s += `<g opacity="${span(t, 9.45, 9.75)}">` + rect(W / 2 - 130, 256, 260, 52, BLUE, `rx="12"`) + text(W / 2, 289, "Add to Chrome, it's free", { size: 18, weight: 700, fill: "#000", anchor: "middle" }) + "</g>";
    s += text(W / 2, 340, "Free for students · unnepo.com", { size: 14, fill: MUTED, anchor: "middle", opacity: span(t, 9.6, 9.9) });
  }

  // The click on Fill.
  if (t >= 1.6 && t < 2.3) {
    const k = easeInOut(span(t, 1.6, 1.95));
    const cx = lerp(300, 566, k), cy = lerp(330, 166, k);
    s += `<path d="M${cx} ${cy} l0 18 l5 -5 l4 9 l3 -1.5 l-4 -8.5 l7 0 z" fill="#fff" stroke="#000" stroke-width="1.2"/>`;
  }
  s += caption(t);
  return s + "</svg>";
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const count = Math.round(LENGTH * FPS);
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
  const still = await sharp(Buffer.from(frame(4.35))).flatten({ background: BG }).jpeg({ quality: 82, mozjpeg: true }).toFile(path.join(OUT, "demo.jpg"));
  console.log(`${unique.length} frames (${count} drawn), poster ${still.width}×${still.height}`);
}

main();
