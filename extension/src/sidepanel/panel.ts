import { heroSpiderSvg } from "../shared/hero-spider";
import { PASSWORD_RULES, unmetRules } from "../shared/password";
import { NEVER_READ, type PanelState } from "../shared/types";

/**
 * The side panel ("Spider guide" design): the spider talks you through what's on the tab and what
 * Unnepo is doing, the card below fills the application, then your profile and job-site password.
 */

const app = document.getElementById("app")!;
const account = document.getElementById("account")!;
const passwordSection = document.getElementById("password")!;
const footer = document.getElementById("footer")!;

const escape = (text: string) => text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
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
  if (!state.tab || !/^https:\/\//.test(state.tab.url)) return { lines: ["Open a job posting or an application in this tab.", "Then press Fill and I'll crawl it for you."] };
  if (onLinkedIn(state)) return { lines: ["I don't read LinkedIn pages.", "Press Apply on LinkedIn to go to the company's own application, then press Fill there."] };
  if (!page || (!page.fields && !page.posting)) return { lines: ["I don't see an application on this page yet.", "Open the job posting or its application, then press Fill."] };
  const found = `Found a job on ${page.site}.${page.title ? ` ${short(page.title)}.` : ""}`;
  if (page.posting) return { lines: [found, "Press Fill. I'll press Apply and crawl the whole thing for you."] };
  const extra = page.account === "new" ? ", and one new account to make" : page.account === "sign_in" ? ", and I'll sign you in" : "";
  return { lines: [found, `${page.fields} ${page.fields === 1 ? "field" : "fields"}${extra}.`, "Press Fill and I'll crawl it for you."] };
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

function pageCard(state: PanelState) {
  const { job, page, tab, me } = state;
  const onWeb = Boolean(tab && /^https:\/\//.test(tab.url)) && !onLinkedIn(state);
  const report = job?.report;
  let host = "";
  try { host = tab ? new URL(tab.url).hostname.replace(/^www\./, "") : ""; } catch { host = ""; }
  const site = page?.site || host;
  const title = job?.title || page?.title || (onWeb ? tab!.title : "");
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
    : `<button type="button" class="px" id="fill" ${me!.profileReady && onWeb ? "" : "disabled"}>${report ? "FILL AGAIN" : "FILL THIS APPLICATION"}</button>`;
  const links = [
    job?.applicationId && !job.submission && !job.running ? `<button type="button" class="link" id="applied">I applied</button>` : "",
    job?.submission ? `<button type="button" class="link" id="not-applied">I didn't apply</button>` : "",
  ].filter(Boolean);
  // What Unnepo couldn't fill that isn't already listed as needing the student. Each one goes to the question.
  const couldnt = (report?.failed ?? []).filter((item) => !report!.needsYou.includes(item.label));
  // The cover letter writer shows on any job page: a posting, an application, or a job Unnepo is working on.
  const letterOffered = onWeb && Boolean(job?.applicationId || page?.fields || page?.posting);
  return `
    <section class="page" aria-label="This page">
      <span class="eyebrow">On this page${site ? ` · ${escape(site)}` : ""}</span>
      ${onWeb ? `
        <div class="job">
          <span class="job-title">${escape(title || "This page")}</span>
          ${company ? `<span class="job-company">${escape(company)}</span>` : ""}
        </div>
        ${chips.length ? `<div class="chips">${chips.map((chip) => `<span class="chip">${escape(chip)}</span>`).join("")}</div>` : ""}
      ` : `<p class="note">Open a job application in this tab.</p>`}
      ${fill}
      ${report?.needsYou.length ? `<p class="note warn">Still needs you <span class="small">(outlined in orange on the page)</span>:</p><ul class="needs">${report.needsYou.map((label) => needsLink(label)).join("")}</ul>` : ""}
      ${couldnt.length ? `<p class="note">Couldn't fill:</p><ul class="needs">${couldnt.map((item) => needsLink(item.label, item.reason)).join("")}</ul>` : ""}
      ${(report?.needsYou.length || couldnt.length) && fieldNote ? `<p class="small" role="status">${escape(fieldNote)}</p>` : ""}
      ${job?.submission ? `<p class="note ok">${job.submission === "confirmed" ? "The site confirmed it." : "Looks submitted."} It's in your Unnepo tracker.</p>` : ""}
      ${links.length ? `<div class="links">${links.join("")}</div>` : ""}
      ${letterOffered ? letterBlock() : ""}
      <label class="check"><input type="checkbox" id="pause" ${state.autoSubmit ? "" : "checked"}>Let me press Submit myself.</label>
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
  const written = letter && letterStep !== "asking" ? `
    <div class="letter-form" id="letter-form">
      <span class="eyebrow">Your cover letter</span>
      <textarea class="cv-text" readonly aria-label="Your cover letter">${escape(letter.text)}</textarea>
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
        <button type="button" class="link" id="letter-restart" ${busy ? "disabled" : ""}>Start over</button>
      </div>
      <p class="small">Written from your profile and resume. It's also what Unnepo attaches when this application asks for a cover letter.</p>
    </div>` : "";
  return `<div class="cv">${questions}${written}${letterNote ? `<p class="small" role="status">${escape(letterNote)}</p>` : ""}</div>`;
}

const letterBlobUrl = () => {
  const bytes = Uint8Array.from(atob(letter!.pdfBase64), (char) => char.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
};

async function writeLetter(tabId: number, revise: boolean) {
  letterStep = revise ? "revising" : "writing";
  letterNote = "";
  void render();
  const options = revise
    ? { previous: letter?.text ?? "", edit: letterChoices.edit }
    : { length: letterChoices.length, tone: letterChoices.tone, mention: letterChoices.mention };
  type Result = { ok: boolean; doc?: Letter; error?: string };
  const result = await ask<Result>({ type: "generate-letter", tabId, options }).catch((): Result => ({ ok: false, error: "Couldn't reach Unnepo." }));
  if (result.ok && result.doc) {
    letter = result.doc;
    letterStep = "written";
    if (revise) letterChoices.edit = "";
  } else {
    letterStep = letter ? "written" : "asking";
    letterNote = result.error ?? "Couldn't write the cover letter.";
  }
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
  revise?.addEventListener("click", () => void writeLetter(tabId, true));
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

// The file picker lives outside the redrawn part of the panel, so a refresh can't lose the chosen file.
const resumeInput = document.getElementById("resume-input") as HTMLInputElement;
resumeInput.addEventListener("change", () => {
  const file = resumeInput.files?.[0];
  resumeInput.value = "";
  if (file) void replaceResume(file);
});

document.getElementById("version")!.textContent = `V${chrome.runtime.getManifest().version}`;
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
  const wasHidden = passwordSection.hidden;
  passwordSection.hidden = !state.connected;
  footer.hidden = !state.connected;
  if (state.connected && wasHidden) void renderPassword();
  // Don't wipe a code being typed when something else changes.
  if (!state.connected && document.getElementById("code") === document.activeElement) return;
  // Don't wipe what's being typed in the cover letter questions or edits box when the page changes.
  if (document.activeElement?.closest("#letter-form") && document.activeElement.matches("textarea")) return;
  app.innerHTML = state.connected ? pageCard(state) + profileCard(state) : connectView(state);
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
  document.getElementById("pause")?.addEventListener("change", (event) => void ask({ type: "set-auto-submit", value: !(event.target as HTMLInputElement).checked }));
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "state-changed") void render();
});
chrome.tabs.onUpdated.addListener((_id, info) => {
  if (info.status === "complete") void render();
});
void render();
