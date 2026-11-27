/**
 * Putting our popups above the page's own windows. A site's modal <dialog> (LinkedIn's Easy Apply, for one) sits in
 * the browser's top layer, above any z-index, and makes the rest of the page inert. So a popup goes inside the
 * topmost open modal dialog, where it can still be clicked, and is shown as a popover, which puts it in the top
 * layer above that dialog.
 */

/** The modal dialog on top, if the page has one open. */
function topModal(): HTMLDialogElement | null {
  let modals: HTMLDialogElement[] = [];
  try {
    modals = Array.from(document.querySelectorAll<HTMLDialogElement>("dialog:modal"));
  } catch {
    // :modal isn't supported: fall back to any open dialog.
    modals = Array.from(document.querySelectorAll<HTMLDialogElement>("dialog[open]"));
  }
  return modals.at(-1) ?? null;
}

/** True when something of the page's is drawn over the middle of a full-screen popup, so the student can't see it. */
export function coveredUp(host: HTMLElement) {
  const hit = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
  return Boolean(hit && hit !== host && !host.contains(hit));
}

/**
 * For Unnepo's pieces that stay on the page (the fill bar at the bottom, its box highlights, the "Save to unnepo"
 * chip, the applied card): kept in front of everything, on any site, for as long as they're shown. A modal the site
 * opens later (LinkedIn's Easy Apply, a careers site's dialog) would cover them and make them unclickable, so each is
 * moved into the topmost open modal and shown again on top whenever the site opens or closes one, and moved back out
 * when it closes. Taking one off the page is the owner's `host.remove()`, as before.
 */
const kept = new Set<HTMLElement>();
let watching = false;
let pending = 0;

/** Shown again as a popover: the newest thing in the top layer, so above whatever the site just opened. */
function raise(host: HTMLElement) {
  if (typeof host.showPopover !== "function") return;
  try {
    if (host.matches(":popover-open")) host.hidePopover();
    host.popover = "manual";
    host.showPopover();
  } catch {
    // The page won't allow it: the z-index still applies.
  }
}

/** Puts each kept piece where it can be seen and clicked. `again`: the site's windows changed, so all go back on top. */
function settle(again: boolean) {
  pending = 0;
  const parent = topModal() ?? document.documentElement;
  for (const host of kept) {
    if (host.parentNode !== parent) {
      // Moving it (out of a closed modal, or back after the site removed the modal with it inside) ends its popover.
      parent.append(host);
      raise(host);
    } else if (again) raise(host);
  }
}

const soon = (again: boolean) => {
  if (again) { window.clearTimeout(pending); pending = window.setTimeout(() => settle(true), 30); return; }
  if (!pending) pending = window.setTimeout(() => settle(false), 30);
};

const isOurs = (node: Node) => node instanceof HTMLElement && kept.has(node);
/** A site's window: a dialog, or anything shown as a popover. */
const isWindow = (node: Node) => node instanceof HTMLElement && (node instanceof HTMLDialogElement || node.hasAttribute("popover") || Boolean(node.querySelector?.("dialog, [popover]")));

function watch() {
  if (watching) return;
  watching = true;
  new MutationObserver((records) => {
    let again = false;
    let moved = false;
    for (const record of records) {
      if (isOurs(record.target)) continue;
      if (record.type === "attributes") { again = true; continue; }
      if (Array.from(record.addedNodes).some((node) => !isOurs(node) && isWindow(node))) again = true;
      if (Array.from(record.removedNodes).some((node) => isOurs(node) || isWindow(node))) moved = true;
    }
    if (again) soon(true);
    else if (moved) soon(false);
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["open"] });
  // A dialog opened with showModal() or a popover shown from script (no attribute changes for those).
  for (const type of ["toggle", "beforetoggle"]) document.addEventListener(type, (event) => { if (!isOurs(event.target as Node)) soon(true); }, true);
  // Some sites build their windows in ways nothing above sees: a slow check catches those.
  window.setInterval(() => {
    const parent = topModal() ?? document.documentElement;
    if ([...kept].some((host) => host.parentNode !== parent)) soon(true);
  }, 1000);
}

const SYSTEM = `system-ui, -apple-system, "Segoe UI", sans-serif`;

/**
 * Sets a piece's font on its host element itself. Some sites reset every div's font (LinkedIn: \`font: inherit\`),
 * and a page's own rules beat a shadow root's \`:host\` style, so the piece came out in 10px Times. Its own inline
 * style beats those rules. `font` is the CSS font shorthand the piece's \`:host\` asks for.
 */
export function pinFont(host: HTMLElement, font = `13px/1.4 ${SYSTEM}`) {
  host.style.setProperty("font", font);
}

/** Adds `host` to the page and keeps it in front of everything until its `remove()` is called. `font`: see pinFont. */
export function keepOnTop(host: HTMLElement, font?: string) {
  kept.add(host);
  pinFont(host, font);
  // A popover gets the browser's default box (a border, padding, a white background) until its own style says
  // otherwise, and a piece with nothing to show has no style at all: an empty, invisible box instead.
  for (const [name, value] of [["border", "0"], ["padding", "0"], ["background", "transparent"]]) host.style.setProperty(name, value);
  const remove = host.remove.bind(host);
  host.remove = () => { kept.delete(host); remove(); };
  (topModal() ?? document.documentElement).append(host);
  raise(host);
  watch();
}
