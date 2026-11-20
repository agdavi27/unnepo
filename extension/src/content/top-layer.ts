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

/** Adds a popup's host to the page so it shows above everything. Its :host style should start with `all: initial`. */
export function mountAbove(host: HTMLElement) {
  (topModal() ?? document.documentElement).append(host);
  if (typeof host.showPopover !== "function") return;
  try {
    host.popover = "manual";
    host.showPopover();
  } catch {
    // Already in the top layer, or the page won't allow it: the z-index still applies.
  }
}

/** True when something of the page's is drawn over the middle of a full-screen popup, so the student can't see it. */
export function coveredUp(host: HTMLElement) {
  const hit = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
  return Boolean(hit && hit !== host && !host.contains(hit));
}
