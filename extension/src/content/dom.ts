import { bestOption } from "@/lib/apply/options";
import { answerChoices } from "@/lib/apply/questions";
import type { FileData } from "../shared/types";

/**
 * Filling fields the way a person would, so React-controlled forms register the values: the native value
 * setter, then input, change, and blur events; pointer events for clicks; DataTransfer for files.
 */

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitFor<T>(find: () => T | null | undefined | false, timeout = 4000): Promise<T | null> {
  const end = Date.now() + timeout;
  for (;;) {
    const found = find();
    if (found) return found;
    if (Date.now() > end) return null;
    await sleep(60);
  }
}

/** Sets a text box's value so React (and plain pages) see it. */
export function typeInto(el: HTMLInputElement | HTMLTextAreaElement, value: string, blur = true) {
  el.focus();
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  if (blur) el.dispatchEvent(new FocusEvent("blur", { bubbles: false }));
}

/** A full pointer click: what custom dropdowns listen for, not just "click". */
export function press(el: Element) {
  const rect = el.getBoundingClientRect();
  const at = { bubbles: true, cancelable: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, button: 0 };
  el.dispatchEvent(new PointerEvent("pointerdown", at));
  el.dispatchEvent(new MouseEvent("mousedown", at));
  el.dispatchEvent(new PointerEvent("pointerup", at));
  el.dispatchEvent(new MouseEvent("mouseup", at));
  (el as HTMLElement).click();
}

export function chooseNativeSelect(el: HTMLSelectElement, answer: string) {
  const labels = Array.from(el.options).map((option) => option.text.trim());
  const choice = answerChoices(answer).map((candidate) => bestOption(candidate, labels)).find(Boolean);
  if (!choice) throw new Error(`no option matching "${answer}"`);
  el.value = el.options[labels.indexOf(choice)].value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Matches an answer to visible option texts; `pick` overrides the matching (degrees, cities). */
export function matchOption(answer: string, texts: string[], pick?: (texts: string[]) => string | null) {
  if (pick) return pick(texts);
  return answerChoices(answer).map((candidate) => bestOption(candidate, texts)).find(Boolean) ?? null;
}

const optionText = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim();

/** Any open listbox's options on the page. */
export function visibleOptions(scope: ParentNode = document) {
  return Array.from(scope.querySelectorAll<HTMLElement>("[role=option], [data-automation-id='promptOption']")).filter((el) => el.getBoundingClientRect().height > 0);
}

/** A searchable or plain custom dropdown: open it, optionally type to filter, click the matching option. */
export async function chooseCustom(trigger: HTMLElement, answer: string, options: { type?: string; list?: () => HTMLElement[]; pick?: (texts: string[]) => string | null } = {}) {
  const list = options.list ?? (() => visibleOptions());
  trigger.scrollIntoView({ block: "center" });
  const control = (trigger.closest("[class*='select__control'], [class*='-control']") as HTMLElement | null) ?? trigger;
  press(control);
  if (trigger instanceof HTMLInputElement) trigger.focus();
  if (options.type && trigger instanceof HTMLInputElement) typeInto(trigger, options.type.slice(0, 40), false);
  const found = await waitFor(() => (list().length ? list() : null), options.type ? 6000 : 3000);
  if (!found) throw new Error("the list didn't open");
  // Async lists (cities, schools) keep loading for a moment after the first result.
  if (options.type) await sleep(350);
  const items = list();
  const texts = items.map(optionText);
  const choice = matchOption(answer, texts, options.pick);
  if (!choice) {
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    throw new Error(`no option matching "${answer}"`);
  }
  press(items[texts.indexOf(choice)]);
  await sleep(120);
}

export function attachFile(input: HTMLInputElement, file: FileData) {
  const bytes = Uint8Array.from(atob(file.base64), (char) => char.charCodeAt(0));
  const transfer = new DataTransfer();
  transfer.items.add(new File([bytes], file.name, { type: file.mime }));
  input.files = transfer.files;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

export const YES = /^(yes|true|y|1|i agree|agree|checked)$/i;
