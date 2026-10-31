/**
 * Questions the student answered or changed by hand on this page, so pressing Fill again leaves them alone.
 * Only the student's own typing and clicks count: the browser marks those trusted, and Unnepo's filling
 * never is. The mark is kept on the page itself, so the launcher (on the page from the start) and the
 * filler (added on the first Fill) see the same marks.
 */

const EDITED = "data-unnepo-edited";

declare global {
  interface Window {
    __unnepoEdits?: boolean;
  }
}

// The dropdown the student last opened: its choices often open in a list elsewhere on the page.
let opened: Element | null = null;

const fieldOf = (el: Element) => el.closest("[data-unnepo-id]") ?? el;

function touch(el: Element) {
  el.setAttribute(EDITED, "");
  fieldOf(el).setAttribute(EDITED, "");
  // A radio or checkbox answers for its whole group.
  if (el instanceof HTMLInputElement && (el.type === "radio" || el.type === "checkbox") && el.name) {
    const root = el.getRootNode() as Document | ShadowRoot;
    root.querySelectorAll(`input[name="${CSS.escape(el.name)}"]`).forEach((item) => item.setAttribute(EDITED, ""));
  }
}

function targetOf(event: Event) {
  const target = event.composedPath()[0];
  return target instanceof Element ? target : null;
}

export function watchEdits() {
  if (window.__unnepoEdits) return;
  window.__unnepoEdits = true;
  const onEdit = (event: Event) => {
    const target = targetOf(event);
    if (event.isTrusted && target?.matches("input, select, textarea, [contenteditable]")) touch(target);
  };
  document.addEventListener("input", onEdit, true);
  document.addEventListener("change", onEdit, true);
  document.addEventListener("pointerdown", (event) => {
    const target = targetOf(event);
    if (!event.isTrusted || !target) return;
    const option = target.closest("[role=option], [data-automation-id*='promptOption' i]");
    if (option) {
      if (opened?.isConnected) touch(opened);
    } else {
      opened = target.closest("[data-unnepo-id], [role=combobox], [aria-haspopup=listbox]");
    }
  }, true);
  document.addEventListener("keydown", (event) => {
    const target = targetOf(event);
    // Picking a dropdown choice with the keyboard.
    if (event.isTrusted && target && event.key === "Enter" && target.closest("[role=combobox], [aria-haspopup=listbox]")) touch(target);
  }, true);
}

/** Whether the student answered or changed this question by hand since the page loaded. */
export function editedByStudent(el: Element) {
  return Boolean(el.closest(`[${EDITED}]`) || el.querySelector(`[${EDITED}]`));
}
