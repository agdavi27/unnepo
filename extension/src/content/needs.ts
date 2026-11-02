import { typeInto } from "./dom";
import { findMarked, isEmpty, scanFields } from "./scan";
import { findAction } from "./actions";

/**
 * The review checklist on the page, so the student never scrolls the form looking for what went wrong. Two
 * kinds of question are on it, in page order: ones that still need the student (orange: required and empty,
 * or Unnepo couldn't fill them) and answers worth a second look (blue: written by AI, or a default like
 * "Decline to answer"). A bar in the corner says "2 of 6", names the question and why it's there, and jumps
 * to the next one; "Looks right" (or Alt+Enter) ticks an answer off and moves on, and fixing a question ticks
 * it off too. Nothing here blocks the page; the extension waits to press Next until the list is done.
 */

const COLOR = "#FF8A3D";
const CHECK = "#3D8BFF";
type Kind = "needs" | "check";
type Marked = { label: string; control: HTMLElement; kind: Kind; why: string; before: { outline: string; outlineOffset: string } };
export type CheckItem = { label: string; why: string };

let marked: Marked[] = [];
let host: HTMLDivElement | null = null;
let lastSet = "";
let current = 0;
let listening = false;
/** Answers the student ticked off on this page (by its address), so they don't come back on the next look. */
const reviewed = new Map<string, Set<string>>();
const pageReviewed = () => {
  const key = location.href;
  if (!reviewed.has(key)) reviewed.set(key, new Set());
  return reviewed.get(key)!;
};
/** Something was on the list on this page, so the bar ends with "All checked". */
let hadItems = false;

/** The page's control for a question, by its label (exact first, then the start of it). */
export function fieldControl(label: string) {
  const fields = scanFields();
  const wanted = label.trim().toLowerCase();
  const field = fields.find((item) => item.label.toLowerCase() === wanted) ?? fields.find((item) => item.label.toLowerCase().startsWith(wanted));
  const el = field ? findMarked(field.id) : null;
  if (!el) return null;
  return el.matches("input, select, textarea, button") ? el : (el.querySelector<HTMLElement>("input, select, textarea, button") ?? el);
}

/** Radios and checkboxes are answered as a group, so the group is what gets the outline. */
const outlined = (control: HTMLElement) =>
  control instanceof HTMLInputElement && (control.type === "radio" || control.type === "checkbox")
    ? (control.closest("fieldset, [role=radiogroup], [role=group]") as HTMLElement | null) ?? control
    : control;

function unmark(item: Marked) {
  const box = outlined(item.control);
  Object.assign(box.style, item.before);
  box.removeAttribute("data-unnepo-needs");
}

function scrollTo(control: HTMLElement) {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  outlined(control).scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
}

/** Answers still to look over on this page: the extension waits for these before pressing Next. */
export function reviewLeft() {
  return marked.filter((item) => item.kind === "check").length;
}

/** Goes to the item at `index` (wrapping), scrolls it into view and puts the cursor in it. */
function goTo(index: number) {
  if (!marked.length) return;
  current = ((index % marked.length) + marked.length) % marked.length;
  const { control } = marked[current];
  scrollTo(control);
  setTimeout(() => control.focus({ preventScroll: true }), 300);
  drawBar();
}

/** Ticks off the current answer and goes on to the next one. */
function looksRight() {
  const item = marked[current];
  if (!item) return;
  if (item.kind === "check") {
    pageReviewed().add(item.label);
    unmark(item);
    marked.splice(current, 1);
  } else current += 1;
  if (marked.length) goTo(current);
  else drawBar();
}

function allLookRight() {
  for (const item of marked.filter((entry) => entry.kind === "check")) {
    pageReviewed().add(item.label);
    unmark(item);
  }
  marked = marked.filter((item) => item.kind !== "check");
  if (marked.length) goTo(0);
  else drawBar();
}

const esc = (text: string) => text.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]!);

