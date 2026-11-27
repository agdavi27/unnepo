import { sectionOf } from "./scan";
import { keepOnTop } from "./top-layer";

/**
 * "Save to Unnepo" beside an answer the student typed themselves. When they finish typing in a box (a question
 * Unnepo didn't know, or got wrong), a small chip shows at its edge; pressing it saves that question and answer
 * to their profile, so the next form with the same question fills it. Nothing is sent until the chip is pressed.
 * One chip at a time: typing in another box moves it there.
 */

const MARK = "data-unnepo-form";
const TYPED = "input:not([type]), input[type=text], input[type=email], input[type=tel], input[type=url], input[type=number], textarea, select";
/** Boxes not worth keeping: secrets, one-off codes, and Workday's tiny date parts. */
const SKIP = /password|passcode|verification code|one[- ]time|captcha|social security|\bssn\b|credit card|card number|cvv|routing|account number|signature|today'?s date|^date$/i;

const clean = (text: string | null | undefined) => (text ?? "").replace(/\s+/g, " ").trim();
const ours = (el: Element) => Boolean(el.closest(`[${MARK}], [data-unnepo-letter], [data-unnepo-link], [data-unnepo-card], [data-unnepo-launcher]`));

/** The question a box asks: its label, aria text, or the short text of the wrapper around it. */
function questionOf(el: HTMLElement) {
  const input = el as HTMLInputElement;
  const fromLabels = Array.from(input.labels ?? []).map((label) => clean(label.textContent)).join(" ");
  if (fromLabels) return fromLabels;
  const aria = el.getAttribute("aria-label") || (el.getAttribute("aria-labelledby") ?? "").split(/\s+/).map((id) => clean(document.getElementById(id)?.textContent)).join(" ");
  if (clean(aria)) return clean(aria);
  let box: HTMLElement | null = el.parentElement;
  for (let depth = 0; box && depth < 4; depth++, box = box.parentElement) {
    if (box.querySelectorAll(TYPED).length > 1) break;
    const text = clean(box.innerText);
    if (text && text.length <= 300) return text;
  }
  return clean(input.placeholder || input.name);
}

function valueOf(el: HTMLElement) {
  if (el instanceof HTMLSelectElement) {
    const text = clean(el.selectedOptions[0]?.textContent);
    return !el.value || /^(select|choose|pick|please select|--)/i.test(text) ? "" : text;
  }
  return (el as HTMLInputElement).value.trim();
}

let watching = false;

export function watchTypedAnswers() {
  if (watching) return;
  watching = true;
  let host: HTMLElement | null = null;
  let root: ShadowRoot | null = null;
  let field: HTMLElement | null = null;
  let hideTimer = 0;
  const typed = new WeakSet<Element>();
  const saved = new WeakMap<Element, string>();

  const STYLE = `
    :host { all: initial; position: absolute; z-index: 2147483644; font: 600 12px/1 system-ui, -apple-system, "Segoe UI", sans-serif; }
    button { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px; border-radius: 8px; background: #111114; color: #fff; white-space: nowrap; box-shadow: 0 4px 12px rgba(0,0,0,.18); }
    button:hover { background: #2A2A30; }
    button:focus-visible { outline: 2px solid #3D8BFF; outline-offset: 2px; }
    button[disabled] { cursor: default; }
    button.done { background: #15803D; }
    button.off { background: #B45309; }
    b { color: #3D8BFF; font-weight: 700; }
  `;

  function hide() {
    window.clearTimeout(hideTimer);
    host?.remove();
    host = null;
    root = null;
    field = null;
  }

  function place() {
    if (!host || !field) return;
    if (!field.isConnected) return hide();
    const rect = field.getBoundingClientRect();
    if (!rect.width) return hide();
    host.style.left = `${Math.max(4, rect.right + window.scrollX - 128)}px`;
    host.style.top = `${rect.bottom + window.scrollY + 4}px`;
  }

  function show(el: HTMLElement) {
    hide();
    field = el;
    host = document.createElement("div");
    host.setAttribute(MARK, "save");
    root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `<style>${STYLE}</style><button type="button" title="Unnepo fills this answer on the next form that asks"><span>Save to un<b>nepo</b></span></button>`;
    const button = root.querySelector("button")!;
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => void save(el, button));
    keepOnTop(host);
    place();
    // Left alone, it goes after a while; the answer stays in the box either way.
    hideTimer = window.setTimeout(hide, 20_000);
  }

  async function save(el: HTMLElement, button: HTMLButtonElement) {
    const question = questionOf(el).slice(0, 300);
    const answer = valueOf(el).slice(0, 2000);
    if (!question || !answer) return hide();
    button.disabled = true;
    button.textContent = "Saving…";
    window.clearTimeout(hideTimer);
    type Saved = { ok: boolean; saved?: number; error?: string };
    const result = await (chrome.runtime.sendMessage({ type: "form-save-answer", question, answer, section: sectionOf(el).slice(0, 120) }) as Promise<Saved>).catch((): Saved => ({ ok: false, error: "Refresh this page to save" }));
    if (result.ok) saved.set(el, answer);
    button.className = result.ok ? "done" : "off";
    button.textContent = !result.ok ? result.error ?? "Couldn't save" : result.saved ? "Saved to your profile ✓" : "Already in your profile ✓";
    hideTimer = window.setTimeout(hide, 2500);
  }

  const control = (event: Event) => {
    const target = event.composedPath()[0];
    return target instanceof HTMLElement && target.matches(TYPED) && !ours(target) ? target : null;
  };
  const worth = (el: HTMLElement) => {
    const value = valueOf(el);
    if (!value || saved.get(el) === value || (el as HTMLInputElement).disabled) return false;
    if (/dateSection(Month|Day|Year)/i.test(`${el.getAttribute("data-automation-id") ?? ""} ${el.id}`)) return false;
    // A job's or school's own boxes ("Work Experience 2") come from the profile's entries: a saved answer would
    // land in every entry on the next form.
    if (/\b\d{1,2}$|experience|employment|work history|education|websites?$/i.test(sectionOf(el))) return false;
    const question = questionOf(el);
    return question.length >= 2 && !SKIP.test(question) && !SKIP.test(`${(el as HTMLInputElement).name ?? ""} ${el.getAttribute("autocomplete") ?? ""}`);
  };

  // Only the student's own typing counts: the browser marks it trusted, and Unnepo's filling never is.
  document.addEventListener("input", (event) => { const el = control(event); if (el && event.isTrusted) { typed.add(el); if (el === field) hide(); } }, true);
  document.addEventListener("change", (event) => { const el = control(event); if (el instanceof HTMLSelectElement && event.isTrusted && worth(el)) { typed.add(el); show(el); } }, true);
  document.addEventListener("focusout", (event) => { const el = control(event); if (el && typed.has(el) && worth(el)) show(el); }, true);
  window.addEventListener("scroll", place, true);
  window.addEventListener("resize", place);
}
