/**
 * Demo mode, for admins recording or showing Unnepo: personal info is blurred everywhere the extension can see it
 * (the side panel, Unnepo's cards on job pages, the job page's own form, and unnepo.com/home). It's switched on
 * from the admin rows under Me and kept in chrome.storage.local, so every surface follows the same switch.
 *
 * What gets blurred:
 *   - anything showing the admin's own name or email (the "terms" the panel saves with the switch),
 *   - any email address or phone number, and links to LinkedIn, GitHub and personal sites,
 *   - form fields that hold personal details (name, email, phone, address, birthday, demographic questions),
 *   - elements a surface marks as personal: `[data-pii]` plus the selectors it passes in.
 * Only the page's look changes: nothing is rewritten, so React pages and filled forms keep working.
 */

export const DEMO_KEY = "demoMode";
export type DemoMode = { on: boolean; terms: string[] };

const ATTR = "data-unnepo-blur";
const STYLE = `[${ATTR}]{filter:blur(7px)!important;user-select:none!important}[${ATTR}]::placeholder{opacity:0!important}`;
const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/;
const OUR_EMAIL = /@(www\.)?unnepo\.com\b/i;
const PHONE = /(\+?\d{1,2}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/;
const PROFILE_LINK = /(linkedin\.com\/in\/|github\.com\/[\w-]+|https?:\/\/(?!(www\.)?unnepo\.com)[\w-]+\.(me|dev|io|page|site)\b)/i;
// A field about the person, by its name, id, autocomplete, label or placeholder.
const PERSONAL_FIELD = /\b(first|last|middle|full|legal|preferred|given|family|sur|nick)[\s_-]?name|\bname\b|e-?mail|phone|mobile|\btel\b|address|street|\bcity\b|\bstate\b|\bzip|postal|county|birth|\bdob\b|\bssn\b|social security|linkedin|github|portfolio|website|\bgender|\brace\b|ethnic|hispanic|latin|veteran|disabilit|pronoun|sexual orientation/i;
const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "PATH"]);

/** The admin's name and email, split into the words worth hiding on their own. */
export function demoTerms(name: string, email: string) {
  const terms = new Set<string>();
  const add = (value: string) => { const clean = value.trim(); if (clean.length >= 3) terms.add(clean.toLowerCase()); };
  add(name);
  for (const part of name.split(/\s+/)) add(part);
  add(email);
  add(email.split("@")[0] ?? "");
  return [...terms];
}

type Masker = { update(mode: DemoMode): void; addRoot(root: ShadowRoot): void };

/**
 * Starts the masker on this document (and any shadow roots handed to it). It stays idle until `update` turns it on.
 * `selectors` are always blurred while on, for things like other people's names that no pattern can spot.
 */
