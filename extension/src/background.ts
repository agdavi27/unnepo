import { stepText, wentBack, type Step } from "./shared/steps";
import { generatePassword, unmetRules } from "./shared/password";
import { AUTOFILL_ENABLED, NEVER_READ, type Answer, type Applying, type BeginResult, type Detected, type JobDetails, type DropdownMethod, type FileData, type FillAttempt, type FillPlan, type FillReport, type Issue, type OpenedEmails, type PanelState, type ReminderMarks, type Scan, type Tracker } from "./shared/types";
import { QUICK_BOARDS } from "./content/quick-apply";
import { dueCount, reminders } from "./shared/reminders";

/**
 * The extension's background worker: keeps the Unnepo token, talks to the Unnepo API, runs a fill on the
 * tab the student is on, and records the submit. "confirmed" means the site's own submit request
 * succeeded right after a Submit click; "likely" means only the page's text says so.
 */

declare const __UNNEPO_API__: string;
const DEFAULT_API = __UNNEPO_API__;
const ALLOWED_API = /^(https:\/\/unneponew\.vercel\.app|http:\/\/localhost(:\d+)?)$/;

type Job = NonNullable<PanelState["job"]> & { url: string; clickedAt: number | null; host: string };

async function settings() {
  const stored = await chrome.storage.local.get(["token", "apiBase", "autoSubmit"]);
  return { token: (stored.token as string | undefined) ?? null, apiBase: (stored.apiBase as string | undefined) ?? DEFAULT_API, autoSubmit: Boolean(stored.autoSubmit) };
}

/** The password typed into job sites' account and sign-in forms. Made on first use; kept only on this computer. */
async function jobSitePassword() {
  const stored = (await chrome.storage.local.get("jobSitePassword")).jobSitePassword as string | undefined;
  if (stored) return stored;
  const password = generatePassword();
  await chrome.storage.local.set({ jobSitePassword: password });
  return password;
}

/** The way of choosing from dropdowns that worked on each site, tried first there next time. */
async function dropdownWay(host: string): Promise<DropdownMethod | undefined> {
  const stored = (await chrome.storage.local.get("dropdownWays")).dropdownWays as Record<string, DropdownMethod> | undefined;
  return stored?.[host];
}

/** Keeps the way that chose the most dropdowns on this page, when one did. */
async function rememberDropdownWay(host: string, attempts: FillAttempt[]) {
  const worked = { click: 0, keyboard: 0 };
  for (const attempt of attempts) if (attempt.ok && attempt.type === "combobox" && (attempt.method === "click" || attempt.method === "keyboard")) worked[attempt.method] += 1;
  if (!worked.click && !worked.keyboard) return;
  const best: DropdownMethod = worked.keyboard > worked.click ? "keyboard" : "click";
  const stored = ((await chrome.storage.local.get("dropdownWays")).dropdownWays as Record<string, DropdownMethod> | undefined) ?? {};
  if (stored[host] === best) return;
  // A few hundred sites at most; the oldest go first.
  const kept = Object.entries({ ...stored, [host]: best }).slice(-300);
  await chrome.storage.local.set({ dropdownWays: Object.fromEntries(kept) });
}

/** The newest entries kept on the issues list. */
const ISSUES_KEPT = 200;
/** The same problem on the same page within this long is one entry, not one per check. */
const SAME_ISSUE_MS = 30 * 60 * 1000;

async function issues(): Promise<Issue[]> {
  return ((await chrome.storage.local.get("issues")).issues as Issue[] | undefined) ?? [];
}

/** The page an issue happened on, without its query string (which can carry tokens). */
function issuePage(url: string) {
  try {
    const parsed = new URL(url);
    return { site: parsed.hostname, page: `${parsed.origin}${parsed.pathname}` };
  } catch {
    return { site: "", page: "" };
  }
}

/** Adds problems to the running issues list in Profile, newest first. */
async function addIssues(url: string, items: Array<Pick<Issue, "kind" | "what" | "question">>) {
  if (!items.length) return;
  const where = issuePage(url);
  const list = await issues();
  const now = Date.now();
  const recent = (item: Pick<Issue, "kind" | "what" | "question">) => list.some((known) => known.kind === item.kind && known.page === where.page && known.question === item.question && known.what === item.what && now - Date.parse(known.at) < SAME_ISSUE_MS);
  const fresh = items.filter((item) => item.kind === "note" || !recent(item)).map((item): Issue => ({
    id: `${now.toString(36)}${Math.random().toString(36).slice(2, 7)}`, at: new Date(now).toISOString(), ...where,
    kind: item.kind, what: item.what.replace(/\s+/g, " ").trim().slice(0, ISSUE_CHARS), ...(item.question ? { question: item.question.slice(0, 200) } : {}),
  }));
  if (!fresh.length) return;
  await chrome.storage.local.set({ issues: [...fresh.reverse(), ...list].slice(0, ISSUES_KEPT) });
  void chrome.runtime.sendMessage({ type: "state-changed" }).catch(() => undefined);
}

// The most an issue says: room for a run's whole trail.
const ISSUE_CHARS = 2500;

async function jobs(): Promise<Record<string, Job>> {
  return ((await chrome.storage.session.get("jobs")).jobs as Record<string, Job> | undefined) ?? {};
}

async function saveJob(tabId: number, patch: Partial<Job> | null) {
  const all = await jobs();
  if (patch === null) delete all[tabId];
  else all[tabId] = { ...(all[tabId] ?? ({} as Job)), ...patch, tabId };
  await chrome.storage.session.set({ jobs: all });
  void chrome.runtime.sendMessage({ type: "state-changed" }).catch(() => undefined);
}

class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code = "") {
    super(message);
  }
}

async function api<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
  const { token, apiBase } = await settings();
  if (!token) throw new ApiError("Connect the extension to Unnepo first.", 401);
  const response = await fetch(`${apiBase}/api/extension/${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) {
    await chrome.storage.local.remove("token");
    void chrome.runtime.sendMessage({ type: "state-changed" }).catch(() => undefined);
  }
  if (!response.ok) throw new ApiError((payload as { error?: string }).error || `Unnepo answered ${response.status}.`, response.status, (payload as { code?: string }).code ?? "");
  // A quiet call that used something up (an autofill's first success) changes the credits left like any other.
  const spent = (payload as { counted?: unknown } | null)?.counted === true;
  if (method !== "GET") await meChanged(path, spent);
  if (spent) void chrome.runtime.sendMessage({ type: "state-changed" }).catch(() => undefined);
  return payload as T;
}

/**
 * The student's account, kept here so the panel never waits on the server to redraw: it gets the copy at once, and
 * a copy older than ME_FRESH_MS is read again behind it. After anything that changes the account the panel waits
 * for the new one, except for the calls in QUIET, which happen many times during a fill and only move a counter.
 */
type Me = NonNullable<PanelState["me"]>;
type MeCopy = { token: string; at: number; waitForNew: boolean; me: Me };
const ME_FRESH_MS = 20_000;
const QUIET = new Set(["activity", "attempts", "map", "answers", "read-link", "job-info"]);
let meCalls = 0;
let reading: { call: number; result: Promise<Me> } | null = null;

const meCopy = async () => ((await chrome.storage.session.get("meCopy")).meCopy as MeCopy | undefined) ?? null;

async function meChanged(path: string, spent = false) {
  meCalls += 1;
  const copy = await meCopy();
  if (copy) await chrome.storage.session.set({ meCopy: { ...copy, at: 0, waitForNew: copy.waitForNew || spent || !QUIET.has(path) } });
}

function readMe(token: string) {
  if (reading?.call === meCalls) return reading.result;
  const call = meCalls;
  const result = api<Me>("GET", "me").then(async (me) => {
    const before = await meCopy();
    // Something changed the account while this was on its way, so it's out of date.
    if (call === meCalls) await chrome.storage.session.set({ meCopy: { token, at: Date.now(), waitForNew: false, me } });
    if (before?.token === token && JSON.stringify(before.me) !== JSON.stringify(me)) void chrome.runtime.sendMessage({ type: "state-changed" }).catch(() => undefined);
    return me;
  }).finally(() => { if (reading?.call === call) reading = null; });
  reading = { call, result };
  return result;
}

async function currentMe(token: string): Promise<Me | null> {
  const copy = await meCopy();
  if (copy?.token !== token) return readMe(token).catch(() => null);
  if (copy.waitForNew) return readMe(token).catch(() => copy.me);
  if (Date.now() - copy.at > ME_FRESH_MS) void readMe(token).catch(() => undefined);
  return copy.me;
}

/** The student's resume file from Unnepo. Says why when it can't (no resume, or the file is gone). */
async function resumeFile(): Promise<{ file: FileData | null; error: string | null }> {
  const { token, apiBase } = await settings();
  const response = await fetch(`${apiBase}/api/extension/resume`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
  if (!response) return { file: null, error: "Couldn't reach Unnepo to get your resume." };
  if (!response.ok) {
    const message = ((await response.json().catch(() => ({}))) as { error?: string }).error;
    return { file: null, error: message || `Unnepo couldn't send your resume (${response.status}).` };
  }
  const name = response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "Resume.pdf";
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return { file: { name, mime: response.headers.get("content-type") ?? "application/pdf", base64: btoa(binary) }, error: null };
}

/**
 * The resume, kept ready for "Begin applying" so it goes into the upload box the moment it's pressed. Fetched
 * as soon as the panel shows a job; kept ten minutes, and dropped when the student changes their resume.
 */
let resumeReady: { at: number; got: Promise<{ file: FileData | null; error: string | null }> } | null = null;
function readyResume() {
  if (!resumeReady || Date.now() - resumeReady.at > 10 * 60_000) {
    const got = resumeFile().then((result) => { if (!result.file) resumeReady = null; return result; });
    resumeReady = { at: Date.now(), got };
  }
  return resumeReady.got;
}

/** "Begin applying" on each tab, kept for the browser session so the panel can show it after a reload. */
async function applyingAll(): Promise<Record<string, Applying>> {
  return ((await chrome.storage.session.get("applying")).applying as Record<string, Applying> | undefined) ?? {};
}
async function saveApplying(tabId: number, value: Applying | null) {
  const all = await applyingAll();
  if (value) all[tabId] = value;
  else delete all[tabId];
  await chrome.storage.session.set({ applying: all });
  void chrome.runtime.sendMessage({ type: "state-changed" }).catch(() => undefined);
}

/** The job on the tab as the page shows it, with the form's own counts when the form is in a frame. */
async function readJobDetails(tabId: number): Promise<JobDetails | null> {
  const scan = await look(tabId);
  if (!scan) return null;
  const top = await send<JobDetails>(tabId, { type: "job-details" }, 0).catch(() => null);
  const frame = formFrame.get(tabId) ?? 0;
  const form = frame ? await send<JobDetails>(tabId, { type: "job-details" }, frame).catch(() => null) : null;
  const details = top ?? form;
  if (!details) return null;
  if (form && top) Object.assign(details, { questions: form.questions, uploads: form.uploads, resumeBox: form.resumeBox });
  if (!details.title) details.title = scan.title;
  if (!details.company) details.company = scan.company;
  return details;
}

/** Puts the resume in the upload boxes and marks the complex questions, in the frame with the form. */
async function beginApplying(tabId: number): Promise<Applying> {
  const resume = await readyResume();
  await look(tabId);
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const result = await send<BeginResult>(tabId, { type: "begin-applying", resume: resume.file });
  const before = (await applyingAll())[tabId];
  // Answers already written on this application stay with it across its steps.
  const applying: Applying = { ...result, uploaded: [...new Set([...(before?.uploaded ?? []), ...result.uploaded])], url: tab?.url ?? "", resumeError: resume.file ? null : resume.error, answers: before?.answers ?? {} };
  await saveApplying(tabId, applying);
  void log(`Began applying${result.uploaded.length ? `: resume uploaded to "${result.uploaded[0].slice(0, 40)}"` : ""}. ${result.questions.length} complex ${result.questions.length === 1 ? "question" : "questions"} found.`);
  return applying;
}

