/**
 * Unnepo's spiders: the six a student can collect on the Stats page, and the pixel art that draws them.
 * The school spider wears a sweater in the school's color with its letters; the others unlock with
 * applications. The extension's panel spider, the crawling spiders, and the celebration all wear the one
 * the student picked.
 */

export type SkinId = "classic" | "school" | "blue" | "green" | "purple" | "gold" | "pink";

export type Skin = { id: SkinId; name: string; unlockAt: number; color: string };

export const SKINS: Skin[] = [
  { id: "classic", name: "Unnepo", unlockAt: 0, color: "#6E5B6E" },
  { id: "school", name: "School spirit", unlockAt: 0, color: "#6E5B6E" },
  { id: "blue", name: "Blue", unlockAt: 50, color: "#3D8BFF" },
  { id: "green", name: "Green", unlockAt: 150, color: "#2FBF71" },
  { id: "purple", name: "Purple", unlockAt: 300, color: "#9B5CFF" },
  { id: "gold", name: "Gold", unlockAt: 500, color: "#F2B227" },
  { id: "pink", name: "Pink", unlockAt: 1000, color: "#FF5C9A" },
];

export const isSkin = (value: unknown): value is SkinId => SKINS.some((skin) => skin.id === value);

export const skinUnlocked = (skin: Skin, applied: number) => applied >= skin.unlockAt;

/** The skin to wear: the one picked if it's unlocked, else the Unnepo spider from the website. */
export function wornSkin(picked: string | undefined | null, applied: number): SkinId {
  const skin = SKINS.find((item) => item.id === picked);
  return skin && skinUnlocked(skin, applied) ? skin.id : "classic";
}

/** The next spider to unlock and how many applications it takes. */
export function nextSkin(applied: number) {
  const skin = SKINS.find((item) => !skinUnlocked(item, applied));
  return skin ? { skin, left: skin.unlockAt - applied } : null;
}

export type SchoolStyle = { color: string; text: string; letters: string };

/** Sweater color, letter color, and letters for the schools Unnepo knows; others get their initials. */
const SCHOOL_STYLES: Record<string, SchoolStyle> = {
  "colby college": { color: "#002169", text: "#FFFFFF", letters: "C" },
  "university of vermont": { color: "#154734", text: "#FFD416", letters: "UVM" },
  "uvm": { color: "#154734", text: "#FFD416", letters: "UVM" },
  "university of pennsylvania": { color: "#011F5B", text: "#FFFFFF", letters: "P" },
  "university of pittsburgh": { color: "#003594", text: "#FFB81C", letters: "P" },
  "cornell university": { color: "#B31B1B", text: "#FFFFFF", letters: "C" },
  "columbia university": { color: "#6CACE4", text: "#FFFFFF", letters: "C" },
  "boston college": { color: "#8A100B", text: "#E0C48A", letters: "BC" },
  "new york university": { color: "#57068C", text: "#FFFFFF", letters: "NYU" },
  "university of washington": { color: "#4B2E83", text: "#B7A57A", letters: "W" },
  "university of texas at austin": { color: "#BF5700", text: "#FFFFFF", letters: "T" },
  "bowdoin college": { color: "#1A1A1A", text: "#FFFFFF", letters: "B" },
  "bates college": { color: "#881124", text: "#FFFFFF", letters: "B" },
  "middlebury college": { color: "#0D395F", text: "#FFFFFF", letters: "M" },
  "williams college": { color: "#500082", text: "#FFCC00", letters: "W" },
  "amherst college": { color: "#3F1F69", text: "#FFFFFF", letters: "A" },
  "brown university": { color: "#4E3629", text: "#ED1C24", letters: "B" },
  "dartmouth college": { color: "#00693E", text: "#FFFFFF", letters: "D" },
  "yale university": { color: "#00356B", text: "#FFFFFF", letters: "Y" },
  "harvard university": { color: "#A51C30", text: "#FFFFFF", letters: "H" },
  "princeton university": { color: "#E77500", text: "#121212", letters: "P" },
  "stanford university": { color: "#8C1515", text: "#FFFFFF", letters: "S" },
  "university of michigan": { color: "#00274C", text: "#FFCB05", letters: "M" },
  "university of california, berkeley": { color: "#003262", text: "#FDB515", letters: "CAL" },
  "georgetown university": { color: "#041E42", text: "#A7B1B7", letters: "G" },
  "duke university": { color: "#00539B", text: "#FFFFFF", letters: "D" },
  "northwestern university": { color: "#4E2A84", text: "#FFFFFF", letters: "N" },
};

