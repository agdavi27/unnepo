import type { FileData } from "./types";

/**
 * Runs in the Gmail or Outlook tab an email opened in: waits for the draft's message box, then adds the resume to
 * the draft, through the draft's own attachment box when it has one, else dropped on the message like a dragged
 * file. Says how it went: "attached", "sent" (handed over, not seen in the draft yet), or "none" (no draft showed).
 */
export async function putResumeInDraft(file: FileData) {
  const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
  const make = () => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([Uint8Array.from(atob(file.base64), (char) => char.charCodeAt(0))], file.name, { type: file.mime }));
    return transfer;
  };
  const BODY = "div[aria-label='Message Body'][contenteditable='true'], div[aria-label='Message body'][contenteditable='true'], div[role='textbox'][contenteditable='true'][aria-label*='essage']";
  for (let tries = 0; tries < 50; tries++) {
    const body = document.querySelector<HTMLElement>(BODY);
    if (body) {
      await wait(800);
      const draft = body.closest("[role='dialog'], form, [role='main']") ?? document;
      // Already there (a second press, or Gmail put back a saved draft).
      if ((draft.textContent ?? "").includes(file.name)) return "attached";
      // The draft's own attachment box; one elsewhere on the page only when this is the only draft open.
      const onlyDraft = document.querySelectorAll(BODY).length === 1;
      const input = draft.querySelector<HTMLInputElement>("input[type='file'][name='Filedata'], input[type='file'][multiple]") ?? (onlyDraft ? document.querySelector<HTMLInputElement>("input[type='file'][name='Filedata']") : null);
      if (input) {
        input.files = make().files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      } else {
        const transfer = make();
        for (const type of ["dragenter", "dragover", "drop"]) body.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, composed: true, dataTransfer: transfer }));
      }
      for (let look = 0; look < 12; look++) {
        await wait(500);
        if ((draft.textContent ?? "").includes(file.name)) return "attached";
      }
      return "sent";
    }
    await wait(400);
  }
  return "none";
}
