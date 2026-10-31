import { bestOption } from "@/lib/apply/options";
import { answerChoices, DECLINE } from "@/lib/apply/questions";
import type { DropdownMethod, FileData, FillProblem } from "../shared/types";
import { deepAll } from "./scan";

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
  el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
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
  if (!choice) throw new FillError(`no option matching "${answer}"`, "no_option", labels.filter(Boolean).slice(0, 100));
  el.value = el.options[labels.indexOf(choice)].value;
  el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
}

/** Matches an answer to visible option texts; `pick` overrides the matching (degrees, cities). */
export function matchOption(answer: string, texts: string[], pick?: (texts: string[]) => string | null) {
  if (pick) return pick(texts);
  // "Decline to answer" is worded a dozen ways ("I don't wish to answer", "Prefer not to say").
  if (DECLINE.test(answer)) return texts.find((option) => DECLINE.test(option)) ?? null;
  return answerChoices(answer).map((candidate) => bestOption(candidate, texts)).find(Boolean) ?? null;
}

const optionText = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim();

/** A failed fill, with the kind of problem (for the failure record) and the choices a dropdown showed. */
export class FillError extends Error {
  constructor(message: string, readonly problem: FillProblem, readonly options: string[] = []) {
    super(message);
  }
}

/** Any open listbox's options on the page. */
export function visibleOptions(scope: ParentNode = document) {
  return deepAll<HTMLElement>("[role=option], [data-automation-id='promptOption']", scope).filter((el) => el.getBoundingClientRect().height > 0);
}

/** The element that has the keyboard, looking inside shadow roots. */
function focused(): HTMLElement | null {
  let el = document.activeElement as HTMLElement | null;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement as HTMLElement;
  return el && el !== document.body ? el : null;
}

/** One key press, the way a keyboard sends it: keydown, keypress for characters, keyup. */
export function key(el: Element, name: string) {
  const codes: Record<string, number> = { ArrowDown: 40, ArrowUp: 38, Enter: 13, Escape: 27, " ": 32, Tab: 9 };
  const at = { key: name, code: name.length === 1 ? (name === " " ? "Space" : `Key${name.toUpperCase()}`) : name, keyCode: codes[name] ?? name.toUpperCase().charCodeAt(0), which: codes[name] ?? name.toUpperCase().charCodeAt(0), bubbles: true, cancelable: true, composed: true };
  el.dispatchEvent(new KeyboardEvent("keydown", at));
  if (name.length === 1 || name === "Enter") el.dispatchEvent(new KeyboardEvent("keypress", at));
  el.dispatchEvent(new KeyboardEvent("keyup", at));
}

/**
 * Types into a text box one character at a time, with a key press and an input event for each, for boxes
 * that ignore a value set all at once (search boxes that only filter on real typing, masked inputs).
 */
export async function typeKeys(el: HTMLInputElement | HTMLTextAreaElement, value: string, blur = true) {
  el.focus();
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const set = (text: string) => Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, text);
  set("");
  el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "deleteContentBackward" }));
  let typed = "";
  for (const char of value) {
    const at = { key: char, bubbles: true, cancelable: true, composed: true };
    el.dispatchEvent(new KeyboardEvent("keydown", at));
    el.dispatchEvent(new KeyboardEvent("keypress", at));
    typed += char;
    set(typed);
    el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, data: char, inputType: "insertText" }));
    el.dispatchEvent(new KeyboardEvent("keyup", at));
    // Long answers go in faster; a short search gets time to filter between letters.
    if (value.length <= 40) await sleep(25);
  }
  el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  if (blur) el.dispatchEvent(new FocusEvent("blur", { bubbles: false }));
}

const BLANK_CHOICE = /^(select( one)?(\.{1,3}|…)?|choose( one)?(\.{1,3}|…)?|please select|search|--.*|)$/i;
const CHOSEN = "[class*='single-value'], [class*='singleValue'], [class*='multi-value'], [class*='multiValue'], [data-automation-id='selectedItem'], [class*='selected-value'], [class*='selectedValue']";
const loose = (text: string) => text.toLowerCase().replace(/\s*\([^)]*\)/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** The choice React selects and Workday keep beside the box (a "single-value" or a "selectedItem" pill), if any. */
function chosenBeside(trigger: HTMLElement) {
  let node: Element | null = trigger;
  for (let depth = 0; node && depth < 5; depth += 1, node = node.parentElement) {
    const chosen = Array.from(node.querySelectorAll(CHOSEN)).map(optionText).filter(Boolean);
    if (chosen.length) return chosen.join(", ");
    if (depth > 0 && node.querySelectorAll("input:not([type=hidden]), select, button, [role=combobox]").length > 2) break;
  }
  return null;
}

