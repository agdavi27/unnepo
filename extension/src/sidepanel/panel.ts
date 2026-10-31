import { heroSpiderSvg } from "../shared/hero-spider";
import { PASSWORD_RULES, unmetRules } from "../shared/password";
import { NEVER_READ, type Issue, type PanelState } from "../shared/types";

/**
 * The side panel ("Spider guide" design): the spider talks you through what's on the tab and what
 * Unnepo is doing, the card below fills the application, then your profile and job-site password.
 */

const app = document.getElementById("app")!;
const account = document.getElementById("account")!;
const passwordSection = document.getElementById("password")!;
const footer = document.getElementById("footer")!;
const menu = document.getElementById("menu")!;
const speechSection = document.getElementById("speech")!;

/** Which view the bottom menu has open. Apply is the job on this tab. */
type View = "home" | "jobs" | "profile" | "settings";
let view: View = "home";

const escape = (text: string) => text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
/** "1.001": the version name, which keeps the zeros Chrome's own version number can't have. */
const extensionVersion = () => chrome.runtime.getManifest().version_name ?? chrome.runtime.getManifest().version;
const ask = <T>(message: unknown) => chrome.runtime.sendMessage(message) as Promise<T>;
const short = (text: string, max = 60) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** The spider's speech: types a line out while his mouth moves; a click finishes it or goes to the next. */
const speech = (() => {
  const spider = document.getElementById("spider")!;
  const bubble = document.getElementById("bubble")!;
  const typed = document.getElementById("typed")!;
  const said = document.getElementById("said")!;
  const more = document.getElementById("more")!;
  spider.insertAdjacentHTML("beforeend", heroSpiderSvg());
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let lines = [""];
  let key = "";
  let line = 0;
  let shown = 0;
  let hold = 0;

  const draw = () => {
    const text = lines[line] ?? "";
    const typing = shown < text.length;
    typed.textContent = text.slice(0, shown);
    said.textContent = text;
    more.hidden = typing;
    spider.classList.toggle("talking", typing && text.charAt(shown) !== " " && Math.floor(shown / 2) % 2 === 0);
  };
  const next = () => {
    line = (line + 1) % lines.length;
    shown = reduce ? lines[line].length : 0;
    hold = 0;
    draw();
  };
  bubble.addEventListener("click", () => {
    if (shown < (lines[line] ?? "").length) { shown = lines[line].length; hold = 0; draw(); }
    else if (lines.length > 1) next();
  });
  setInterval(() => {
    const text = lines[line] ?? "";
    if (shown < text.length) { shown += 1; draw(); }
    else if (lines.length > 1 && ++hold > 70) next();
  }, 45);

  return (next: string[], alert = false) => {
    const nextKey = `${alert}|${next.join("\n")}`;
    if (nextKey === key) return;
    key = nextKey;
    lines = next.length ? next : [""];
    line = 0;
    shown = reduce ? lines[0].length : 0;
    hold = 0;
    bubble.classList.toggle("alert", alert);
    draw();
  };
})();

/** What the spider says, from what's on the tab and what Unnepo is doing. */
function lines(state: PanelState): { lines: string[]; alert?: boolean } {
  if (!state.connected) return { lines: ["Hi! I'm the Unnepo spider.", "Connect your Unnepo account and I'll fill job applications for you.", "Your job-site passwords never leave this computer."] };
  const { job, page, me } = state;
  if (job?.error) return { lines: [job.error], alert: true };
  if (job?.step && (job.running || job.submission || job.report)) return { lines: [job.step] };
  if (!me!.profileReady) return { lines: ["Finish your profile on Unnepo first, so I have something to fill with."] };
  if (onLinkedIn(state)) return { lines: ["I don't read LinkedIn pages.", "Press Apply on LinkedIn to go to the company's own application, then press Autofill there."] };
  if (!jobFound(state) || !page) return { lines: ["I don't see a job on this page.", "Open a job posting, or paste a job description below and I'll write you a cover letter."] };
  const found = `${page.company || page.site} job found.${page.title ? ` ${short(page.title)}.` : ""}`;
  if (page.posting) return { lines: [found, "Press Autofill. I'll press Apply and crawl the whole thing for you."] };
  const extra = page.account === "new" ? ", and one new account to make" : page.account === "sign_in" ? ", and I'll sign you in" : "";
  return { lines: [found, `${page.fields} ${page.fields === 1 ? "field" : "fields"}${extra}.`, "Press Autofill and I'll crawl it for you."] };
}

