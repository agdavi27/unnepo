import { H, W, spiderRects, storedSpiderColors } from "../shared/sprite";
import { isComplexQuestion } from "./question-kinds";
import { watchTypedAnswers } from "./save-answer";

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
const CONTROLS = "input:not([type]), input[type=text], input[type=email], input[type=tel], input[type=url], input[type=number], input[type=date], input[type=month], textarea, select";
/** A site's own dropdown drawn as a button (Workday's "Select One" questions). */
const LIST_BUTTON = "button[aria-haspopup='listbox']";
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

/** Workday's From and To: a month and a year box, a hair wide under a "MM / YYYY" display. */
const datePart = (el: Element) => /dateSection(Month|Day|Year)-input/i.test(`${el.getAttribute("data-automation-id") ?? ""} ${el.id}`);
/** A job's "Role Description": filled from the profile's bullets, not written by AI. */
const ROLE_TEXT = /^(role|job|position) description|^(description|responsibilities|duties)( of (role|duties))?$|^key responsibilities/i;
/** "I currently work here": ticked for a job the profile says is current. */
const CURRENT_JOB = /currently work here|current(ly)? (employed|job|position)|i currently/i;
/** The hidden inputs some sites keep behind their own dropdowns, only there to make the form "required". */
const helperInput = (el: Element) => !datePart(el) && el.getAttribute("role") !== "combobox" && (el.getAttribute("aria-hidden") === "true" || (el as HTMLElement).tabIndex < 0);
/** How many real fields are inside a wrapper (not counting those hidden helpers). */
const fieldsIn = (box: Element) => Array.from(box.querySelectorAll(CONTROLS)).filter((el) => !helperInput(el)).length;

/** The question a box asks: its label, aria text, or the short text of the wrapper around it. */
function labelOf(el: HTMLElement) {
  const input = el as HTMLInputElement;
  const fromLabels = Array.from(input.labels ?? []).map((label) => clean(label.textContent)).join(" ");
  if (fromLabels) return fromLabels;
  // Workday's own dropdowns are named just "Select One Required": that's the button, not the question.
  const aria = clean(el.getAttribute("aria-label") || (el.getAttribute("aria-labelledby") ?? "").split(/\s+/).map((id) => clean(document.getElementById(id)?.textContent)).join(" ")).replace(/\b(select one|required)\b/gi, "").trim();
  if (aria) return aria;
  // A question asked in its fieldset's legend (Workday's Application Questions).
  const fieldset = el.closest("fieldset");
  const legend = clean(fieldset?.querySelector("legend")?.textContent).replace(/\*$/, "").trim();
  if (legend && fieldset && fieldsIn(fieldset) <= 2) return legend;
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
  if (datePart(el)) return el.closest<HTMLElement>("[data-automation-id='dateInputWrapper']") ?? el.parentElement ?? el;
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
export function answered(el: HTMLElement, outline: HTMLElement) {
  // A dropdown button: answered once it shows a choice instead of "Select One".
  if (el instanceof HTMLButtonElement) return Boolean(clean(el.textContent)) && !/^(select|choose|pick)\b/i.test(clean(el.textContent));
  if (el instanceof HTMLInputElement && el.type === "checkbox") return el.checked || (CURRENT_JOB.test(labelOf(el)) && hasEndDate(el));
  if (el instanceof HTMLSelectElement) return el.selectedIndex > 0 || Boolean(el.value && !/^select/i.test(el.selectedOptions[0]?.text ?? ""));
  if ((el as HTMLInputElement).value?.trim()) return true;
  if (el.getAttribute("role") === "combobox" && outline !== el) {
    const shown = clean(outline.innerText).replace(labelOf(el), "").replace(/[*\s]+/g, " ").trim();
    return Boolean(shown) && !/^select/i.test(shown);
  }
  return false;
}

/**
 * "I currently work here" needs nothing when the job already has its From and To dates: the job ended. The job's
 * own entry is the nearest wrapper holding its dates (Workday's month and year boxes, or a To / End date box).
 */
function hasEndDate(box: HTMLElement) {
  let entry: HTMLElement | null = box.parentElement;
  for (let depth = 0; entry && depth < 10; depth++, entry = entry.parentElement) {
    const parts = Array.from(entry.querySelectorAll<HTMLInputElement>("input")).filter(datePart);
    if (parts.length >= 4) return parts.every((part) => part.value.trim());
    const ends = Array.from(entry.querySelectorAll<HTMLInputElement>("input:not([type=checkbox]):not([type=hidden])")).filter((input) => /\b(to|end)\b|end date|until/i.test(labelOf(input)) && !/\bfrom\b|start/i.test(labelOf(input)));
    if (ends.length) return ends.every((input) => input.value.trim());
  }
  return false;
}

/** Every field on the form Unnepo can help with, in page order. */
export function findBoxes(): Box[] {
  const boxes: Box[] = [];
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(`${CONTROLS}, input[type=checkbox], ${LIST_BUTTON}`))) {
    // The site's menus (language, settings) are dropdown buttons too, but not questions.
    if (el.matches(LIST_BUTTON) && el.closest("[data-automation-id*='utility' i], [data-automation-id*='progress' i], [data-automation-id*='languagePicker' i]")) continue;
    const combo = el.getAttribute("role") === "combobox" || el.matches(LIST_BUTTON);
    if (ours(el) || (el as HTMLInputElement).disabled || ((el as HTMLInputElement).readOnly && !combo)) continue;
    if (helperInput(el)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 && rect.height < 2 && !combo && !datePart(el)) continue;
    if (el.closest("header, nav, footer, [role=search]") || (el as HTMLInputElement).type === "search") continue;
    const label = datePart(el) ? clean(el.closest("fieldset")?.querySelector("legend")?.textContent) || labelOf(el) : labelOf(el);
    if (!label || /search/i.test(label)) continue;
    if ((el as HTMLInputElement).type === "checkbox" && !CURRENT_JOB.test(label)) continue;
    const type = el instanceof HTMLTextAreaElement ? "textarea" : el instanceof HTMLSelectElement || el instanceof HTMLButtonElement ? "select" : "text";
    const kind = isComplexQuestion(type, label) && !ROLE_TEXT.test(label) ? "write" : "fill";
    if (kind === "fill" && LINK.test(label)) continue;
    const outline = (el as HTMLInputElement).type === "checkbox" ? (el.closest("label, [data-automation-id^='formField']") as HTMLElement | null) ?? el : outlineFor(el);
    if (outline.getBoundingClientRect().width < 20 && (el as HTMLInputElement).type !== "checkbox") continue;
    boxes.push({ control: el, outline, kind, label });
  }
  return boxes;
}

