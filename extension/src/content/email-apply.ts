/**
 * A job that's applied to by email ("To apply, send your resume to hi@pennock.co"): a card in the corner of the page
 * says so, and offers to write the email. The email is written from the student's resume for this job, shown to edit,
 * then opened in Gmail or Outlook with the resume attached (or in the mail app). Which resume, like the cover letter's
 * choice: "Attach my resume now" (the saved one, as it is) or "Tailor my resume to this job" (reworded and reordered
 * for this job in its own layout, nothing added; Free has 3 a day). Nothing is read from the page or sent anywhere
 * until "Write the email" is pressed.
 */

import { H, W, spiderRects, storedSpiderColors } from "../shared/sprite";
import type { FileData } from "../shared/types";

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const SEND = /\b(send|sending|e-?mail|submit|forward|direct|apply|reply)\b/i;
const WHAT = /\b(resumes?|résumés?|cvs?|cover letters?|applications?|portfolios?|letters? of interest|candidacy|work samples?)\b/i;
/** Addresses that aren't for applying: accommodations, privacy, the press, the website. */
const NOT_APPLYING = /accommodat|disabilit|privacy|gdpr|data (protection|request)|unsubscribe|\bpress\b|media (inquir|contact)|website (issue|problem)|technical (issue|support)|report (fraud|abuse)|questions about (this|the) (site|website|portal)|having trouble|unable to apply|difficulty (applying|using)/i;
const NOT_ADDRESS = /\.(png|jpe?g|gif|webp|svg)$|^(no-?reply|noreply|donotreply)@|@(example|sentry|wixpress)\./i;

export type ApplyEmail = { email: string; said: string };

/**
 * The address a posting says to apply at, with the words that said it, or null. Looks at each line with an address
 * in it, along with the line before ("How to apply" over "Send your resume to hi@pennock.co").
 */
export function findApplyEmail(text: string): ApplyEmail | null {
  const lines = text.split(/\n+/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const emails = (line.match(EMAIL) ?? []).filter((email) => !NOT_ADDRESS.test(email));
    if (!emails.length || line.length > 400) continue;
    const near = `${lines[index - 1] && lines[index - 1].length < 120 ? `${lines[index - 1]} ` : ""}${line}`;
    if (NOT_APPLYING.test(line)) continue;
    if (SEND.test(near) && WHAT.test(near)) return { email: emails[0].replace(/[.,;:]+$/, ""), said: line.slice(0, 300) };
  }
  return null;
}

type State = { ok?: boolean; mailer?: "gmail" | "outlook" | "mailto" };
type Wrote = { ok?: boolean; to?: string; subject?: string; body?: string; error?: string };
type Tailored = { ok?: boolean; file?: FileData; note?: string | null; error?: string };

const ask = <T>(message: unknown) => chrome.runtime.sendMessage(message) as Promise<T>;
const escape = (text: string) => text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const MAILER_NAME = { gmail: "Gmail", outlook: "Outlook", mailto: "your mail app" } as const;
const HIDDEN = "unnepo-email-apply-hidden";