function drawBar() {
  const done = !marked.length;
  if (done && !hadItems) {
    host?.remove();
    host = null;
    return;
  }
  if (!host) {
    host = document.createElement("div");
    host.setAttribute("data-unnepo-needs-bar", "");
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        :host { all: initial; position: fixed; right: 16px; bottom: 16px; z-index: 2147483646; font: 13px/1.3 system-ui, -apple-system, sans-serif; }
        .bar { display: flex; flex-direction: column; gap: 8px; width: min(340px, calc(100vw - 32px)); padding: 12px 14px; border-radius: 16px; background: #0A0A0B; color: #fff; box-shadow: 0 8px 28px rgba(0,0,0,.32); border: 2px solid var(--c, ${COLOR}); }
        .top { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-weight: 700; }
        .count { font: 600 11px/1 ui-monospace, monospace; letter-spacing: .5px; text-transform: uppercase; color: #9A9AA3; }
        .label { font-weight: 600; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
        .why { color: #B4B4BC; font-size: 12px; }
        .row { display: flex; flex-wrap: wrap; gap: 6px; }
        button { all: unset; cursor: pointer; padding: 7px 11px; border-radius: 999px; font-weight: 600; font-size: 12px; border: 1px solid #33333A; color: #E6E6EA; }
        button.main { background: #fff; color: #0A0A0B; border-color: #fff; }
        button.quiet { border-color: transparent; color: #9A9AA3; padding-left: 4px; padding-right: 4px; }
        button:focus-visible { outline: 3px solid ${CHECK}; outline-offset: 2px; }
        .close { padding: 2px 6px; color: #9A9AA3; border: 0; }
      </style>
      <div class="bar" role="region" aria-label="Unnepo review checklist"></div>`;
    root.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest("button");
      const act = button?.dataset.act;
      if (act === "next") goTo(current + 1);
      else if (act === "back") goTo(current - 1);
      else if (act === "ok") looksRight();
      else if (act === "all") allLookRight();
      else if (act === "start") goTo(current);
      else if (act === "action") showAction();
      else if (act === "close") {
        hadItems = false;
        host?.remove();
        host = null;
      }
    });
    document.documentElement.appendChild(host);
  }
  const bar = host.shadowRoot!.querySelector<HTMLDivElement>(".bar")!;
  if (done) {
    const action = findAction(false, scanFields().length);
    bar.style.setProperty("--c", "#4ADE80");
    bar.innerHTML = `<div class="top"><span>All checked ✓</span><button class="close" data-act="close" aria-label="Close">×</button></div>
      <div class="why">${action?.kind === "submit" ? `Press "${esc(action.label)}" when you're ready.` : action?.kind === "next" ? "Unnepo goes on to the next page." : "Nothing left to look at on this page."}</div>
      ${action?.kind === "submit" ? `<div class="row"><button class="main" data-act="action">Show me ${esc(action.label)}</button></div>` : ""}`;
    return;
  }
  current = Math.min(current, marked.length - 1);
  const item = marked[current];
  const checks = reviewLeft();
  bar.style.setProperty("--c", item.kind === "check" ? CHECK : COLOR);
  bar.innerHTML = `<div class="top"><span class="count">Review · ${current + 1} of ${marked.length}</span><button class="close" data-act="close" aria-label="Close the checklist">×</button></div>
    <div class="label">${esc(item.label)}</div>
    <div class="why">${esc(item.kind === "check" ? item.why || "Check this answer." : item.why || "Needs your answer.")}</div>
    <div class="row">
      ${item.kind === "check" ? `<button class="main" data-act="ok" title="Alt+Enter">✓ Looks right</button>` : `<button class="main" data-act="start">Go to it</button>`}
      <button data-act="next">${item.kind === "check" ? "Skip" : "Next"} →</button>
      ${checks > 1 ? `<button class="quiet" data-act="all">All ${checks} look right</button>` : ""}
      ${marked.length > 1 ? `<button class="quiet" data-act="back">← Back</button>` : ""}
    </div>`;
}

/** The Submit button, outlined in green and brought into view. Never pressed here: submitting is the student's. */
function showAction() {
  const action = findAction(false, scanFields().length);
  if (!action) return;
  scrollTo(action.el);
  const before = { outline: action.el.style.outline, outlineOffset: action.el.style.outlineOffset };
  action.el.style.outline = "3px solid #4ADE80";
  action.el.style.outlineOffset = "3px";
  action.el.focus({ preventScroll: true });
  setTimeout(() => Object.assign(action.el.style, before), 4000);
}

/**
 * Written questions Unnepo couldn't answer get a "Write with AI" chip just above them. It drafts a short
 * answer from the resume and the posting and types it in for the student to check. Choices, dates and
 * short facts don't get one: those are the student's to give.
 */
let chips: HTMLDivElement | null = null;
let placing = 0;

function writable(control: HTMLElement, label: string) {
  if (control instanceof HTMLTextAreaElement) return true;
  if (!(control instanceof HTMLInputElement) || control.type !== "text" || control.getAttribute("role") === "combobox") return false;
  return label.split(/\s+/).length >= 5 || /\b(why|describe|tell us|explain|how would|what (makes|interests))\b/i.test(label);
}

function placeChips() {
  placing = 0;
  if (!chips) return;
  for (const chip of Array.from(chips.shadowRoot!.querySelectorAll<HTMLButtonElement>("button"))) {
    const item = marked.find((entry) => entry.label === chip.dataset.label);
    const rect = item?.control.getBoundingClientRect();
    if (!item || !rect || rect.height === 0 || rect.bottom < 0 || rect.top > innerHeight) {
      chip.style.display = "none";
      continue;
    }
    chip.style.display = "";
    chip.style.top = `${Math.max(4, rect.top - 30)}px`;
    chip.style.left = `${Math.max(4, Math.min(innerWidth - 150, rect.right - 140))}px`;
  }
}

const schedulePlace = () => {
  if (!placing) placing = requestAnimationFrame(placeChips);
};

async function writeFor(chip: HTMLButtonElement, item: Marked) {
  chip.disabled = true;
  chip.textContent = "Writing…";
  const result = (await chrome.runtime.sendMessage({ type: "write-answer", label: item.label }).catch(() => null)) as { answer?: string; error?: string } | null;
  const control = item.control;
  if (result?.answer && control.isConnected && (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) && isEmpty(control)) {
    typeInto(control, result.answer);
    control.focus({ preventScroll: true });
    chip.textContent = "Written: check it";
    setTimeout(refresh, 400);
    return;
  }
  chip.disabled = false;
  chip.textContent = "Write with AI";
  chip.title = result?.error || "Couldn't write this one. Try again.";
  chip.dataset.error = "1";
  setTimeout(() => delete chip.dataset.error, 2500);
}

function drawChips() {
  const items = marked.filter((item) => writable(item.control, item.label));
  if (!items.length) {
    chips?.remove();
    chips = null;
    return;
  }
  if (!chips) {
    chips = document.createElement("div");
    chips.setAttribute("data-unnepo-write", "");
    const root = chips.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        :host { all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483645; font: 600 12px/1 system-ui, -apple-system, sans-serif; }
        button { all: unset; pointer-events: auto; cursor: pointer; position: fixed; display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 999px; background: #0A0A0B; color: #fff; border: 1.5px solid ${COLOR}; box-shadow: 0 4px 14px rgba(0,0,0,.22); white-space: nowrap; }
        button:disabled { cursor: progress; opacity: .8; }
        button[data-error] { border-color: #F87171; }
        button:focus-visible { outline: 3px solid #3D8BFF; outline-offset: 2px; }
      </style>`;
    document.documentElement.appendChild(chips);
    addEventListener("scroll", schedulePlace, { capture: true, passive: true });
    addEventListener("resize", schedulePlace, { passive: true });
  }
  const root = chips.shadowRoot!;
  const wanted = new Set(items.map((item) => item.label));
  for (const chip of Array.from(root.querySelectorAll<HTMLButtonElement>("button"))) if (!wanted.has(chip.dataset.label ?? "")) chip.remove();
  for (const item of items) {
    if (Array.from(root.querySelectorAll<HTMLButtonElement>("button")).some((chip) => chip.dataset.label === item.label)) continue;
    const chip = document.createElement("button");
    chip.type = "button";
    chip.dataset.label = item.label;
    chip.textContent = "Write with AI";
    chip.setAttribute("aria-label", `Write an answer with AI for: ${item.label}`);
    chip.addEventListener("click", () => void writeFor(chip, item));
    root.appendChild(chip);
  }
  placeChips();
}

/** Drops the questions answered since, and blue answers the student changed (that's them checking it). */
function refresh() {
  const still: Marked[] = [];
  for (const item of marked) {
    if (!item.control.isConnected || (item.kind === "needs" && !isEmpty(item.control))) unmark(item);
    else still.push(item);
  }
  const moved = still.length !== marked.length;
  marked = still;
  if (moved && current >= marked.length) current = 0;
  drawBar();
  drawChips();
}

/** The student changed the question the checklist is on: it's done, so go on to the next one. */
function changed(event: Event) {
  const item = marked[current];
  const target = event.target as Node | null;
  if (!item || !target || !(outlined(item.control).contains(target) || item.control === target)) return;
  setTimeout(() => {
    if (item.kind === "check") {
      pageReviewed().add(item.label);
      unmark(item);
      marked = marked.filter((entry) => entry !== item);
    } else if (!isEmpty(item.control)) {
      unmark(item);
      marked = marked.filter((entry) => entry !== item);
    } else return;
    if (marked.length) goTo(current);
    else drawBar();
  }, 250);
}

/**
 * Marks these questions, if they're on this page: `labels` still need the student (when empty), `check` are
 * filled answers to look over. Called again as the lists change. Returns what's marked.
 */
export function markNeeds(labels: string[], check: CheckItem[] = []) {
  const keep = new Set<HTMLElement>();
  const found: Array<{ label: string; control: HTMLElement; kind: Kind; why: string }> = [];
  for (const label of [...new Set(labels.map((item) => item.trim()).filter(Boolean))]) {
    const control = fieldControl(label);
    if (!control || !control.isConnected || !isEmpty(control) || keep.has(control)) continue;
    keep.add(control);
    found.push({ label, control, kind: "needs", why: "" });
  }
  const done = pageReviewed();
  for (const item of check) {
    const label = item.label.trim();
    if (!label || done.has(label)) continue;
    const control = fieldControl(label);
    if (!control || !control.isConnected || isEmpty(control) || keep.has(control)) continue;
    keep.add(control);
    found.push({ label, control, kind: "check", why: item.why });
  }
  // Questions no longer on the list lose their mark; new ones get it.
  for (const item of marked) if (!keep.has(item.control)) unmark(item);
  const already = new Map(marked.map((item) => [item.control, item]));
  const at = marked[current]?.control;
  marked = found.map(({ label, control, kind, why }) => {
    const existing = already.get(control);
    if (existing && existing.kind === kind) return existing;
    if (existing) unmark(existing);
    const box = outlined(control);
    const item: Marked = { label, control, kind, why, before: { outline: box.style.outline, outlineOffset: box.style.outlineOffset } };
    box.style.outline = `3px ${kind === "check" ? "dashed" : "solid"} ${kind === "check" ? CHECK : COLOR}`;
    box.style.outlineOffset = "3px";
    box.setAttribute("data-unnepo-needs", label);
    return item;
  });
  // Page order, so the checklist walks down the form.
  marked.sort((a, b) => (a.control.compareDocumentPosition(b.control) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  current = Math.max(0, marked.findIndex((item) => item.control === at));
  if (marked.length) hadItems = true;
  drawBar();
  drawChips();
  if (!listening) {
    listening = true;
    // Answering a question takes its mark off right away, without waiting for Unnepo's next look.
    for (const type of ["input", "change", "click"]) document.addEventListener(type, () => setTimeout(refresh, 150), true);
    document.addEventListener("change", changed, true);
    // Alt+Enter: this answer looks right, next.
    document.addEventListener("keydown", (event) => {
      if (event.altKey && event.key === "Enter" && marked.length) {
        event.preventDefault();
        looksRight();
      }
    }, true);
  }
  // A question that wasn't marked before: bring the first one into view, unless the student is typing.
  const set = marked.map((item) => item.label).join("|");
  const before = new Set(lastSet.split("|"));
  if (marked.some((item) => !before.has(item.label))) {
    current = 0;
    const typing = document.activeElement?.matches("input, textarea, select, [contenteditable=true]");
    if (!typing) scrollTo(marked[0].control);
    drawBar();
  }
  lastSet = set;
  return marked.map((item) => item.label);
}