/** Uploads a new resume to Unnepo from the panel. Unnepo reads it into the profile, like the website does. */
async function uploadResume(name: string, mime: string, base64: string) {
  const { token, apiBase } = await settings();
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  const form = new FormData();
  form.append("file", new File([bytes], name, { type: mime }));
  const response = await fetch(`${apiBase}/api/extension/resume`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(payload.error || `Upload failed (${response.status}).`);
}

const SITE_NAMES: Record<Scan["ats"], string> = { greenhouse: "Greenhouse", lever: "Lever", ashby: "Ashby", workday: "Workday", other: "" };
const peeks = new Map<number, { url: string; at: number; page: PanelState["page"] }>();

/** A quick look at the tab for the panel: the job, its fields, and any account to make. Kept for a few seconds. */
async function peek(tabId: number, url: string): Promise<PanelState["page"]> {
  if (!/^https:\/\//.test(url)) return null;
  // Unnepo's own pages list jobs, but none of them is one to apply to.
  try { if (new URL(url).origin === new URL((await settings()).apiBase).origin) return null; } catch { return null; }
  const cached = peeks.get(tabId);
  if (cached && cached.url === url && Date.now() - cached.at < 4000) return cached.page;
  const scan = await look(tabId);
  if (!scan) return null;
  const host = new URL(scan.url).hostname;
  const known = Boolean((await knownAccounts())[accountKey(scan.url)]);
  const status = await send<Status>(tabId, { type: "status", knownAccount: known }).catch(() => null);
  const accountPage = scan.passwordBoxes > 0 || scan.ats === "workday";
  const page: PanelState["page"] = {
    // "jobs.jobylon.com" reads as "Jobylon".
    site: SITE_NAMES[scan.ats] || ((name) => name.charAt(0).toUpperCase() + name.slice(1))(host.replace(/^(www|jobs|careers|boards|apply|job-boards|hire|recruiting)\./, "").split(".")[0]),
    title: scan.title,
    company: scan.company,
    fields: scan.fields.length + scan.passwordBoxes,
    posting: Boolean(status?.apply) && scan.fields.length < 3,
    account: accountPage ? (known ? "sign_in" : "new") : null,
    mentionsCv: scan.mentionsCv,
  };
  peeks.set(tabId, { url, at: Date.now(), page });
  void rememberSeen(tabId, scan);
  return page;
}

/**
 * The job last seen in each tab (Handshake's details pane, a ZipRecruiter posting, any page with a title and
 * company), so applying there without pressing Fill still saves it, with its description. A tab opened from
 * that page (Apply sends you to the company's site) starts with it.
 */
type Seen = { url: string; title: string; company: string; description?: string; poster?: Scan["poster"]; at: number; pressed?: boolean };
async function seenJobs(): Promise<Record<string, Seen>> {
  return ((await chrome.storage.session.get("seen")).seen as Record<string, Seen> | undefined) ?? {};
}
/** "MealPal" and "mealpal" (Lever's name for it) are the same company. */
const sameCompany = (a: string, b: string) => {
  const word = (name: string) => name.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(" ").find((part) => part.length >= 3) ?? "";
  const [x, y] = [word(a), word(b)];
  return Boolean(x && y) && (x.startsWith(y) || y.startsWith(x));
};
async function rememberSeen(tabId: number, scan: Scan) {
  if (!scan.title.trim() || !scan.company.trim()) return;
  const all = await seenJobs();
  const before = all[tabId];
  // The company's application form knows less than the posting it came from: keep the posting's details.
  if (before?.description && !scan.description && sameCompany(before.company, scan.company)) return;
  all[tabId] = { url: scan.jobUrl || scan.url, title: scan.title, company: scan.company, description: scan.description, poster: scan.poster, at: Date.now(), pressed: before?.pressed && sameCompany(before.company, scan.company) };
  await chrome.storage.session.set({ seen: all });
}
chrome.tabs.onCreated.addListener((tab) => {
  if (tab.id === undefined || tab.openerTabId === undefined) return;
  void seenJobs().then(async (all) => {
    const from = all[tab.openerTabId!];
    if (from && Date.now() - from.at < 60 * 60 * 1000) {
      // Opened from a job page (its Apply went to the company's site): applying here is likely.
      all[tab.id!] = { ...from, at: Date.now(), pressed: true };
      await chrome.storage.session.set({ seen: all });
    }
  });
});
/**
 * "Did you apply to these?": jobs where the student pressed Apply or Unnepo filled the form, but nothing
 * confirmed it went through. The panel lists them with ✓ and ✕, so a missed one takes a tap to save.
 * Kept on this computer for a week.
 */
const HOW_SAID: Record<AppliedHow, string> = {
  site_confirmed: "the site confirmed it", page_said: "the page said so", button_changed: "the Apply button changed", board_saved: "the job board saved it",
  linkedin_easy_apply: "LinkedIn Easy Apply", you_marked: "you marked it", added_by_hand: "added by you",
};

/** How Unnepo knew an application went through, as the tracker records it. */
type AppliedHow = "site_confirmed" | "page_said" | "button_changed" | "board_saved" | "linkedin_easy_apply" | "you_marked" | "added_by_hand";

// Apply was pressed, or a tab with a job closed, and nothing confirmed it: on the Detected jobs menu, to ask.
async function addMaybe(item: { url: string; title: string; company: string; description?: string; applicationId?: string }) {
  if (!item.title.trim()) return;
  await noteDetected({ ...item, sure: "pressed", state: "ask" });
  void log(`Not confirmed: ${item.title}${item.company ? ` at ${item.company}` : ""}. It's under Detected jobs on Home.`);
}

/**
 * Home's "Detected jobs": the last 5 jobs the extension caught being applied to, newest first, kept on this
 * computer. One the site confirmed is saved by itself (unless the student chose Ask me), with Undo. The rest
 * wait for ✓ or ✗. Answered ones stay, greyed, until newer ones push them out.
 */
const DETECTED_KEPT = 5;
/** How Unnepo knew, when that's strong enough to save without asking. */
const SURE_HOWS = new Set<AppliedHow>(["site_confirmed", "board_saved"]);
async function detectedList(): Promise<Detected[]> {
  return ((await chrome.storage.local.get("detected")).detected as Detected[] | undefined) ?? [];
}
async function saveDetectedList(list: Detected[]) {
  await chrome.storage.local.set({ detected: list.slice(0, DETECTED_KEPT) });
  void updateBadge();
  void chrome.runtime.sendMessage({ type: "state-changed" }).catch(() => undefined);
}
/** Saved by itself when the site confirmed it, unless the student chose to be asked every time. */
async function savesByItself() {
  return ((await chrome.storage.local.get("autoDetect")).autoDetect as string | undefined) !== "ask";
}
const siteName = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };
/** Adds a job to the menu, or updates it when it's already there (the same application, page, or job name). */
async function noteDetected(item: Omit<Detected, "id" | "at" | "site">) {
  const list = await detectedList();
  const index = list.findIndex((other) => (item.applicationId && other.applicationId === item.applicationId) || (other.url && item.url && sameJobPage(other.url, item.url) && sameJobTitle(other, item)) || (item.company && sameJobTitle(other, item)));
  const before = index >= 0 ? list[index] : null;
  // An answer the student already gave, or a save, isn't undone by a weaker sighting of the same job.
  const keep = before && (before.state === "saved" || before.state === "yes" || before.state === "no") && item.state === "ask";
  const next: Detected = keep ? { ...before!, at: Date.now() } : { ...before, ...item, id: before?.id ?? crypto.randomUUID(), at: Date.now(), site: siteName(item.url) || before?.site || "" };
  if (index >= 0) list.splice(index, 1);
  await saveDetectedList([next, ...list]);
  return next;
}

// What a job board or a page calls itself, which isn't the employer.
const BOARD_WORD = /^(app|www|handshake|joinhandshake|ziprecruiter|indeed|glassdoor|linkedin|wellfound|dice|simplify|built ?in|monster|simplyhired|careerbuilder|wayup|idealist|usajobs|jobs?|careers?)$/i;

/**
 * The panel's Activity list: what the extension noticed on job pages, newest first, so a missed application
 * can be traced to the step that missed it. Kept on this computer only, never with the student's answers.
 */
async function log(text: string) {
  const list = ((await chrome.storage.local.get("activityLog")).activityLog as Array<{ at: number; text: string }> | undefined) ?? [];
  await chrome.storage.local.set({ activityLog: [{ at: Date.now(), text: text.slice(0, 200) }, ...list].slice(0, 30) });
  void chrome.runtime.sendMessage({ type: "state-changed" }).catch(() => undefined);
}

/** A tab closed: a job filled or applied to there that never confirmed goes on the "Did you apply?" list. */
async function tabGone(tabId: number) {
  const [job, seen] = [(await jobs())[tabId], (await seenJobs())[tabId]];
  if (job?.applicationId && !job.submission && (job.report?.filled.length || job.clickedAt)) {
    await addMaybe({ url: job.url, title: job.title, company: job.company, applicationId: job.applicationId });
  } else if (seen?.pressed && !job?.submission) {
    await addMaybe({ url: seen.url, title: seen.title, company: seen.company, description: seen.description });
  }
  const all = await seenJobs();
  if (all[tabId]) {
    delete all[tabId];
    await chrome.storage.session.set({ seen: all });
  }
  await saveJob(tabId, null);
}

/**
 * The page says the student applied, and Unnepo wasn't tracking a job in this tab: save the job it last saw
 * here (reading the page now if it saw none), as applied.
 */
/** The same job page: same address and path, and the same job id in the query (ZipRecruiter's jid, LinkedIn's currentJobId). */
function sameJobPage(a: string, b: string) {
  try {
    const [x, y] = [new URL(a), new URL(b)];
    if (x.hostname !== y.hostname || x.pathname.replace(/\/$/, "") !== y.pathname.replace(/\/$/, "")) return false;
    return ["jid", "currentJobId", "jobId", "job_id", "id", "lvk"].every((key) => x.searchParams.get(key) === y.searchParams.get(key));
  } catch {
    return false;
  }
}

/** The same job by its name: a job board's search page keeps one address for every job it opens. */
const sameJobTitle = (job: { title: string; company: string }, seen: { title: string; company: string }) =>
  job.title.trim().toLowerCase() === seen.title.trim().toLowerCase() && (!job.company || !seen.company || sameCompany(job.company, seen.company));

async function recordSeen(tabId: number, text: string, how: AppliedHow = "page_said") {
  const job = (await jobs())[tabId];
  let seen = (await seenJobs())[tabId];
  // The job this tab is already tracking (Fill was pressed here, or this same job was saved a moment ago).
  // Another job opened on the same search page isn't it.
  if (job?.applicationId && (!seen || ((!job.url || sameJobPage(job.url, seen.url) || (!job.submission && sameApplication(job.url, seen.url))) && (!job.submission || sameJobTitle(job, seen))))) return record(tabId, SURE_HOWS.has(how) ? "confirmed" : "likely", text, how);
  if (!seen) {
    // Only a real posting on the page (Handshake's pane, schema.org data), never a bare "Thank you" page.
    const scan = await look(tabId).catch(() => null);
    if (scan?.description) await rememberSeen(tabId, scan);
    seen = (await seenJobs())[tabId];
  }
  // Nothing says which job it was: on the "Did you apply?" list under the page's name, for the student to name.
  if (!seen) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (tab?.url && /^https:/.test(tab.url)) await addMaybe({ url: tab.url, title: (tab.title || "A job").slice(0, 200), company: "" });
    return;
  }
  // Only a job board saving the application is sure enough to save it without asking.
  const caught = how !== "you_marked";
  if (caught && !(SURE_HOWS.has(how) && (await savesByItself()))) {
    await noteDetected({ url: seen.url, title: seen.title, company: seen.company, description: seen.description, poster: seen.poster, sure: "likely", state: "ask" });
    return void log(`The page looks applied (${HOW_SAID[how]}). It's under Detected jobs on Home.`);
  }
  let screenshot: string | undefined;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.active) screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 60 });
  } catch {
    // A screenshot is a bonus.
  }
  try {
    const saved = await saveSubmission({ url: seen.url, title: seen.title, company: seen.company, description: seen.description, poster: seen.poster, confidence: "likely", text, screenshot, how });
    celebrate(tabId);
    await saveJob(tabId, { applicationId: saved.application.id, title: saved.application.title, company: saved.application.company, url: seen.url, host: new URL(seen.url).hostname, submission: "likely", clickedAt: Date.now(), step: `Saved to your tracker: ${saved.application.title} at ${saved.application.company}.` });
    void log(`Saved: ${saved.application.title} at ${saved.application.company} (${HOW_SAID[how]}).`);
    if (caught) await noteDetected({ url: seen.url, title: saved.application.title, company: saved.application.company, applicationId: saved.application.id, sure: SURE_HOWS.has(how) ? "confirmed" : "likely", state: "saved" });
  } catch (error) {
    await saveJob(tabId, { error: error instanceof Error ? `Couldn't save this application: ${error.message}` : "Couldn't save this application." });
    await addMaybe({ url: seen.url, title: seen.title, company: seen.company, description: seen.description });
  }
}

async function state(): Promise<PanelState> {
  const { token, apiBase, autoSubmit } = await settings();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let me: PanelState["me"] = null;
  if (token) me = await currentMe(token);
  // The page's spiders read the student's spider from here.
  if (me?.spider) void chrome.storage.local.set({ spider: me.spider });
  const saved = tab?.id !== undefined ? (await jobs())[tab.id] ?? null : null;
  // A job from earlier on this tab stops showing once the student opens a different job on the same site.
  let job = saved && !saved.running && !saved.submission && saved.url && tab?.url && sameHost(saved.url, tab.url) && !sameApplication(saved.url, tab.url) ? null : saved;
  // While Unnepo is working on the tab, the job itself says what's there.
  const page = me && tab?.id !== undefined && !job?.running ? await peek(tab.id, tab.url ?? "").catch(() => null) : null;
  // On a job board's search page, a job applied to earlier stops showing once another one is open there.
  if (job?.submission && job.url && tab?.url && sameHost(job.url, tab.url) && QUICK_BOARDS.test(new URL(tab.url).hostname) && page?.title && page.company && !sameJobTitle(job, page)) job = null;
  // Asked about two minutes after Apply was pressed, when a confirmation would have shown by then.
  const maybe = (me?.maybe ?? []).filter((item) => Date.now() - Date.parse(item.at) > 120_000);
  const applying = tab?.id !== undefined ? (await applyingAll())[tab.id] ?? null : null;
  return { connected: Boolean(token && me), me, page, tab: tab?.id !== undefined ? { id: tab.id, url: tab.url ?? "", title: tab.title ?? "" } : null, job, autoSubmit, apiBase, maybe, applying };
}

/** The frame the application form is in, per tab: 0 for the page itself, or an embedded form's frame. */
const formFrame = new Map<number, number>();
const send = <T>(tabId: number, message: unknown, frameId = formFrame.get(tabId) ?? 0) => chrome.tabs.sendMessage(tabId, message, { frameId }) as Promise<T>;

// Frames Unnepo never reads or touches: CAPTCHAs (never solved, never poked), ads, video, and payments.
const SKIP_FRAME = /recaptcha|hcaptcha|captcha|turnstile|challenges\.cloudflare|arkoselabs|funcaptcha|doubleclick|googlesyndication|googletagmanager|youtube\.com|vimeo\.com|js\.stripe\.com|facebook\.com|linkedin\.com\/(embed|px)/i;

/**
 * Two pages of the same application: same site, and the same job in the path (Workday keeps it in every
 * step; Lever and Ashby add /apply or /application). /job-search/111 and /job-search/222 are two jobs.
 */
