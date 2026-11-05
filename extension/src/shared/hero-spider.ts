import { ART_H, ART_W, artRects, spiderArt, spiderPalette, type SpiderLook } from "@/lib/spiders";

/**
 * The talking spider at the top of the side panel: the student's spider from the Stats page (lib/spiders.ts),
 * with an open-mouth frame for when he talks.
 */

/** The spider as an SVG with both mouth frames; toggle the "talking" class to open his mouth. */
export function heroSpiderSvg(look: SpiderLook = { skin: "classic" }) {
  const palette = spiderPalette(look);
  return `<svg viewBox="0 0 ${ART_W} ${ART_H}" width="80" height="60" shape-rendering="crispEdges" aria-hidden="true"><g class="mouth-shut">${artRects(spiderArt(false, look), palette)}</g><g class="mouth-open">${artRects(spiderArt(true, look), palette)}</g></svg>`;
}

const TYPING_W = 60;
const TYPING_H = 48;

/** The laptop, seen from behind its lid, in front of the spider: lid, glowing logo dot, and the base. */
const LAPTOP = [[13, 27, 34, 16, "#000000"], [14, 28, 32, 14, "#C9CDD6"], [14, 28, 32, 2, "#E6E9EF"], [14, 40, 32, 2, "#A9AEB9"], [8, 43, 44, 3, "#000000"], [9, 43, 42, 2, "#9AA0AC"], [26, 43, 8, 1, "#7D8390"]]
  .map(([x, y, w, h, fill]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`).join("");

/** The spider typing on a laptop. Whoever shows it animates its classes: spider, foot left, foot right, logo and glow. */
export function typingSpiderSvg(width: number, look: SpiderLook = { skin: "classic" }) {
  const palette = spiderPalette(look);
  return `<svg viewBox="0 0 ${TYPING_W} ${TYPING_H}" width="${width}" height="${Math.round((width * TYPING_H) / TYPING_W)}" shape-rendering="crispEdges" aria-hidden="true" style="color:${palette.l}">`
    + `<g transform="translate(${(TYPING_W - ART_W) / 2} 1)"><g class="spider">${artRects(spiderArt(false, look), palette)}</g></g>`
    + `<rect x="18" y="26" width="24" height="2" fill="#3D8BFF" opacity=".35" class="glow"/>`
    + LAPTOP
    + `<rect x="29" y="34" width="2" height="2" fill="#3D8BFF" class="logo"/>`
    + `<g class="foot left"><rect x="10" y="40" width="4" height="3" fill="#000"/><rect x="11" y="40" width="2" height="2" fill="currentColor"/></g>`
    + `<g class="foot right"><rect x="46" y="40" width="4" height="3" fill="#000"/><rect x="47" y="40" width="2" height="2" fill="currentColor"/></g></svg>`;
}
