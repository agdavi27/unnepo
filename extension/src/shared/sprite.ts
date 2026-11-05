import { crawlerColors, isSkin, type SpiderLook } from "@/lib/spiders";

/**
 * Unnepo's spider: our own pixel drawing (round body, big eyes, pink cheeks, four legs a side), facing up.
 * The fill animation uses both leg frames; the website and extension icons are made from frame 0
 * (scripts/spider-icons.mjs).
 */

export const W = 20;
export const H = 17;
export const COLORS: Record<string, string> = { o: "#000000", b: "#2B2531", s: "#4A4252", l: "#1B171F", w: "#EAF6F2", p: "#1B171F", c: "#F2949E" };

/** On the website's dark pages: lighter legs and body, so the spider doesn't read as a black blob. Skins override these. */
export const ON_DARK: Record<string, string> = { b: "#3D3546", s: "#5C5368", l: "#8F86A0" };

type Point = [number, number];

/** The spider as a grid of color keys ("" is empty), outlined in black. */
export function spiderGrid(step: 0 | 1): string[][] {
  const g: string[][] = Array.from({ length: H }, () => Array<string>(W).fill(""));
  const set = (x: number, y: number, c: string) => { if (x >= 0 && x < W && y >= 0 && y < H) g[y][x] = c; };
  const legs: Point[][] = step === 0
    ? [[[6, 6], [5, 5], [4, 4], [4, 3], [3, 2]], [[5, 8], [4, 7], [3, 7], [2, 7], [1, 8]], [[5, 10], [4, 10], [3, 11], [2, 11], [2, 12]], [[6, 12], [5, 13], [4, 14], [4, 15]]]
    : [[[6, 6], [5, 5], [5, 4], [4, 3], [4, 2]], [[5, 8], [4, 8], [3, 8], [2, 8], [1, 9]], [[5, 10], [4, 11], [3, 11], [3, 12], [2, 13]], [[6, 12], [6, 13], [5, 14], [5, 15]]];
  for (const leg of legs) for (const [x, y] of leg) { set(x, y, "l"); set(W - 1 - x, y, "l"); }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const nx = (x + 0.5 - 10) / 4.6, ny = (y + 0.5 - 9.2) / 5;
    if (nx * nx + ny * ny <= 1) set(x, y, "b");
  }
  // Big eyes with the pupils looking ahead, cheeks, and a highlight on the back.
  for (const ex of [6, 11]) for (let dx = 0; dx < 3; dx++) for (let dy = 0; dy < 3; dy++) set(ex + dx, 5 + dy, "w");
  set(7, 6, "p"); set(12, 6, "p");
  set(5, 8, "c"); set(14, 8, "c");
  set(11, 11, "s");
  const out = g.map((row) => row.slice());
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (g[y][x]) continue;
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => g[y + dy]?.[x + dx])) out[y][x] = "o";
  }
  return out;
}

/** The spider as SVG rectangles, one per run of same-color pixels. */
export function spiderRects(step: 0 | 1, colors: Partial<Record<string, string>> = {}) {
  const out = spiderGrid(step);
  const palette = { ...COLORS, ...colors };
  let rects = "";
  for (let y = 0; y < H; y++) {
    let x = 0;
    while (x < W) {
      const c = out[y][x];
      if (!c) { x++; continue; }
      let w = 1;
      while (x + w < W && out[y][x + w] === c) w++;
      rects += `<rect x="${x}" y="${y}" width="${w}" height="1" fill="${palette[c]}"/>`;
      x += w;
    }
  }
  return rects;
}

/** The student's spider colors for the little sprite, kept in extension storage by the background worker. */
export async function storedSpiderColors(): Promise<Partial<Record<string, string>>> {
  try {
    const { spider } = (await chrome.storage.local.get("spider")) as { spider?: SpiderLook };
    return spider && isSkin(spider.skin) ? crawlerColors(spider) : {};
  } catch {
    return {};
  }
}