/** What a custom dropdown shows as chosen ("" when it shows nothing, like "Select One"), or null when it can't tell. */
export function shownChoice(trigger: HTMLElement): string | null {
  const beside = chosenBeside(trigger);
  if (beside) return beside;
  if (trigger instanceof HTMLInputElement) return trigger.value.trim();
  const shown = (trigger.innerText || trigger.textContent || "").replace(/\s+/g, " ").trim();
  if (BLANK_CHOICE.test(shown)) return "";
  return shown || null;
}

/** Whether the dropdown now shows the choice. A box that shows nothing readable gets the benefit of the doubt. */
export function showsChoice(trigger: HTMLElement, choice: string) {
  const shown = shownChoice(trigger);
  if (shown === null) return true;
  if (!shown) return false;
  const have = loose(shown);
  const want = loose(choice);
  if (!want) return true;
  // A search box still holding what was typed hasn't chosen anything: its text must hold the whole choice.
  if (trigger instanceof HTMLInputElement && !chosenBeside(trigger)) return have.includes(want);
  return have.includes(want) || want.includes(have);
}

/** The scrolling box a list's options sit in, if it scrolls. */
function scroller(el: Element | undefined) {
  let node = el?.parentElement ?? null;
  for (let depth = 0; node && depth < 6; depth += 1, node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && node.scrollHeight > node.clientHeight + 2) return node;
  }
  return null;
}

/** `ways`: the ways to try, in order (clicks, then the keyboard, unless a site did better with the keyboard first). */
type ChooseOptions = { type?: string; list?: () => HTMLElement[]; pick?: (texts: string[]) => string | null; ways?: DropdownMethod[] };

/** The order to try the ways in, given the one that worked on this site before. */
export const waysFrom = (first?: DropdownMethod): DropdownMethod[] => (first === "keyboard" ? ["keyboard", "click"] : ["click", "keyboard"]);

/** This dropdown's options: the list it says it controls, or the ones that opened after it was pressed. */
function listFor(trigger: HTMLElement, before: Set<HTMLElement>, options: ChooseOptions) {
  return options.list ?? (() => {
    const owned = ownedList(trigger);
    const shown = owned ? visibleOptions(owned) : visibleOptions();
    const fresh = shown.filter((el) => !before.has(el));
    return fresh.length ? fresh : shown;
  });
}

/**
 * The option that fits, scrolling the list to load more when it isn't showing yet (long lists like
 * countries and schools load as you scroll). Every choice seen comes back too, for the AI to pick from.
 */
async function findChoice(list: () => HTMLElement[], answer: string, pick?: ChooseOptions["pick"]) {
  const seen: string[] = [];
  for (let round = 0; round < 30; round += 1) {
    const items = list();
    const texts = items.map(optionText);
    for (const text of texts) if (text && !seen.includes(text)) seen.push(text);
    const choice = matchOption(answer, texts, pick);
    if (choice) return { item: items[texts.indexOf(choice)], choice, seen };
    const box = scroller(items[items.length - 1]);
    if (!box || box.scrollTop + box.clientHeight >= box.scrollHeight - 2) break;
    box.scrollTop += Math.max(box.clientHeight - 20, 40);
    box.dispatchEvent(new Event("scroll", { bubbles: true }));
    await sleep(180);
  }
  return { item: null, choice: null, seen };
}

