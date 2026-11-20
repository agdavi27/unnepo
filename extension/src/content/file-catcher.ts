/**
 * Runs in the page's own world (not the extension's), so it sees the page's code open its file picker. Some sites
 * (LinkedIn's Easy Apply) have no upload box on the page until their "Upload" button makes one and opens the
 * picker. When "Write with unnepo" is attaching a letter, it arms this with the file, then presses the site's
 * button: the next file picker that opens, within a few seconds, gets the file instead, with no dialog.
 * Unarmed, it does nothing. A page that arms it itself only puts its own file in its own box.
 */

let armed: { file: File; until: number } | null = null;

window.addEventListener("unnepo:arm-file", (event) => {
  try {
    const { name, mime, base64 } = JSON.parse(String((event as CustomEvent).detail)) as { name: string; mime: string; base64: string };
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    armed = { file: new File([bytes], name, { type: mime }), until: Date.now() + 6000 };
  } catch {
    armed = null;
  }
});
window.addEventListener("unnepo:disarm-file", () => { armed = null; });

/** Puts the armed file in this upload box, as if the student picked it. False when nothing's armed. */
function take(input: HTMLInputElement) {
  if (!armed || input.type !== "file") return false;
  if (Date.now() > armed.until) { armed = null; return false; }
  const transfer = new DataTransfer();
  transfer.items.add(armed.file);
  armed = null;
  input.files = transfer.files;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  window.dispatchEvent(new CustomEvent("unnepo:file-taken"));
  return true;
}

// The site opening the picker from code: input.click() or input.showPicker(), on a box in the page or not.
const click = HTMLInputElement.prototype.click;
HTMLInputElement.prototype.click = function (this: HTMLInputElement) {
  if (this.type === "file" && take(this)) return;
  return click.call(this);
};
const showPicker = HTMLInputElement.prototype.showPicker;
if (showPicker) {
  HTMLInputElement.prototype.showPicker = function (this: HTMLInputElement) {
    if (this.type === "file" && take(this)) return;
    return showPicker.call(this);
  };
}
// A <label> for the box, pressed: the click lands on the box itself. Stopped before the picker opens.
window.addEventListener("click", (event) => {
  if (!armed) return;
  const input = event.composedPath()[0];
  if (input instanceof HTMLInputElement && input.type === "file" && take(input)) event.preventDefault();
}, true);
