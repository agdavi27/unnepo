import type { SpiderLook } from "@/lib/spiders";
import { heroSpiderSvg } from "../shared/hero-spider";
import { PASSWORD_RULES, unmetRules } from "../shared/password";
import { NEVER_READ, type Issue, type PanelState } from "../shared/types";

/**
 * The side panel ("Spider guide" design): the spider talks you through what's on the tab and what
 * Unnepo is doing, the card below fills the application, then your profile and job-site password.
 */

const app = document.getElementById("app")!;
const account = document.getElementById("account")!;
const dashboard = document.getElementById("dashboard") as HTMLAnchorElement;
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
  if (onLinkedIn(state)) return { lines: ["I don't read LinkedIn pages.", "Applied with Easy Apply? Add it to your tracker below. Otherwise press Apply to go to the company's own application, then Autofill there."] };
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

/** Unnepo's own site: its pages list jobs, but none of them is a job to apply to. */
function onUnnepo(state: PanelState) {
  try { return Boolean(state.tab && new URL(state.tab.url).origin === new URL(state.apiBase).origin); } catch { return false; }
}
function unnepoCard() {
  return `
    <section class="page" aria-label="Unnepo">
      <p class="note">This is your Unnepo dashboard. Open a job posting or an application, and the panel finds the job there.</p>
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
  if (report?.needsYou.length) chips.push(`${report.needsYou.length} need you`);
  if (report?.check?.length) chips.push(`${report.check.length} to check`);
  else if (page?.posting && !foundCardShowing(state)) chips.push("Job posting");
  else if (page?.fields) chips.push(`${page.fields} ${page.fields === 1 ? "field" : "fields"}`);
  if (page?.account === "new") chips.push("New account");
  if (page?.account === "sign_in") chips.push("Sign in");
  if (job?.submission) chips.push(job.submission === "confirmed" ? "Submitted" : "Looks submitted");
  const fill = job?.running
    ? `<button type="button" class="px stop" id="stop">STOP</button>`
    : `<button type="button" class="px" id="fill" ${me!.profileReady ? "" : "disabled"}>${report ? "FILL AGAIN" : "AUTOFILL"}</button>`;
  // What Unnepo couldn't fill that isn't already listed as needing the student. Each one goes to the question.
  const couldnt = (report?.failed ?? []).filter((item) => !report!.needsYou.includes(item.label));
  // One list of what's left, most urgent first: empty required questions, ones Unnepo couldn't fill, answers to check.
  const todo = [
    ...(report?.needsYou ?? []).map((label) => ({ kind: "needs", label, why: "" })),
    ...couldnt.map((item) => ({ kind: "failed", label: item.label, why: item.reason })),
    ...(report?.check ?? []).map((item) => ({ kind: "check", label: item.label, why: item.why })),
  ];
  // The job found card above already names the job: this one is just for filling the application.
  const named = !foundCardShowing(state);
  return `${setupCard(state)}
    <section class="page" aria-label="${named ? "This page" : "Autofill"}">
      ${named ? `<span class="eyebrow">Job found${site ? ` · ${escape(site)}` : ""}</span>
      <div class="job">
        <span class="job-title">${escape(company || site || "This")} job found</span>
        ${title ? `<span class="job-company">${escape(title)}</span>` : ""}
      </div>` : `<span class="eyebrow">Autofill the application</span>`}
      ${chips.length ? `<div class="chips">${chips.map((chip) => `<span class="chip">${escape(chip)}</span>`).join("")}</div>` : ""}
      ${job?.running || report
        ? `<p class="small resume-line">Resume: ${escape(me!.resume?.fileName ?? "none yet")}${me!.resume?.file ? " ✓" : ""}</p>`
        : `<span class="eyebrow">Resume Unnepo attaches</span>${resumeRow(state)}`}
      ${fill}
      ${todo.length ? `<p class="note${report?.needsYou.length ? " warn" : ""}">Left to do · ${todo.length} <span class="small">(the checklist on the page walks you through)</span>:</p>
        <ul class="needs todo">${todo.map((item) => `<li class="todo-row"><span class="tag ${item.kind}">${item.kind === "needs" ? "Needs you" : item.kind === "failed" ? "Couldn't fill" : "Check"}</span>${needsLink(item.label, item.why).replace(/^<li>|<\/li>$/g, "")}</li>`).join("")}</ul>` : ""}
      ${todo.length && fieldNote ? `<p class="small" role="status">${escape(fieldNote)}</p>` : ""}
      ${job?.submission && here.step !== "saved" ? `<p class="note ok">${job.submission === "confirmed" ? "The site confirmed it." : "Looks submitted."} It's in your Unnepo tracker.</p>` : ""}
      ${letterBlock()}
    </section>`;
}

/**
 * LinkedIn, which Unnepo never reads: after applying there (Easy Apply), the student adds the job to their
 * tracker themselves. The title and company start from the tab's name ("Growth Intern | MealPal | LinkedIn").
 */
const linkedInJob = { key: "", title: "", company: "", description: "", note: "", saving: false };
function linkedInCard(state: PanelState) {
  const key = state.tab?.url ?? "";
  if (linkedInJob.key !== key) {
    const parts = (state.tab?.title ?? "").replace(/^\(\d+\)\s*/, "").split(" | ").map((part) => part.trim());
    const named = parts.length >= 3 && /linkedin/i.test(parts.at(-1)!);
    Object.assign(linkedInJob, { key, title: named ? parts[0] : "", company: named ? parts[1] : "", description: "", note: "", saving: false });
  }
  const ready = linkedInJob.title.trim() && linkedInJob.company.trim();
  // Easy Apply was noticed and saved: say so, with a way to take it back.
  const jobIdOf = (raw: string) => {
    try {
      const address = new URL(raw);
      return address.pathname.match(/\/jobs\/view\/(\d+)/)?.[1] ?? address.searchParams.get("currentJobId") ?? "";
    } catch {
      return "";
    }
  };
  const savedUrl = (state.job as { url?: string } | null)?.url ?? "";
  const thisJob = jobIdOf(key);
  if (state.job?.submission && state.job.applicationId && (!thisJob || jobIdOf(savedUrl) === thisJob)) {
    return `
    <section class="page" aria-label="LinkedIn job saved">
      <span class="eyebrow">Applied on LinkedIn</span>
      <p class="note ok">${escape(state.job.step || "Saved to your tracker.")}</p>
    </section>`;
  }
  return `
    <section class="page" aria-label="Add a LinkedIn job">
      <span class="eyebrow">Applied on LinkedIn?</span>
      <p class="note">Unnepo doesn't read LinkedIn pages. If you applied, add the job here: the title and company come from the tab.</p>
      <div class="letter-form">
        <label class="question"><span class="q-label">Job title</span><input class="field" id="li-title" value="${escape(linkedInJob.title)}" maxlength="200" placeholder="Growth Marketing Intern"></label>
        <label class="question"><span class="q-label">Company</span><input class="field" id="li-company" value="${escape(linkedInJob.company)}" maxlength="200" placeholder="MealPal"></label>
        <label class="question"><span class="q-label">Job description (optional)</span><textarea class="field letter-input" id="li-description" rows="3" maxlength="8000" placeholder="Paste it to keep it with the job, for cover letters and finding people">${escape(linkedInJob.description)}</textarea></label>
        <button type="button" class="solid" id="li-save" ${ready && !linkedInJob.saving ? "" : "disabled"}>${linkedInJob.saving ? "Adding…" : "I applied: add to tracker"}</button>
      </div>
      ${linkedInJob.note ? `<p class="small" role="status">${escape(linkedInJob.note)}</p>` : ""}
    </section>`;
}

function wireLinkedIn(tabId: number) {
  const input = (id: string, key: "title" | "company" | "description") => {
    const box = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
    box?.addEventListener("input", () => {
      linkedInJob[key] = box.value;
      const save = document.getElementById("li-save") as HTMLButtonElement | null;
      if (save) save.disabled = !linkedInJob.title.trim() || !linkedInJob.company.trim() || linkedInJob.saving;
    });
  };
  input("li-title", "title");
  input("li-company", "company");
  input("li-description", "description");
  document.getElementById("li-save")?.addEventListener("click", async () => {
    linkedInJob.saving = true;
    linkedInJob.note = "";
    void render();
    type Tracked = { ok: boolean; error?: string; title?: string; company?: string };
    const result = await ask<Tracked>({ type: "track-linkedin", tabId, title: linkedInJob.title, company: linkedInJob.company, description: linkedInJob.description })
      .catch((): Tracked => ({ ok: false, error: "Couldn't reach Unnepo." }));
    linkedInJob.saving = false;
    linkedInJob.note = result.ok ? `Added: ${result.title} at ${result.company}. It's in your Applied jobs.` : result.error ?? "Couldn't add it.";
    if (document.activeElement?.closest(".letter-form")) (document.activeElement as HTMLElement).blur();
    void render();
  });
}

