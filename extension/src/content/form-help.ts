import { H, W, spiderRects, storedSpiderColors } from "../shared/sprite";
import { isComplexQuestion } from "./question-kinds";

/**
 * Unnepo on an application form, like Grammarly: every box it can fill from the profile gets a soft blue
 * outline, every question that needs a written answer gets a purple one, and a bar at the bottom of the page
 * offers Autofill (the boxes) and Answer with unnepo (the questions). Boxes lose their outline once they have an
 * answer, so the outlines show what's left. Only the outlines' own style is changed (and put back); nothing is
 * filled or sent until a button is pressed. Shows only when the student is signed in, and stays off when
 * "Cards on job pages" is off. × hides it on this page.
 */

const FILL = "#3D8BFF";
const WRITE = "#8B5CF6";
const MARK = "data-unnepo-form";
const HIDDEN = "unnepoFormHidden";
const CONTROLS = "input:not([type]), input[type=text], input[type=email], input[type=tel], input[type=url], input[type=number], input[type=date], input[type=month], textarea, select";

type State = { ok: boolean; off?: boolean; free?: boolean; answersLeft?: number | null; autofillsLeft?: number | null; running?: boolean; step?: string; error?: string | null; profileReady?: boolean };
type Box = { control: HTMLElement; outline: HTMLElement; kind: "fill" | "write"; label: string };

const ask = <T>(message: unknown) => chrome.runtime.sendMessage(message) as Promise<T>;
const clean = (text: string | null | undefined) => (text ?? "").replace(/\s+/g, " ").trim();
const ours = (el: Element) => Boolean(el.closest(`[${MARK}=bar], [data-unnepo-letter], [data-unnepo-link], [data-unnepo-card], [data-unnepo-launcher]`));
const pageKey = () => location.origin + location.pathname;

/** The question a box asks: its label, aria text, or the short text of the wrapper around it. */
function labelOf(el: HTMLElement) {
  const input = el as HTMLInputElement;
  const fromLabels = Array.from(input.labels ?? []).map((label) => clean(label.textContent)).join(" ");
  if (fromLabels) return fromLabels;
  const aria = el.getAttribute("aria-label") || (el.getAttribute("aria-labelledby") ?? "").split(/\s+/).map((id) => clean(document.getElementById(id)?.textContent)).join(" ");
  if (clean(aria)) return clean(aria);
  let box: HTMLElement | null = el.parentElement;
  for (let depth = 0; box && depth < 4; depth++, box = box.parentElement) {
    if (box.querySelectorAll(CONTROLS).length > 1) break;
    const text = clean(box.innerText);
    if (text && text.length <= 300) return text;
  }
  return clean(input.placeholder || input.name);
}

/** What to outline: the bordered box the site draws around this field (label and all), or the field itself. */
function outlineFor(el: HTMLElement) {
  let best: HTMLElement = el;
  let box: HTMLElement | null = el.parentElement;
  for (let depth = 0; box && depth < 4; depth++, box = box.parentElement) {
    if (box.querySelectorAll(CONTROLS).length > 1 || box.matches("form, fieldset, body")) break;
    const style = getComputedStyle(box);
    if (parseFloat(style.borderTopWidth) > 0 && style.borderTopStyle !== "none") { best = box; break; }
  }
  return best;
}

/** Whether a field has an answer: its value, or for a site's own dropdown, a choice shown in place of "Select…". */
function answered(el: HTMLElement, outline: HTMLElement) {
  if (el instanceof HTMLSelectElement) return el.selectedIndex > 0 || Boolean(el.value && !/^select/i.test(el.selectedOptions[0]?.text ?? ""));
  const value = (el as HTMLInputElement).value?.trim();
  if (value) return true;
  if (el.getAttribute("role") === "combobox" && outline !== el) {
    const label = labelOf(el);
    const shown = clean(outline.innerText).replace(label, "").replace(/[*\s]+/g, " ").trim();
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
    // The hidden inputs some sites keep behind their own dropdowns, only there to make the form "required".
    if (!combo && (el.getAttribute("aria-hidden") === "true" || el.tabIndex < 0)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 && rect.height < 2 && !combo) continue;
    if (el.closest("header, nav, footer, [role=search]") || (el as HTMLInputElement).type === "search") continue;
    const label = labelOf(el);
    if (!label || /search/i.test(label)) continue;
    const type = el instanceof HTMLTextAreaElement ? "textarea" : el instanceof HTMLSelectElement ? "select" : "text";
    const outline = outlineFor(el);
    if (outline.getBoundingClientRect().width < 20) continue;
    boxes.push({ control: el, outline, kind: isComplexQuestion(type, label) ? "write" : "fill", label });
  }
  return boxes;
}

/* ---------- Outlines ---------- */

const before = new Map<HTMLElement, { outline: string; offset: string; radius: string }>();
function paint(el: HTMLElement, color: string | null) {
  if (!color) {
    const was = before.get(el);
    if (was) { el.style.outline = was.outline; el.style.outlineOffset = was.offset; before.delete(el); }
    return;
  }
  if (!before.has(el)) before.set(el, { outline: el.style.outline, offset: el.style.outlineOffset, radius: el.style.borderRadius });
  el.style.outline = `2px solid ${color}`;
  el.style.outlineOffset = "2px";
}
const clearAll = () => { for (const el of Array.from(before.keys())) paint(el, null); };

