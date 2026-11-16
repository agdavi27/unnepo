import { crawlerColors, type SpiderLook } from "@/lib/spiders";
import { COLORS, H, ON_DARK, W, spiderRects } from "./sprite";

/**
 * The side panel's spider is the same pixel spider that drops down on job pages (shared/sprite.ts), in the
 * student's colors, hanging head down from his thread. Talking wiggles his legs (the sprite's second frame);
 * poked, his cheeks go red and he shakes. Classes toggled by the panel: mouth-shut, mouth-open, mouth-angry.
 */

/** His colors: the student's skin, on Dark mode with the lighter body the website uses on its dark pages. */
function colorsFor(look: SpiderLook = { skin: "classic" }, light = false): Partial<Record<string, string>> {
  return { ...(light ? {} : ON_DARK), ...crawlerColors(look) };
}

/** Head down, as he hangs. */
const hanging = (rects: string) => `<g transform="rotate(180 ${W / 2} ${H / 2})">${rects}</g>`;

/** The spider as an SVG with his frames; toggle the "talking" class to wiggle his legs. `light` for Light mode. */
export function heroSpiderSvg(look: SpiderLook = { skin: "classic" }, light = false) {
  const colors = colorsFor(look, light);
  return `<svg viewBox="0 0 ${W} ${H}" width="${W * 3}" height="${H * 3}" shape-rendering="crispEdges" aria-hidden="true">`
    + `<g class="mouth-shut">${hanging(spiderRects(0, colors))}</g>`
    + `<g class="mouth-open">${hanging(spiderRects(1, colors))}</g>`
    + `<g class="mouth-angry">${hanging(spiderRects(1, { ...colors, c: "#FF4D4D" }))}</g></svg>`;
}

/** A small one, beside a question on the page or in a list. */
export function miniSpiderSvg(width = 18, look: SpiderLook = { skin: "classic" }, light = false) {
  return `<svg class="mini-spider" viewBox="0 0 ${W} ${H}" width="${width}" height="${Math.round((width * H) / W)}" shape-rendering="crispEdges" aria-hidden="true">${hanging(spiderRects(0, colorsFor(look, light)))}</svg>`;
}

const TYPING_W = 60;
const TYPING_H = 48;

/** The laptop, seen from behind its lid, in front of the spider: lid, glowing logo dot, and the base. */
const LAPTOP = [[13, 27, 34, 16, "#000000"], [14, 28, 32, 14, "#C9CDD6"], [14, 28, 32, 2, "#E6E9EF"], [14, 40, 32, 2, "#A9AEB9"], [8, 43, 44, 3, "#000000"], [9, 43, 42, 2, "#9AA0AC"], [26, 43, 8, 1, "#7D8390"]]
  .map(([x, y, w, h, fill]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`).join("");

/**
 * The spider typing on a laptop, head up behind its lid, drawn twice size in the 40×34 box at (10, 1).
 * Whoever shows it animates its classes: spider, foot left, foot right, logo and glow.
 */
export function typingSpiderSvg(width: number, look: SpiderLook = { skin: "classic" }, light = false) {
  const colors = colorsFor(look, light);
  const leg = colors.l ?? COLORS.l;
  return `<svg viewBox="0 0 ${TYPING_W} ${TYPING_H}" width="${width}" height="${Math.round((width * TYPING_H) / TYPING_W)}" shape-rendering="crispEdges" aria-hidden="true" style="color:${leg}">`
    + `<g transform="translate(10 1) scale(2)"><g class="spider">${spiderRects(0, colors)}</g></g>`
    + `<rect x="18" y="26" width="24" height="2" fill="#3D8BFF" opacity=".35" class="glow"/>`
    + LAPTOP
    + `<rect x="29" y="34" width="2" height="2" fill="#3D8BFF" class="logo"/>`
    + `<g class="foot left"><rect x="10" y="40" width="4" height="3" fill="#000"/><rect x="11" y="40" width="2" height="2" fill="currentColor"/></g>`
    + `<g class="foot right"><rect x="46" y="40" width="4" height="3" fill="#000"/><rect x="47" y="40" width="2" height="2" fill="currentColor"/></g></svg>`;
}