/** Some lists open a second list under the choice (Workday's "How did you hear about us?" > "Job Board"). */
async function nestedChoice(trigger: HTMLElement, answer: string, choice: string, before: Set<HTMLElement>, firstList: HTMLElement[], pick?: ChooseOptions["pick"]) {
  const nested = visibleOptions().filter((el) => !firstList.includes(el) && !before.has(el));
  if (!nested.length) return choice;
  const nestedTexts = nested.map(optionText);
  const second = matchOption(answer, nestedTexts, pick) ?? nestedTexts.find((text) => /^other\b/i.test(text)) ?? (nested.length === 1 ? nestedTexts[0] : null);
  if (!second) {
    close(trigger);
    throw new FillError(`"${choice}" opened more choices, and none fits "${answer}"`, "more_choices", nestedTexts.slice(0, 100));
  }
  press(nested[nestedTexts.indexOf(second)]);
  await sleep(250);
  return second;
}

/** No options showed: a search that found nothing is a missing option, not a list that didn't open. */
function notOpened(trigger: HTMLElement, options: ChooseOptions, message: string) {
  const searched = options.type && trigger instanceof HTMLInputElement && (trigger.getAttribute("aria-expanded") === "true" || ownedList(trigger));
  return searched ? new FillError(`searching "${options.type!.slice(0, 40)}" showed no options`, "no_option") : new FillError(message, "list_didnt_open");
}

/** Step 1: open the dropdown with a pointer click, optionally type to filter, click the matching option. */
async function byClicking(trigger: HTMLElement, answer: string, options: ChooseOptions) {
  // Options already showing (another dropdown left open) aren't this dropdown's: only new ones count.
  const before = new Set(visibleOptions());
  const list = listFor(trigger, before, options);
  trigger.scrollIntoView({ block: "center" });
  const control = (trigger.closest("[class*='select__control'], [class*='-control']") as HTMLElement | null) ?? trigger;
  press(control);
  if (trigger instanceof HTMLInputElement) trigger.focus();
  if (options.type && trigger instanceof HTMLInputElement) typeInto(trigger, options.type.slice(0, 40), false);
  const found = await waitFor(() => (list().length ? list() : null), options.type ? 6000 : 3000);
  if (!found) throw notOpened(trigger, options, "the list didn't open");
  // Async lists (cities, schools) keep loading for a moment after the first result.
  if (options.type) await sleep(350);
  const { item, choice, seen } = await findChoice(list, answer, options.pick);
  if (!item || !choice) {
    close(trigger);
    throw new FillError(`no option matching "${answer}"`, "no_option", seen.slice(0, 100));
  }
  const firstList = list();
  press(item);
  await sleep(250);
  const final = await nestedChoice(trigger, answer, choice, before, firstList, options.pick);
  // A list left open would mix its options into the next dropdown's.
  if (firstList.some((el) => el.isConnected && el.getBoundingClientRect().height > 0) && !multiSelect(trigger)) close(trigger);
  return final;
}

/** Which option the keyboard is on: the one the box points to (aria-activedescendant), or the one marked active. */
function activeIndex(trigger: HTMLElement, items: HTMLElement[]) {
  const pointed = [trigger, focused()].map((el) => el?.getAttribute("aria-activedescendant")).find(Boolean);
  if (pointed) {
    const index = items.findIndex((item) => item.id === pointed);
    if (index >= 0) return index;
  }
  const marked = items.findIndex((item) => item === focused() || item.getAttribute("data-focused") === "true" || /\b(is-?focused|focused|highlighted|is-active|active)\b/i.test(item.className));
  if (marked >= 0) return marked;
  return items.findIndex((item) => item.getAttribute("aria-selected") === "true");
}

/**
 * Step 2: the keyboard, for dropdowns that ignore clicks made by code and search boxes that only filter
 * on real key presses: focus the box, press Down, type one letter at a time, move to the option, press Enter.
 */
