import { H, W, spiderRects, storedSpiderColors } from "../shared/sprite";
import { isComplexQuestion } from "./question-kinds";

/**
 * Unnepo on an application form, like Grammarly. Boxes it can fill from the profile get a soft blue outline,
 * grouped about five at a time, each group with its own ⚡ Fill button beside it: one press fills just those, from
 * the student's own details with no AI, so it's quick. Questions that need a written answer get a purple outline,
 * and the bar at the bottom has "Answer with unnepo" for those. Stop (on the bar, or the group's button while it
 * fills) stops at once. Uploads (resume, transcript, cover letter) and links keep their own buttons.
 *
 * Boxes lose their outline once they have an answer, so the outlines show what's left. Only the outlines' own
 * style is changed (and put back); nothing is filled or sent until a button is pressed. Shows only when the
 * student is signed in, and stays off when "Cards on job pages" is off. × hides it on this page.
 */

const FILL = "#3D8BFF";
const WRITE = "#8B5CF6";
const MARK = "data-unnepo-form";
const PICK = "data-unnepo-pick";
const HIDDEN = "unnepoFormHidden";
const GROUP = 5;
const CONTROLS = "input:not([type]), input[type=text], input[type=email], input[type=tel], input[type=url], input[type=number], input[type=date], input[type=month], textarea, select";
/** Link boxes have their own chip (link-buttons.ts), so they're left out of the groups. */
const LINK = /linked ?in|git ?hub|portfolio|personal (web ?site|site)|\bweb ?site\b/i;

type State = { ok: boolean; off?: boolean; free?: boolean; answersLeft?: number | null; profileReady?: boolean };
type Box = { control: HTMLElement; outline: HTMLElement; kind: "fill" | "write"; label: string };
type Group = { key: HTMLElement; boxes: Box[] };

const ask = <T>(message: unknown) => chrome.runtime.sendMessage(message) as Promise<T>;
const clean = (text: string | null | undefined) => (text ?? "").replace(/\s+/g, " ").trim();
const ours = (el: Element) => Boolean(el.closest(`[${MARK}], [data-unnepo-letter], [data-unnepo-link], [data-unnepo-card], [data-unnepo-launcher]`));
const pageKey = () => location.origin + location.pathname;
const escapeText = (text: string) => text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

/** The hidden inputs some sites keep behind their own dropdowns, only there to make the form "required". */
const helperInput = (el: Element) => el.getAttribute("role") !== "combobox" && (el.getAttribute("aria-hidden") === "true" || (el as HTMLElement).tabIndex < 0);
/** How many real fields are inside a wrapper (not counting those hidden helpers). */
const fieldsIn = (box: Element) => Array.from(box.querySelectorAll(CONTROLS)).filter((el) => !helperInput(el)).length;

/** The question a box asks: its label, aria text, or the short text of the wrapper around it. */
function labelOf(el: HTMLElement) {
  const input = el as HTMLInputElement;
  const fromLabels = Array.from(input.labels ?? []).map((label) => clean(label.textContent)).join(" ");
  if (fromLabels) return fromLabels;
  const aria = el.getAttribute("aria-label") || (el.getAttribute("aria-labelledby") ?? "").split(/\s+/).map((id) => clean(document.getElementById(id)?.textContent)).join(" ");
  if (clean(aria)) return clean(aria);
  let box: HTMLElement | null = el.parentElement;
  for (let depth = 0; box && depth < 4; depth++, box = box.parentElement) {
    if (fieldsIn(box) > 1) break;
    const text = clean(box.innerText);
    if (text && text.length <= 300) return text;
  }
  return clean(input.placeholder || input.name);
}

/**
 * What to outline: the bordered box the site draws around this field (label and all), or the field itself. A
 * site's own dropdown types into a tiny input inside it (3px wide on Greenhouse, with the border drawn some other
 * way), so for those it's the dropdown's visible box.
 */
function outlineFor(el: HTMLElement) {
  let visible: HTMLElement | null = null;
  const tiny = el.getBoundingClientRect().width < 20;
  let box: HTMLElement | null = el.parentElement;
  for (let depth = 0; box && depth < 5; depth++, box = box.parentElement) {
    if (fieldsIn(box) > 1 || box.matches("form, fieldset, body")) break;
    const style = getComputedStyle(box);
    if (parseFloat(style.borderTopWidth) > 0 && style.borderTopStyle !== "none") return box;
    // The widest wrapper that's still just the dropdown (about its own height, not its label and hints too).
    const rect = box.getBoundingClientRect();
    if (tiny && rect.width >= 100 && rect.height >= 24 && (!visible || rect.height <= visible.getBoundingClientRect().height * 1.6)) visible = box;
  }
  return visible ?? el;
}