/** The job, as well as the page says it: the main heading, and the company from the title or the site's name. */
function pageJob() {
  const heading = (document.querySelector("h1")?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
  const site = document.querySelector<HTMLMetaElement>("meta[property='og:site_name']")?.content ?? "";
  const company = (site || document.title.split(/\s[|–—-]\s/).pop() || location.hostname.replace(/^www\./, "").split(".")[0]).trim().slice(0, 100);
  return { title: heading, company, description: (document.body.innerText || "").slice(0, 4000) };
}

const STYLE = `
  :host { all: initial; position: fixed; right: 20px; bottom: 20px; z-index: 2147483646; font: 13.5px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: #111114; }
  * { box-sizing: border-box; }
  .card { width: min(380px, calc(100vw - 32px)); background: #fff; border: 1px solid #E4E4EA; border-radius: 16px; box-shadow: 0 16px 40px rgba(0,0,0,.18), 0 2px 8px rgba(0,0,0,.06); padding: 14px 16px 16px; max-height: calc(100vh - 40px); overflow: auto; }
  .card.enter { animation: pop .28s cubic-bezier(.2,1.2,.4,1) both; }
  @keyframes pop { from { transform: translateY(16px); opacity: 0; } }
  .head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
  .head svg { width: 22px; height: ${Math.round((22 * H) / W)}px; flex: none; }
  .brand { font-weight: 700; font-size: 14px; } .brand span { color: #3D8BFF; }
  .x { all: unset; cursor: pointer; margin-left: auto; width: 26px; height: 26px; border-radius: 8px; display: grid; place-items: center; color: #6A6A74; font-size: 17px; }
  .x:hover { background: #F2F2F6; color: #111114; }
  h2 { font-size: 15px; margin: 0 0 4px; }
  .to { font-weight: 600; color: #2F6FEB; word-break: break-all; }
  .said { margin: 8px 0 12px; padding: 8px 10px; background: #F6F7F9; border-radius: 9px; color: #45454E; font-size: 12.5px; max-height: 72px; overflow: auto; }
  label { display: block; font-size: 11.5px; font-weight: 600; color: #6A6A74; margin: 10px 0 4px; }
  input, textarea { width: 100%; border: 1px solid #D7D7DE; border-radius: 9px; padding: 8px 10px; font: inherit; color: inherit; background: #fff; }
  input:focus, textarea:focus { outline: 2px solid #3D8BFF; outline-offset: 0; border-color: transparent; }
  textarea { height: 210px; resize: vertical; line-height: 1.45; }
  .row { display: flex; gap: 8px; margin-top: 12px; align-items: center; }
  .btn { all: unset; cursor: pointer; height: 34px; padding: 0 14px; border-radius: 10px; font-weight: 600; font-size: 13px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; background: #3D8BFF; color: #fff; white-space: nowrap; }
  .btn:hover { background: #2F6FEB; }
  .btn.wide { flex: 1; }
  .btn.ghost { background: #fff; color: #45454E; box-shadow: inset 0 0 0 1px #D7D7DE; font-weight: 500; }
  .btn.ghost:hover { background: #F6F7F9; }
  .btn[disabled] { opacity: .55; cursor: default; }
  .btn:focus-visible, .x:focus-visible { outline: 2px solid #3D8BFF; outline-offset: 2px; }
  .hint { font-size: 12px; color: #6A6A74; margin-top: 8px; }
  .bad { color: #B91C1C; font-size: 12.5px; margin-top: 8px; }
  .good { color: #15803D; font-weight: 600; margin: 4px 0 0; }
  .dots::after { content: "…"; }
  .pickr { all: unset; cursor: pointer; display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border-radius: 9px; border: 1px solid #E4E4EA; font-weight: 600; font-size: 12.5px; margin-top: 6px; box-sizing: border-box; width: 100%; }
  .pickr small { font-weight: 400; font-size: 11.5px; color: #6A6A74; }
  .pickr:hover { border-color: #3D8BFF; background: #F5F9FF; }
  .pickr.on { border-color: #3D8BFF; box-shadow: inset 0 0 0 1px #3D8BFF; background: #F5F9FF; }
  .pickr[disabled] { cursor: default; opacity: .55; } .pickr[disabled]:hover { border-color: #E4E4EA; background: none; }
  .pickr:focus-visible { outline: 2px solid #3D8BFF; outline-offset: 2px; }
  .note { color: #B45309; font-size: 12px; margin-top: 6px; }
  .quiet { all: unset; cursor: pointer; font-size: 12px; color: #45454E; text-decoration: underline; text-underline-offset: 3px; margin-top: 6px; display: inline-block; }
`;

function show(found: ApplyEmail, mailer: NonNullable<State["mailer"]>) {
  const host = document.createElement("div");
  host.setAttribute("data-unnepo-email-apply", "");
  const root = host.attachShadow({ mode: "closed" });
  document.documentElement.append(host);
  let spider = spiderRects(0);
  const ui: { step: "ask" | "writing" | "ready" | "opened"; subject: string; body: string; error: string; shown: boolean } = { step: "ask", subject: "", body: "", error: "", shown: false };
  /** Which resume goes with the email: the saved one, or one tailored to this job (and how that went). */
  const resume: { use: "saved" | "tailored"; busy: boolean; file: FileData | null; look: string; note: string; free: boolean; left: number | null; limit: number | null } = { use: "saved", busy: false, file: null, look: "", note: "", free: false, left: null, limit: null };
  void ask<{ ok?: boolean; free?: boolean; left?: number | null; limit?: number | null }>({ type: "resume-page-state" }).then((state) => {
    resume.free = Boolean(state?.ok && state.free);
    resume.left = state?.ok && typeof state.left === "number" ? state.left : null;
    resume.limit = state?.ok && typeof state.limit === "number" ? state.limit : null;
  }).catch(() => undefined);
  void storedSpiderColors().then((colors) => { spider = spiderRects(0, colors); draw(); });
  const svg = () => `<svg viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges" aria-hidden="true"><g transform="rotate(180 ${W / 2} ${H / 2})">${spider}</g></svg>`;
  const where = MAILER_NAME[mailer];

  /** Attach the saved resume, or tailor it to this job first: the same two choices as on a resume upload box. */
  function resumeChoice() {
    const out = resume.free && typeof resume.left === "number" && resume.left <= 0 && !resume.file;
    const hint = resume.busy ? "Takes a few seconds"
      : resume.file ? `${resume.file.name}${resume.look ? `. ${resume.look}` : ""}`
      : out ? "None left today on Free. Pro has no limit."
      : resume.free && typeof resume.left === "number" ? `${resume.left} of ${resume.limit ?? 3} left today`
      : "Rewords it for this job, in your own layout. Adds nothing new";
    return `<label>Resume</label>
      <button type="button" class="pickr${resume.use === "saved" ? " on" : ""}" data-act="use-saved" aria-pressed="${resume.use === "saved"}" ${resume.busy ? "disabled" : ""}>Attach my resume now<small>Your saved resume, as it is</small></button>
      <button type="button" class="pickr${resume.use === "tailored" ? " on" : ""}" data-act="tailor" aria-pressed="${resume.use === "tailored"}" ${out || resume.busy ? "disabled" : ""}>${resume.busy ? `<span class="dots">Tailoring your resume</span>` : resume.file ? "✓ Tailored to this job" : "✦ Tailor my resume to this job"}<small>${escape(hint)}</small></button>
      ${resume.file && resume.use === "tailored" ? `<button type="button" class="quiet" data-act="preview">${mailer === "mailto" ? "Download the tailored resume" : "Preview it"}</button>` : ""}
      ${resume.note ? `<div class="note" role="status">${escape(resume.note)}</div>` : ""}`;
  }

  function body() {
    if (ui.step === "ask" || ui.step === "writing") {
      return `<h2>This job asks you to apply by email</h2>
        <div>Send your resume to <span class="to">${escape(found.email)}</span></div>
        <div class="said">“${escape(found.said)}”</div>
        ${ui.error ? `<div class="bad" role="alert">${escape(ui.error)}</div>` : ""}
        <div class="row">
          <button type="button" class="btn wide" data-act="write" ${ui.step === "writing" ? "disabled" : ""}>${ui.step === "writing" ? `<span class="dots">Writing your email</span>` : "✦ Write the email"}</button>
          <button type="button" class="btn ghost" data-act="close">Not now</button>
        </div>`;
    }
    if (ui.step === "ready") {
      return `<h2>Your email to <span class="to">${escape(found.email)}</span></h2>
        <label for="subject">Subject</label><input id="subject" value="${escape(ui.subject)}">
        <label for="body">Email</label><textarea id="body">${escape(ui.body)}</textarea>
        ${resumeChoice()}
        ${ui.error ? `<div class="bad" role="alert">${escape(ui.error)}</div>` : ""}
        <div class="row">
          <button type="button" class="btn wide" data-act="open" ${resume.busy ? "disabled" : ""}>Open in ${where}${mailer === "mailto" ? "" : resume.use === "tailored" ? " with tailored resume" : " with resume"} ↗</button>
          <button type="button" class="btn ghost" data-act="copy">Copy</button>
        </div>
        <div class="hint">${mailer === "mailto" ? `Your mail app can't be reached from here: attach your ${resume.use === "tailored" ? "tailored " : ""}resume there before you send.` : `Your ${resume.use === "tailored" ? "tailored " : ""}resume is attached when it opens in ${where}. Read it over, then send.`}</div>`;
    }
    return `<h2>Opened in ${where}</h2>
      <p class="good">✓ ${mailer === "mailto" ? `Attach your ${resume.use === "tailored" ? "tailored " : ""}resume, then send.` : `Check your ${resume.use === "tailored" ? "tailored " : ""}resume is attached, then send.`}</p>
      <div class="row"><button type="button" class="btn ghost" data-act="close">Done</button></div>`;
  }

  function draw() {
    const enter = ui.shown ? "" : " enter";
    ui.shown = true;
    root.innerHTML = `<style>${STYLE}</style><div class="card${enter}" role="dialog" aria-label="Apply by email with Unnepo">
      <div class="head">${svg()}<span class="brand">unnepo<span>.</span></span><button type="button" class="x" data-act="close" aria-label="Close">×</button></div>
      ${body()}</div>`;
  }

  const keep = () => {
    ui.subject = root.querySelector<HTMLInputElement>("#subject")?.value ?? ui.subject;
    ui.body = root.querySelector<HTMLTextAreaElement>("#body")?.value ?? ui.body;
  };

  async function act(name: string) {
    if (name === "close") {
      try { sessionStorage.setItem(HIDDEN, location.href.split("#")[0]); } catch { /* storage off */ }
      host.remove();
      return;
    }
    if (name === "write") {
      ui.step = "writing";
      ui.error = "";
      draw();
      const job = pageJob();
      const wrote = await ask<Wrote>({ type: "email-apply-write", to: found.email, instructions: found.said, ...job }).catch((): Wrote => ({ ok: false, error: "Unnepo was updated. Refresh this page." }));
      if (!wrote?.ok || !wrote.body) {
        ui.step = "ask";
        ui.error = wrote?.error ?? "Couldn't write the email. Try again.";
        return draw();
      }
      ui.subject = wrote.subject ?? "";
      ui.body = wrote.body;
      ui.step = "ready";
      return draw();
    }
    // The resume choice: the saved one, or tailor it (once; choosing it again reuses the one made).
    if (name === "use-saved") {
      keep();
      resume.use = "saved";
      resume.note = "";
      return draw();
    }
    if (name === "tailor") {
      keep();
      if (resume.file) { resume.use = "tailored"; return draw(); }
      resume.busy = true;
      resume.note = "";
      draw();
      const got = await ask<Tailored>({ type: "resume-tailor", job: pageJob() }).catch((): Tailored => ({ ok: false, error: "Unnepo was updated. Refresh this page." }));
      resume.busy = false;
      if (got?.ok && got.file) {
        resume.file = got.file;
        resume.look = got.note ?? "";
        resume.use = "tailored";
        if (typeof resume.left === "number") resume.left = Math.max(0, resume.left - 1);
      } else {
        resume.use = "saved";
        resume.note = `${got?.error || "Couldn't tailor your resume."} Your saved resume will be attached instead.`;
      }
      return draw();
    }
    if (name === "preview" && resume.file) {
      keep();
      const bytes = Uint8Array.from(atob(resume.file.base64), (char) => char.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: resume.file.mime }));
      if (mailer === "mailto") {
        const link = document.createElement("a");
        link.href = url;
        link.download = resume.file.name;
        document.body.append(link);
        link.click();
        link.remove();
      } else window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return;
    }
    if (name === "copy") {
      keep();
      await navigator.clipboard.writeText(ui.body).catch(() => undefined);
      const button = root.querySelector<HTMLButtonElement>("[data-act='copy']");
      if (button) button.textContent = "Copied";
      return;
    }
    if (name === "open") {
      keep();
      // A long email may not fit in the link: it's on the clipboard to paste, just in case.
      if (ui.body.length > 1200) await navigator.clipboard.writeText(ui.body).catch(() => undefined);
      const opened = await ask<{ ok?: boolean; mailto?: string; cut?: boolean; error?: string }>({ type: "email-apply-open", to: found.email, subject: ui.subject, body: ui.body, file: resume.use === "tailored" && resume.file ? resume.file : undefined }).catch(() => null);
      if (!opened?.ok) {
        ui.error = opened?.error ?? "Couldn't open the email. Copy it instead.";
        return draw();
      }
      if (opened.mailto) window.location.href = opened.mailto;
      ui.step = "opened";
      return draw();
    }
  }

  root.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>("[data-act]");
    if (button && !(button as HTMLButtonElement).disabled) void act(button.dataset.act!);
  });
  draw();
}

/**
 * Looks over the page a few times as it loads (job pages often draw their text late) for an apply-by-email line,
 * and shows the card once. Only for a student signed in to Unnepo, and not again on a page where it was closed.
 */
export function watchEmailApply() {
  try { if (sessionStorage.getItem(HIDDEN) === location.href.split("#")[0]) return; } catch { /* storage off */ }
  let tries = 0;
  const check = async () => {
    const text = document.body?.innerText ?? "";
    const found = text.includes("@") ? findApplyEmail(text) : null;
    if (!found) {
      if (++tries < 8) setTimeout(() => void check(), 2500);
      return;
    }
    const state = await ask<State>({ type: "email-apply-state" }).catch((): State => ({ ok: false }));
    if (state?.ok && !document.querySelector("[data-unnepo-email-apply]")) show(found, state.mailer ?? "gmail");
  };
  setTimeout(() => void check(), 1200);
}
