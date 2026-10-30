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

/** Drops the questions that have been answered since. */
function refresh() {
  const still: Marked[] = [];
  for (const item of marked) {
    if (!item.control.isConnected || !isEmpty(item.control)) unmark(item);
    else still.push(item);
  }
  marked = still;
  drawButton();
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
