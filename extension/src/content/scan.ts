import { cleanCompanyName, companyFromApplyHeading, notJobTitle } from "@/lib/apply/job-title";
import { QUICK_BOARDS } from "./quick-apply";
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
// The site's own controls around a form (its header, menus, footer, language and account switchers), never
// questions. A form that sits inside one of these still counts.
const PAGE_AREA = "nav, header, footer, [role=navigation], [role=banner], [role=contentinfo], [data-automation-id*='utility' i], [data-automation-id*='languagePicker' i], [data-automation-id*='locale' i]";
// A language switcher shows the page's language as its only words ("English"). A question about languages
// is labelled "Language" or "Languages spoken", so it never matches. On Workday, changing the language
// reloads the application from its first step.
export const LANGUAGE_SWITCH = /^(english|español|espanol|français|francais|deutsch|italiano|português|portugues|nederlands|polski|svenska|dansk|norsk|suomi|čeština|magyar|română|türkçe|ελληνικά|русский|українська|日本語|中文|简体中文|繁體中文|한국어|العربية|עברית|हिन्दी|ไทย|tiếng việt|bahasa indonesia)(\s*[(-].*)?$/i;

/**
 * Whether this control belongs to the site rather than the form: its header, menus, footer, or a language
 * dropdown. Only dropdowns count as language switchers: an "English" checkbox answers a question.
 */
export function pageControl(el: Element, label: string, dropdown: boolean) {
  const area = el.closest(PAGE_AREA);
  return Boolean(area && !area.closest("form")) || (dropdown && LANGUAGE_SWITCH.test(label.trim()));
}

const CONTROLS = "input:not([type=hidden]), select, textarea, button[aria-haspopup='listbox'], [role=combobox]:not(input), [aria-haspopup=listbox]:not(input):not(button)";

/**
 * A dropdown built from a plain element (a div with role="combobox", or one that says it opens a list), or
 * a button with role="combobox" (Radix): MUI, Headless UI, shadcn, and many company sites. Not when it
 * only wraps the real input or select.
 */
export function boxDropdown(el: Element) {
  if (el.matches("input, select, textarea")) return false;
  if (el.matches("button")) return el.getAttribute("role") === "combobox";
  if (!el.matches("[role=combobox], [aria-haspopup=listbox]")) return false;
  return !el.querySelector("input:not([type=hidden]), select, textarea, button[aria-haspopup='listbox'], [role=combobox]");
}

/**
 * Some forms are built from web components (SmartRecruiters): their fields live in shadow roots that a
 * plain querySelectorAll never sees. These look inside every open one.
 */
export function deepAll<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T[] {
  const found = Array.from(root.querySelectorAll<T>(selector));
  for (const el of Array.from(root.querySelectorAll("*"))) if (el.shadowRoot) found.push(...deepAll<T>(selector, el.shadowRoot));
  return found;
}

/** The document or shadow root an element lives in, where its <label for> and radio siblings are. */
export const rootOf = (el: Element) => el.getRootNode() as Document | ShadowRoot;

/** The parent, stepping out of a shadow root to the component that holds it. */
export const parentOf = (el: Element): Element | null => el.parentElement ?? ((el.getRootNode() as ShadowRoot).host ?? null);

/** A field the scanner marked, wherever it is. */
export const findMarked = (id: string) => deepAll<HTMLElement>(`[data-unnepo-id="${id}"]`)[0] ?? null;

function byIds(ids: string, root: Document | ShadowRoot = document) {
  return ids.split(/\s+/).map((id) => root.getElementById(id)?.textContent ?? "").join(" ");
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
  const byFor = input.id ? rootOf(input).querySelector(`label[for="${CSS.escape(input.id)}"]`) : null;
  return clean(byFor?.textContent || input.closest("label")?.textContent || input.getAttribute("aria-label") || input.value);
}

function groupQuestion(el: HTMLInputElement) {
  let group = el.closest("[role=radiogroup], fieldset, [role=group]");
  // A group holding text boxes too is a section ("Work Experience 1"), not the question: a box in it, like
  // "I currently work here", asks its own.
  if (group?.querySelector("input:not([type=radio]):not([type=checkbox]):not([type=hidden]), textarea, select")) group = null;
  const named = group && (clean(group.querySelector("legend")?.textContent) || (group.getAttribute("aria-labelledby") ? clean(byIds(group.getAttribute("aria-labelledby")!, rootOf(el))) : "") || clean(group.getAttribute("aria-label")));
  if (named) return named.slice(0, 300);
  const members = el.name ? Array.from(rootOf(el).querySelectorAll(`input[name="${CSS.escape(el.name)}"]`)) : [el];
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
    el.id ? rootOf(el).querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent : "",
    labelledBy ? byIds(labelledBy, rootOf(el)) : "",
    el.closest("[data-automation-id^='formField']")?.querySelector("label")?.textContent,
    type === "checkbox" ? "" : el.closest("label")?.textContent,
    el.getAttribute("aria-label"),
    el.closest("fieldset")?.querySelector("legend")?.textContent,
  ].map(clean).find((text) => text && text.length > 1 && !machine(text));
  if (direct && !FORMAT_ONLY.test(direct)) return direct.slice(0, 300);
  let node = parentOf(el);
  for (let depth = 0; node && node !== document.body && depth < 6; depth += 1, node = parentOf(node)) {
    if (node.querySelectorAll(CONTROLS).length > 6) break;
    const text = ownText(node as HTMLElement);
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
  for (let depth = 0; node && node !== document.body && depth < 12; depth += 1, node = parentOf(node)) {
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
  if (el.tagName === "BUTTON" || boxDropdown(el)) return BLANK.test(clean(el.innerText));
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
    if (type === "radio") return !rootOf(el).querySelector(`input[type=radio][name="${CSS.escape((el as HTMLInputElement).name)}"]:checked`);
    // A file name shown beside the box ("Drew Davis Resume.pdf"), not a list of types ("Accepted: .pdf, .docx").
    if (type === "file") return !(el as HTMLInputElement).files?.length && !/[\w)\]-]\.(pdf|docx?|txt|rtf)\b/i.test(el.closest("div")?.parentElement?.textContent ?? "");
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
  return deepAll<HTMLElement>("[role=dialog], [role=alertdialog], [aria-modal='true'], dialog[open]")
    .filter((dialog) => visible(dialog) && dialog.getBoundingClientRect().height > 40)
    .filter((dialog) => Array.from(dialog.querySelectorAll<HTMLElement>("input:not([type=hidden]), select, textarea")).some((el) => visible(el) && el.getBoundingClientRect().width >= 4))
    .pop() ?? null;
}

