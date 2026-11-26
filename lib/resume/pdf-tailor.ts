import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFOperator, PDFOperatorNames, PDFRawStream, PDFRef, StandardFonts, decodePDFRawStream, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { BULLET_GLYPH, BULLET_START, EDITABLE, classify, isSection, type ResumeLine, type TailorPlan } from "@/lib/resume/tailor-lines";

/**
 * A PDF resume, tailored in its own layout. A PDF can't be edited in place reliably, so it's redrawn: every graphic
 * (rules, boxes, shading, pictures) is kept exactly as it was, with only the text taken out, and every line of text is
 * drawn again at its own position, size and color, in the closest standard font (Times for serif fonts, Helvetica for
 * sans, Courier for monospace, bold and italic kept), squeezed to the original's width so right-aligned dates still
 * line up. Only the lines the tailoring changed are laid out anew, inside the space their originals took, so the
 * resume keeps its page count. If a changed bullet won't fit, that one change is dropped.
 */

type FontInfo = { name: string; bold: boolean; italic: boolean; serif: boolean; mono: boolean };
type Item = { str: string; x: number; y: number; w: number; size: number; font: FontInfo; page: number };
/** `dot`: the bullet is a shape drawn beside it (kept as it is), not a character. */
type Segment = { page: number; items: Item[]; x0: number; x1: number; y: number; size: number; text: string; glyph: Item | null; textX: number; dot?: boolean };
type Block = { line: ResumeLine; segs: Segment[] };
export type PdfLayout = { kind: "pdf"; pages: Array<{ width: number; height: number; gutter: number | null }>; blocks: Block[]; lines: ResumeLine[]; scales: Map<string, number> };

const median = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

/** Times, Helvetica or Courier, bold and italic as the original font's name and flags say. */
function stdFont(font: FontInfo): StandardFonts {
  const name = font.name.toLowerCase();
  const bold = font.bold || /bold|black|heavy|semibold|demi|extrabold/.test(name);
  const italic = font.italic || /italic|oblique/.test(name);
  if (font.mono || /courier|mono|consolas|menlo/.test(name)) return bold ? (italic ? StandardFonts.CourierBoldOblique : StandardFonts.CourierBold) : italic ? StandardFonts.CourierOblique : StandardFonts.Courier;
  const serif = !/sans/.test(name) && (font.serif || /times|georgia|garamond|cambria|palatino|antiqua|baskerville|minion|caslon|didot|bodoni|merriweather|lora|playfair|charter|constantia|century|book|serif/.test(name));
  if (serif) return bold ? (italic ? StandardFonts.TimesRomanBoldItalic : StandardFonts.TimesRomanBold) : italic ? StandardFonts.TimesRomanItalic : StandardFonts.TimesRoman;
  return bold ? (italic ? StandardFonts.HelveticaBoldOblique : StandardFonts.HelveticaBold) : italic ? StandardFonts.HelveticaOblique : StandardFonts.Helvetica;
}

const isBold = (font: FontInfo) => /Bold/.test(stdFont(font));

