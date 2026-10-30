/**
 * The talking spider at the top of the side panel: the same 40×30 spider as the Unnepo home page
 * (components/marketing/spider-dialogue.tsx), with an open-mouth frame for when he talks.
 */

const W = 40;
const H = 30;
const ACCENT = "#3D8BFF";
const PALETTE: Record<string, string> = {
  o: "#000000", b: "#6E5B6E", h: "#B48FAE", d: "#4E3549", a: ACCENT, k: "#7E6580", K: "#5A4258",
  l: "#6E5B6E", L: "#4E3549", e: ACCENT, w: "#FFFFFF", m: "#1A0E14", f: "#F7F7F8", p: "#965E8C",
};

function build(open: boolean): string[][] {
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
  set(17, 4, "w"); set(18, 4, "h");
  for (const [x, y] of [[19, 7], [20, 7], [18, 8], [21, 8], [19, 9], [20, 9], [19, 10], [20, 10]]) set(x, y, "a");
  blob(20, 17.8, 6.8, 5.2, "k", "h", "K");
  for (const [x, y] of [[16, 15], [17, 15], [16, 16], [17, 16], [22, 15], [23, 15], [22, 16], [23, 16]]) set(x, y, "e");
  set(16, 15, "w"); set(22, 15, "w"); set(14, 14, "e"); set(25, 14, "e");
  if (open) {
    for (let x = 17; x <= 22; x++) { set(x, 19, "m"); set(x, 20, "m"); }
    for (let x = 18; x <= 21; x++) set(x, 21, "m");
    set(19, 21, "p"); set(20, 21, "p"); set(18, 19, "f"); set(18, 20, "f"); set(21, 19, "f"); set(21, 20, "f");
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

function rects(grid: string[][]) {
  let svg = "";
  for (let y = 0; y < H; y++) {
    let x = 0;
    while (x < W) {
      const c = grid[y][x];
      if (!c) { x++; continue; }
      let w = 1;
      while (x + w < W && grid[y][x + w] === c) w++;
      svg += `<rect x="${x}" y="${y}" width="${w}" height="1" fill="${PALETTE[c]}"/>`;
      x += w;
    }
  }
  return svg;
}

/** The spider as an SVG with both mouth frames; toggle the "talking" class to open his mouth. */
export function heroSpiderSvg() {
  return `<svg viewBox="0 0 ${W} ${H}" width="80" height="60" shape-rendering="crispEdges" aria-hidden="true"><g class="mouth-shut">${rects(build(false))}</g><g class="mouth-open">${rects(build(true))}</g></svg>`;
}