async function byKeyboard(trigger: HTMLElement, answer: string, options: ChooseOptions) {
  const before = new Set(visibleOptions());
  const list = listFor(trigger, before, options);
  trigger.scrollIntoView({ block: "center" });
  trigger.focus();
  const typing = trigger instanceof HTMLInputElement && options.type;
  if (typing) await typeKeys(trigger as HTMLInputElement, options.type!.slice(0, 40), false);
  key(focused() ?? trigger, "ArrowDown");
  let found = await waitFor(() => (list().length ? list() : null), typing ? 6000 : 1200);
  // Buttons open on Space or Enter instead.
  for (const opener of typing ? [] : [" ", "Enter"]) {
    if (found) break;
    key(focused() ?? trigger, opener);
    found = await waitFor(() => (list().length ? list() : null), 1200);
  }
  if (!found) throw notOpened(trigger, options, "the list didn't open, by click or keyboard");
  if (typing) await sleep(350);
  const { item, choice, seen } = await findChoice(list, answer, options.pick);
  if (!item || !choice) {
    close(trigger);
    throw new FillError(`no option matching "${answer}"`, "no_option", seen.slice(0, 100));
  }
  const firstList = list();
  // Arrow to the option, checking where the keyboard is after each press. Options are found by their text:
  // long lists draw new rows as they scroll.
  let moved = false;
  for (let presses = 0; presses < 300; presses += 1) {
    const items = list();
    const at = activeIndex(trigger, items);
    const target = items.map(optionText).indexOf(choice);
    if (at < 0 || target < 0) break;
    if (at === target) { moved = true; break; }
    key(focused() ?? trigger, at < target ? "ArrowDown" : "ArrowUp");
    await sleep(15);
  }
  if (moved) key(focused() ?? trigger, "Enter");
  // A list that doesn't say which option the keyboard is on: the option gets a plain click instead.
  else (list().find((el) => optionText(el) === choice) ?? item).click();
  await sleep(250);
  const final = await nestedChoice(trigger, answer, choice, before, firstList, options.pick);
  if (firstList.some((el) => el.isConnected && el.getBoundingClientRect().height > 0) && !multiSelect(trigger)) close(trigger);
  return final;
}

/**
 * A searchable or plain custom dropdown, tried one way after another until the box shows the choice:
 * clicks first, then the keyboard (or the keyboard first, on a site where it worked before). Scrolling for
 * more options and loose matching are part of each. Says which way worked; throws when none did.
 */
export async function chooseCustom(trigger: HTMLElement, answer: string, options: ChooseOptions = {}): Promise<DropdownMethod> {
  const ways: Record<DropdownMethod, typeof byClicking> = { click: byClicking, keyboard: byKeyboard };
  let last: FillError | null = null;
  for (const method of options.ways ?? waysFrom()) {
    try {
      const choice = await ways[method](trigger, answer, options);
      await sleep(60);
      if (showsChoice(trigger, choice)) return method;
      last = new FillError(`picked "${choice}", but the box still shows "${shownChoice(trigger) || "nothing"}"`, "didnt_stick");
    } catch (error) {
      last = error instanceof FillError ? error : new FillError(error instanceof Error ? error.message : "couldn't fill", "error");
      // The same options show however the list opens; only a box that filters as you type might show others.
      if ((last.problem === "no_option" && !(trigger instanceof HTMLInputElement && options.type)) || last.problem === "more_choices") break;
    }
  }
  throw last ?? new FillError("couldn't fill", "error");
}

/** The list a dropdown says it controls (aria-controls / aria-owns), when it says. */
function ownedList(trigger: HTMLElement) {
  const ids = `${trigger.getAttribute("aria-controls") ?? ""} ${trigger.getAttribute("aria-owns") ?? ""}`.trim().split(/\s+/).filter(Boolean);
  for (const id of ids) {
    const el = (trigger.getRootNode() as Document | ShadowRoot).getElementById(id) ?? document.getElementById(id);
    if (el) return el;
  }
  return null;
}

/** Multi-select lists stay open on purpose after a pick. */
const multiSelect = (trigger: HTMLElement) => trigger.getAttribute("aria-multiselectable") === "true" || Boolean(trigger.closest("[aria-multiselectable='true'], [class*='multi']"));

/** Closes a dropdown's list with Escape on the dropdown itself (never the page, which could close a popup form). */
function close(trigger: HTMLElement) {
  trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
}

export function attachFile(input: HTMLInputElement, file: FileData) {
  const bytes = Uint8Array.from(atob(file.base64), (char) => char.charCodeAt(0));
  const transfer = new DataTransfer();
  transfer.items.add(new File([bytes], file.name, { type: file.mime }));
  input.files = transfer.files;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
}

export const YES = /^(yes|true|y|1|i agree|agree|checked)$/i;