/** Reads a PDF resume's lines and how each is drawn. Null when its text can't be read that way (scanned, rotated, too little). */
export async function readPdfLayout(bytes: Uint8Array): Promise<PdfLayout | null> {
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(bytes), { fontExtraProperties: true } as never);
  const items: Item[] = [];
  const pages: PdfLayout["pages"] = [];
  for (let number = 1; number <= pdf.numPages; number++) {
    const page = await pdf.getPage(number);
    if (page.rotate % 360 !== 0) return null;
    const [, , width, height] = page.view;
    pages.push({ width, height, gutter: null });
    await page.getOperatorList();
    const content = await page.getTextContent();
    for (const raw of content.items) {
      if (!("str" in raw) || !raw.str.trim()) continue;
      const [a, b, c, d, e, f] = raw.transform as number[];
      if (Math.abs(b) > 0.01 || Math.abs(c) > 0.01 || a <= 0) return null;
      let font: { name?: string; bold?: boolean; black?: boolean; italic?: boolean; isSerifFont?: boolean; isMonospace?: boolean } = {};
      try { if (page.commonObjs.has(raw.fontName)) font = page.commonObjs.get(raw.fontName); } catch { /* unknown font: Helvetica */ }
      const family = (content.styles[raw.fontName]?.fontFamily ?? "").toLowerCase();
      items.push({
        str: raw.str.replace(/\s+$/, ""), x: e, y: f, w: raw.width, size: Math.abs(d) || raw.height, page: number - 1,
        font: { name: (font.name ?? "").replace(/^[A-Z]{6}\+/, ""), bold: Boolean(font.bold || font.black), italic: Boolean(font.italic), serif: Boolean(font.isSerifFont) || family === "serif", mono: Boolean(font.isMonospace) || family === "monospace" },
      });
    }
  }
  if (items.length < 15) return null;
  const shapes = await PDFDocument.load(bytes, { ignoreEncryption: true }).then((doc) => doc.getPages().map((page) => stripText(pageContent(doc, page)).dots)).catch(() => pages.map(() => [] as Dot[]));
  const segments = pages.flatMap((page, index) => {
    const own = segmentsOf(items.filter((item) => item.page === index));
    for (const seg of own) {
      if (seg.glyph || BULLET_START.test(seg.text)) continue;
      seg.dot = (shapes[index] ?? []).some((dot) => dot.x < seg.x0 - 1.5 && dot.x > seg.x0 - seg.size * 1.8 && dot.y > seg.y - 1 && dot.y < seg.y + seg.size * 0.8);
    }
    page.gutter = gutterOf(own, page.width);
    // Two columns: the left one top to bottom, then the right.
    return page.gutter === null ? own : [...own.filter((seg) => seg.x0 < page.gutter!), ...own.filter((seg) => seg.x0 >= page.gutter!)];
  });
  const blocks = blocksOf(segments);
  const lines = classify(blocks.map((block) => ({ text: block.text, bullet: block.bullet })));
  // How much narrower each font is drawn than its standard stand-in, for new text in it.
  const ratios = new Map<string, number[]>();
  for (const item of items) {
    const key = stdFont(item.font);
    const natural = standardWidth(key, item.str, item.size);
    if (natural > 0 && item.str.length > 3) ratios.set(key, [...(ratios.get(key) ?? []), item.w / natural]);
  }
  const scales = new Map([...ratios].map(([key, list]) => [key, Math.min(1.25, Math.max(0.6, median(list)))]));
  return { kind: "pdf", pages, lines, scales, blocks: blocks.map((block, index) => ({ line: lines[index], segs: block.segs })) };
}

/** Approximate widths of the standard fonts (average per character), only for picking a squeeze before pdf-lib loads. */
function standardWidth(font: StandardFonts, text: string, size: number) {
  const per = /Courier/.test(font) ? 0.6 : /Times/.test(font) ? 0.45 : 0.5;
  return text.length * per * size * (/Bold/.test(font) ? 1.05 : 1);
}

/** Text items on one page into the segments a reader sees: one row of text, split where a wide gap separates columns. */
function segmentsOf(items: Item[]): Segment[] {
  const rows: Item[][] = [];
  for (const item of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = rows.find((list) => Math.abs(list[0].y - item.y) < Math.min(list[0].size, item.size) * 0.4);
    if (row) row.push(item);
    else rows.push([item]);
  }
  const out: Segment[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    let current: Item[] = [];
    const flush = () => { if (current.length) out.push(segment(current)); current = []; };
    for (const item of row) {
      const last = current.at(-1);
      if (last && item.x - (last.x + last.w) > Math.max(last.size, item.size) * 2.2) flush();
      current.push(item);
    }
    flush();
  }
  return out.sort((a, b) => b.y - a.y || a.x0 - b.x0);
}

