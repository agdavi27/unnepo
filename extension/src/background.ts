import { generatePassword, unmetRules } from "./shared/password";
import { NEVER_READ, type Answer, type FileData, type FillPlan, type FillReport, type PanelState, type Scan } from "./shared/types";

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
  constructor(message: string, readonly status: number) {
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
  if (response.status === 401) await chrome.storage.local.remove("token");
  if (!response.ok) throw new ApiError((payload as { error?: string }).error || `Unnepo answered ${response.status}.`, response.status);
  return payload as T;
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
  };
  peeks.set(tabId, { url, at: Date.now(), page });
  return page;
}

async function state(): Promise<PanelState> {
  const { token, apiBase, autoSubmit } = await settings();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let me: PanelState["me"] = null;
  if (token) me = await api<NonNullable<PanelState["me"]>>("GET", "me").catch(() => null);
  const job = tab?.id !== undefined ? (await jobs())[tab.id] ?? null : null;
  // While Unnepo is working on the tab, the job itself says what's there.
  const page = me && tab?.id !== undefined && !job?.running ? await peek(tab.id, tab.url ?? "").catch(() => null) : null;
  return { connected: Boolean(token && me), me, page, tab: tab?.id !== undefined ? { id: tab.id, url: tab.url ?? "", title: tab.title ?? "" } : null, job, autoSubmit, apiBase };
}

/** The frame the application form is in, per tab: 0 for the page itself, or an embedded form's frame. */
const formFrame = new Map<number, number>();
const send = <T>(tabId: number, message: unknown, frameId = formFrame.get(tabId) ?? 0) => chrome.tabs.sendMessage(tabId, message, { frameId }) as Promise<T>;

// Frames Unnepo never reads or touches: CAPTCHAs (never solved, never poked), ads, video, and payments.
const SKIP_FRAME = /recaptcha|hcaptcha|captcha|turnstile|challenges\.cloudflare|arkoselabs|funcaptcha|doubleclick|googlesyndication|googletagmanager|youtube\.com|vimeo\.com|js\.stripe\.com|facebook\.com|linkedin\.com\/(embed|px)/i;

/** Two pages of the same application: same site, and the same job in the path (Workday keeps it in every step). */
function sameApplication(before: string | undefined, after: string) {
  if (!before) return false;
  try {
    const [a, b] = [new URL(before), new URL(after)];
    if (a.hostname !== b.hostname) return false;
    const [x, y] = [a.pathname.split("/").filter(Boolean), b.pathname.split("/").filter(Boolean)];
    let shared = 0;
    while (shared < x.length && x[shared] === y[shared]) shared += 1;
    return a.pathname === b.pathname || shared >= 3;
  } catch {
    return false;
  }
}