/** Every blue box on the form, filled together by one Fill with unnepo. Purple questions are Answer's. */
function groupsOf(boxes: Box[]): Group[] {
  const fills = boxes.filter((box) => box.kind === "fill");
  return fills.length ? [{ key: fills[0].control, boxes: fills }] : [];
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
    const toTry = boxes.filter((box) => box.kind === "fill" && open(box) && !tried.has(box.control)).length;
    const fillPart = filling
      ? `<div class="group"><span class="key"><i style="border-color:${FILL}"></i>Filling… ${toTry} to go</span><button type="button" class="btn stop" data-act="stop">■ Stop</button></div>`
      : toTry
        ? `<div class="group"><span class="key"><i style="border-color:${FILL}"></i>${toTry} Unnepo can fill</span><button type="button" class="btn fill" data-act="next" title="Fills every blue box from your profile">⚡ Fill with unnepo</button></div>`
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


  /** The page itself only gets the outlines; Fill with unnepo is in the bar. */
  function drawLayer() {
    if (layer) layer.root.innerHTML = "";
  }

  function draw() { drawBar(); drawLayer(); }

  function repaint() {
    const keep = new Set<HTMLElement>();
    for (const box of boxes) {
      if (!open(box)) continue;
      paint(box.outline, box.kind === "fill" ? FILL : WRITE);
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
    draw();
    // First an entry for each job, school and website in the profile (Workday's "Add Another"), then every open
    // blue box, the new ones too.
    const prepared = await ask<{ ok: boolean; added?: number }>({ type: "form-prepare" }).catch(() => ({ ok: false, added: 0 }));
    if (filling !== group.key) return;
    if (prepared.added) {
      await new Promise((done) => setTimeout(done, 600));
      rescan();
    }
    document.querySelectorAll(`[${PICK}]`).forEach((el) => el.removeAttribute(PICK));
    const left = boxes.filter((box) => box.kind === "fill" && open(box));
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
    if (name === "next") { if (groups[0]) void fillGroup(groups[0]); return; }
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
    // Answers the student types themselves get a "Save to Unnepo" chip.
    watchTypedAnswers();
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