export function startDemoMask(selectors: string[] = [], ownDocument = true): Masker {
  const roots = new Set<Document | ShadowRoot>([document]);
  const added = new WeakSet<ShadowRoot>();
  const styled = new WeakSet<Document | ShadowRoot>();
  let blurred = new Set<Element>();
  let mode: DemoMode = { on: false, terms: [] };
  let termPattern: RegExp | null = null;
  let queued = false;
  // On a job page the selectors are only for Unnepo's own cards, never the site's elements.
  const mine = ["[data-pii]", ...selectors].join(",");
  const always = (root: Document | ShadowRoot) => (ownDocument || root instanceof ShadowRoot && added.has(root) ? mine : "[data-pii]");

  const style = (root: Document | ShadowRoot) => {
    if (styled.has(root)) return;
    const tag = document.createElement("style");
    tag.setAttribute("data-unnepo-demo", "");
    tag.textContent = STYLE;
    (root instanceof Document ? root.head ?? root.documentElement : root).appendChild(tag);
    styled.add(root);
  };

  const personal = (text: string) => {
    if (!text) return false;
    if (termPattern?.test(text)) return true;
    const email = text.match(EMAIL);
    if (email && !OUR_EMAIL.test(email[0])) return true;
    return PHONE.test(text) || PROFILE_LINK.test(text);
  };

  const fieldIsPersonal = (el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) => {
    if (el instanceof HTMLInputElement && ["hidden", "submit", "button", "checkbox", "radio", "file", "range", "color", "password", "search"].includes(el.type)) return false;
    const value = el instanceof HTMLSelectElement ? el.selectedOptions[0]?.textContent ?? "" : el.value;
    if (personal(value)) return true;
    if (el instanceof HTMLInputElement && (el.type === "email" || el.type === "tel")) return true;
    const labels = "labels" in el && el.labels ? Array.from(el.labels).map((label) => label.textContent ?? "").join(" ") : "";
    const hints = [el.name, el.id, el.getAttribute("autocomplete"), el.getAttribute("aria-label"), el.getAttribute("placeholder"), labels].filter(Boolean).join(" ");
    return PERSONAL_FIELD.test(hints) && (el instanceof HTMLSelectElement ? el.selectedIndex > 0 : Boolean(value.trim()));
  };

  const collect = (root: Document | ShadowRoot, into: Set<Element>) => {
    root.querySelectorAll(always(root)).forEach((el) => into.add(el));
    root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select").forEach((el) => { if (fieldIsPersonal(el)) into.add(el); });
    root.querySelectorAll<HTMLAnchorElement>("a[href^='mailto:'], a[href*='linkedin.com/in/']").forEach((el) => { if (!OUR_EMAIL.test(el.href)) into.add(el); });
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || SKIP.has(parent.tagName.toUpperCase()) || parent.closest("style, script")) continue;
      const text = node.nodeValue ?? "";
      if (text.trim().length < 3 || !personal(text)) continue;
      // The text's own element is blurred whole: nothing on the page is rewritten.
      into.add(parent);
    }
    // Open shadow roots on the page (the site's own components).
    root.querySelectorAll("*").forEach((el) => { if (el.shadowRoot && !roots.has(el.shadowRoot)) collect(el.shadowRoot, into); });
  };

  const scan = () => {
    queued = false;
    const next = new Set<Element>();
    if (mode.on) for (const root of roots) { if (root instanceof ShadowRoot && !root.host.isConnected) { roots.delete(root); continue; } style(root); collect(root, next); }
    for (const el of blurred) if (!next.has(el)) el.removeAttribute(ATTR);
    for (const el of next) if (!el.hasAttribute(ATTR)) el.setAttribute(ATTR, "");
    blurred = next;
  };
  const soon = () => { if (!queued && mode.on) { queued = true; requestAnimationFrame(scan); } };

  const observer = new MutationObserver((records) => {
    // Our own attribute changing isn't news.
    if (records.every((record) => record.type === "attributes" && record.attributeName === ATTR)) return;
    soon();
  });
  const watch = (root: Document | ShadowRoot) => observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["value", "class", "data-pii"] });
  watch(document);
  // Typing and autofill change values without touching the DOM.
  const onInput = () => soon();
  document.addEventListener("input", onInput, true);
  document.addEventListener("change", onInput, true);
  // Some sites set values from script with no event at all.
  setInterval(soon, 1500);

  return {
    update(next) {
      mode = { on: Boolean(next.on), terms: next.terms ?? [] };
      const words = mode.terms.filter((term) => term.length >= 3).map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      termPattern = words.length ? new RegExp(`(^|[^\\p{L}])(${words.join("|")})($|[^\\p{L}])`, "iu") : null;
      scan();
    },
    addRoot(root) {
      if (roots.has(root)) return;
      roots.add(root);
      added.add(root);
      watch(root);
      root.addEventListener("input", onInput, true);
      soon();
    },
  };
}

/**
 * For content scripts: starts the masker once per page, follows the stored switch, and catches every shadow root the
 * extension's own cards make (most are closed, so only a hook on attachShadow can reach them). Safe to call from
 * every script that runs on the page.
 */
export function demoMaskForPage() {
  const flag = "__unnepoDemoMask";
  const holder = window as unknown as Record<string, Masker | undefined>;
  if (holder[flag]) return holder[flag]!;
  // People's names and faces in the reach-out card.
  const masker = startDemoMask([".who b", ".av"], false);
  holder[flag] = masker;
  const attach = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function patched(this: Element, init: ShadowRootInit) {
    const root = attach.call(this, init);
    masker.addRoot(root);
    return root;
  };
  const apply = (value: unknown) => masker.update((value as DemoMode | undefined) ?? { on: false, terms: [] });
  try {
    void chrome.storage.local.get(DEMO_KEY).then((stored) => apply(stored[DEMO_KEY]));
    chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && DEMO_KEY in changes) apply(changes[DEMO_KEY]!.newValue); });
  } catch {
    // The extension was reloaded since this page opened.
  }
  return masker;
}
