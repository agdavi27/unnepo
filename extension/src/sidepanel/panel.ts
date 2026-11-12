import type { SpiderLook } from "@/lib/spiders";
import { notJobTitle } from "@/lib/apply/job-title";
import { heroSpiderSvg, typingSpiderSvg } from "../shared/hero-spider";
import { PASSWORD_RULES, unmetRules } from "../shared/password";
import { spiderRects, H as SPRITE_H, W as SPRITE_W } from "../shared/sprite";
import { AUTOFILL_ENABLED, type Detected, type Issue, type JobDetails, type Mailer, type PanelState } from "../shared/types";
import { detectedMenu, firstEmailCount, ensureTracker, jobById, jobPage, loadTracker, refreshDetected, setHost, store, todayList, wireBubbles, wireDetected, wireJobPage, wireJobRows, wireReminders } from "../shared/tracker-view";
import { jobsList, showJobs, weekView, wireJobsList, wireWeek } from "../shared/week";
import { friendRequests, friendsSettingsCard, wireFriends } from "../shared/friends";
import { dueCount } from "../shared/reminders";
import { UPGRADE_URL } from "@/lib/plan";

/**
 * The side panel: a typing line and a hanging spider, then one page at a time. A job on the tab shows Autofill;
 * while it fills, just the spider typing on his laptop; when it's applied, went wrong, or there's no job, two big
 * buttons that open a popup asking one question at a time, with the resume and password small under them. The menu
 * runs along the bottom: Jobs (the week and every job), Tools and Me.
 */

const app = document.getElementById("app")!;
const passwordSection = document.getElementById("password")!;
const tabBar = document.getElementById("tabs")!;
const jobsBadge = document.getElementById("jobs-count")!;
const meBadge = document.getElementById("me-count")!;
const planBadge = document.getElementById("plan-badge")!;

/** The page showing: home follows what's on the tab; the rest were asked for, and have a Back button. */
/** The three tabs along the bottom (home = Jobs, jobs = Tools, settings = Me; shown under those names), and the pages opened from them. */
type View = "home" | "jobs" | "feedback" | "settings" | "job";
const TABS: View[] = ["home", "jobs", "settings"];
let view: View = "home";
/** The job open on the "job" page, and the person to show on it. */
let openedJob = { id: "", contact: "" };
/** The tab a job's page was opened from, where Back goes. */
let jobFrom: View = "home";
/** The cover letter or answer popup, and which of its questions is showing. */
let popup: { kind: "cover" | "answer"; step: number } | null = null;

const escape = (text: string) => text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
/** "1.001": the version name, which keeps the zeros Chrome's own version number can't have. */
const extensionVersion = () => chrome.runtime.getManifest().version_name ?? chrome.runtime.getManifest().version;
const ask = <T>(message: unknown) => chrome.runtime.sendMessage(message) as Promise<T>;
const short = (text: string, max = 60) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** What he says when he's poked, worse each time, and how long he stays mad: the same as on the front page. */
const OUCH = ["Ouch!", "Hey! Quit poking me.", "I have eight legs and I'm not afraid to use them.", "OK, that's it. I'm telling the recruiters."];
const MAD_MS = 2200;

/** The spider's line: types out while his mouth moves, then moves on to the next. Poking him interrupts it. */
const speech = (() => {
  const spider = document.getElementById("spider")!;
  const line_ = document.getElementById("ticker-line")!;
  const typed = document.getElementById("typed")!;
  const said = document.getElementById("said")!;
  spider.insertAdjacentHTML("beforeend", heroSpiderSvg());
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let lines = [""];
  let key = "";
  let line = 0;
  let shown = 0;
  let hold = 0;
  let alerting = false;
  let pokes = 0;
  let calm = 0;

  const draw = () => {
    if (calm) return;
    const text = lines[line] ?? "";
    const typing = shown < text.length;
    typed.textContent = text.slice(0, shown);
    said.textContent = text;
    spider.classList.toggle("talking", typing && text.charAt(shown) !== " " && Math.floor(shown / 2) % 2 === 0);
  };
  const next = () => {
    line = (line + 1) % lines.length;
    shown = reduce ? lines[line].length : 0;
    hold = 0;
    draw();
  };
  setInterval(() => {
    if (calm) return;
    const text = lines[line] ?? "";
    if (shown < text.length) { shown += 1; draw(); }
    else if (lines.length > 1 && ++hold > 70) next();
  }, 45);

  spider.addEventListener("click", () => {
    pokes += 1;
    const ouch = OUCH[Math.min(pokes, OUCH.length) - 1];
    clearTimeout(calm);
    calm = 0;
    typed.textContent = ouch;
    said.textContent = ouch;
    line_.classList.add("alert");
    spider.classList.remove("talking", "mad");
    // Taking the class off and on starts the shake again, for every poke.
    void spider.offsetWidth;
    spider.classList.add("mad");
    calm = window.setTimeout(() => {
      calm = 0;
      spider.classList.remove("mad");
      line_.classList.toggle("alert", alerting);
      shown = reduce ? (lines[line] ?? "").length : 0;
      draw();
    }, MAD_MS);
  });

  return (next: string[], alert = false) => {
    const nextKey = `${alert}|${next.join("\n")}`;
    if (nextKey === key) return;
    key = nextKey;
    lines = next.length ? next : [""];
    line = 0;
    shown = reduce ? lines[0].length : 0;
    hold = 0;
    alerting = alert;
    if (!calm) line_.classList.toggle("alert", alert);
    draw();
  };
})();

/** Applications today, counted in the student's own time, against the goal. */
function goalToday(state: PanelState) {
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekly = state.me?.goal?.weekly ?? null;
  return { done: (state.me?.goal?.appliedAt ?? []).filter((at) => new Date(at) >= dayStart).length, target: weekly ? Math.ceil(weekly / 5) : null };
}

function goalLine(state: PanelState) {
  const { done, target } = goalToday(state);
  if (!target) return `${done} today so far.`;
  return done >= target ? `${done} of ${target} today. Goal hit.` : `${done} of ${target} today. ${target - done} to go.`;
}

/** What the spider says, from what's on the tab and what Unnepo is doing. */
function lines(state: PanelState): { lines: string[]; alert?: boolean } {
  if (!state.connected) return { lines: ["Hi! I'm the Unnepo spider.", "Connect your Unnepo account and I'll fill job applications for you.", "Your job-site passwords never leave this computer."] };
  const { job, page, me } = state;
  if (job?.error) return { lines: [job.error], alert: true };
  if (job?.step && (job.running || job.submission || job.report)) return { lines: [job.step] };
  if (!me!.profileReady) return { lines: [me!.resume ? "Almost there. Finish your profile and I'm ready." : "Hi! Upload your resume and I'll set up your profile."] };
  if (!jobFound(state) || !page) {
    const due = store.tracker ? dueCount(todayList().items) : 0;
    return { lines: [goalLine(state), due ? `${due} ${due === 1 ? "thing" : "things"} on your list today.` : "Open an application, I'll wait.", "Need a cover letter? Tap Write a cover letter."] };
  }
  const found = `${page.company || page.site} job found.${page.title ? ` ${short(page.title)}.` : ""}`;
  if (!AUTOFILL_ENABLED) {
    const applying = state.applying;
    if (applying) {
      const open = applying.questions.filter((question) => !question.answered && !applying.answers?.[question.id]?.put).length;
      if (applying.questionsOnly) return { lines: [open ? `${open} ${open === 1 ? "question" : "questions"} to answer. I'm sitting next to ${open === 1 ? "it" : "them"}.` : "Every question here has an answer.", goalLine(state)] };
      return { lines: [applying.uploaded.length ? "Resume's in." : applying.resumeBox ? "Couldn't upload your resume here. Add it yourself." : "No resume upload on this page yet.", open ? `${open} complex ${open === 1 ? "question" : "questions"}. I'm sitting next to ${open === 1 ? "it" : "them"}.` : "No complex questions left on this page.", goalLine(state)] };
    }
    return { lines: [`${page.company || page.site} job. It's under Detected jobs on Jobs.`, goalLine(state)] };
  }
  if (page.posting) return { lines: [found, "Press Autofill. I'll press Apply and crawl it for you.", goalLine(state)] };
  const extra = page.account === "new" ? ", and one new account to make" : page.account === "sign_in" ? ", and I'll sign you in" : "";
  return { lines: [found, `${page.fields} ${page.fields === 1 ? "field" : "fields"}${extra}.`, "Press Autofill and I'll crawl it for you.", goalLine(state)] };
}

