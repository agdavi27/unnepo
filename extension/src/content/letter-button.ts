import { H, W, spiderRects, storedSpiderColors } from "../shared/sprite";
import { coveredUp, mountAbove } from "./top-layer";

/**
 * "Write with unnepo" beside the cover letter question on an application form ("Attach your cover letter",
 * "Cover letter", a letter of interest...). On Free it says how many letters are left today. Pressing it opens a
 * popup on the page with the same questions as the panel's cover letter (how it's built, length, tone, what to
 * mention), writes the letter for the job on this tab, and shows it to edit. Then it goes where the form wants it:
 * into the upload box (as a PDF), into the text box, or downloaded to upload by hand. Nothing is read or sent until
 * the button is pressed. Shows only when the student is signed in to Unnepo.
 */

const LETTER = /cover ?letter|letter of (interest|motivation|intent)|motivation(al)? letter/i;
// The same words in an upload box's name or id, where they're joined: LinkedIn's "jobs-document-upload-file-input-upload-cover-letter".
const LETTER_FILE = /cover[\s_-]?letter|letter[\s_-]of[\s_-](interest|motivation|intent)|motivation(al)?[\s_-]letter/i;
const MARK = "data-unnepo-letter";
const CONTROL = "input:not([type=hidden]), textarea, select, button, [role=button]";

type PageState = { ok: boolean; free?: boolean; left?: number | null; highlights?: string[] };
type Letter = { text: string; fileName: string; pdfBase64: string; upgrade?: string };
type Wrote = { ok: boolean; doc?: Letter; error?: string };

const ask = <T>(message: unknown) => chrome.runtime.sendMessage(message) as Promise<T>;
const escape = (text: string) => text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const textOf = (el: Element) => ((el as HTMLElement).innerText || el.textContent || "").replace(/\s+/g, " ").trim();
const ours = (el: Element) => Boolean(el.closest(`[${MARK}="button"], [data-unnepo-letter-popup]`));
const shown = (el: Element) => { const rect = el.getBoundingClientRect(); return rect.width > 2 && rect.height > 2; };

/** Where a cover letter question is: its words (short, so not the job description) and the part of the form around it. */
type Spot = { label: HTMLElement; box: HTMLElement };

function findSpots(): Spot[] {
  const spots: Spot[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: (node) => (LETTER.test(node.nodeValue || "") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP) });
  while (walker.nextNode()) {
    let label = walker.currentNode.parentElement;
    if (!label || label.closest(`a, button, option, script, style, noscript, textarea, select, [contenteditable=true], [${MARK}]`) || ours(label)) continue;
    // A bold word inside a label: the whole label, as long as it stays short.
    while (label.parentElement && getComputedStyle(label).display.startsWith("inline") && textOf(label.parentElement).length <= 80) label = label.parentElement;
    if (textOf(label).length > 80 || !shown(label)) continue;
    // The form part around it: the nearest wrapper that has a box or button in it, and isn't a whole page.
    let box: HTMLElement | null = label.parentElement;
    for (let depth = 0; box && depth < 6; depth++, box = box.parentElement) {
      if (Array.from(box.querySelectorAll(CONTROL)).some((el) => !ours(el))) break;
    }
    if (!box || textOf(box).length > 1500 || box.closest(`[${MARK}]`) || box.querySelector(`[${MARK}]`)) continue;
    spots.push({ label, box });
  }
  return spots;
}

const OTHER_FILE = /resume|r[ée]sum[ée]|\bcv\b|transcript|portfolio|writing sample|photo|headshot/i;

/** The words that say what an upload box is for: its own attributes and labels, then the short text around it. */
function fileWords(input: HTMLInputElement) {
  const own = `${input.name} ${input.id} ${input.getAttribute("aria-label") ?? ""} ${input.accept} ${Array.from(input.labels ?? []).map((label) => label.textContent).join(" ")}`;
  // The nearest wrapper with words in it, as long as it's only this box's: never a whole section or page.
  let around = "";
  let node: HTMLElement | null = input.parentElement;
  for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
    if (node.querySelectorAll("input:not([type=hidden]), textarea, select").length > 1) break;
    const text = textOf(node);
    if (text.length > 150) break;
    if (text) { around = text; break; }
  }
  return `${own} ${around}`;
}