/**
 * Before the first fill: the questions that hold up most forms, asked once, on one card. Skipping is fine;
 * the card comes back only when something new is missing.
 */
const SETUP_SKIPPED = "setupSkipped";
let setupSkipped: string | null = null;
void chrome.storage.local.get(SETUP_SKIPPED).then((stored) => { setupSkipped = (stored[SETUP_SKIPPED] as string | undefined) ?? ""; void render(); });
const setupDraft: Record<string, string | boolean | null> = {};
let setupNote = "";
let setupSaving = false;
const SETUP_KEYS = ["salaryExpectation", "earliestStart", "willingToRelocate", "inPerson", "authorizedUS", "needsSponsorship", "classYear"] as const;
const setupMissing = (setup: NonNullable<NonNullable<PanelState["me"]>["setup"]>) =>
  SETUP_KEYS.filter((key) => (key === "classYear" ? setup.hasSchool && !setup.classYear : setup[key] === null || setup[key] === ""));

function setupCard(state: PanelState) {
  const setup = state.me?.setup;
  // Asked before filling, never in the middle of one.
  if (!setup || setupSkipped === null || state.job?.running || state.job?.report) return "";
  const missing = setupMissing(setup);
  if (!missing.length || setupSkipped === missing.join(",")) return "";
  const yesNo = (key: string, question: string) => {
    const value = setupDraft[key];
    const pick = (on: boolean, label: string) => `<button type="button" class="choice${value === on ? " on" : ""}" data-setup="${key}" data-value="${on}" aria-pressed="${value === on}">${label}</button>`;
    return `<div class="question"><span class="q-label">${question}</span><div class="choices">${pick(true, "Yes")}${pick(false, "No")}</div></div>`;
  };
  const text = (key: string, question: string, placeholder: string) => `<label class="question"><span class="q-label">${question}</span><input class="field" data-setup-text="${key}" value="${escape(String(setupDraft[key] ?? ""))}" maxlength="80" placeholder="${placeholder}"></label>`;
  const fields: Record<(typeof SETUP_KEYS)[number], () => string> = {
    salaryExpectation: () => text("salaryExpectation", "Pay you're looking for", "$20/hour, or Open to discussion"),
    earliestStart: () => text("earliestStart", "Earliest start date", "June 2027"),
    willingToRelocate: () => yesNo("willingToRelocate", "Willing to relocate?"),
    inPerson: () => yesNo("inPerson", "Open to working in person?"),
    authorizedUS: () => yesNo("authorizedUS", "Authorized to work in the U.S.?"),
    needsSponsorship: () => yesNo("needsSponsorship", "Will you need visa sponsorship?"),
    classYear: () => `<label class="question"><span class="q-label">Year in school</span><select class="field" data-setup-text="classYear"><option value="">Choose…</option>${[["freshman", "Freshman"], ["sophomore", "Sophomore"], ["junior", "Junior"], ["senior", "Senior"], ["graduate", "Graduate student"]].map(([value, label]) => `<option value="${value}"${setupDraft.classYear === value ? " selected" : ""}>${label}</option>`).join("")}</select></label>`,
  };
  return `
    <section class="page" aria-label="Quick answers">
      <span class="eyebrow">Before you fill · ${missing.length} quick ${missing.length === 1 ? "answer" : "answers"}</span>
      <p class="note">Most forms ask these. Answer once and Unnepo fills them everywhere.</p>
      <div class="letter-form">${missing.map((key) => fields[key]()).join("")}
        <div class="links">
          <button type="button" class="solid" id="setup-save" ${setupSaving ? "disabled" : ""}>${setupSaving ? "Saving…" : "Save"}</button>
          <button type="button" class="link" id="setup-skip">Skip for now</button>
        </div>
      </div>
      ${setupNote ? `<p class="small" role="status">${escape(setupNote)}</p>` : ""}
    </section>`;
}