/* ---------- The bar ---------- */

export function watchForms(isJobPage: () => boolean) {
  let hidden = false;
  try { hidden = (JSON.parse(sessionStorage.getItem(HIDDEN) || "[]") as string[]).includes(pageKey()); } catch { /* storage off */ }
  if (hidden) return;

  let state: State = { ok: false };
  let boxes: Box[] = [];
  const ui = { small: false, answering: false, note: "", filling: false, shown: false };
  let host: HTMLElement | null = null;
  let root: ShadowRoot | null = null;
  let spider = spiderRects(0);
  void storedSpiderColors().then((colors) => { spider = spiderRects(0, colors); draw(); });
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const STYLE = `
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
    .btn { all: unset; cursor: pointer; height: 32px; padding: 0 12px; border-radius: 9px; font: 600 12.5px system-ui, sans-serif; display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; color: #fff; }
    .btn.fill { background: ${FILL}; } .btn.fill:hover { background: #2F6FEB; }
    .btn.write { background: ${WRITE}; } .btn.write:hover { background: #7C3AED; }
    .btn.ghost { background: transparent; color: #111114; box-shadow: inset 0 0 0 1px #D7D7DE; font-weight: 500; }
    .btn[disabled] { cursor: default; opacity: .55; }
    .left { font-weight: 500; opacity: .85; }
    .icon { all: unset; cursor: pointer; width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; color: #6A6A74; font-size: 16px; flex: none; }
    .icon:hover { background: #F2F2F6; color: #111114; }
    .btn:focus-visible, .icon:focus-visible, .pill:focus-visible { outline: 2px solid #3D8BFF; outline-offset: 2px; }
    .note { font-size: 12px; color: #45454E; max-width: 260px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .note.bad { color: #B45309; }
    .done { font-size: 12px; color: #15803D; font-weight: 600; white-space: nowrap; }
    .pill { all: unset; cursor: pointer; display: flex; align-items: center; gap: 8px; padding: 7px 12px 7px 10px; background: #fff; border: 1px solid #E4E4EA; border-radius: 999px; box-shadow: 0 6px 18px rgba(0,0,0,.14); font-weight: 600; }
    .pill svg { width: 18px; height: ${Math.round((18 * H) / W)}px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; }
    @media (max-width: 640px) { .key { display: none; } }
  `;

  const spiderSvg = () => `<svg viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges" aria-hidden="true"><g transform="rotate(180 ${W / 2} ${H / 2})">${spider}</g></svg>`;

  function counts() {
    const open = boxes.filter((box) => !answered(box.control, box.outline));
    return { fill: open.filter((box) => box.kind === "fill").length, write: open.filter((box) => box.kind === "write").length };
  }

  function draw() {
    if (!root) return;
    const { fill, write } = counts();
    if (ui.small) {
      root.innerHTML = `<style>${STYLE}</style><button type="button" class="pill" data-act="grow" aria-label="Show Unnepo's form help">${spiderSvg()}${fill + write ? `${fill + write} to do` : "All filled"}${fill ? `<span class="dot" style="background:${FILL}"></span>` : ""}${write ? `<span class="dot" style="background:${WRITE}"></span>` : ""}</button>`;
      return;
    }
    const running = ui.filling || Boolean(state.running);
    const answersLeft = state.free && typeof state.answersLeft === "number" ? state.answersLeft : null;
    const autofillsLeft = state.free && typeof state.autofillsLeft === "number" ? state.autofillsLeft : null;
    const fillButton = running
      ? `<button type="button" class="btn ghost" data-act="stop">Stop</button><span class="note">${escapeText(state.step || "Filling…")}</span>`
      : `<button type="button" class="btn fill" data-act="fill" ${!fill || autofillsLeft === 0 || state.profileReady === false ? "disabled" : ""} title="${state.profileReady === false ? "Finish your profile in Unnepo first" : "Fills the blue boxes from your profile"}">⚡ Autofill${autofillsLeft !== null ? `<span class="left">· ${autofillsLeft} left</span>` : ""}</button>`;
    const writeButton = ui.answering
      ? `<button type="button" class="btn write" disabled>Writing ${write} ${write === 1 ? "answer" : "answers"}…</button>`
      : `<button type="button" class="btn write" data-act="answer" ${!write || answersLeft === 0 ? "disabled" : ""} title="Writes the purple questions from your resume and the job">✦ Answer with unnepo${answersLeft !== null ? `<span class="left">· ${answersLeft} left</span>` : ""}</button>`;
    const enter = ui.shown ? "" : " enter";
    ui.shown = true;
    root.innerHTML = `<style>${STYLE}</style>
      <div class="bar${enter}" role="region" aria-label="Unnepo form help">
        ${spiderSvg()}<span class="brand">unnepo<span>.</span></span>
        <span class="sep"></span>
        ${fill || running ? `<div class="group"><span class="key"><i style="border-color:${FILL}"></i>${fill} to fill</span>${fillButton}</div>` : `<span class="done">✓ Boxes filled</span>`}
        ${write || ui.answering ? `<span class="sep"></span><div class="group"><span class="key"><i style="border-color:${WRITE}"></i>${write} to write</span>${writeButton}</div>` : ""}
        ${ui.note || state.error ? `<span class="note bad" title="${escapeText(ui.note || state.error || "")}">${escapeText(ui.note || state.error || "")}</span>` : ""}
        <button type="button" class="icon" data-act="small" aria-label="Shrink">–</button>
        <button type="button" class="icon" data-act="hide" aria-label="Hide on this page" title="Hide on this page">×</button>
      </div>`;
  }

  const escapeText = (text: string) => text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

  function repaint() {
    const keep = new Set<HTMLElement>();
    for (const box of boxes) {
      if (answered(box.control, box.outline)) continue;
      paint(box.outline, box.kind === "fill" ? `${FILL}99` : WRITE);
      keep.add(box.outline);
    }
    for (const el of Array.from(before.keys())) if (!keep.has(el)) paint(el, null);
  }

  let polling = 0;
  async function poll() {
    window.clearTimeout(polling);
    try { state = await ask<State>({ type: "form-page-state" }); } catch { return; }
    rescan();
    if (state.running) polling = window.setTimeout(() => void poll(), 1500);
    else ui.filling = false;
    draw();
  }

  async function act(name: string) {
    if (name === "small") { ui.small = true; return draw(); }
    if (name === "grow") { ui.small = false; return draw(); }
    if (name === "hide") {
      try { sessionStorage.setItem(HIDDEN, JSON.stringify([...(JSON.parse(sessionStorage.getItem(HIDDEN) || "[]") as string[]), pageKey()].slice(-30))); } catch { /* storage off */ }
      stop();
      return;
    }
    if (name === "fill") {
      ui.filling = true;
      ui.note = "";
      draw();
      const result = await ask<{ ok: boolean; error?: string }>({ type: "form-autofill" }).catch(() => ({ ok: false, error: "Unnepo was updated. Refresh this page" }));
      if (!result.ok) { ui.filling = false; ui.note = result.error ?? "Couldn't start Autofill."; draw(); return; }
      window.setTimeout(() => void poll(), 800);
      return;
    }
    if (name === "stop") {
      await ask({ type: "form-stop" }).catch(() => undefined);
      ui.filling = false;
      return void poll();
    }
    if (name === "answer") {
      ui.answering = true;
      ui.note = "";
      draw();
      type Answered = { ok: boolean; written?: number; stopped?: string; error?: string; found?: number };
      const result = await ask<Answered>({ type: "form-answer" }).catch((): Answered => ({ ok: false, error: "Unnepo was updated. Refresh this page" }));
      ui.answering = false;
      ui.note = !result.ok ? result.error ?? "Couldn't write the answers." : result.stopped ? result.stopped : result.found === 0 ? "No questions to write here." : "";
      await poll();
    }
  }

  function stop() {
    observer?.disconnect();
    window.clearTimeout(polling);
    document.removeEventListener("input", onInput, true);
    document.removeEventListener("change", onInput, true);
    clearAll();
    host?.remove();
    host = null;
    root = null;
  }

  function rescan() {
    boxes = findBoxes();
    repaint();
  }

  let pending = 0;
  const later = () => { if (!pending) pending = window.setTimeout(() => { pending = 0; rescan(); draw(); }, 600); };
  const onInput = (event: Event) => { if (!(event.target instanceof Element && ours(event.target))) later(); };
  let observer: MutationObserver | null = null;

  /** "never": signed out or turned off, so it stops looking; "later": not a form yet. */
  async function start(): Promise<"shown" | "later" | "never"> {
    try { state = await ask<State>({ type: "form-page-state" }); } catch { return "never"; }
    if (!state.ok || state.off) return "never";
    rescan();
    // An application form: a few boxes to fill, on a page that looks like a job application.
    if (boxes.length < 4) { clearAll(); return "later"; }
    host = document.createElement("div");
    host.setAttribute(MARK, "bar");
    root = host.attachShadow({ mode: "closed" });
    root.addEventListener("click", (event) => {
      const button = (event.target as Element).closest<HTMLElement>("[data-act]");
      if (button && !(button as HTMLButtonElement).disabled) void act(button.dataset.act ?? "");
    });
    document.documentElement.append(host);
    draw();
    document.addEventListener("input", onInput, true);
    document.addEventListener("change", onInput, true);
    observer = new MutationObserver((records) => { if (!records.every((record) => record.target instanceof Element && ours(record.target))) later(); });
    observer.observe(document.body, { childList: true, subtree: true });
    if (state.running) void poll();
    return "shown";
  }

  // Job sites build their forms after loading, so it looks a few times over the first half minute.
  let tries = 0;
  const check = async () => {
    if (host) return;
    if (isJobPage() && document.querySelectorAll(CONTROLS).length >= 4 && (await start()) !== "later") return;
    if (++tries < 12) window.setTimeout(() => void check(), 2500);
  };
  void check();
}