function sameApplication(before: string | undefined, after: string) {
  if (!before) return false;
  try {
    const [a, b] = [new URL(before), new URL(after)];
    if (a.hostname !== b.hostname) return false;
    const [x, y] = [a.pathname.split("/").filter(Boolean), b.pathname.split("/").filter(Boolean)];
    let shared = 0;
    while (shared < x.length && x[shared] === y[shared]) shared += 1;
    return a.pathname === b.pathname || shared >= 3 || (shared >= 2 && shared === Math.min(x.length, y.length));
  } catch {
    return false;
  }
}

function sameHost(a: string, b: string) {
  try { return new URL(a).hostname === new URL(b).hostname; } catch { return false; }
}

const signature = (scan: Scan) => `${scan.url}|${scan.passwordBoxes}|${scan.fields.map((field) => field.label).join("|")}`;
const hasForm = (scan: Scan) => scan.useServerSchema || scan.fields.length > 0 || scan.passwordBoxes > 0;
/**
 * Where an answer came from, for the ones worth checking, and how the checklist says it. Answers from the
 * student's own details and Unnepo's standard answers ("Company website") are left off, so the list stays short.
 */
const REVIEW_SOURCES: Record<string, string> = {
  ai: "Written by AI.",
  cache: "Written by AI for a question like this before.",
};

type Status = { step: Step | null; apply: string | null; needsYou: string[]; action: { kind: "apply" | "create_account" | "sign_in" | "next" | "submit"; label: string } | null; captcha: boolean; reviewLeft?: number; accountExists: boolean; signInFailed: boolean; verifyEmail: boolean; confirmed: boolean; formErrors: string[]; flagged: string[]; valuesKey: string };

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Tabs Unnepo is working in. Each run has its own number, so pressing Stop then Fill never leaves two going. */
const runs = new Map<number, number>();
let runCounter = 0;
const stillRunning = (tabId: number, run: number) => runs.get(tabId) === run;

/** Job sites where the student already has an account Unnepo made or used, so it signs in instead. */
/**
 * Job-site accounts, by site. Accounts Unnepo made keep the password they were made with, so making a new
 * job-site password later doesn't lock the student out of them. `true` is an account that already
 * existed (the student made it, password unknown).
 */
type Account = true | { password: string; at: number };
async function knownAccounts(): Promise<Record<string, Account>> {
  return ((await chrome.storage.local.get("accounts")).accounts as Record<string, Account> | undefined) ?? {};
}
async function rememberAccount(key: string, password?: string) {
  const all = await knownAccounts();
  // Never replace a known password with "unknown".
  if (!password && typeof all[key] === "object") return;
  await chrome.storage.local.set({ accounts: { ...all, [key]: password ? { password, at: Date.now() } : true } });
}
/** The password for this site: the one its account was made with, else the current job-site password. */
async function passwordFor(key: string) {
  const account = (await knownAccounts())[key];
  return typeof account === "object" ? account.password : jobSitePassword();
}

/**
 * Which account a page belongs to. Workday accounts belong to the company, and some Workday addresses
 * are shared by many companies (wd1.myworkdaysite.com/recruiting/<company>), so the company's part of
 * the path counts too; any other site is its host.
 */
function accountKey(url: string) {
  const parsed = new URL(url);
  if (!/myworkday(jobs|site)\.com$/.test(parsed.hostname)) return parsed.hostname;
  const parts = parsed.pathname.split("/").filter((part) => part && !/^[a-z]{2}-[A-Z]{2}$/.test(part) && part !== "recruiting");
  return `${parsed.hostname}/${parts[0] ?? ""}`;
}

/** Puts the page script on the page (again, after a page load) and reads it; null while the page is loading. */
/**
 * Puts the page script in the page and in its embedded frames (company sites that show the Greenhouse
 * or iCIMS form in a frame), reads each, and works in the one with the form. Null while the page loads.
 */