function wireSetup(state: PanelState) {
  app.querySelectorAll<HTMLButtonElement>("[data-setup]").forEach((button) => button.addEventListener("click", () => {
    setupDraft[button.dataset.setup!] = button.dataset.value === "true";
    void render();
  }));
  app.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-setup-text]").forEach((box) => box.addEventListener(box instanceof HTMLSelectElement ? "change" : "input", () => { setupDraft[box.dataset.setupText!] = box.value; }));
  document.getElementById("setup-skip")?.addEventListener("click", () => {
    const missing = state.me?.setup ? setupMissing(state.me.setup).join(",") : "";
    setupSkipped = missing;
    void chrome.storage.local.set({ [SETUP_SKIPPED]: missing });
    void render();
  });
  document.getElementById("setup-save")?.addEventListener("click", async () => {
    setupSaving = true;
    setupNote = "";
    void render();
    const result = await ask<{ ok: boolean; error?: string }>({ type: "save-setup", answers: setupDraft }).catch(() => ({ ok: false, error: "Couldn't reach Unnepo." }));
    setupSaving = false;
    setupNote = result.ok ? "Saved. These fill by themselves from now on." : result.error ?? "Couldn't save.";
    if (document.activeElement?.closest(".letter-form")) (document.activeElement as HTMLElement).blur();
    void render();
  });
}

/**
 * "I applied to this job": reads the job that's open on the tab (the details pane, not the results listed
 * beside it), shows what it read for the student to fix, then saves it as applied or for later.
 */
/**
 * "Fill in the job information", next to a job link: reads the link (Unnepo reads company sites; job boards are
 * read in a background tab, never LinkedIn) and fills in the title, company and description. A box the student
 * already typed in is kept, unless it holds a job board's name or a status line instead of the job.
 */
let linkReading = false;
type LinkRead = { info: { title: string; company: string; description: string } | null; error?: string };
async function readJobLink(url: string): Promise<LinkRead> {
  if (!/^https:\/\/\S+\.\S+/.test(url.trim())) return { info: null, error: "Put in the job's link first (it starts with https://)." };
  linkReading = true;
  void render();
  const result = await ask<LinkRead>({ type: "read-link", url: url.trim() }).catch((): LinkRead => ({ info: null, error: "Couldn't reach Unnepo." }));
  linkReading = false;
  return result;
}
const keepTyped = (typed: string, read: string) => (typed.trim() && !BOARD_COMPANY.test(typed.trim()) && !STATUS_TITLE.test(typed.trim()) ? typed : read || typed);
// A status line a page shows after applying, never a job's name.
const STATUS_TITLE = /^(applied( on .+| \d+ \w+ ago| today| yesterday)?|application (sent|submitted|received).*|job title missing)$/i;

