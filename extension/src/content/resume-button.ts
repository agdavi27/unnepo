import type { FileData } from "../shared/types";

/**
 * A small "Attach with Unnepo" button beside each resume upload box on a job page (a file box whose label or
 * the text around it says resume or CV), and "Attach transcript" beside a transcript box. Pressing it asks the
 * extension for the student's resume (or the transcript they saved in Unnepo) and puts it in that box. For a resume it
 * first opens a short menu, like "Write with unnepo" does for a cover letter: "Attach my resume now" (the saved one, as
 * it is), or "Tailor my resume to this job" (the same resume reworded and reordered toward the job on this tab, never
 * with anything added, in the resume's own layout; see lib/apply/tailor-resume.ts). Free has 3 a day, counted apart
 * from cover letters; Pro has no limit. If tailoring fails, the saved resume is still offered. With more than one resume saved, either one asks which first.
 * Nothing is read or sent until it's pressed. Boxes for a cover letter or other documents are left alone.
 */

type ResumeChoice = { id: string; fileName: string; active: boolean; file: boolean };

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
  // Workday's "Autofill with Resume" names the resume seven wrappers up from its hidden box, above "Drop file here".
  let box: HTMLElement | null = input.parentElement;
  for (let depth = 0; box && depth < 9; depth++, box = box.parentElement) {
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

/**
 * Presses the site's own Upload button with the file armed (see file-catcher.ts): the picker it opens gets the file
 * instead. True when the site took it within a couple of seconds.
 */
async function pressUpload(button: HTMLElement, file: FileData) {
  const taken = new Promise<boolean>((done) => {
    const timer = setTimeout(() => { window.removeEventListener("unnepo:file-taken", got); done(false); }, 2500);
    const got = () => { clearTimeout(timer); done(true); };
    window.addEventListener("unnepo:file-taken", got, { once: true });
  });
  window.dispatchEvent(new CustomEvent("unnepo:arm-file", { detail: JSON.stringify({ name: file.name, mime: file.mime, base64: file.base64 }) }));
  button.click();
  const ok = await taken;
  if (!ok) window.dispatchEvent(new CustomEvent("unnepo:disarm-file"));
  return ok;
}

/**
 * Where the file goes: an upload box, or (LinkedIn's Easy Apply, which has no box until its "Upload resume" button
 * makes one) the site's own button, pressed with the file armed.
 */
type Target = { input: HTMLInputElement } | { button: HTMLElement };

function addButton(target: Target, after: HTMLElement, kind: Kind) {
  const marked = "input" in target ? target.input : target.button;
  marked.setAttribute(MARK, "");
  const accept = "input" in target ? target.input.accept : "";
  const place = async (file: FileData) => {
    if ("input" in target) { attachFile(target.input, file); return true; }
    return pressUpload(target.button, file);
  };
  const host = document.createElement("span");
  host.setAttribute(MARK, "button");
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `
    <style>
      :host { all: initial; position: relative; display: inline-flex; margin: 6px 0; font: 600 12px/1 system-ui, -apple-system, sans-serif; }
      .main { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 7px; background: #070708; color: #F7F7F8; border: 1px solid #3D8BFF; box-shadow: 2px 2px 0 #3D8BFF; }
      .main:hover { background: #14141A; }
      button:focus-visible { outline: 2px solid #3D8BFF; outline-offset: 2px; }
      button[disabled] { cursor: default; opacity: .7; }
      .menu { position: absolute; top: calc(100% + 6px); left: 0; z-index: 2147483000; min-width: 220px; max-width: 320px; padding: 6px; border-radius: 9px; background: #0C0C0E; border: 1px solid #26262C; box-shadow: 0 8px 24px rgba(0,0,0,.4); display: grid; gap: 2px; }
      .menu[hidden] { display: none; }
      .menu .head { color: #8B8B94; font-weight: 500; font-size: 11px; padding: 4px 8px 6px; }
      .pick { all: unset; cursor: pointer; display: flex; align-items: center; gap: 8px; padding: 8px; border-radius: 6px; color: #F7F7F8; font-weight: 500; }
      .pick:hover, .pick:focus-visible { background: #17171B; outline: none; }
      .pick .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .pick .tag { color: #8B8B94; font-size: 11px; }
      .pick .words { flex: 1; min-width: 0; display: grid; gap: 2px; }
      .pick small { color: #8B8B94; font-weight: 400; font-size: 11px; white-space: normal; }
      .pick[disabled] { cursor: default; opacity: .55; } .pick[disabled]:hover { background: none; }
      .menu .note { margin: 4px 8px 6px; color: #F5A524; font-weight: 500; font-size: 11.5px; line-height: 1.4; }
      .menu .good { margin: 0 8px 4px; color: #4ADE80; font-weight: 600; font-size: 11.5px; line-height: 1.4; }
      .dot { width: 7px; height: 7px; border-radius: 50%; background: #3D8BFF; }
      .ok { border-color: #22C55E; box-shadow: 2px 2px 0 #22C55E; }
      .ok .dot { background: #22C55E; }
      .bad { border-color: #F5A524; box-shadow: 2px 2px 0 #F5A524; }
    </style>
    <button type="button" class="main" title="${kind === "resume" ? "Attach your Unnepo resume, or tailor it to this job first" : "Put your Unnepo transcript in this upload box"}" aria-haspopup="${kind === "resume" ? "menu" : "false"}"><span class="dot" aria-hidden="true"></span><span class="text">${kind === "resume" ? "Attach with Unnepo" : "Attach transcript with Unnepo"}</span></button>
    <div class="menu" role="menu" hidden></div>`;
  const button = root.querySelector<HTMLButtonElement>(".main")!;
  const menu = root.querySelector<HTMLElement>(".menu")!;
  const text = root.querySelector<HTMLElement>(".text")!;
  const set = (words: string, tone: "" | "ok" | "bad") => { text.textContent = words; button.className = `main ${tone}`; };
  const short = (name: string) => (name.length > 28 ? `${name.slice(0, 26)}…` : name);

  async function attach(resumeId?: string) {
    button.disabled = true;
    set("Attaching…", "");
    let result: { ok?: boolean; file?: FileData | null; error?: string | null } | undefined;
    try {
      result = await chrome.runtime.sendMessage({ type: kind === "resume" ? "resume-file" : "transcript-file", resumeId });
    } catch {
      result = { ok: false, error: "Unnepo was updated. Refresh this page" };
    }
    button.disabled = false;
    if (!result?.ok || !result.file) return set(result?.error || `Upload your ${kind} in Unnepo first`, "bad");
    await putIn(result.file);
  }

  const closeMenu = () => { menu.hidden = true; document.removeEventListener("click", outside, true); };
  const outside = (event: Event) => { if (!event.composedPath().includes(host) && !tailor.busy) closeMenu(); };
  menu.addEventListener("keydown", (event) => { if (event.key === "Escape" && !tailor.busy) { closeMenu(); button.focus(); } });

  /** "Tailor my resume to this job": where it's got to, kept while the menu is closed and opened again. */
  const tailor = { busy: false, file: null as FileData | null, look: "", note: "", account: { free: false, left: null as number | null, limit: null as number | null } };

  const row = (label: string, hint: string, onPick: () => void, options: { disabled?: boolean; tag?: string } = {}) => {
    const pick = document.createElement("button");
    pick.type = "button";
    pick.className = "pick opt";
    pick.setAttribute("role", "menuitem");
    pick.disabled = Boolean(options.disabled);
    const words = document.createElement("span");
    words.className = "words";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = label;
    words.append(name);
    if (hint) {
      const small = document.createElement("small");
      small.textContent = hint;
      words.append(small);
    }
    pick.append(words);
    if (options.tag) {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = options.tag;
      pick.append(tag);
    }
    pick.addEventListener("click", (clicked) => {
      clicked.preventDefault();
      clicked.stopPropagation();
      onPick();
    });
    menu.append(pick);
    return pick;
  };
  const line = (className: string, words: string, role = "") => {
    const el = document.createElement(className === "head" ? "div" : "p");
    el.className = className;
    el.textContent = words;
    if (role) el.setAttribute("role", role);
    menu.append(el);
  };
  const openMenu = () => {
    menu.hidden = false;
    document.addEventListener("click", outside, true);
    menu.querySelector<HTMLButtonElement>(".pick:not([disabled])")?.focus();
  };

  /** More than one resume: which one. One (or the list can't be read): straight on, with the default. */
  async function whichResume(then: (resumeId?: string) => void) {
    const listed = await chrome.runtime.sendMessage({ type: "resume-list" }).catch(() => null) as { resumes?: ResumeChoice[] } | null;
    const choices = (listed?.resumes ?? []).filter((item) => item.file);
    if (choices.length < 2) return then();
    menu.replaceChildren();
    line("head", "Which resume?");
    for (const choice of choices) row(choice.fileName, "", () => { closeMenu(); then(choice.id); }, { tag: choice.active ? "Default" : "" });
    openMenu();
  }

  /** The first step, like "Write with unnepo": attach the saved resume as it is, or tailor it to this job first. */
  function chooseMenu() {
    menu.replaceChildren();
    line("head", "Your resume");
    if (tailor.file) {
      line("good", `✓ Tailored to this job${tailor.look ? `. ${tailor.look}` : ""}`, "status");
      row("Attach tailored resume", tailor.file.name, () => { closeMenu(); void putIn(tailor.file!); });
      row("Preview it", "Opens the PDF in a new tab", () => preview(tailor.file!));
      row("Attach my saved resume instead", "As it is, no changes", () => { closeMenu(); void whichResume((id) => void attach(id)); });
      return openMenu();
    }
    const { free, left, limit } = tailor.account;
    const out = free && typeof left === "number" && left <= 0;
    const hint = out ? "None left today on Free. Pro has no limit." : free && typeof left === "number" ? `${left} of ${limit ?? 3} left today` : "Rewords it for this job, in your own layout. Adds nothing new";
    row("Attach my resume now", "Your saved resume, as it is", () => { closeMenu(); void whichResume((id) => void attach(id)); });
    row(tailor.busy ? "Tailoring your resume…" : "✦ Tailor my resume to this job", tailor.busy ? "Takes a few seconds" : hint, () => void whichResume((id) => void tailorIt(id)), { disabled: out || tailor.busy });
    if (tailor.note) line("note", tailor.note, "status");
    openMenu();
  }

  async function putIn(file: FileData) {
    const ok = await place(file).catch(() => false);
    set(ok ? `✓ Attached ${short(file.name)}` : "This site blocks it. Upload it yourself", ok ? "ok" : "bad");
  }

  function preview(file: FileData) {
    const bytes = Uint8Array.from(atob(file.base64), (char) => char.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: file.mime }));
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  /** Tailors it, then offers it to attach. On failure the saved resume is still offered, with why. */
  async function tailorIt(resumeId?: string) {
    tailor.busy = true;
    tailor.note = "";
    button.disabled = true;
    set("Tailoring your resume…", "");
    chooseMenu();
    type Got = { ok?: boolean; file?: FileData; note?: string | null; error?: string };
    // The box's own file types go along: one that takes only PDFs gets a PDF, even from a Word resume.
    const got = await (chrome.runtime.sendMessage({ type: "resume-tailor", resumeId, accept }) as Promise<Got>).catch((): Got => ({ ok: false, error: "Unnepo was updated. Refresh this page" }));
    tailor.busy = false;
    button.disabled = false;
    if (got?.ok && got.file) {
      tailor.file = got.file;
      tailor.look = got.note ?? "";
      set("Tailored. Attach it?", "");
    } else {
      tailor.note = `${got?.error || "Couldn't tailor your resume."} Your saved resume is still here to attach.`;
      set("Attach with Unnepo", "");
    }
    await refreshAccount();
    chooseMenu();
  }

  async function refreshAccount() {
    const state = await (chrome.runtime.sendMessage({ type: "resume-page-state" }) as Promise<{ ok?: boolean; free?: boolean; left?: number | null; limit?: number | null }>).catch(() => null);
    tailor.account = { free: Boolean(state?.ok && state.free), left: state?.ok && typeof state.left === "number" ? state.left : null, limit: state?.ok && typeof state.limit === "number" ? state.limit : null };
  }

  button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!menu.hidden) { if (!tailor.busy) closeMenu(); return; }
    if (kind !== "resume") return attach();
    // A resume box: attach the saved one now, or tailor it to this job first. The writes left today show on Tailor.
    await refreshAccount();
    chooseMenu();
  });
  after.insertAdjacentElement("afterend", host);
}