/** Whether a field has an answer: its value, or for a site's own dropdown, a choice shown in place of "Select…". */
function answered(el: HTMLElement, outline: HTMLElement) {
  if (el instanceof HTMLSelectElement) return el.selectedIndex > 0 || Boolean(el.value && !/^select/i.test(el.selectedOptions[0]?.text ?? ""));
  if ((el as HTMLInputElement).value?.trim()) return true;
  if (el.getAttribute("role") === "combobox" && outline !== el) {
    const shown = clean(outline.innerText).replace(labelOf(el), "").replace(/[*\s]+/g, " ").trim();
    return Boolean(shown) && !/^select/i.test(shown);
  }
  return false;
}

/** Every field on the form Unnepo can help with, in page order. */
function findBoxes(): Box[] {
  const boxes: Box[] = [];
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(CONTROLS))) {
    const combo = el.getAttribute("role") === "combobox";
    if (ours(el) || (el as HTMLInputElement).disabled || ((el as HTMLInputElement).readOnly && !combo)) continue;
    if (helperInput(el)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 && rect.height < 2 && !combo) continue;
    if (el.closest("header, nav, footer, [role=search]") || (el as HTMLInputElement).type === "search") continue;
    const label = labelOf(el);
    if (!label || /search/i.test(label)) continue;
    const type = el instanceof HTMLTextAreaElement ? "textarea" : el instanceof HTMLSelectElement ? "select" : "text";
    const kind = isComplexQuestion(type, label) ? "write" : "fill";
    if (kind === "fill" && LINK.test(label)) continue;
    const outline = outlineFor(el);
    if (outline.getBoundingClientRect().width < 20) continue;
    boxes.push({ control: el, outline, kind, label });
  }
  return boxes;
}

/**
 * The blue boxes in page order, five to a group: group 1 is the first five, group 2 the next five, and so on,
 * filled one after another. Purple questions aren't in any group (Answer with unnepo writes those).
 */
function groupsOf(boxes: Box[]): Group[] {
  const fills = boxes.filter((box) => box.kind === "fill");
  const groups: Group[] = [];
  for (let at = 0; at < fills.length; at += GROUP) groups.push({ key: fills[at].control, boxes: fills.slice(at, at + GROUP) });
  return groups;
}

/* ---------- Outlines ---------- */

const before = new Map<HTMLElement, { outline: string; offset: string }>();
function paint(el: HTMLElement, color: string | null) {
  if (!color) {
    const was = before.get(el);
    if (was) { el.style.outline = was.outline; el.style.outlineOffset = was.offset; before.delete(el); }
    return;
  }
  if (!before.has(el)) before.set(el, { outline: el.style.outline, offset: el.style.outlineOffset });
  el.style.outline = `2px solid ${color}`;
  el.style.outlineOffset = "2px";
}
const clearAll = () => { for (const el of Array.from(before.keys())) paint(el, null); };

/* ---------- The bar, and each group's Fill ---------- */