function segment(items: Item[]): Segment {
  let text = "";
  for (const [index, item] of items.entries()) {
    const last = items[index - 1];
    const gap = last ? item.x - (last.x + last.w) : 0;
    text += last && gap > item.size * 0.12 && !text.endsWith(" ") && !item.str.startsWith(" ") ? ` ${item.str}` : item.str;
  }
  const first = items[0];
  const second = items[1];
  // A bullet drawn as its own character, a little apart from the text after it.
  const glyph = second && first.str.trim().length === 1 && (BULLET_GLYPH.test(first.str.trim()) || (!/[\p{L}\p{N}]/u.test(first.str) && second.x - (first.x + first.w) > first.size * 0.15)) ? first : null;
  return {
    page: first.page, items, x0: first.x, x1: Math.max(...items.map((item) => item.x + item.w)), y: first.y, size: Math.max(...items.map((item) => item.size)),
    text: glyph ? text.slice(first.str.length).trim() : text.trim(), glyph, textX: glyph ? second.x : first.x,
  };
}

/** The page's content, decoded, as one stream of bytes. */
function pageContent(doc: PDFDocument, page: PDFPage) {
  const contents = page.node.Contents();
  const parts = contents instanceof PDFArray ? contents.asArray().map((ref) => doc.context.lookup(ref)) : contents ? [contents] : [];
  const joined = parts.map((part) => new TextDecoder("latin1").decode(decoded(part))).join("\n");
  return Uint8Array.from(joined, (char) => char.charCodeAt(0));
}

/** A gutter between two columns of real text (not right-aligned dates), or null for a one-column page. */
function gutterOf(segments: Segment[], width: number) {
  for (let x = width * 0.25; x <= width * 0.75; x += 2) {
    if (segments.some((seg) => seg.x0 < x - 2 && seg.x1 > x + 2)) continue;
    const left = segments.filter((seg) => seg.x1 <= x && seg.text.length > 25).length;
    const right = segments.filter((seg) => seg.x0 >= x && seg.text.length > 25).length;
    if (left >= 4 && right >= 4) return x;
  }
  return null;
}

/** Joins a bullet (or a summary paragraph) with the lines it wrapped onto. */
function blocksOf(segments: Segment[]) {
  const used = new Set<Segment>();
  const blocks: Array<{ text: string; bullet: boolean; segs: Segment[] }> = [];
  let section = "";
  for (const [index, seg] of segments.entries()) {
    if (used.has(seg)) continue;
    used.add(seg);
    const bullet = Boolean(seg.glyph) || Boolean(seg.dot) || BULLET_START.test(seg.text);
    if (!bullet && isSection(seg.text)) section = seg.text;
    const segs = [seg];
    const wraps = bullet || (/summary|profile|objective|about/i.test(section) && !isSection(seg.text));
    if (wraps) {
      for (let last = seg, look = index + 1; look < Math.min(segments.length, index + 8); look++) {
        const next = segments[look];
        if (used.has(next) || next.page !== last.page) continue;
        const drop = last.y - next.y;
        if (drop < last.size * 0.5) continue;
        if (drop > last.size * 1.7) break;
        const lineX = segs.length > 1 ? segs[1].x0 : seg.textX;
        const aligned = Math.abs(next.x0 - lineX) < 2 || (segs.length === 1 && next.x0 > seg.x0 - 1 && next.x0 < seg.textX + 2);
        if (!aligned || next.glyph || next.dot || BULLET_START.test(next.text) || isSection(next.text) || Math.abs(next.size - seg.size) > 0.6 || isBold(next.items[0].font) !== isBold((seg.glyph ? seg.items[1] : seg.items[0]).font)) break;
        segs.push(next);
        used.add(next);
        last = next;
      }
    }
    blocks.push({ text: segs.map((item) => item.text).join(" ").replace(BULLET_START, ""), bullet, segs });
  }
  return blocks;
}

/* ---------------- Taking the text out of the page, keeping everything else ---------------- */