/** A drop area for files (Dropzone, react-dropzone, the site's own): letters can be dropped on it like a dragged file. */
function dropZoneIn(box: HTMLElement) {
  return box.querySelector<HTMLElement>("[class*='dropzone' i], [class*='drop-zone' i], [class*='drop_zone' i], [data-testid*='drop' i], [class*='upload' i], [data-testid*='upload' i]");
}

/**
 * Where the letter goes: the upload box or text box right by the question first; else a cover letter upload box
 * anywhere on the page; else, when the page has just one upload box that isn't for the resume, transcript or the
 * like, that one; else a drop area by the question. None of those: it's downloaded, for forms that upload through
 * their own steps.
 */
function targetsFor(box: HTMLElement) {
  // By the question: the one upload box that names a letter, or the only one there that isn't for a resume or the like.
  const nearby = Array.from(box.querySelectorAll<HTMLInputElement>("input[type=file]")).filter((input) => !input.disabled);
  const near = nearby.find((input) => LETTER_FILE.test(fileWords(input))) ?? (nearby.length === 1 && !OTHER_FILE.test(fileWords(nearby[0])) ? nearby[0] : null);
  const area = box.querySelector<HTMLTextAreaElement>("textarea");
  const text = area && !area.disabled && !area.readOnly ? area : null;
  if (near) return { file: near, text: null, drop: null };
  if (text) return { file: null, text, drop: null };
  const uploads = Array.from(document.querySelectorAll<HTMLInputElement>("input[type=file]")).filter((input) => !input.disabled && !input.files?.length);
  const named = uploads.find((input) => LETTER_FILE.test(fileWords(input)));
  const others = uploads.filter((input) => !OTHER_FILE.test(fileWords(input)));
  const file = named ?? (others.length === 1 ? others[0] : null);
  return { file, text: null, drop: file ? null : dropZoneIn(box) };
}

/** Drops the letter on a drop area the way a dragged file arrives. */
function dropOn(zone: HTMLElement, letter: Letter) {
  const transfer = new DataTransfer();
  transfer.items.add(fileFrom(letter));
  for (const type of ["dragenter", "dragover", "drop"]) zone.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, composed: true, dataTransfer: transfer }));
}

const fileFrom = (letter: Letter) => {
  const bytes = Uint8Array.from(atob(letter.pdfBase64), (char) => char.charCodeAt(0));
  return new File([bytes], letter.fileName || "Cover letter.pdf", { type: "application/pdf" });
};

function attach(input: HTMLInputElement, letter: Letter) {
  const transfer = new DataTransfer();
  transfer.items.add(fileFrom(letter));
  input.files = transfer.files;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
}

/** Types the letter into a text box the way the site's own code expects (React and the like watch the setter). */
function putText(box: HTMLTextAreaElement, text: string) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(box, text);
  box.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  box.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
}

function download(letter: Letter) {
  const url = URL.createObjectURL(fileFrom(letter));
  const link = document.createElement("a");
  link.href = url;
  link.download = letter.fileName || "Cover letter.pdf";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const BUTTON_STYLE = `
  :host { all: initial; display: inline-flex; vertical-align: middle; margin: 2px 0 2px 10px; font: 600 12px/1 system-ui, -apple-system, sans-serif; }
  button { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 7px; background: #070708; color: #F7F7F8; border: 1px solid #3D8BFF; box-shadow: 2px 2px 0 #3D8BFF; white-space: nowrap; }
  button:hover { background: #14141A; }
  button:focus-visible { outline: 2px solid #3D8BFF; outline-offset: 2px; }
  .spark { color: #7FB2FF; }
  .left { font-weight: 500; color: #B4B4BC; }
  .left.out { color: #F5A524; }
`;

/** The label on every button: "Write with unnepo · 3 left" on Free. */
let account: PageState = { ok: false };
const buttons = new Set<ShadowRoot>();
const leftText = () => (account.free && typeof account.left === "number" ? `<span class="left${account.left <= 0 ? " out" : ""}">· ${account.left} left</span>` : "");
const buttonHtml = () => `<style>${BUTTON_STYLE}</style><button type="button" title="Write a cover letter for this job with Unnepo"><span class="spark" aria-hidden="true">✦</span><span>Write with unnepo</span>${leftText()}</button>`;
function relabel() {
  for (const root of buttons) root.innerHTML = buttonHtml();
}

function addButton(spot: Spot) {
  spot.box.setAttribute(MARK, "");
  const host = document.createElement("span");
  host.setAttribute(MARK, "button");
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = buttonHtml();
  buttons.add(root);
  // Inside a <label>, a click would also open the site's upload box: stopped here.
  root.addEventListener("click", (event) => {
    if (!(event.target as Element).closest("button")) return;
    event.preventDefault();
    event.stopPropagation();
    openPopup(spot.box);
  });
  host.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); });
  spot.label.append(host);
}