async function look(tabId: number): Promise<Scan | null> {
  try {
    // LinkedIn is never read, not even to preview it in the panel.
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url || NEVER_READ.test(new URL(tab.url).hostname)) return null;
    const frames = (await chrome.webNavigation.getAllFrames({ tabId }).catch(() => null)) ?? [{ frameId: 0, url: "" }];
    const frameIds = frames.filter((frame) => frame.frameId === 0 || (/^https:\/\//.test(frame.url) && !SKIP_FRAME.test(frame.url) && !NEVER_READ.test(new URL(frame.url).hostname))).map((frame) => frame.frameId);
    await chrome.scripting.executeScript({ target: { tabId, frameIds }, files: ["content/fill.js"] }).catch(() => undefined);
    const scans = await chrome.scripting.executeScript({
      target: { tabId, frameIds },
      func: () => (window as unknown as { __unnepo?: { scan: () => unknown } }).__unnepo?.scan() ?? null,
    });
    const found = scans.filter((result) => result.result).map((result) => ({ frameId: result.frameId, scan: result.result as Scan }));
    const weight = (scan: Scan) => (scan.useServerSchema ? 1000 : 0) + scan.fields.length + scan.passwordBoxes;
    // The page itself, unless a frame plainly holds more of the form.
    const top = found.find((item) => item.frameId === 0);
    const best = found.reduce<(typeof found)[number] | undefined>((pick, item) => (!pick || weight(item.scan) > weight(pick.scan) ? item : pick), top);
    if (!best) return null;
    formFrame.set(tabId, best.frameId);
    return best.scan;
  } catch {
    return null;
  }
}

const ACTION_STEP: Record<NonNullable<Status["action"]>["kind"], string> = {
  apply: "Opening the application…",
  create_account: "Creating your account…",
  sign_in: "Signing in…",
  next: "Going to the next page…",
  submit: "Submitting…",
};

/**
 * Works through the whole application until the student presses Stop: presses Apply on the posting,
 * creates the account or signs in, fills every page, presses Next, and presses Submit (unless the student
 * wants to press it). When a page needs the student or a CAPTCHA is up, it waits and carries on once
 * that's done. It ends on its own only when the application is submitted or the tab closes.
 */
async function run(tabId: number) {
  const runId = ++runCounter;
  runs.set(tabId, runId);
  const earlier = (await jobs())[tabId];
  await saveJob(tabId, { running: true, step: "Reading the page…", report: null, submission: null, error: null, clickedAt: null, llmCalls: 0, cv: false });
  const filledAll: string[] = [];
  // Answers to look over before moving on: the ones AI wrote. Label to why.
  const toCheck = new Map<string, string>();
  const noteCheck = (answers: Answer[]) => {
    for (const answer of answers) {
      if (!answer.values.length || answer.type === "file" || !REVIEW_SOURCES[answer.source ?? ""]) continue;
      toCheck.set(answer.label, answer.why?.trim() ? `${REVIEW_SOURCES[answer.source!]} ${answer.why.trim()}`.slice(0, 220) : REVIEW_SOURCES[answer.source!]);
    }
  };
  let applicationId = "";
  let posting: { url: string; title: string; company: string; description?: string; poster?: Scan["poster"] } | null = null;
  let filledKey = "";
  let pressedKey = "";
  let presses = 0;
  // What the page's answers were when the site showed an error; Unnepo waits until they change.
  let errorValues: string | null = null;
  // Sites where signing in failed on this run: never pressed again.
  const signInFailedAt = new Set<string>();
  let triedApply = false;
  // What Unnepo did on this run, in order (filled a step, pressed a button, the page moved), for the issues
  // list whenever a run ends, so a loop or a jump backward can be traced to what came right before it.
  const started = Date.now();
  const trail: string[] = [];
  const note = (line: string) => {
    const at = Math.round((Date.now() - started) / 1000);
    trail.push(`${at}s ${line}`);
    if (trail.length > 25) trail.shift();
  };
  // An issue with the trail after it, dropping its oldest lines to fit: the last ones say what went wrong.
  const story = (lead: string) => {
    const lines = [...trail];
    while (lines.length && `${lead} What happened: ${lines.join("; ")}`.length > ISSUE_CHARS) lines.shift();
    return lines.length ? `${lead} What happened: ${lines.join("; ")}` : lead;
  };
  // The questions on a page, briefly, so the trail shows what each fill touched.
  const questions = (fields: Scan["fields"]) => {
    const shown = fields.slice(0, 6).map((field) => `${field.type} "${field.label.replace(/\s+/g, " ").slice(0, 30)}"`).join(", ");
    return fields.length > 6 ? `${shown} and ${fields.length - 6} more` : shown;
  };
  const pressed = (what: { label?: string; id?: string; overlay?: boolean } | null | undefined, label: string) => {
    note(`pressed "${(what?.label || label).slice(0, 60)}"${what?.id ? ` [${what.id}]` : ""}${what?.overlay ? " via overlay" : ""}`);
  };
  // The furthest Workday step reached, and the step last seen. Landing on an earlier step, for any reason,
  // stops the run: filling the start again is what made it go round in circles.
  let furthest: Step | null = null;
  let seenStep: Step | null = null;
  let lastPath = "";
  // How many times each step, and each page, was filled on this run.
  const stepFills = new Map<string, number>();
  const filledKeys = new Set<string>();
  /** After a press: waits for a new page, new fields, or new buttons (Workday's "how to apply" choice). */
  const waitForChange = async (key: string, buttonsBefore: string, known: boolean, timeout = 12_000) => {
    const until = Date.now() + timeout;
    while (Date.now() < until && stillRunning(tabId, runId)) {
      await wait(300);
      const after = await look(tabId);
      if (!after) continue;
      const now = await send<Status>(tabId, { type: "status", knownAccount: known }).catch(() => null);
      if (signature(after) !== key || (now && `${now.action?.kind}|${now.action?.label}|${now.apply}` !== buttonsBefore)) return;
    }
  };
  let pressedAt = 0;
  let resume: FileData | null | undefined;
  let resumeError: string | null = null;
  // Fetched at the start, alongside everything else, so the upload box never waits for it.
  const resumePromise = resumeFile();
  let llmCalls = 0;
  let lastStep = "";
  // Workday reads every resume uploaded to it and redoes the application from its first step, so on Workday
  // the resume goes in once per run. Sending it again was what took the run back to "Autofill with Resume".
  let resumeUploaded = false;
  // A new Workday step is filled only once its questions stop changing: filling it while it was still
  // loading filled the last step's leftover upload box instead.
  let settling = "";
  let settleTries = 0;
  // Spiders crawl the whole time Unnepo is running, until it's submitted, something goes wrong, or Stop.
  let spidersOut = false;
  let spidersDropped = false;
  let lastUrl = "";
  const spiders = (on: boolean) => {
    if (on === spidersOut) return;
    spidersOut = on;
    // Only the first time drops them in; after that the same batch just keeps crawling.
    void send(tabId, { type: "spiders", on, drop: on && !spidersDropped }, 0).catch(() => undefined);
    if (on) spidersDropped = true;
  };
  const step = async (text: string, extra: Partial<Job> = {}) => {
    if (text === lastStep && !Object.keys(extra).length) return;
    lastStep = text;
    await saveJob(tabId, { step: text, ...extra });
  };
  try {
    const first = await look(tabId);
    if (!first) throw new Error("Couldn't read this page. Reload it, then press Fill.");
    // A frame the extension can't read (rare now that frames are read too): send the student to the form itself.
    if (first.embeddedForm && !first.fields.length && !first.passwordBoxes) throw new Error(`This page shows the form inside another site. Open the form directly, then press Fill: ${first.embeddedForm}`);
    spiders(true);
    const firstHost = new URL(first.url).hostname;
    // Pressing Fill again partway through keeps the same job instead of opening a new one per page.
    if (earlier?.applicationId && !earlier.submission && sameApplication(earlier.url, first.url)) applicationId = earlier.applicationId;
    // The posting itself (title, company, its link) is what the tracker shows, not the form's later steps.
    if (!hasForm(first) || first.fields.length < 3) posting = { url: first.url, title: first.title, company: first.company, description: first.description, poster: first.poster };

    while (stillRunning(tabId, runId)) {
      if ((await jobs())[tabId]?.submission) break;
      const scan = await look(tabId);
      if (!scan) { await wait(400); continue; }
      // A new page load starts without spiders; send them back out if they were out.
      if (scan.url !== lastUrl && spidersOut) void send(tabId, { type: "spiders", on: true, drop: false }, 0).catch(() => undefined);
      lastUrl = scan.url;
      const site = accountKey(scan.url);
      const known = Boolean((await knownAccounts())[site]);
      const status = await send<Status>(tabId, { type: "status", knownAccount: known }).catch(() => null);
      if (!status) { await wait(400); continue; }
      if (!stillRunning(tabId, runId)) break;
      // Where the application is now. Any step backward, whatever caused it, stops the run.
      const path = (() => { try { return new URL(scan.url).pathname; } catch { return scan.url; } })();
      if (path !== lastPath) { note(`page ${path.slice(-80)}`); lastPath = path; }
      const now = status.step ?? null;
      if (stepText(now) !== stepText(seenStep)) { note(`now on ${stepText(now)}`); seenStep = now; }
      // After Submit the steps end and the posting shows again: that's done, not backward.
      const submitted = status.confirmed || trail.some((line) => /pressed "[^"]*submit/i.test(line));
      if (!submitted && wentBack(furthest, now, Boolean(status.apply || status.action?.kind === "apply"))) {
        throw new Error(`Workday went back from ${stepText(furthest)} to ${stepText(now)}, so Unnepo stopped instead of filling it all again. Go back to ${stepText(furthest)} and press Fill. What happened is under Feedback.`);
      }
      if (now && (!furthest || now.total !== furthest.total || now.index > furthest.index)) furthest = now;
      // First thing on every run: if there's an Apply button, press it.
      if (!triedApply) {
        triedApply = true;
        if (status.apply) {
          await step("Opening the application…");
          const reply = await send<{ pressed: boolean; what?: { label?: string; id?: string; overlay?: boolean } }>(tabId, { type: "press", first: true }).catch(() => ({ pressed: false, what: undefined }));
          if (reply.pressed) pressed(reply.what, status.apply);
          // Some Apply buttons only scroll to the form below, so this doesn't wait long.
          if (reply.pressed) await waitForChange(signature(scan), `${status.action?.kind}|${status.action?.label}|${status.apply}`, known, 4000);
          continue;
        }
      }
      if (status.accountExists && !known) { await rememberAccount(site); continue; }
      // A failed sign-in is never retried: a few wrong passwords in a row is how job sites lock accounts.
      if (status.signInFailed) {
        if (!signInFailedAt.has(site)) void addIssues(scan.url, [{ kind: "stopped", what: "The site didn't accept the sign-in." }]).catch(() => undefined);
        signInFailedAt.add(site);
        const account = (await knownAccounts())[site];
        await step(typeof account === "object"
          ? `The site didn't accept the password Unnepo made this account with. Use "Forgot your password?" on the site, set it to your Unnepo job-site password (Show, then Copy, below), and press Fill again.`
          : `This site already has an account for your email, with a password Unnepo doesn't know. Use "Forgot your password?" on the site, set it to your Unnepo job-site password (Show, then Copy, below), and press Fill again.`);
        await wait(1500);
        continue;
      }
      if (status.captcha) { await step("A CAPTCHA is on the page. Solve it and Unnepo carries on. Unnepo never solves CAPTCHAs."); await wait(1200); continue; }
      if (status.verifyEmail) { await step("The site sent you an email to verify your account. Open the link, come back to this tab, and Unnepo carries on."); await wait(1500); continue; }

      // A new form (page or step): fill it once. A Workday step that changes as it's filled (a State box
      // appears after Country) gets one more go for its new questions, never a third: refilling a step
      // over and over was how a run went round in circles.
      const key = signature(scan);
      const stepKey = status.step ? `${status.step.index}/${status.step.total}` : "";
      if (hasForm(scan) && key !== filledKey && !stepKey && filledKeys.has(key)) {
        throw new Error("Unnepo is back on a page it already filled, so it stopped instead of filling it again. Go to where you were and press Fill. What happened is on your issues list (Profile).");
      }
      if (hasForm(scan) && key !== filledKey && stepKey && (stepFills.get(stepKey) ?? 0) >= 2) {
        note(`didn't fill ${stepText(status.step)} a third time`);
        filledKey = key;
      }
      if (hasForm(scan) && key !== filledKey && stepKey && !stepFills.has(stepKey) && settleTries < 8 && settling !== `${stepKey}|${key}`) {
        if (!settling.startsWith(`${stepKey}|`)) settleTries = 0;
        settling = `${stepKey}|${key}`;
        settleTries += 1;
        await wait(900);
        continue;
      }
      if (hasForm(scan) && key !== filledKey) {
        if (stepKey) stepFills.set(stepKey, (stepFills.get(stepKey) ?? 0) + 1);
        filledKeys.add(key);
        note(`filling ${status.step ? stepText(status.step) : "the page"}: ${scan.fields.length} questions${scan.fields.length ? ` (${questions(scan.fields)})` : ""}`);
        if (!applicationId && (scan.fields.length || scan.useServerSchema)) {
          await step("Opening the job in Unnepo…");
          const where = posting ?? { url: scan.url, title: scan.title, company: scan.company, description: scan.description, poster: scan.poster };
          const job = await api<{ application: { id: string; title: string; company: string } }>("POST", "jobs", where);
          applicationId = job.application.id;
          await saveJob(tabId, { applicationId, title: job.application.title, company: job.application.company, url: where.url, host: firstHost });
        }
        const formFields = !scan.useServerSchema && !scan.fields.length ? null : (scan.useServerSchema ? [] : scan.fields);
        let wantsCoverLetter = scan.fields.some((field) => field.type === "file" && /cover ?letter/i.test(`${field.label} ${field.section}`));
        // Any upload box that isn't for a cover letter gets the resume, whatever the server's answers say.
        const resumeBox = scan.useServerSchema || scan.fields.some((field) => field.type === "file" && !/cover ?letter/i.test(field.label));
        const workday = scan.ats === "workday";
        if (resumeBox && workday && resumeUploaded) note("didn't upload the resume again");
        const wantsResume = resumeBox && !(workday && resumeUploaded);
        if (scan.mentionsCv) await saveJob(tabId, { cv: true });
        const password = await passwordFor(accountKey(scan.url));
        const pageHost = new URL(scan.url).hostname;
        const dropdownFirst = await dropdownWay(pageHost);
        const fillWith = (answers: Answer[], files: { resume?: FileData | null; coverLetter?: FileData | null } = {}, schema = scan.useServerSchema) =>
          send<FillReport>(tabId, { type: "fill", plan: { ats: scan.ats, useServerSchema: schema, answers, resume: files.resume ?? null, coverLetter: files.coverLetter ?? null, autoSubmit: false, password, dropdownFirst } satisfies FillPlan }).catch(() => null);
        // A question filled on a later go is no longer a failure.
        const merge = (into: FillReport | null, next: FillReport | null) => (!into ? next : !next ? into : {
          ...next,
          filled: [...into.filled, ...next.filled],
          failed: [...into.failed.filter((item) => !next.filled.includes(item.label)), ...next.failed],
          attempts: [...(into.attempts ?? []), ...(next.attempts ?? [])],
        });

        // 1. Everything Unnepo already knows, with no AI call, so typing starts right away.
        await step("Filling the form…");
        const known = applicationId && formFields ? await api<{ answers: Answer[]; llmCalls: number }>("POST", "map", { applicationId, fields: formFields, ai: false }).catch(() => ({ answers: [] as Answer[], llmCalls: 0 })) : { answers: [] as Answer[], llmCalls: 0 };
        // Greenhouse's own list of fields names the cover letter box ("cover_letter"); its label just says "Attach".
        if (scan.useServerSchema && known.answers.some((answer) => answer.id === "cover_letter")) wantsCoverLetter = true;
        if (wantsResume && resume === undefined) {
          const got = await resumePromise;
          resume = got.file;
          resumeError = got.error;
        }
        if (!stillRunning(tabId, runId)) break;
        // The cover letter is the slowest part: it's started now too, and attached at the end.
        const letterSoon = wantsCoverLetter && applicationId ? api<{ fileName: string; pdfBase64: string }>("POST", "cover-letter", { applicationId }).catch(() => null) : null;
        // The AI's answers for the rest are asked for now, so they're worked out while the known ones are typed.
        const answered = new Set(known.answers.filter((answer) => answer.values.length).map((answer) => answer.id));
        const left = scan.useServerSchema ? null : scan.fields.filter((field) => field.type !== "file" && !answered.has(field.id));
        const askRest = applicationId && formFields && (scan.useServerSchema || left!.length)
          ? api<{ answers: Answer[]; llmCalls: number; locked?: Array<{ id: string; label: string }> }>("POST", "map", { applicationId, fields: scan.useServerSchema ? [] : left }).catch(() => null)
          : Promise.resolve(null);
        noteCheck(known.answers);
        let report = await fillWith(known.answers, { resume: wantsResume ? resume ?? null : null });
        for (const attempt of report?.attempts ?? []) {
          if (attempt.type !== "file" || !attempt.ok) continue;
          note(`uploaded a file into "${attempt.label.slice(0, 30)}"`);
          if (workday) resumeUploaded = true;
        }

        // 2. The AI's answers for the questions that are left (asked for above), filled as soon as they're in.
        if (applicationId && formFields && (scan.useServerSchema || left!.length) && stillRunning(tabId, runId)) {
          await step("Answering the rest…");
          const more = await askRest;
          llmCalls += more?.llmCalls ?? 0;
          // Free: the questions Pro would have answered, for the panel to say so.
          await saveJob(tabId, { locked: more?.locked?.length ?? 0 });
          const fresh = (more?.answers ?? []).filter((answer) => answer.values.length && !answered.has(answer.id) && answer.type !== "file");
          noteCheck(fresh);
          if (fresh.length) report = merge(report, await fillWith(fresh));
        }

        // 2b. Dropdowns whose answer fit none of the choices: the AI picks from the choices the page showed.
        const unmatched = (report?.failed ?? []).filter((item) => item.id && item.options?.length);
        if (applicationId && !scan.useServerSchema && unmatched.length && stillRunning(tabId, runId)) {
          const fields = unmatched.flatMap((item) => {
            const field = scan.fields.find((candidate) => candidate.id === item.id);
            return field ? [{ ...field, options: item.options! }] : [];
          });
          const tried = new Map(unmatched.map((item) => [item.id, item.reason]));
          const picked = fields.length ? await api<{ answers: Answer[]; llmCalls: number }>("POST", "map", { applicationId, fields }).catch(() => null) : null;
          llmCalls += picked?.llmCalls ?? 0;
          // Only a different answer is worth another go.
          const again = (picked?.answers ?? []).filter((answer) => answer.values.length && !tried.get(answer.id)?.includes(`"${answer.values[0]}"`));
          noteCheck(again);
          if (again.length) report = merge(report, await fillWith(again));
        }

        // Greenhouse's API leaves some questions out (the U.S. demographic questions): fill those from the page.
        if (report && scan.useServerSchema && applicationId) {
          const extra = await send<{ fields: Scan["fields"] }>(tabId, { type: "leftovers", ids: known.answers.map((answer) => answer.id) }).catch(() => ({ fields: [] }));
          if (extra.fields.length) {
            const leftovers = await api<{ answers: Answer[]; llmCalls: number }>("POST", "map", { applicationId, fields: extra.fields }).catch(() => null);
            if (leftovers?.answers.length) {
              llmCalls += leftovers.llmCalls;
              noteCheck(leftovers.answers);
              report = merge(report, await fillWith(leftovers.answers, {}, false));
            }
          }
        }

        // 3. The cover letter last (started above, so it's usually written by now).
        if (wantsCoverLetter && applicationId && stillRunning(tabId, runId)) {
          await step("Attaching your cover letter…");
          const letter = await (letterSoon ?? api<{ fileName: string; pdfBase64: string }>("POST", "cover-letter", { applicationId }).catch(() => null));
          if (letter) {
            const file = { name: letter.fileName, mime: "application/pdf", base64: letter.pdfBase64 };
            const letterAnswer: Answer[] = scan.useServerSchema ? [{ id: "cover_letter", label: "Cover letter", type: "file", required: false, values: [file.name], source: "ai", why: null }] : [];
            report = merge(report, await fillWith(letterAnswer, { coverLetter: file }));
          }
        }
        await saveJob(tabId, { llmCalls });
        // Say why the resume box is empty instead of leaving it a mystery.
        if (report && wantsResume && !resume && resumeError) report = { ...report, failed: [...report.failed, { label: "Resume", reason: resumeError }] };
        if (report) {
          filledAll.push(...report.filled);
          const filledSet = new Set(filledAll);
          const check = [...toCheck].filter(([label]) => filledSet.has(label)).map(([label, why]) => ({ label, why }));
          await saveJob(tabId, { report: { ...report, filled: [...filledAll], check }, llmCalls });
          if (applicationId) void api("POST", "activity", { applicationId, kind: "filled", fields: report.filled.length, needs: report.needsYou.length, ms: report.ms }).catch(() => undefined);
          void log(`Filled ${report.filled.length} fields on ${new URL(scan.url).hostname.replace(/^www\./, "")}${report.needsYou.length ? `, ${report.needsYou.length} left for you` : ""}.`);
          void addIssues(scan.url, report.failed.map((item) => ({ kind: "fill" as const, question: item.label, what: `Couldn't fill: ${item.reason}` }))).catch(() => undefined);
          // The record of every question tried, for fixing what fails; the page's fill never waits on it.
          if (report.attempts?.length) {
            void rememberDropdownWay(pageHost, report.attempts).catch(() => undefined);
            if (applicationId) void api("POST", "attempts", { applicationId, attempts: report.attempts }).catch(() => undefined);
          }
        }
        filledKey = key;
        continue;
      }

      // Every question still unanswered on this page (required, flagged by the site, or one Unnepo couldn't
      // fill) gets marked on the page, with a button that jumps to each. Answered ones drop off by themselves.
      const unanswered = [...status.flagged, ...status.needsYou, ...((await jobs())[tabId]?.report?.failed ?? []).map((item) => item.label)];
      void send(tabId, { type: "mark-needs", labels: unanswered, check: (await jobs())[tabId]?.report?.check ?? [] }).catch(() => undefined);

      // The site says something's wrong ("Error: Invalid Data", "Please check all information"): never press
      // Next or Submit over it. List what it flagged and wait; once the student changes something, try once more.
      if (status.formErrors.length || status.flagged.length) {
        if (errorValues === null) errorValues = status.valuesKey;
        if (status.valuesKey === errorValues) {
          const job = (await jobs())[tabId];
          const needs = [...new Set([...status.flagged, ...status.needsYou])];
          if (job?.report) await saveJob(tabId, { report: { ...job.report, needsYou: needs } });
          const said = status.formErrors[0] ? `The site says: "${status.formErrors[0].slice(0, 140)}". ` : "The site flagged some answers. ";
          void addIssues(scan.url, [{ kind: "site", what: `${said}${status.flagged.length ? `Flagged: ${status.flagged.slice(0, 5).join(", ")}.` : ""}`.trim() }]).catch(() => undefined);
          await step(`${said}${needs.length ? `Check ${needs.slice(0, 3).join(", ")}${needs.length > 3 ? ` and ${needs.length - 3} more` : ""}. ` : ""}Unnepo won't go on until you've fixed it.`);
          await wait(1200);
          continue;
        }
      }

      // Something only the student can answer: wait for it, then keep going.
      if (status.needsYou.length) {
        void addIssues(scan.url, status.needsYou.map((label) => ({ kind: "fill" as const, question: label, what: "Unnepo couldn't answer this, so you had to." }))).catch(() => undefined);
        const job = (await jobs())[tabId];
        if (job?.report) await saveJob(tabId, { report: { ...job.report, needsYou: status.needsYou } });
        await step(`Waiting for you: ${status.needsYou.slice(0, 3).join(", ")}${status.needsYou.length > 3 ? ` and ${status.needsYou.length - 3} more` : ""}. Unnepo carries on when they're filled.`);
        await wait(1000);
        continue;
      }
      const job = (await jobs())[tabId];
      if (job?.report?.needsYou.length) await saveJob(tabId, { report: { ...job.report, needsYou: [] } });

      const action = status.action;
      // Apply after filling means the site sent the application back to the job posting: starting over would
      // go round in circles, so it stops instead.
      if (action?.kind === "apply" && (furthest || (scan.ats === "workday" && filledKeys.size)) && !status.confirmed) {
        throw new Error("The site went back to the job posting after Unnepo had filled the application, so Unnepo stopped instead of starting over. What happened is on your issues list (Profile).");
      }
      if (!action) {
        await step(status.confirmed ? "Looks submitted. Press Stop, then add it to your tracker with I already applied under More." : `Filled ${filledAll.length} fields. Watching the page; press Stop when you're done.`);
        await wait(1000);
        continue;
      }
      // Answers on the review checklist come first: Next waits until the student has looked them over.
      if ((action.kind === "next" || action.kind === "submit") && status.reviewLeft) {
        await step(`Check ${status.reviewLeft} ${status.reviewLeft === 1 ? "answer" : "answers"} outlined in blue (the checklist is in the corner). Unnepo goes on when you're done.`);
        await wait(1000);
        continue;
      }
      if (action.kind === "submit" && !(await settings()).autoSubmit) {
        await step(`Everything's filled. Check the form, then press "${action.label}" on the page.`);
        await wait(1000);
        continue;
      }
      // Signing in again after the site said no would only lock the account.
      if (action.kind === "sign_in" && signInFailedAt.has(site)) {
        await wait(1500);
        continue;
      }
      // Pressing the same button over and over on a page that won't move helps no one.
      const pressKey = `${key}|${action.kind}|${action.label}`;
      // Sign in and Create account are pressed once per page: retrying them is what locks accounts.
      if (pressKey === pressedKey && (action.kind === "sign_in" || action.kind === "create_account")) {
        await step(`Pressed "${action.label}", but the page didn't move. Check the page; Unnepo carries on when it changes.`);
        await wait(1500);
        continue;
      }
      // After two tries it waits, then tries again now and then (the student may have fixed something).
      if (pressKey === pressedKey && presses >= 2 && Date.now() - pressedAt < 8000) {
        await step(`Pressed "${action.label}", but the page didn't move. Something on the page may need you; Unnepo carries on when it changes.`);
        await wait(1200);
        continue;
      }
      // A fresh press: if the site shows an error after it, that's measured from here.
      errorValues = null;
      presses = pressKey === pressedKey ? presses + 1 : 1;
      pressedKey = pressKey;
      pressedAt = Date.now();
      await step(ACTION_STEP[action.kind]);
      const reply = await send<{ pressed: boolean; what?: { label?: string; id?: string; overlay?: boolean } }>(tabId, { type: "press", kind: action.kind, knownAccount: known }).catch(() => ({ pressed: false, what: undefined }));
      if (!reply.pressed) { await wait(300); continue; }
      pressed(reply.what, action.label);
      await waitForChange(key, `${action.kind}|${action.label}|${status.apply}`, known);
      if (action.kind === "create_account") {
        const notes = await send<Status>(tabId, { type: "status", knownAccount: known }).catch(() => null);
        // Made (keep the password it was made with), or it already existed (password unknown).
        if (notes?.accountExists) await rememberAccount(site);
        else if (!notes?.action || notes.action.kind !== "create_account") await rememberAccount(site, await passwordFor(site));
      }
    }
    if ((await jobs())[tabId]?.submission) return;
    // Stopped by the student. On a stepped application, what happened goes on the issues list, so a run
    // that went wrong can be traced even when Unnepo didn't notice anything itself.
    if (furthest) await addIssues(lastUrl, [{ kind: "stopped", what: story(`You pressed Stop on ${stepText(seenStep)}.`) }]).catch(() => undefined);
    await saveJob(tabId, { step: "Stopped. Press Fill to start again." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong.";
    // On a stepped application, the presses that led here help find the cause.
    await addIssues((await chrome.tabs.get(tabId).catch(() => null))?.url ?? lastUrl, [{ kind: "stopped", what: story(`Stopped: ${message}`) }]).catch(() => undefined);
    await saveJob(tabId, { error: message, step: "Stopped." });
  } finally {
    if (stillRunning(tabId, runId)) runs.delete(tabId);
    await saveJob(tabId, { running: false }).catch(() => undefined);
    void send(tabId, { type: "spiders", on: false }, 0).catch(() => undefined);
  }
}

/** A job's details as read from its link: the title, company, place, description, and the address read. */
type LinkInfo = { title: string; company: string; location: string; description: string; url: string };

/**
 * Reads a job board link in the student's own browser: opens it in a background tab (signed in as they are, so
 * Handshake shows the job), waits for the page to draw, reads the job that's open, and closes the tab. LinkedIn
 * is never opened. Null when the page didn't show a job.
 */
async function readLinkInTab(url: string): Promise<LinkInfo | null> {
  let host = "";
  try { host = new URL(url).hostname; } catch { return null; }
  if (!/^https:\/\//.test(url) || NEVER_READ.test(host)) return null;
  const tab = await chrome.tabs.create({ url, active: false }).catch(() => null);
  if (!tab?.id) return null;
  const tabId = tab.id;
  try {
    await new Promise<void>((done) => {
      const timer = setTimeout(finish, 20_000);
      function finish() {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listen);
        done();
      }
      function listen(id: number, info: { status?: string }) {
        if (id === tabId && info.status === "complete") finish();
      }
      chrome.tabs.onUpdated.addListener(listen);
    });
    // Job boards draw the job after the page loads; it reads a few times until a title shows.
    for (let tries = 0; tries < 6; tries += 1) {
      await new Promise((done) => setTimeout(done, 1500));
      await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ["content/fill.js"] }).catch(() => undefined);
      const job = await send<{ title: string; company: string; description: string; url: string; from: string }>(tabId, { type: "opened-job" }, 0).catch(() => null);
      if (job?.title && job.from !== "page") {
        const place = job.description.match(/\b([A-Z][a-zA-Z .'-]+, (?:[A-Z]{2}|[A-Z][a-z]+))\b/)?.[1] ?? "";
        return { title: job.title, company: job.company, location: place, description: job.description, url };
      }
    }
    return null;
  } finally {
    await chrome.tabs.remove(tabId).catch(() => undefined);
  }
}

/** A link's job: read by the server when it can (company sites), else in the browser (job boards). */
async function readLink(url: string): Promise<{ info: LinkInfo | null; error?: string }> {
  try {
    return await api<{ info: LinkInfo }>("POST", "read-link", { url });
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== "in_browser") return { info: null, error: error instanceof Error ? error.message : "Couldn't read the link." };
  }
  const info = await readLinkInTab(url);
  return info ? { info } : { info: null, error: "Couldn't find the job on that page. Sign in to the job board in Chrome, then try again." };
}

/** Saves the submission in Unnepo with a screenshot of the confirmation. */
async function record(tabId: number, confidence: "confirmed" | "likely", text: string, how: AppliedHow = confidence === "confirmed" ? "site_confirmed" : "page_said") {
  const job = (await jobs())[tabId];
  if (!job?.applicationId || job.submission === "confirmed" || (job.submission === "likely" && confidence === "likely")) return;
  // The site confirmed it: saved by itself (with Undo on Home). Anything weaker waits on Home for ✓ or ✗.
  const caught = how !== "you_marked";
  if (caught && !(confidence === "confirmed" && SURE_HOWS.has(how) && (await savesByItself()))) {
    await noteDetected({ url: job.url, title: job.title, company: job.company, applicationId: job.applicationId, sure: confidence, state: "ask" });
    return void log(`The page looks applied (${HOW_SAID[how]}). It's under Detected jobs on Home.`);
  }
  await saveJob(tabId, { submission: confidence });
  let screenshot: string | undefined;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.active) screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 60 });
  } catch {
    // A screenshot is a bonus; the submission is still recorded.
  }
  // The job board posting this application came from (its Apply opened this tab), kept as the job's link.
  const seen = (await seenJobs())[tabId];
  const postingUrl = seen?.url && !sameJobPage(seen.url, job.url) && sameCompany(seen.company, job.company) ? seen.url : undefined;
  try {
    await saveSubmission({ applicationId: job.applicationId, url: job.url, postingUrl, confidence, text, screenshot, how });
    void log(`Saved: ${job.title} at ${job.company} (${HOW_SAID[how]}).`);
    if (caught) await noteDetected({ url: job.url, title: job.title, company: job.company, applicationId: job.applicationId, sure: confidence, state: "saved" });
    // It went through and it's saved: any spiders still out dance, then leave. After the screenshot, so the receipt is clean.
    celebrate(tabId);
    await saveJob(tabId, { step: confidence === "confirmed" ? "Submitted. The site accepted your application, and it's in your Unnepo tracker." : "Looks submitted. It's in your Unnepo tracker; check your email for the site's confirmation." });
  } catch (error) {
    // Not saved: it can be caught again, and it's on the "Did you apply?" list meanwhile.
    await saveJob(tabId, { submission: null, error: error instanceof Error ? `Couldn't save the submission: ${error.message}` : "Couldn't save the submission." });
    await addMaybe({ url: job.url, title: job.title, company: job.company, applicationId: job.applicationId });
    void log(`Couldn't save ${job.title} at ${job.company}: ${error instanceof Error ? error.message : "no answer from Unnepo"}.`);
  }
}

