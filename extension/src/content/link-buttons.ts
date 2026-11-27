/**
 * One tap for the student's links on an application form: beside "LinkedIn Profile URL", "Portfolio", "GitHub" or
 * "Personal website", a small chip shows the link Unnepo has (linkedin.com/in/drew) and puts it in the box when
 * pressed. A box that already has it shows ✓. Links the student hasn't added aren't offered. Nothing on the page
 * is read or sent until a chip is pressed; the links come from the student's Unnepo profile.
 */

import { pinFont } from "./top-layer";

type Kind = "linkedin" | "github" | "portfolio";
type Links = Partial<Record<Kind, string>>;

const MARK = "data-unnepo-link";
const KINDS: Array<[Kind, RegExp]> = [
  ["linkedin", /linked ?in/i],
  ["github", /git ?hub/i],
  ["portfolio", /portfolio|personal (web ?site|site|url|page)|\bweb ?site\b|your site|blog/i],
];
/** Website boxes about someone else (the company's site, a referrer's), or not a link at all. */
const NOT_OURS = /company|employer|organi[sz]ation|referr|how did you hear|source|school/i;

const escape = (text: string) => text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const short = (url: string) => url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
const full = (url: string) => (/^https?:\/\//i.test(url) ? url : `https://${url.replace(/^\/+/, "")}`);
const same = (a: string, b: string) => short(a).toLowerCase() === short(b).toLowerCase();

/** What the box asks for: its labels and aria text first, then the short text just around it. */
function kindOf(input: HTMLInputElement): { kind: Kind; label: HTMLElement | null } | null {
  const labels = Array.from(input.labels ?? []);
  const own = [input.getAttribute("aria-label"), input.placeholder, ...labels.map((label) => label.textContent)].filter(Boolean).join(" ");
  const pick = (text: string) => (NOT_OURS.test(text) ? null : KINDS.find(([, test]) => test.test(text))?.[0] ?? null);
  const shownLabel = labels.find((label) => label.getBoundingClientRect().width > 2) ?? null;
  if (own.trim()) {
    const kind = pick(own);
    if (kind) return { kind, label: shownLabel };
    if (labels.length) return null;
  }
  // No label tag: the nearest wrapper's short text ("LinkedIn Profile URL" in a div above the box).
  let box: HTMLElement | null = input.parentElement;
  for (let depth = 0; box && depth < 4; depth++, box = box.parentElement) {
    const text = (box.innerText || "").replace(/\s+/g, " ").trim();
    if (text.length > 120) break;
    if (box.querySelectorAll("input:not([type=hidden]), textarea, select").length > 1) break;
    const kind = pick(text);
    // The chip goes by the words that named it, as it does beside a real label.
    if (kind) return { kind, label: Array.from(box.querySelectorAll<HTMLElement>("*")).find((el) => !el.contains(input) && !el.querySelector("input, textarea, select") && pick(el.textContent || "") === kind && el.getBoundingClientRect().width > 2) ?? null };
  }
  const kind = pick(`${input.name} ${input.id}`);
  return kind ? { kind, label: null } : null;
}

/** Types the link in the way the site's own code expects (React and the like watch the value setter). */
function put(input: HTMLInputElement, value: string) {
  input.focus();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  input.dispatchEvent(new Event("blur", { bubbles: true, composed: true }));
}

const STYLE = `
  :host { all: initial; display: inline-flex; vertical-align: middle; margin: 2px 0 2px 10px; font: 600 12px/1 system-ui, -apple-system, sans-serif; }
  button { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; padding: 5px 9px; border-radius: 7px; background: #fff; color: #111114; border: 1px solid #3D8BFF; box-shadow: 2px 2px 0 #3D8BFF; white-space: nowrap; max-width: 260px; }
  button:hover { background: #F5F9FF; }
  button:focus-visible { outline: 2px solid #3D8BFF; outline-offset: 2px; }
  .url { overflow: hidden; text-overflow: ellipsis; font-weight: 500; }
  .in { display: inline-grid; place-items: center; width: 15px; height: 15px; border-radius: 3px; background: #0A66C2; color: #fff; font: 700 9px system-ui, sans-serif; flex: none; }
  .gh { display: inline-grid; place-items: center; width: 15px; height: 15px; border-radius: 50%; background: #111114; color: #fff; font: 700 8px system-ui, sans-serif; flex: none; }
  .go { color: #3D8BFF; flex: none; }
  .ok { border-color: #22C55E; box-shadow: 2px 2px 0 #22C55E; background: #F0FDF4; color: #15803D; }
`;
const ICON: Record<Kind, string> = { linkedin: `<span class="in" aria-hidden="true">in</span>`, github: `<span class="gh" aria-hidden="true">gh</span>`, portfolio: `<span class="go" aria-hidden="true">↗</span>` };
const NAME: Record<Kind, string> = { linkedin: "LinkedIn", github: "GitHub", portfolio: "portfolio" };

function addChip(input: HTMLInputElement, kind: Kind, link: string, label: HTMLElement | null) {
  input.setAttribute(MARK, "");
  const host = document.createElement("span");
  host.setAttribute(MARK, "chip");
  pinFont(host, "600 12px/1 system-ui, -apple-system, sans-serif");
  const root = host.attachShadow({ mode: "closed" });
  const draw = () => {
    const done = same(input.value, link);
    root.innerHTML = `<style>${STYLE}</style><button type="button" class="${done ? "ok" : ""}" title="${done ? `Your ${NAME[kind]} is in` : `Put your ${NAME[kind]} in this box`}" aria-label="${done ? `Your ${NAME[kind]} is in` : `Fill in your ${NAME[kind]}: ${escape(short(link))}`}">${done ? "✓ Filled" : `${ICON[kind]}<span class="url">${escape(short(link))}</span>`}</button>`;
  };
  draw();
  root.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    put(input, full(link));
    draw();
  });
  // Inside a <label>, a click would also focus the box: stopped, since the chip does that itself.
  host.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); });
  input.addEventListener("input", draw);
  if (label) label.append(host);
  else input.insertAdjacentElement("afterend", host);
}

/** The link boxes on the page that don't have a chip yet. */
function linkBoxes() {
  const found: Array<{ input: HTMLInputElement; kind: Kind; label: HTMLElement | null }> = [];
  for (const input of Array.from(document.querySelectorAll<HTMLInputElement>(`input:not([${MARK}]):is([type=text], [type=url], :not([type]))`))) {
    if (input.disabled || input.readOnly || input.getBoundingClientRect().width < 40) continue;
    const kind = kindOf(input);
    if (kind) found.push({ input, ...kind });
  }
  return found;
}

/**
 * Watches the page (forms appear step by step) for link boxes. Unnepo is asked for the student's links only once
 * a page has one, so ordinary pages never cause a request.
 */
export function watchLinkBoxes() {
  let links: Promise<Links | null> | null = null;
  const load = () => (links ??= (chrome.runtime.sendMessage({ type: "links-page-state" }) as Promise<{ ok?: boolean; links?: Links } | undefined>)
    .then((reply) => (reply?.ok && reply.links ? reply.links : null), () => null));
  const scan = async () => {
    const boxes = linkBoxes();
    if (!boxes.length) return;
    const have = await load();
    if (!have) return;
    for (const box of boxes) {
      const link = have[box.kind]?.trim();
      if (link && !box.input.hasAttribute(MARK)) addChip(box.input, box.kind, link, box.label);
    }
  };
  let pending = 0;
  const observer = new MutationObserver(() => {
    if (!pending) pending = window.setTimeout(() => { pending = 0; void scan(); }, 700);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  void scan();
}