// The site's own button for a resume upload: "Upload resume", "Attach CV", "Add résumé"...
const UPLOAD_RESUME = /\b(upload|attach|add|choose|select|browse)\b.{0,20}(r[eé]sum[eé]|\bcv\b)/i;
const visible = (el: Element) => { const rect = el.getBoundingClientRect(); return rect.width > 2 && rect.height > 2; };

function scan() {
  for (const input of Array.from(document.querySelectorAll<HTMLInputElement>(`input[type=file]:not([${MARK}])`))) {
    const kind = input.files?.length ? null : asksFor(input);
    if (!kind) continue;
    // The box is often hidden inside a list of choices (LinkedIn's saved resumes): then beside its visible label.
    const shown = shownFor(input) ?? Array.from(input.labels ?? []).find(visible) ?? null;
    if (shown) addButton({ input }, shown, kind);
  }
  // No upload box yet (LinkedIn's Easy Apply makes one only when its "Upload resume" is pressed): beside that button.
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(`button:not([${MARK}]), label:not([${MARK}]), [role=button]:not([${MARK}])`))) {
    if (el.closest(`[${MARK}="button"]`) || (el as HTMLButtonElement).disabled || !visible(el)) continue;
    const words = `${(el.innerText || el.textContent || "").replace(/\s+/g, " ").trim()} ${el.getAttribute("aria-label") ?? ""}`;
    if (words.length > 120 || !UPLOAD_RESUME.test(words) || NOT_RESUME.test(words)) continue;
    // A label for a box: the box itself, unless it was handled above.
    const control = el instanceof HTMLLabelElement ? el.control : null;
    if (control instanceof HTMLInputElement && control.type === "file") {
      if (control.hasAttribute(MARK) || control.files?.length) continue;
      addButton({ input: control }, el, "resume");
      continue;
    }
    addButton({ button: el }, el, "resume");
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
