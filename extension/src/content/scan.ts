import type { FieldType, PageField, Scan } from "../shared/types";

/**
 * Reads the form on the page: every field's question (walking up the page when the label is missing or
 * is only a format like "MM/YYYY"), the section it sits in, its options, and whether it's empty.
 * Each field gets a data-unnepo-id so the filler can find it again.
 */

// Required markers vary: "*", Lever's "✱", or the word itself.
const clean = (text: string | null | undefined) => (text ?? "").replace(/\s+/g, " ").replace(/\b(select one|required)\b/gi, "").replace(/[*✱]/g, "").trim();
const machine = (text: string) => !/\s/.test(text) && /[[\]_]/.test(text);
const FORMAT_ONLY = /^(mm\/yyyy|mm\/dd\/yyyy|dd\/mm\/yyyy|yyyy|mm|month|year|select|search|choose|type to search|start typing)$/i;
const CONTROLS = "input:not([type=hidden]), select, textarea, button[aria-haspopup='listbox']";

function byIds(ids: string) {
  return ids.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
}

function optionTexts(node: Element) {
  const parts: string[] = [];
  node.querySelectorAll("option, [role=option]").forEach((option) => parts.push(option.textContent ?? ""));
  node.querySelectorAll<HTMLInputElement>("input[type=radio], input[type=checkbox]").forEach((input) => parts.push(labelOf(input)));
  return parts.map(clean).filter(Boolean);
}

function ownText(node: HTMLElement) {
  let text = clean(node.innerText);
  for (const part of optionTexts(node)) if (part) text = text.split(part).join(" ");
  return clean(text);
}