function connectView(state: PanelState) {
  return `
    <section class="page" aria-label="Connect">
      <span class="eyebrow">Get started</span>
      <div class="job">
        <span class="job-title">Connect your Unnepo account</span>
        <span class="job-company">Unnepo fills applications from your profile. Connect once and the extension stays signed in.</span>
      </div>
      <a class="px" href="${escape(state.apiBase)}/extension/connect" target="_blank" rel="noreferrer">CONNECT ON UNNEPO</a>
      <p class="note">Or paste the code from the Connect page:</p>
      <div class="connect-code">
        <input class="field" type="text" id="code" placeholder="unx_…" autocomplete="off" spellcheck="false" aria-label="Connect code">
        <button type="button" class="solid" id="use-code">Use code</button>
      </div>
    </section>`;
}

function onLinkedIn(state: PanelState) {
  try { return Boolean(state.tab && NEVER_READ.test(new URL(state.tab.url).hostname)); } catch { return false; }
}

/** A job is on the tab: a posting, an application form, or one Unnepo is working on. */
function jobFound(state: PanelState) {
  const { job, page, tab } = state;
  const onWeb = Boolean(tab && /^https:\/\//.test(tab.url)) && !onLinkedIn(state);
  return onWeb && Boolean(job?.applicationId || job?.running || job?.report || page?.fields || page?.posting);
}

/** The home view. With a job on the tab: "<Company> job found" and the Fill button. Without one: paste a job description for a cover letter. */
function pageCard(state: PanelState) {
  if (!jobFound(state)) return pasteCard(state);
  const { job, page, tab, me } = state;
  const report = job?.report;
  let host = "";
  try { host = tab ? new URL(tab.url).hostname.replace(/^www\./, "") : ""; } catch { host = ""; }
  const site = page?.site || host;
  const title = job?.title || page?.title || tab!.title;
  const company = job?.company || page?.company || "";
  const chips: string[] = [];
  if (report?.filled.length) chips.push(`${report.filled.length} filled`);
  else if (page?.posting) chips.push("Job posting");
  else if (page?.fields) chips.push(`${page.fields} ${page.fields === 1 ? "field" : "fields"}`);
  if (page?.account === "new") chips.push("New account");
  if (page?.account === "sign_in") chips.push("Sign in");
  if (job?.submission) chips.push(job.submission === "confirmed" ? "Submitted" : "Looks submitted");
  const fill = job?.running
    ? `<button type="button" class="px stop" id="stop">STOP</button>`
    : `<button type="button" class="px" id="fill" ${me!.profileReady ? "" : "disabled"}>${report ? "FILL AGAIN" : "AUTOFILL"}</button>`;
  const links = [
    job?.applicationId && !job.submission && !job.running ? `<button type="button" class="link" id="applied">I applied</button>` : "",
    job?.submission ? `<button type="button" class="link" id="not-applied">I didn't apply</button>` : "",
  ].filter(Boolean);
  // What Unnepo couldn't fill that isn't already listed as needing the student. Each one goes to the question.
  const couldnt = (report?.failed ?? []).filter((item) => !report!.needsYou.includes(item.label));
  return `
    <section class="page" aria-label="This page">
      <span class="eyebrow">Job found${site ? ` · ${escape(site)}` : ""}</span>
      <div class="job">
        <span class="job-title">${escape(company || site || "This")} job found</span>
        ${title ? `<span class="job-company">${escape(title)}</span>` : ""}
      </div>
      ${chips.length ? `<div class="chips">${chips.map((chip) => `<span class="chip">${escape(chip)}</span>`).join("")}</div>` : ""}
      ${fill}
      ${report?.needsYou.length ? `<p class="note warn">Still needs you <span class="small">(outlined in orange on the page)</span>:</p><ul class="needs">${report.needsYou.map((label) => needsLink(label)).join("")}</ul>` : ""}
      ${couldnt.length ? `<p class="note">Couldn't fill:</p><ul class="needs">${couldnt.map((item) => needsLink(item.label, item.reason)).join("")}</ul>` : ""}
      ${(report?.needsYou.length || couldnt.length) && fieldNote ? `<p class="small" role="status">${escape(fieldNote)}</p>` : ""}
      ${job?.submission ? `<p class="note ok">${job.submission === "confirmed" ? "The site confirmed it." : "Looks submitted."} It's in your Unnepo tracker.</p>` : ""}
      ${links.length ? `<div class="links">${links.join("")}</div>` : ""}
      ${letterBlock()}
    </section>`;
}

/** No job on the tab: paste a job description and get a cover letter for it. */
let pasteText = "";

function pasteCard(state: PanelState) {
  const busy = letterStep === "writing" || letterStep === "revising";
  const linkedIn = onLinkedIn(state);
  return `
    <section class="page" aria-label="Cover letter">
      <span class="eyebrow">No job found on this page</span>
      <p class="note">${linkedIn ? "Unnepo doesn't read LinkedIn. Press Apply there to go to the company's own application, or paste the job description here." : "Open a job posting and Unnepo finds it. Or paste a job description here for a cover letter."}</p>
      <div class="letter-form">
        <label class="question"><span class="q-label">Job description</span>
          <textarea class="field letter-input paste" id="paste-desc" rows="7" maxlength="8000" placeholder="Paste the whole job posting: the role, the company, what they're looking for…">${escape(pasteText)}</textarea>
        </label>
        <button type="button" class="cv-button" id="paste-write" ${busy || pasteText.trim().length < 80 ? "disabled" : ""}>${SPARK}<span>${letterStep === "writing" ? "Writing…" : "Write cover letter"}</span></button>
      </div>
      ${letter ? writtenLetter(busy, false) : ""}
      ${letterNote ? `<p class="small" role="status">${escape(letterNote)}</p>` : ""}
    </section>`;
}

/**
 * The cover letter writer: "Write cover letter" asks a few quick questions (length, tone, anything to
 * mention), writes it, then offers a box for edits. Kept across re-renders of the panel.
 */
type Letter = { text: string; fileName: string; pdfBase64: string };
let letter: Letter | null = null;
let letterStep: "closed" | "asking" | "writing" | "written" | "revising" = "closed";
let letterNote = "";
/** The tab and job the letter is for. */
let letterFor = "";
const letterChoices = { length: "standard", tone: "professional", mention: "", edit: "" };

const SPARK = `<svg class="spark" width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9z"/><path d="M19 14l.9 2.6 2.6.9-2.6.9L19 21l-.9-2.6-2.6-.9 2.6-.9z" opacity=".7"/></svg>`;

const choice = (name: "length" | "tone", value: string, label: string) =>
  `<button type="button" class="choice${letterChoices[name] === value ? " on" : ""}" data-choice="${name}" data-value="${value}" aria-pressed="${letterChoices[name] === value}">${label}</button>`;

function letterBlock() {
  const busy = letterStep === "writing" || letterStep === "revising";
  if (letterStep === "closed") {
    return `<div class="cv"><button type="button" class="cv-button" id="letter-start">${SPARK}<span>Write cover letter</span></button></div>`;
  }
  const questions = letterStep === "asking" || (letterStep === "writing" && !letter) ? `
    <div class="letter-form" id="letter-form">
      <span class="eyebrow">Your cover letter</span>
      <div class="question"><span class="q-label">How long?</span>
        <div class="choices">${choice("length", "short", "Short")}${choice("length", "standard", "Standard")}${choice("length", "detailed", "Detailed")}</div>
      </div>
      <div class="question"><span class="q-label">What tone?</span>
        <div class="choices">${choice("tone", "professional", "Professional")}${choice("tone", "warm", "Warm")}${choice("tone", "confident", "Confident")}${choice("tone", "enthusiastic", "Enthusiastic")}</div>
      </div>
      <label class="question"><span class="q-label">Anything to mention? <span class="small">Optional</span></span>
        <textarea class="field letter-input" id="letter-mention" rows="2" maxlength="400" placeholder="A project, why this company, a skill to lead with…">${escape(letterChoices.mention)}</textarea>
      </label>
      <div class="links">
        <button type="button" class="solid" id="letter-write" ${busy ? "disabled" : ""}>${busy ? "Writing…" : "Write it"}</button>
        <button type="button" class="link" id="letter-cancel">Cancel</button>
      </div>
    </div>` : "";
  const written = letter && letterStep !== "asking" ? writtenLetter(busy, true) : "";
  return `<div class="cv">${questions}${written}${letterNote ? `<p class="small" role="status">${escape(letterNote)}</p>` : ""}</div>`;
}

/** The letter, with Copy and PDF, and a box for edits. */
function writtenLetter(busy: boolean, forJob: boolean) {
  return `
    <div class="letter-form" id="letter-form">
      <span class="eyebrow">Your cover letter</span>
      <textarea class="cv-text" readonly aria-label="Your cover letter">${escape(letter!.text)}</textarea>
      <div class="links">
        <button type="button" class="link" id="letter-copy">Copy</button>
        <button type="button" class="link" id="letter-download">Download PDF</button>
        <button type="button" class="link" id="letter-open">Open PDF</button>
      </div>
      <label class="question"><span class="q-label">Any edits you'd like to make?</span>
        <textarea class="field letter-input" id="letter-edit" rows="2" maxlength="600" placeholder="Shorter, mention my internship, sound more excited…">${escape(letterChoices.edit)}</textarea>
      </label>
      <div class="links">
        <button type="button" class="solid" id="letter-revise" ${busy || !letterChoices.edit.trim() ? "disabled" : ""}>${letterStep === "revising" ? "Rewriting…" : "Make these edits"}</button>
        ${forJob ? `<button type="button" class="link" id="letter-restart" ${busy ? "disabled" : ""}>Start over</button>` : ""}
      </div>
      <p class="small">Written from your profile and resume.${forJob ? " It's also what Unnepo attaches when this application asks for a cover letter." : ""}</p>
    </div>`;
}

const letterBlobUrl = () => {
  const bytes = Uint8Array.from(atob(letter!.pdfBase64), (char) => char.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
};

async function writeLetter(tabId: number, revise: boolean, fromPaste = false) {
  letterStep = revise ? "revising" : "writing";
  letterNote = "";
  void render();
  const options = revise
    ? { previous: letter?.text ?? "", edit: letterChoices.edit }
    : fromPaste ? {} : { length: letterChoices.length, tone: letterChoices.tone, mention: letterChoices.mention };
  type Result = { ok: boolean; doc?: Letter; error?: string };
  const result = await ask<Result>({ type: "generate-letter", tabId, options, ...(fromPaste ? { description: pasteText } : {}) }).catch((): Result => ({ ok: false, error: "Couldn't reach Unnepo." }));
  if (result.ok && result.doc) {
    letter = result.doc;
    letterStep = "written";
    if (revise) letterChoices.edit = "";
  } else {
    letterStep = letter ? "written" : "asking";
    letterNote = result.error ?? "Couldn't write the cover letter.";
  }
  // The panel doesn't redraw while a box has the cursor, so let go of it to show the letter.
  if (document.activeElement?.closest(".letter-form")) (document.activeElement as HTMLElement).blur();
  void render();
}

function wireLetter(tabId: number) {
  const go = (step: typeof letterStep) => { letterStep = step; letterNote = ""; void render(); };
  document.getElementById("letter-start")?.addEventListener("click", () => go("asking"));
  document.getElementById("letter-cancel")?.addEventListener("click", () => go(letter ? "written" : "closed"));
  document.getElementById("letter-restart")?.addEventListener("click", () => go("asking"));
  app.querySelectorAll<HTMLButtonElement>(".choice").forEach((button) => button.addEventListener("click", () => {
    letterChoices[button.dataset.choice as "length" | "tone"] = button.dataset.value ?? "";
    void render();
  }));
  const mention = document.getElementById("letter-mention") as HTMLTextAreaElement | null;
  mention?.addEventListener("input", () => { letterChoices.mention = mention.value; });
  const edits = document.getElementById("letter-edit") as HTMLTextAreaElement | null;
  const revise = document.getElementById("letter-revise") as HTMLButtonElement | null;
  edits?.addEventListener("input", () => {
    letterChoices.edit = edits.value;
    if (revise && letterStep === "written") revise.disabled = !edits.value.trim();
  });
  document.getElementById("letter-write")?.addEventListener("click", () => void writeLetter(tabId, false));
  const fromPaste = Boolean(document.getElementById("paste-desc"));
  revise?.addEventListener("click", () => void writeLetter(tabId, true, fromPaste));
  const paste = document.getElementById("paste-desc") as HTMLTextAreaElement | null;
  const pasteWrite = document.getElementById("paste-write") as HTMLButtonElement | null;
  paste?.addEventListener("input", () => {
    pasteText = paste.value;
    if (pasteWrite) pasteWrite.disabled = pasteText.trim().length < 80 || letterStep === "writing" || letterStep === "revising";
  });
  pasteWrite?.addEventListener("click", () => void writeLetter(tabId, false, true));
  document.getElementById("letter-copy")?.addEventListener("click", () => {
    void navigator.clipboard.writeText(letter!.text).then(() => { letterNote = "Copied."; void render(); }, () => { letterNote = "Couldn't copy. Select the text and copy it."; void render(); });
  });
  document.getElementById("letter-download")?.addEventListener("click", () => {
    const link = document.createElement("a");
    link.href = letterBlobUrl();
    link.download = letter!.fileName;
    link.click();
  });
  document.getElementById("letter-open")?.addEventListener("click", () => void chrome.tabs.create({ url: letterBlobUrl() }));
}

/** A question in the panel's lists: clicking it scrolls the page to it. */
const needsLink = (label: string, why = "") =>
  `<li><button type="button" class="needs-link" data-label="${escape(label)}" title="${escape(why || "Go to this question on the page")}">${escape(label)}<span aria-hidden="true">↗</span></button></li>`;

/** Why the last "Still needs you" click couldn't find its question, kept across re-renders. */
let fieldNote = "";

/** Scrolls the job page to a question the student still has to answer, and highlights it. */
async function goToField(tabId: number, label: string) {
  const result = await ask<{ ok: boolean }>({ type: "focus-field", tabId, label }).catch(() => ({ ok: false }));
  fieldNote = result.ok ? "" : `Couldn't find "${label}" on this page. It may be on another step of the form.`;
  void render();
}

/** What happened with the last See / Replace, kept across re-renders. */
let resumeNote = "";
let resumeBusy = false;

function resumeRow(state: PanelState) {
  const resume = state.me!.resume;
  const when = resume ? new Date(resume.uploadedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
  const name = resume ? escape(resume.fileName) : "No resume yet";
  return `
    <div class="secret resume-row">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; color: var(--muted)"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path></svg>
      ${resume?.file
        ? `<button type="button" class="resume-link" id="open-resume" title="Open ${name}" ${resumeBusy ? "disabled" : ""}><span class="resume-link-name">${name}</span><span aria-hidden="true">↗</span></button>`
        : `<span class="secret-text resume-name" title="${name}">${name}</span>`}
      ${resume?.file ? `<button type="button" class="inline" id="see-resume" ${resumeBusy ? "disabled" : ""}>See</button>` : ""}
      <button type="button" class="inline" id="replace-resume" ${resumeBusy ? "disabled" : ""}>${resume ? "Replace" : "Upload"}</button>
    </div>
    <span class="small" role="status">${resumeNote ? escape(resumeNote) : resume && !resume.file ? "Unnepo only has this resume's text, not the file. Upload it again so it can be attached." : resume ? `Uploaded ${when} · attached to every application` : "Upload a PDF or DOCX. It's attached to every application."}</span>`;
}

async function seeResume() {
  resumeBusy = true;
  resumeNote = "Opening…";
  void render();
  const result = await ask<{ ok: boolean; file?: { name: string; mime: string; base64: string }; error?: string }>({ type: "get-resume" });
  resumeBusy = false;
  if (result.ok && result.file) {
    const bytes = Uint8Array.from(atob(result.file.base64), (char) => char.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: result.file.mime }));
    void chrome.tabs.create({ url });
    resumeNote = "";
  } else {
    resumeNote = `${result.error ?? "Couldn't open your resume."} Replace it to fix this.`;
  }
  void render();
}

async function replaceResume(file: File) {
  if (!/\.(pdf|docx)$/i.test(file.name)) { resumeNote = "Choose a PDF or DOCX file."; return void render(); }
  if (file.size > 10 * 1024 * 1024) { resumeNote = "Resumes need to be 10 MB or smaller."; return void render(); }
  resumeBusy = true;
  resumeNote = "Uploading and reading your resume…";
  void render();
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  const result = await ask<{ ok: boolean; error?: string }>({ type: "upload-resume", name: file.name, mime: file.type || "application/pdf", base64: btoa(binary) });
  resumeBusy = false;
  resumeNote = result.ok ? "New resume saved. It goes on every application from now on." : result.error ?? "Upload failed.";
  void render();
}

function profileCard(state: PanelState) {
  const me = state.me!;
  const on = Math.round(me.completeness / 5);
  const missing = me.missing ?? [];
  return `
    <section class="profile" aria-label="Your profile">
      <div class="row">
        <span class="heading">Your profile</span>
        <span class="mono">${me.completeness}% READY · ${me.credits} ${me.credits === 1 ? "CREDIT" : "CREDITS"}</span>
      </div>
      <div class="blocks" role="progressbar" aria-label="Profile ready" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${me.completeness}">
        ${Array.from({ length: 20 }, (_, index) => `<span class="${index < on ? "on" : ""}"></span>`).join("")}
      </div>
      <a class="outline" href="${escape(state.apiBase)}/home?edit=profile" target="_blank" rel="noreferrer">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"></path></svg>
        Edit my info
      </a>
      ${resumeRow(state)}
      ${me.profileReady ? "" : `<span class="small" style="color: var(--warn)">Finish your profile so there's something to fill with.</span>`}
      ${missing.length ? `<span class="small">Missing: ${missing.map(escape).join(", ")}</span>` : ""}
    </section>`;
}

/** The running issues list in Profile: loaded from the background worker, newest first. */
let issueList: Issue[] | null = null;
let issueNote = "";
let issuesLoading = false;

async function loadIssues() {
  if (issuesLoading) return;
  issuesLoading = true;
  const result = await ask<{ issues?: Issue[] }>({ type: "list-issues" }).catch(() => ({ issues: [] }));
  issuesLoading = false;
  issueList = result.issues ?? [];
  void render();
}

const KIND: Record<Issue["kind"], string> = { fill: "Didn't fill", site: "Site error", stopped: "Stopped", note: "Your note" };
const when = (at: string) => new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** The whole list as plain text, to paste into a chat with Claude. */
function issuesText(list: Issue[]) {
  const head = `Unnepo extension issues (V${extensionVersion()}), copied ${new Date().toLocaleString()}. ${list.length} ${list.length === 1 ? "entry" : "entries"}, newest first.`;
  const rows = list.map((issue, index) => [
    `${index + 1}. ${when(issue.at)} · ${KIND[issue.kind]} · ${issue.site || "no page"}`,
    issue.question ? `   Question: ${issue.question}` : "",
    `   ${issue.what}`,
    issue.page ? `   Page: ${issue.page}` : "",
  ].filter(Boolean).join("\n"));
  return [head, "", ...rows].join("\n");
}

function issuesCard() {
  if (!issueList) void loadIssues();
  const list = issueList ?? [];
  return `
    <section class="view issues" aria-label="Issues">
      <div class="row"><span class="heading">Issues</span><span class="mono">${list.length} SAVED</span></div>
      <p class="small">Problems Unnepo ran into, and ones you report. Copy them all to send to support. Kept only on this computer.</p>
      <div class="letter-form">
        <textarea class="field letter-input" id="issue-note" rows="2" maxlength="500" placeholder="What went wrong? (saved with this tab's page)" aria-label="Report a problem">${escape(issueNote)}</textarea>
        <div class="links">
          <button type="button" class="solid" id="add-issue" ${issueNote.trim() ? "" : "disabled"}>Report a problem</button>
          ${list.length ? `<button type="button" class="link" id="copy-issues">Copy all</button><button type="button" class="link" id="clear-issues">Clear</button>` : ""}
        </div>
        <span class="small" id="issues-status" role="status"></span>
      </div>
      ${!issueList ? `<p class="note">Loading…</p>` : !list.length ? `<p class="note">Nothing yet. Problems show up here as Unnepo fills applications.</p>` : `
        <ul class="issue-list">${list.slice(0, 50).map((issue) => `
          <li>
            <span class="issue-top"><span class="status${issue.kind === "note" ? " done" : ""}">${KIND[issue.kind]}</span><span class="mono">${escape(when(issue.at))}</span></span>
            ${issue.question ? `<span class="issue-question">${escape(short(issue.question, 80))}</span>` : ""}
            <span class="small">${escape(short(issue.what, 160))}</span>
            ${issue.site ? `<span class="mono">${escape(issue.site)}</span>` : ""}
          </li>`).join("")}</ul>
        ${list.length > 50 ? `<p class="small">Showing the newest 50. Copy all includes all ${list.length}.</p>` : ""}`}
    </section>`;
}

function wireIssues() {
  const note = document.getElementById("issue-note") as HTMLTextAreaElement | null;
  const add = document.getElementById("add-issue") as HTMLButtonElement | null;
  const said = (text: string) => { const status = document.getElementById("issues-status"); if (status) status.textContent = text; };
  note?.addEventListener("input", () => {
    issueNote = note.value;
    if (add) add.disabled = !note.value.trim();
  });
  add?.addEventListener("click", async () => {
    const text = issueNote.trim();
    if (!text) return;
    await ask({ type: "add-issue", note: text });
    issueNote = "";
    issueList = null;
    void render();
  });
  document.getElementById("copy-issues")?.addEventListener("click", async () => {
    await navigator.clipboard.writeText(issuesText(issueList ?? [])).then(() => said("Copied. Paste it into your chat."), () => said("Couldn't copy. Try again."));
  });
  document.getElementById("clear-issues")?.addEventListener("click", async () => {
    if (!confirm("Clear the issues list? Copy it first if you still need it.")) return;
    await ask({ type: "clear-issues" });
    issueList = null;
    void render();
  });
}

/**
 * The job-site password. Drawn on its own, not with the rest of the panel, so a password being typed
 * isn't wiped when the panel refreshes.
 */
let passwordMode: "hidden" | "shown" | "editing" = "hidden";
let passwordNote = "";

async function renderPassword() {
  const { password } = await ask<{ password?: string }>({ type: "get-password" });
  if (!password) return;
  const rules = (value: string) => PASSWORD_RULES.map((rule) => `<li class="${rule.test(value) ? "met" : ""}">${escape(rule.label)}</li>`).join("");
  passwordSection.innerHTML = `
    <span class="eyebrow">Job-site password</span>
    <p class="note" style="color: var(--muted)">Used to make accounts and sign in. Stays on this computer, never goes to Unnepo.</p>
    ${passwordMode === "editing" ? `
      <input class="field" type="text" id="new-password" autocomplete="off" spellcheck="false" placeholder="Your new password" aria-label="New password">
      <ul class="rules" id="rules">${rules("")}</ul>
      <p class="small">Accounts Unnepo already made keep working with the password they were made with.</p>
      <div class="links"><button type="button" class="solid" id="save-password" disabled>Save password</button><button type="button" class="link" id="cancel-password">Cancel</button></div>
    ` : `
      <div class="secret">
        <span class="secret-text">${passwordMode === "shown" ? escape(password) : "•".repeat(Math.min(password.length, 16))}</span>
        <button type="button" class="inline" id="toggle-password">${passwordMode === "shown" ? "Hide" : "Show"}</button>
        <button type="button" class="inline" id="copy-password">Copy</button>
      </div>
      <div class="links">
        <button type="button" class="link" id="change-password">Change</button>
        <button type="button" class="link" id="regenerate-password">Make a new one</button>
      </div>
    `}
    ${passwordNote ? `<p class="small" role="status">${escape(passwordNote)}</p>` : ""}`;
  const redraw = (mode: typeof passwordMode, note = "") => { passwordMode = mode; passwordNote = note; void renderPassword(); };
  document.getElementById("toggle-password")?.addEventListener("click", () => redraw(passwordMode === "shown" ? "hidden" : "shown"));
  document.getElementById("copy-password")?.addEventListener("click", async () => {
    await navigator.clipboard.writeText(password).then(() => redraw(passwordMode, "Copied."), () => redraw(passwordMode, "Couldn't copy. Press Show and copy it yourself."));
  });
  document.getElementById("change-password")?.addEventListener("click", () => redraw("editing"));
  document.getElementById("cancel-password")?.addEventListener("click", () => redraw("hidden"));
  document.getElementById("regenerate-password")?.addEventListener("click", async () => {
    if (!confirm("Make a new password? Accounts Unnepo already made keep working: it remembers the password each one was made with. Accounts you made yourself aren't changed.")) return;
    await ask({ type: "new-password" });
    redraw("shown", "New password made.");
  });
  const input = document.getElementById("new-password") as HTMLInputElement | null;
  const save = document.getElementById("save-password") as HTMLButtonElement | null;
  input?.focus();
  input?.addEventListener("input", () => {
    document.getElementById("rules")!.innerHTML = rules(input.value);
    save!.disabled = unmetRules(input.value).length > 0;
  });
  save?.addEventListener("click", async () => {
    const result = await ask<{ ok: boolean; unmet?: string[] }>({ type: "set-password", value: input!.value });
    if (result.ok) redraw("hidden", "Password saved.");
    else passwordNote = `Still needs: ${(result.unmet ?? []).join(", ").toLowerCase()}.`;
  });
}

/** "My jobs": the newest jobs in Unnepo, each opening its page in Unnepo, and a link to the full tracker. */
type JobRow = { id: string; title: string; company: string; status: string; url: string; submittedAt: string | null; createdAt: string };
let jobsList: { rows: JobRow[]; total: number; error: string; loadedAt: number } | null = null;
let jobsLoading = false;

const STATUS: Record<string, string> = {
  extracted: "Saved", filling: "Filling", review: "To review", submitting: "Submitting", submitted: "Applied",
  unconfirmed: "Check email", applied_manual: "Applied", failed: "Didn't go through",
};

async function loadJobs() {
  if (jobsLoading) return;
  jobsLoading = true;
  const result = await ask<{ ok: boolean; jobs?: JobRow[]; total?: number; error?: string }>({ type: "list-jobs" }).catch(() => ({ ok: false, error: "Couldn't reach Unnepo." }) as const);
  jobsLoading = false;
  jobsList = { rows: result.ok ? result.jobs ?? [] : [], total: result.ok ? result.total ?? 0 : 0, error: result.ok ? "" : result.error ?? "Couldn't load your jobs.", loadedAt: Date.now() };
  void render();
}

function jobsView(state: PanelState) {
  if (!jobsList || Date.now() - jobsList.loadedAt > 30_000) void loadJobs();
  const rows = jobsList?.rows ?? [];
  const body = !jobsList
    ? `<p class="note">Loading your jobs…</p>`
    : jobsList.error
      ? `<p class="note error">${escape(jobsList.error)}</p>`
      : !rows.length
        ? `<p class="note">No jobs yet. Open a job posting and press Autofill, and it shows up here.</p>`
        : `<ul class="jobs-list">${rows.map((row) => `
            <li><button type="button" class="job-row" data-url="${escape(`${state.apiBase}/home?job=${encodeURIComponent(row.id)}`)}" title="Open this job in Unnepo">
              <span class="job-row-text"><span class="job-row-title">${escape(row.title || "Job")}</span><span class="job-row-company">${escape(row.company)}</span></span>
              <span class="status${row.status === "submitted" || row.status === "applied_manual" ? " done" : ""}">${escape(STATUS[row.status] ?? row.status)}</span>
            </button></li>`).join("")}</ul>`;
  return `
    <section class="view" aria-label="My jobs">
      <div class="row"><span class="heading">My jobs</span>${jobsList && !jobsList.error ? `<span class="mono">${jobsList.total} IN ALL</span>` : ""}</div>
      ${body}
      <a class="outline" href="${escape(state.apiBase)}/home" target="_blank" rel="noreferrer">Open my tracker on Unnepo</a>
    </section>`;
}

/** Settings: submitting, then the job-site password and sign out (drawn outside this card). */
function settingsView(state: PanelState) {
  return `
    <section class="view" aria-label="Settings">
      <span class="heading">Settings</span>
      <label class="check"><input type="checkbox" id="pause" ${state.autoSubmit ? "" : "checked"}>Let me press Submit myself.</label>
      <p class="small">On: Unnepo fills every page and stops at Submit for you to check. Off: it submits for you.</p>
    </section>`;
}

// The file picker lives outside the redrawn part of the panel, so a refresh can't lose the chosen file.
const resumeInput = document.getElementById("resume-input") as HTMLInputElement;
resumeInput.addEventListener("change", () => {
  const file = resumeInput.files?.[0];
  resumeInput.value = "";
  if (file) void replaceResume(file);
});

document.getElementById("version")!.textContent = `V${extensionVersion()}`;
document.getElementById("disconnect")!.addEventListener("click", async () => {
  await ask({ type: "disconnect" });
  void render();
});

async function render() {
  const state = await ask<PanelState>({ type: "state" });
  // A letter belongs to one job: opening another job (another tab, or another one in Handshake's search) closes it.
  // Keyed by the job's name, not the address, so the steps of one application keep it.
  const jobName = (state.job?.title || state.page?.title || "").toLowerCase();
  const letterJob = state.tab && jobName ? `${state.tab.id}|${jobName}` : letterFor;
  if (letterJob !== letterFor) {
    if (letterFor && letterStep !== "writing" && letterStep !== "revising") { letter = null; letterStep = "closed"; letterNote = ""; letterChoices.mention = ""; letterChoices.edit = ""; }
    letterFor = letterJob;
  }
  account.textContent = state.connected ? state.me!.user.email : "";
  const said = lines(state);
  speech(said.lines, said.alert);
  if (!state.connected) view = "home";
  menu.hidden = !state.connected;
  menu.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
    if (button.dataset.view === view) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  speechSection.hidden = view !== "home";
  const wasHidden = passwordSection.hidden;
  passwordSection.hidden = !state.connected || view !== "settings";
  footer.hidden = !state.connected || view !== "settings";
  if (state.connected && wasHidden) void renderPassword();
  // Don't wipe a code being typed when something else changes.
  if (!state.connected && document.getElementById("code") === document.activeElement) return;
  // Don't wipe what's being typed in the cover letter questions or edits box when the page changes.
  // The same for a problem being reported.
  if (document.activeElement?.closest(".letter-form") && document.activeElement.matches("textarea")) return;
  const views: Record<View, () => string> = { home: () => pageCard(state), jobs: () => jobsView(state), profile: () => profileCard(state) + issuesCard(), settings: () => settingsView(state) };
  app.innerHTML = state.connected ? views[view]() : connectView(state);
  // A job opens on its own page in Unnepo, the tracker with its details open.
  app.querySelectorAll<HTMLButtonElement>(".job-row").forEach((button) => button.addEventListener("click", () => {
    const url = button.dataset.url ?? "";
    if (url.startsWith(`${state.apiBase}/home?job=`)) void chrome.tabs.create({ url });
  }));
  document.getElementById("use-code")?.addEventListener("click", async () => {
    const code = (document.getElementById("code") as HTMLInputElement).value.trim();
    if (code.startsWith("unx_")) await ask({ type: "connect", token: code });
    void render();
  });
  document.getElementById("fill")?.addEventListener("click", () => void ask({ type: "fill", tabId: state.tab!.id }));
  document.getElementById("stop")?.addEventListener("click", () => void ask({ type: "stop", tabId: state.tab!.id }));
  if (state.tab) wireLetter(state.tab.id);
  document.getElementById("see-resume")?.addEventListener("click", () => void seeResume());
  document.getElementById("open-resume")?.addEventListener("click", () => void seeResume());
  app.querySelectorAll<HTMLButtonElement>(".needs-link").forEach((button) => button.addEventListener("click", () => void goToField(state.tab!.id, button.dataset.label ?? "")));
  document.getElementById("replace-resume")?.addEventListener("click", () => resumeInput.click());
  document.getElementById("applied")?.addEventListener("click", () => void ask({ type: "applied", tabId: state.tab!.id }));
  document.getElementById("not-applied")?.addEventListener("click", () => void ask({ type: "not-applied", tabId: state.tab!.id }));
  if (view === "profile") wireIssues();
  document.getElementById("pause")?.addEventListener("change", (event) => void ask({ type: "set-auto-submit", value: !(event.target as HTMLInputElement).checked }));
}

menu.querySelectorAll<HTMLButtonElement>("button").forEach((button) => button.addEventListener("click", () => {
  view = (button.dataset.view as View) ?? "home";
  if (view === "jobs") jobsList = null;
  window.scrollTo(0, 0);
  void render();
}));

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "state-changed") return;
  // New problems may have been added; Profile reads the list again.
  if (view === "profile") void loadIssues();
  else void render();
});
chrome.tabs.onUpdated.addListener((_id, info) => {
  if (info.status === "complete") void render();
});
void render();
