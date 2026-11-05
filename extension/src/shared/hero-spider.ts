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
