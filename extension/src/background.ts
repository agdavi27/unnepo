import type { Answer, FileData, FillPlan, FillReport, PanelState, Scan } from "./shared/types";

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

async function resumeFile(): Promise<FileData | null> {
  const { token, apiBase } = await settings();
  const response = await fetch(`${apiBase}/api/extension/resume`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) return null;
  const name = response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "Resume.pdf";
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return { name, mime: response.headers.get("content-type") ?? "application/pdf", base64: btoa(binary) };
}

async function state(): Promise<PanelState> {
  const { token, apiBase, autoSubmit } = await settings();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let me: PanelState["me"] = null;
  if (token) me = await api<NonNullable<PanelState["me"]>>("GET", "me").catch(() => null);
  const job = tab?.id !== undefined ? (await jobs())[tab.id] ?? null : null;
  return { connected: Boolean(token && me), me, tab: tab?.id !== undefined ? { id: tab.id, url: tab.url ?? "", title: tab.title ?? "" } : null, job, autoSubmit, apiBase };
}

const send = <T>(tabId: number, message: unknown) => chrome.tabs.sendMessage(tabId, message) as Promise<T>;

/** Scan the page, open the job in Unnepo, get every answer, attach files, fill, and check. */
async function fill(tabId: number) {
  await saveJob(tabId, { step: "Reading the form…", report: null, submission: null, error: null, clickedAt: null, llmCalls: 0 });
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content/fill.js"] });
    const scan = await send<Scan>(tabId, { type: "scan" });
    if (scan.embeddedForm && !scan.fields.length) throw new Error(`This page shows the form inside another site. Open the form directly, then press Fill: ${scan.embeddedForm}`);
    if (!scan.useServerSchema && !scan.fields.length) throw new Error("No application form on this page. Open the job's application form, then press Fill.");
    await saveJob(tabId, { step: "Opening the job in Unnepo…", url: scan.url, host: new URL(scan.url).hostname });
    const job = await api<{ application: { id: string; title: string; company: string } }>("POST", "jobs", { url: scan.url, title: scan.title, company: scan.company });
    await saveJob(tabId, { applicationId: job.application.id, title: job.application.title, company: job.application.company, step: "Preparing your answers…" });
    const map = await api<{ answers: Answer[]; llmCalls: number }>("POST", "map", { applicationId: job.application.id, fields: scan.useServerSchema ? [] : scan.fields });
    const wantsCoverLetter = scan.useServerSchema ? map.answers.some((answer) => answer.id === "cover_letter") : scan.fields.some((field) => field.type === "file" && /cover ?letter/i.test(field.label));
    const wantsResume = scan.useServerSchema ? map.answers.some((answer) => answer.id === "resume") : scan.fields.some((field) => field.type === "file" && !/cover ?letter/i.test(field.label));
    await saveJob(tabId, { step: "Filling the form…", llmCalls: map.llmCalls });
    const [resume, letter] = await Promise.all([
      wantsResume ? resumeFile() : Promise.resolve(null),
      wantsCoverLetter ? api<{ fileName: string; pdfBase64: string }>("POST", "cover-letter", { applicationId: job.application.id }).catch(() => null) : Promise.resolve(null),
    ]);
    const { autoSubmit } = await settings();
    const plan: FillPlan = { ats: scan.ats, useServerSchema: scan.useServerSchema, answers: map.answers, resume, coverLetter: letter ? { name: letter.fileName, mime: "application/pdf", base64: letter.pdfBase64 } : null, autoSubmit };
    const report = await send<FillReport>(tabId, { type: "fill", plan });
    const step = report.captcha
      ? "A CAPTCHA is on the page. Solve it, then press Submit. Unnepo never solves CAPTCHAs."
      : report.needsYou.length
        ? `Filled ${report.filled.length} fields. ${report.needsYou.length} still need you, highlighted below.`
        : report.submitted
          ? "Filled and submitted. Waiting for the site to confirm…"
          : `Filled ${report.filled.length} fields in ${(report.ms / 1000).toFixed(1)}s. Check the form, then press Submit on the page.`;
    await saveJob(tabId, { report, step });
  } catch (error) {
    await saveJob(tabId, { error: error instanceof Error ? error.message : "Something went wrong.", step: "Stopped." });
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
      case "set-auto-submit":
        await chrome.storage.local.set({ autoSubmit: Boolean(message.value) });
        return reply({ ok: true });
      case "fill":
        void fill(Number(message.tabId));
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
        if (tabId === undefined) return reply({ ok: false });
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

chrome.tabs.onRemoved.addListener((tabId) => void saveJob(tabId, null));
chrome.tabs.onActivated.addListener(() => void chrome.runtime.sendMessage({ type: "state-changed" }).catch(() => undefined));
void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