/**
 * The part of a split date box ("Month", "Day", "Year"): Workday's From and To dates are separate month and
 * year boxes, labelled only by the date they belong to. Null for an ordinary box.
 */
function dateSegment(el: Element) {
  const words = `${el.getAttribute("data-automation-id") ?? ""} ${el.id}`;
  const named = words.match(/dateSection(Month|Day|Year)/i)?.[1] ?? (el.getAttribute("role") === "spinbutton" ? el.getAttribute("aria-label")?.match(/^(month|day|year)$/i)?.[1] : null);
  return named ? (named[0].toUpperCase() + named.slice(1).toLowerCase()) as "Month" | "Day" | "Year" : null;
}

const SEGMENT_FORMAT = { Month: "MM", Day: "DD", Year: "YYYY" } as const;

/** Every answerable field on the page (or in the open popup), one per question. */
export function scanFields(): PageField[] {
  const out: PageField[] = [];
  const seenGroups = new Set<string>();
  const dialog = openDialog();
  const controls = deepAll<HTMLElement>("input, select, textarea, button[aria-haspopup='listbox'], [role=combobox]:not(input), [aria-haspopup=listbox]:not(input):not(button)", dialog ?? document);
  for (const el of controls) {
    const type = (el.getAttribute("type") ?? (el.tagName === "TEXTAREA" ? "textarea" : el.tagName === "SELECT" ? "select" : "text")).toLowerCase();
    // A dropdown built as a button (Workday's "Select One") has type="button" but is a question, not a button.
    // Not page controls that happen to open a list: Workday's "See my progress", language and menu buttons.
    const dropdownButton = ((el.tagName === "BUTTON" && el.getAttribute("aria-haspopup") === "listbox") || boxDropdown(el))
      && !el.closest("nav, header, footer, [role=navigation], [role=banner], [data-automation-id*='progress' i], [data-automation-id*='utility' i]")
      && !/\b(progress|menu|language|account|settings|filter|sort by)\b/i.test(el.textContent ?? "");
    if (["hidden", "submit", "button", "password", "image", "reset", "search"].includes(type) && el.getAttribute("data-automation-id") !== "searchBox" && !dropdownButton) continue;
    // Plain elements count only as dropdowns: a wrapper around the real control, or a menu, doesn't.
    if (!el.matches("input, select, textarea, button") && !dropdownButton) continue;
    if (el.getAttribute("aria-hidden") === "true" || /honeypot|bee-?catcher/i.test(`${el.getAttribute("name") ?? ""} ${el.getAttribute("data-automation-id") ?? ""}`)) continue;
    if ((!dialog && el.closest("[aria-hidden='true']")) || el.id.startsWith("g-recaptcha")) continue;
    if (type !== "file" && type !== "radio" && type !== "checkbox" && !visible(el)) continue;
    // Bot traps: a box a person can't see (a pixel or two) or one whose label says to leave it empty. Never filled.
    if (type !== "file" && type !== "radio" && type !== "checkbox" && (el.getBoundingClientRect().width < 4 || el.getBoundingClientRect().height < 4)) continue;
    if (/robots? only|if you(?:'|’)?re (a )?human|leave (this|it) (field )?(blank|empty)|do not (fill|enter)/i.test(questionText(el as HTMLElement))) continue;
    const required = el.hasAttribute("required") || el.getAttribute("aria-required") === "true" || Boolean(el.closest("[aria-required='true']")) || /[*✱]/.test(el.closest("label")?.textContent ?? (el.id ? rootOf(el).querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent ?? "" : ""));
    let fieldType: FieldType;
    let options: string[] = [];
    let target: HTMLElement = el;
    if (type === "radio") {
      const name = (el as HTMLInputElement).name;
      if (!name || seenGroups.has(`r:${name}`)) continue;
      seenGroups.add(`r:${name}`);
      fieldType = "radio";
      options = Array.from(rootOf(el).querySelectorAll<HTMLInputElement>(`input[type=radio][name="${CSS.escape(name)}"]`)).map(labelOf).filter(Boolean);
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
    } else if (el.tagName === "BUTTON" || boxDropdown(el) || el.getAttribute("role") === "combobox" || el.getAttribute("data-automation-id") === "searchBox") {
      fieldType = "combobox";
    } else if (el.tagName === "TEXTAREA") {
      fieldType = "textarea";
    } else {
      fieldType = (["email", "tel", "file", "date", "url", "number"].includes(type) ? type : "text") as FieldType;
    }
    const source = target === el ? el : (target.querySelector("input") as HTMLElement) ?? el;
    const label = fieldType === "multiselect" ? (clean(target.querySelector("legend")?.textContent) || questionText(source)) : questionText(el);
    if (!label || pageControl(el, label, fieldType === "combobox" || fieldType === "select")) continue;
    const placeholder = el.getAttribute("placeholder") ?? "";
    // "From (Month)" and "From (Year)": the date it belongs to, then the part.
    const segment = dateSegment(el);
    const dateOf = segment && /^(month|day|year)$/i.test(label) ? clean(el.closest("[data-automation-id^='formField'], fieldset, [role=group]")?.querySelector("label, legend")?.textContent) : "";
    const asked = segment ? `${dateOf || label} (${segment})`.replace(/^(month|day|year) \((month|day|year)\)$/i, "$1") : label;
    out.push({
      id: mark(target),
      label: asked.slice(0, 300),
      type: fieldType,
      options: options.slice(0, 100),
      required,
      section: sectionOf(target),
      format: segment ? SEGMENT_FORMAT[segment] : /[my]{2}|dd/i.test(placeholder) ? placeholder : type === "date" ? "YYYY-MM-DD" : null,
    });
  }
  return out;
}

/** Fields the page marks required that are still empty. */
export function emptyRequired(fields = scanFields()) {
  return fields.filter((field) => {
    if (!field.required) return false;
    const el = findMarked(field.id);
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

const JOB_LINK = /\/(job-search|jobs|stu\/jobs)\/\d+/;

/**
 * Handshake shows the job you clicked beside the search results (/job-search/<id>), so the page's own
 * heading and title aren't that job. This reads the details pane: from its Apply button (or the job's
 * heading) up to the largest box that still isn't the results list, then its title, employer and text.
 */
export function handshakeJob(where: { hostname: string; pathname: string } = window.location): { title: string; company: string; description: string } | null {
  if (!/(^|\.)joinhandshake\.com$/.test(where.hostname) || !JOB_LINK.test(where.pathname)) return null;
  const apply = Array.from(document.querySelectorAll<HTMLElement>("button, a, [role=button]"))
    .find((el) => visible(el) && /^(apply|apply now|apply externally|quick apply|easy apply)$/i.test(clean(el.textContent)));
  const start = apply ?? Array.from(document.querySelectorAll<HTMLElement>("h1, h2")).find(visible);
  if (!start) return null;
  // The results list links to many jobs; the details pane links to at most one (its own).
  const jobLinks = (el: Element) => Array.from(el.querySelectorAll<HTMLAnchorElement>("a[href]")).filter((a) => JOB_LINK.test(a.pathname)).length;
  let pane: HTMLElement = start;
  while (pane.parentElement && pane.parentElement !== document.body && jobLinks(pane.parentElement) <= 1) pane = pane.parentElement;
  // The job's name is the pane's top heading: an h1 if it has one, else an h2, else an h3.
  // Never a status line Handshake shows once you've applied ("Applied on November 2, 2026").
  const heading = ["h1", "h2", "h3"].map((tag) => Array.from(pane.querySelectorAll<HTMLElement>(tag)).find((el) => visible(el) && clean(el.textContent).length >= 3 && clean(el.textContent).length <= 150 && !notJobTitle(clean(el.textContent)))).find(Boolean);
  const title = clean(heading?.textContent);
  // The employer is a link to its Handshake page, or failing that the logo's alt text.
  const description = (pane.innerText || "").replace(/\n{3,}/g, "\n\n").trim().slice(0, 8000);
  if (!title) return null;
  return { title: title.slice(0, 200), company: employerIn(pane, heading ?? null, title).slice(0, 200), description };
}

const LINKEDIN_HOST = /(^|\.)linkedin\.com$/;

/** LinkedIn's id for a job: /jobs/view/<id>, or the search's open job in `currentJobId`. "" when there's none. */
export function linkedinJobId(href: string) {
  try {
    const url = new URL(href);
    if (!LINKEDIN_HOST.test(url.hostname)) return "";
    return url.pathname.match(/\/jobs\/view\/(?:[^/]*?-)?(\d{6,})/)?.[1] ?? url.searchParams.get("currentJobId") ?? "";
  } catch {
    return "";
  }
}

/**
 * LinkedIn shows the job you clicked beside the search results (/jobs/search/?currentJobId=<id>), or alone on
 * /jobs/view/<id>. Like Handshake, this reads the details pane: the job's heading, up to the largest box that
 * still isn't the results list, then the employer's link and the "About the job" text. LinkedIn renames its
 * classes often, so each part has its known names first and a plain-page fallback after.
 */
export function linkedinJob(where: { hostname: string; pathname: string; href: string } = window.location): { title: string; company: string; description: string } | null {
  if (!LINKEDIN_HOST.test(where.hostname) || !/^\/jobs\//.test(where.pathname) || !linkedinJobId(where.href)) return null;
  const first = (selectors: string[], root: ParentNode = document) => {
    for (const selector of selectors) {
      const found = Array.from(root.querySelectorAll<HTMLElement>(selector)).find((el) => visible(el) && clean(el.textContent).length >= 2);
      if (found) return found;
    }
    return null;
  };
  // The job's name: LinkedIn's known title boxes first. Otherwise the biggest heading or link to this job on the
  // page, outside the site's own menu bar ("0 notifications", "Messaging") and never a screen-reader-only line.
  const jobId = linkedinJobId(where.href);
  const readable = (el: HTMLElement) => {
    const text = clean(el.textContent);
    const rect = el.getBoundingClientRect();
    return visible(el) && rect.width >= 20 && rect.height >= 10 && text.length >= 3 && text.length <= 150 && !notJobTitle(text) && !NOT_JOB_NAME.test(text)
      && !el.closest("header, nav, footer, aside, [role='navigation'], [role='contentinfo'], [role='complementary'], #global-nav, .global-nav, [class*='global-nav'], [class*='footer'], [class*='alert'], [class*='upsell'], [class*='promo']");
  };
  const known = [
    ".job-details-jobs-unified-top-card__job-title h1", ".job-details-jobs-unified-top-card__job-title", ".jobs-unified-top-card__job-title",
    ".top-card-layout__title", ".jobs-details-top-card__job-title", "[data-testid*='job-title' i]",
  ].flatMap((selector) => Array.from(document.querySelectorAll<HTMLElement>(selector))).find(readable);
  const size = (el: HTMLElement) => parseFloat(window.getComputedStyle(el).fontSize) || 0;
  // Then a link to this very job (the pane's title links to itself), then the page's main heading. Other
  // headings ("Stay on top of new job openings", "Jobs you may be interested in") are LinkedIn's own boxes.
  const biggest = (selector: string) => Array.from(document.querySelectorAll<HTMLElement>(selector)).filter(readable).sort((a, b) => size(b) - size(a))[0];
  const heading = known ?? (jobId ? biggest(`a[href*='/jobs/view/${jobId}']`) : undefined) ?? biggest("h1");
  // The tab's own name: "Growth Intern | MealPal | LinkedIn".
  const fromTab = titleParts(document.title);
  const title = clean(heading?.textContent) || fromTab?.title || "";
  if (!title || notJobTitle(title)) return null;
  // The results list links to many jobs; the details pane to at most one.
  let pane: HTMLElement = heading ?? document.body;
  while (heading && pane.parentElement && pane.parentElement !== document.body && distinctJobLinks(pane.parentElement) <= 1) pane = pane.parentElement;
  const companyEl = first([
    ".job-details-jobs-unified-top-card__company-name a", ".job-details-jobs-unified-top-card__company-name", ".jobs-unified-top-card__company-name a",
    ".jobs-unified-top-card__company-name", ".topcard__org-name-link", ".top-card-layout__second-subline a", "a[href*='/company/']",
  ], pane);
  const company = [clean(companyEl?.textContent), fromTab && sameName(fromTab.title, title) ? fromTab.company : ""].map((name) => cleanCompanyName(name)).find((name) => goodEmployer(name, title))
    || employerIn(pane, heading ?? null, title);
  const about = first(["#job-details", ".jobs-description__content", ".jobs-description-content__text", ".jobs-box__html-content", ".show-more-less-html__markup", ".description__text"], pane)
    ?? first(["#job-details", ".jobs-description__content", ".show-more-less-html__markup", ".description__text"]);
  let text = about?.innerText ?? "";
  if (!text) {
    // No known box: the "About the job" heading's section.
    let box: HTMLElement | null = Array.from(pane.querySelectorAll<HTMLElement>("h2, h3, span, div")).find((el) => el.children.length <= 1 && /^about the job$/i.test(clean(el.textContent))) ?? null;
    while (box && box !== pane && (box.innerText || "").length < 300) box = box.parentElement;
    text = box?.innerText || pane.innerText || "";
  }
  const description = text.replace(/\n{3,}/g, "\n\n").trim().slice(0, 8000);
  return { title: title.slice(0, 200), company: company.slice(0, 200), description };
}

/**
 * The person LinkedIn shows under "Meet the hiring team" on a job the student opened: the first profile link
 * in that box, its name, and the line under it. Only what the page already shows; nothing is looked up.
 */
export function hiringTeam(): { name: string; title: string; profileUrl: string } | null {
  if (!/(^|\.)linkedin\.com$/.test(window.location.hostname)) return null;
  const heading = Array.from(document.querySelectorAll<HTMLElement>("h2, h3, span, div"))
    .find((el) => el.children.length <= 1 && /^(meet the hiring team|people you can reach out to)$/i.test(clean(el.textContent)) && visible(el));
  if (!heading) return null;
  let box: HTMLElement | null = heading;
  while (box && box !== document.body && !box.querySelector("a[href*='/in/']")) box = box.parentElement;
  const link = box?.querySelector<HTMLAnchorElement>("a[href*='/in/']");
  if (!box || !link) return null;
  const lines = (box.innerText || "").split("\n").map((line) => clean(line)).filter(Boolean);
  // "Jane Doe" then "• 2nd" or "3rd+", then the title, then "Job poster".
  const name = clean(link.innerText.split("\n")[0]).replace(/\s*•.*$/, "") || lines.find((line) => /^[A-Z][a-zA-Z'’.-]+( [A-Z][a-zA-Z'’.-]+)+$/.test(line)) || "";
  if (name.split(" ").length < 2 || name.length > 80) return null;
  const after = lines.slice(lines.findIndex((line) => line.startsWith(name)) + 1);
  const title = after.find((line) => !/^(•|\d|1st|2nd|3rd|job poster|message|connect|follow|meet the hiring team)/i.test(line) && line.length <= 160) ?? "";
  let profileUrl = "";
  try {
    const url = new URL(link.href);
    profileUrl = `${url.origin}${url.pathname}`;
  } catch {
    profileUrl = "";
  }
  return { name, title, profileUrl };
}

/**
 * The job as the page describes it for search engines (schema.org JobPosting): ZipRecruiter, Indeed and most
 * company career pages carry one. Its title, employer, and the posting's text.
 */
export function structuredJob(): { title: string; company: string; description: string } | null {
  return structuredJobs()[0] ?? null;
}

/** Every JobPosting on the page: a search page can carry one for each result. */
export function structuredJobs(): Array<{ title: string; company: string; description: string }> {
  const postings: Array<Record<string, unknown>> = [];
  const collect = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === "object") {
      const item = value as Record<string, unknown>;
      const type = item["@type"];
      if (type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"))) postings.push(item);
      if (item["@graph"]) collect(item["@graph"]);
    }
  };
  for (const script of Array.from(document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]'))) {
    try {
      collect(JSON.parse(script.textContent || ""));
    } catch {
      // Not valid JSON: skip it.
    }
  }
  return postings.map((job) => {
    const org = job.hiringOrganization as Record<string, unknown> | string | undefined;
    const company = cleanCompanyName(clean(typeof org === "string" ? org : String(org?.name ?? "")));
    const title = clean(String(job.title ?? ""));
    // The description is HTML; its text is what the student reads. Parsed inertly: nothing in it loads or runs.
    // Block ends become line breaks first, so paragraphs and list items don't run together.
    const html = String(job.description ?? "").replace(/<br\s*\/?>|<\/(p|li|div|h[1-6]|ul|ol|tr)>/gi, (tag) => `${tag}\n`);
    const text = new DOMParser().parseFromString(html, "text/html").body.textContent || "";
    const description = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, 8000);
    return { title: title.slice(0, 200), company: company.slice(0, 200), description };
  }).filter((job) => job.title);
}

// What job sites call themselves, which isn't the company's name.
const JOB_SITE_NAME = /^(workday|greenhouse|lever|ashby|icims|smartrecruiters|jobvite|taleo|workable|careers?|jobs?|job application|handshake|ziprecruiter|indeed|glassdoor|wellfound|dice|simplify|built ?in|monster|simplyhired|careerbuilder|wayup|idealist|usajobs|linkedin)$/i;
const BOARD_SUFFIX = /\s*[|·–—-]\s*(handshake|ziprecruiter|indeed(\.com)?|glassdoor|wellfound|dice|simplify|built ?in[a-z ]*|monster(\.com)?|simplyhired|careerbuilder|wayup|idealist|usajobs|linkedin)\s*$/i;

/**
 * The job and company from a page's title, the way job boards write them: "Growth Intern - MealPal - New York |
 * ZipRecruiter", "Growth Intern at MealPal", "MealPal hiring Growth Intern in New York | Glassdoor". Null when
 * the title doesn't say both.
 */
export function titleParts(text: string): { title: string; company: string } | null {
  const plainText = text.replace(/^\(\d+\)\s*/, "").replace(/\s+/g, " ").trim();
  if (!BOARD_SUFFIX.test(plainText) && !/ at | hiring /i.test(plainText)) return null;
  const bare = plainText.replace(BOARD_SUFFIX, "").replace(/\s+(job|jobs)$/i, "").trim();
  const hiring = bare.match(/^(.{2,80}?) (?:is )?hiring (?:for )?(?:an? )?(.{2,120}?)(?: (?:job )?in .{2,60})?$/i);
  if (hiring) return { title: hiring[2].trim(), company: hiring[1].trim() };
  const at = bare.match(/^(.{2,120}?)(?: job)? at (.{2,80}?)(?:\s*[-–|,·]\s*.{2,60})?$/i);
  if (at) return { title: at[1].trim(), company: at[2].trim() };
  const parts = bare.split(/\s+[|·–—-]\s+/).map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2 && !JOB_SITE_NAME.test(parts[1])) return { title: parts[0], company: parts[1] };
  return null;
}

/**
 * Workday pages call themselves "Workday". The company is the tenant: "nvidia.wd5.myworkdayjobs.com", or
 * "wd1.myworkdaysite.com/recruiting/nvidia/...". Words run together ("searchinfluence") until Unnepo reads the posting.
 */
export function workdayCompany(where: { hostname: string; pathname: string } = window.location) {
  const parts = where.pathname.split("/").filter(Boolean).filter((part) => !/^[a-z]{2}-[A-Z]{2}$/.test(part));
  const tenant = where.hostname.endsWith(".myworkdayjobs.com") ? where.hostname.split(".")[0] : parts[0] === "recruiting" ? parts[1] ?? "" : "";
  return tenant.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

/**
 * The last guess at the company, from the site's address: "mealpal" from mealpal.applytojob.com. Never on a job
 * board (app.joinhandshake.com is not a company called "app"), and never a generic first part.
 */
function hostCompany(host: string) {
  if (QUICK_BOARDS.test(host) || /(^|\.)linkedin\.com$/.test(host)) return "";
  const first = host.replace(/^(www|jobs|careers|boards|apply|job-boards|hire|recruiting)\./, "").split(".")[0];
  return NOT_COMPANY.test(first) ? "" : first;
}

/** What a job is called when the page doesn't say: the same words the server saves, so it shows as missing. */
const NO_TITLE = "Job title missing";

/** The employer an open apply pop-up names: Handshake's reads "Apply to Runway Services". "" when none does. */
function applyDialogCompany() {
  const dialog = openDialog();
  if (!dialog) return "";
  return Array.from(dialog.querySelectorAll<HTMLElement>(HEADING)).map((el) => companyFromApplyHeading(clean(el.textContent))).find(Boolean) ?? "";
}

/** What the page is: the job system, title and company, and the form's fields. */
export function scanPage(): Scan {
  const host = window.location.hostname;
  const ats = detectAts(host);
  const meta = (name: string) => document.querySelector<HTMLMetaElement>(`meta[property="${name}"], meta[name="${name}"]`)?.content ?? "";
  const heading = clean(document.querySelector("h1")?.textContent);
  // Greenhouse titles read "Job Application for Product Analyst at Acme".
  const greenhouseTitle = document.title.match(/^Job Application for (.+) at (.+)$/);
  // The job a job board shows (Handshake's details pane, or a posting's schema.org data).
  // On a job board, the job that's open, not the results listed beside it.
  const opened = QUICK_BOARDS.test(host) ? findOpenedJob() : null;
  const posting = handshakeJob() ?? linkedinJob() ?? opened ?? structuredJob();
  const poster = hiringTeam();
  // On a job board without posting data, the tab's title names the job and company better than the page does.
  const fromTitle = posting || !QUICK_BOARDS.test(host) ? null : titleParts(document.title) ?? titleParts(meta("og:title"));
  const named = (text: string | undefined) => (text && !notJobTitle(text) ? text : "");
  const firstHeading = Array.from(document.querySelectorAll("h1")).map((el) => clean(el.textContent)).find((text) => text && !notJobTitle(text)) ?? "";
  // The tab's own name is the last resort, without the site's name after it, and never a page name like "Jobs".
  // Nothing at all: the server's own "Job title missing", so the job is still caught and can be named later.
  const tabName = clean(document.title.split(/\s+[|–—-]\s+/)[0]);
  const title = (named(posting?.title) || greenhouseTitle?.[1] || named(fromTitle?.title) || named(heading) || firstHeading || named(meta("og:title")) || named(tabName) || NO_TITLE).slice(0, 200);
  const siteName = meta("og:site_name");
  const company = (posting?.company || greenhouseTitle?.[2] || fromTitle?.company || (ats === "workday" ? workdayCompany() : "") || applyDialogCompany()
    || (siteName && !JOB_SITE_NAME.test(siteName.trim()) ? siteName : "") || hostCompany(host)).slice(0, 200);
  const frame = document.querySelector<HTMLIFrameElement>("iframe#grnhse_iframe, iframe[src*='greenhouse.io/embed'], iframe[src*='jobs.lever.co'], iframe[src*='ashbyhq.com']");
  const captcha = Array.from(document.querySelectorAll("iframe[src*='hcaptcha'], iframe[title*='recaptcha challenge' i], iframe[src*='recaptcha/api2/bframe']")).some(visible);
  return {
    url: window.location.href,
    ...(opened ? { jobUrl: opened.url } : {}),
    title,
    company,
    ...(posting?.description ? { description: posting.description } : {}),
    ...(poster ? { poster } : {}),
    ats,
    useServerSchema: ats === "greenhouse" && Boolean(document.getElementById("first_name")),
    fields: scanFields(),
    embeddedForm: frame?.src ?? null,
    captcha,
    passwordBoxes: deepAll<HTMLInputElement>("input[type=password]").filter(visible).length,
    mentionsCv: /\bCV\b|curriculum vitae/.test(document.body.innerText || ""),
  };
}

// A link to one job: the board's job pages, or a results list's link that opens a job beside it.
const JOB_HREF = /\/(jobs?|job-search|stu\/jobs|viewjob|job-listing|job-detail|jobs\/view|rc\/clk|partner\/joblisting\.htm|c\/[^/]+\/job)(\/|\?|$|\.htm)|[?&](jk|vjk|jid|jl|joblistingid|currentjobid|jobid|job_id)=/i;
const APPLY_LABEL = /^(1-click apply|one-click apply|quick apply|easy apply|instant apply|apply|apply now|apply externally|apply on company (site|website)|apply on employer site|apply with (my )?(profile|resume)|i'?m interested)$/i;
// Section headings in a job's pane that aren't the job's name.
const NOT_JOB_NAME = /^(job details|about the job|meet the hiring team|people you can reach out to|about the company|job search faster with premium|show more|see more|about (the |this )?(company|role|position)|description|job description|overview|qualifications|requirements|benefits|similar jobs|more jobs|recommended( jobs)?|people also viewed|jobs you may like|salary|location|full job description|apply|share|report)$/i;
// Where boards put the employer: its own page, or an element named for it.
const COMPANY_LINK = "a[href*='/company/'], a[href*='/cmp/'], a[href*='/companies/'], a[href*='/e/'], a[href*='/emp/'], a[href*='/employers/'], a[href*='/organizations/'], a[href*='/Overview/'], a[href*='/c/']";
const COMPANY_NAMED = "[data-testid*='company' i], [data-testid*='employer' i], [data-test*='employer' i], [data-test*='company' i], [data-hook*='employer' i], [data-hook*='company' i], [class*='companyName' i], [class*='company-name' i], [class*='employer-name' i], [class*='employerName' i], [class*='employer_name' i], [itemprop='hiringOrganization']";

const distinctJobLinks = (root: Element) => {
  const seen = new Set<string>();
  const links = [...(root.matches("a[href]") ? [root as HTMLAnchorElement] : []), ...Array.from(root.querySelectorAll<HTMLAnchorElement>("a[href]"))];
  for (const a of links) {
    try {
      const url = new URL(a.href);
      if (JOB_HREF.test(`${url.pathname}${url.search}`)) seen.add(`${url.pathname}?${["jk", "vjk", "jid", "jl", "jobListingId", "currentJobId", "jobId"].map((key) => url.searchParams.get(key) ?? "").join("|")}`);
    } catch {
      // Not a link Unnepo can read.
    }
  }
  return seen.size;
};
const sameName = (a: string, b: string) => {
  const word = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const [x, y] = [word(a), word(b)];
  return Boolean(x && y) && (x === y || x.startsWith(y) || y.startsWith(x));
};

/**
 * One address per job, where the board has one: Indeed's search keeps the open job in `vjk`, its page in `jk`.
 * Otherwise the address as it is.
 */
export function jobLink(href: string) {
  try {
    const url = new URL(href);
    const indeedJob = /(^|\.)indeed\.com$/.test(url.hostname) ? url.searchParams.get("jk") ?? url.searchParams.get("vjk") : null;
    if (indeedJob) return `${url.origin}/viewjob?jk=${indeedJob}`;
    // LinkedIn's search keeps the open job in `currentJobId`; its own page is /jobs/view/<id>/.
    const linkedin = linkedinJobId(url.href);
    if (linkedin) return `https://www.linkedin.com/jobs/view/${linkedin}/`;
    return url.href;
  } catch {
    return href;
  }
}

// What's never an employer: a job board's name, a web address part, a button, or a section.
const NOT_COMPANY = /^(app|www|my|portal|localhost|students?|jobs?|careers?|employers?|companies|company|organization|job board|logo|image|avatar|profile|view profile|follow|following|message|save|saved|share|report|apply|more|see more|show more|about|overview|reviews?|salaries|benefits|united states|usa|us|remote|hybrid|on-?site)$/i;
const LOCATION = /^[A-Z][a-zA-Z .'-]+, ([A-Z]{2}|[A-Z][a-z]+)( \d{5})?$|^(remote|hybrid|on-?site)\b/i;

/** Whether this text can be the employer of a job named `title`. */
function goodEmployer(raw: string, title: string) {
  const text = raw.trim();
  return text.length >= 2 && text.length <= 80 && !sameName(text, title) && !notJobTitle(text) && !NOT_EMPLOYER.test(text)
    && !NOT_COMPANY.test(text) && !JOB_SITE_NAME.test(text) && !LOCATION.test(text) && !/^https?:|\.(com|org|io|net)$/i.test(text) && /[a-z]/i.test(text);
}
const firstPart = (text: string) => cleanCompanyName(cleanCompanyName(clean(text)).split(/\s+[·|•–—]\s+|\s-\s|\n/)[0]);

/**
 * The employer of the job in `pane`, from the most to the least telling: an element the board marks as the
 * employer, a link to the employer's page, the logo's name near the heading, an "About <Company>" section, the
 * short line just above or below the heading (Handshake and Glassdoor show it above, Indeed below), the tab's
 * title, then how the description names it ("MealPal is hiring", "Join MealPal"). "" when nothing says.
 */
function employerIn(pane: HTMLElement, heading: HTMLElement | null, title: string) {
  const pick = (values: Array<string | null | undefined>) => values.map((value) => firstPart(value ?? "")).find((value) => goodEmployer(value, title)) ?? "";
  const shown = (el: Element) => visible(el);
  const named = pick(Array.from(pane.querySelectorAll<HTMLElement>(COMPANY_NAMED)).filter(shown).map((el) => el.innerText || el.textContent || el.getAttribute("aria-label")));
  if (named) return named;
  const linked = pick(Array.from(pane.querySelectorAll<HTMLAnchorElement>(COMPANY_LINK)).filter(shown).map((a) => clean(a.innerText || a.textContent) || a.getAttribute("aria-label") || a.querySelector("img")?.alt || a.title));
  if (linked) return linked;
  // The logo, nearest the heading first.
  let near: HTMLElement | null = heading?.parentElement ?? null;
  for (let level = 0; near && level < 4 && near !== pane.parentElement; level += 1, near = near.parentElement) {
    const logo = pick(Array.from(near.querySelectorAll<HTMLElement>("img[alt], [role=img][aria-label], [aria-label*='logo' i]")).map((el) => (el as HTMLImageElement).alt || el.getAttribute("aria-label")));
    if (logo) return logo;
  }
  const about = pick(Array.from(pane.querySelectorAll<HTMLElement>("h2, h3, h4, strong")).map((el) => clean(el.textContent).match(/^about (?!the |this |us$|the$)(.{2,60})$/i)?.[1]));
  if (about) return about;
  // The lines next to the job's name in the pane.
  const lines = (pane.innerText || "").split("\n").map((line) => clean(line)).filter(Boolean);
  const at = lines.findIndex((line) => sameName(line, title));
  if (at >= 0) {
    const beside = pick([lines[at - 1], lines[at + 1], lines[at - 2], lines[at + 2]]);
    if (beside) return beside;
  }
  const fromTitle = titleParts(document.title)?.company;
  if (fromTitle && goodEmployer(fromTitle, title)) return fromTitle;
  const text = (pane.innerText || "").slice(0, 6000);
  const said = text.match(/\b([A-Z][\w&.'’-]*(?: [A-Z][\w&.'’-]*){0,3}) (?:is hiring|is looking for|is seeking|seeks)\b/)?.[1]
    ?? text.match(/\b(?:Join|At|About) ([A-Z][\w&.'’-]*(?: [A-Z][\w&.'’-]*){0,3})(?:,| we\b| is\b|!|\.)/)?.[1];
  return said && goodEmployer(said, title) ? said : "";
}

// Words that make a line a place, a pay or a date, not an employer.
const NOT_EMPLOYER = /^(remote|hybrid|on-?site|in person|full[- ]time|part[- ]time|internship|contract|\$|\d|posted|new|today|easy apply|apply)/i;
/** How Unnepo read the job: shown in the panel, so a wrong read can be traced. */
export type OpenedJob = { title: string; company: string; description: string; url: string; from: "details pane" | "posting data" | "selected result" | "page title" | "page" };

/**
 * The job the student has open, not the ones listed beside it. Job boards show a results list next to the
 * open job (Indeed, Glassdoor, Handshake, LinkedIn-style searches), so the page's first heading or first
 * posting can be any of them. From the Apply button (the one pressed, when there is one), up to the largest
 * box that still holds at most one job link: that's the job's pane. Its top heading is the job, the employer
 * link or label in it the company. Posting data counts when it names that same job, or when the page has only one.
 */
export function openedJob(pressed?: Element | null): OpenedJob {
  const found = findOpenedJob(pressed);
  if (found) return found;
  const address = jobLink(window.location.href);
  const fromTitle = titleParts(document.title);
  if (fromTitle) return { ...fromTitle, description: "", url: address, from: "page title" };
  const page = scanPage();
  return { title: page.title, company: page.company, description: page.description ?? "", url: address, from: "page" };
}

/** The open job from its pane, posting data or the selected result; null when the page doesn't show which. */
function findOpenedJob(given?: Element | null): OpenedJob | null {
  // The Apply button the student pressed in the last few minutes, marked by the page watcher.
  const marked = document.querySelector<HTMLElement>("[data-unnepo-pressed]");
  const pressed = given ?? (marked && visible(marked) && Date.now() - Number(marked.dataset.unnepoPressed) < 5 * 60_000 ? marked : null);
  const handshake = handshakeJob();
  const address = jobLink(window.location.href);
  if (handshake?.title) return { ...handshake, url: address, from: "details pane" };
  const linkedin = linkedinJob();
  if (linkedin?.title) return { ...linkedin, url: address, from: "details pane" };
  const postings = structuredJobs();
  const buttons = pressed ? [pressed as HTMLElement] : Array.from(document.querySelectorAll<HTMLElement>("button, a, [role=button], input[type=submit]"))
    .filter((el) => visible(el) && APPLY_LABEL.test(clean(el.textContent || (el as HTMLInputElement).value || el.getAttribute("aria-label"))));
  // The pane around each Apply button; the one with the most to read is the open job (a results card's
  // Apply sits in a small box of its own).
  const panes = buttons.map((button) => {
    let pane: HTMLElement = button;
    while (pane.parentElement && pane.parentElement !== document.body && distinctJobLinks(pane.parentElement) <= 1) pane = pane.parentElement;
    return pane;
  });
  const pane = panes.sort((a, b) => (b.innerText || "").length - (a.innerText || "").length)[0];
  // A pane with little in it counts only around the button the student pressed.
  if (pane && (pressed || (pane.innerText || "").length > 200)) {
    const heading = ["h1", "h2", "h3"].map((tag) => Array.from(pane.querySelectorAll<HTMLElement>(tag))
      .find((el) => visible(el) && clean(el.textContent).length >= 3 && clean(el.textContent).length <= 150 && !NOT_JOB_NAME.test(clean(el.textContent)) && !notJobTitle(clean(el.textContent)))).find(Boolean);
    const title = clean(heading?.textContent);
    if (title) {
      const matching = postings.find((posting) => sameName(posting.title, title));
      const company = (matching?.company && goodEmployer(matching.company, title) ? matching.company : "") || employerIn(pane, heading ?? null, title);
      // The job's own link in the pane, when it names this job: a lasting address on a search page.
      const own = Array.from(pane.querySelectorAll<HTMLAnchorElement>("a[href]")).find((a) => JOB_HREF.test(a.href) && sameName(clean(a.textContent), title));
      const description = matching?.description || (pane.innerText || "").replace(/\n{3,}/g, "\n\n").trim().slice(0, 8000);
      return { title: title.slice(0, 200), company: company.slice(0, 200), description, url: own ? jobLink(own.href) : address, from: matching ? "posting data" : "details pane" };
    }
  }
  // Posting data, when the page carries just the one job.
  if (postings.length === 1 && distinctJobLinks(document.body) < 3) return { ...postings[0], url: address, from: "posting data" };
  // The result the board marks as selected, when it says which.
  const selected = Array.from(document.querySelectorAll<HTMLElement>("[aria-selected='true'], [aria-current='true'], [aria-current='page'], [class*='selected' i], [class*='active' i]"))
    .find((el) => visible(el) && distinctJobLinks(el) === 1 && (el.innerText || "").length < 600);
  if (selected) {
    const lines = (selected.innerText || "").split("\n").map((line) => clean(line)).filter((line) => line.length >= 2 && !notJobTitle(line) && !/^(new|applied|easy apply|promoted|sponsored|urgently hiring|\d+ ?[dh]|\d+ days? ago|today|just posted)$/i.test(line));
    const link = selected.matches("a[href]") ? selected as HTMLAnchorElement : selected.querySelector<HTMLAnchorElement>("a[href]");
    if (lines.length >= 2) return { title: lines[0].slice(0, 200), company: lines[1].slice(0, 200), description: "", url: link && JOB_HREF.test(link.href) ? jobLink(link.href) : address, from: "selected result" };
  }
  return null;
}
