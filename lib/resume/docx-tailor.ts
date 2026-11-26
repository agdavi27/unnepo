import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import JSZip from "jszip";
import { PDFDocument, PDFNumber, PDFOperator, PDFOperatorNames, StandardFonts, rgb } from "pdf-lib";
import { BULLET_START, classify, type ResumeLine, type TailorPlan } from "@/lib/resume/tailor-lines";

/**
 * A Word resume, tailored in place: the original .docx with only the words of the changed bullets, summary and skills
 * lines replaced, inside their own paragraphs and runs, so fonts, sizes, spacing, tabs, bullets and borders stay the
 * student's own. A bullet group's paragraphs may be put in a new order. Everything else in the file is left byte for
 * byte. For a form that only takes PDFs, `docxPdf` draws the edited document as a PDF that follows its formatting.
 */

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
type El = Element;
export type DocxLayout = { kind: "docx"; lines: ResumeLine[] };

const kids = (el: El, name: string) => Array.from(el.childNodes).filter((node): node is El => node.nodeType === 1 && (node as El).nodeName === name);
const kid = (el: El | null | undefined, name: string) => (el ? kids(el, name)[0] ?? null : null);
const attr = (el: El | null | undefined, name: string) => el?.getAttribute(`w:${name}`) ?? el?.getAttributeNS(W, name) ?? null;

/** Every paragraph in reading order, leaving out the copies Word keeps for older readers (mc:Fallback). */
function paragraphs(doc: Document) {
  return Array.from(doc.getElementsByTagName("w:p")).filter((p) => {
    for (let node = p.parentNode; node; node = node.parentNode) if (node.nodeName === "mc:Fallback") return false;
    return true;
  });
}

/** A paragraph's own text nodes (w:t), not those of a text box inside it. */
function textNodes(p: El) {
  return Array.from(p.getElementsByTagName("w:t")).filter((t) => {
    let node = t.parentNode;
    while (node && node.nodeName !== "w:p") node = node.parentNode;
    return node === p;
  });
}

/** What a paragraph says, tabs as spaces. */
function paragraphText(p: El) {
  const out: string[] = [];
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeName === "w:p" || child.nodeName === "mc:Fallback") continue;
      if (child.nodeName === "w:t") out.push(child.textContent ?? "");
      else if (child.nodeName === "w:tab") out.push("\t");
      else if (child.nodeName === "w:br") out.push(" ");
      else walk(child);
    }
  };
  walk(p);
  return out.join("");
}

const isListParagraph = (p: El) => {
  const props = kid(p, "w:pPr");
  return Boolean(kid(props, "w:numPr")) || /list|bullet/i.test(attr(kid(props, "w:pStyle"), "val") ?? "");
};

async function open(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) return null;
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const paras = paragraphs(doc).map((p) => ({ p, text: paragraphText(p) })).filter((item) => item.text.trim());
  return { zip, doc, paras };
}

/** Reads a Word resume's lines. Null when it has no readable body. */
export async function readDocxLayout(bytes: Uint8Array): Promise<DocxLayout | null> {
  const opened = await open(bytes).catch(() => null);
  if (!opened || opened.paras.length < 5) return null;
  const lines = classify(opened.paras.map(({ p, text }) => {
    const bullet = isListParagraph(p) || BULLET_START.test(text);
    return { text: text.replace(BULLET_START, "").replace(/\t+/g, "  "), bullet };
  }));
  return { kind: "docx", lines };
}

/**
 * Puts new words into a paragraph, keeping what comes before `keep` characters (a typed bullet, a skills label) as it
 * was: the words go into the first run after it, in that run's formatting, and later runs are emptied.
 */