/* ---------------- The popup ---------------- */

const STEPS = ["format", "length", "tone", "mention"] as const;
const CHOICES: Record<"format" | "length" | "tone", { q: string; options: [string, string, string][] }> = {
  format: { q: "How should it be built?", options: [["match", "Match the job (recommended)", "Answers the posting's top asks, one by one"], ["problem", "Problem, then solution", "Names what the role needs, shows you've done it"], ["achievement", "Lead with a win", "Opens with your strongest result"], ["story", "Short story", "Opens with a real moment from your experience"]] },
  length: { q: "How long should it be?", options: [["short", "Short", "A few lines"], ["standard", "Standard", "The usual cover letter"], ["detailed", "Detailed", "More on your experience"]] },
  tone: { q: "What tone?", options: [["professional", "Professional", "Polished and direct"], ["warm", "Warm", "Friendly and personal"], ["confident", "Confident", "Leads with what you've done"], ["enthusiastic", "Enthusiastic", "Shows you're excited"]] },
};

const POPUP_STYLE = (reduce: boolean) => `
  :host { all: initial; position: fixed; inset: 0; z-index: 2147483647; font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; color: #111114; }
  * { box-sizing: border-box; }
  .scrim { position: absolute; inset: 0; background: rgba(10,10,14,.38); display: grid; place-items: center; padding: 16px; }
  .card { width: min(440px, 100%); max-height: calc(100vh - 32px); overflow: auto; background: #fff; border-radius: 16px; box-shadow: 0 20px 50px rgba(0,0,0,.28); }
  .card.enter { animation: ${reduce ? "none" : "in .22s cubic-bezier(.2,1.2,.4,1) both"}; }
  .scrim.enter { animation: ${reduce ? "none" : "fade .18s ease-out both"}; }
  @keyframes fade { from { opacity: 0; } }
  @keyframes in { from { transform: translateY(12px) scale(.98); opacity: 0; } to { transform: none; opacity: 1; } }
  .head { display: flex; align-items: center; gap: 8px; padding: 14px 14px 6px 16px; }
  .head svg { width: 22px; height: ${Math.round((22 * H) / W)}px; flex: none; }
  .brand { font-weight: 700; font-size: 14px; flex: 1; } .brand span { color: #3D8BFF; }
  .count { font-size: 12px; color: #5C5C66; }
  .icon { all: unset; cursor: pointer; width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; color: #6A6A74; font-size: 18px; }
  .icon:hover { background: #F2F2F6; color: #111114; }
  .main { padding: 6px 16px 16px; display: flex; flex-direction: column; gap: 10px; }
  .progress { display: flex; gap: 4px; } .progress i { flex: 1; height: 3px; border-radius: 2px; background: #EFEFF3; } .progress i.on { background: #3D8BFF; }
  h2 { margin: 4px 0 0; font-size: 17px; font-weight: 700; letter-spacing: -.01em; }
  .sub { font-size: 12px; color: #5C5C66; }
  .opt { all: unset; cursor: pointer; display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border-radius: 10px; border: 1px solid #E4E4EA; font-weight: 600; }
  .opt small { font-weight: 400; font-size: 12px; color: #5C5C66; }
  .opt:hover { border-color: #3D8BFF; background: #F5F9FF; }
  .opt.on { border-color: #3D8BFF; box-shadow: inset 0 0 0 1px #3D8BFF; background: #F5F9FF; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { all: unset; cursor: pointer; padding: 5px 10px; border-radius: 999px; border: 1px solid #D7D7DE; font-size: 12px; }
  .chip.on { background: #111114; color: #fff; border-color: #111114; }
  textarea { width: 100%; font: 13px/1.5 system-ui, sans-serif; color: #111114; border: 1px solid #D7D7DE; border-radius: 10px; padding: 10px; resize: vertical; background: #fff; }
  textarea:focus { outline: 2px solid #3D8BFF; outline-offset: 0; border-color: transparent; }
  .letter { min-height: 260px; }
  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .btn { all: unset; cursor: pointer; height: 36px; padding: 0 14px; border-radius: 10px; font: 600 13px system-ui, sans-serif; display: inline-flex; align-items: center; justify-content: center; gap: 6px; white-space: nowrap; background: #3D8BFF; color: #fff; }
  .btn:hover { background: #2F6FEB; }
  .btn.ghost { background: transparent; color: #111114; box-shadow: inset 0 0 0 1px #D7D7DE; font-weight: 500; }
  .btn.ghost:hover { background: #F5F5F7; }
  .btn.ok { background: #16A34A; }
  .btn.wide { flex: 1; }
  .btn[disabled] { cursor: default; opacity: .6; }
  .quiet { all: unset; cursor: pointer; font-size: 12px; color: #5C5C66; text-decoration: underline; text-underline-offset: 3px; }
  .icon:focus-visible, .btn:focus-visible, .opt:focus-visible, .chip:focus-visible, .quiet:focus-visible { outline: 2px solid #3D8BFF; outline-offset: 2px; }
  .note { font-size: 12px; color: #B45309; }
  .good { font-size: 12px; color: #15803D; font-weight: 600; }
  .writing { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 28px 0 18px; }
  .writing svg { width: 56px; height: ${Math.round((56 * H) / W)}px; animation: ${reduce ? "none" : "bob .6s ease-in-out infinite alternate"}; }
  @keyframes bob { to { transform: translateY(-4px); } }
  .bar { width: 160px; height: 4px; border-radius: 2px; background: #EFEFF3; overflow: hidden; }
  .bar i { display: block; height: 100%; width: 40%; background: #3D8BFF; border-radius: 2px; animation: ${reduce ? "none" : "slide 1.2s ease-in-out infinite"}; }
  @keyframes slide { from { transform: translateX(-100%); } to { transform: translateX(260%); } }
`;

