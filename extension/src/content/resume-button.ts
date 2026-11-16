import type { FileData } from "../shared/types";

/**
 * A small "Attach with Unnepo" button beside each resume upload box on a job page (a file box whose label or
 * the text around it says resume or CV), and "Attach transcript" beside a transcript box. Pressing it asks the
 * extension for the student's resume (or the transcript they saved in Unnepo) and puts it in that box. Nothing is
 * read or sent until it's pressed. Boxes for a cover letter or other documents are left alone.
 */

const RESUME = /r[eé]sum[eé]|\bcv\b|curriculum vitae/i;
const NOT_RESUME = /cover letter|transcript|portfolio|writing sample|references?\b|certificat|photo|headshot/i;
const TRANSCRIPT = /transcript|academic record|grade report/i;
const NOT_TRANSCRIPT = /cover letter|r[eé]sum[eé]|\bcv\b|portfolio|writing sample|photo|headshot/i;
type Kind = "resume" | "transcript";
const MARK = "data-unnepo-resume";

/** What a box's words ask for: a resume, a transcript, or something else (null). */
function kindIn(text: string): Kind | null | "other" {
  if (TRANSCRIPT.test(text) && !NOT_TRANSCRIPT.test(text)) return "transcript";
  if (RESUME.test(text) && !NOT_RESUME.test(text)) return "resume";
  return NOT_RESUME.test(text) || TRANSCRIPT.test(text) ? "other" : null;
}

/**
 * What a file box asks for: its own labels and aria text say so, or else the nearest short text around it names
 * a resume (or a transcript) and nothing else (a box beside "Cover letter" is left alone).
 */
function asksFor(input: HTMLInputElement): Kind | null {
  const own = [input.getAttribute("aria-label"), input.title, ...Array.from(input.labels ?? []).map((label) => label.textContent)].filter(Boolean).join(" ");
  // Its own label can be just the button's word ("Attach" on Greenhouse), which decides nothing: then the words around it do.
  const ownKind = own.trim() ? kindIn(own) : null;
  if (ownKind) return ownKind === "other" ? null : ownKind;
  let box: HTMLElement | null = input.parentElement;
  for (let depth = 0; box && depth < 5; depth++, box = box.parentElement) {
    const text = (box.innerText || "").replace(/\s+/g, " ").trim();
    if (text.length > 300) break;
    const kind = kindIn(text);
    if (kind === "other") return null;
    if (kind) return kind;
  }
  const kind = kindIn(`${input.name} ${input.id}`);
  return kind === "other" ? null : kind;
}

/**
 * Where the button goes: after the upload box's own group (the site's Attach / Dropbox buttons and file types),
 * never inside it. The input itself is often hidden (1×1), so it's the widest wrapper around it that holds no
 * other field and stays small.
 */
function shownFor(input: HTMLInputElement) {
  let best: HTMLElement | null = null;
  let el: HTMLElement | null = input;
  for (let depth = 0; el && depth < 6; depth++, el = el.parentElement) {
    if (el !== input && Array.from(el.querySelectorAll("input:not([type=hidden]), select, textarea")).some((other) => other !== input)) break;
    const rect = el.getBoundingClientRect();
    if (rect.height >= 220 || (el !== input && (el.innerText || "").length > 300)) break;
    if (rect.width >= 40 && rect.height >= 16) best = el;
  }
  return best;
}

function attachFile(input: HTMLInputElement, file: FileData) {
  const bytes = Uint8Array.from(atob(file.base64), (char) => char.charCodeAt(0));
  const transfer = new DataTransfer();
  transfer.items.add(new File([bytes], file.name, { type: file.mime }));
  input.files = transfer.files;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
}

function addButton(input: HTMLInputElement, after: HTMLElement, kind: Kind) {
  input.setAttribute(MARK, "");
  const host = document.createElement("span");
  host.setAttribute(MARK, "button");
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `
    <style>
      :host { all: initial; display: inline-flex; margin: 6px 0; font: 600 12px/1 system-ui, -apple-system, sans-serif; }
      button { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 7px; background: #070708; color: #F7F7F8; border: 1px solid #3D8BFF; box-shadow: 2px 2px 0 #3D8BFF; }
      button:hover { background: #14141A; }
      button:focus-visible { outline: 2px solid #3D8BFF; outline-offset: 2px; }
      button[disabled] { cursor: default; opacity: .7; }
      .dot { width: 7px; height: 7px; border-radius: 50%; background: #3D8BFF; }
      .ok { border-color: #22C55E; box-shadow: 2px 2px 0 #22C55E; }
      .ok .dot { background: #22C55E; }
      .bad { border-color: #F5A524; box-shadow: 2px 2px 0 #F5A524; }
    </style>
    <button type="button" title="Put your Unnepo ${kind} in this upload box"><span class="dot" aria-hidden="true"></span><span class="text">${kind === "resume" ? "Attach with Unnepo" : "Attach transcript with Unnepo"}</span></button>`;
  const button = root.querySelector("button")!;
  const text = root.querySelector<HTMLElement>(".text")!;
  const set = (words: string, tone: "" | "ok" | "bad") => { text.textContent = words; button.className = tone; };
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    button.disabled = true;
    set("Attaching…", "");
    let result: { ok?: boolean; file?: FileData | null; error?: string | null } | undefined;
    try {
      result = await chrome.runtime.sendMessage({ type: kind === "resume" ? "resume-file" : "transcript-file" });
    } catch {
      result = { ok: false, error: "Unnepo was updated. Refresh this page" };
    }
    button.disabled = false;
    if (!result?.ok || !result.file) return set(result?.error || `Upload your ${kind} in Unnepo first`, "bad");
    try {
      attachFile(input, result.file);
      set(`✓ Attached ${result.file.name.length > 28 ? `${result.file.name.slice(0, 26)}…` : result.file.name}`, "ok");
    } catch {
      set("This site blocks it. Upload it yourself", "bad");
    }
  });
  after.insertAdjacentElement("afterend", host);
}

function scan() {
  for (const input of Array.from(document.querySelectorAll<HTMLInputElement>(`input[type=file]:not([${MARK}])`))) {
    const kind = input.files?.length ? null : asksFor(input);
    if (!kind) continue;
    const shown = shownFor(input);
    if (shown) addButton(input, shown, kind);
  }
}

/** Watches the page (forms appear step by step) and adds the button beside each resume and transcript box as it shows up. */
export function watchResumeBoxes() {
  let pending = 0;
  const observer = new MutationObserver(() => {
    if (!pending) pending = window.setTimeout(() => { pending = 0; scan(); }, 700);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  scan();
}