const TEXT_OPS = new Set(["BT", "ET", "Tc", "Tw", "Tz", "TL", "Tf", "Tr", "Ts", "Td", "TD", "Tm", "T*", "Tj", "TJ", "'", "\""]);
type Shown = { x: number; y: number; color: [number, number, number] };
type Dot = { x: number; y: number };
type Matrix = [number, number, number, number, number, number];
const mul = (m: Matrix, n: Matrix): Matrix => [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const isSpace = (byte: number) => byte === 0 || byte === 9 || byte === 10 || byte === 12 || byte === 13 || byte === 32;
const isDelim = (byte: number) => "()<>[]{}/%".includes(String.fromCharCode(byte));
const cmyk = (c: number, m: number, y: number, k: number): [number, number, number] => [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)];

/**
 * A content stream without its text: every BT…ET block is taken out, but anything in it that isn't about text (a
 * color, a graphics state) is kept, so the drawing after it looks the same. Also says where each piece of text was
 * shown, and in what fill color, to draw it again in that color.
 */
export function stripText(bytes: Uint8Array) {
  const out: Uint8Array[] = [];
  const shown: Shown[] = [];
  let at = 0;
  let opStart = 0;
  let operands: Array<number | null> = [];
  let inText = false;
  let ctm: Matrix = IDENTITY;
  let fill: [number, number, number] = [0, 0, 0];
  const stack: Array<{ ctm: Matrix; fill: [number, number, number] }> = [];
  let tm: Matrix = IDENTITY;
  let tlm: Matrix = IDENTITY;
  let leading = 0;
  // Small filled shapes: bullets a browser drew as dots rather than as text.
  const dots: Dot[] = [];
  let path: Array<[number, number]> = [];
  const point = (x: number, y: number) => path.push([x, y]);
  const nums = (count: number) => operands.slice(-count).map((value) => value ?? 0);
  const show = () => { const m = mul(tm, ctm); shown.push({ x: m[4], y: m[5], color: fill }); };
  const moveText = (tx: number, ty: number) => { tlm = mul([1, 0, 0, 1, tx, ty], tlm); tm = tlm; };
  while (at < bytes.length) {
    const byte = bytes[at];
    if (isSpace(byte)) { at++; continue; }
    if (byte === 37) { while (at < bytes.length && bytes[at] !== 10 && bytes[at] !== 13) at++; continue; }
    if (byte === 40) {
      let depth = 0;
      for (; at < bytes.length; at++) {
        if (bytes[at] === 92) { at++; continue; }
        if (bytes[at] === 40) depth++;
        else if (bytes[at] === 41 && --depth === 0) { at++; break; }
      }
      operands.push(null);
      continue;
    }
    if (byte === 60 && bytes[at + 1] === 60) {
      let depth = 0;
      while (at < bytes.length) {
        if (bytes[at] === 60 && bytes[at + 1] === 60) { depth++; at += 2; continue; }
        if (bytes[at] === 62 && bytes[at + 1] === 62) { depth--; at += 2; if (!depth) break; continue; }
        if (bytes[at] === 40) { let inner = 0; for (; at < bytes.length; at++) { if (bytes[at] === 92) { at++; continue; } if (bytes[at] === 40) inner++; else if (bytes[at] === 41 && --inner === 0) { at++; break; } } continue; }
        at++;
      }
      operands.push(null);
      continue;
    }
    if (byte === 60) { while (at < bytes.length && bytes[at] !== 62) at++; at++; operands.push(null); continue; }
    if (byte === 91 || byte === 93 || byte === 123 || byte === 125) { at++; continue; }
    if (byte === 47) { at++; while (at < bytes.length && !isSpace(bytes[at]) && !isDelim(bytes[at])) at++; operands.push(null); continue; }
    const from = at;
    while (at < bytes.length && !isSpace(bytes[at]) && !isDelim(bytes[at])) at++;
    const word = new TextDecoder("latin1").decode(bytes.subarray(from, at));
    if (/^[+\-.\d]/.test(word)) { operands.push(Number(word)); continue; }
    if (word === "true" || word === "false" || word === "null") { operands.push(null); continue; }
    // An inline image: its data runs to "EI", and is kept whole.
    if (word === "BI") {
      while (at < bytes.length && !(bytes[at] === 73 && bytes[at + 1] === 68 && isSpace(bytes[at - 1] ?? 32) && isSpace(bytes[at + 2] ?? 32))) at++;
      at += 3;
      while (at < bytes.length && !(isSpace(bytes[at - 1]) && bytes[at] === 69 && bytes[at + 1] === 73 && (at + 2 >= bytes.length || isSpace(bytes[at + 2])))) at++;
      at += 2;
    }
    const end = at;
    switch (word) {
      case "q": stack.push({ ctm, fill }); break;
      case "Q": ({ ctm, fill } = stack.pop() ?? { ctm, fill }); break;
      case "cm": ctm = mul(nums(6) as Matrix, ctm); break;
      case "rg": fill = nums(3) as [number, number, number]; break;
      case "g": { const [gray] = nums(1); fill = [gray, gray, gray]; break; }
      case "k": fill = cmyk(...(nums(4) as [number, number, number, number])); break;
      case "cs": fill = [0, 0, 0]; break;
      case "sc": case "scn": {
        const values = operands.filter((value): value is number => value !== null);
        if (values.length === 1) fill = [values[0], values[0], values[0]];
        else if (values.length === 3) fill = values as [number, number, number];
        else if (values.length === 4) fill = cmyk(...(values as [number, number, number, number]));
        break;
      }
      case "BT": inText = true; tm = IDENTITY; tlm = IDENTITY; break;
      case "ET": inText = false; break;
      case "Tm": tm = tlm = nums(6) as Matrix; break;
      case "Td": moveText(...(nums(2) as [number, number])); break;
      case "TD": { const [tx, ty] = nums(2); leading = -ty; moveText(tx, ty); break; }
      case "TL": [leading] = nums(1); break;
      case "T*": moveText(0, -leading); break;
      case "'": case "\"": moveText(0, -leading); show(); break;
      case "Tj": case "TJ": show(); break;
      case "m": case "l": point(...(nums(2) as [number, number])); break;
      case "c": { const [x1, y1, x2, y2, x3, y3] = nums(6); point(x1, y1); point(x2, y2); point(x3, y3); break; }
      case "v": case "y": { const [x1, y1, x2, y2] = nums(4); point(x1, y1); point(x2, y2); break; }
      case "re": { const [x, y, w, h] = nums(4); point(x, y); point(x + w, y + h); break; }
      case "f": case "F": case "f*": case "B": case "B*": case "b": case "b*": {
        const placed = path.map(([x, y]) => [x * ctm[0] + y * ctm[2] + ctm[4], x * ctm[1] + y * ctm[3] + ctm[5]]);
        if (placed.length) {
          const xs = placed.map((p) => p[0]);
          const ys = placed.map((p) => p[1]);
          const [w, h] = [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
          if (w > 0.5 && h > 0.5 && w < 8 && h < 8 && Math.abs(w - h) < 1.5) dots.push({ x: (Math.max(...xs) + Math.min(...xs)) / 2, y: (Math.max(...ys) + Math.min(...ys)) / 2 });
        }
        path = [];
        break;
      }
      case "n": case "S": case "s": path = []; break;
    }
    const drop = TEXT_OPS.has(word) && (inText || word === "ET" || ["Tj", "TJ", "'", "\"", "Td", "TD", "Tm", "T*"].includes(word));
    if (!drop) out.push(bytes.subarray(opStart, end), new Uint8Array([10]));
    opStart = end;
    operands = [];
  }
  if (opStart < bytes.length) out.push(bytes.subarray(opStart));
  const size = out.reduce((sum, part) => sum + part.length, 0);
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const part of out) { joined.set(part, offset); offset += part.length; }
  return { bytes: joined, shown, dots };
}