function connectView(state: PanelState) {
  return `
    <section class="page" aria-label="Connect">
      <span class="eyebrow">Get started</span>
      <div class="job">
        <span class="job-title">Connect your Unnepo account</span>
        <span class="job-company">Unnepo fills applications from your profile. Connect once and the extension stays signed in.</span>
      </div>
      <a class="btn primary big" href="${escape(state.apiBase)}/extension/connect" target="_blank" rel="noreferrer">Connect on Unnepo</a>
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

/** A job is on the tab: a posting, an application form, or one Unnepo is working on. */
function jobFound(state: PanelState) {
  const { job, page, tab } = state;
  const onWeb = Boolean(tab && /^https:\/\//.test(tab.url)) && !onUnnepo(state);
  if (dismissal(state) && !job?.running && !job?.submission) return false;
  return onWeb && Boolean(job?.applicationId || job?.running || job?.report || page?.fields || page?.posting);
}

/** "Skip this job" (until the browser closes) and "This isn't a job" (kept, and the page spider reads it too). */
const NOT_JOBS = "notJobs";
const SKIPPED_JOBS = "skippedJobs";
let notJobs: string[] = [];
let skippedJobs: string[] = [];
void Promise.all([chrome.storage.local.get(NOT_JOBS), chrome.storage.session.get(SKIPPED_JOBS)]).then(([kept, session]) => {
  notJobs = (kept[NOT_JOBS] as string[] | undefined) ?? [];
  skippedJobs = (session[SKIPPED_JOBS] as string[] | undefined) ?? [];
  void render();
});
/** The page, without what's after a #, which many sites change as you scroll. */
const pageKey = (url: string) => url.split("#")[0];
function dismissal(state: PanelState): "skipped" | "not_job" | null {
  const key = state.tab ? pageKey(state.tab.url) : "";
  return notJobs.includes(key) ? "not_job" : skippedJobs.includes(key) ? "skipped" : null;
}
function dismiss(state: PanelState, how: "skipped" | "not_job" | null) {
  const key = state.tab ? pageKey(state.tab.url) : "";
  if (!key) return;
  notJobs = notJobs.filter((item) => item !== key);
  skippedJobs = skippedJobs.filter((item) => item !== key);
  if (how === "not_job") notJobs = [...notJobs, key].slice(-200);
  if (how === "skipped") skippedJobs = [...skippedJobs, key].slice(-200);
  void chrome.storage.local.set({ [NOT_JOBS]: notJobs });
  void chrome.storage.session.set({ [SKIPPED_JOBS]: skippedJobs });
  void render();
}

/** What's left on the plan, from the latest state. */
let usesNow: NonNullable<PanelState["me"]>["usage"] | null = null;

/** "Only 2 autofills left": nothing until a tool's uses run low. */
const usesLine = (note?: string) => (note ? `<span class="small uses-left" role="status" style="color: var(--warn)">${escape(note)}</span>` : "");

/** Autofill was pressed on this tab and the worker hasn't said it's running yet. */
let fillPending: number | null = null;
const isRunning = (state: PanelState) => Boolean(state.job?.running) || (fillPending !== null && fillPending === state.tab?.id);

/**
 * Week with no job on the tab: getting started, the calendar of every day you did something, then every job with
 * its progress (searchable, filtered by step) and the dashboard on unnepo.com, then friends.
 */
function homeLists(state: PanelState) {
  const noEmail = firstEmailCount();
  const nudge = noEmail ? `<button type="button" class="note warn nudge" data-show-jobs="reach">${noEmail} ${noEmail === 1 ? "job you applied to has" : "jobs you applied to have"} no email sent yet. See them →</button>` : "";
  // A clear line between the calendar and the job list, so the tab reads as two parts.
  const list = `<div class="section-divider" role="separator"><span>Your jobs</span></div>${nudge}${jobsList()}<a class="btn" href="${escape(state.apiBase)}/jobs" target="_blank" rel="noreferrer">Open my dashboard</a>`;
  return `${startCard(state)}${weekView(new Date(), list)}`;
}

/**
 * First run, until the profile is ready: the resume goes in right here (Unnepo builds the profile from it), and
 * the rest of the profile is a link to the site.
 */
function startCard(state: PanelState) {
  const me = state.me;
  if (!me || me.profileReady) return "";
  return `
    <section class="page" aria-label="Get started">
      <span class="eyebrow">Get started · ${me.completeness}% ready</span>
      <div class="bar" role="progressbar" aria-label="Profile ready" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${me.completeness}"><div style="width:${me.completeness}%"></div></div>
      <p class="note">${me.resume ? "Your resume is in. A few details are still missing" : "Start with your resume: Unnepo fills in your profile from it"}${me.missing?.length ? `: ${escape(me.missing.join(", "))}.` : "."}</p>
      ${me.resume ? "" : `<button type="button" class="btn primary" id="start-resume" ${resumeBusy ? "disabled" : ""}>${resumeBusy ? "Reading your resume…" : "Upload my resume"}</button>`}
      <a class="btn" href="${escape(state.apiBase)}/home?edit=profile" target="_blank" rel="noreferrer">Finish my profile</a>
      ${resumeNote ? `<p class="small" role="status">${escape(resumeNote)}</p>` : ""}
    </section>`;
}

/** The page for a job on this tab: its name, Autofill, and the two ways of saying no. */
function jobFillPage(state: PanelState) {
  const { job, page, tab, me } = state;
  let host = "";
  try { host = tab ? new URL(tab.url).hostname.replace(/^www\./, "") : ""; } catch { host = ""; }
  const title = job?.title || page?.title || tab?.title || "This job";
  const size = page?.posting ? "Job posting" : page?.fields ? `${page.fields} ${page.fields === 1 ? "question" : "questions"}` : "";
  const detail = [job?.company || page?.company, page?.site || host, size].filter(Boolean).join(" · ");
  return `${setupCard(state)}
    <section class="job-page" aria-label="This job">
      <div><div class="job-name">${escape(title)}</div><div class="sub job-detail">${escape(detail)}</div></div>
      <button type="button" class="btn primary big" id="fill" ${me!.profileReady ? "" : "disabled"}>${job?.report ? "Fill again" : "Autofill application"}</button>
      ${usesLine(me?.usage?.autofills.note)}
      ${lockedLine(state)}
      ${trialLine(state)}
      <div class="row-between"><button type="button" class="quiet-link" id="skip-job">Skip this job</button><button type="button" class="quiet-link" id="not-job">This isn't a job</button></div>
      <span class="sub">Beta: check every field before you submit.</span>
      ${here.note ? `<p class="small" role="status">${escape(here.note)}</p>` : ""}
    </section>
    <div class="job-foot">
      <button type="button" class="more-row" data-go="jobs">Cover letter, resume, more <span aria-hidden="true">›</span></button>
      ${goalBar(state)}
    </div>`;
}

/** Where "Get Pro" goes: the Upgrade to Pro page on the website. */
const upgradeUrl = (state: PanelState) => `${state.apiBase}${UPGRADE_URL}`;

/** Free, after a fill: "Pro would answer these 4 questions for you." */
function lockedLine(state: PanelState) {
  const count = state.job?.locked ?? 0;
  if (!count || !state.me?.usage?.free || state.job?.running) return "";
  return `<p class="small locked-line" role="status">${SPARK_SMALL} Pro would answer ${count === 1 ? "this question" : `these ${count} questions`} for you. <a href="${escape(upgradeUrl(state))}" target="_blank" rel="noreferrer">Get Pro</a></p>`;
}

/** The Pro trial: how long is left, and, once it's over, that this is Free. */
function trialLine(state: PanelState) {
  const me = state.me;
  if (!me || me.unlimitedCredits) return "";
  if (me.trial) {
    const left = me.trial.hoursLeft < 24 ? `${me.trial.hoursLeft} ${me.trial.hoursLeft === 1 ? "hour" : "hours"}` : `${me.trial.daysLeft} ${me.trial.daysLeft === 1 ? "day" : "days"}`;
    return `<span class="small"${me.trial.hoursLeft <= 48 ? ' style="color: var(--warn)"' : ""}>Pro trial: ${left} left. <a href="${escape(upgradeUrl(state))}" target="_blank" rel="noreferrer">Keep Pro</a></span>`;
  }
  if (me.trialEnded && me.usage?.free) {
    return `<span class="small">Your Pro trial ended. Free fills your basic details. <a href="${escape(upgradeUrl(state))}" target="_blank" rel="noreferrer">Get Pro back</a></span>`;
  }
  return "";
}

/** Today's goal, as one quiet line. */
function goalBar(state: PanelState) {
  const { done, target } = goalToday(state);
  return `
    <div class="goal"><span>Today</span><span>${target ? `${done} of ${target}` : done}</span></div>
    ${target ? `<div class="bar" role="progressbar" aria-label="Goal for today" aria-valuemin="0" aria-valuemax="${target}" aria-valuenow="${Math.min(done, target)}"><div style="width:${Math.min(100, Math.round((done / target) * 100))}%"></div></div>` : ""}`;
}

/** While it fills: just the spider on his laptop. What's happening is in the line at the top. */
function fillingView() {
  return `
    <section class="filling" aria-label="Filling your application">
      <div class="letter-writing">${typingSpiderSvg(120, spiderLook)}</div>
      <button type="button" class="btn big stop" id="stop">Stop, I'll do it myself</button>
    </section>`;
}

const SPARK_SMALL = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z"/></svg>`;

/** The blue AI spark on the two big buttons. */
const SPARK = SPARK_SMALL.replace('width="13" height="13"', 'class="big-tool-icon" width="20" height="20"');
/** "Write cover letter (4 left today)" on Free, which counts by the day; Pro has no limit, so just the label. */
const withCost = (label: string, kind: "letters" | "answers") => {
  const usage = lastState?.me?.usage;
  return usage?.free && !lastState?.me?.unlimitedCredits ? `${label} (${usage[kind].left} left today)` : label;
};

/** The count in a tool box's top-right corner: "4 left today" on Free, "Unlimited" on Pro. */
const toolCount = (line?: { left: number; badge?: string }) => (line?.badge ? `<span class="tool-count${line.left === 0 ? " out" : ""}">${escape(line.badge)}</span>` : "");
/**
 * Autofill, in beta: fills the application on this tab from the profile and stops at Submit (unless Me says
 * otherwise). Only offered on a job page; everywhere else it says where to go.
 */
function autofillTool(state: PanelState) {
  const ready = jobFound(state) && !state.job?.running && Boolean(state.me?.profileReady);
  const why = !state.me?.profileReady ? "Finish your profile first." : jobFound(state) ? "Fills this application. You check it and press Submit." : "Open a job application, then press this.";
  return `<button type="button" class="big-tool autofill-tool" id="beta-fill" ${ready ? "" : "disabled"}>
      ${toolCount(state.me?.usage?.autofills)}${SPARK}<span class="big-tool-text"><span>Autofill this application <span class="beta">Beta</span></span><span class="small">${why}</span></span>
    </button>`;
}

/** The tools: the whole page once a job is applied, went wrong, or there's no job. `extra` goes under them. */
function toolsPage(state: PanelState, extra = "") {
  return `
    <div class="tools">
      <button type="button" class="big-tool" data-popup="cover">${toolCount(state.me?.usage?.letters)}${SPARK}Write a cover letter</button>
      <button type="button" class="big-tool" data-popup="answer">${toolCount(state.me?.usage?.answers)}${SPARK}Answer a question</button>
      ${autofillTool(state)}
      <div class="tool-lines">${resumeLine(state)}${letterLine()}<div id="password-slot"></div></div>
      ${extra}
    </div>`;
}

/**
 * The job box, above "Write a cover letter": everything Unnepo read about the job on the tab, with Begin applying
 * and the two ways of saying no. After Begin applying: whether the resume went in, and the complex questions
 * (each with a spider beside it on the page), with one button that answers them all.
 */
let details: { key: string; data: JobDetails | null; loading: boolean } = { key: "", data: null, loading: false };
const detailsKey = (state: PanelState) => (state.tab ? `${state.tab.id}|${pageKey(state.tab.url)}|${state.page?.title ?? ""}|${state.page?.company ?? ""}` : "");
function loadDetails(state: PanelState) {
  const key = detailsKey(state);
  if (!state.tab || details.key === key) return;
  details = { key, data: null, loading: true };
  const tabId = state.tab.id;
  void ask<{ ok: boolean; details?: JobDetails }>({ type: "job-details", tabId }).catch(() => ({ ok: false })).then((result) => {
    if (details.key !== key) return;
    details = { key, data: result.ok ? (result as { details?: JobDetails }).details ?? null : null, loading: false };
    void render();
  });
}
/** The job as the panel knows it, for cover letters and answers: what the page showed, or the tab's own name. */
function pageJob(state: PanelState): Partial<JobDetails> | null {
  if (details.data?.title && details.key === detailsKey(state)) return details.data;
  const title = state.job?.title || state.page?.title;
  return title ? { title, company: state.job?.company || state.page?.company || "", site: state.page?.site ?? "", description: "" } : null;
}

const MINI_SPIDER = `<svg class="mini-spider" viewBox="0 0 ${SPRITE_W} ${SPRITE_H}" width="18" height="${Math.round((18 * SPRITE_H) / SPRITE_W)}" shape-rendering="crispEdges" aria-hidden="true"><g transform="rotate(180 ${SPRITE_W / 2} ${SPRITE_H / 2})">${spiderRects(0)}</g></svg>`;

/** Answering every complex question: what's going on, and edits to answers not yet put back on the page. */
const complex = { busy: false, note: "", drafts: {} as Record<string, string>, open: new Set<string>() };

/** On Free, how many of the day's answers are left, since each question uses one. */
function answersCost(count: number) {
  const me = lastState?.me;
  if (!count || me?.unlimitedCredits || !me?.usage?.free) return "";
  return ` (${me.usage.answers.left} left today)`;
}

function applyingBox(state: PanelState) {
  const applying = state.applying!;
  const answers = applying.answers ?? {};
  const open = applying.questions.filter((question) => !question.answered && !answers[question.id]?.put);
  const resume = applying.uploaded.length
    ? `<p class="note ok">✓ Resume uploaded to “${escape(short(applying.uploaded[0], 50))}”.</p>`
    : applying.resumeError ? `<p class="note warn">${escape(applying.resumeError)}</p>`
    : applying.resumeBox ? `<p class="note">There's an upload box, but it already has a file or isn't for a resume.</p>`
    : `<p class="note">No resume upload on this page yet. It goes in the moment one shows up.</p>`;
  const row = (question: (typeof applying.questions)[number]) => {
    const answer = answers[question.id];
    const done = question.answered || answer?.put;
    const draft = complex.drafts[question.id] ?? answer?.text ?? "";
    return `<li class="q-row${done ? " done" : ""}">
      <span class="q-mark">${done ? "✓" : MINI_SPIDER}</span>
      <div class="q-body">
        <button type="button" class="q-label-link" data-show-question="${escape(question.id)}" title="Show it on the page">${escape(short(question.label, 140))}${question.required ? " <span class=\"req\">*</span>" : ""}</button>
        ${answer?.error ? `<span class="small" style="color: var(--warn)">${escape(answer.error)}</span>` : ""}
        ${answer?.text ? `<details class="q-answer" data-answer-id="${escape(question.id)}" ${complex.open.has(question.id) ? "open" : ""}><summary>${answer.put ? "Answer, in the box" : "Answer"}</summary>
          <div class="letter-form flat"><textarea class="field letter-input" rows="5" data-draft="${escape(question.id)}" aria-label="Answer to ${escape(short(question.label, 60))}">${escape(draft)}</textarea>
          <div class="links"><button type="button" class="link" data-put="${escape(question.id)}">Put it in the box</button><button type="button" class="link" data-copy="${escape(question.id)}">Copy</button></div></div>
        </details>` : ""}
      </div>
    </li>`;
  };
  return `
    <section class="job-box applying" aria-label="Applying">
      <div class="row-between"><span class="eyebrow">Applying${details.data?.company ? ` · ${escape(short(details.data.company, 28))}` : ""}</span><button type="button" class="quiet-link tight" id="stop-applying">Stop</button></div>
      ${resume}
      ${applying.questions.length ? `
        <div class="q-head"><span class="heading">${applying.questions.length} complex ${applying.questions.length === 1 ? "question" : "questions"}</span><span class="mono">${open.length} LEFT</span></div>
        <ul class="q-list">${applying.questions.map(row).join("")}</ul>
        ${complex.busy
          ? `<div class="letter-writing" role="status">${typingSpiderSvg(90, spiderLook)}<span class="small">Answering ${open.length} ${open.length === 1 ? "question" : "questions"}…</span></div>`
          : open.length ? `<button type="button" class="btn primary big" id="answer-complex">${SPARK_SMALL}Answer complex questions${answersCost(open.length)}</button>${usesLine(usesNow?.answers.note)}` : ""}
        <span class="sub">Written from your resume and profile. Read each one before you submit.</span>`
        : `<p class="note">No complex questions on this page. If the form has more steps, the spiders show up there.</p>`}
      ${complex.note ? `<p class="small" role="status">${escape(complex.note)}</p>` : ""}
      ${hereLinks()}
    </section>`;
}

function wireJobBox(state: PanelState) {
  const tabId = state.tab?.id;
  if (tabId === undefined) return;
  document.getElementById("begin-applying")?.addEventListener("click", async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    button.textContent = "Uploading your resume…";
    complex.note = "";
    const result = await ask<{ ok: boolean; error?: string }>({ type: "begin-applying", tabId }).catch(() => ({ ok: false, error: "Couldn't reach the page." }));
    if (!result.ok) complex.note = result.error ?? "Couldn't start.";
    void render();
  });
  document.getElementById("stop-applying")?.addEventListener("click", async () => {
    Object.assign(complex, { busy: false, note: "", drafts: {} });
    complex.open.clear();
    await ask({ type: "stop-applying", tabId });
    void render();
  });
  document.getElementById("answer-complex")?.addEventListener("click", async () => {
    complex.busy = true;
    complex.note = "";
    void render();
    type Done = { ok: boolean; written?: number; stopped?: string; error?: string };
    const result = await ask<Done>({ type: "answer-complex", tabId, job: pageJob(state) }).catch((): Done => ({ ok: false, error: "Couldn't reach Unnepo." }));
    complex.busy = false;
    complex.note = !result.ok ? result.error ?? "Couldn't answer them." : result.stopped ? result.stopped : result.written ? `Answered ${result.written}. Check each one on the page.` : "Couldn't write any of these. Answer them yourself.";
    void render();
  });
  app.querySelectorAll<HTMLButtonElement>("[data-show-question]").forEach((button) => button.addEventListener("click", () => void ask({ type: "show-question", tabId, id: button.dataset.showQuestion })));
  app.querySelectorAll<HTMLDetailsElement>("details[data-answer-id]").forEach((box) => box.addEventListener("toggle", () => {
    if (box.open) complex.open.add(box.dataset.answerId!);
    else complex.open.delete(box.dataset.answerId!);
  }));
  app.querySelectorAll<HTMLTextAreaElement>("[data-draft]").forEach((box) => box.addEventListener("input", () => { complex.drafts[box.dataset.draft!] = box.value; }));
  app.querySelectorAll<HTMLButtonElement>("[data-put]").forEach((button) => button.addEventListener("click", async () => {
    const id = button.dataset.put!;
    const text = complex.drafts[id] ?? state.applying?.answers?.[id]?.text ?? "";
    const result = await ask<{ ok: boolean; reason?: string }>({ type: "put-answer", tabId, id, text }).catch(() => ({ ok: false, reason: "Couldn't reach the page." }));
    if (result.ok) delete complex.drafts[id];
    complex.note = result.ok ? "Put in the box." : result.reason ?? "Couldn't put it in.";
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    await refresh();
    void render();
  }));
  app.querySelectorAll<HTMLButtonElement>("[data-copy]").forEach((button) => button.addEventListener("click", () => {
    const id = button.dataset.copy!;
    const text = complex.drafts[id] ?? state.applying?.answers?.[id]?.text ?? "";
    void navigator.clipboard.writeText(text).then(() => { complex.note = "Copied."; void render(); }, () => undefined);
  }));
}

