import { typeInto } from "./dom";
import { findMarked, isEmpty, scanFields } from "./scan";

/**
 * Makes the questions Unnepo couldn't fill easy to find: each one gets an orange outline on the page, and
 * a small button in the corner says how many are left and jumps to the next one.
 * The first time a new set shows up, the page scrolls to the first of them. A question drops off as soon
 * as it's answered, and everything goes once none are left. Nothing here blocks the page.
 */

const COLOR = "#FF8A3D";
type Marked = { label: string; control: HTMLElement; before: { outline: string; outlineOffset: string } };

let marked: Marked[] = [];
let host: HTMLDivElement | null = null;
let lastSet = "";
let next = 0;
let listening = false;

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

function drawButton() {
  if (!marked.length) {
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
        :host { all: initial; position: fixed; right: 16px; bottom: 16px; z-index: 2147483646; font: 600 13px/1.2 system-ui, -apple-system, sans-serif; }
        button { all: unset; cursor: pointer; display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-radius: 999px; background: #0A0A0B; color: #fff; box-shadow: 0 6px 24px rgba(0,0,0,.28); border: 2px solid ${COLOR}; }
        button:focus-visible { outline: 3px solid #3D8BFF; outline-offset: 2px; }
        .dot { width: 8px; height: 8px; border-radius: 50%; background: ${COLOR}; }
      </style>
      <button type="button"><span class="dot"></span><span class="text"></span></button>`;
    root.querySelector("button")!.addEventListener("click", () => {
      if (!marked.length) return;
      next %= marked.length;
      const { control } = marked[next];
      next += 1;
      scrollTo(control);
      setTimeout(() => control.focus({ preventScroll: true }), 300);
    });
    document.documentElement.appendChild(host);
  }
  const count = marked.length;
  host.shadowRoot!.querySelector(".text")!.textContent = `Unnepo: ${count} ${count === 1 ? "question needs" : "questions need"} you · Go to ${count === 1 ? "it" : "next"}`;
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

/** Drops the questions that have been answered since. */
function refresh() {
  const still: Marked[] = [];
  for (const item of marked) {
    if (!item.control.isConnected || !isEmpty(item.control)) unmark(item);
    else still.push(item);
  }
  marked = still;
  drawButton();
  drawChips();
}

/** Marks these questions, if they're on this page and still empty. Called again as the list changes. */
export function markNeeds(labels: string[]) {
  const wanted = [...new Set(labels.map((label) => label.trim()).filter(Boolean))];
  const keep = new Set<HTMLElement>();
  const found: Array<{ label: string; control: HTMLElement }> = [];
  for (const label of wanted) {
    const control = fieldControl(label);
    if (!control || !control.isConnected || !isEmpty(control) || keep.has(control)) continue;
    keep.add(control);
    found.push({ label, control });
  }
  // Questions no longer on the list lose their mark; new ones get it.
  for (const item of marked) if (!keep.has(item.control)) unmark(item);
  const already = new Map(marked.map((item) => [item.control, item]));
  marked = found.map(({ label, control }) => {
    const existing = already.get(control);
    if (existing) return existing;
    const box = outlined(control);
    const item: Marked = { label, control, before: { outline: box.style.outline, outlineOffset: box.style.outlineOffset } };
    box.style.outline = `3px solid ${COLOR}`;
    box.style.outlineOffset = "3px";
    box.setAttribute("data-unnepo-needs", label);
    return item;
  });
  // Page order, so "Go to next" walks down the form.
  marked.sort((a, b) => (a.control.compareDocumentPosition(b.control) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  drawButton();
  drawChips();
  if (!listening) {
    listening = true;
    // Answering a question takes its mark off right away, without waiting for Unnepo's next look.
    for (const type of ["input", "change", "click"]) document.addEventListener(type, () => setTimeout(refresh, 150), true);
  }
  // A question that wasn't marked before: bring the first one into view, unless the student is typing.
  const set = marked.map((item) => item.label).join("|");
  const before = new Set(lastSet.split("|"));
  if (marked.some((item) => !before.has(item.label))) {
    next = 1;
    const typing = document.activeElement?.matches("input, textarea, select, [contenteditable=true]");
    if (!typing) scrollTo(marked[0].control);
  }
  lastSet = set;
  return marked.map((item) => item.label);
}
