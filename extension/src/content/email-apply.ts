/**
 * A job that's applied to by email ("To apply, send your resume to hi@pennock.co"): a card in the corner of the page
 * says so, and offers to write the email. The email is written from the student's resume for this job, shown to edit,
 * then opened in Gmail or Outlook with the resume attached (or in the mail app). Nothing is read from the page or
 * sent anywhere until "Write the email" is pressed.
 */

import { H, W, spiderRects, storedSpiderColors } from "../shared/sprite";

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
  .card { width: min(380px, calc(100vw - 32px)); background: #fff; border: 1px solid #E4E4EA; border-radius: 16px; box-shadow: 0 16px 40px rgba(0,0,0,.18), 0 2px 8px rgba(0,0,0,.06); padding: 14px 16px 16px; }
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
`;

function show(found: ApplyEmail, mailer: NonNullable<State["mailer"]>) {
  const host = document.createElement("div");
  host.setAttribute("data-unnepo-email-apply", "");
  const root = host.attachShadow({ mode: "closed" });
  document.documentElement.append(host);
  let spider = spiderRects(0);
  const ui: { step: "ask" | "writing" | "ready" | "opened"; subject: string; body: string; error: string; shown: boolean } = { step: "ask", subject: "", body: "", error: "", shown: false };
  void storedSpiderColors().then((colors) => { spider = spiderRects(0, colors); draw(); });
  const svg = () => `<svg viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges" aria-hidden="true"><g transform="rotate(180 ${W / 2} ${H / 2})">${spider}</g></svg>`;
  const where = MAILER_NAME[mailer];

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
        ${ui.error ? `<div class="bad" role="alert">${escape(ui.error)}</div>` : ""}
        <div class="row">
          <button type="button" class="btn wide" data-act="open">Open in ${where}${mailer === "mailto" ? "" : " with resume"} ↗</button>
          <button type="button" class="btn ghost" data-act="copy">Copy</button>
        </div>
        <div class="hint">${mailer === "mailto" ? "Your mail app can't be reached from here: attach your resume there before you send." : `Your resume is attached when it opens in ${where}. Read it over, then send.`}</div>`;
    }
    return `<h2>Opened in ${where}</h2>
      <p class="good">✓ ${mailer === "mailto" ? "Attach your resume, then send." : "Check your resume is attached, then send."}</p>
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
      const opened = await ask<{ ok?: boolean; mailto?: string; cut?: boolean; error?: string }>({ type: "email-apply-open", to: found.email, subject: ui.subject, body: ui.body }).catch(() => null);
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