const signature = (scan: Scan) => `${scan.url}|${scan.passwordBoxes}|${scan.fields.map((field) => field.label).join("|")}`;
const hasForm = (scan: Scan) => scan.useServerSchema || scan.fields.length > 0 || scan.passwordBoxes > 0;
type Status = { apply: string | null; needsYou: string[]; action: { kind: "apply" | "create_account" | "sign_in" | "next" | "submit"; label: string } | null; captcha: boolean; accountExists: boolean; signInFailed: boolean; verifyEmail: boolean; confirmed: boolean };

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
  let applicationId = "";
  let posting: { url: string; title: string; company: string } | null = null;
  let filledKey = "";
  let pressedKey = "";
  let presses = 0;
  // Sites where signing in failed on this run: never pressed again.
  const signInFailedAt = new Set<string>();
  let triedApply = false;
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
  let llmCalls = 0;
  let lastStep = "";
  // Spiders crawl the whole time Unnepo is running, until it's submitted, something goes wrong, or Stop.
  let spidersOut = false;
  let lastUrl = "";
  const spiders = (on: boolean) => {
    if (on === spidersOut) return;
    spidersOut = on;
    void send(tabId, { type: "spiders", on }, 0).catch(() => undefined);
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
    if (!hasForm(first) || first.fields.length < 3) posting = { url: first.url, title: first.title, company: first.company };

    while (stillRunning(tabId, runId)) {
      if ((await jobs())[tabId]?.submission) break;
      const scan = await look(tabId);
      if (!scan) { await wait(400); continue; }
      // A new page load starts without spiders; send them back out if they were out.
      if (scan.url !== lastUrl && spidersOut) void send(tabId, { type: "spiders", on: true }, 0).catch(() => undefined);
      lastUrl = scan.url;
      const site = accountKey(scan.url);
      const known = Boolean((await knownAccounts())[site]);
      const status = await send<Status>(tabId, { type: "status", knownAccount: known }).catch(() => null);
      if (!status) { await wait(400); continue; }
      if (!stillRunning(tabId, runId)) break;
      // First thing on every run: if there's an Apply button, press it.
      if (!triedApply) {
        triedApply = true;
        if (status.apply) {
          await step("Opening the application…");
          const pressed = await send<{ pressed: boolean }>(tabId, { type: "press", first: true }).catch(() => ({ pressed: false }));
          // Some Apply buttons only scroll to the form below, so this doesn't wait long.
          if (pressed.pressed) await waitForChange(signature(scan), `${status.action?.kind}|${status.action?.label}|${status.apply}`, known, 4000);
          continue;
        }
      }
      if (status.accountExists && !known) { await rememberAccount(site); continue; }
      // A failed sign-in is never retried: a few wrong passwords in a row is how job sites lock accounts.
      if (status.signInFailed) {
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

      // A new form (page or step): fill it once.
      const key = signature(scan);
      if (hasForm(scan) && key !== filledKey) {
        if (!applicationId && (scan.fields.length || scan.useServerSchema)) {
          await step("Opening the job in Unnepo…");
          const where = posting ?? { url: scan.url, title: scan.title, company: scan.company };
          const job = await api<{ application: { id: string; title: string; company: string } }>("POST", "jobs", where);
          applicationId = job.application.id;
          await saveJob(tabId, { applicationId, title: job.application.title, company: job.application.company, url: where.url, host: firstHost });
        }
        await step("Preparing your answers…");
        const map = !applicationId || (!scan.useServerSchema && !scan.fields.length) ? { answers: [], llmCalls: 0 } : await api<{ answers: Answer[]; llmCalls: number }>("POST", "map", { applicationId, fields: scan.useServerSchema ? [] : scan.fields });
        llmCalls += map.llmCalls;
        const wantsCoverLetter = scan.useServerSchema ? map.answers.some((answer) => answer.id === "cover_letter") : scan.fields.some((field) => field.type === "file" && /cover ?letter/i.test(field.label));
        // Any upload box that isn't for a cover letter gets the resume, whatever the server's answers say.
        const wantsResume = scan.useServerSchema || scan.fields.some((field) => field.type === "file" && !/cover ?letter/i.test(field.label));
        if (scan.mentionsCv) await saveJob(tabId, { cv: true });
        if (wantsResume && resume === undefined) {
          const got = await resumeFile();
          resume = got.file;
          resumeError = got.error;
        }
        const letter = wantsCoverLetter && applicationId ? await api<{ fileName: string; pdfBase64: string }>("POST", "cover-letter", { applicationId }).catch(() => null) : null;
        if (!stillRunning(tabId, runId)) break;
        await step("Filling the form…", { llmCalls });
        const plan: FillPlan = { ats: scan.ats, useServerSchema: scan.useServerSchema, answers: map.answers, resume: wantsResume ? resume ?? null : null, coverLetter: letter ? { name: letter.fileName, mime: "application/pdf", base64: letter.pdfBase64 } : null, autoSubmit: false, password: await passwordFor(accountKey(scan.url)) };
        let report = await send<FillReport>(tabId, { type: "fill", plan }).catch(() => null);
        // Greenhouse's API leaves some questions out (the U.S. demographic questions): fill those from the page.
        if (report && scan.useServerSchema && applicationId) {
          const extra = await send<{ fields: Scan["fields"] }>(tabId, { type: "leftovers", ids: map.answers.map((answer) => answer.id) }).catch(() => ({ fields: [] }));
          if (extra.fields.length) {
            const more = await api<{ answers: Answer[]; llmCalls: number }>("POST", "map", { applicationId, fields: extra.fields }).catch(() => null);
            if (more?.answers.length) {
              llmCalls += more.llmCalls;
              const second = await send<FillReport>(tabId, { type: "fill", plan: { ...plan, useServerSchema: false, answers: more.answers, resume: null, coverLetter: null } }).catch(() => null);
              if (second) report = { ...second, filled: [...report.filled, ...second.filled], failed: [...report.failed, ...second.failed] };
            }
          }
        }
        // Say why the resume box is empty instead of leaving it a mystery.
        if (report && wantsResume && !resume && resumeError) report = { ...report, failed: [...report.failed, { label: "Resume", reason: resumeError }] };
        if (report) {
          filledAll.push(...report.filled);
          await saveJob(tabId, { report: { ...report, filled: [...filledAll] }, llmCalls });
        }
        filledKey = key;
        continue;
      }

      // Something only the student can answer: wait for it, then keep going.
      if (status.needsYou.length) {
        const job = (await jobs())[tabId];
        if (job?.report) await saveJob(tabId, { report: { ...job.report, needsYou: status.needsYou } });
        await step(`Waiting for you: ${status.needsYou.slice(0, 3).join(", ")}${status.needsYou.length > 3 ? ` and ${status.needsYou.length - 3} more` : ""}. Unnepo carries on when they're filled.`);
        await wait(1000);
        continue;
      }
      const job = (await jobs())[tabId];
      if (job?.report?.needsYou.length) await saveJob(tabId, { report: { ...job.report, needsYou: [] } });

      const action = status.action;
      if (!action) {
        await step(status.confirmed ? "Looks submitted. Saving it to your tracker…" : `Filled ${filledAll.length} fields. Watching the page; press Stop when you're done.`);
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
      presses = pressKey === pressedKey ? presses + 1 : 1;
      pressedKey = pressKey;
      pressedAt = Date.now();
      await step(ACTION_STEP[action.kind]);
      const pressed = await send<{ pressed: boolean }>(tabId, { type: "press", kind: action.kind, knownAccount: known }).catch(() => ({ pressed: false }));
      if (!pressed.pressed) { await wait(300); continue; }
      await waitForChange(key, `${action.kind}|${action.label}|${status.apply}`, known);
      if (action.kind === "create_account") {
        const notes = await send<Status>(tabId, { type: "status", knownAccount: known }).catch(() => null);
        // Made (keep the password it was made with), or it already existed (password unknown).
        if (notes?.accountExists) await rememberAccount(site);
        else if (!notes?.action || notes.action.kind !== "create_account") await rememberAccount(site, await passwordFor(site));
      }
    }
    if ((await jobs())[tabId]?.submission) return;
    await saveJob(tabId, { step: "Stopped. Press Fill to start again." });
  } catch (error) {
    await saveJob(tabId, { error: error instanceof Error ? error.message : "Something went wrong.", step: "Stopped." });
  } finally {
    if (stillRunning(tabId, runId)) runs.delete(tabId);
    await saveJob(tabId, { running: false }).catch(() => undefined);
    void send(tabId, { type: "spiders", on: false }, 0).catch(() => undefined);
  }
}

/** Saves the submission in Unnepo with a screenshot of the confirmation. */
async function record(tabId: number, confidence: "confirmed" | "likely", text: string) {
  const job = (await jobs())[tabId];
  if (!job?.applicationId || job.submission === "confirmed" || (job.submission === "likely" && confidence === "likely")) return;
  await saveJob(tabId, { submission: confidence });
  let screenshot: string | undefined;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.active) screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 60 });
  } catch {
    // A screenshot is a bonus; the submission is still recorded.
  }
  try {
    await api("POST", "submissions", { applicationId: job.applicationId, url: job.url, confidence, text, screenshot });
    await saveJob(tabId, { step: confidence === "confirmed" ? "Submitted. The site accepted your application, and it's in your Unnepo tracker." : "Looks submitted. It's in your Unnepo tracker; check your email for the site's confirmation." });
  } catch (error) {
    await saveJob(tabId, { error: error instanceof Error ? `Couldn't save the submission: ${error.message}` : "Couldn't save the submission." });
  }
}