function decoded(stream: unknown) {
  if (stream instanceof PDFRawStream) return decodePDFRawStream(stream).decode();
  const own = stream as { getUnencodedContents?: () => Uint8Array };
  return own.getUnencodedContents?.() ?? new Uint8Array();
}

/** Takes the text out of each page (and the forms drawn on it), keeping the rest. Where each page's text was shown, by page. */
function stripDocument(doc: PDFDocument) {
  const seen = new Set<string>();
  const stripForms = (resources: PDFDict | undefined) => {
    const xobjects = resources?.lookupMaybe(PDFName.of("XObject"), PDFDict);
    for (const [, value] of xobjects?.entries() ?? []) {
      if (!(value instanceof PDFRef) || seen.has(value.toString())) continue;
      seen.add(value.toString());
      const form = doc.context.lookup(value);
      if (!(form instanceof PDFRawStream) || form.dict.get(PDFName.of("Subtype"))?.toString() !== "/Form") continue;
      const fresh = doc.context.flateStream(stripText(decoded(form)).bytes);
      for (const [key, entry] of form.dict.entries()) if (!["/Length", "/Filter", "/DecodeParms"].includes(key.toString())) fresh.dict.set(key, entry);
      doc.context.assign(value, fresh);
      stripForms(form.dict.lookupMaybe(PDFName.of("Resources"), PDFDict));
    }
  };
  return doc.getPages().map((page) => {
    const { bytes, shown } = stripText(pageContent(doc, page));
    page.node.set(PDFName.of("Contents"), doc.context.register(doc.context.flateStream(bytes)));
    stripForms(page.node.Resources());
    return shown;
  });
}