const FALLBACK_COLORS = ["#1D4F91", "#7A1F2B", "#1F6B45", "#5B2C83", "#B35A00", "#0F5A6B"];
const FILLER = new Set(["of", "the", "at", "and", "for", "in"]);

export function schoolStyle(school: string | null | undefined): SchoolStyle | null {
  const name = (school ?? "").replace(/\s+/g, " ").trim();
  if (!name) return null;
  const known = SCHOOL_STYLES[name.toLowerCase()];
  if (known) return known;
  // "Colby College" is C; "University of Southern Maine" is USM.
  const words = name.split(/[\s,-]+/).filter((word) => word && !FILLER.has(word.toLowerCase()));
  const general = words.filter((word) => !/^(college|university|school|institute)$/i.test(word));
  const letters = (words[0] && /^university$/i.test(words[0]) ? words : general.length ? general : words).map((word) => word[0]).join("").toUpperCase().slice(0, 3)
    || name[0].toUpperCase();
  const hash = [...name].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7);
  return { color: FALLBACK_COLORS[hash % FALLBACK_COLORS.length], text: "#FFFFFF", letters: letters.length === 2 && general.length === 1 ? letters[0] : letters };
}

/** Lighter (amount > 0) or darker (amount < 0) by mixing with white or black. */
export function shade(hex: string, amount: number) {
  const value = parseInt(hex.replace("#", ""), 16);
  const target = amount > 0 ? 255 : 0;
  const mix = (channel: number) => Math.round(channel + (target - channel) * Math.abs(amount));
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map(mix);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1).toUpperCase()}`;
}

/** 3×5 pixel letters for the school sweater. */
const GLYPHS: Record<string, string> = {
  A: "010101111101101", B: "110101110101110", C: "011100100100011", D: "110101101101110", E: "111100110100111",
  F: "111100110100100", G: "011100101101011", H: "101101111101101", I: "111010010010111", J: "001001001101010",
  K: "101101110101101", L: "100100100100111", M: "101111111101101", N: "110101101101101", O: "010101101101010",
  P: "110101110100100", Q: "010101101110011", R: "110101110101101", S: "011100010001110", T: "111010010010010",
  U: "101101101101111", V: "101101101101010", W: "101101111111101", X: "101101010101101", Y: "101101010010010",
  Z: "111001010100111",
};

/** M and W need five columns to read as themselves. */
const WIDE: Record<string, string> = { M: "1000111011101011000110001", W: "1000110001101011101110001" };

const glyphRows = (letter: string) => {
  const wide = WIDE[letter];
  const bits = wide ?? GLYPHS[letter] ?? GLYPHS.O;
  const width = wide ? 5 : 3;
  return { width, rows: Array.from({ length: 5 }, (_, row) => bits.slice(row * width, row * width + width)) };
};

export const ART_W = 40;
export const ART_H = 30;

export type SpiderLook = { skin: SkinId; school?: string | null };

/** The colors for each pixel key, from the skin (and the school, for the school spider). */
export function spiderPalette(look: SpiderLook) {
  // The Unnepo spider: the same colors as the one hanging on the website's front page.
  if (look.skin === "classic") {
    return {
      o: "#000000", b: "#6E5B6E", h: "#B48FAE", d: "#4E3549", a: "#3D8BFF", e: "#3D8BFF", k: "#7E6580", K: "#5A4258",
      l: "#6E5B6E", L: "#4E3549", w: "#FFFFFF", m: "#1A0E14", f: "#F7F7F8", p: "#965E8C", t: "#FFFFFF", r: "#4E3549",
    } as Record<string, string>;
  }
  const skin = SKINS.find((item) => item.id === look.skin) ?? SKINS[0];
  const style = look.skin === "school" ? schoolStyle(look.school) : null;
  const body = skin.color;
  const back = style?.color ?? body;
  return {
    o: "#000000",
    b: back, h: shade(back, 0.35), d: shade(back, -0.3),
    k: shade(body, 0.12), K: shade(body, -0.15),
    l: body, L: shade(body, -0.3),
    a: skin.id === "school" ? "#3D8BFF" : shade(body, 0.55),
    e: skin.id === "school" ? "#3D8BFF" : shade(body, 0.55),
    t: style?.text ?? "#FFFFFF",
    r: shade(back, -0.45),
    m: "#1A0E14", w: "#FFFFFF", f: "#F7F7F8", p: "#965E8C",
  } as Record<string, string>;
}

/**
 * The hanging spider, 40×30, the same drawing as the website's front page (components/marketing/spider-dialogue.tsx):
 * a round back with a mark (a sweater with letters for the school spider), a face with glowing eyes and fangs,
 * and four legs a side. `open` opens the mouth.
 */
export function spiderArt(open: boolean, look: SpiderLook): string[][] {
  const W = ART_W, H = ART_H;
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
  const legs: Array<Array<[number, number]>> = [[[13, 10], [7, 4], [3, 13]], [[12, 13], [5, 9], [1, 19]], [[12, 16], [5, 15], [2, 24]], [[14, 19], [9, 21], [6, 27]]];
  for (const leg of legs) for (const side of [0, 1]) {
    const [hip, knee, foot] = leg.map((p): [number, number] => (side ? [W - 2 - p[0], p[1]] : p));
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
  blob(20, 9, 8.6, 7.2, "b", "h", "d");
  const style = look.skin === "school" ? schoolStyle(look.school) : null;
  if (!style) { set(17, 4, "w"); set(18, 4, "h"); }
  if (style) {
    // The sweater: a ribbed hem and the school's letters across the back.
    for (let x = 13; x <= 27; x++) if (g[12][x] === "b" || g[12][x] === "d" || g[12][x] === "h") set(x, 12, x % 2 ? "r" : "d");
    const glyphs = style.letters.slice(0, 3).split("").map(glyphRows);
    const width = glyphs.reduce((sum, glyph) => sum + glyph.width + 1, -1);
    let left = 20 - Math.ceil(width / 2);
    for (const glyph of glyphs) {
      glyph.rows.forEach((row, y) => row.split("").forEach((bit, x) => { if (bit === "1") set(left + x, 5 + y, "t"); }));
      left += glyph.width + 1;
    }
  } else {
    for (const [x, y] of [[19, 7], [20, 7], [18, 8], [21, 8], [19, 9], [20, 9], [19, 10], [20, 10]]) set(x, y, "a");
  }
  blob(20, 17.8, 6.8, 5.2, "k", "h", "K");
  for (const [x, y] of [[16, 15], [17, 15], [16, 16], [17, 16], [22, 15], [23, 15], [22, 16], [23, 16]]) set(x, y, "e");
  set(16, 15, "w"); set(22, 15, "w"); set(14, 14, "e"); set(25, 14, "e");
  if (open) {
    for (let x = 17; x <= 22; x++) { set(x, 19, "m"); set(x, 20, "m"); }
    for (let x = 18; x <= 21; x++) set(x, 21, "m");
    set(19, 21, "p"); set(20, 21, "p");
    set(18, 19, "f"); set(18, 20, "f"); set(21, 19, "f"); set(21, 20, "f");
  } else {
    for (let x = 18; x <= 21; x++) set(x, 20, "m");
    set(18, 21, "f"); set(21, 21, "f");
  }
  const out = g.map((row) => row.slice());
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (g[y][x]) continue;
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => g[y + dy]?.[x + dx])) out[y][x] = "o";
  }
  return out;
}

/** The art as SVG rectangles, one per run of same-colored pixels. */
export function artRects(grid: string[][], palette: Record<string, string>) {
  let svg = "";
  for (let y = 0; y < grid.length; y++) {
    let x = 0;
    while (x < grid[y].length) {
      const c = grid[y][x];
      if (!c) { x++; continue; }
      let w = 1;
      while (x + w < grid[y].length && grid[y][x + w] === c) w++;
      svg += `<rect x="${x}" y="${y}" width="${w}" height="1" fill="${palette[c]}"/>`;
      x += w;
    }
  }
  return svg;
}

/** The whole spider as an SVG string, for the extension and the Stats page. */
export function spiderSvg(look: SpiderLook, options: { open?: boolean; size?: number; grey?: boolean } = {}) {
  const palette = spiderPalette(look);
  const used = options.grey ? Object.fromEntries(Object.entries(palette).map(([key, color]) => [key, key === "o" ? "#000000" : greyOf(color)])) : palette;
  const size = options.size ?? 80;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ART_W} ${ART_H}" width="${size}" height="${Math.round((size * ART_H) / ART_W)}" shape-rendering="crispEdges" aria-hidden="true">${artRects(spiderArt(Boolean(options.open), look), used)}</svg>`;
}

function greyOf(hex: string) {
  const value = parseInt(hex.replace("#", ""), 16);
  const lum = Math.round(0.3 * ((value >> 16) & 255) + 0.59 * ((value >> 8) & 255) + 0.11 * (value & 255));
  const muted = Math.round(40 + lum * 0.35);
  return `#${((1 << 24) | (muted << 16) | (muted << 8) | muted).toString(16).slice(1)}`;
}

/** Colors for the small crawling spider (extension/src/shared/sprite.ts keys). */
export function crawlerColors(look: SpiderLook) {
  const palette = spiderPalette(look);
  return { b: palette.b, s: palette.h, l: palette.L };
}