/** The dancing spiders, only ever once the application is saved in the tracker. */
function celebrate(tabId: number) {
  void chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ["content/fill.js"] })
    .catch(() => undefined)
    .then(() => send(tabId, { type: "spiders", celebrate: true }, 0))
    .catch(() => undefined);
}

/** Saves an application as submitted, trying again once: a lost save is a job missing from the tracker. */
async function saveSubmission(body: Record<string, unknown>) {
  try {
    return await api<{ application: { id: string; title: string; company: string; companyMissing?: boolean } }>("POST", "submissions", body);
  } catch (error) {
    if (error instanceof Error && /couldn't tell which job/i.test(error.message)) throw error;
    await new Promise((done) => setTimeout(done, 2000));
    return api<{ application: { id: string; title: string; company: string; companyMissing?: boolean } }>("POST", "submissions", body);
  }
}

// A POST that succeeds right after a Submit click, on the job site itself, is the application going through.
const SUBMIT_REQUEST = /(application|apply|submit|candidate|jobs\/\d+)/i;
const NOT_SUBMIT = /(analytics|collect|track|log|metrics|beacon|sentry|segment|recaptcha|hcaptcha|captcha)/i;
/**
 * LinkedIn Easy Apply, which Unnepo never reads: only the address of the request LinkedIn's own page sends when
 * the student submits (never what's in it, or the page). It's only noted in the Activity log; the student adds
 * the job with the LinkedIn card.
 */
const LINKEDIN_APPLY = /\/voyager\/api\/[^?]*(onsiteapply|easyapply|jobapplication|applyapplication)|[?&]action=(submit|apply)[a-z]*application|\/jobs-apply\/|\/apply\/submit/i;
async function recordLinkedIn() {
  // Unnepo never reads LinkedIn pages, so it can't tell which job: the student adds it with the LinkedIn card.
  void log("Saw an Easy Apply on LinkedIn. Add the job with the panel's LinkedIn card if you applied.");
}

/** Tabs where a job board's 1-Click Apply or Submit was just pressed, and when. */
const applyClicks = new Map<number, number>();
// The job board saving an application, after one of those presses: an apply or application address, never a page view.
const BOARD_APPLY = /\/(apply|applications?|quick[-_]?apply|one[-_]?click)(\/|\?|$)|[?&](action|op)=apply\b/i;
const BOARD_NOT_APPLY = /(view|impression|track|analytics|log|metric|beacon|event|recommend|save[-_]?job|bookmark)/i;
chrome.webRequest.onCompleted.addListener((details) => {
  if (details.method !== "POST" || details.tabId < 0 || details.statusCode < 200 || details.statusCode >= 300) return;
  try {
    if (NEVER_READ.test(new URL(details.url).hostname) && LINKEDIN_APPLY.test(details.url)) {
      void recordLinkedIn().catch(() => undefined);
      return;
    }
  } catch {
    return;
  }
  const clicked = applyClicks.get(details.tabId);
  if (clicked && Date.now() - clicked < 60_000 && BOARD_APPLY.test(details.url) && !BOARD_NOT_APPLY.test(details.url)) {
    applyClicks.delete(details.tabId);
    void recordSeen(details.tabId, "The job site saved your application.", "board_saved").catch(() => undefined);
  }
  void jobs().then((all) => {
    const job = all[details.tabId];
    if (!job?.clickedAt || Date.now() - job.clickedAt > 60_000) return;
    const host = new URL(details.url).hostname;
    const sameSite = host === job.host || host.split(".").slice(-2).join(".") === job.host.split(".").slice(-2).join(".");
    if (sameSite && SUBMIT_REQUEST.test(details.url) && !NOT_SUBMIT.test(details.url)) void record(details.tabId, "confirmed", "The site accepted the submission.");
  });
}, { urls: ["https://*/*"] });

/**
 * The tracker (every job with its people), as the panel, the dashboard and the reminders read it. A copy is kept
 * so Home draws at once; it's read again behind it once it's older than TRACKER_FRESH_MS, and after any change.
 */
const TRACKER_FRESH_MS = 15_000;
let trackerReading: Promise<Tracker> | null = null;
async function trackerCopy() {
  return ((await chrome.storage.local.get("trackerCopy")).trackerCopy as { at: number; data: Tracker } | undefined) ?? null;
}
function readTracker() {
  trackerReading ??= api<Tracker>("GET", "tracker")
    .then(async (data) => {
      await chrome.storage.local.set({ trackerCopy: { at: Date.now(), data } });
      void updateBadge();
      return data;
    })
    .finally(() => { trackerReading = null; });
  return trackerReading;
}
async function tracker(fresh = false): Promise<Tracker> {
  const copy = await trackerCopy();
  if (!copy || fresh) return readTracker();
  if (Date.now() - copy.at > TRACKER_FRESH_MS) void readTracker().then(() => chrome.runtime.sendMessage({ type: "tracker-changed" }).catch(() => undefined), () => undefined);
  return copy.data;
}

/** Reminders as Home shows them, from the tracker copy and what the student snoozed or finished. */
async function dueReminders() {
  const [copy, stored] = await Promise.all([trackerCopy(), chrome.storage.local.get(["reminderMarks", "openedEmails", "followUps"])]);
  if (!copy) return [];
  return reminders(copy.data, (stored.reminderMarks as ReminderMarks | undefined) ?? {}, (stored.openedEmails as OpenedEmails | undefined) ?? {}, (stored.followUps as Record<string, number> | undefined) ?? {}).items;
}

/** The icon's badge: jobs waiting for ✓ or ✗, and reminders due. */
async function updateBadge() {
  const { token } = await settings();
  const asking = token ? (await detectedList()).filter((item) => item.state === "ask").length : 0;
  const due = token ? dueCount(await dueReminders()) : 0;
  const count = asking + due;
  await chrome.action.setBadgeBackgroundColor({ color: asking ? "#F5A524" : "#3D8BFF" }).catch(() => undefined);
  await chrome.action.setBadgeText({ text: count ? String(Math.min(count, 99)) : "" }).catch(() => undefined);
}

/**
 * Every few hours: the tracker is read again, the badge updated, and once a day a notification says what's due.
 * Clicking it opens the dashboard. Off in Settings if the student doesn't want it.
 */
const REMINDER_ALARM = "reminders";
async function checkReminders() {
  const { token } = await settings();
  if (!token) return;
  await readTracker().catch(() => undefined);
  const items = await dueReminders();
  const count = dueCount(items);
  const stored = await chrome.storage.local.get(["notify", "notifiedOn"]);
  const today = new Date().toDateString();
  if (!count || stored.notify === false || stored.notifiedOn === today) return;
  await chrome.storage.local.set({ notifiedOn: today });
  const first = items.find((item) => item.kind !== "finish");
  chrome.notifications.create(REMINDER_ALARM, {
    type: "basic", iconUrl: chrome.runtime.getURL("icons/128.png"), title: count === 1 ? "1 thing to do on Unnepo" : `${count} things to do on Unnepo`,
    message: first ? `${first.title}${count > 1 ? `, and ${count - 1} more` : ""}.` : "Open Unnepo to see them.", priority: 1,
  });
}
void chrome.alarms.get(REMINDER_ALARM).then((alarm) => {
  if (!alarm) void chrome.alarms.create(REMINDER_ALARM, { delayInMinutes: 1, periodInMinutes: 180 });
});
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === REMINDER_ALARM) void checkReminders(); });
chrome.notifications.onClicked.addListener((id) => {
  if (id !== REMINDER_ALARM) return;
  chrome.notifications.clear(id);
  void chrome.tabs.create({ url: chrome.runtime.getURL("dashboard/dashboard.html") });
});