/* ---------------- Drawing the text again ---------------- */

const tz = (percent: number) => PDFOperator.of(PDFOperatorNames.SetTextHorizontalScaling, [PDFNumber.of(Math.round(percent * 100) / 100)]);

/** Only characters the standard font has; common ones swapped for plain look-alikes first. */
function encodable(text: string, font: PDFFont) {
  const swapped = text.replace(/[‘’‚′]/g, "'").replace(/[“”„″]/g, "\"").replace(/[−]/g, "-").replace(/[→➔]/g, "->").replace(/ /g, " ");
  const have = new Set(font.getCharacterSet());
  return [...swapped].filter((char) => have.has(char.codePointAt(0)!)).join("");
}

/**
 * Draws the tailored resume: the original page with its text taken out, every unchanged line drawn again where it
 * was, and the changed bullets, summary and skills laid out inside their original space. Changes that don't fit are
 * dropped (the original line is drawn instead).
 */
export async function renderPdf(original: Uint8Array, layout: PdfLayout, plan: TailorPlan) {
  const doc = await PDFDocument.load(original, { ignoreEncryption: true, updateMetadata: false });
  if (doc.getPageCount() !== layout.pages.length) throw new Error("Page count changed");
  const shown = stripDocument(doc);
  const fonts = new Map<StandardFonts, PDFFont>();
  const fontFor = async (key: StandardFonts) => fonts.get(key) ?? fonts.set(key, await doc.embedFont(key)).get(key)!;
  for (const key of new Set(layout.blocks.flatMap((block) => block.segs.flatMap((seg) => seg.items.map((item) => stdFont(item.font)))))) await fontFor(key);
  await fontFor(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const colorOf = (item: Item) => {
    const near = shown[item.page].filter((spot) => Math.abs(spot.y - item.y) < 1.5 && spot.x <= item.x + 1).sort((a, b) => b.x - a.x)[0];
    const [r, g, b] = near?.color ?? [0, 0, 0];
    return rgb(Math.min(1, Math.max(0, r)), Math.min(1, Math.max(0, g)), Math.min(1, Math.max(0, b)));
  };
  const drawItem = (item: Item, dy = 0, glyph = false) => {
    const page = pages[item.page];
    const font = glyph ? fonts.get(StandardFonts.Helvetica)! : fonts.get(stdFont(item.font))!;
    const text = glyph ? "•" : encodable(item.str, font);
    if (!text.trim()) return;
    const natural = font.widthOfTextAtSize(text, item.size);
    const scale = !glyph && natural > 0 && item.w > 0 ? Math.min(1.6, Math.max(0.5, item.w / natural)) : 1;
    page.pushOperators(tz(scale * 100));
    page.drawText(text, { x: item.x, y: item.y + dy, size: item.size, font, color: colorOf(item) });
    page.pushOperators(tz(100));
  };
  const drawSeg = (seg: Segment, dy = 0) => seg.items.forEach((item) => drawItem(item, dy, item === seg.glyph));

  const touched = new Set<number>();
  const edits = { ...plan.edits };
  const groups = new Map<number, Block[]>();
  for (const block of layout.blocks) if (block.line.group !== null) groups.set(block.line.group, [...(groups.get(block.line.group) ?? []), block]);

  // Bullet groups with a new order or a changed bullet, and single changed lines (summary, skills), laid out anew.
  const runs: Block[][] = [];
  for (const [group, blocks] of groups) {
    const order = plan.order[String(group)];
    if (order || blocks.some((block) => edits[String(block.line.id)] !== undefined)) runs.push(order ? order.map((id) => blocks.find((block) => block.line.id === id)!).filter(Boolean) : blocks);
  }
  for (const block of layout.blocks) if (block.line.group === null && EDITABLE.has(block.line.kind) && edits[String(block.line.id)] !== undefined) runs.push([block]);

  for (const run of runs) {
    const inPlace = [...run].sort((a, b) => b.segs[0].y - a.segs[0].y);
    // A run that crosses a page or column is left as it was.
    if (new Set(run.flatMap((block) => block.segs.map((seg) => seg.page))).size > 1) continue;
    const placed = await layoutRun(run, inPlace, edits, layout, fontFor);
    if (!placed) continue;
    for (const block of run) touched.add(block.line.id);
    for (const step of placed) {
      if (step.kind === "moved") drawSeg(step.seg, step.dy);
      else if (step.kind === "glyph") drawItem(step.item, step.dy, true);
      else if (step.kind === "label") drawItem(step.item, step.dy);
      else if (step.kind === "text") {
        const page = pages[step.page];
        page.pushOperators(tz(step.scale * 100));
        page.drawText(step.text, { x: step.x, y: step.y, size: step.size, font: step.font, color: step.color });
        page.pushOperators(tz(100));
      }
    }
  }
  for (const block of layout.blocks) if (!touched.has(block.line.id)) block.segs.forEach((seg) => drawSeg(seg));
  doc.setModificationDate(new Date());
  return doc.save();

  type Step = { kind: "moved"; seg: Segment; dy: number } | { kind: "glyph" | "label"; item: Item; dy: number } | { kind: "text"; page: number; text: string; x: number; y: number; size: number; font: PDFFont; scale: number; color: ReturnType<typeof rgb> };

  /** Lays out a run of blocks from the top of their original space. Null when nothing fits even unchanged. */
  async function layoutRun(run: Block[], inPlace: Block[], local: Record<string, string>, pdf: PdfLayout, load: (key: StandardFonts) => Promise<PDFFont>): Promise<Step[] | null> {
    const top = inPlace[0].segs[0].y;
    const bottom = Math.min(...inPlace.map((block) => block.segs.at(-1)!.y));
    const page = inPlace[0].segs[0].page;
    const wraps = inPlace.flatMap((block) => block.segs.slice(1).map((seg, index) => block.segs[index].y - seg.y));
    const starts = inPlace.slice(1).map((block, index) => inPlace[index].segs.at(-1)!.y - block.segs[0].y);
    const leading = median(wraps) || median(starts) || inPlace[0].segs[0].size * 1.2;
    const gap = median(starts) || leading;
    const gutter = pdf.pages[page].gutter;
    const left = inPlace[0].segs[0].x0;
    // The right edge of this column: the widest text in it.
    const right = Math.max(...pdf.blocks.flatMap((block) => block.segs).filter((seg) => seg.page === page && (gutter === null || (left < gutter ? seg.x1 <= gutter + 2 : seg.x0 >= gutter - 2))).map((seg) => seg.x1));
    // Bullets drawn as shapes stay where they are: each block in the new order starts where the one in that place did,
    // and has only that one's lines.
    const fixedStarts = run.some((block) => block.segs[0].dot);
    const tries = { ...local };
    for (let attempt = 0; attempt < 30; attempt++) {
      const steps: Step[] = [];
      let cursor = top;
      let last = top;
      let overflow = false;
      const grown: Array<[string, number]> = [];
      for (const [place, block] of run.entries()) {
        const id = String(block.line.id);
        const first = block.segs[0];
        if (fixedStarts) cursor = inPlace[place].segs[0].y;
        const room = fixedStarts ? inPlace[place].segs.length : Infinity;
        const text = tries[id];
        if (text === undefined) {
          const dy = cursor - first.y;
          block.segs.forEach((seg) => steps.push({ kind: "moved", seg, dy }));
          last = block.segs.at(-1)!.y + dy;
          if (block.segs.length > room) overflow = true;
        } else {
          const label = block.line.kind === "skills" ? labelItems(first) : [];
          // The words' own font: past the bullet, and past a skills label (often bold).
          const body = (first.glyph ? first.items.slice(1) : first.items).find((item) => !label.includes(item)) ?? first.items.at(-1)!;
          const key = stdFont(body.font);
          const font = await load(key);
          const scale = pdf.scales.get(key) ?? 1;
          const dy = cursor - first.y;
          if (first.glyph) steps.push({ kind: "glyph", item: first.glyph, dy });
          // A skills line's label ("Languages:") is drawn as it was; the list after it is new.
          let words = text.replace(BULLET_START, "");
          let startX = first.textX;
          if (label.length) {
            label.forEach((item) => steps.push({ kind: "label", item, dy }));
            const end = label.at(-1)!;
            startX = end.x + end.w + font.widthOfTextAtSize(" ", body.size) * scale;
            words = words.replace(/^[^:]{1,40}:\s*/, "");
          }
          const inline = !first.glyph && BULLET_START.test(first.text) ? (first.text.match(BULLET_START)?.[0] ?? "") : "";
          const nextX = block.segs[1]?.x0 ?? first.textX;
          const rows = wrap(`${inline}${encodable(words, font)}`, (line) => font.widthOfTextAtSize(line, body.size) * scale, [right - startX + 1, right - nextX + 1]);
          rows.forEach((row, index) => steps.push({ kind: "text", page, text: row, x: index ? nextX : startX, y: cursor - index * leading, size: body.size, font, scale, color: colorOf(body) }));
          last = cursor - (rows.length - 1) * leading;
          grown.push([id, rows.length - block.segs.length]);
          if (rows.length > room) { overflow = true; grown.push([id, 1000]); }
        }
        cursor = last - gap;
      }
      if (!overflow && (fixedStarts || last >= bottom - leading * 0.25)) return steps;
      // Too long for the space: the change that grew most is dropped, and it's tried again.
      const worst = grown.sort((a, b) => b[1] - a[1])[0];
      if (!worst) return null;
      delete tries[worst[0]];
    }
    return null;
  }
}

/** The items that make up a skills line's label, up to and including its colon. */
function labelItems(seg: Segment) {
  const out: Item[] = [];
  for (const item of seg.items) {
    out.push(item);
    if (item.str.trim().endsWith(":")) return out;
    if (item.str.includes(":") || out.length > 3) return [];
  }
  return [];
}

/** Words into rows no wider than the widths given (the first row's, then the rest's). */
function wrap(text: string, measure: (line: string) => number, widths: [number, number]) {
  const rows: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = current ? `${current} ${word}` : word;
    if (current && measure(next) > widths[rows.length ? 1 : 0]) {
      rows.push(current);
      current = word;
    } else current = next;
  }
  if (current) rows.push(current);
  return rows;
}