// A POST that succeeds right after a Submit click, on the job site itself, is the application going through.
const SUBMIT_REQUEST = /(application|apply|submit|candidate|jobs\/\d+)/i;
const NOT_SUBMIT = /(analytics|collect|track|log|metrics|beacon|sentry|segment|recaptcha|hcaptcha|captcha)/i;
chrome.webRequest.onCompleted.addListener((details) => {
  if (details.method !== "POST" || details.tabId < 0 || details.statusCode < 200 || details.statusCode >= 300) return;
  void jobs().then((all) => {
    const job = all[details.tabId];
    if (!job?.clickedAt || Date.now() - job.clickedAt > 60_000) return;
    const host = new URL(details.url).hostname;
    const sameSite = host === job.host || host.split(".").slice(-2).join(".") === job.host.split(".").slice(-2).join(".");
    if (sameSite && SUBMIT_REQUEST.test(details.url) && !NOT_SUBMIT.test(details.url)) void record(details.tabId, "confirmed", "The site accepted the submission.");
  });
}, { urls: ["https://*/*"] });

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  const tabId = sender.tab?.id;
  void (async () => {
    switch (message?.type) {
      case "state":
        return reply(await state());
      case "connect": {
        // From the connect page's content script, or a code the student pasted in the panel.
        const origin = sender.tab ? String(message.origin ?? "") : (await settings()).apiBase;
        if (sender.tab && !ALLOWED_API.test(origin)) return reply({ ok: false });
        await chrome.storage.local.set({ token: String(message.token), apiBase: ALLOWED_API.test(origin) ? origin : DEFAULT_API });
        void chrome.runtime.sendMessage({ type: "state-changed" }).catch(() => undefined);
        return reply({ ok: true });
      }
      case "disconnect":
        await api("DELETE", "token").catch(() => undefined);
        await chrome.storage.local.remove("token");
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
          void chrome.runtime.sendMessage({ type: "state-changed" }).catch(() => undefined);
          return reply({ ok: true });
        } catch (error) {
          return reply({ ok: false, error: error instanceof Error ? error.message : "Upload failed." });
        }
      // The spider on job pages: open the side panel for that tab. Chrome allows it right after a click.
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
      case "applied":
        await record(Number(message.tabId), "likely", "Marked as applied in the extension.");
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
        if (Array.isArray(message.answers) && message.answers.length) await api("POST", "answers", { answers: message.answers }).catch(() => undefined);
        return reply({ ok: true });
      case "submitted-page":
        if (tabId === undefined) return reply({ ok: false });
        // Give the network a moment to confirm first.
        setTimeout(() => void record(tabId, "likely", String(message.text ?? "")), 6000);
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
  formFrame.delete(tabId);
  void saveJob(tabId, null);
});
// A restarted worker has no runs going, so nothing should say it's running.
void jobs().then(async (all) => {
  for (const [tabId, job] of Object.entries(all)) if (job.running) await saveJob(Number(tabId), { running: false });
});
chrome.tabs.onActivated.addListener(() => void chrome.runtime.sendMessage({ type: "state-changed" }).catch(() => undefined));
void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