/** The side panel, or one of the extension's own pages in a tab (the dashboard), never a web page. */
const fromExtension = (sender: chrome.runtime.MessageSender) => sender.id === chrome.runtime.id && (!sender.tab || (sender.url ?? "").startsWith(chrome.runtime.getURL("")));
const failed = (error: unknown, fallback: string) => ({ ok: false, error: error instanceof Error ? error.message : fallback });

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  const tabId = sender.tab?.id;
  void (async () => {
    switch (message?.type) {
      case "state":
        return reply(await state());
      case "list-issues":
        return reply({ issues: await issues() });
      case "add-issue": {
        const note = String(message.note ?? "").trim();
        if (!note) return reply({ ok: false });
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        await addIssues(tab?.url && /^https?:/.test(tab.url) ? tab.url : "", [{ kind: "note", what: note }]);
        return reply({ ok: true });
      }
      case "clear-issues":
        await chrome.storage.local.remove("issues");
        void chrome.runtime.sendMessage({ type: "state-changed" }).catch(() => undefined);
        return reply({ ok: true });
      case "connect": {
        // From the connect page's content script, or a code the student pasted in the panel.
        const origin = sender.tab ? String(message.origin ?? "") : (await settings()).apiBase;
        if (sender.tab && !ALLOWED_API.test(origin)) return reply({ ok: false });
        await chrome.storage.local.set({ token: String(message.token), apiBase: ALLOWED_API.test(origin) ? origin : DEFAULT_API });
        await chrome.storage.local.remove(["trackerCopy", "detected"]);
        void checkReminders();
        void chrome.runtime.sendMessage({ type: "state-changed" }).catch(() => undefined);
        return reply({ ok: true });
      }
      case "disconnect":
        await api("DELETE", "token").catch(() => undefined);
        // Another account's jobs, detections and reminders don't carry over.
        await chrome.storage.local.remove(["token", "trackerCopy", "detected", "openedEmails", "reminderMarks", "followUps", "notifiedOn"]);
        void updateBadge();
        return reply({ ok: true });
      // Only the side panel (no tab) may read or change the password; web pages never can.
      case "get-password":
        if (sender.tab) return reply({ ok: false });
        return reply({ ok: true, password: await jobSitePassword() });
      case "set-password": {
        if (sender.tab) return reply({ ok: false });
        const value = String(message.value ?? "");
        const unmet = unmetRules(value);
        if (unmet.length) return reply({ ok: false, unmet });
        await chrome.storage.local.set({ jobSitePassword: value });
        return reply({ ok: true, password: value });
      }
      case "new-password": {
        if (sender.tab) return reply({ ok: false });
        const password = generatePassword();
        await chrome.storage.local.set({ jobSitePassword: password });
        return reply({ ok: true, password });
      }
      // The panel's resume row: see it, or upload a new one.
      case "get-resume": {
        if (sender.tab) return reply({ ok: false });
        const got = await resumeFile();
        return reply({ ok: Boolean(got.file), file: got.file, error: got.error });
      }
      case "upload-resume":
        if (sender.tab) return reply({ ok: false });
        try {
          await uploadResume(String(message.name), String(message.mime), String(message.base64));
          resumeReady = null;
          void chrome.runtime.sendMessage({ type: "state-changed" }).catch(() => undefined);
          return reply({ ok: true });
        } catch (error) {
          return reply({ ok: false, error: error instanceof Error ? error.message : "Upload failed." });
        }
      // The panel's cover letter: for the job on this tab. The job is opened in Unnepo first if it isn't yet.
      case "generate-letter": {
        if (sender.tab) return reply({ ok: false });
        const tabId = Number(message.tabId);
        try {
          // No job on the page: the student pasted the job description in the panel.
          if (typeof message.description === "string") {
            const letter = await api<{ text: string; fileName: string; pdfBase64: string }>("POST", "cover-letter", { description: message.description, ...(message.options ?? {}) });
            return reply({ ok: true, doc: letter });
          }
          // A job already in the tracker for this tab is used; otherwise the job as the page shows it. Writing a
          // letter never adds a job to the tracker: jobs come only from forwarded emails or "Add a job".
          const earlier = (await jobs())[tabId];
          const scan = earlier?.applicationId ? await look(tabId) : null;
          const applicationId = earlier?.applicationId && (!scan || earlier.running || sameApplication(earlier.url, scan.url)) ? earlier.applicationId : undefined;
          if (!applicationId) {
            const given = message.job as Partial<JobDetails> | undefined;
            const job = given?.title ? given : await readJobDetails(tabId);
            if (!job?.title) throw new Error("Open the job posting or its application in this tab first.");
            const letter = await api<{ text: string; fileName: string; pdfBase64: string }>("POST", "cover-letter", { job: { title: job.title, company: job.company || job.site || "", description: job.description ?? "" }, ...(message.options ?? {}) });
            return reply({ ok: true, doc: letter });
          }
          // The student's quick answers (length, tone, what to mention) or their edit request ride along.
          const letter = await api<{ text: string; fileName: string; pdfBase64: string }>("POST", "cover-letter", { applicationId, ...(message.options ?? {}) });
          return reply({ ok: true, doc: letter });
        } catch (error) {
          return reply({ ok: false, error: error instanceof Error ? error.message : "Couldn't write the cover letter." });
        }
      }
      // The panel's "My jobs".
      case "list-jobs":
        if (sender.tab) return reply({ ok: false });
        try {
          return reply({ ok: true, ...(await api<{ jobs: unknown[]; total: number }>("GET", "jobs")) });
        } catch (error) {
          return reply({ ok: false, error: error instanceof Error ? error.message : "Couldn't load your jobs." });
        }
      // The panel's CV generator: a CV for the job on this tab (or a general one), paid for with credits.
      case "generate-cv": {
        if (sender.tab) return reply({ ok: false });
        const job = (await jobs())[Number(message.tabId)];
        try {
          const cv = await api<{ text: string; fileName: string; pdfBase64: string; usesLeft: number }>("POST", "cv", { applicationId: job?.applicationId || undefined });
          void chrome.runtime.sendMessage({ type: "state-changed" }).catch(() => undefined);
          return reply({ ok: true, cv });
        } catch (error) {
          return reply({ ok: false, error: error instanceof Error ? error.message : "Couldn't write the CV." });
        }
      }
      // "Still needs you" in the panel: show that question on the page.
      case "focus-field":
        if (sender.tab) return reply({ ok: false });
        return reply(await send<{ ok: boolean }>(Number(message.tabId), { type: "focus-field", label: String(message.label ?? "") }).catch(() => ({ ok: false })));
      // The spider on job pages: open the side panel for that tab. Chrome allows it right after a click.
      case "panel-state":
        return reply({ open: sender.tab ? panelWindows.has(sender.tab.windowId) : false });
      case "open-panel":
        if (tabId === undefined) return reply({ ok: false });
        try {
          await chrome.sidePanel.open({ tabId });
          return reply({ ok: true });
        } catch {
          return reply({ ok: false });
        }
      case "set-auto-submit":
        await chrome.storage.local.set({ autoSubmit: Boolean(message.value) });
        return reply({ ok: true });
      case "fill": {
        if (!AUTOFILL_ENABLED) return reply({ ok: false, error: "Autofill is turned off." });
        const tab = await chrome.tabs.get(Number(message.tabId)).catch(() => null);
        if (tab?.url && NEVER_READ.test(new URL(tab.url).hostname)) {
          await saveJob(Number(message.tabId), { error: "Unnepo doesn't fill LinkedIn. Open the job's own application (Apply on the company's site), then press Fill.", step: "Stopped." });
          return reply({ ok: false });
        }
        if (!runs.has(Number(message.tabId))) void run(Number(message.tabId));
        return reply({ ok: true });
      }
      case "stop":
        runs.delete(Number(message.tabId));
        await saveJob(Number(message.tabId), { running: false, step: "Stopped. Press Fill to start again." });
        return reply({ ok: true });
      case "clear-error":
        await saveJob(Number(message.tabId), { error: null, step: "" });
        return reply({ ok: true });
      case "applied":
        await record(Number(message.tabId), "likely", "Marked as applied in the extension.", "you_marked");
        return reply({ ok: true });
      case "not-applied": {
        const job = (await jobs())[Number(message.tabId)];
        if (job?.applicationId) await api("POST", "submissions/undo", { applicationId: job.applicationId }).catch(() => undefined);
        await saveJob(Number(message.tabId), { submission: null, step: "Marked as not applied." });
        return reply({ ok: true });
      }
      case "submit-clicked":
        // The page script also runs on tabs the panel only looked at; only an application Unnepo opened counts.
        if (tabId === undefined || !(await jobs())[tabId]?.applicationId) return reply({ ok: false });
        await saveJob(tabId, { clickedAt: Date.now() });
        if (Array.isArray(message.answers) && message.answers.length) {
          await api("POST", "answers", { answers: message.answers }).catch(() => undefined);
          // What the student typed or changed themselves is a question Unnepo didn't get right. Only the question
          // goes on the issues list, never the answer, and not twice for one already listed on this page.
          const page = issuePage(String(message.url ?? sender.tab?.url ?? "")).page;
          const listed = new Set((await issues()).filter((issue) => issue.page === page && issue.kind === "fill").map((issue) => issue.question));
          const questions = (message.answers as Array<{ question?: unknown }>).map((answer) => String(answer.question ?? "").trim()).filter((question) => question && !listed.has(question));
          await addIssues(String(message.url ?? sender.tab?.url ?? ""), questions.map((question) => ({ kind: "fill" as const, question, what: "You filled this in yourself: Unnepo left it empty or got it wrong." }))).catch(() => undefined);
        }
        return reply({ ok: true });
      case "write-answer": {
        // A "Write with AI" chip on an orange question: a short draft for the job in this tab.
        const job = tabId === undefined ? null : (await jobs())[tabId];
        if (!job?.applicationId) return reply({ error: "Press Fill in Unnepo first, so it knows which job this is." });
        try {
          const written = await api<{ answer: string }>("POST", "write", { applicationId: job.applicationId, question: String(message.label ?? "") });
          return reply({ answer: written.answer });
        } catch (error) {
          return reply({ error: error instanceof Error ? error.message : "Couldn't write this one." });
        }
      }
      // The panel's "Answer a question": for the job on the tab when Unnepo knows it, or from the profile alone.
      case "answer-question": {
        if (sender.tab) return reply({ ok: false });
        try {
          const job = (await jobs())[Number(message.tabId)];
          const given = message.job as Partial<JobDetails> | undefined;
          const written = await api<{ answer: string }>("POST", "write", { question: String(message.question ?? ""), length: message.length, ...(job?.applicationId ? { applicationId: job.applicationId } : given?.title ? { job: { title: given.title, company: given.company || given.site, description: given.description } } : {}) });
          return reply({ ok: true, answer: written.answer });
        } catch (error) {
          return reply({ ok: false, error: error instanceof Error ? error.message : "Couldn't write this one." });
        }
      }
      // The job box: what the page says about the job. The resume starts loading now, for Begin applying.
      case "job-details": {
        if (sender.tab) return reply({ ok: false });
        const details = await readJobDetails(Number(message.tabId)).catch(() => null);
        if (details) void readyResume();
        return reply({ ok: Boolean(details), details });
      }
      // "Begin applying": resume in, spiders beside the complex questions.
      case "begin-applying": {
        if (sender.tab) return reply({ ok: false });
        try {
          return reply({ ok: true, applying: await beginApplying(Number(message.tabId)) });
        } catch {
          return reply({ ok: false, error: "Couldn't reach the page. Reload it and press Begin applying again." });
        }
      }
      // The form moved on to its next step (or an upload box showed up): the page did it again by itself.
      case "applying-changed": {
        if (tabId === undefined) return reply({ ok: false });
        const before = (await applyingAll())[tabId];
        if (!before) return reply({ ok: false });
        const result = message.result as BeginResult;
        await saveApplying(tabId, { ...before, ...result, uploaded: [...new Set([...before.uploaded, ...result.uploaded])], url: sender.tab?.url ?? before.url });
        return reply({ ok: true });
      }
      case "stop-applying": {
        if (sender.tab) return reply({ ok: false });
        const id = Number(message.tabId);
        await send(id, { type: "stop-applying" }).catch(() => undefined);
        await saveApplying(id, null);
        return reply({ ok: true });
      }
      // "Answer complex questions": writes an answer for each one still empty, and types it into its box.
      case "answer-complex": {
        if (sender.tab) return reply({ ok: false });
        const id = Number(message.tabId);
        const applying = (await applyingAll())[id];
        if (!applying) return reply({ ok: false, error: "Press Begin applying first." });
        const given = message.job as Partial<JobDetails> | undefined;
        const tracked = (await jobs())[id];
        const context = tracked?.applicationId ? { applicationId: tracked.applicationId } : given?.title ? { job: { title: given.title, company: given.company || given.site, description: given.description } } : {};
        const answers = { ...(applying.answers ?? {}) };
        const todo = applying.questions.filter((question) => !question.answered && !answers[question.id]?.put);
        // A few at a time: quick, without asking Unnepo for everything at once.
        let next = 0;
        let stopped = "";
        const worker = async () => {
          while (next < todo.length && !stopped) {
            const question = todo[next++];
            try {
              const long = question.label.length > 60 || /describe|tell us|explain|why/i.test(question.label);
              const written = await api<{ answer: string }>("POST", "write", { question: question.label, ...(long ? { length: "paragraph" } : {}), ...context });
              const put = await send<{ ok: boolean; reason?: string }>(id, { type: "put-answer", id: question.id, text: written.answer }).catch(() => ({ ok: false, reason: "Couldn't reach the page." }));
              answers[question.id] = { text: written.answer, put: put.ok, ...(put.ok ? {} : { error: put.reason }) };
            } catch (error) {
              const why = error instanceof Error ? error.message : "Couldn't write this one.";
              answers[question.id] = { text: "", put: false, error: why };
              // Out of uses or today's limit: the rest would fail the same way.
              if (error instanceof ApiError && (error.status === 402 || error.status === 429 || /limit|credits|upgrade/i.test(why))) stopped = why;
            }
          }
        };
        await Promise.all([worker(), worker(), worker()]);
        await saveApplying(id, { ...applying, answers });
        return reply({ ok: true, written: todo.filter((question) => answers[question.id]?.text).length, stopped });
      }
      // An answer edited in the panel, put in its box again; or the page scrolled to a question.
      case "put-answer": {
        if (sender.tab) return reply({ ok: false });
        const id = Number(message.tabId);
        const result = await send<{ ok: boolean; reason?: string }>(id, { type: "put-answer", id: String(message.id), text: String(message.text ?? ""), replace: true }).catch(() => ({ ok: false, reason: "Couldn't reach the page." }));
        const applying = (await applyingAll())[id];
        if (applying?.answers?.[String(message.id)]) {
          applying.answers[String(message.id)] = { text: String(message.text ?? ""), put: result.ok, ...(result.ok ? {} : { error: result.reason }) };
          await saveApplying(id, applying);
        }
        return reply(result);
      }
      case "show-question":
        if (sender.tab) return reply({ ok: false });
        return reply(await send<{ ok: boolean }>(Number(message.tabId), { type: "show-question", id: String(message.id) }).catch(() => ({ ok: false })));
      // An applying session, started or ended from the panel.
      case "session":
        if (sender.tab) return reply({ ok: false });
        try {
          return reply({ ok: true, ...(await api<{ session: unknown }>("POST", "session", { start: Boolean(message.start) })) });
        } catch (error) {
          return reply({ ok: false, error: error instanceof Error ? error.message : "Couldn't do that." });
        }
      case "activity-log":
        if (sender.tab) return reply({ ok: false });
        return reply({ log: ((await chrome.storage.local.get("activityLog")).activityLog as unknown[] | undefined) ?? [] });
      // "It missed one": a report of this page for the issues list, so detection can be fixed for this site.
      case "missed-one": {
        if (sender.tab) return reply({ ok: false });
        const tab = Number(message.tabId);
        await look(tab).catch(() => null);
        const page = await send<{ path: string; title: string; headings: string[]; buttons: string[]; postingData: boolean; job: { title: string; company: string } }>(tab, { type: "page-report" }, 0).catch(() => null);
        const url = (await chrome.tabs.get(tab).catch(() => null))?.url ?? "";
        if (!page) return reply({ ok: false, error: "Couldn't read this page. Unnepo never reads LinkedIn; add LinkedIn jobs with the form instead." });
        const recent = (((await chrome.storage.local.get("activityLog")).activityLog as Array<{ at: number; text: string }> | undefined) ?? []).filter((item) => Date.now() - item.at < 30 * 60 * 1000).slice(0, 5).map((item) => item.text);
        await addIssues(url, [{ kind: "note", what: `Missed an application. Page "${page.title}" (${page.path}). Job read as "${page.job.title}" at "${page.job.company}"${page.postingData ? ", with posting data" : ", no posting data"}. Buttons: ${page.buttons.join(" | ") || "none"}. Headings: ${page.headings.join(" | ") || "none"}. Recent: ${recent.join(" / ") || "nothing seen"}.` }]);
        void log("Saved a report of this page to your issues list (Profile).");
        return reply({ ok: true });
      }
      // "Did you apply to these?": ✓ saves it as applied, ✕ drops it.
      case "maybe-answer": {
        if (sender.tab) return reply({ ok: false });
        try {
          await api("POST", "maybe", { action: "answer", id: message.id, applied: Boolean(message.applied) });
          return reply({ ok: true });
        } catch (error) {
          return reply({ ok: false, error: error instanceof Error ? error.message : "Couldn't save it." });
        }
      }
      // The setup card's answers, saved to the profile.
      case "save-setup":
        if (sender.tab) return reply({ ok: false });
        try {
          return reply({ ok: true, ...(await api<{ setup: unknown }>("POST", "setup", message.answers ?? {})) });
        } catch (error) {
          return reply({ ok: false, error: error instanceof Error ? error.message : "Couldn't save." });
        }
      // "+ Add job" in My jobs.
      case "add-job": {
        if (sender.tab) return reply({ ok: false });
        try {
          const job = (message.job ?? {}) as Record<string, unknown>;
          let url = String(job.url ?? "").trim();
          // A LinkedIn search page holds the job in its address; keep one address per job.
          try {
            const address = new URL(url);
            const jobId = NEVER_READ.test(address.hostname) ? address.pathname.match(/\/jobs\/view\/(\d+)/)?.[1] ?? address.searchParams.get("currentJobId") : null;
            if (jobId) url = `https://www.linkedin.com/jobs/view/${jobId}/`;
          } catch {
            url = "";
          }
          await api("POST", "add-job", { title: job.title, company: job.company, url, stage: job.stage, description: typeof job.description === "string" ? job.description : undefined });
          return reply({ ok: true });
        } catch (error) {
          return reply({ ok: false, error: error instanceof Error ? error.message : "Couldn't add it." });
        }
      }
      // The add-a-job form's link: the job's details to fill in the rest.
      case "read-link": {
        if (sender.tab) return reply({ ok: false });
        return reply(await readLink(String(message.url ?? "").trim()));
      }
      // From Unnepo's Applied page (through the page bridge): saved jobs to fill in from their links. Each
      // job board link is read in a background tab, one at a time, and what it showed is sent to Unnepo.
      case "read-links": {
        const { apiBase } = await settings();
        if (!sender.tab?.url || new URL(sender.tab.url).origin !== new URL(apiBase).origin) return reply({ ok: false });
        const list = (Array.isArray(message.jobs) ? message.jobs : []).slice(0, 25) as Array<{ id?: unknown; url?: unknown }>;
        const results: Array<{ id: string; ok: boolean; error?: string; changed?: string[]; info?: LinkInfo }> = [];
        for (const item of list) {
          const id = String(item.id ?? "");
          const info = await readLinkInTab(String(item.url ?? "")).catch(() => null);
          if (!info) {
            results.push({ id, ok: false, error: "Couldn't read the job on that page." });
            continue;
          }
          // No saved job: the add form wants what the page showed.
          if (!id) {
            results.push({ id, ok: true, info });
            continue;
          }
          try {
            const saved = await api<{ changed: string[] }>("POST", "job-info", { applicationId: id, info });
            results.push({ id, ok: true, changed: saved.changed });
          } catch (error) {
            results.push({ id, ok: false, error: error instanceof Error ? error.message : "Couldn't save it." });
          }
        }
        void log(`Read ${results.length} job ${results.length === 1 ? "link" : "links"} for your tracker: ${results.filter((item) => item.changed?.length).length} filled in.`);
        return reply({ ok: true, results });
      }
      // "I applied" in the panel: the job open on this tab (not the results beside it), for the student to check.
      case "read-opened-job": {
        if (sender.tab) return reply({ ok: false });
        const tab = await chrome.tabs.get(Number(message.tabId)).catch(() => null);
        if (!tab?.id || !tab.url || !/^https:/.test(tab.url)) return reply({ ok: false, error: "Open the job's page first." });
        if (NEVER_READ.test(new URL(tab.url).hostname)) return reply({ ok: false, error: "Unnepo doesn't read LinkedIn." });
        await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, files: ["content/fill.js"] }).catch(() => undefined);
        const job = await send<{ title: string; company: string; description: string; url: string; from: string }>(tab.id, { type: "opened-job" }, 0).catch(() => null);
        if (!job) return reply({ ok: false, error: "Couldn't read this page. Reload it and try again." });
        // A company's tab opened from a job board's Apply: the board's posting is the job's link.
        const seen = (await seenJobs())[tab.id];
        const posting = seen && sameCompany(seen.company, job.company) && !sameJobPage(seen.url, job.url) ? seen.url : "";
        return reply({ ok: true, job: { ...job, link: posting || job.url } });
      }
      // The student checked the job and saves it: as applied, or for later.
      case "save-opened-job": {
        if (sender.tab) return reply({ ok: false });
        const tabId = Number(message.tabId);
        const job = (message.job ?? {}) as Record<string, unknown>;
        let title = String(job.title ?? "").trim();
        let company = String(job.company ?? "").trim();
        // `url` is the page this tab is on (an application already tracked is found by it); `link` is the
        // posting, kept as the job's link in the tracker.
        const link = String(job.link ?? "").trim();
        const url = String(job.url ?? "").trim() || link;
        let description = String(job.description ?? "").trim();
        if (!/^https:\/\/\S+\.\S+/.test(link || url)) return reply({ ok: false, error: "Open the job's page first." });
        // What the page didn't say is read from the job's link: Unnepo reads company sites; a job board posting
        // that isn't this page is read in a background tab.
        const unsure = (name: string) => name.length < 2 || BOARD_WORD.test(name);
        if ((unsure(company) || title.length < 2 || description.length < 200) && link) {
          let info: LinkInfo | null = null;
          try {
            info = (await api<{ info: LinkInfo }>("POST", "read-link", { url: link })).info;
          } catch (error) {
            if (error instanceof ApiError && error.code === "in_browser" && !sameJobPage(link, url)) info = await readLinkInTab(link).catch(() => null);
          }
          if (info) {
            if (unsure(company) && !unsure(info.company)) company = info.company;
            if (title.length < 2) title = info.title;
            if (info.description.length > description.length) description = info.description;
          }
        }
        // Still nothing: saved anyway, under the site's name, and Unnepo names it from the description.
        if (title.length < 2) title = "Job title missing";
        if (unsure(company)) company = new URL(link || url).hostname.replace(/^www\./, "").split(".").slice(-2)[0];
        try {
          if (message.applied) {
            const saved = await saveSubmission({ url, postingUrl: link && link !== url ? link : undefined, title, company, description: description || undefined, confidence: "likely", text: "Marked applied in the Unnepo panel.", how: "you_marked" });
            await saveJob(tabId, { applicationId: saved.application.id, title: saved.application.title, company: saved.application.company, url, host: new URL(url).hostname, submission: "likely", clickedAt: Date.now(), step: `Added to your Applied jobs: ${saved.application.title}${saved.application.companyMissing ? "" : ` at ${saved.application.company}`}.` });
            void log(`Saved: ${saved.application.title} at ${saved.application.company} (you marked it).`);
            celebrate(tabId);
            return reply({ ok: true, id: saved.application.id, title: saved.application.title, company: saved.application.company, companyMissing: Boolean(saved.application.companyMissing) });
          }
          const added = await api<{ application: { id: string; title: string; company: string; companyMissing?: boolean } }>("POST", "add-job", { title, company, url: link || url, stage: "in_progress", description: description || undefined });
          void log(`Saved for later: ${title} at ${company}.`);
          return reply({ ok: true, id: added.application.id, title, company, companyMissing: Boolean(added.application.companyMissing) });
        } catch (error) {
          return reply({ ok: false, error: error instanceof Error ? error.message : "Couldn't save it." });
        }
      }
      // LinkedIn, never read: the student says they applied and names the job; only the tab's address is used.
      case "track-linkedin": {
        if (sender.tab) return reply({ ok: false });
        try {
          const tab = await chrome.tabs.get(Number(message.tabId));
          const address = new URL(tab.url ?? "");
          if (!NEVER_READ.test(address.hostname)) return reply({ ok: false, error: "This isn't a LinkedIn page." });
          // One address per job: /jobs/view/<id>, from the page or the search's selected job.
          const jobId = address.pathname.match(/\/jobs\/view\/(\d+)/)?.[1] ?? address.searchParams.get("currentJobId");
          const url = jobId ? `https://www.linkedin.com/jobs/view/${jobId}/` : `${address.origin}${address.pathname}`;
          const saved = await api<{ application: { id: string; title: string; company: string } }>("POST", "submissions", {
            url, title: String(message.title ?? "").trim(), company: String(message.company ?? "").trim(), description: String(message.description ?? "").trim() || undefined, confidence: "likely", text: "Applied on LinkedIn (added from the Unnepo panel).",
          });
          return reply({ ok: true, title: saved.application.title, company: saved.application.company });
        } catch (error) {
          return reply({ ok: false, error: error instanceof Error ? error.message : "Couldn't add it." });
        }
      }
      // A job board's Apply button was pressed (Handshake, ZipRecruiter): the job on the page is the one being
      // applied to. `final`: a button that sends the application itself (1-Click Apply, Submit application).
      case "apply-clicked": {
        if (tabId === undefined) return reply({ ok: false });
        const scan = await look(tabId).catch(() => null);
        if (scan?.title.trim() && scan.company.trim()) {
          const all = await seenJobs();
          const before = all[tabId];
          // A different job than the one seen before in this tab: start from this one.
          if (before && !sameJobPage(before.url, scan.url) && !sameCompany(before.company, scan.company)) {
            delete all[tabId];
            await chrome.storage.session.set({ seen: all });
          }
          await rememberSeen(tabId, scan);
          // A job saved earlier in this tab (the last one applied to from this search) isn't this one.
          const tracked = (await jobs())[tabId];
          if (tracked?.submission && !sameJobTitle(tracked, scan)) await saveJob(tabId, null);
          const seen = await seenJobs();
          if (seen[tabId]) {
            seen[tabId].pressed = true;
            // The company's tab may have opened before the job was read: it gets the job now.
            for (const opened of await chrome.tabs.query({}).catch(() => [] as chrome.tabs.Tab[])) {
              if (opened.id !== undefined && opened.openerTabId === tabId && !seen[opened.id]) seen[opened.id] = { ...seen[tabId], at: Date.now(), pressed: true };
            }
            await chrome.storage.session.set({ seen });
          }
          // On the list now; the panel only asks about it after two minutes, and a confirmation takes it off.
          // (A timer wouldn't do: Chrome puts the extension's background to sleep.) Going to the company's site
          // isn't applying yet: that tab asks when it closes.
          const latest = seen[tabId];
          if (latest && !message.elsewhere) await addMaybe({ url: latest.url, title: latest.title, company: latest.company, description: latest.description });
        }
        if (message.final) applyClicks.set(tabId, Date.now());
        void log(`Saw "${String(message.label ?? "Apply").slice(0, 40)}" pressed${scan?.title ? ` on ${scan.title}${scan.company ? ` at ${scan.company}` : ""}` : ""}. Watching for the confirmation.`);
        return reply({ ok: true });
      }
      // The page changed to say so right after an Apply press ("Applied", "Application sent").
      case "applied-detected":
        if (tabId === undefined) return reply({ ok: false });
        void log(`The page changed to "${String(message.text ?? "Applied").slice(0, 60)}" after Apply.`);
        void recordSeen(tabId, String(message.text ?? "The job site shows you applied."), "button_changed").catch(() => undefined);
        return reply({ ok: true });
      case "received-page": {
        // The page says the application went through, whoever filled it. It's saved first; the spiders dance
        // once it's in the tracker, never before.
        if (tabId === undefined) return reply({ ok: false });
        void log(`The page says "${String(message.text ?? "").replace(/\s+/g, " ").trim().slice(0, 60)}".`);
        // A job Unnepo is tracking in this tab, on this same site, is saved as applied if the network didn't
        // already confirm it.
        const job = (await jobs())[tabId];
        const site = (host: string) => host.split(".").slice(-2).join(".");
        let here = "";
        try { here = new URL(String(message.url ?? sender.tab?.url ?? "")).hostname; } catch { /* no page address */ }
        if (job?.submission) celebrate(tabId);
        else if (job?.applicationId && job.host && here && site(here) === site(job.host)) setTimeout(() => void record(tabId, "likely", String(message.text ?? "")), 6000);
        // Applied without Unnepo filling it (Handshake, ZipRecruiter, the company's own site), or on another
        // site than the job tracked here: save the job seen here.
        else setTimeout(() => void recordSeen(tabId, String(message.text ?? "")), 1500);
        return reply({ ok: true });
      }
      case "submitted-page":
        if (tabId === undefined) return reply({ ok: false });
        // Give the network a moment to confirm first. A tab with no job tracked saves the one seen here.
        setTimeout(() => void jobs().then((all) => (all[tabId]?.applicationId ? record(tabId, "likely", String(message.text ?? "")) : recordSeen(tabId, String(message.text ?? "")))), 6000);
        return reply({ ok: true });
      // The tracker, for Home, a job's page and the dashboard. `fresh`: read it again now.
      case "tracker":
        if (!fromExtension(sender)) return reply({ ok: false });
        try {
          return reply({ ok: true, tracker: await tracker(Boolean(message.fresh)) });
        } catch (error) {
          return reply(failed(error, "Couldn't load your jobs."));
        }
      // The People card: find, show one more, write an email or follow-up, mark emailed or replied, bounced.
      case "people":
        if (!fromExtension(sender)) return reply({ ok: false });
        try {
          const result = await api<Record<string, unknown>>("POST", "people", message.body ?? {});
          const body = (message.body ?? {}) as { action?: string; contactId?: string; status?: string; followedUp?: boolean };
          // A follow-up sent counts toward the most a person is nudged; a reply or "stop" ends it.
          if (body.action === "status" && body.contactId) {
            const stored = await chrome.storage.local.get(["followUps", "openedEmails"]);
            const counts = (stored.followUps as Record<string, number> | undefined) ?? {};
            if (body.status === "emailed" && body.followedUp) counts[body.contactId] = (counts[body.contactId] ?? 0) + 1;
            const opened = (stored.openedEmails as OpenedEmails | undefined) ?? {};
            delete opened[body.contactId];
            await chrome.storage.local.set({ followUps: counts, openedEmails: opened });
          }
          await readTracker().catch(() => undefined);
          return reply({ ok: true, ...result });
        } catch (error) {
          return reply(failed(error, "Couldn't do that."));
        }
      // A job's status: applied, or what happened after (interviewing, rejected…).
      case "job-status":
        if (!fromExtension(sender)) return reply({ ok: false });
        try {
          await api("POST", "status", { applicationId: message.applicationId, applied: message.applied === true, outcome: message.outcome ?? null });
          await readTracker().catch(() => undefined);
          return reply({ ok: true });
        } catch (error) {
          return reply(failed(error, "Couldn't change it."));
        }
      case "delete-job":
        if (!fromExtension(sender)) return reply({ ok: false });
        try {
          await api("DELETE", "applications", { applicationId: message.applicationId });
          await readTracker().catch(() => undefined);
          return reply({ ok: true });
        } catch (error) {
          return reply(failed(error, "Couldn't delete it."));
        }
      // An email link was opened: Home asks an hour later whether it was sent.
      case "email-opened": {
        if (!fromExtension(sender)) return reply({ ok: false });
        const opened = ((await chrome.storage.local.get("openedEmails")).openedEmails as OpenedEmails | undefined) ?? {};
        opened[String(message.contactId)] = { at: Date.now(), applicationId: String(message.applicationId), name: String(message.name ?? ""), company: String(message.company ?? ""), followUp: message.followUp === true };
        await chrome.storage.local.set({ openedEmails: opened });
        return reply({ ok: true });
      }
      // Snooze (until a time) or done, for one reminder; "Not yet" on "Did you send it?" forgets the opened link.
      case "reminder-mark": {
        if (!fromExtension(sender)) return reply({ ok: false });
        const stored = await chrome.storage.local.get(["reminderMarks", "openedEmails"]);
        const marks = (stored.reminderMarks as ReminderMarks | undefined) ?? {};
        const key = String(message.key ?? "");
        if (key.startsWith("sent:")) {
          const opened = (stored.openedEmails as OpenedEmails | undefined) ?? {};
          delete opened[key.split(":")[1]];
          await chrome.storage.local.set({ openedEmails: opened });
        } else if (key) {
          marks[key] = message.until ? { until: Number(message.until) } : { done: true };
          // Old marks go once they can't matter: done ones after 60 days of being set aren't tracked by date, so cap the count.
          await chrome.storage.local.set({ reminderMarks: Object.fromEntries(Object.entries(marks).slice(-300)) });
        }
        void updateBadge();
        return reply({ ok: true });
      }
      case "detected-list":
        if (!fromExtension(sender)) return reply({ ok: false });
        return reply({ ok: true, list: await detectedList() });
      // ✓ or ✗ on a detected job. ✓ saves it as applied; one with no company asks the student to add it by hand.
      case "detected-answer": {
        if (!fromExtension(sender)) return reply({ ok: false });
        const list = await detectedList();
        const item = list.find((entry) => entry.id === message.id);
        if (!item) return reply({ ok: false, error: "That job isn't on the list any more." });
        if (!message.applied) {
          item.state = "no";
          await saveDetectedList(list);
          return reply({ ok: true });
        }
        try {
          if (item.applicationId) await api("POST", "status", { applicationId: item.applicationId, applied: true });
          else if (item.title.trim() && item.company.trim()) {
            const saved = await saveSubmission({ url: item.url, title: item.title, company: item.company, description: item.description, poster: item.poster, confidence: "likely", text: "You said you applied.", how: "you_marked" });
            item.applicationId = saved.application.id;
          } else return reply({ ok: false, needsForm: true, error: "Unnepo didn't catch the company. Add it with + Add a job." });
          item.state = "yes";
          item.error = undefined;
          await saveDetectedList(list);
          await readTracker().catch(() => undefined);
          return reply({ ok: true });
        } catch (error) {
          item.error = error instanceof Error ? error.message : "Couldn't save it.";
          await saveDetectedList(list);
          return reply(failed(error, "Couldn't save it."));
        }
      }
      // Undo on a job saved by itself (or a ✓): back to not applied, and it asks again.
      case "detected-undo": {
        if (!fromExtension(sender)) return reply({ ok: false });
        const list = await detectedList();
        const item = list.find((entry) => entry.id === message.id);
        if (!item) return reply({ ok: false, error: "That job isn't on the list any more." });
        try {
          if (item.applicationId) await api("POST", "submissions/undo", { applicationId: item.applicationId });
          item.state = "undone";
          await saveDetectedList(list);
          await readTracker().catch(() => undefined);
          return reply({ ok: true });
        } catch (error) {
          return reply(failed(error, "Couldn't undo it."));
        }
      }
      case "refresh-badge":
        void updateBadge();
        return reply({ ok: true });
      default:
        return reply({ ok: false });
    }
  })();
  return true;
});

