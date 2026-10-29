// Makes every Unnepo icon from the one pixel spider (extension/src/shared/sprite.ts): the website's
// favicon.ico, icon.svg and apple-icon.png, and the Chrome extension's toolbar icons. Run with
// `npm run icons` after changing the sprite, and commit what it writes.
import { build } from "esbuild";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundled = await build({ entryPoints: [path.join(root, "extension/src/shared/sprite.ts")], bundle: true, format: "esm", write: false, logLevel: "silent" });
const { spiderGrid, spiderRects, COLORS, W, H } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

// The spider sits on a blue tile, like the logo dot.
const TILE = "#3D8BFF";
const grid = spiderGrid(0);

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** A size×size RGBA image: rounded blue tile with the spider drawn `scale` pixels per sprite pixel. */
function render(size, scale) {
  const pixels = Buffer.alloc(size * size * 4);
  const radius = size * 0.22;
  const left = Math.floor((size - W * scale) / 2);
  const top = Math.floor((size - H * scale) / 2);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    // Outside the rounded corners stays transparent.
    const cx = Math.max(radius - x - 0.5, 0, x + 0.5 - (size - radius));
    const cy = Math.max(radius - y - 0.5, 0, y + 0.5 - (size - radius));
    if (cx * cx + cy * cy > radius * radius) continue;
    const key = grid[Math.floor((y - top) / scale)]?.[Math.floor((x - left) / scale)];
    const [r, g, b] = rgb(key && x >= left && y >= top ? COLORS[key] : TILE);
    pixels.set([r, g, b, 255], (y * size + x) * 4);
  }
  return pixels;
}

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (bytes) => {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}
function png(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) pixels.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

/** A .ico holding PNGs (every current browser reads these). */
function ico(images) {
  const head = Buffer.alloc(6 + images.length * 16);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach(({ size, data }, index) => {
    const at = 6 + index * 16;
    head.writeUInt8(size >= 256 ? 0 : size, at);
    head.writeUInt8(size >= 256 ? 0 : size, at + 1);
    head.writeUInt16LE(1, at + 4);
    head.writeUInt16LE(32, at + 6);
    head.writeUInt32LE(data.length, at + 8);
    head.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });
  return Buffer.concat([head, ...images.map((image) => image.data)]);
}

// Each size gets a whole number of screen pixels per sprite pixel, so it stays crisp.
const sizes = { 16: 0, 32: 1, 48: 2, 128: 5, 180: 7 };
const make = (size) => png(size, sizes[size] ? render(size, sizes[size]) : downsample(render(32, 1)));

/** 16px: every other pixel of the 32px icon. */
function downsample(big) {
  const small = Buffer.alloc(16 * 16 * 4);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) big.copy(small, (y * 16 + x) * 4, (y * 2 * 32 + x * 2) * 4, (y * 2 * 32 + x * 2) * 4 + 4);
  return small;
}

writeFileSync(path.join(root, "app/favicon.ico"), ico([16, 32, 48].map((size) => ({ size, data: make(size) }))));
writeFileSync(path.join(root, "app/apple-icon.png"), make(180));
const pad = 2;
writeFileSync(
  path.join(root, "app/icon.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad - 1.5} ${W + pad * 2} ${W + pad * 2}" shape-rendering="crispEdges"><rect x="${-pad}" y="${-pad - 1.5}" width="${W + pad * 2}" height="${W + pad * 2}" rx="${(W + pad * 2) * 0.22}" fill="${TILE}"/>${spiderRects(0)}</svg>\n`,
);
mkdirSync(path.join(root, "extension/icons"), { recursive: true });
for (const size of [16, 32, 48, 128]) writeFileSync(path.join(root, `extension/icons/${size}.png`), make(size));
console.log("Wrote app/favicon.ico, app/icon.svg, app/apple-icon.png, extension/icons/*.png");
