/**
 * Draws the talking spider for emails as animated GIFs in public/email/ (email apps don't show SVG).
 * Run: npx jiti scripts/email-spider-gif.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { ART_H, ART_W, spiderArt, spiderPalette } from "../lib/spiders";

const SCALE = 6;
const TOP = 8; // rows of thread above the spider
const W = ART_W;
const H = ART_H + TOP + 2; // room to bob down 2px

type Frame = { open: boolean; angry: boolean; drop: number; delay: number };

function grid(frame: Frame) {
  const art = spiderArt(frame.open, { skin: "classic" }, frame.angry);
  const g: string[][] = Array.from({ length: H }, () => Array<string>(W).fill(""));
  for (let y = 0; y < TOP + frame.drop + 3; y++) g[y][20] = "T"; // the thread he hangs from
  art.forEach((row, y) => row.forEach((c, x) => { if (c) g[y + TOP + frame.drop][x] = c; }));
  return g;
}

function hex(color: string) {
  const n = parseInt(color.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** GIF LZW, the standard variable-width scheme. */
function lzw(indices: number[], minSize: number) {
  const clear = 1 << minSize, end = clear + 1;
  let size = minSize + 1, next = end + 1;
  let dict = new Map<string, number>();
  const out: number[] = [];
  let bits = 0, acc = 0;
  const emit = (code: number) => {
    acc |= code << bits; bits += size;
    while (bits >= 8) { out.push(acc & 255); acc >>= 8; bits -= 8; }
  };
  emit(clear);
  let prefix = String(indices[0]);
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = `${prefix},${k}`;
    if (dict.has(key)) { prefix = key; continue; }
    emit(prefix.includes(",") ? dict.get(prefix)! : Number(prefix));
    if (next < 4096) {
      dict.set(key, next++);
      if (next > 1 << size && size < 12) size++;
    } else {
      emit(clear);
      dict = new Map(); size = minSize + 1; next = end + 1;
    }
    prefix = String(k);
  }
  emit(prefix.includes(",") ? dict.get(prefix)! : Number(prefix));
  emit(end);
  if (bits > 0) out.push(acc & 255);
  return out;
}

function gif(frames: Frame[], palette: Record<string, string>) {
  const keys = ["", ...Object.keys(palette)]; // 0 is transparent
  const colors = 32;
  const table: number[] = [];
  for (let i = 0; i < colors; i++) table.push(...(i && keys[i] ? hex(palette[keys[i]]) : [255, 255, 255]));
  const index = new Map(keys.map((key, i) => [key, i]));
  const width = W * SCALE, height = H * SCALE;
  const bytes: number[] = [];
  const word = (n: number) => bytes.push(n & 255, n >> 8);
  bytes.push(...Buffer.from("GIF89a"));
  word(width); word(height);
  bytes.push(0xf0 | 4, 0, 0); // global table of 32 colors
  bytes.push(...table);
  bytes.push(0x21, 0xff, 11, ...Buffer.from("NETSCAPE2.0"), 3, 1, 0, 0, 0); // loop forever
  for (const frame of frames) {
    const g = grid(frame);
    bytes.push(0x21, 0xf9, 4, 0b00001001, frame.delay & 255, frame.delay >> 8, 0, 0); // restore to background, transparent 0
    bytes.push(0x2c); word(0); word(0); word(width); word(height); bytes.push(0);
    const pixels: number[] = [];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels.push(index.get(g[Math.floor(y / SCALE)][Math.floor(x / SCALE)]) ?? 0);
    bytes.push(5);
    const data = lzw(pixels, 5);
    for (let i = 0; i < data.length; i += 255) { const chunk = data.slice(i, i + 255); bytes.push(chunk.length, ...chunk); }
    bytes.push(0);
  }
  bytes.push(0x3b);
  return Buffer.from(bytes);
}

const palette = { ...spiderPalette({ skin: "classic" }), T: "#9A9AA3", R: "#FF4D4D" };
const talk = (angry: boolean): Frame[] => [
  { open: false, angry, drop: 0, delay: 40 },
  { open: true, angry, drop: 1, delay: 12 },
  { open: false, angry, drop: 1, delay: 12 },
  { open: true, angry, drop: 2, delay: 12 },
  { open: false, angry, drop: 1, delay: 12 },
  { open: true, angry, drop: 1, delay: 12 },
  { open: false, angry, drop: 0, delay: 90 },
];

mkdirSync("public/email", { recursive: true });
writeFileSync("public/email/spider-talking.gif", gif(talk(false), palette));
writeFileSync("public/email/spider-angry.gif", gif(talk(true), palette));
console.log("wrote public/email/spider-talking.gif and spider-angry.gif");