let openHost: HTMLElement | null = null;

function openPopup(box: HTMLElement) {
  if (openHost) return;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const host = document.createElement("div");
  host.setAttribute("data-unnepo-letter-popup", "");
  const root = host.attachShadow({ mode: "closed" });
  openHost = host;
  let spider = spiderRects(0);
  void storedSpiderColors().then((colors) => { spider = spiderRects(0, colors); draw(); });
  const spiderSvg = () => `<svg viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges" aria-hidden="true"><g transform="rotate(180 ${W / 2} ${H / 2})">${spider}</g></svg>`;

  const ui = {
    step: 0 as number, choices: { format: "match", length: "standard", tone: "professional", picked: [] as string[], mention: "" },
    phase: "ask" as "ask" | "writing" | "done", letter: null as Letter | null, edited: false, busy: "", note: "", placed: "",
  };
  const previousFocus = document.activeElement as HTMLElement | null;
  const close = () => {
    host.remove();
    openHost = null;
    document.removeEventListener("keydown", onKey, true);
    previousFocus?.focus?.();
  };
  const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && ui.phase !== "writing") { event.stopPropagation(); close(); } };
  document.addEventListener("keydown", onKey, true);

  const countLine = () => (account.free && typeof account.left === "number" ? `<span class="count">${account.left} left today</span>` : "");

  function askBody() {
    const name = STEPS[ui.step];
    const progress = `<div class="progress" aria-hidden="true">${STEPS.map((_, index) => `<i class="${index <= ui.step ? "on" : ""}"></i>`).join("")}</div>`;
    const back = ui.step > 0 ? `<button type="button" class="quiet" data-act="back">Back</button>` : "<span></span>";
    if (name !== "mention") {
      const { q, options } = CHOICES[name];
      return `${progress}<h2>${q}</h2><div class="sub">Question ${ui.step + 1} of ${STEPS.length}</div>
        ${options.map(([value, label, hint]) => `<button type="button" class="opt${ui.choices[name] === value ? " on" : ""}" data-pick="${name}:${value}" aria-pressed="${ui.choices[name] === value}">${label}<small>${hint}</small></button>`).join("")}
        <div class="row" style="justify-content: space-between">${back}</div>`;
    }
    const highlights = account.highlights ?? [];
    const out = account.free && typeof account.left === "number" && account.left <= 0;
    return `${progress}<h2>${highlights.length ? "Mention specific things from your resume" : "Anything to mention?"}</h2><div class="sub">Question ${STEPS.length} of ${STEPS.length}. Optional</div>
      ${highlights.length ? `<div class="chips" role="group" aria-label="Things from your resume">${highlights.map((item) => `<button type="button" class="chip${ui.choices.picked.includes(item) ? " on" : ""}" data-chip="${escape(item)}" aria-pressed="${ui.choices.picked.includes(item)}">${escape(item)}</button>`).join("")}</div>` : ""}
      <textarea id="mention" rows="2" maxlength="400" aria-label="Anything else to mention (optional)" placeholder="${highlights.length ? "Anything else? Optional" : "Optional: a project, why this company, a skill to lead with…"}">${escape(ui.choices.mention)}</textarea>
      ${ui.note ? `<p class="note" role="status">${escape(ui.note)}</p>` : ""}
      <div class="row" style="justify-content: space-between">${back}<button type="button" class="btn" data-act="write" ${out ? "disabled" : ""}>✦ Write cover letter${account.free && typeof account.left === "number" ? ` · ${account.left} left` : ""}</button></div>
      ${out ? `<p class="note">No cover letters left today on Free. Pro has no limit.</p>` : ""}`;
  }

  function doneBody() {
    const letter = ui.letter!;
    const where = targetsFor(box);
    const primary = where.file || where.drop ? ["attach", "Attach to application"] : where.text ? ["paste", "Put it in the box"] : ["download", "Download PDF"];
    const hint = where.file || where.drop ? "Attaches it as a PDF to the cover letter upload." : where.text ? "Puts the text in the cover letter box." : "This form uploads through its own button: download it, then pick it there.";
    const busy = Boolean(ui.busy);
    return `<h2>Your cover letter</h2>
      <div class="sub">Click into it to change anything. ${hint}</div>
      <textarea class="letter" id="letter" aria-label="Your cover letter" ${busy ? "readonly" : ""}>${escape(letter.text)}</textarea>
      ${letter.upgrade ? `<p class="note">A general letter. ${escape(letter.upgrade)}</p>` : ""}
      ${ui.note ? `<p class="note" role="status">${escape(ui.note)}</p>` : ""}
      ${ui.placed ? `<p class="good" role="status">✓ ${escape(ui.placed)}</p>` : ""}
      <div class="row">
        <button type="button" class="btn wide${ui.placed ? " ok" : ""}" data-act="${primary[0]}" ${busy ? "disabled" : ""}>${ui.busy === primary[0] ? "Saving…" : primary[1]}</button>
        ${primary[0] !== "download" ? `<button type="button" class="btn ghost" data-act="download" ${busy ? "disabled" : ""}>${ui.busy === "download" ? "Saving…" : "PDF"}</button>` : ""}
        <button type="button" class="btn ghost" data-act="copy" ${busy ? "disabled" : ""}>Copy</button>
      </div>
      <div class="row" style="justify-content: space-between"><button type="button" class="quiet" data-act="again">Start over</button>${ui.placed ? `<button type="button" class="btn ghost" data-act="close">Done</button>` : ""}</div>`;
  }

  /** Pops in once, on opening; redraws between questions don't play it again. */
  let drawn = false;
  function draw() {
    const enter = drawn ? "" : " enter";
    drawn = true;
    const focusedId = (root.activeElement as HTMLElement | null)?.id;
    const body = ui.phase === "writing"
      ? `<div class="writing" role="status">${spiderSvg()}<div class="bar"><i></i></div><span class="sub">Writing your cover letter…</span></div>`
      : ui.phase === "done" ? doneBody() : askBody();
    root.innerHTML = `<style>${POPUP_STYLE(reduce)}</style>
      <div class="scrim${enter}" data-act="scrim">
        <div class="card${enter}" role="dialog" aria-modal="true" aria-label="Write a cover letter with Unnepo">
          <div class="head">${spiderSvg()}<span class="brand">unnepo<span>.</span></span>${countLine()}<button type="button" class="icon" data-act="close" aria-label="Close">×</button></div>
          <div class="main">${body}</div>
        </div>
      </div>`;
    const again = focusedId ? root.getElementById(focusedId) : null;
    (again ?? root.querySelector<HTMLElement>(".opt.on, .opt, .btn, textarea"))?.focus();
  }

  /** The letter as the student left it; edited text is saved first so the PDF has their changes. */
  async function current(): Promise<Letter | null> {
    const typed = root.getElementById("letter") as HTMLTextAreaElement | null;
    if (typed && ui.letter && typed.value !== ui.letter.text) { ui.letter = { ...ui.letter, text: typed.value }; ui.edited = true; }
    if (!ui.edited || !ui.letter) return ui.letter;
    const saved = await ask<Wrote>({ type: "letter-page-write", options: { text: ui.letter.text } }).catch((): Wrote => ({ ok: false, error: "Unnepo was updated. Refresh this page" }));
    if (!saved.ok || !saved.doc) { ui.note = saved.error ?? "Couldn't save your edits."; return null; }
    ui.letter = { ...saved.doc, upgrade: ui.letter.upgrade };
    ui.edited = false;
    return ui.letter;
  }

  async function write() {
    const mention = (root.getElementById("mention") as HTMLTextAreaElement | null)?.value ?? ui.choices.mention;
    ui.choices.mention = mention;
    ui.phase = "writing";
    ui.note = "";
    draw();
    const { format, length, tone, picked } = ui.choices;
    const result = await ask<Wrote>({ type: "letter-page-write", options: { format, length, tone, mention: [...picked, mention.trim()].filter(Boolean).join("; ") } }).catch((): Wrote => ({ ok: false, error: "Unnepo was updated. Refresh this page" }));
    if (result.ok && result.doc) {
      ui.letter = result.doc;
      ui.phase = "done";
    } else {
      ui.phase = "ask";
      ui.note = result.error ?? "Couldn't write the cover letter.";
    }
    draw();
    // One fewer left on Free: the count in the corner changes without redrawing the letter being read.
    void refreshAccount().then(() => {
      const count = root.querySelector(".count");
      if (count && account.free && typeof account.left === "number") count.textContent = `${account.left} left today`;
    });
  }

  async function act(name: string) {
    if (name === "close") return close();
    if (name === "back") { ui.step = Math.max(0, ui.step - 1); ui.note = ""; return draw(); }
    if (name === "write") return write();
    if (name === "again") { Object.assign(ui, { phase: "ask", step: 0, letter: null, edited: false, note: "", placed: "" }); return draw(); }
    if (name === "copy") {
      const typed = root.getElementById("letter") as HTMLTextAreaElement | null;
      const text = typed?.value ?? ui.letter?.text ?? "";
      try { await navigator.clipboard.writeText(text); ui.placed = "Copied"; } catch { typed?.select(); ui.note = "Press ⌘C (Ctrl+C) to copy it."; }
      return draw();
    }
    // Text into the form's box: as it is in the popup, edits and all. No PDF needed, so nothing to save first.
    if (name === "paste") {
      const typed = root.getElementById("letter") as HTMLTextAreaElement | null;
      const where = targetsFor(box);
      if (where.text) { putText(where.text, typed?.value ?? ui.letter?.text ?? ""); ui.placed = "In the cover letter box"; }
      return draw();
    }
    // The PDF: edits are saved first so it has them.
    if (name === "attach" || name === "download") {
      ui.busy = name;
      ui.note = "";
      draw();
      const letter = await current();
      ui.busy = "";
      if (letter) {
        const where = targetsFor(box);
        try {
          if (name === "attach" && where.file) { attach(where.file, letter); ui.placed = "Attached to the application"; }
          else if (name === "attach" && where.drop) {
            const before = textOf(box);
            dropOn(where.drop, letter);
            await new Promise((done) => setTimeout(done, 700));
            // The form shows the file's name once it took it; otherwise it downloads, to upload by hand.
            const took = textOf(box) !== before && textOf(box).includes((letter.fileName || "Cover letter.pdf").replace(/\.pdf$/i, ""));
            if (took) ui.placed = "Attached to the application";
            else { download(letter); ui.placed = "This form didn't take it, so it downloaded. Upload it with the form's button"; }
          }
          else { download(letter); ui.placed = "Downloaded. Upload it with the form's button"; }
        } catch {
          download(letter);
          ui.placed = "This site blocks it, so it downloaded. Upload it with the form's button";
        }
      }
      return draw();
    }
  }

  root.addEventListener("click", (event) => {
    const target = event.target as Element;
    const pick = target.closest<HTMLElement>("[data-pick]");
    if (pick) {
      const [name, value] = (pick.dataset.pick ?? "").split(":") as ["format" | "length" | "tone", string];
      ui.choices[name] = value;
      ui.step = Math.min(STEPS.length - 1, ui.step + 1);
      return draw();
    }
    const chip = target.closest<HTMLElement>("[data-chip]");
    if (chip) {
      const item = chip.dataset.chip ?? "";
      ui.choices.mention = (root.getElementById("mention") as HTMLTextAreaElement | null)?.value ?? ui.choices.mention;
      ui.choices.picked = ui.choices.picked.includes(item) ? ui.choices.picked.filter((entry) => entry !== item) : [...ui.choices.picked, item];
      return draw();
    }
    const button = target.closest<HTMLElement>("[data-act]");
    if (!button) return;
    // A click on the dim backdrop (not the card) closes it, but never while writing.
    if (button.dataset.act === "scrim") { if (target === button && ui.phase !== "writing") close(); return; }
    void act(button.dataset.act ?? "");
  });
  // Keep the student's typing in the letter between redraws.
  root.addEventListener("input", (event) => {
    const el = event.target as HTMLTextAreaElement;
    if (el.id === "letter" && ui.letter && el.value !== ui.letter.text) { ui.letter = { ...ui.letter, text: el.value }; ui.edited = true; ui.placed = ""; }
    if (el.id === "mention") ui.choices.mention = el.value;
  });
  // Site shortcuts don't fire while typing in the popup.
  for (const type of ["keydown", "keyup", "keypress"]) root.addEventListener(type, (event) => event.stopPropagation());

  mountAbove(host);
  draw();
  // Still hidden behind the site's own window: write the letter in the side panel instead. This runs inside the
  // click, so Chrome lets the panel open.
  if (coveredUp(host)) {
    close();
    void ask({ type: "letter-in-panel" }).catch(() => undefined);
  }
}

async function refreshAccount() {
  try {
    account = await ask<PageState>({ type: "letter-page-state" });
  } catch {
    account = { ok: false };
  }
  relabel();
  return account;
}

function scan() {
  if (!account.ok) return;
  for (const spot of findSpots()) addButton(spot);
}

/** Watches the page (forms appear step by step) and adds the button beside each cover letter question as it shows up. */
export async function watchLetterBoxes() {
  if (!(await refreshAccount()).ok) return;
  let pending = 0;
  const observer = new MutationObserver((records) => {
    if (records.every((record) => record.target instanceof Element && ours(record.target))) return;
    if (!pending) pending = window.setTimeout(() => { pending = 0; scan(); }, 700);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  scan();
  // The count after a letter is written in the panel, or on another tab.
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void refreshAccount(); });
}