chrome.runtime.onInstalled.addListener(() => void jobSitePassword());
chrome.tabs.onRemoved.addListener((tabId) => {
  runs.delete(tabId);
  applyClicks.delete(tabId);
  formFrame.delete(tabId);
  void saveApplying(tabId, null);
  void tabGone(tabId);
});
// A restarted worker has no runs going, so nothing should say it's running.
void jobs().then(async (all) => {
  for (const [tabId, job] of Object.entries(all)) if (job.running) await saveJob(Number(tabId), { running: false });
});
// A new page in a tab that's applying (the next step of the form, or a reload): resume and spiders again, on
// the same site only. Going somewhere else ends it.
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== "complete" || !tab.url) return;
  void applyingAll().then((all) => {
    const before = all[tabId];
    if (!before) return;
    const site = (url: string) => { try { return new URL(url).hostname.split(".").slice(-2).join("."); } catch { return ""; } };
    if (site(before.url) !== site(tab.url!)) return void saveApplying(tabId, null);
    void beginApplying(tabId).catch(() => undefined);
  });
});
chrome.tabs.onActivated.addListener(() => void chrome.runtime.sendMessage({ type: "state-changed" }).catch(() => undefined));

// Windows with the side panel open. The spider hanging on job pages hides in those: the panel has its own.
// The panel holds a connection open while it's showing, so closing it (or the window) ends it.
const panelWindows = new Set<number>();
async function tellLaunchers(windowId: number) {
  const tabs = await chrome.tabs.query({ windowId }).catch(() => [] as chrome.tabs.Tab[]);
  for (const tab of tabs) if (tab.id !== undefined) void chrome.tabs.sendMessage(tab.id, { type: "panel", open: panelWindows.has(windowId) }).catch(() => undefined);
}
chrome.runtime.onConnect.addListener((port) => {
  const windowId = Number(port.name.match(/^panel:(\d+)$/)?.[1]);
  if (!Number.isInteger(windowId)) return;
  panelWindows.add(windowId);
  void tellLaunchers(windowId);
  port.onDisconnect.addListener(() => {
    panelWindows.delete(windowId);
    void tellLaunchers(windowId);
  });
});
void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