/** "I already applied" and "Save for later": read the job on the tab and save it. */
const hereLinks = () => {
  const busy = here.step === "reading" || here.step === "saving";
  return `<div class="row-between"><button type="button" class="quiet-link" id="here-applied" ${busy ? "disabled" : ""}>I already applied</button><button type="button" class="quiet-link" id="here-later" ${busy ? "disabled" : ""}>Save for later</button></div>`;
};

/** The page for the tab: what's happening decides it. */
function homeView(state: PanelState) {
  if (isRunning(state)) return fillingView();
  ensureTracker();
  const note = here.note ? `<p class="small" role="status">${escape(here.note)}</p>` : "";
  const card = openedCard(state);
  if (state.job?.submission || state.job?.error) return card + homeLists(state);
  if (card) return here.step === "check" ? card : card + homeLists(state);
  if (AUTOFILL_ENABLED && jobFound(state)) return jobFillPage(state);
  // Week is just the week. The job on the tab (Begin applying) and the tools are on the Jobs tab.
  if (!AUTOFILL_ENABLED) return note + homeLists(state);
  const how = dismissal(state);
  const onWeb = Boolean(state.tab && /^https:\/\//.test(state.tab.url)) && !onUnnepo(state);
  return `${how ? `<div class="row-between"><span class="sub">${how === "skipped" ? "Job skipped." : "Marked as not a job."}</span><button type="button" class="quiet-link" id="undo-dismiss">Undo</button></div>` : ""}
    ${onWeb && !how ? hereLinks() : ""}${note}${homeLists(state)}`;
}

/** Back, on a page opened from a tab: a job's page goes back where it came from, Feedback to Settings. */
const back = () => `<button type="button" class="back" data-go="${view === "feedback" ? "settings" : jobFrom}"><span aria-hidden="true">‹</span> Back</button>`;

/** A job's own page: its status, its link, and the people at the company with their emails. */
function jobView() {
  ensureTracker();
  const job = jobById(openedJob.id);
  if (!job) return store.tracker ? `<p class="note">That job isn't in your tracker any more.</p>` : `<p class="note">Loading the job…</p>`;
  return jobPage(job, openedJob.contact || undefined);
}

/** A page that was asked for. */
function pageView(state: PanelState) {
  const heading = (text: string) => `<div class="row-between"><span class="heading">${text}</span></div>`;
  const pages: Record<Exclude<View, "home">, () => string> = {
    job: jobView,
    jobs: () => jobsView(state),
    feedback: () => `${heading("Feedback")}${issuesCard()}`,
    // Me: who you are and your plan, friends, how Unnepo behaves, then help. Sign out and the version last.
    settings: () => `${profileCard(state)}
      ${friendsSettingsCard()}
      ${trackingSettings(state)}
      <section class="page settings-card" aria-label="Help">
        <span class="eyebrow">Help</span>
        ${part("activity", "What Unnepo noticed lately", () => activityCard())}
        <button type="button" class="more-row" data-go="feedback">Report a problem or send feedback <span aria-hidden="true">›</span></button>
      </section>
      <div class="row-between settings-foot"><button type="button" class="quiet" id="disconnect">Sign out</button><span class="mono">V${escape(extensionVersion())}</span></div>`,
  };
  return (TABS.includes(view) ? "" : back()) + pages[view as Exclude<View, "home">]();
}
/** On Free: the account works as Free (the trial over, no paid plan). */
const onFree = (state: PanelState | null) => Boolean(state?.connected && state.me?.usage?.free);

/** Saved between redraws: which parts of Me are open. */
const openParts = new Set<string>();
const part = (id: string, title: string, body: () => string) => `
  <details class="part" data-part-id="${id}" ${openParts.has(id) ? "open" : ""}>
    <summary>${title}</summary>
    ${openParts.has(id) ? body() : ""}
  </details>`;


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
  if (!AUTOFILL_ENABLED || !setup || setupSkipped === null || state.job?.running || state.job?.report) return "";
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
 * read in a background tab, LinkedIn too) and fills in the title, company and description. A box the student
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
    return `<section class="page" aria-label="Saved"><p class="note ok" role="status">${escape(here.note)}</p>${here.savedUrl ? `<div class="links"><button type="button" class="link" data-open-saved="${escape(here.savedUrl)}">See it and the people there</button></div>` : ""}</section>`;
  }
  if (!state.tab || !/^https:\/\//.test(state.tab.url) || onUnnepo(state) || state.job?.running || state.job?.submission) return "";
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
  // Reading and saving after "I already applied" or "Save for later".
  if (here.step === "reading" || here.step === "saving") return `<p class="note" role="status">${here.step === "reading" ? "Reading the job…" : "Saving…"}</p>`;
  return "";
}
function wireOpened(state: PanelState) {
  if (!state.tab) return;
  const tabId = state.tab.id;
  const read = async (applied: boolean) => {
    Object.assign(here, { step: "reading", applied, note: "", auto: false });
    view = "home";
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
    if (result.ok) void loadTracker(true);
    if (result.ok) Object.assign(here, { step: "saved", savedUrl: result.id ?? "", note: `✓ Success! ${named} ${here.applied ? "is added to your Applied jobs" : "is saved for later"}.${result.companyMissing ? " Unnepo is finding the company from the job's link." : ""}` });
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
      ${activityLog.length ? `<ul class="needs activity">${activityLog.slice(0, 15).map((item) => `<li><span class="mono small">${when(item.at)}</span> ${escape(item.text)}</li>`).join("")}</ul>` : `<p class="note">Nothing yet. Apply to a job and what Unnepo notices shows up here.</p>`}
    </section>`;
}

/** A cover letter from a pasted job description, when there's no job on the tab. */
let pasteText = "";
/** Which letter is showing: for the job on the tab, or for a pasted description. */
let letterSource: "job" | "paste" = "job";

/** The popup's frame: its question, how far along it is, and a way back. */
function popupShell(title: string, body: string, step = 0, steps = 0) {
  const bars = steps > 1 ? `<div class="steps" role="img" aria-label="Question ${step + 1} of ${steps}">${Array.from({ length: steps }, (_, at) => `<div class="${at <= step ? "on" : ""}"></div>`).join("")}</div>` : "";
  return `
    <div class="dim" id="popup-dim"></div>
    <section class="sheet" id="popup" role="dialog" aria-modal="true" aria-label="${escape(title)}" tabindex="-1">
      <div class="popup-head"><span class="popup-title">${escape(title)}</span><button type="button" class="popup-x" id="popup-close" aria-label="Close">×</button></div>
      ${bars}
      ${body}
      ${step > 0 ? `<button type="button" class="back" id="popup-back"><span aria-hidden="true">‹</span> Back</button>` : ""}
    </section>`;
}
/** One big choice. */
const option = (attr: string, value: string, label: string, hint: string, on: boolean) =>
  `<button type="button" class="opt${on ? " on" : ""}" data-${attr}="${value}" aria-pressed="${on}">${label}<small>${hint}</small></button>`;

function coverPopup(state: PanelState) {
  const forJob = jobFound(state);
  const busy = letterStep === "writing" || letterStep === "revising" || letterStep === "saving";
  const note = letterNote ? `<p class="small" role="status">${escape(letterNote)}</p>` : "";
  if (busy || (letter && letterStep === "written" && letterSource === (forJob ? "job" : "paste"))) {
    return popupShell("Your cover letter", `${writingSpider()}${letter ? writtenLetter(busy, forJob) : ""}${note}`);
  }
  const highlights = state.me?.highlights ?? [];
  const steps = [...(forJob ? [] : ["paste"]), "format", "length", "tone", "mention"];
  const step = Math.min(popup!.step, steps.length - 1);
  popup!.step = step;
  const title = state.job?.title || state.page?.title;
  const company = state.job?.company || state.page?.company;
  const forLine = forJob && title ? `<div class="sub">For ${escape(title)}${company ? ` at ${escape(company)}` : ""}</div>` : "";
  const pick = (name: "length" | "tone" | "format", value: string, label: string, hint: string) => option("letter", `${name}:${value}`, label, hint, letterChoices[name] === value);
  const bodies: Record<string, [string, () => string]> = {
    paste: ["Paste the job description", () => `<div class="letter-form flat"><textarea class="field letter-input paste" id="paste-desc" rows="8" maxlength="8000" aria-label="Job description" placeholder="Paste the whole job description">${escape(pasteText)}</textarea><button type="button" class="btn primary big" id="popup-next" ${pasteButton().disabled ? "disabled" : ""}>${pasteButton().label}</button></div>`],
    format: ["How should it be built?", () => `<div class="stack tight">${pick("format", "match", "Match the job (recommended)", "Answers the posting's top asks, one by one")}${pick("format", "problem", "Problem, then solution", "Names what the role needs, shows you've done it")}${pick("format", "achievement", "Lead with a win", "Opens with your strongest result")}${pick("format", "story", "Short story", "Opens with a real moment from your experience")}</div>`],
    length: ["How long should it be?", () => `<div class="stack tight">${pick("length", "short", "Short", "A few lines")}${pick("length", "standard", "Standard", "The usual cover letter")}${pick("length", "detailed", "Detailed", "More on your experience")}</div>`],
    tone: ["What tone?", () => `<div class="stack tight">${pick("tone", "professional", "Professional", "Polished and direct")}${pick("tone", "warm", "Warm", "Friendly and personal")}${pick("tone", "confident", "Confident", "Leads with what you've done")}${pick("tone", "enthusiastic", "Enthusiastic", "Shows you're excited")}</div>`],
    mention: [highlights.length ? "Mention specific things from your resume" : "Anything to mention?", () => `<div class="letter-form flat">${highlights.length ? `<div class="choices" role="group" aria-label="Things from your resume">${highlights.map((item) => `<button type="button" class="choice${letterChoices.picked.includes(item) ? " on" : ""}" data-highlight="${escape(item)}" aria-pressed="${letterChoices.picked.includes(item)}">${escape(item)}</button>`).join("")}</div>` : ""}<textarea class="field letter-input" id="letter-mention" rows="2" maxlength="400" aria-label="Anything else to mention (optional)" placeholder="${highlights.length ? "Anything else? Optional" : "Optional: a project, why this company, a skill to lead with…"}">${escape(letterChoices.mention)}</textarea><button type="button" class="btn primary big" id="letter-write">${SPARK_SMALL}${withCost("Write cover letter", "letters")}</button>${usesLine(usesNow?.letters.note)}</div>`],
  };
  const [question, body] = bodies[steps[step]];
  return popupShell(question, `${forLine}${body()}${note}`, step, steps.length);
}

/** An empty box offers a generic letter; once something's typed, it needs the whole description to go on. */
const pasteButton = () => {
  const typed = pasteText.trim().length;
  return { label: typed ? "Next" : "Write generic one", disabled: typed > 0 && typed < 80 };
};

/**
 * "Answer a question": first a choice. One question: paste it, pick a length, get the answer to copy. All on this
 * page: Unnepo finds the complex questions on the form (written ones a profile can't answer), writes every answer,
 * and shows each question with its answer here, to edit, copy, or put in its box.
 */
const answering = { mode: "" as "" | "one" | "all", question: "", length: "paragraph", answer: "", busy: false, finding: false, note: "" };
function answerPopup(state: PanelState) {
  const note = answering.note ? `<p class="small" role="status">${escape(answering.note)}</p>` : "";
  if (popup!.step === 0) {
    answering.mode = "";
    const choose = (value: string, label: string, hint: string) => `<button type="button" class="opt" data-answer-mode="${value}">${label}<small>${hint}</small></button>`;
    return popupShell("Answer a question", `<div class="stack tight">
      ${choose("one", "One question", "Paste a question and get an answer to copy")}
      ${choose("all", "All the questions on this page", "Finds the written questions on this application and answers each one")}
    </div>${note}`);
  }
  if (answering.mode === "all") return allQuestionsPopup(state, note);
  if (answering.busy) return popupShell("Writing your answer", `<div class="letter-writing" role="status">${typingSpiderSvg(120, spiderLook)}<span class="small">Writing your answer…</span></div>`);
  if (answering.answer) {
    return popupShell("Your answer", `
      <section class="letter-form flat">
        <label class="q-label" for="answer-text">Check it, change it, then copy it.</label>
        <textarea class="cv-text" id="answer-text">${escape(answering.answer)}</textarea>
        <div class="links"><button type="button" class="solid" id="answer-copy">Copy</button><button type="button" class="link" id="answer-again">Answer another</button></div>
      </section>${note}`);
  }
  const pick = (value: string, label: string, hint: string) => option("answer-length", value, label, hint, answering.length === value);
  if (popup!.step === 1) return popupShell("Paste the question", `<div class="letter-form flat"><textarea class="field letter-input" id="answer-q" rows="5" maxlength="600" aria-label="The question from the form" placeholder="e.g. Describe a time you led a team">${escape(answering.question)}</textarea><button type="button" class="btn primary big" id="popup-next" ${answering.question.trim() ? "" : "disabled"}>Next</button></div>${note}`, 1, 3);
  return popupShell("How long should it be?", `<div class="stack tight">${pick("short", "A few sentences", "For short boxes on a form")}${pick("paragraph", "A paragraph", "The usual length")}${pick("long", "Longer", "For essay questions")}</div><button type="button" class="btn primary big" id="answer-write">${SPARK_SMALL}${withCost("Answer question", "answers")}</button>${usesLine(usesNow?.answers.note)}${note}`, 2, 3);
}

/** Every complex question on the page, each with its answer once written. */
function allQuestionsPopup(state: PanelState, note: string) {
  const title = "Questions on this page";
  if (answering.finding) return popupShell(title, `<div class="letter-writing" role="status">${typingSpiderSvg(110, spiderLook)}<span class="small">Looking for questions…</span></div>`, 1, 0);
  const applying = state.applying;
  const questions = applying?.questions ?? [];
  if (!questions.length) {
    return popupShell(title, `<p class="note">No written questions on this page. Open the application's questions, then look again.</p>
      <button type="button" class="btn primary big" id="find-questions">Look again</button>${note}`, 1, 0);
  }
  const answers = applying!.answers ?? {};
  const unanswered = questions.filter((question) => !question.answered && !answers[question.id]?.text);
  const notPut = questions.filter((question) => answers[question.id]?.text && !answers[question.id]?.put);
  const row = (question: (typeof questions)[number], index: number) => {
    const answer = answers[question.id];
    const draft = complex.drafts[question.id] ?? answer?.text ?? "";
    const status = answer?.put ? `<span class="status done">In the box ✓</span>` : question.answered ? `<span class="status done">Already answered</span>` : "";
    return `<li class="q-row all${answer?.put ? " done" : ""}">
      <div class="q-body">
        <div class="row-between"><span class="mono">Q${index + 1}</span>${status}</div>
        <button type="button" class="q-label-link" data-show-question="${escape(question.id)}" title="Show it on the page">${escape(short(question.label, 220))}${question.required ? " <span class=\"req\">*</span>" : ""}</button>
        ${answer?.error ? `<span class="small" style="color: var(--warn)">${escape(answer.error)}</span>` : ""}
        ${answer?.text ? `<div class="letter-form flat"><textarea class="field letter-input" rows="5" data-draft="${escape(question.id)}" aria-label="Answer to ${escape(short(question.label, 60))}">${escape(draft)}</textarea>
          <div class="links"><button type="button" class="link" data-put="${escape(question.id)}">${answer.put ? "Put it in again" : "Put it in the box"}</button><button type="button" class="link" data-copy="${escape(question.id)}">Copy</button></div></div>`
          : question.answered ? "" : `<span class="small">Not answered yet.</span>`}
      </div>
    </li>`;
  };
  const action = complex.busy
    ? `<div class="letter-writing" role="status">${typingSpiderSvg(90, spiderLook)}<span class="small">Answering ${unanswered.length} ${unanswered.length === 1 ? "question" : "questions"}…</span></div>`
    : unanswered.length ? `<button type="button" class="btn primary big" id="answer-all">${SPARK_SMALL}Answer ${unanswered.length === questions.length ? "all " : ""}${unanswered.length} ${unanswered.length === 1 ? "question" : "questions"}${answersCost(unanswered.length)}</button>${usesLine(usesNow?.answers.note)}`
    : notPut.length > 1 ? `<button type="button" class="btn primary big" id="put-all">Put all ${notPut.length} in their boxes</button>` : "";
  return popupShell(title, `
    <div class="q-head"><span class="heading">${questions.length} ${questions.length === 1 ? "question" : "questions"}</span><button type="button" class="quiet-link tight" id="find-questions">Look again</button></div>
    ${action}
    <ul class="q-list">${questions.map(row).join("")}</ul>
    <span class="sub">Written from your resume and profile. Read each one before you submit. Tap a question to see it on the page.</span>
    ${complex.note ? `<p class="small" role="status">${escape(complex.note)}</p>` : ""}${note}`, 1, 0);
}

function popupView(state: PanelState) {
  if (!popup || !state.connected || isRunning(state)) return "";
  return popup.kind === "cover" ? coverPopup(state) : answerPopup(state);
}
/** Closes the popup, letting go of a box so what's behind it can be drawn. */
function closePopup() {
  popup = null;
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  void render();
}
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && popup) closePopup(); });
/** Puts the cursor in the question's box, or on the popup, each time the question changes. */
let popupFocused = "";
function focusPopup() {
  const box = document.getElementById("popup");
  const key = box ? box.getAttribute("aria-label") ?? "" : "";
  if (key === popupFocused) return;
  // It slides up only on opening: a redraw while it's open mustn't make it flash.
  if (box && !popupFocused) box.classList.add("entering");
  popupFocused = key;
  if (box) (box.querySelector<HTMLElement>("textarea:not(.cv-text)") ?? box).focus({ preventScroll: true });
}

function wirePopup() {
  app.querySelectorAll<HTMLButtonElement>("[data-popup]").forEach((button) => button.addEventListener("click", () => {
    popup = { kind: button.dataset.popup as "cover" | "answer", step: 0 };
    void render();
  }));
  document.getElementById("popup-close")?.addEventListener("click", closePopup);
  document.getElementById("popup-dim")?.addEventListener("click", closePopup);
  // The panel doesn't redraw while a box has the cursor, so moving on lets go of it.
  const move = (by: number) => () => {
    if (!popup) return;
    popup.step = Math.max(0, popup.step + by);
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    void render();
  };
  document.getElementById("popup-next")?.addEventListener("click", move(1));
  document.getElementById("popup-back")?.addEventListener("click", move(-1));
}

/** Finds the complex questions on the page (no resume upload), for "All the questions on this page". */
async function findQuestions(tabId: number) {
  answering.finding = true;
  answering.note = "";
  complex.note = "";
  void render();
  const result = await ask<{ ok: boolean; error?: string }>({ type: "begin-applying", tabId, questionsOnly: true }).catch(() => ({ ok: false, error: "Couldn't reach the page. Reload it and try again." }));
  answering.finding = false;
  if (!result.ok) answering.note = result.error ?? "Couldn't read the page.";
  await refresh();
  void render();
}

function wireAnswer(tabId: number) {
  app.querySelectorAll<HTMLButtonElement>("[data-answer-mode]").forEach((button) => button.addEventListener("click", () => {
    answering.mode = button.dataset.answerMode as "one" | "all";
    answering.note = "";
    if (popup) popup.step = 1;
    if (answering.mode === "all") void findQuestions(tabId);
    else void render();
  }));
  document.getElementById("find-questions")?.addEventListener("click", () => void findQuestions(tabId));
  document.getElementById("answer-all")?.addEventListener("click", async () => {
    complex.busy = true;
    complex.note = "";
    void render();
    type Done = { ok: boolean; written?: number; stopped?: string; error?: string };
    const result = await ask<Done>({ type: "answer-complex", tabId, job: lastState ? pageJob(lastState) : null, put: false }).catch((): Done => ({ ok: false, error: "Couldn't reach Unnepo." }));
    complex.busy = false;
    complex.note = !result.ok ? result.error ?? "Couldn't answer them." : result.stopped ? result.stopped : result.written ? `Answered ${result.written}. Read each one, then put it in its box or copy it.` : "Couldn't write any of these. Answer them yourself.";
    await refresh();
    void render();
  });
  document.getElementById("put-all")?.addEventListener("click", async () => {
    const applying = lastState?.applying;
    if (!applying) return;
    let put = 0;
    for (const question of applying.questions) {
      const answer = applying.answers?.[question.id];
      if (!answer?.text || answer.put) continue;
      const text = complex.drafts[question.id] ?? answer.text;
      const result = await ask<{ ok: boolean }>({ type: "put-answer", tabId, id: question.id, text }).catch(() => ({ ok: false }));
      if (result.ok) { put += 1; delete complex.drafts[question.id]; }
    }
    complex.note = put ? `Put ${put} in their boxes. Check them on the page.` : "Couldn't put them in. Copy each one instead.";
    await refresh();
    void render();
  });
  const box = document.getElementById("answer-q") as HTMLTextAreaElement | null;
  box?.addEventListener("input", () => {
    answering.question = box.value;
    const next = document.getElementById("popup-next") as HTMLButtonElement | null;
    if (next) next.disabled = !box.value.trim();
  });
  app.querySelectorAll<HTMLButtonElement>("[data-answer-length]").forEach((button) => button.addEventListener("click", () => {
    answering.length = button.dataset.answerLength ?? "paragraph";
    void render();
  }));
  document.getElementById("answer-write")?.addEventListener("click", async () => {
    answering.busy = true;
    answering.note = "";
    void render();
    type Written = { ok: boolean; answer?: string; error?: string };
    const result = await ask<Written>({ type: "answer-question", tabId, question: answering.question, length: answering.length, job: lastState && jobFound(lastState) ? pageJob(lastState) : null }).catch((): Written => ({ ok: false, error: "Couldn't reach Unnepo." }));
    answering.busy = false;
    if (result.ok && result.answer) answering.answer = result.answer;
    else answering.note = result.error ?? "Couldn't write this one.";
    void render();
  });
  const written = document.getElementById("answer-text") as HTMLTextAreaElement | null;
  written?.addEventListener("input", () => { answering.answer = written.value; });
  document.getElementById("answer-copy")?.addEventListener("click", () => {
    void navigator.clipboard.writeText(answering.answer).then(() => { answering.note = "Copied."; void render(); }, () => { answering.note = "Couldn't copy. Select the text and copy it."; void render(); });
  });
  document.getElementById("answer-again")?.addEventListener("click", () => {
    Object.assign(answering, { question: "", answer: "", note: "" });
    if (popup) popup.step = 1;
    void render();
  });
}

/**
 * The cover letter writer: the popup asks one question at a time (the job description when there's no job on
 * the tab, then length, tone, anything to mention), writes it, then offers a box for edits. Kept across redraws.
 */
type Letter = { text: string; fileName: string; pdfBase64: string; addedToApplied?: boolean; tailored?: boolean; upgrade?: string | null };
let letter: Letter | null = null;
let letterStep: "closed" | "writing" | "written" | "revising" | "saving" = "closed";
let letterNote = "";
/** The student typed into the letter since the PDF was made, so the PDF is remade from their text first. */
let letterEdited = false;
/** The tab and job the letter is for. */
let letterFor = "";
const letterChoices = { format: "match", length: "standard", tone: "professional", picked: [] as string[], mention: "", edit: "" };

/** While the AI writes: the spider typing on his laptop. */
const writingSpider = () => (letterStep === "writing" || letterStep === "revising"
  ? `<div class="letter-writing" role="status">${typingSpiderSvg(150, spiderLook)}<span class="small">${letterStep === "writing" ? "Writing your cover letter…" : "Rewriting your cover letter…"}</span></div>`
  : "");

/** The letter, with Copy and PDF, and a box for edits. */
function writtenLetter(busy: boolean, forJob: boolean) {
  return `
    <div class="letter-form" id="letter-form">
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
        ${forJob ? `<button type="button" class="link" data-attach-letter ${attachBusy ? "disabled" : ""}>${attachBusy ? "Attaching…" : "Attach to application"}</button>` : ""}
      </div>
      ${forJob && attachNote ? `<p class="small" role="status">${escape(attachNote)}</p>` : ""}
      <label class="question"><span class="q-label">Any edits you'd like to make?</span>
        <textarea class="field letter-input" id="letter-edit" rows="2" maxlength="600" placeholder="Shorter, mention my internship, sound more excited…">${escape(letterChoices.edit)}</textarea>
      </label>
      <div class="links">
        <button type="button" class="solid" id="letter-revise" ${busy || !letterChoices.edit.trim() ? "disabled" : ""}>${letterStep === "revising" ? "Rewriting…" : "Make these edits"}</button>
        <button type="button" class="link" id="letter-restart" ${busy ? "disabled" : ""}>Start over</button>
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
  letterSource = fromPaste ? "paste" : "job";
  // Let go of the box, or the panel keeps it as it is and the spider never shows.
  if (document.activeElement?.closest(".letter-form")) (document.activeElement as HTMLElement).blur();
  void render();
  // No description pasted: a generic letter, and so are its edits.
  const source = fromPaste && !pasteText.trim() ? { generic: true } : {};
  const options = part
    ? { previous: letter?.text ?? "", part: part.part, ask: part.ask }
    : save
    ? { text: letter?.text ?? "" }
    : revise
      ? { previous: letter?.text ?? "", edit: letterChoices.edit }
      : { format: letterChoices.format, length: letterChoices.length, tone: letterChoices.tone, mention: [...letterChoices.picked, letterChoices.mention.trim()].filter(Boolean).join("; ") };
  type Result = { ok: boolean; doc?: Letter; error?: string };
  const job = !fromPaste && lastState ? pageJob(lastState) : null;
  const result = await ask<Result>({ type: "generate-letter", tabId, options: { ...options, ...source }, ...(fromPaste ? { description: pasteText } : {}), ...(job ? { job } : {}) }).catch((): Result => ({ ok: false, error: "Couldn't reach Unnepo." }));
  if (result.ok && result.doc) {
    letter = result.doc;
    letterStep = "written";
    letterEdited = false;
    if (revise) letterChoices.edit = "";
    if (save) letterNote = "Saved. The PDF has your edits.";
    // Free: a general letter. Says what Pro does instead.
    if (result.doc.upgrade && !save) letterNote = `A general letter. ${result.doc.upgrade}`;
  } else {
    letterStep = letter ? "written" : "closed";
    letterNote = result.error ?? "Couldn't write the cover letter.";
  }
  // The panel doesn't redraw while a box has the cursor, so let go of it to show the letter.
  if (document.activeElement?.closest(".letter-form")) (document.activeElement as HTMLElement).blur();
  void render();
}

function wireLetter(tabId: number, fromPaste: boolean) {
  document.getElementById("letter-restart")?.addEventListener("click", () => {
    letterStep = "closed";
    letterNote = "";
    if (popup) popup.step = 0;
    void render();
  });
  // A choice answers the question and moves on to the next.
  app.querySelectorAll<HTMLButtonElement>("[data-letter]").forEach((button) => button.addEventListener("click", () => {
    const [name, value] = (button.dataset.letter ?? "").split(":");
    letterChoices[name as "length" | "tone" | "format"] = value;
    if (popup) popup.step += 1;
    void render();
  }));
  // Bubbles can be picked in any number, so they stay on this question.
  app.querySelectorAll<HTMLButtonElement>("[data-highlight]").forEach((button) => button.addEventListener("click", () => {
    const item = button.dataset.highlight ?? "";
    letterChoices.picked = letterChoices.picked.includes(item) ? letterChoices.picked.filter((other) => other !== item) : [...letterChoices.picked, item];
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
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
  document.getElementById("letter-write")?.addEventListener("click", () => void writeLetter(tabId, false, fromPaste));
  revise?.addEventListener("click", () => void writeLetter(tabId, true, fromPaste));
  const paste = document.getElementById("paste-desc") as HTMLTextAreaElement | null;
  paste?.addEventListener("input", () => {
    pasteText = paste.value;
    const next = document.getElementById("popup-next") as HTMLButtonElement | null;
    if (next) {
      next.disabled = pasteButton().disabled;
      next.textContent = pasteButton().label;
    }
  });
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


/** What happened with the last See / Replace, kept across re-renders. */
let resumeNote = "";
let resumeBusy = false;

/** The resume, small: its name opens it, Change picks a new one. */
function resumeLine(state: PanelState) {
  const resume = state.me!.resume;
  const name = resume ? escape(resume.fileName) : "None yet";
  const note = resumeNote || (resume && !resume.file ? "Unnepo only has this resume's text, not the file. Change it so it can be attached." : "");
  return `
    <div class="tool-line">
      <span class="tool-what">Resume</span>
      ${resume?.file ? `<button type="button" class="resume-link" id="open-resume" title="Open ${name}" ${resumeBusy ? "disabled" : ""}><span class="resume-link-name">${name}</span></button>` : `<span class="tool-value">${name}</span>`}
      <button type="button" class="tool-change" id="replace-resume" ${resumeBusy ? "disabled" : ""}>${resume ? "Change" : "Upload"}</button>
    </div>
    ${resume?.file ? `<button type="button" class="btn attach-btn" id="attach-resume" ${resumeAttach.busy ? "disabled" : ""}>${resumeAttach.busy ? "Attaching…" : "Attach resume to this application"}</button>` : ""}
    ${resumeAttach.note ? `<p class="small tool-note" role="status">${escape(resumeAttach.note)}</p>` : ""}
    ${note ? `<p class="small tool-note" role="status">${escape(note)}</p>` : ""}`;
}

/** "Attach resume to this application": the resume file into the page's resume upload box. */
const resumeAttach = { busy: false, note: "" };
async function attachResume() {
  const tabId = lastState?.tab?.id;
  if (tabId === undefined || resumeAttach.busy) return;
  resumeAttach.busy = true;
  resumeAttach.note = "";
  void render();
  type Attached = { ok: boolean; attached?: string[]; error?: string };
  const result = await ask<Attached>({ type: "attach-resume", tabId }).catch((): Attached => ({ ok: false, error: "Couldn't reach the page. Reload it and try again." }));
  resumeAttach.busy = false;
  resumeAttach.note = result.ok && result.attached?.length ? `✓ Attached to “${short(result.attached[0], 40)}”. Check it on the page.` : result.error ?? "Couldn't attach it.";
  void render();
}

/** Once a cover letter is written: its PDF beside the resume, with Attach to put it in the application's upload box. */
let attachNote = "";
let attachBusy = false;
function letterLine() {
  if (!letter?.pdfBase64) return "";
  return `
    <div class="tool-line">
      <span class="tool-what">Cover letter</span>
      <span class="tool-value">${escape(letter.fileName)}</span>
      <button type="button" class="tool-change" data-attach-letter ${attachBusy ? "disabled" : ""}>${attachBusy ? "Attaching…" : "Attach"}</button>
    </div>
    ${attachNote ? `<p class="small tool-note" role="status">${escape(attachNote)}</p>` : ""}`;
}
async function attachLetter() {
  const tabId = lastState?.tab?.id;
  if (!letter?.pdfBase64 || tabId === undefined || attachBusy) return;
  if (letterEdited) {
    attachNote = "Save your edits to the letter first, so the PDF has them.";
    return void render();
  }
  attachBusy = true;
  attachNote = "";
  void render();
  type Attached = { ok: boolean; attached?: string[]; error?: string };
  const result = await ask<Attached>({ type: "attach-letter", tabId, file: { name: letter.fileName, mime: "application/pdf", base64: letter.pdfBase64 } }).catch((): Attached => ({ ok: false, error: "Couldn't reach the page. Reload it and try again." }));
  attachBusy = false;
  attachNote = result.ok && result.attached?.length ? `✓ Attached to “${short(result.attached[0], 40)}”. Check it on the page.` : result.error ?? "Couldn't attach it.";
  void render();
}

async function seeResume() {
  resumeBusy = true;
  resumeNote = "Opening…";
  void render();
  const result = await ask<{ ok: boolean; file?: { name: string; mime: string; base64: string }; error?: string }>({ type: "get-resume" });
  resumeBusy = false;
  if (result.ok && result.file) {
    const bytes = Uint8Array.from(atob(result.file.base64), (char) => char.charCodeAt(0));
    void chrome.tabs.create({ url: URL.createObjectURL(new Blob([bytes], { type: result.file.mime })) });
    resumeNote = "";
  } else {
    resumeNote = `${result.error ?? "Couldn't open your resume."} Change it to fix this.`;
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
  const missing = me.missing ?? [];
  const credits = me.unlimitedCredits ? "Unlimited" : me.trial ? "Pro trial" : me.usage?.free ? "Resets every day" : `${me.usage?.credits ?? me.credits * 5} credits left`;
  const plan = me.trial ? "Pro trial" : (me.effectivePlan ?? me.plan ?? "free").replace(/^\w/, (letter) => letter.toUpperCase());
  const name = me.user.name || me.user.email;
  const initials = name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join("");
  return `
    <section class="page settings-card" aria-label="Account">
      <div class="account-head">
        <span class="account-av" aria-hidden="true">${escape(initials || "?")}</span>
        <span class="account-text"><span class="account-name">${escape(name)}</span>${me.user.name ? `<span class="sub">${escape(me.user.email)}</span>` : ""}</span>
      </div>
      <div class="account-plan"><span><strong>${escape(plan)}</strong> · ${credits}</span><a class="link" href="${escape(state.apiBase)}/home?tab=settings#plans" target="_blank" rel="noreferrer">Plans ↗</a></div>
      ${me.admin ? adminPlanSwitch(me.planPreview ?? null) : ""}
      ${me.usage?.free ? `<span class="small">Left today: ${me.usage.letters.left} cover letters · ${me.usage.answers.left} answers · ${me.usage.autofills.left} autofills. People: ${escape(me.usage.people.badge ?? `${me.usage.people.left} left`)}</span>` : ""}
      ${me.completeness < 100 ? `<div class="row-between"><span class="small"${!me.profileReady ? ' style="color: var(--warn)"' : ""}>Profile ${me.completeness}% done${missing.length ? `: ${missing.map(escape).join(", ")}` : ""}</span></div>
      <div class="bar" role="progressbar" aria-label="Profile ready" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${me.completeness}"><div style="width:${me.completeness}%"></div></div>` : ""}
      <a class="link" href="${escape(state.apiBase)}/home?edit=profile" target="_blank" rel="noreferrer">${me.completeness < 100 ? "Finish my profile" : "Edit my profile"} ↗</a>
    </section>`;
}

/** Admins only: see the product as a Free or a Pro student does. Billing never changes. */
let planSwitching = false;
function adminPlanSwitch(preview: "free" | "pro" | null) {
  const chip = (value: "real" | "free" | "pro", label: string) => {
    const on = (preview ?? "real") === value;
    return `<button type="button" class="chip${on ? " on" : ""}" data-plan-preview="${value}" aria-pressed="${on}" ${planSwitching ? "disabled" : ""}>${label}</button>`;
  };
  return `<div class="row-between"><span class="small">Admin · view as</span><div class="chips" role="group" aria-label="View Unnepo as">${chip("real", "My plan")}${chip("free", "Free")}${chip("pro", "Pro")}</div></div>`;
}
function wirePlanSwitch() {
  document.querySelectorAll<HTMLButtonElement>("[data-plan-preview]").forEach((button) => button.addEventListener("click", async () => {
    const value = button.dataset.planPreview;
    planSwitching = true;
    void render();
    const result = await ask<{ ok: boolean; error?: string }>({ type: "plan-preview", plan: value === "real" ? null : value }).catch(() => ({ ok: false, error: "Couldn't reach Unnepo." }));
    planSwitching = false;
    if (!result.ok) alert(result.error ?? "Couldn't switch plans.");
    void loadTracker(true);
    void render();
  }));
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
      <span class="mono">${list.length} SAVED</span>
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
let passwordMode: "hidden" | "editing" = "hidden";
let passwordNote = "";
let passwordCopied = false;

const COPY_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/></svg>`;

async function renderPassword() {
  const { password } = await ask<{ password?: string }>({ type: "get-password" });
  if (!password) return;
  const rules = (value: string) => PASSWORD_RULES.map((rule) => `<li class="${rule.test(value) ? "met" : ""}">${escape(rule.label)}</li>`).join("");
  const editing = passwordMode === "editing";
  passwordSection.innerHTML = `
    <div class="tool-line">
      <span class="tool-what">Job-site password</span>
      ${passwordCopied ? `<span class="tool-value copied" role="status">✓ Copied</span>` : editing ? `<span class="tool-value"></span>` : `<button type="button" class="stars" id="copy-password" aria-label="Copy job-site password" title="Copy">************${COPY_ICON}</button>`}
      <button type="button" class="tool-change" id="${editing ? "cancel-password" : "change-password"}">${editing ? "Cancel" : "Change"}</button>
    </div>
    ${editing ? `
      <input class="field" type="text" id="new-password" autocomplete="off" spellcheck="false" placeholder="Your new password" aria-label="New password">
      <ul class="rules" id="rules">${rules("")}</ul>
      <p class="small">Accounts Unnepo already made keep working with the password they were made with.</p>
      <div class="links"><button type="button" class="solid" id="save-password" disabled>Save password</button><button type="button" class="link" id="regenerate-password">Make a new one for me</button></div>
    ` : ""}
    ${passwordNote ? `<p class="small tool-note" role="status">${escape(passwordNote)}</p>` : ""}`;
  const redraw = (mode: typeof passwordMode, note = "") => { passwordMode = mode; passwordNote = note; void renderPassword(); };
  document.getElementById("copy-password")?.addEventListener("click", async () => {
    await navigator.clipboard.writeText(password).then(() => {
      passwordCopied = true;
      setTimeout(() => { passwordCopied = false; void renderPassword(); }, 1500);
      redraw(passwordMode);
    }, () => redraw(passwordMode, "Couldn't copy. Try again."));
  });
  document.getElementById("change-password")?.addEventListener("click", () => redraw("editing"));
  document.getElementById("cancel-password")?.addEventListener("click", () => redraw("hidden"));
  document.getElementById("regenerate-password")?.addEventListener("click", async () => {
    if (!confirm("Make a new password? Accounts Unnepo already made keep working: it remembers the password each one was made with. Accounts you made yourself aren't changed.")) return;
    await ask({ type: "new-password" });
    redraw("hidden", "New password made. Press the stars to copy it.");
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
  if (!manualJob.open) return `<button type="button" class="btn" id="add-job-open">+ Add a job I applied to</button>${manualJob.note ? `<p class="small" role="status">${escape(manualJob.note)}</p>` : ""}`;
  const ready = manualJob.title.trim().length >= 2 && manualJob.company.trim().length >= 2;
  const stage = (value: string, label: string) => `<option value="${value}"${manualJob.stage === value ? " selected" : ""}>${label}</option>`;
  return `
    <div class="letter-form" id="add-job-form">
      <span class="eyebrow">Add a job</span>
      <label class="question"><span class="q-label">Job title</span><input class="field" id="mj-title" value="${escape(manualJob.title)}" maxlength="200" placeholder="Growth Marketing Intern"></label>
      <label class="question"><span class="q-label">Company</span><input class="field" id="mj-company" value="${escape(manualJob.company)}" maxlength="200" placeholder="MealPal"></label>
      <label class="question"><span class="q-label">Job link</span><input class="field" id="mj-url" value="${escape(manualJob.url)}" maxlength="2000" placeholder="https://…"></label>
      <div class="links"><button type="button" class="link" id="mj-fill" ${linkReading ? "disabled" : ""}>${linkReading ? "Reading the link…" : "Fill in the job information"}</button></div>
      <label class="question"><span class="q-label">Status</span><select class="field" id="mj-stage">${stage("applied", "Applied")}${stage("in_progress", "Not applied yet")}${stage("follow_up", "Follow up")}${stage("interviewing", "Interviewing")}${stage("rejected", "Rejected")}</select></label>
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
      void loadTracker(true);
    } else manualJob.note = result.error ?? "Couldn't add it.";
    if (document.activeElement?.closest(".letter-form")) (document.activeElement as HTMLElement).blur();
    void render();
  });
}

/**
 * The Jobs tab. Logging jobs first: adding one by hand, "I already applied" for the job on the tab, and the jobs
 * the extension caught (the last 5 opened or applied to, each with its details). Below a divider, the tools: Autofill, a cover letter, answering a question, the resume and password.
 */
function jobsView(state: PanelState) {
  ensureTracker();
  return `
    <div class="jobs-log">
      ${manualJobForm()}
      ${jobFound(state) && !manualJob.open ? hereLinks() : ""}
      ${here.note ? `<p class="small" role="status">${escape(here.note)}</p>` : ""}
      ${detectedMenu()}
    </div>
    <div class="section-divider" role="separator"><span>Tools</span></div>
    ${toolsPage(state)}`;
}

/** Settings for catching applications, email links and reminders. Kept on this computer. */
let tracking: { autoDetect: "auto" | "ask"; mailer: Mailer; notify: boolean } | null = null;
void chrome.storage.local.get(["autoDetect", "mailer", "notify"]).then((stored) => {
  tracking = { autoDetect: stored.autoDetect === "ask" ? "ask" : "auto", mailer: (stored.mailer as Mailer | undefined) ?? "gmail", notify: stored.notify !== false };
});
function trackingSettings(state: PanelState) {
  if (!tracking) return "";
  const option = (name: string, value: string, label: string, on: boolean) => `<label class="check"><input type="radio" name="${name}" value="${value}" ${on ? "checked" : ""}>${label}</label>`;
  const mail = (value: Mailer, label: string) => `<option value="${value}"${tracking!.mailer === value ? " selected" : ""}>${label}</option>`;
  return `
    <section class="page settings-card" aria-label="Settings">
      <span class="eyebrow">Settings</span>
      <div class="stack tight">
        <span class="q-label">When a site confirms you applied</span>
        ${option("auto-detect", "auto", "Save it to my jobs (with Undo)", tracking.autoDetect === "auto")}
        ${option("auto-detect", "ask", "Ask me first", tracking.autoDetect === "ask")}
      </div>
      <label class="question"><span class="q-label">Email links open in</span>
        <select class="field" id="mailer">${mail("gmail", "Gmail")}${mail("outlook", "Outlook on the web")}${mail("mailto", "My computer's mail app")}</select>
      </label>
      <label class="check"><input type="checkbox" id="notify" ${tracking.notify ? "checked" : ""}>Remind me once a day when follow-ups are due</label>
      <label class="check"><input type="checkbox" id="pause" ${state.autoSubmit ? "" : "checked"}><span>Autofill <span class="beta">Beta</span> stops at Submit so I can check it</span></label>
    </section>`;
}
function wireTracking() {
  app.querySelectorAll<HTMLInputElement>('input[name="auto-detect"]').forEach((input) => input.addEventListener("change", () => {
    tracking!.autoDetect = input.value as "auto" | "ask";
    void chrome.storage.local.set({ autoDetect: input.value });
  }));
  document.getElementById("mailer")?.addEventListener("change", (event) => {
    const value = (event.target as HTMLSelectElement).value as Mailer;
    tracking!.mailer = value;
    store.mailer = value;
    void chrome.storage.local.set({ mailer: value });
    // Chosen: let redraws through again.
    (event.target as HTMLSelectElement).blur();
  });
  document.getElementById("notify")?.addEventListener("change", (event) => {
    tracking!.notify = (event.target as HTMLInputElement).checked;
    void chrome.storage.local.set({ notify: tracking!.notify });
  });
}

// The file picker lives outside the redrawn part of the panel, so a refresh can't lose the chosen file.
const resumeInput = document.getElementById("resume-input") as HTMLInputElement;
resumeInput.addEventListener("change", () => {
  const file = resumeInput.files?.[0];
  resumeInput.value = "";
  if (file) void replaceResume(file);
});


/** Puts the student's spider at the top of the panel. */
let dressed = "";
let spiderLook: SpiderLook | undefined;
function dressSpider(look?: SpiderLook) {
  const key = look ? `${look.skin}|${look.school ?? ""}` : "";
  if (!look || key === dressed) return;
  dressed = key;
  spiderLook = look;
  const spider = document.getElementById("spider")!;
  spider.querySelector("svg")?.remove();
  spider.insertAdjacentHTML("beforeend", heroSpiderSvg(look));
}

/**
 * The spider going down his thread from the top of the panel to the laptop when a fill starts, and back up when
 * it ends. He's the same size in both places. Who's on show meanwhile is set on the body, so a redraw can't undo it.
 */
let travelling = 0;
const heroRect = () => document.querySelector("#spider svg")!.getBoundingClientRect();
function laptopRect() {
  const svg = app.querySelector(".letter-writing svg");
  if (!svg) return null;
  const box = svg.getBoundingClientRect();
  // Where typingSpiderSvg draws him: 40×30 at (10, 1) in its 60×48.
  const scale = box.width / 60;
  return { left: box.left + 10 * scale, top: box.top + scale, width: 40 * scale, height: 30 * scale };
}
type Spot = { left: number; top: number; width: number; height: number };
function travel(from: Spot, to: Spot, ms: number, landed: () => void) {
  const trip = ++travelling;
  document.querySelector(".rappel")?.remove();
  const anchorX = heroRect().left + heroRect().width / 2;
  const box = document.createElement("div");
  box.className = "rappel";
  box.setAttribute("aria-hidden", "true");
  box.innerHTML = `<div class="rappel-thread"></div><div class="rappel-spider">${document.querySelector("#spider svg")!.outerHTML}</div>`;
  document.body.append(box);
  const thread = box.children[0] as HTMLElement;
  const spider = box.children[1] as HTMLElement;
  const place = (x: number, y: number, shrink = 1) => {
    const dx = x + from.width / 2 - anchorX;
    const dy = y + 12;
    thread.style.transform = `translate(${anchorX}px, 0) rotate(${-Math.atan2(dx, dy)}rad)`;
    thread.style.height = `${Math.hypot(dx, dy) * shrink}px`;
  };
  const start = performance.now();
  const frame = (now: number) => {
    if (trip !== travelling) return box.remove();
    const t = Math.min(1, (now - start) / ms);
    const eased = t < .5 ? 2 * t * t : 1 - (2 - 2 * t) ** 2 / 2;
    // A little swing on the thread, dying out. Moved in whole pixels of his art, so he stays crisp.
    const sway = Math.sin(t * Math.PI * 3) * 8 * (1 - t);
    const x = Math.round((from.left + (to.left - from.left) * eased + sway) / 2) * 2;
    const y = Math.round((from.top + (to.top - from.top) * eased) / 2) * 2;
    spider.style.transform = `translate(${x}px, ${y}px)`;
    place(x, y);
    if (t < 1) return void requestAnimationFrame(frame);
    // He's there: the real one takes over and the thread pulls back up.
    spider.remove();
    landed();
    const pulled = performance.now();
    const pull = (later: number) => {
      if (trip !== travelling) return box.remove();
      const left = 1 - (later - pulled) / 200;
      if (left <= 0) return box.remove();
      place(x, y, left);
      requestAnimationFrame(pull);
    };
    requestAnimationFrame(pull);
  };
  requestAnimationFrame(frame);
}
const stillMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
/** The last tab drawn and whether it was filling, to tell a fill starting from just opening one that's going. */
let lastFill: { tab: number | undefined; running: boolean; shown: boolean } | null = null;
function moveSpider(state: PanelState, shown: boolean, wasAt: Spot | null) {
  const running = isRunning(state);
  const same = lastFill?.tab === state.tab?.id;
  const started = shown && same && running && !lastFill!.running;
  const ended = !shown && same && !running && lastFill!.shown;
  lastFill = { tab: state.tab?.id, running, shown };
  const { classList } = document.body;
  const at = laptopRect();
  if (started && at && !stillMotion) {
    classList.add("spider-away", "spider-landing");
    travel(heroRect(), at, 1200, () => classList.remove("spider-landing"));
  } else if (ended && wasAt && !stillMotion) {
    classList.add("spider-away");
    classList.remove("spider-landing");
    travel(wasAt, heroRect(), 900, () => classList.remove("spider-away"));
  } else if (shown !== classList.contains("spider-away") && !document.querySelector(".rappel-spider")) {
    classList.toggle("spider-away", shown);
    classList.remove("spider-landing");
  }
}

/** The latest state, and what was last drawn from it, so a state that didn't change isn't drawn again. */
let lastState: PanelState | null = null;
let drawnFrom = "";
let fetching = false;
let fetchAgain = false;

/** Asks for the state, one request at a time, and draws it only if it changed. */
async function refresh() {
  if (fetching) { fetchAgain = true; return; }
  fetching = true;
  try {
    do {
      fetchAgain = false;
      const state = await ask<PanelState>({ type: "state" });
      const json = JSON.stringify(state);
      lastState = state;
      if (json !== drawnFrom) drawnFrom = draw(state) ? json : "";
    } while (fetchAgain);
  } finally {
    fetching = false;
  }
}

/** A click answers at once from what's already known, then the state is checked behind it. */
async function render() {
  if (lastState) draw(lastState);
  await refresh();
}

/** Draws the panel. False when it left the page as it was, because the student is typing in it. */
function draw(state: PanelState): boolean {
  usesNow = state.me?.usage ?? null;
  // A letter belongs to one job: opening another job (another tab, or another one in Handshake's search) closes it.
  // Keyed by the job's name, not the address, so the steps of one application keep it.
  const jobName = (state.job?.title || state.page?.title || "").toLowerCase();
  const letterJob = state.tab && jobName ? `${state.tab.id}|${jobName}` : letterFor;
  if (letterJob !== letterFor) {
    if (letterFor && letterSource === "job" && letterStep !== "writing" && letterStep !== "revising") { letter = null; letterStep = "closed"; letterNote = ""; letterChoices.picked = []; letterChoices.mention = ""; letterChoices.edit = ""; }
    letterFor = letterJob;
  }
  dressSpider(state.me?.spider);
  const said = lines(state);
  speech(said.lines, said.alert);
  if (!state.connected) view = "home";
  if (state.job?.running && fillPending === state.tab?.id) fillPending = null;
  tabBar.hidden = !state.connected;
  // Beside the logo: Upgrade to Pro on Free (the Upgrade to Pro page on the website), a Pro tag otherwise.
  planBadge.innerHTML = !state.connected || !state.me ? "" : onFree(state)
    ? `<a class="plan-badge" href="${escape(upgradeUrl(state))}" target="_blank" rel="noreferrer">Upgrade to Pro</a>`
    : `<span class="plan-badge pro">${state.me.trial ? "Pro trial" : "Pro"}</span>`;
  const tabNow = view === "job" ? jobFrom : view === "feedback" ? "settings" : view;
  // Me: friend requests.
  const badge = (element: HTMLElement, count: number) => { element.textContent = count ? String(count) : ""; element.hidden = !count; };
  // Jobs counts jobs with nobody emailed yet, plus caught jobs asking "Did you apply?".
  const asking = (store.detected ?? []).filter((item) => item.state === "ask").length;
  badge(jobsBadge, state.connected ? firstEmailCount() + asking : 0);
  badge(meBadge, state.connected ? friendRequests() : 0);
  tabBar.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((tab) => {
    const on = tab.dataset.tab === tabNow;
    tab.classList.toggle("on", on);
    if (on) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
  });
  // Don't wipe a code being typed when something else changes.
  if (!state.connected && document.getElementById("code") === document.activeElement) return false;
  // Don't wipe what's being typed in the cover letter questions or edits box when the page changes.
  // The same for a problem being reported.
  if (document.activeElement?.closest(".letter-form") && document.activeElement.matches("textarea, input")) return false;
  // Nor a new password being typed.
  if (document.activeElement?.matches("#password input")) return false;
  // Nor a search in Jobs, or a friend's email.
  if (document.activeElement?.matches("#job-search, #friend-email")) return false;
  // Nor an open dropdown: redrawing it closes the list before a choice is made.
  if (document.activeElement instanceof HTMLSelectElement && app.contains(document.activeElement)) return false;
  // Nor the job being checked before "I applied" saves it.
  if (document.activeElement?.closest("#here-form") && document.activeElement.matches("input")) return false;
  // The password is drawn on its own, so a redraw can't lose what's typed: it's moved out, then back into its slot.
  document.body.append(passwordSection);
  const shown = state.connected && view === "home" && isRunning(state);
  const wasAt = shown ? null : laptopRect();
  if (shown) popup = null;
  app.innerHTML = !state.connected ? connectView(state) : `${view === "home" ? homeView(state) : pageView(state)}${popupView(state)}`;
  focusPopup();
  moveSpider(state, shown, wasAt);
  const slot = document.getElementById("password-slot");
  passwordSection.hidden = !slot;
  // Forgotten on signing out.
  if (!state.connected) {
    passwordMode = "hidden";
    passwordSection.innerHTML = "";
  }
  if (slot) {
    slot.append(passwordSection);
    if (!passwordSection.innerHTML.trim()) void renderPassword();
  }
  app.querySelectorAll<HTMLButtonElement>("[data-go]").forEach((button) => button.addEventListener("click", () => go(button.dataset.go as View)));
  app.querySelectorAll<HTMLDetailsElement>("details.part").forEach((details) => details.addEventListener("toggle", () => {
    const id = details.dataset.partId!;
    if (details.open === openParts.has(id)) return;
    if (details.open) openParts.add(id);
    else openParts.delete(id);
    void render();
  }));
  // A job opens on its own page here, with the people at the company.
  wireJobRows(app);
  app.querySelectorAll<HTMLButtonElement>("[data-open-saved]").forEach((button) => button.addEventListener("click", () => openJob(button.dataset.openSaved!)));
  if (state.connected) {
    wireDetected(app);
    wireReminders(app);
    wireBubbles(app);
    wireWeek(app);
    wireFriends(app);
    wireJobsList(app);
    app.querySelectorAll<HTMLButtonElement>("[data-show-jobs]").forEach((button) => button.addEventListener("click", () => { showJobs("reach"); go("home"); }));
    const job = view === "job" ? jobById(openedJob.id) : null;
    if (job) wireJobPage(app, job);
    wireTracking();
  }
  document.getElementById("use-code")?.addEventListener("click", async () => {
    const code = (document.getElementById("code") as HTMLInputElement).value.trim();
    if (code.startsWith("unx_")) await ask({ type: "connect", token: code });
    void render();
  });
  document.getElementById("fill")?.addEventListener("click", () => {
    const tabId = state.tab!.id;
    fillPending = tabId;
    void ask({ type: "fill", tabId });
    // If the worker never says it's running, the job comes back instead of the spider typing forever.
    setTimeout(() => { if (fillPending === tabId) { fillPending = null; void render(); } }, 5000);
    void render();
  });
  document.getElementById("beta-fill")?.addEventListener("click", () => {
    const tabId = state.tab!.id;
    fillPending = tabId;
    void ask({ type: "fill", tabId, beta: true });
    setTimeout(() => { if (fillPending === tabId) { fillPending = null; void render(); } }, 5000);
    // The spider types on his laptop on Week while it fills.
    go("home");
  });
  document.getElementById("stop")?.addEventListener("click", () => {
    fillPending = null;
    void ask({ type: "stop", tabId: state.tab!.id });
  });
  document.getElementById("skip-job")?.addEventListener("click", () => dismiss(state, "skipped"));
  document.getElementById("not-job")?.addEventListener("click", () => dismiss(state, "not_job"));
  document.getElementById("undo-dismiss")?.addEventListener("click", () => dismiss(state, null));
  document.getElementById("disconnect")?.addEventListener("click", async () => {
    await ask({ type: "disconnect" });
    void render();
  });
  wirePopup();
  wireLetter(state.tab?.id ?? 0, !jobFound(state));
  wireAnswer(state.tab?.id ?? 0);
  wireSetup(state);
  wirePlanSwitch();
  wireOpened(state);
  wireJobBox(state);
  document.getElementById("open-resume")?.addEventListener("click", () => void seeResume());
  document.getElementById("replace-resume")?.addEventListener("click", () => resumeInput.click());
  document.getElementById("attach-resume")?.addEventListener("click", () => void attachResume());
  document.querySelectorAll<HTMLButtonElement>("[data-attach-letter]").forEach((button) => button.addEventListener("click", () => void attachLetter()));
  document.getElementById("start-resume")?.addEventListener("click", () => resumeInput.click());
  wireIssues();
  wireManualJob(state);
  document.getElementById("pause")?.addEventListener("change", (event) => void ask({ type: "set-auto-submit", value: !(event.target as HTMLInputElement).checked }));
  return true;
}

/** Opens a job's own page; no id goes back Home (after deleting one). */
function openJob(id: string, contact = "") {
  if (!id) return go(jobFrom);
  openedJob = { id, contact };
  if (TABS.includes(view)) jobFrom = view;
  go("job");
}

/** "✓ I applied" on a detected job Unnepo couldn't name: the add-a-job form, filled in with what it saw. */
function addDetected(item: Detected) {
  Object.assign(manualJob, { open: true, key: item.url, title: item.title, company: item.company, url: item.url, stage: "applied", note: "Unnepo didn't catch the company. Fill it in, then add it.", saving: false, readFor: "", description: item.description ?? "" });
  go("jobs");
}

setHost({ redraw: () => void render(), openJob, upgradeUrl: () => (lastState ? upgradeUrl(lastState) : ""), addJob: addDetected });

/** Opens a page, from any button that says which. */
function go(next: View) {
  view = next;
  window.scrollTo(0, 0);
  void render();
}
tabBar.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((tab) => tab.addEventListener("click", () => go(tab.dataset.tab as View)));


chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "tracker-changed") return void loadTracker();
  if (message?.type !== "state-changed") return;
  void refreshDetected();
  activityLog = null;
  // New problems may have been added; the open list reads them again.
  if (view === "feedback") void loadIssues();
  else void refresh();
});
chrome.tabs.onUpdated.addListener((id, info) => {
  // Reloading the page after an error is how to try that job again: it comes back with its Autofill button.
  const job = lastState?.job;
  if (info.status === "loading" && id === lastState?.tab?.id && job?.error && !job.running) void ask({ type: "clear-error", tabId: id });
  if (info.status === "complete") void refresh();
  // Job boards open another job without loading a page (LinkedIn's search, Handshake): only the address
  // changes, and the job's details show a moment later. Look now, and again once they have.
  else if (info.url && id === lastState?.tab?.id) {
    void refresh();
    for (const wait of [1200, 3000, 6500]) setTimeout(() => void refresh(), wait);
  }
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
