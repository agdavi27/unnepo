import type { Browser, Locator, Page } from "playwright-core";
import { ServiceError } from "@/lib/errors";
import type { ApplicationQuestion, Confirmation, FillReport } from "@/lib/apply/types";

/**
 * Application autofill runs in a Browserbase browser so it can stay open between steps: Unnepo fills
 * the form, the student checks it (and does any CAPTCHA) in the live view, then approves the submit.
 * Unnepo never solves CAPTCHAs, never creates accounts, and never submits without approval.
 */

const API = "https://api.browserbase.com/v1";

function config() {
  const apiKey = process.env.BROWSERBASE_API_KEY?.trim() || "";
  const projectId = process.env.BROWSERBASE_PROJECT_ID?.trim() || "";
  return apiKey && projectId ? { apiKey, projectId } : null;
}

export function browserReady() {
  return Boolean(config());
}

function requireConfig() {
  const current = config();
  if (!current) {
    throw new ServiceError("Autofill isn't connected yet. Add BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID in Vercel to turn it on. Nothing was submitted.", "browser_not_configured", 503);
  }
  return current;
}

async function bb<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { apiKey } = requireConfig();
  const response = await fetch(`${API}${path}`, { ...init, headers: { "Content-Type": "application/json", "X-BB-API-Key": apiKey, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 200);
    throw new ServiceError(`The autofill browser couldn't start (${response.status}). ${detail}`.trim(), "browser_failed", 502);
  }
  return (await response.json()) as T;
}

/** A browser that stays open for up to 30 minutes so the student can review before submitting. */
export async function createBrowserSession() {
  const { projectId } = requireConfig();
  const session = await bb<{ id: string; connectUrl?: string }>("/sessions", {
    method: "POST",
    body: JSON.stringify({ projectId, keepAlive: true, timeout: 1800, browserSettings: { solveCaptchas: false } }),
  });
  return session.id;
}

export async function liveViewUrl(sessionId: string) {
  const debug = await bb<{ debuggerFullscreenUrl?: string }>(`/sessions/${encodeURIComponent(sessionId)}/debug`).catch(() => null);
  return debug?.debuggerFullscreenUrl ?? null;
}

export async function releaseBrowserSession(sessionId: string) {
  const { projectId } = requireConfig();
  await bb(`/sessions/${encodeURIComponent(sessionId)}`, { method: "POST", body: JSON.stringify({ projectId, status: "REQUEST_RELEASE" }) }).catch(() => null);
}

/** Connects to an open session and hands back its page. The browser keeps running after disconnect. */
export async function withSessionPage<T>(sessionId: string, run: (page: Page) => Promise<T>): Promise<T> {
  const { apiKey } = requireConfig();
  const { chromium } = await import("playwright-core");
  let browser: Browser | null = null;
  try {
    browser = await chromium.connectOverCDP(`wss://connect.browserbase.com?apiKey=${encodeURIComponent(apiKey)}&sessionId=${encodeURIComponent(sessionId)}`, { timeout: 30_000 });
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());
    return await run(page);
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw new ServiceError("Lost the connection to the autofill browser. Try again. Nothing was submitted.", "browser_failed", 502);
  } finally {
    // Closing a CDP connection disconnects without ending a keepAlive session.
    await browser?.close().catch(() => undefined);
  }
}

export type ResumeFile = { name: string; mimeType: string; buffer: Buffer };