export function watchForms(isJobPage: () => boolean) {
  try { if ((JSON.parse(sessionStorage.getItem(HIDDEN) || "[]") as string[]).includes(pageKey())) return; } catch { /* storage off */ }

  let state: State = { ok: false };
  let boxes: Box[] = [];
  let groups: Group[] = [];
  /** The group filling now (its first box), and boxes Unnepo already tried to fill (what's left is the student's). */
  let filling: HTMLElement | null = null;
  const tried = new WeakSet<HTMLElement>();
  const ui = { small: false, answering: false, note: "", shown: false };
  let bar: { host: HTMLElement; root: ShadowRoot } | null = null;
  let layer: { host: HTMLElement; root: ShadowRoot } | null = null;
  let spider = spiderRects(0);
  void storedSpiderColors().then((colors) => { spider = spiderRects(0, colors); draw(); });
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const spiderSvg = () => `<svg viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges" aria-hidden="true"><g transform="rotate(180 ${W / 2} ${H / 2})">${spider}</g></svg>`;

  const BUTTONS = `
    .btn { all: unset; cursor: pointer; height: 30px; padding: 0 11px; border-radius: 9px; font: 600 12.5px system-ui, -apple-system, sans-serif; display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; color: #fff; box-sizing: border-box; }
    .btn.fill { background: ${FILL}; } .btn.fill:hover { background: #2F6FEB; }
    .btn.write { background: ${WRITE}; } .btn.write:hover { background: #7C3AED; }
    .btn.stop { background: #111114; } .btn.stop:hover { background: #2A2A30; }
    .btn.ghost { background: #fff; color: #45454E; box-shadow: inset 0 0 0 1px #D7D7DE; font-weight: 500; cursor: default; }
    .btn[disabled] { cursor: default; opacity: .5; }
    .btn:focus-visible, .icon:focus-visible, .pill:focus-visible { outline: 2px solid #3D8BFF; outline-offset: 2px; }
  `;
  const BAR_STYLE = `
    :host { all: initial; position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); z-index: 2147483645; font: 13px/1.3 system-ui, -apple-system, "Segoe UI", sans-serif; color: #111114; }
    * { box-sizing: border-box; }
    .bar { display: flex; align-items: center; gap: 10px; padding: 8px 8px 8px 12px; background: #fff; border: 1px solid #E4E4EA; border-radius: 14px; box-shadow: 0 12px 30px rgba(0,0,0,.16), 0 2px 6px rgba(0,0,0,.06); max-width: calc(100vw - 24px); }
    .bar.enter { animation: ${reduce ? "none" : "up .26s cubic-bezier(.2,1.2,.4,1) both"}; }
    @keyframes up { from { transform: translateY(14px); opacity: 0; } }
    svg { width: 22px; height: ${Math.round((22 * H) / W)}px; flex: none; }
    .brand { font-weight: 700; font-size: 14px; } .brand span { color: #3D8BFF; }
    .sep { width: 1px; height: 24px; background: #EFEFF3; flex: none; }
    .group { display: flex; align-items: center; gap: 8px; }
    .key { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: #45454E; white-space: nowrap; }
    .key i { width: 10px; height: 10px; border-radius: 3px; border: 2px solid; display: block; }
    .left { font-weight: 500; opacity: .85; }
    .icon { all: unset; cursor: pointer; width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; color: #6A6A74; font-size: 16px; flex: none; }
    .icon:hover { background: #F2F2F6; color: #111114; }
    .note { font-size: 12px; color: #B45309; max-width: 260px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .done { font-size: 12px; color: #15803D; font-weight: 600; white-space: nowrap; }
    .pill { all: unset; cursor: pointer; display: flex; align-items: center; gap: 8px; padding: 7px 12px 7px 10px; background: #fff; border: 1px solid #E4E4EA; border-radius: 999px; box-shadow: 0 6px 18px rgba(0,0,0,.14); font-weight: 600; }
    .pill svg { width: 18px; height: ${Math.round((18 * H) / W)}px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; }
    @media (max-width: 640px) { .key { display: none; } }
    ${BUTTONS}
  `;
  const LAYER_STYLE = `
    :host { all: initial; position: absolute; left: 0; top: 0; width: 0; height: 0; z-index: 2147483644; font: 13px/1.3 system-ui, -apple-system, sans-serif; }
    .bracket { position: absolute; width: 9px; box-sizing: border-box; border: 3px solid ${FILL}; border-right: 0; border-radius: 7px 0 0 7px; pointer-events: none; opacity: .55; }
    .bracket.next, .bracket.on { opacity: 1; }
    .bracket.done { border-color: #22C55E; opacity: .8; }
    .bracket.theirs { border-color: #A1A1AA; opacity: .6; }
    .num { position: absolute; left: -14px; top: 50%; transform: translateY(-50%); width: 22px; height: 22px; border-radius: 50%; background: ${FILL}; color: #fff; font: 700 11px/22px system-ui, sans-serif; text-align: center; box-shadow: 0 0 0 2px #fff; }
    .done .num { background: #22C55E; } .theirs .num { background: #A1A1AA; }
    .btn.fill.later { background: #fff; color: ${FILL}; box-shadow: inset 0 0 0 1.5px ${FILL}, 0 4px 12px rgba(0,0,0,.1); }
    .btn.fill.later:hover { background: #F5F9FF; }
    .link { position: absolute; width: 0; border-left: 2px dashed ${FILL}; opacity: .35; pointer-events: none; }
    .link.next, .link.on { opacity: .8; } .link.done { border-color: #22C55E; } .link.theirs { border-color: #A1A1AA; }
    .tag { position: absolute; display: flex; align-items: center; gap: 6px; }
    .btn { height: 28px; font-size: 12px; box-shadow: 0 4px 12px rgba(0,0,0,.14); }
    .btn .n { font-weight: 500; opacity: .85; }
    ${BUTTONS}
  `;

  const open = (box: Box) => !answered(box.control, box.outline);
  const counts = () => ({ fill: boxes.filter((box) => box.kind === "fill" && open(box)).length, write: boxes.filter((box) => box.kind === "write" && open(box)).length });

  function drawBar() {
    if (!bar) return;
    const { fill, write } = counts();
    const root = bar.root;
    if (ui.small) {
      root.innerHTML = `<style>${BAR_STYLE}</style><button type="button" class="pill" data-act="grow" aria-label="Show Unnepo's form help">${spiderSvg()}${fill + write ? `${fill + write} to do` : "All filled"}${fill ? `<span class="dot" style="background:${FILL}"></span>` : ""}${write ? `<span class="dot" style="background:${WRITE}"></span>` : ""}</button>`;
      return;
    }
    const answersLeft = state.free && typeof state.answersLeft === "number" ? state.answersLeft : null;
    const next = nextGroup();
    const busyAt = groups.findIndex((group) => group.key === filling);
    const fillPart = filling
      ? `<div class="group"><span class="key"><i style="border-color:${FILL}"></i>Filling group ${busyAt + 1} of ${groups.length}…</span><button type="button" class="btn stop" data-act="stop">■ Stop</button></div>`
      : next >= 0
        ? `<div class="group"><span class="key"><i style="border-color:${FILL}"></i>Group ${next + 1} of ${groups.length}</span><button type="button" class="btn fill" data-act="next" title="Fills the next five boxes from your profile">⚡ Fill next ${groups[next].boxes.filter(open).length}</button></div>`
        : fill
          ? `<span class="key"><i style="border-color:${FILL}"></i>${fill} left for you</span>`
          : `<span class="done">✓ Boxes filled</span>`;
    const writePart = write || ui.answering
      ? `<span class="sep"></span><div class="group"><span class="key"><i style="border-color:${WRITE}"></i>${write} to write</span>${ui.answering
        ? `<button type="button" class="btn write" disabled>Writing ${write} ${write === 1 ? "answer" : "answers"}…</button>`
        : `<button type="button" class="btn write" data-act="answer" ${!write || answersLeft === 0 ? "disabled" : ""} title="Writes the purple questions from your resume and the job">✦ Answer with unnepo${answersLeft !== null ? `<span class="left">· ${answersLeft} left</span>` : ""}</button>`}</div>`
      : "";
    const enter = ui.shown ? "" : " enter";
    ui.shown = true;
    root.innerHTML = `<style>${BAR_STYLE}</style>
      <div class="bar${enter}" role="region" aria-label="Unnepo form help">
        ${spiderSvg()}<span class="brand">unnepo<span>.</span></span>
        <span class="sep"></span>
        ${fillPart}${writePart}
        ${ui.note ? `<span class="note" title="${escapeText(ui.note)}">${escapeText(ui.note)}</span>` : ""}
        <button type="button" class="icon" data-act="small" aria-label="Shrink">–</button>
        <button type="button" class="icon" data-act="hide" aria-label="Hide on this page" title="Hide on this page">×</button>
      </div>`;
  }

  /** The group to fill next: the first, in page order, that still has boxes Unnepo hasn't tried. */
  const nextGroup = () => groups.findIndex((group) => group.boxes.some((box) => open(box) && !tried.has(box.control)));

  /** Each group's numbered bracket down its left side, and its Fill button beside its first box. */
  function drawLayer() {
    if (!layer) return;
    const x = window.scrollX;
    const y = window.scrollY;
    const next = nextGroup();
    const parts: string[] = [];
    groups.forEach((group, index) => {
      const left = group.boxes.filter(open);
      const busy = filling === group.key;
      const rects = group.boxes.map((box) => box.outline.getBoundingClientRect()).filter((rect) => rect.width > 0);
      if (!rects.length) return;
      const minLeft = Math.min(...rects.map((rect) => rect.left));
      const first = rects[0];
      const theirs = left.length > 0 && left.every((box) => tried.has(box.control));
      const state = busy ? "on" : !left.length ? "done" : theirs ? "theirs" : index === next ? "next" : "later";
      // A purple question between two of the group's boxes splits its bracket, joined by a dashed line, so the
      // bracket only ever covers boxes it fills.
      const runs: Box[][] = [];
      let run: Box[] = [];
      let last = -1;
      for (const box of group.boxes) {
        const at = boxes.indexOf(box);
        if (run.length && boxes.slice(last + 1, at).some((other) => other.kind === "write")) { runs.push(run); run = []; }
        run.push(box);
        last = at;
      }
      if (run.length) runs.push(run);
      const edge = Math.max(16, minLeft - 14) + x;
      let prevBottom: number | null = null;
      runs.forEach((boxesInRun, runIndex) => {
        const runRects = boxesInRun.map((box) => box.outline.getBoundingClientRect()).filter((rect) => rect.width > 0);
        if (!runRects.length) return;
        const top = Math.min(...runRects.map((rect) => rect.top)) - 4 + y;
        const bottom = Math.max(...runRects.map((rect) => rect.bottom)) + 4 + y;
        if (prevBottom !== null) parts.push(`<div class="link ${state}" style="left:${edge}px;top:${prevBottom}px;height:${Math.max(0, top - prevBottom)}px"></div>`);
        parts.push(`<div class="bracket ${state}" style="left:${edge}px;top:${top}px;height:${bottom - top}px">${runIndex === 0 ? `<span class="num">${state === "done" ? "✓" : index + 1}</span>` : ""}</div>`);
        prevBottom = bottom;
      });
      if (state === "done") return;
      // Beside the first box on the right when there's room; else just inside its top-right corner.
      const room = window.innerWidth - first.right > 150;
      const place = room ? `left:${first.right + 12 + x}px;top:${first.top + y + 4}px` : `left:${first.right - 132 + x}px;top:${first.top + y - 14}px`;
      const button = busy
        ? `<button type="button" class="btn stop" data-act="stop">■ Stop</button>`
        : theirs
          ? `<span class="btn ghost" title="Unnepo doesn't have these in your profile">${left.length} for you</span>`
          : `<button type="button" class="btn fill${state === "later" ? " later" : ""}" data-fill="${index}" ${filling ? "disabled" : ""} aria-label="Fill group ${index + 1}: ${left.length} boxes from your profile">⚡ Fill ${index + 1}<span class="n">· ${left.length}</span></button>`;
      parts.push(`<div class="tag" style="${place}">${button}</div>`);
    });
    layer.root.innerHTML = `<style>${LAYER_STYLE}</style>${parts.join("")}`;
  }

  function draw() { drawBar(); drawLayer(); }

  function repaint() {
    const keep = new Set<HTMLElement>();
    for (const box of boxes) {
      if (!open(box)) continue;
      paint(box.outline, box.kind === "fill" ? `${FILL}99` : WRITE);
      keep.add(box.outline);
    }
    for (const el of Array.from(before.keys())) if (!keep.has(el)) paint(el, null);
  }

  function rescan() {
    boxes = findBoxes();
    groups = groupsOf(boxes);
    repaint();
  }

  async function fillGroup(group: Group) {
    if (filling) return;
    filling = group.key;
    ui.note = "";
    document.querySelectorAll(`[${PICK}]`).forEach((el) => el.removeAttribute(PICK));
    const left = group.boxes.filter(open);
    for (const box of left) box.control.setAttribute(PICK, "");
    draw();
    type Filled = { ok: boolean; filled?: number; empty?: number; stopped?: boolean; error?: string };
    const result = await ask<Filled>({ type: "form-fill-group" }).catch((): Filled => ({ ok: false, error: "Unnepo was updated. Refresh this page" }));
    for (const box of left) { box.control.removeAttribute(PICK); tried.add(box.control); }
    // Stop already let it go: nothing more to say.
    if (filling !== group.key) return;
    filling = null;
    if (!result.ok && !result.stopped) ui.note = result.error ?? "Couldn't fill these.";
    rescan();
    draw();
    // Then the next five: brought into view when they're off the screen.
    const upNext = groups[nextGroup()];
    const at = upNext?.boxes[0]?.outline.getBoundingClientRect();
    if (result.ok && at && (at.top < 0 || at.bottom > window.innerHeight - 90)) upNext.boxes[0].outline.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
  }

  async function stopNow() {
    filling = null;
    document.querySelectorAll(`[${PICK}]`).forEach((el) => el.removeAttribute(PICK));
    draw();
    await ask({ type: "form-stop" }).catch(() => undefined);
    rescan();
    draw();
  }

  async function act(name: string) {
    if (name === "small") { ui.small = true; return drawBar(); }
    if (name === "grow") { ui.small = false; return drawBar(); }
    if (name === "stop") return stopNow();
    if (name === "next") { const group = groups[nextGroup()]; if (group) void fillGroup(group); return; }
    if (name === "hide") {
      try { sessionStorage.setItem(HIDDEN, JSON.stringify([...(JSON.parse(sessionStorage.getItem(HIDDEN) || "[]") as string[]), pageKey()].slice(-30))); } catch { /* storage off */ }
      return stop();
    }
    if (name === "answer") {
      ui.answering = true;
      ui.note = "";
      drawBar();
      type Answered = { ok: boolean; written?: number; stopped?: string; error?: string; found?: number };
      const result = await ask<Answered>({ type: "form-answer" }).catch((): Answered => ({ ok: false, error: "Unnepo was updated. Refresh this page" }));
      ui.answering = false;
      ui.note = !result.ok ? result.error ?? "Couldn't write the answers." : result.stopped ? result.stopped : result.found === 0 ? "No questions to write here." : "";
      try { state = { ...state, ...(await ask<State>({ type: "form-page-state" })) }; } catch { /* keep the old count */ }
      rescan();
      draw();
    }
  }

  let pending = 0;
  const later = () => { if (!pending) pending = window.setTimeout(() => { pending = 0; rescan(); draw(); }, 400); };
  const onInput = (event: Event) => { if (!(event.target instanceof Element && ours(event.target))) later(); };
  let observer: MutationObserver | null = null;

  function stop() {
    observer?.disconnect();
    document.removeEventListener("input", onInput, true);
    document.removeEventListener("change", onInput, true);
    window.removeEventListener("resize", later);
    clearAll();
    bar?.host.remove();
    layer?.host.remove();
    bar = null;
    layer = null;
  }

  function mount(name: string) {
    const host = document.createElement("div");
    host.setAttribute(MARK, name);
    const root = host.attachShadow({ mode: "closed" });
    root.addEventListener("click", (event) => {
      const target = event.target as Element;
      const fill = target.closest<HTMLElement>("[data-fill]");
      if (fill && !(fill as HTMLButtonElement).disabled) { const group = groups[Number(fill.dataset.fill)]; if (group) void fillGroup(group); return; }
      const button = target.closest<HTMLElement>("[data-act]");
      if (button && !(button as HTMLButtonElement).disabled) void act(button.dataset.act ?? "");
    });
    document.documentElement.append(host);
    return { host, root };
  }

  /** "never": signed out or turned off, so it stops looking; "later": not a form yet. */
  async function start(): Promise<"shown" | "later" | "never"> {
    try { state = await ask<State>({ type: "form-page-state" }); } catch { return "never"; }
    if (!state.ok || state.off) return "never";
    rescan();
    // An application form: a few boxes to fill, on a page that looks like a job application.
    if (boxes.length < 4) { clearAll(); return "later"; }
    layer = mount("layer");
    bar = mount("bar");
    draw();
    document.addEventListener("input", onInput, true);
    document.addEventListener("change", onInput, true);
    window.addEventListener("resize", later);
    observer = new MutationObserver((records) => { if (!records.every((record) => record.target instanceof Element && ours(record.target))) later(); });
    observer.observe(document.body, { childList: true, subtree: true });
    return "shown";
  }

  // Job sites build their forms after loading, so it looks a few times over the first half minute.
  let tries = 0;
  const check = async () => {
    if (bar) return;
    if (isJobPage() && document.querySelectorAll(CONTROLS).length >= 4 && (await start()) !== "later") return;
    if (++tries < 12) window.setTimeout(() => void check(), 2500);
  };
  void check();
}