// What a job board calls itself, which isn't the employer.
const BOARD_COMPANY = /^(handshake|joinhandshake|ziprecruiter|indeed|glassdoor|linkedin|wellfound|dice|simplify|built ?in|monster|simplyhired|careerbuilder|wayup|idealist|usajobs|localhost|jobs?|careers?)$/i;
type OpenedRead = { title: string; company: string; description: string; url: string; link: string; from: string };
const here = { key: "", step: "idle" as "idle" | "reading" | "check" | "saving" | "saved", applied: true, job: null as OpenedRead | null, note: "", auto: false, savedUrl: "" };
function openedCard(state: PanelState) {
  const key = state.tab ? `${state.tab.id}|${state.tab.url}` : "";
  if (here.key !== key && here.step !== "saving") Object.assign(here, { key, step: "idle", job: null, note: "" });
  if (here.step === "saved") {
    return `<section class="page" aria-label="Saved"><p class="note ok" role="status">${escape(here.note)}</p>${here.savedUrl ? `<div class="links"><a class="link" href="${escape(here.savedUrl)}" target="_blank" rel="noreferrer">See it in Applied jobs ↗</a></div>` : ""}</section>`;
  }
  if (!state.tab || !/^https:\/\//.test(state.tab.url) || onLinkedIn(state) || onUnnepo(state) || state.job?.running || state.job?.submission) return "";
  if (here.step === "check" || (here.step === "saving" && !here.auto)) {
    const job = here.job!;
    const ready = job.title.trim().length >= 2 && job.company.trim().length >= 2 && here.step !== "saving";
    return `
    <section class="page" aria-label="Check the job">
      <span class="eyebrow">${here.applied ? "I applied" : "Save for later"} · read from the ${escape(job.from)}</span>
      <div class="letter-form" id="here-form">
        <label class="question"><span class="q-label">Job title</span><input class="field" id="here-title" value="${escape(job.title)}" maxlength="200"></label>
        <label class="question"><span class="q-label">Company</span><input class="field" id="here-company" value="${escape(job.company)}" maxlength="200" placeholder="Type the company"></label>
        <label class="question"><span class="q-label">Job posting link</span><input class="field" id="here-link" value="${escape(job.link)}" maxlength="2000"></label>
        <div class="links"><button type="button" class="link" id="here-fill" ${linkReading ? "disabled" : ""}>${linkReading ? "Reading the link…" : "Fill in the job information"}</button></div>
        ${job.description ? `<p class="small">With the job description (${job.description.length.toLocaleString()} characters), for cover letters and finding people.</p>` : `<p class="small">No job description on this page.</p>`}
        <div class="links">
          <button type="button" class="solid" id="here-save" ${ready ? "" : "disabled"}>${here.step === "saving" ? "Saving…" : here.applied ? "Save as applied" : "Save for later"}</button>
          <button type="button" class="link" id="here-cancel">Cancel</button>
        </div>
      </div>
      ${here.note ? `<p class="small" role="status">${escape(here.note)}</p>` : ""}
    </section>`;
  }
  const button = `
      <button type="button" class="px" id="here-applied" ${here.step === "reading" || here.step === "saving" ? "disabled" : ""}>${here.step === "reading" ? "READING THE JOB…" : here.step === "saving" ? "SAVING…" : "✓ I APPLIED: ADD TO TRACKER"}</button>
      <div class="links"><button type="button" class="link" id="here-later" ${here.step === "reading" ? "disabled" : ""}>Save it for later</button></div>
      ${here.note ? `<p class="small" role="status">${escape(here.note)}</p>` : ""}`;
  // A job on this page stands out: what the panel sees, so the student knows which job one press saves.
  if (foundCardShowing(state)) {
    const site = state.page?.site ? ` · ${escape(state.page.site)}` : "";
    return `
    <section class="page found" aria-label="Job found">
      <span class="found-tag">✓ Job found${site}</span>
      <div class="job">
        <span class="job-title">${escape(state.page!.title)}</span>
        ${state.page!.company ? `<span class="job-company">${escape(state.page!.company)}</span>` : ""}
      </div>
      ${button}
    </section>`;
  }
  return `
    <section class="page plain" aria-label="Applied to a job here?">
      ${button}
    </section>`;
}

/** Whether the job found card shows: a job on this page, the student not filling it right now. */
function foundCardShowing(state: PanelState) {
  if (!state.tab || !/^https:\/\//.test(state.tab.url) || onLinkedIn(state) || onUnnepo(state) || state.job?.running || state.job?.report || state.job?.submission) return false;
  if (here.step === "saved" || here.step === "check" || (here.step === "saving" && !here.auto)) return false;
  return Boolean(state.page?.title && (state.page.posting || state.page.fields || state.page.company));
}
function wireOpened(state: PanelState) {
  if (!state.tab) return;
  const tabId = state.tab.id;
  const read = async (applied: boolean) => {
    Object.assign(here, { step: "reading", applied, note: "", auto: false });
    void render();
    type Read = { ok: boolean; error?: string; job?: OpenedRead };
    const result = await ask<Read>({ type: "read-opened-job", tabId }).catch((): Read => ({ ok: false, error: "Couldn't reach the page." }));
    if (!result.ok || !result.job) {
      Object.assign(here, { step: "idle", note: result.error ?? "Couldn't read this page." });
      return void render();
    }
    // Saved with one press. Whatever the page didn't say (the company, the description) is read from the
    // job's link, here and on Unnepo, so the student never has to type it.
    here.job = result.job;
    here.auto = true;
    return save();
  };
  const save = async () => {
    if (!here.job) return;
    here.step = "saving";
    here.note = "";
    if (document.activeElement?.closest("#here-form")) (document.activeElement as HTMLElement).blur();
    void render();
    type Saved = { ok: boolean; error?: string; title?: string; company?: string; id?: string; companyMissing?: boolean };
    const result = await ask<Saved>({ type: "save-opened-job", tabId, applied: here.applied, job: here.job }).catch((): Saved => ({ ok: false, error: "Couldn't reach Unnepo." }));
    const named = result.companyMissing ? (result.title ?? "The job") : `${result.title} at ${result.company}`;
    if (result.ok) Object.assign(here, { step: "saved", savedUrl: result.id ? `${state.apiBase}/home?job=${encodeURIComponent(result.id)}` : "", note: `✓ Success! ${named} ${here.applied ? "is added to your Applied jobs" : "is saved for later"}.${result.companyMissing ? " Unnepo is finding the company from the job's link." : ""}` });
    else Object.assign(here, { step: "check", note: result.error ?? "Couldn't save it." });
    void render();
  };
  document.getElementById("here-applied")?.addEventListener("click", () => void read(true));
  document.getElementById("here-later")?.addEventListener("click", () => void read(false));
  document.getElementById("here-cancel")?.addEventListener("click", () => { Object.assign(here, { step: "idle", job: null, note: "" }); void render(); });
  for (const [id, key] of [["here-title", "title"], ["here-company", "company"], ["here-link", "link"]] as const) {
    const box = document.getElementById(id) as HTMLInputElement | null;
    box?.addEventListener("input", () => {
      if (!here.job) return;
      here.job[key] = box.value;
      const save = document.getElementById("here-save") as HTMLButtonElement | null;
      if (save) save.disabled = here.job.title.trim().length < 2 || here.job.company.trim().length < 2;
    });
  }
  document.getElementById("here-save")?.addEventListener("click", () => void save());
  document.getElementById("here-fill")?.addEventListener("click", async () => {
    if (!here.job) return;
    const result = await readJobLink(here.job.link);
    if (result.info && here.job) {
      here.job.title = keepTyped(here.job.title, result.info.title);
      here.job.company = keepTyped(here.job.company, result.info.company);
      if (result.info.description.length > here.job.description.length) here.job.description = result.info.description;
      here.note = here.job.company.trim() ? "Filled in from the link. Check it, then save it." : "Filled in from the link. Type the company: the page didn't say.";
    } else here.note = result.error ?? "Couldn't read the link.";
    void render();
  });
}

/** What the extension noticed on job pages lately, newest first: for tracing a missed application. */
let activityLog: Array<{ at: number; text: string }> | null = null;
function activityCard() {
  if (activityLog === null) {
    void ask<{ log?: Array<{ at: number; text: string }> }>({ type: "activity-log" }).then((result) => { activityLog = result.log ?? []; void render(); }, () => undefined);
    return "";
  }
  const when = (at: number) => new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `
    <section class="view" aria-label="Activity">
      <span class="heading">Activity</span>
      ${activityLog.length ? `<ul class="needs activity">${activityLog.slice(0, 15).map((item) => `<li><span class="mono small">${when(item.at)}</span> ${escape(item.text)}</li>`).join("")}</ul>` : `<p class="note">Nothing yet. Apply to a job and what Unnepo notices shows up here.</p>`}
    </section>`;
}

/** No job on the tab: paste a job description and get a cover letter for it. */
let pasteText = "";

function pasteCard(state: PanelState) {
  const busy = letterStep === "writing" || letterStep === "revising" || letterStep === "saving";
  const linkedIn = onLinkedIn(state);
  return `${linkedIn ? linkedInCard(state) : ""}
    <section class="page" aria-label="Cover letter">
      <span class="eyebrow">${foundCardShowing(state) ? "Cover letter" : "No job found on this page"}</span>
      <p class="note">${foundCardShowing(state) ? "Paste the job description for a cover letter for this job." : linkedIn ? "Unnepo doesn't read LinkedIn. Press Apply there to go to the company's own application, or paste the job description here." : "Open a job posting and Unnepo finds it. Or paste a job description here for a cover letter."}</p>
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
let letterStep: "closed" | "asking" | "writing" | "written" | "revising" | "saving" = "closed";
let letterNote = "";
/** The student typed into the letter since the PDF was made, so the PDF is remade from their text first. */
let letterEdited = false;
/** The tab and job the letter is for. */
let letterFor = "";
const letterChoices = { length: "standard", tone: "professional", mention: "", edit: "" };

const SPARK = `<svg class="spark" width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9z"/><path d="M19 14l.9 2.6 2.6.9-2.6.9L19 21l-.9-2.6-2.6-.9 2.6-.9z" opacity=".7"/></svg>`;

const choice = (name: "length" | "tone", value: string, label: string) =>
  `<button type="button" class="choice${letterChoices[name] === value ? " on" : ""}" data-choice="${name}" data-value="${value}" aria-pressed="${letterChoices[name] === value}">${label}</button>`;

function letterBlock() {
  const busy = letterStep === "writing" || letterStep === "revising" || letterStep === "saving";
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
      <textarea class="cv-text" id="letter-text" aria-label="Your cover letter. Edit it right here, or select part of it to have it rewritten." ${busy ? "readonly" : ""}>${escape(letter!.text)}</textarea>
      <div class="part-bar" id="part-bar" hidden role="group" aria-label="Change the selected part">
        <span class="small">Selected part:</span>
        <div class="choices">
          <button type="button" class="choice" data-part="shorter">Shorter</button>
          <button type="button" class="choice" data-part="specific">More specific</button>
          <button type="button" class="choice" data-part="confident">More confident</button>
          <button type="button" class="choice" data-part="rewrite">Rewrite</button>
        </div>
        <div class="connect-code"><input class="field" id="part-own" maxlength="300" placeholder="Or say how: mention my internship…"><button type="button" class="solid" id="part-go">Go</button></div>
      </div>
      <div class="links">
        <button type="button" class="solid" id="letter-save" ${letterEdited && !busy ? "" : "hidden"}>${letterStep === "saving" ? "Saving…" : "Save my edits"}</button>
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
      <p class="small">Written from your profile and resume. Click into it to change anything.${forJob ? " Your saved version is what Unnepo attaches when this application asks for a cover letter." : ""}</p>
    </div>`;
}

const letterBlobUrl = () => {
  const bytes = Uint8Array.from(atob(letter!.pdfBase64), (char) => char.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
};

/** `save`: the student's own edits, made into the PDF as typed (no AI). `part`: rewrite only the selected part. */
async function writeLetter(tabId: number, revise: boolean, fromPaste = false, save = false, part?: { part: string; ask: string }) {
  letterStep = save ? "saving" : revise || part ? "revising" : "writing";
  letterNote = "";
  void render();
  const options = part
    ? { previous: letter?.text ?? "", part: part.part, ask: part.ask }
    : save
    ? { text: letter?.text ?? "" }
    : revise
      ? { previous: letter?.text ?? "", edit: letterChoices.edit }
      : fromPaste ? {} : { length: letterChoices.length, tone: letterChoices.tone, mention: letterChoices.mention };
  type Result = { ok: boolean; doc?: Letter; error?: string };
  const result = await ask<Result>({ type: "generate-letter", tabId, options, ...(fromPaste ? { description: pasteText } : {}) }).catch((): Result => ({ ok: false, error: "Couldn't reach Unnepo." }));
  if (result.ok && result.doc) {
    letter = result.doc;
    letterStep = "written";
    letterEdited = false;
    if (revise) letterChoices.edit = "";
    if (save) letterNote = "Saved. The PDF has your edits.";
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
  app.querySelectorAll<HTMLButtonElement>(".choice[data-choice]").forEach((button) => button.addEventListener("click", () => {
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
  const typed = document.getElementById("letter-text") as HTMLTextAreaElement | null;
  // Selecting part of the letter offers to rewrite just that part. Shown without redrawing, so the selection stays.
  const partBar = document.getElementById("part-bar");
  let part = "";
  const showPartBar = () => {
    if (!typed || !partBar) return;
    const chosen = typed.value.slice(typed.selectionStart, typed.selectionEnd);
    if (chosen.trim().length >= 12) part = chosen;
    partBar.hidden = !part || (chosen.trim().length < 12 && document.activeElement === typed);
  };
  typed?.addEventListener("select", showPartBar);
  typed?.addEventListener("mouseup", showPartBar);
  typed?.addEventListener("keyup", showPartBar);
  const rewrite = (ask: string) => {
    if (!part || !ask.trim()) return;
    if (letterEdited) letterEdited = false;
    void writeLetter(tabId, false, fromPaste, false, { part, ask });
  };
  partBar?.querySelectorAll<HTMLButtonElement>("[data-part]").forEach((button) => button.addEventListener("click", () => rewrite(button.dataset.part!)));
  document.getElementById("part-go")?.addEventListener("click", () => rewrite((document.getElementById("part-own") as HTMLInputElement).value));
  const save = document.getElementById("letter-save") as HTMLButtonElement | null;
  typed?.addEventListener("input", () => {
    letter!.text = typed.value;
    letterEdited = true;
    if (save) save.hidden = false;
  });
  save?.addEventListener("click", () => void writeLetter(tabId, false, fromPaste, true));
  /** The PDF, remade from the student's edits first when they changed the text. */
  const pdfReady = async () => {
    if (letterEdited) await writeLetter(tabId, false, fromPaste, true);
    return !letterEdited;
  };
  document.getElementById("letter-copy")?.addEventListener("click", () => {
    void navigator.clipboard.writeText(letter!.text).then(() => { letterNote = "Copied."; void render(); }, () => { letterNote = "Couldn't copy. Select the text and copy it."; void render(); });
  });
  document.getElementById("letter-download")?.addEventListener("click", async () => {
    if (!(await pdfReady())) return;
    const link = document.createElement("a");
    link.href = letterBlobUrl();
    link.download = letter!.fileName;
    link.click();
  });
  document.getElementById("letter-open")?.addEventListener("click", async () => {
    if (await pdfReady()) void chrome.tabs.create({ url: letterBlobUrl() });
  });
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
        <span class="mono">${me.completeness}% READY · ${me.unlimitedCredits ? "UNLIMITED CREDITS" : `${me.credits} ${me.credits === 1 ? "CREDIT" : "CREDITS"}`}${me.coverLetters?.left != null ? ` · ${me.coverLetters.left} LETTERS LEFT` : ""}</span>
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
let jobsList: { rows: JobRow[]; total: number; followUpsDue: number; error: string; loadedAt: number } | null = null;
let jobsLoading = false;

const STATUS: Record<string, string> = {
  extracted: "Saved", filling: "Filling", review: "To review", submitting: "Submitting", submitted: "Applied",
  unconfirmed: "Check email", applied_manual: "Applied", failed: "Didn't go through",
};

async function loadJobs() {
  if (jobsLoading) return;
  jobsLoading = true;
  const result = await ask<{ ok: boolean; jobs?: JobRow[]; total?: number; followUpsDue?: number; error?: string }>({ type: "list-jobs" }).catch(() => ({ ok: false, error: "Couldn't reach Unnepo." }) as const);
  jobsLoading = false;
  jobsList = { rows: result.ok ? result.jobs ?? [] : [], total: result.ok ? result.total ?? 0 : 0, followUpsDue: result.ok ? result.followUpsDue ?? 0 : 0, error: result.ok ? "" : result.error ?? "Couldn't load your jobs.", loadedAt: Date.now() };
  void render();
}

/**
 * "+ Add job" in My jobs: a job applied to somewhere Unnepo didn't see. It starts from the tab (its link and
 * its name, "Growth Intern | MealPal | …"), so most of the time it's one click.
 */
const manualJob = { open: false, key: "", title: "", company: "", url: "", stage: "applied", note: "", saving: false, readFor: "", description: "" };
function startManualJob(state: PanelState) {
  const key = state.tab?.url ?? "";
  if (manualJob.key === key) return;
  const parts = (state.tab?.title ?? "").replace(/^\(\d+\)\s*/, "").split(/ [|\-–] /).map((part) => part.trim()).filter(Boolean);
  const url = /^https:\/\//.test(key) ? key : "";
  Object.assign(manualJob, { key, title: parts.length >= 2 ? parts[0] : "", company: parts.length >= 3 ? parts[1] : "", url, note: "", saving: false, readFor: "", description: "" });
}
function manualJobForm() {
  if (!manualJob.open) return `<button type="button" class="outline" id="add-job-open">+ Add a job I applied to</button>${manualJob.note ? `<p class="small" role="status">${escape(manualJob.note)}</p>` : ""}`;
  const ready = manualJob.title.trim().length >= 2 && manualJob.company.trim().length >= 2;
  const stage = (value: string, label: string) => `<option value="${value}"${manualJob.stage === value ? " selected" : ""}>${label}</option>`;
  return `
    <div class="letter-form" id="add-job-form">
      <span class="eyebrow">Add a job</span>
      <label class="question"><span class="q-label">Job title</span><input class="field" id="mj-title" value="${escape(manualJob.title)}" maxlength="200" placeholder="Growth Marketing Intern"></label>
      <label class="question"><span class="q-label">Company</span><input class="field" id="mj-company" value="${escape(manualJob.company)}" maxlength="200" placeholder="MealPal"></label>
      <label class="question"><span class="q-label">Job link</span><input class="field" id="mj-url" value="${escape(manualJob.url)}" maxlength="2000" placeholder="https://…"></label>
      <div class="links"><button type="button" class="link" id="mj-fill" ${linkReading ? "disabled" : ""}>${linkReading ? "Reading the link…" : "Fill in the job information"}</button></div>
      <label class="question"><span class="q-label">Status</span><select class="field" id="mj-stage">${stage("applied", "Applied")}${stage("in_progress", "Not applied yet")}${stage("assessment", "Assessment")}${stage("interviewing", "Interviewing")}${stage("offer", "Offer")}${stage("rejected", "Rejected")}</select></label>
      <div class="links">
        <button type="button" class="solid" id="mj-save" ${ready && !manualJob.saving ? "" : "disabled"}>${manualJob.saving ? "Adding…" : "Add to tracker"}</button>
        <button type="button" class="link" id="mj-cancel">Cancel</button>
      </div>
      ${manualJob.note ? `<p class="small" role="status">${escape(manualJob.note)}</p>` : ""}
    </div>`;
}
function wireManualJob(state: PanelState) {
  document.getElementById("add-job-open")?.addEventListener("click", () => {
    startManualJob(state);
    manualJob.open = true;
    manualJob.note = "";
    void render();
  });
  document.getElementById("mj-cancel")?.addEventListener("click", () => { manualJob.open = false; void render(); });
  for (const [id, key] of [["mj-title", "title"], ["mj-company", "company"], ["mj-url", "url"], ["mj-stage", "stage"]] as const) {
    const box = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
    box?.addEventListener(box instanceof HTMLSelectElement ? "change" : "input", () => {
      manualJob[key] = box.value;
      const save = document.getElementById("mj-save") as HTMLButtonElement | null;
      if (save) save.disabled = manualJob.title.trim().length < 2 || manualJob.company.trim().length < 2 || manualJob.saving;
    });
  }
  // A job link fills in the empty boxes: read by Unnepo (company sites) or in a background tab (job boards).
  const fillManual = async (force: boolean) => {
    const url = manualJob.url.trim();
    if (linkReading) return;
    if (!force && (!/^https:\/\/\S+\.\S+/.test(url) || url === manualJob.readFor)) return;
    manualJob.readFor = url;
    manualJob.note = "";
    const result = await readJobLink(url);
    if (result.info) {
      manualJob.title = keepTyped(manualJob.title, result.info.title);
      manualJob.company = keepTyped(manualJob.company, result.info.company);
      manualJob.description ||= result.info.description;
      manualJob.note = manualJob.company.trim() ? "Filled in from the link. Check it, then add it." : "Filled in from the link. Type the company: the page didn't say.";
    } else manualJob.note = result.error ?? "Couldn't read the link. Type the details.";
    void render();
  };
  // Pasting a link fills in the rest by itself; the button reads it again.
  document.getElementById("mj-url")?.addEventListener("change", () => void fillManual(false));
  document.getElementById("mj-fill")?.addEventListener("click", () => void fillManual(true));
  document.getElementById("mj-save")?.addEventListener("click", async () => {
    manualJob.saving = true;
    manualJob.note = "";
    void render();
    type Added = { ok: boolean; error?: string };
    const result = await ask<Added>({ type: "add-job", job: { title: manualJob.title, company: manualJob.company, url: manualJob.url.trim(), stage: manualJob.stage, description: manualJob.description } }).catch((): Added => ({ ok: false, error: "Couldn't reach Unnepo." }));
    manualJob.saving = false;
    if (result.ok) {
      manualJob.note = `Added: ${manualJob.title} at ${manualJob.company}.`;
      manualJob.open = false;
      manualJob.key = "";
      jobsList = null;
    } else manualJob.note = result.error ?? "Couldn't add it.";
    if (document.activeElement?.closest(".letter-form")) (document.activeElement as HTMLElement).blur();
    void render();
  });
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
      ${jobsList?.followUpsDue ? `<a class="note warn" href="${escape(state.apiBase)}/home" target="_blank" rel="noreferrer">${jobsList.followUpsDue} ${jobsList.followUpsDue === 1 ? "follow-up is" : "follow-ups are"} due. Open your tracker to write ${jobsList.followUpsDue === 1 ? "it" : "them"} →</a>` : ""}
      ${manualJobForm()}
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

/** Puts the student's spider from the Stats page at the top of the panel. */
let dressed = "";
function dressSpider(look?: SpiderLook) {
  const key = look ? `${look.skin}|${look.school ?? ""}` : "";
  if (!look || key === dressed) return;
  dressed = key;
  const spider = document.getElementById("spider")!;
  spider.querySelector("svg")?.remove();
  spider.insertAdjacentHTML("beforeend", heroSpiderSvg(look));
}

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
  dashboard.hidden = !state.connected;
  dashboard.href = `${state.apiBase}/home`;
  dressSpider(state.me?.spider);
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
  // Nor the job being checked before "I applied" saves it.
  if (document.activeElement?.closest("#here-form") && document.activeElement.matches("input")) return;
  // While a form is being filled (or was just filled), its card comes first; the other cards wait below.
  const active = Boolean(state.job?.running || state.job?.report);
  const views: Record<View, () => string> = { home: () => (onUnnepo(state) ? unnepoCard() : active ? pageCard(state) + openedCard(state) : openedCard(state) + pageCard(state)), jobs: () => jobsView(state), profile: () => profileCard(state) + activityCard() + issuesCard(), settings: () => settingsView(state) };
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
  if (state.tab && onLinkedIn(state)) wireLinkedIn(state.tab.id);
  wireSetup(state);
  wireOpened(state);
  document.getElementById("see-resume")?.addEventListener("click", () => void seeResume());
  document.getElementById("open-resume")?.addEventListener("click", () => void seeResume());
  app.querySelectorAll<HTMLButtonElement>(".needs-link").forEach((button) => button.addEventListener("click", () => void goToField(state.tab!.id, button.dataset.label ?? "")));
  document.getElementById("replace-resume")?.addEventListener("click", () => resumeInput.click());
  if (view === "profile") wireIssues();
  if (view === "jobs") wireManualJob(state);
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
  activityLog = null;
  // New problems may have been added; Profile reads the list again.
  if (view === "profile") void loadIssues();
  else void render();
});
chrome.tabs.onUpdated.addListener((_id, info) => {
  if (info.status === "complete") void render();
});

/** Tells the extension this panel is open, so the spider hanging on the page hides while it is. */
function holdOpen() {
  void chrome.windows.getCurrent().then((win) => {
    if (win.id === undefined) return;
    const port = chrome.runtime.connect({ name: `panel:${win.id}` });
    // The background worker restarts now and then; connect again so the page spider stays hidden.
    port.onDisconnect.addListener(() => setTimeout(holdOpen, 1000));
  }).catch(() => undefined);
}
holdOpen();
void render();