function setWords(p: El, words: string, keep: number) {
  const nodes = textNodes(p);
  let at = 0;
  let placed = false;
  for (const node of nodes) {
    const text = node.textContent ?? "";
    if (!placed && (keep === 0 || at + text.length > keep)) {
      const before = text.slice(0, Math.max(0, keep - at));
      node.textContent = `${before}${before && !/\s$/.test(before) ? " " : ""}${words}`;
      node.setAttribute("xml:space", "preserve");
      placed = true;
    } else if (placed) node.textContent = "";
    at += text.length;
  }
  if (!placed && nodes.length) {
    const last = nodes.at(-1)!;
    last.textContent = `${last.textContent ?? ""} ${words}`;
    last.setAttribute("xml:space", "preserve");
  }
}

/** The tailored .docx: the original with the plan's words and order. */
export async function applyDocxPlan(bytes: Uint8Array, plan: TailorPlan) {
  const opened = await open(bytes);
  if (!opened) throw new Error("No document body");
  const layout = await readDocxLayout(bytes);
  if (!layout) throw new Error("Unreadable");
  const { zip, doc, paras } = opened;
  for (const [id, words] of Object.entries(plan.edits)) {
    const line = layout.lines[Number(id)];
    const { p, text } = paras[Number(id)] ?? {};
    if (!line || !p) continue;
    const typed = textNodes(p).map((node) => node.textContent ?? "").join("");
    // A bullet typed as a character, or a skills label, stays as it was.
    const prefix = typed.match(BULLET_START)?.[0] ?? (line.kind === "skills" ? typed.match(/^[^:]{1,40}:\s*/)?.[0] ?? "" : "");
    const rest = line.kind === "skills" && prefix.includes(":") ? words.replace(/^[^:]{1,40}:\s*/, "") : words;
    if (text !== undefined) setWords(p, rest, prefix.length);
  }
  for (const [group, order] of Object.entries(plan.order)) {
    const inGroup = layout.lines.filter((line) => line.group === Number(group)).map((line) => paras[line.id].p);
    const parent = inGroup[0]?.parentNode;
    if (!parent || inGroup.some((p) => p.parentNode !== parent)) continue;
    const anchor = inGroup.at(-1)!.nextSibling;
    inGroup.forEach((p) => parent.removeChild(p));
    for (const id of order) parent.insertBefore(paras[id].p, anchor);
  }
  zip.file("word/document.xml", new XMLSerializer().serializeToString(doc));
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

/* ---------------- The edited document as a PDF, for forms that only take PDFs ---------------- */

type RunStyle = { size: number; bold: boolean; italic: boolean; caps: boolean; color: string | null; font: string };
type ParaStyle = { jc: string; before: number; after: number; line: number; left: number; hanging: number; firstLine: number; borderBottom: boolean; borderTop: boolean; tabs: Array<{ pos: number; kind: string }>; list: boolean };

const twip = (value: string | null, fallback = 0) => (value === null || value === "" ? fallback : Number(value) / 20);
const on = (el: El | null) => Boolean(el) && !["0", "false", "none"].includes(attr(el, "val") ?? "true");

function runStyle(rPr: El | null, base: RunStyle): RunStyle {
  if (!rPr) return base;
  const fonts = kid(rPr, "w:rFonts");
  const size = attr(kid(rPr, "w:sz"), "val");
  const color = attr(kid(rPr, "w:color"), "val");
  return {
    size: size ? Number(size) / 2 : base.size,
    bold: kid(rPr, "w:b") ? on(kid(rPr, "w:b")) : base.bold,
    italic: kid(rPr, "w:i") ? on(kid(rPr, "w:i")) : base.italic,
    caps: kid(rPr, "w:caps") ? on(kid(rPr, "w:caps")) : base.caps,
    color: color && color !== "auto" ? color : base.color,
    font: attr(fonts, "ascii") ?? attr(fonts, "hAnsi") ?? base.font,
  };
}

function paraStyle(pPr: El | null, base: ParaStyle): ParaStyle {
  if (!pPr) return base;
  const spacing = kid(pPr, "w:spacing");
  const ind = kid(pPr, "w:ind");
  const borders = kid(pPr, "w:pBdr");
  const tabs = kids(kid(pPr, "w:tabs") ?? pPr, "w:tab").map((tab) => ({ pos: twip(attr(tab, "pos")), kind: attr(tab, "val") ?? "left" }));
  const line = attr(spacing, "line");
  return {
    jc: attr(kid(pPr, "w:jc"), "val") ?? base.jc,
    before: attr(spacing, "before") !== null ? twip(attr(spacing, "before")) : base.before,
    after: attr(spacing, "after") !== null ? twip(attr(spacing, "after")) : base.after,
    line: line && (attr(spacing, "lineRule") ?? "auto") === "auto" ? Number(line) / 240 : base.line,
    left: attr(ind, "left") ?? attr(ind, "start") ? twip(attr(ind, "left") ?? attr(ind, "start")) : base.left,
    hanging: attr(ind, "hanging") !== null ? twip(attr(ind, "hanging")) : base.hanging,
    firstLine: attr(ind, "firstLine") !== null ? twip(attr(ind, "firstLine")) : base.firstLine,
    borderBottom: kid(borders, "w:bottom") ? attr(kid(borders, "w:bottom"), "val") !== "nil" : base.borderBottom,
    borderTop: kid(borders, "w:top") ? attr(kid(borders, "w:top"), "val") !== "nil" : base.borderTop,
    tabs: tabs.length ? tabs : base.tabs,
    list: Boolean(kid(pPr, "w:numPr")) || base.list,
  };
}

/**
 * Draws a .docx as a PDF that follows its formatting: page size and margins, each paragraph's alignment, indents,
 * spacing, borders and bullets, each run's size, weight, slant, caps and color, and right tab stops (dates at the
 * right edge), in the closest standard font. Tables come out as their paragraphs, one after another.
 */
export async function docxPdf(bytes: Uint8Array, title: string) {
  const zip = await JSZip.loadAsync(bytes);
  const doc = new DOMParser().parseFromString((await zip.file("word/document.xml")!.async("string")), "text/xml");
  const stylesXml = await zip.file("word/styles.xml")?.async("string");
  const styles = stylesXml ? new DOMParser().parseFromString(stylesXml, "text/xml") : null;
  const defaults = styles?.getElementsByTagName("w:docDefaults")[0] ?? null;
  let baseRun: RunStyle = { size: 11, bold: false, italic: false, caps: false, color: null, font: "Calibri" };
  let basePara: ParaStyle = { jc: "left", before: 0, after: 8, line: 1.08, left: 0, hanging: 0, firstLine: 0, borderBottom: false, borderTop: false, tabs: [], list: false };
  baseRun = runStyle(defaults?.getElementsByTagName("w:rPr")[0] ?? null, baseRun);
  basePara = paraStyle(defaults?.getElementsByTagName("w:pPr")[0] ?? null, basePara);
  const byId = new Map(Array.from(styles?.getElementsByTagName("w:style") ?? []).map((style) => [attr(style, "styleId") ?? "", style]));
  const styled = (id: string | null, seen = 0): { run: RunStyle; para: ParaStyle } => {
    const style = id ? byId.get(id) : undefined;
    if (!style || seen > 8) return { run: baseRun, para: basePara };
    const parent = styled(attr(kid(style, "w:basedOn"), "val"), seen + 1);
    return { run: runStyle(kid(style, "w:rPr"), parent.run), para: paraStyle(kid(style, "w:pPr"), parent.para) };
  };

  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  const fonts = new Map<string, Awaited<ReturnType<typeof pdf.embedFont>>>();
  const fontFor = async (style: RunStyle) => {
    const serif = /times|georgia|garamond|cambria|palatino|antiqua|baskerville|book|century|serif/i.test(style.font) && !/sans/i.test(style.font);
    const mono = /courier|mono|consolas/i.test(style.font);
    const family = mono ? ["Courier", "CourierBold", "CourierOblique", "CourierBoldOblique"] : serif ? ["TimesRoman", "TimesRomanBold", "TimesRomanItalic", "TimesRomanBoldItalic"] : ["Helvetica", "HelveticaBold", "HelveticaOblique", "HelveticaBoldOblique"];
    const key = family[(style.bold ? 1 : 0) + (style.italic ? 2 : 0)] as keyof typeof StandardFonts;
    return fonts.get(key) ?? fonts.set(key, await pdf.embedFont(StandardFonts[key])).get(key)!;
  };
  // Calibri and most resume fonts are narrower than Helvetica: drawn a touch condensed so lines break like the original.
  const squeeze = (style: RunStyle) => (/calibri|arial narrow|garamond|cambria/i.test(style.font) ? 0.9 : 1);

  const sect = doc.getElementsByTagName("w:sectPr")[0] ?? null;
  const size = kid(sect, "w:pgSz");
  const margin = kid(sect, "w:pgMar");
  const [pageW, pageH] = [twip(attr(size, "w"), 612), twip(attr(size, "h"), 792)];
  const [top, right, bottom, left] = [twip(attr(margin, "top"), 72), twip(attr(margin, "right"), 72), twip(attr(margin, "bottom"), 72), twip(attr(margin, "left"), 72)];
  let page = pdf.addPage([pageW, pageH]);
  let y = pageH - top;
  const safe = (text: string, font: Awaited<ReturnType<typeof fontFor>>) => {
    const have = new Set(font.getCharacterSet());
    return [...text.replace(/[‘’]/g, "'").replace(/[“”]/g, "\"")].filter((char) => have.has(char.codePointAt(0)!)).join("");
  };
  const color = (hex: string | null) => (hex && /^[0-9a-f]{6}$/i.test(hex) ? rgb(parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255) : rgb(0, 0, 0));

  for (const p of paragraphs(doc)) {
    const pPr = kid(p, "w:pPr");
    const base = styled(attr(kid(pPr, "w:pStyle"), "val"));
    const para = paraStyle(pPr, base.para);
    // Runs as words with their style; a tab splits the line into what's before it and what's after (dates).
    type Piece = { text: string; style: RunStyle } | { tab: true };
    const pieces: Piece[] = [];
    const walk = (node: Node, inherited: RunStyle) => {
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeName === "w:p" || child.nodeName === "mc:Fallback" || child.nodeName === "w:pPr") continue;
        if (child.nodeName === "w:r") {
          const style = runStyle(kid(child as El, "w:rPr"), inherited);
          for (const part of Array.from(child.childNodes)) {
            if (part.nodeName === "w:t") pieces.push({ text: part.textContent ?? "", style });
            else if (part.nodeName === "w:tab") pieces.push({ tab: true });
            else if (part.nodeName === "w:br") pieces.push({ text: " ", style });
          }
        } else walk(child, inherited);
      }
    };
    walk(p, base.run);
    const lineSize = Math.max(base.run.size, ...pieces.map((piece) => ("text" in piece ? piece.style.size : 0)));
    const height = lineSize * 1.17 * Math.max(1, para.line);
    y -= para.before;
    if (para.borderTop) { page.drawLine({ start: { x: left, y: y + 2 }, end: { x: pageW - right, y: y + 2 }, thickness: 0.75, color: rgb(0, 0, 0) }); y -= 3; }
    if (!pieces.some((piece) => "text" in piece && piece.text.trim())) { y -= height; y -= para.after; continue; }
    const tabAt = pieces.findIndex((piece) => "tab" in piece);
    const rightTab = para.tabs.find((tab) => tab.kind === "right" || tab.kind === "end");
    const main = tabAt >= 0 && rightTab ? pieces.slice(0, tabAt) : pieces.map((piece) => ("tab" in piece ? { text: "    ", style: base.run } : piece));
    const tail = tabAt >= 0 && rightTab ? pieces.slice(tabAt + 1).filter((piece): piece is { text: string; style: RunStyle } => "text" in piece) : [];
    const indent = left + para.left;
    const firstX = indent + para.firstLine - para.hanging;
    const width = pageW - right - indent;
    // Words with their style, wrapped across the width.
    type Word = { text: string; style: RunStyle; space: boolean };
    const words: Word[] = [];
    for (const piece of main) {
      if (!("text" in piece)) continue;
      const text = piece.style.caps ? piece.text.toUpperCase() : piece.text;
      text.split(/(\s+)/).forEach((part) => {
        if (!part) return;
        if (/^\s+$/.test(part)) { if (words.length) words.at(-1)!.space = true; return; }
        words.push({ text: part, style: piece.style, space: false });
      });
    }
    const measure = async (word: Word) => (await fontFor(word.style)).widthOfTextAtSize(safe(word.text, await fontFor(word.style)), word.style.size) * squeeze(word.style);
    const rows: Word[][] = [[]];
    let used = para.list ? 0 : firstX - indent;
    for (const word of words) {
      const w = await measure(word);
      const spaceW = (await fontFor(word.style)).widthOfTextAtSize(" ", word.style.size);
      if (rows.at(-1)!.length && used + w > width) { rows.push([]); used = 0; }
      rows.at(-1)!.push(word);
      used += w + (word.space ? spaceW : 0);
    }
    for (const [index, row] of rows.entries()) {
      if (y - height < bottom) { page = pdf.addPage([pageW, pageH]); y = pageH - top; }
      y -= height;
      let rowWidth = 0;
      for (const word of row) rowWidth += (await measure(word)) + (word.space ? (await fontFor(word.style)).widthOfTextAtSize(" ", word.style.size) : 0);
      let x = index === 0 && !para.list ? firstX : indent;
      if (para.jc === "center") x = left + (pageW - left - right - rowWidth) / 2;
      else if (para.jc === "right" || para.jc === "end") x = pageW - right - rowWidth;
      if (index === 0 && para.list) {
        const font = await fontFor(row[0]?.style ?? base.run);
        page.drawText("•", { x: Math.max(left, indent - Math.max(para.hanging, 12)), y, size: lineSize, font, color: rgb(0, 0, 0) });
      }
      for (const word of row) {
        const font = await fontFor(word.style);
        const text = safe(word.text, font);
        const w = font.widthOfTextAtSize(text, word.style.size);
        page.pushOperators(PDFOperator.of(PDFOperatorNames.SetTextHorizontalScaling, [PDFNumber.of(squeeze(word.style) * 100)]));
        page.drawText(text, { x, y, size: word.style.size, font, color: color(word.style.color) });
        page.pushOperators(PDFOperator.of(PDFOperatorNames.SetTextHorizontalScaling, [PDFNumber.of(100)]));
        x += w * squeeze(word.style) + (word.space ? font.widthOfTextAtSize(" ", word.style.size) : 0);
      }
      if (index === 0 && tail.length) {
        let tailWidth = 0;
        for (const piece of tail) tailWidth += (await fontFor(piece.style)).widthOfTextAtSize(safe(piece.text, await fontFor(piece.style)), piece.style.size);
        let tx = Math.min(pageW - right, left + rightTab!.pos) - tailWidth;
        for (const piece of tail) {
          const font = await fontFor(piece.style);
          const text = safe(piece.text, font);
          page.drawText(text, { x: tx, y, size: piece.style.size, font, color: color(piece.style.color) });
          tx += font.widthOfTextAtSize(text, piece.style.size);
        }
      }
    }
    if (para.borderBottom) { page.drawLine({ start: { x: left, y: y - 3 }, end: { x: pageW - right, y: y - 3 }, thickness: 0.75, color: rgb(0, 0, 0) }); y -= 3; }
    y -= para.after;
  }
  return pdf.save();
}