function cssAttr(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Finds the form control for a question: by id, then name, then its visible label. */
async function locate(page: Page, question: ApplicationQuestion): Promise<Locator | null> {
  const candidates = [
    page.locator(`[id="${cssAttr(question.key)}"]`),
    page.locator(`[name="${cssAttr(question.key)}"]`),
    page.getByLabel(question.label.replace(/\s*\*$/, ""), { exact: true }),
    page.getByLabel(question.label.replace(/\s*\*$/, "").slice(0, 80), { exact: false }),
  ];
  for (const candidate of candidates) {
    if ((await candidate.count().catch(() => 0)) > 0) return candidate.first();
  }
  return null;
}

const YES = /^(yes|true|y|1|i agree|agree)$/i;

async function setValue(page: Page, field: Locator, question: ApplicationQuestion, answer: string, resume: ResumeFile | null) {
  if (question.kind === "file") {
    if (!resume) throw new Error("no resume file");
    await field.setInputFiles({ name: resume.name, mimeType: resume.mimeType, buffer: resume.buffer });
    return;
  }
  const tag = await field.evaluate((el) => el.tagName.toLowerCase());
  const type = ((await field.getAttribute("type")) || "").toLowerCase();
  const role = ((await field.getAttribute("role")) || "").toLowerCase();
  if (tag === "select") {
    await field.selectOption({ label: answer });
    return;
  }
  if (type === "checkbox") {
    if (YES.test(answer)) await field.check();
    else await field.uncheck();
    return;
  }
  if (type === "radio") {
    const option = page.getByLabel(answer, { exact: true });
    if ((await option.count()) === 0) throw new Error("option not found");
    await option.first().check();
    return;
  }
  if (role === "combobox" || (await field.getAttribute("aria-autocomplete"))) {
    // Searchable dropdowns: type the option, then pick the highlighted match.
    await field.click();
    await field.fill(answer);
    await page.waitForTimeout(400);
    const exact = page.getByRole("option", { name: answer, exact: true });
    if ((await exact.count()) > 0) await exact.first().click();
    else await field.press("Enter");
    return;
  }
  await field.fill(answer);
}

/** Labels of required fields still empty on the page, including ones the job board didn't publish ahead of time. */
async function emptyRequiredLabels(page: Page) {
  return page.evaluate(() => {
    const out: string[] = [];
    const fields = Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input[required], textarea[required], select[required], [aria-required='true']"));
    for (const field of fields) {
      const type = (field.getAttribute("type") || "").toLowerCase();
      if (type === "hidden" || type === "submit") continue;
      const style = window.getComputedStyle(field);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const empty = type === "checkbox" || type === "radio"
        ? !document.querySelector(`input[name="${CSS.escape(field.getAttribute("name") || "")}"]:checked`)
        : type === "file" ? !(field as HTMLInputElement).files?.length : !String((field as HTMLInputElement).value || "").trim();
      if (!empty) continue;
      const id = field.getAttribute("id");
      const label = (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent) || field.closest("label")?.textContent || field.getAttribute("aria-label") || field.getAttribute("placeholder") || field.getAttribute("name") || "A required field";
      out.push(label.replace(/\s+/g, " ").replace(/\*$/, "").trim().slice(0, 140));
    }
    return [...new Set(out)];
  });
}

/** Fills every answered question. Never clicks submit. */
export async function fillApplicationForm(page: Page, applicationUrl: string, questions: ApplicationQuestion[], resume: ResumeFile | null): Promise<Omit<FillReport, "liveViewUrl" | "screenshotAt">> {
  await page.goto(applicationUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
  // Lever and some boards show the job first and the form behind an "Apply" button.
  if ((await page.locator("form input, form textarea").count()) === 0) {
    const apply = page.getByRole("link", { name: /^apply( for this job| now)?$/i }).or(page.getByRole("button", { name: /^apply( for this job| now)?$/i }));
    if ((await apply.count()) > 0) {
      await apply.first().click();
      await page.waitForLoadState("domcontentloaded").catch(() => undefined);
      await page.waitForTimeout(1000);
    }
  }
  const filled: string[] = [];
  const failed: Array<{ label: string; reason: string }> = [];
  for (const question of questions) {
    const answer = question.answer?.trim();
    if (!answer) continue;
    const field = await locate(page, question);
    if (!field) {
      failed.push({ label: question.label, reason: "Couldn't find this field on the form." });
      continue;
    }
    try {
      await setValue(page, field, question, answer, resume);
      filled.push(question.label);
    } catch (error) {
      failed.push({ label: question.label, reason: error instanceof Error && /no resume/.test(error.message) ? "Upload a resume in Settings first." : "Couldn't fill this field. Fill it in the live view." });
    }
  }
  for (const label of await emptyRequiredLabels(page)) {
    if (!failed.some((item) => item.label === label) && !filled.includes(label)) failed.push({ label, reason: "Required. Fill it in the live view." });
  }
  return { filled, failed };
}

const CONFIRM_TEXT = /(thank(s| you) for (applying|your application|your interest|submitting)|application (has been |was )?(successfully )?(submitted|received|sent)|we(?:'|’)?ve received your application|successfully (submitted|applied)|your application is (in|complete))/i;

/** Looks for the site's own confirmation. Returns null unless the page clearly says the application went through. */
export async function detectConfirmation(page: Page): Promise<Confirmation | null> {
  const url = page.url();
  const text = (await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "")).replace(/\s+/g, " ");
  const match = text.match(CONFIRM_TEXT);
  const errors = await page.locator("[aria-invalid='true'], .error:visible, [role='alert']:visible").count().catch(() => 0);
  if (match && !errors) {
    const start = Math.max(0, (match.index ?? 0) - 60);
    return { url, text: text.slice(start, start + 240).trim(), detectedAt: new Date().toISOString() };
  }
  return null;
}

/** Clicks the form's submit button once and waits for the site's confirmation. */
export async function submitAndConfirm(page: Page): Promise<Confirmation | null> {
  const submit = page
    .locator("button[type='submit'], input[type='submit']")
    .or(page.getByRole("button", { name: /^(submit( application)?|send application|apply)$/i }));
  if ((await submit.count()) === 0) throw new ServiceError("Couldn't find the form's submit button. Submit it in the live view, then press Check again.", "submit_missing", 409);
  await submit.first().click();
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(1500);
    const confirmation = await detectConfirmation(page);
    if (confirmation) return confirmation;
  }
  return null;
}
