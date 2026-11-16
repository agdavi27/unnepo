import { spiderPalette, type SpiderLook } from "@/lib/spiders";

/**
 * The side panel's spider, kept simple: a round body, two dot eyes and eight thin legs, in one color. The classic
 * spider takes the panel's text color (white in Dark mode, near black in Light); another skin takes its own color.
 * Mouth frames for talking (open) and being poked (angry) are toggled by classes, as before.
 */

const W = 80;
const H = 60;

/** The color he's drawn in. */
function ink(look: SpiderLook = { skin: "classic" }, light = false) {
  return look.skin === "classic" ? "var(--fg)" : spiderPalette(look, light).l;
}

/** Four legs a side: up to a knee, then out and down to the foot. */
const LEFT_LEGS = [[30, 28, 22, 19, 15, 22], [29, 32, 19, 27, 11, 31], [29, 36, 19, 37, 12, 44], [31, 40, 23, 46, 20, 53]];
const LEGS = LEFT_LEGS.flatMap(([x1, y1, x2, y2, x3, y3]) => [
  `M${x1} ${y1}L${x2} ${y2}L${x3} ${y3}`,
  `M${W - x1} ${y1}L${W - x2} ${y2}L${W - x3} ${y3}`,
]).join("");

/** Legs, body and eyes, in currentColor; the eyes and mouth are cut out in the page's background. */
const BODY = `<path d="${LEGS}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
  + `<circle cx="40" cy="33" r="12" fill="currentColor"/>`
  + `<circle cx="35.5" cy="31" r="2.2" fill="var(--bg)"/><circle cx="44.5" cy="31" r="2.2" fill="var(--bg)"/>`;

const MOUTH_SHUT = `<path d="M37.5 37q2.5 2 5 0" fill="none" stroke="var(--bg)" stroke-width="1.4" stroke-linecap="round"/>`;
const MOUTH_OPEN = `<ellipse cx="40" cy="37.6" rx="2.2" ry="1.8" fill="var(--bg)"/>`;
const MOUTH_ANGRY = `<path d="M32.6 27.4l5 2M47.4 27.4l-5 2" stroke="var(--bg)" stroke-width="1.6" stroke-linecap="round"/><ellipse cx="40" cy="37.8" rx="2.4" ry="2" fill="#FF4D4D"/>`;

/** The spider as an SVG with his mouth frames; toggle the "talking" class to open his mouth. `light` for Light mode. */
export function heroSpiderSvg(look: SpiderLook = { skin: "classic" }, light = false) {
  return `<svg viewBox="0 0 ${W} ${H}" width="80" height="60" aria-hidden="true" style="color:${ink(look, light)}">`
    + `<line x1="40" y1="0" x2="40" y2="22" stroke="var(--thread)" stroke-width="1.5"/>`
    + BODY
    + `<g class="mouth-shut">${MOUTH_SHUT}</g><g class="mouth-open">${MOUTH_OPEN}</g><g class="mouth-angry">${MOUTH_ANGRY}</g></svg>`;
}

/** A small one, beside a question on the page or in a list. */
export function miniSpiderSvg(width = 18, look: SpiderLook = { skin: "classic" }, light = false) {
  return `<svg class="mini-spider" viewBox="8 16 64 42" width="${width}" height="${Math.round((width * 42) / 64)}" aria-hidden="true" style="color:${ink(look, light)}">${BODY}${MOUTH_SHUT}</svg>`;
}

const TYPING_W = 60;
const TYPING_H = 48;

/**
 * The spider typing on a laptop: he's drawn half size in the 40×30 box at (10, 1), the laptop's lid in front of him.
 * Whoever shows it animates its classes: spider, foot left, foot right, logo and glow.
 */
export function typingSpiderSvg(width: number, look: SpiderLook = { skin: "classic" }, light = false) {
  return `<svg viewBox="0 0 ${TYPING_W} ${TYPING_H}" width="${width}" height="${Math.round((width * TYPING_H) / TYPING_W)}" aria-hidden="true" style="color:${ink(look, light)}">`
    + `<g transform="translate(10 1) scale(.5)"><g class="spider">${BODY}${MOUTH_SHUT}</g></g>`
    + `<rect x="18" y="26" width="24" height="2" rx="1" fill="var(--accent)" opacity=".35" class="glow"/>`
    + `<rect x="14" y="27" width="32" height="15" rx="2" fill="var(--control)"/>`
    + `<circle cx="30" cy="34.5" r="1.3" fill="var(--accent)" class="logo"/>`
    + `<rect x="8" y="42" width="44" height="2.5" rx="1.25" fill="var(--muted)"/>`
    + `<g class="foot left"><circle cx="12" cy="40.5" r="1.8" fill="currentColor"/></g>`
    + `<g class="foot right"><circle cx="48" cy="40.5" r="1.8" fill="currentColor"/></g></svg>`;
}