/** The visible label of one radio button or checkbox: its option, not the question. */
export function labelOf(input: HTMLInputElement) {
  const byFor = input.id ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`) : null;
  return clean(byFor?.textContent || input.closest("label")?.textContent || input.getAttribute("aria-label") || input.value);
}

function groupQuestion(el: HTMLInputElement) {
  const group = el.closest("[role=radiogroup], fieldset, [role=group]");
  const named = group && (clean(group.querySelector("legend")?.textContent) || (group.getAttribute("aria-labelledby") ? clean(byIds(group.getAttribute("aria-labelledby")!)) : "") || clean(group.getAttribute("aria-label")));
  if (named) return named.slice(0, 300);
  const members = el.name ? Array.from(document.querySelectorAll(`input[name="${CSS.escape(el.name)}"]`)) : [el];
  let node = el.parentElement;
  for (let depth = 0; node && node !== document.body && depth < 8; depth += 1, node = node.parentElement) {
    if (!members.every((member) => node!.contains(member))) continue;
    if (node.querySelectorAll(CONTROLS).length > members.length + 3) break;
    const text = ownText(node);
    if (text.length >= 3) return text.slice(0, 300);
  }
  return "";
}

/** The question a control asks. */
export function questionText(el: HTMLElement): string {
  const type = (el.getAttribute("type") ?? "").toLowerCase();
  if (type === "radio" || type === "checkbox") {
    const asked = groupQuestion(el as HTMLInputElement);
    if (asked && (type === "radio" || el.closest("fieldset, [role=group]"))) return asked;
  }
  const labelledBy = el.getAttribute("aria-labelledby");
  const direct = [
    el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent : "",
    labelledBy ? byIds(labelledBy) : "",
    el.closest("[data-automation-id^='formField']")?.querySelector("label")?.textContent,
    type === "checkbox" ? "" : el.closest("label")?.textContent,
    el.getAttribute("aria-label"),
    el.closest("fieldset")?.querySelector("legend")?.textContent,
  ].map(clean).find((text) => text && text.length > 1 && !machine(text));
  if (direct && !FORMAT_ONLY.test(direct)) return direct.slice(0, 300);
  let node = el.parentElement;
  for (let depth = 0; node && node !== document.body && depth < 6; depth += 1, node = node.parentElement) {
    if (node.querySelectorAll(CONTROLS).length > 6) break;
    const text = ownText(node);
    if (text.length >= 3 && !FORMAT_ONLY.test(text)) return (direct ? `${text} (${direct})` : text).slice(0, 300);
  }
  if (type === "checkbox") {
    const own = labelOf(el as HTMLInputElement);
    if (own) return own;
  }
  return direct || clean(el.getAttribute("placeholder")) || clean((el.getAttribute("name") ?? "").replace(/[[\]_.]+/g, " "));
}

// A legend names its own fieldset's question, not the fields after it, so it isn't a section heading.
const HEADING = "h1, h2, h3, h4, h5, [role=heading], [data-automation-id*='Header' i]";

/** The heading a control sits under ("Work Experience 2", "Education"). */
export function sectionOf(el: Element) {
  let node: Element | null = el;
  for (let depth = 0; node && node !== document.body && depth < 12; depth += 1, node = node.parentElement) {
    let sibling = node.previousElementSibling;
    for (let hops = 0; sibling && hops < 25; hops += 1, sibling = sibling.previousElementSibling) {
      const found = sibling.matches(HEADING) ? sibling : Array.from(sibling.querySelectorAll(HEADING)).pop();
      const text = clean(found?.textContent);
      if (text && text.length < 90) return text;
    }
  }
  return "";
}

const BLANK = /^(select( one)?(\.{1,3}|…)?|choose( one)?(\.{1,3}|…)?|please select|--.*|)$/i;

/** Whether a control (or the group or wrapper it stands for) has no answer yet. */
export function isEmpty(el: HTMLElement): boolean {
  const type = (el.getAttribute("type") ?? "").toLowerCase();
  if (el.tagName === "BUTTON") return BLANK.test(clean(el.innerText));
  if (el instanceof HTMLSelectElement) return !el.value || BLANK.test(clean(el.selectedOptions[0]?.textContent));
  // A React select keeps its choice beside the input, which itself stays empty.
  if (el.getAttribute("role") === "combobox") {
    let node = el.parentElement;
    for (let depth = 0; node && depth < 5; depth += 1, node = node.parentElement) {
      if (node.querySelector("[class*='single-value'], [class*='multi-value'], [data-automation-id='selectedItem']")) return false;
      if (node.querySelectorAll("[role=combobox]").length > 1) break;
    }
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    if (type === "checkbox") {
      const group = el.closest("fieldset, [role=group]");
      if (group && group.querySelectorAll("input[type=checkbox]").length > 1) return !group.querySelector("input[type=checkbox]:checked");
      return !(el as HTMLInputElement).checked;
    }
    if (type === "radio") return !document.querySelector(`input[type=radio][name="${CSS.escape((el as HTMLInputElement).name)}"]:checked`);
    if (type === "file") return !(el as HTMLInputElement).files?.length && !/\.(pdf|docx?|txt|rtf)\b/i.test(el.closest("div")?.parentElement?.textContent ?? "");
    return !el.value.trim();
  }
  return false;
}

function visible(el: Element) {
  const style = window.getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  return style.display !== "none" && style.visibility !== "hidden" && (rect.width > 0 || rect.height > 0);
}

let counter = 0;
function mark(el: Element) {
  if (!el.getAttribute("data-unnepo-id")) el.setAttribute("data-unnepo-id", `u${++counter}`);
  return el.getAttribute("data-unnepo-id")!;
}

/**
 * An open popup with a form in it (Paycom's "Getting You Started", sign-up modals). While one is up it's
 * the only part of the page that counts: the page behind it is usually marked hidden, and some sites
 * wrongly mark parts of the popup itself hidden too.
 */
export function openDialog(): HTMLElement | null {
  return Array.from(document.querySelectorAll<HTMLElement>("[role=dialog], [role=alertdialog], [aria-modal='true'], dialog[open]"))
    .filter((dialog) => visible(dialog) && dialog.getBoundingClientRect().height > 40)
    .filter((dialog) => Array.from(dialog.querySelectorAll<HTMLElement>("input:not([type=hidden]), select, textarea")).some((el) => visible(el) && el.getBoundingClientRect().width >= 4))
    .pop() ?? null;
}

/** Every answerable field on the page (or in the open popup), one per question. */
export function scanFields(): PageField[] {
  const out: PageField[] = [];
  const seenGroups = new Set<string>();
  const dialog = openDialog();
  const controls = Array.from((dialog ?? document).querySelectorAll<HTMLElement>("input, select, textarea, button[aria-haspopup='listbox']"));
  for (const el of controls) {
    const type = (el.getAttribute("type") ?? (el.tagName === "TEXTAREA" ? "textarea" : el.tagName === "SELECT" ? "select" : "text")).toLowerCase();
    if (["hidden", "submit", "button", "password", "image", "reset", "search"].includes(type) && el.getAttribute("data-automation-id") !== "searchBox") continue;
    if (el.getAttribute("aria-hidden") === "true" || /honeypot|bee-?catcher/i.test(`${el.getAttribute("name") ?? ""} ${el.getAttribute("data-automation-id") ?? ""}`)) continue;
    if ((!dialog && el.closest("[aria-hidden='true']")) || el.id.startsWith("g-recaptcha")) continue;
    if (type !== "file" && type !== "radio" && type !== "checkbox" && !visible(el)) continue;
    // Bot traps: a box a person can't see (a pixel or two) or one whose label says to leave it empty. Never filled.
    if (type !== "file" && type !== "radio" && type !== "checkbox" && (el.getBoundingClientRect().width < 4 || el.getBoundingClientRect().height < 4)) continue;
    if (/robots? only|if you(?:'|’)?re (a )?human|leave (this|it) (field )?(blank|empty)|do not (fill|enter)/i.test(questionText(el as HTMLElement))) continue;
    const required = el.hasAttribute("required") || el.getAttribute("aria-required") === "true" || Boolean(el.closest("[aria-required='true']")) || /[*✱]/.test(el.closest("label")?.textContent ?? (el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent ?? "" : ""));
    let fieldType: FieldType;
    let options: string[] = [];
    let target: HTMLElement = el;
    if (type === "radio") {
      const name = (el as HTMLInputElement).name;
      if (!name || seenGroups.has(`r:${name}`)) continue;
      seenGroups.add(`r:${name}`);
      fieldType = "radio";
      options = Array.from(document.querySelectorAll<HTMLInputElement>(`input[type=radio][name="${CSS.escape(name)}"]`)).map(labelOf).filter(Boolean);
    } else if (type === "checkbox") {
      const group = el.closest("fieldset, [role=group]");
      const boxes = group ? Array.from(group.querySelectorAll<HTMLInputElement>("input[type=checkbox]")) : [];
      if (boxes.length > 1) {
        const key = `c:${group!.id || mark(group!)}`;
        if (seenGroups.has(key)) continue;
        seenGroups.add(key);
        fieldType = "multiselect";
        options = boxes.map(labelOf).filter(Boolean);
        target = group as HTMLElement;
      } else {
        fieldType = "checkbox";
        options = ["Yes"];
      }
    } else if (el instanceof HTMLSelectElement) {
      fieldType = "select";
      options = Array.from(el.options).map((option) => clean(option.text)).filter((text) => text && !BLANK.test(text));
    } else if (el.tagName === "BUTTON" || el.getAttribute("role") === "combobox" || el.getAttribute("data-automation-id") === "searchBox") {
      fieldType = "combobox";
    } else if (el.tagName === "TEXTAREA") {
      fieldType = "textarea";
    } else {
      fieldType = (["email", "tel", "file", "date", "url", "number"].includes(type) ? type : "text") as FieldType;
    }
    const source = target === el ? el : (target.querySelector("input") as HTMLElement) ?? el;
    const label = fieldType === "multiselect" ? (clean(target.querySelector("legend")?.textContent) || questionText(source)) : questionText(el);
    if (!label) continue;
    const placeholder = el.getAttribute("placeholder") ?? "";
    out.push({
      id: mark(target),
      label: label.slice(0, 300),
      type: fieldType,
      options: options.slice(0, 100),
      required,
      section: sectionOf(target),
      format: /[my]{2}|dd/i.test(placeholder) ? placeholder : type === "date" ? "YYYY-MM-DD" : null,
    });
  }
  return out;
}

/** Fields the page marks required that are still empty. */
export function emptyRequired(fields = scanFields()) {
  return fields.filter((field) => {
    if (!field.required) return false;
    const el = document.querySelector<HTMLElement>(`[data-unnepo-id="${field.id}"]`);
    if (!el) return false;
    const control = el.matches("input, select, textarea, button") ? el : (el.querySelector("input") as HTMLElement | null) ?? el;
    return isEmpty(control);
  });
}

function detectAts(host: string): Scan["ats"] {
  if (/(^|\.)greenhouse\.io$/.test(host)) return "greenhouse";
  if (/(^|\.)lever\.co$/.test(host)) return "lever";
  if (/(^|\.)ashbyhq\.com$/.test(host)) return "ashby";
  if (/myworkday(jobs|site)\.com$/.test(host)) return "workday";
  return "other";
}

/** What the page is: the job system, title and company, and the form's fields. */
export function scanPage(): Scan {
  const host = window.location.hostname;
  const ats = detectAts(host);
  const meta = (name: string) => document.querySelector<HTMLMetaElement>(`meta[property="${name}"], meta[name="${name}"]`)?.content ?? "";
  const heading = clean(document.querySelector("h1")?.textContent);
  // Greenhouse titles read "Job Application for Product Analyst at Acme".
  const greenhouseTitle = document.title.match(/^Job Application for (.+) at (.+)$/);
  const title = (greenhouseTitle?.[1] || heading || meta("og:title") || document.title).slice(0, 200);
  const company = (greenhouseTitle?.[2] || meta("og:site_name") || host.replace(/^(www|jobs|careers|boards|apply)\./, "").split(".")[0]).slice(0, 200);
  const frame = document.querySelector<HTMLIFrameElement>("iframe#grnhse_iframe, iframe[src*='greenhouse.io/embed'], iframe[src*='jobs.lever.co'], iframe[src*='ashbyhq.com']");
  const captcha = Array.from(document.querySelectorAll("iframe[src*='hcaptcha'], iframe[title*='recaptcha challenge' i], iframe[src*='recaptcha/api2/bframe']")).some(visible);
  return {
    url: window.location.href,
    title,
    company,
    ats,
    useServerSchema: ats === "greenhouse" && Boolean(document.getElementById("first_name")),
    fields: scanFields(),
    embeddedForm: frame?.src ?? null,
    captcha,
    passwordBoxes: Array.from(document.querySelectorAll<HTMLInputElement>("input[type=password]")).filter(visible).length,
  };
}
