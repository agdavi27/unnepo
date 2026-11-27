/**
 * A "Fill with unnepo" chip beside the password box on a job site's sign-in or create-account form. Pressed,
 * it puts the student's Unnepo job-site password in every empty password box of that form (the password and
 * its "confirm" box). The password comes from the extension only when the chip is pressed; the page never
 * reads it any other way, and nothing is sent anywhere.
 */

import { typeInto } from "./dom";
import { pinFont } from "./top-layer";

const MARK = "data-unnepo-password";

const STYLE = `
  :host { all: initial; display: inline-flex; vertical-align: middle; margin: 2px 0 2px 10px; font: 600 12px/1 system-ui, -apple-system, sans-serif; }
  button { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; padding: 5px 9px; border-radius: 7px; background: #fff; color: #111114; border: 1px solid #3D8BFF; box-shadow: 2px 2px 0 #3D8BFF; white-space: nowrap; }
  button:hover { background: #F5F9FF; }
  button:focus-visible { outline: 2px solid #3D8BFF; outline-offset: 2px; }
  button[disabled] { cursor: default; opacity: .7; }
  .ok { border-color: #22C55E; box-shadow: 2px 2px 0 #22C55E; background: #F0FDF4; color: #15803D; }
  .bad { border-color: #EF4444; box-shadow: 2px 2px 0 #EF4444; color: #B91C1C; }
`;

const shown = (el: HTMLElement) => {
  const rect = el.getBoundingClientRect();
  return rect.width > 20 && rect.height > 8 && getComputedStyle(el).visibility !== "hidden";
};

/** The open password boxes of the form a box is in (the whole page when it has no form). */
function boxesWith(input: HTMLInputElement) {
  const scope: ParentNode = input.form ?? input.closest("[role=dialog], [role=form], section, main") ?? document;
  return Array.from(scope.querySelectorAll<HTMLInputElement>("input[type=password]")).filter((box) => !box.disabled && !box.readOnly && shown(box));
}

function addChip(input: HTMLInputElement) {
  const group = boxesWith(input);
  for (const box of group) box.setAttribute(MARK, "");
  const host = document.createElement("span");
  host.setAttribute(MARK, "chip");
  pinFont(host, "600 12px/1 system-ui, -apple-system, sans-serif");
  const root = host.attachShadow({ mode: "closed" });
  const draw = (state: "ready" | "busy" | "done" | "off") => {
    const words = { ready: "🔑 Fill with unnepo", busy: "Filling…", done: "✓ Password in", off: "Couldn't get it: try again" }[state];
    const title = state === "done" ? "Your Unnepo job-site password is in" : "Put your Unnepo job-site password in this form";
    root.innerHTML = `<style>${STYLE}</style><button type="button" class="${state === "done" ? "ok" : state === "off" ? "bad" : ""}" title="${title}" aria-label="${title}" ${state === "busy" ? "disabled" : ""}>${words}</button>`;
  };
  draw(group.every((box) => box.value) ? "done" : "ready");
  root.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const boxes = boxesWith(input);
    draw("busy");
    const reply = (await chrome.runtime.sendMessage({ type: "password-page-fill", creating: boxes.length > 1 }).catch(() => null)) as { ok?: boolean; password?: string } | null;
    if (!reply?.ok || !reply.password) return draw("off");
    // Boxes the student already typed in are left alone, unless every box has something (then it's a redo).
    const empty = boxes.filter((box) => !box.value);
    for (const box of empty.length ? empty : boxes) typeInto(box, reply.password);
    draw("done");
  });
  host.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); });
  const label = Array.from(input.labels ?? []).find(shown);
  if (label) label.append(host);
  else input.insertAdjacentElement("afterend", host);
}

/**
 * Watches a job page for password boxes (sign-in and account forms often appear after a click) and puts one
 * chip on the first box of each form.
 */
export function watchPasswordBoxes(isJobPage: () => boolean) {
  const scan = () => {
    const open = Array.from(document.querySelectorAll<HTMLInputElement>(`input[type=password]:not([${MARK}])`)).filter((box) => !box.disabled && !box.readOnly && shown(box));
    if (!open.length || !isJobPage()) return;
    for (const box of open) if (!box.hasAttribute(MARK)) addChip(box);
  };
  let pending = 0;
  const observer = new MutationObserver(() => {
    if (!pending) pending = window.setTimeout(() => { pending = 0; scan(); }, 700);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  scan();
}
