import type { Browser, Locator, Page } from "playwright-core";
import { ServiceError } from "@/lib/errors";
import { bestOption } from "@/lib/apply/options";
import { answerChoices } from "@/lib/apply/questions";
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
  await bb(`/sessions/${encodeURIComponent(sessionId)}`, { method: "POST", body: JSON.stringify({ status: "REQUEST_RELEASE" }) }).catch(() => null);
}

/** Connects to an open session and hands back its page. The browser keeps running after disconnect. */
export async function withSessionPage<T>(sessionId: string, run: (page: Page) => Promise<T>): Promise<T> {
  // Each session has its own connect URL; Browserbase returns it with the session.
  const session = await bb<{ status?: string; connectUrl?: string }>(`/sessions/${encodeURIComponent(sessionId)}`);
  if (session.status !== "RUNNING" || !session.connectUrl) {
    throw new ServiceError("The autofill browser for this application has closed. Run autofill again, or if you submitted it yourself, press I applied.", "browser_closed", 409);
  }
  const { chromium } = await import("playwright-core");
  let browser: Browser | null = null;
  try {
    browser = await chromium.connectOverCDP(session.connectUrl, { timeout: 30_000 });
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());
    return await run(page);
  } catch (error) {
    if (error instanceof ServiceError || error instanceof AutofillStopped) throw error;
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

/** Clicks through Workday-style invisible click layers when a normal click is blocked. */
async function clickSmart(page: Page, target: Locator) {
  const label = (await target.getAttribute("aria-label", { timeout: 2_000 }).catch(() => null)) || (await target.innerText({ timeout: 2_000 }).catch(() => "")).trim();
  const overlay = label ? page.locator(`[data-automation-id='click_filter'][aria-label="${cssAttr(label)}"]`) : null;
  if (overlay && (await overlay.count()) > 0) {
    await overlay.first().click({ timeout: 5_000 });
    return;
  }
  try {
    await target.click({ timeout: 2_000 });
  } catch {
    await target.click({ force: true, timeout: 5_000 });
  }
}

/**
 * Opens a custom dropdown (a button that opens a listbox) once: reads its options, asks for an answer,
 * and picks it while the list is open. Closes the list when there's no answer.
 */
async function decideListbox(page: Page, field: Locator, decide: (options: string[]) => string | null) {
  await clickSmart(page, field);
  const list = page.locator("[role='listbox']:visible [role='option']");
  await list.first().waitFor({ timeout: 4_000 }).catch(() => undefined);
  const texts = (await list.allInnerTexts().catch(() => [])).map((text) => text.replace(/\s+/g, " ").trim());
  const options = texts.filter(Boolean);
  const answer = decide(options);
  const choice = answer ? bestOption(answer, texts) : null;
  if (!choice) {
    await page.keyboard.press("Escape").catch(() => undefined);
    return { options, answer, picked: false };
  }
  await list.nth(texts.indexOf(choice)).click();
  return { options, answer, picked: true };
}

async function pickListbox(page: Page, field: Locator, answer: string) {
  await clickSmart(page, field);
  const list = page.locator("[role='listbox']:visible [role='option']");
  await list.first().waitFor({ timeout: 4_000 });
  const texts = (await list.allInnerTexts()).map((text) => text.replace(/\s+/g, " ").trim());
  const choice = bestOption(answer, texts);
  if (!choice) {
    await page.keyboard.press("Escape").catch(() => undefined);
    throw new Error("option not found");
  }
  await list.nth(texts.indexOf(choice)).click();
}

/** Workday's searchable prompts ("How did you hear about us?"): type, then pick the matching result. */
async function pickPrompt(page: Page, field: Locator, answer: string) {
  const options = page.locator("[data-automation-id='promptOption']:visible, [role='option']:visible");
  // Sites word the same choice differently ("Company Website", "Careers Site"); try a few.
  for (const attempt of answerChoices(answer).slice(0, 6)) {
    await field.click();
    await field.fill(attempt);
    await field.press("Enter");
    await options.first().waitFor({ timeout: 2_500 }).catch(() => undefined);
    await page.waitForTimeout(250);
    const texts = (await options.allInnerTexts().catch(() => [])).map((text) => text.replace(/\s+/g, " ").trim());
    const choice = bestOption(attempt, texts) ?? (texts.length === 1 && !/no (items|results|matches)/i.test(texts[0]) ? texts[0] : null);
    if (choice) {
      await options.nth(texts.indexOf(choice)).click();
      await page.waitForTimeout(200);
      return;
    }
  }
  await field.fill("").catch(() => undefined);
  throw new Error("option not found");
}

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
    const labels = (await field.locator("option").allInnerTexts()).map((text) => text.trim());
    const choice = bestOption(answer, labels);
    if (!choice) throw new Error("option not found");
    await field.selectOption({ label: choice });
    return;
  }
  if (tag === "button" && (await field.getAttribute("aria-haspopup")) === "listbox") {
    await pickListbox(page, field, answer);
    return;
  }
  if ((await field.getAttribute("data-automation-id")) === "searchBox" || (await field.evaluate((el) => Boolean(el.closest("[data-automation-id='multiselectInputContainer']"))))) {
    await pickPrompt(page, field, answer);
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
    await page.getByRole("option").first().waitFor({ timeout: 1_500 }).catch(() => undefined);
    const exact = page.getByRole("option", { name: answer, exact: true });
    if ((await exact.count()) > 0) await exact.first().click();
    else await field.press("Enter");
    return;
  }
  await field.fill(answer);
}

/**
 * Page-side helpers, installed once per page: the question a control asks (walking up the page when
 * the label is missing or is only a format like "MM/YYYY"), the section it sits in, and whether it's
 * still empty. Plain JavaScript so the bundler can't rewrite it.
 */
const PAGE_HELPERS = `(() => {
  if (window.__unnepo) return;
  const clean = (t) => (t || "").replace(/\\s+/g, " ").replace(/\\b(select one|required)\\b/gi, "").replace(/\\*/g, "").trim();
  const machine = (t) => !/\\s/.test(t) && /[\\[\\]_]/.test(t);
  const formatOnly = /^(mm\\/yyyy|mm\\/dd\\/yyyy|dd\\/mm\\/yyyy|yyyy|mm|month|year|select|search|choose|type to search)$/i;
  const byIds = (ids) => ids.split(/\\s+/).map((i) => document.getElementById(i)?.textContent || "").join(" ");
  const optionText = (node) => {
    const parts = [];
    node.querySelectorAll("option, [role=option]").forEach((o) => parts.push(o.textContent || ""));
    node.querySelectorAll("input[type=radio], input[type=checkbox]").forEach((r) => {
      const l = (r.id && document.querySelector('label[for="' + CSS.escape(r.id) + '"]')) || r.closest("label");
      if (l) parts.push(l.textContent || "");
    });
    return parts.map(clean).filter(Boolean);
  };
  const ownText = (node) => {
    let text = clean(node.innerText || "");
    for (const part of optionText(node)) if (part) text = text.split(part).join(" ");
    return clean(text);
  };
  const controls = "input:not([type=hidden]), select, textarea, button[aria-haspopup]";
  // A radio button's own label is its option ("Yes"); the question is the text around the whole group.
  const groupQuestion = (el) => {
    const group = el.closest("[role=radiogroup], fieldset");
    const named = group && (clean(group.querySelector("legend")?.textContent) || (group.getAttribute("aria-labelledby") && clean(byIds(group.getAttribute("aria-labelledby")))) || clean(group.getAttribute("aria-label")));
    if (named) return named.slice(0, 300);
    const radios = el.name ? Array.from(document.querySelectorAll('input[type=radio][name="' + CSS.escape(el.name) + '"]')) : [el];
    let node = el.parentElement;
    for (let depth = 0; node && node !== document.body && depth < 8; depth += 1, node = node.parentElement) {
      if (!radios.every((r) => node.contains(r))) continue;
      // Past the group's own block: the text would be a whole section, not this question.
      if (node.querySelectorAll(controls).length > radios.length + 3) break;
      const text = ownText(node);
      if (text.length >= 3) return text.slice(0, 300);
    }
    return "";
  };
  const questionText = (el) => {
    if ((el.getAttribute("type") || "").toLowerCase() === "radio" || el.getAttribute("role") === "radiogroup") {
      const asked = el.getAttribute("role") === "radiogroup" ? groupQuestion(el.querySelector("input[type=radio]") || el) : groupQuestion(el);
      if (asked) return asked;
    }
    const id = el.getAttribute("id");
    const labelledBy = el.getAttribute("aria-labelledby");
    const direct = [
      id && document.querySelector('label[for="' + CSS.escape(id) + '"]')?.textContent,
      labelledBy && byIds(labelledBy),
      el.closest("[data-automation-id^='formField']")?.querySelector("label")?.textContent,
      el.closest("label")?.textContent,
      el.getAttribute("aria-label"),
      el.closest("fieldset")?.querySelector("legend")?.textContent,
    ].map(clean).find((t) => t && t.length > 1 && !machine(t));
    if (direct && !formatOnly.test(direct)) return direct.slice(0, 300);
    let node = el.parentElement;
    for (let depth = 0; node && node !== document.body && depth < 6; depth += 1, node = node.parentElement) {
      if (node.querySelectorAll(controls).length > 6) break;
      const text = ownText(node);
      if (text.length >= 3 && !formatOnly.test(text)) return (direct ? text + " (" + direct + ")" : text).slice(0, 300);
    }
    const hint = direct || clean(el.getAttribute("placeholder"));
    if (hint) return hint;
    const name = el.getAttribute("name") || "";
    return clean(name.replace(/[\\[\\]_.]+/g, " "));
  };
  const heading = "h1, h2, h3, h4, h5, legend, [role=heading], [data-automation-id*='Header' i]";
  const section = (el) => {
    let node = el;
    for (let depth = 0; node && node !== document.body && depth < 12; depth += 1, node = node.parentElement) {
      let sib = node.previousElementSibling;
      for (let hops = 0; sib && hops < 25; hops += 1, sib = sib.previousElementSibling) {
        const found = sib.matches(heading) ? sib : Array.from(sib.querySelectorAll(heading)).pop();
        const text = clean(found?.textContent);
        if (text && text.length < 90) return text;
      }
    }
    return "";
  };
  const blank = /^(select one|select|choose( one)?|please select|--.*|)$/i;
  const isEmpty = (el) => {
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (el.tagName === "BUTTON") return blank.test(clean(el.innerText));
    if (el.tagName === "SELECT") return !el.value || blank.test(clean(el.selectedOptions[0]?.textContent));
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      if (type === "checkbox") return !el.checked;
      if (type === "radio") return !document.querySelector('input[type=radio][name="' + CSS.escape(el.name) + '"]:checked');
      if (type === "file") return !el.files?.length;
      return !String(el.value || "").trim();
    }
    // A wrapper marked required: look at what's inside it.
    if (el.querySelector("[data-automation-id='selectedItem']")) return false;
    const radios = el.querySelectorAll("input[type=radio]");
    if (radios.length) return !Array.from(radios).some((r) => r.checked);
    const inner = Array.from(el.querySelectorAll("input:not([type=hidden]), select, textarea, button[aria-haspopup]"));
    if (inner.length) return inner.every((c) => isEmpty(c));
    return false;
  };
  window.__unnepo = { questionText, section, isEmpty };
})()`;

async function helpers(page: Page) {
  await page.evaluate(PAGE_HELPERS).catch(() => undefined);
}

type PageHelpers = { questionText: (el: Element) => string; section: (el: Element) => string; isEmpty: (el: Element) => boolean };

/** A required control still empty on the page, with what Unnepo needs to fill it. */
export type EmptyField = { selector: string; label: string; section: string; control: "text" | "textarea" | "select" | "listbox" | "prompt" | "checkbox" | "radio" | "date" | "file"; options: string[]; format: string | null };

/** Required controls still empty, including ones the job board didn't publish ahead of time. */
async function emptyRequired(page: Page): Promise<EmptyField[]> {
  await helpers(page);
  return page.evaluate(() => {
    const u = (window as unknown as { __unnepo: PageHelpers }).__unnepo;
    const out: EmptyField[] = [];
    const seenRadio = new Set<string>();
    const nodes = Array.from(document.querySelectorAll<HTMLElement>("input[required], textarea[required], select[required], [aria-required='true'], [role='radiogroup'][aria-required='true']"));
    nodes.forEach((el, index) => {
      const type = (el.getAttribute("type") || "").toLowerCase();
      if (["hidden", "submit", "button", "password"].includes(type) || el.getAttribute("data-automation-id") === "beecatcher" || el.getAttribute("aria-hidden") === "true") return;
      // A wrapper whose required control is also listed is counted once, by the control.
      if (!["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(el.tagName) && el.querySelector("input[required], select[required], textarea[required]")) return;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (style.display === "none" || style.visibility === "hidden" || (!rect.width && !rect.height && type !== "file" && type !== "radio" && type !== "checkbox")) return;
      if (!u.isEmpty(el)) return;
      const radioName = type === "radio" ? (el as HTMLInputElement).name : "";
      if (radioName) {
        if (seenRadio.has(radioName)) return;
        seenRadio.add(radioName);
      }
      const radios = radioName ? Array.from(document.querySelectorAll<HTMLInputElement>(`input[type=radio][name="${CSS.escape(radioName)}"]`)) : Array.from(el.querySelectorAll<HTMLInputElement>("input[type=radio]"));
      const labelOf = (input: HTMLInputElement) => ((input.id && document.querySelector(`label[for="${CSS.escape(input.id)}"]`)?.textContent) || input.closest("label")?.textContent || input.value || "").replace(/\s+/g, " ").trim();
      const control: EmptyField["control"] = radios.length ? "radio"
        : el.tagName === "SELECT" ? "select"
          : el.tagName === "BUTTON" ? "listbox"
            : el.tagName === "TEXTAREA" ? "textarea"
              : type === "checkbox" ? "checkbox"
                : type === "file" ? "file"
                  : type === "date" ? "date"
                    : el.getAttribute("data-automation-id") === "searchBox" || el.getAttribute("role") === "combobox" ? "prompt" : "text";
      const options = control === "select" ? Array.from((el as HTMLSelectElement).options).map((o) => o.text.trim()).filter((t) => t && !/^(select|choose|please select|--)/i.test(t))
        : control === "radio" ? radios.map(labelOf).filter(Boolean)
          : control === "checkbox" ? ["Yes"] : [];
      const target = radioName ? radios[0] : el;
      target.setAttribute("data-unnepo-empty", String(index));
      const placeholder = el.getAttribute("placeholder") || "";
      out.push({ selector: `[data-unnepo-empty="${index}"]`, label: u.questionText(target).slice(0, 300) || "A required field", section: u.section(target), control, options: options.slice(0, 60), format: /[my]{2}|dd/i.test(placeholder) ? placeholder : null });
    });
    return out;
  });
}

/**
 * What the student has entered on the form, by question: read before Unnepo continues or submits, so an
 * answer typed once in the live view is saved and used on every later application. Skips passwords,
 * files, numbered work/education entries, and long job-specific essays.
 */
export async function readFormAnswers(page: Page): Promise<Array<{ label: string; section: string; value: string }>> {
  await helpers(page);
  return page.evaluate(() => {
    const u = (window as unknown as { __unnepo: PageHelpers }).__unnepo;
    const out: Array<{ label: string; section: string; value: string }> = [];
    const seen = new Set<string>();
    const push = (el: Element, value: string) => {
      const label = u.questionText(el);
      const section = u.section(el);
      const clean = value.replace(/\s+/g, " ").trim();
      if (!label || !clean || clean.length > 400 || seen.has(label) || /^(select one|select|choose|please select)$/i.test(clean)) return;
      if (/\[\d+\]/.test(el.getAttribute("name") || "") || /\b(experience|employment|education|work history)\b.*\d/i.test(section)) return;
      seen.add(label);
      out.push({ label: label.slice(0, 200), section, value: clean });
    };
    for (const el of Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select"))) {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (["hidden", "password", "file", "submit", "button", "search", "image", "reset"].includes(type) || el.getAttribute("data-automation-id") === "beecatcher" || el.getAttribute("aria-hidden") === "true") continue;
      if (type === "radio") {
        if ((el as HTMLInputElement).checked) {
          const option = ((el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent) || el.closest("label")?.textContent || (el as HTMLInputElement).value || "").trim();
          push(el, option);
        }
        continue;
      }
      if (type === "checkbox") continue;
      if (el.tagName === "SELECT") push(el, (el as HTMLSelectElement).selectedOptions[0]?.textContent || "");
      else push(el, (el as HTMLInputElement).value || "");
    }
    for (const button of Array.from(document.querySelectorAll<HTMLElement>("button[aria-haspopup='listbox']"))) push(button, button.innerText || "");
    for (const item of Array.from(document.querySelectorAll<HTMLElement>("[data-automation-id='selectedItem']"))) {
      const field = item.closest("[data-automation-id^='formField']")?.querySelector("input");
      if (field) push(field, item.innerText || "");
    }
    return out;
  });
}

/** The site's own error messages on the page. */
async function siteErrors(page: Page) {
  const texts = await page.locator("[data-automation-id='errorMessage'], [role='alert']:visible, .error:visible, [class*='error' i]:visible:not(input):not(select)").allInnerTexts().catch(() => []);
  return [...new Set(texts.map((text) => text.replace(/\s+/g, " ").trim()).filter((text) => text && text.length < 300))].slice(0, 12);
}

/** Puts a decided answer into an empty required control, whatever kind of control it is. */
async function applyFix(page: Page, field: EmptyField, value: string) {
  const target = page.locator(field.selector).first();
  switch (field.control) {
    case "radio": {
      const name = await target.getAttribute("name");
      const radios = name ? page.locator(`input[type="radio"][name="${cssAttr(name)}"]`) : target.locator("input[type=radio]");
      const labels = await radios.evaluateAll((inputs) => inputs.map((input) => (((input as HTMLInputElement).id && document.querySelector(`label[for="${CSS.escape((input as HTMLInputElement).id)}"]`)?.textContent) || input.closest("label")?.textContent || (input as HTMLInputElement).value || "").replace(/\s+/g, " ").trim()));
      const choice = bestOption(value, labels);
      if (!choice) throw new Error("option not found");
      await radios.nth(labels.indexOf(choice)).check({ force: true });
      return;
    }
    case "select": {
      const labels = (await target.locator("option").allInnerTexts()).map((text) => text.trim());
      const choice = bestOption(value, labels);
      if (!choice) throw new Error("option not found");
      await target.selectOption({ label: choice });
      return;
    }
    case "listbox":
      await pickListbox(page, target, value);
      return;
    case "prompt":
      await pickPrompt(page, target, value);
      return;
    case "checkbox":
      if (YES.test(value)) await target.check({ force: true });
      return;
    case "file":
      throw new Error("file");
    default:
      await target.fill(value);
      await target.blur().catch(() => undefined);
  }
}

export type Credentials = { email: string; password: string };

export type FlowOptions = {
  url: string;
  /** false continues on the page the browser is already on (after the student verified an email or finished a step). */
  navigate: boolean;
  questions: ApplicationQuestion[];
  resume: ResumeFile | null;
  credentials: Credentials | null;
  /** The student agreed to let Unnepo create job-site accounts and accept their candidate terms. */
  allowSignup: boolean;
  /** True once the student pressed Stop. Checked between fields and pages. */
  shouldStop?: () => Promise<boolean>;
  /** Answers for fields the job board didn't publish ahead of time, matched by label. Null leaves the field for the student. */
  answerFor: (label: string, kind: ApplicationQuestion["kind"], options: string[], where?: { section?: string; format?: string | null }) => string | null;
  /**
   * Last resort for required fields still empty after everything else: decides an answer for each from
   * the student's details, saved answers, and resume. Returns answers by index, with why, for the student to check.
   */
  fixFields?: (fields: EmptyField[], siteErrors: string[]) => Promise<Array<{ index: number; value: string; why: string }>>;
  /** A cover letter written for this job from the resume, as text and as a PDF. Asked for only when the form wants one. */
  coverLetter?: () => Promise<{ text: string; file: ResumeFile } | null>;
  /** Answers, by label, for questions nothing on file covers, written only from the student's resume and profile. */
  aiAnswers?: (questions: Array<{ label: string; section: string; kind: ApplicationQuestion["kind"]; options: string[] }>) => Promise<Record<string, string>>;
};

export type FlowResult = Omit<FillReport, "liveViewUrl" | "screenshotAt"> & { stoppedAt: NonNullable<FillReport["stoppedAt"]>; host: string };

/** Thrown when the student stops autofill. */
export class AutofillStopped extends Error {
  constructor() {
    super("stopped");
  }
}

const MAX_PAGES = 10;

const COVER_LETTER = /cover ?letter|letter of (interest|motivation)|motivation(al)? letter/i;

/** Job systems that host a company's applications on their own domain. */
const ATS_DOMAINS = ["myworkdayjobs.com", "myworkdaysite.com", "workday.com", "icims.com", "taleo.net", "successfactors.com", "successfactors.eu", "sapsf.com", "oraclecloud.com", "greenhouse.io", "lever.co", "ashbyhq.com", "smartrecruiters.com", "jobvite.com", "brassring.com", "ultipro.com", "ukg.com", "paylocity.com", "adp.com", "bamboohr.com", "workable.com", "recruitee.com", "breezy.hr", "jazzhr.com", "applytojob.com"];

function baseDomain(host: string) {
  return host.toLowerCase().split(".").slice(-2).join(".");
}

/** The password is only ever typed on the company's own site or the job system it uses. */
export function passwordAllowedOn(pageUrl: string, applicationUrl: string) {
  let page: URL;
  let start: URL;
  try {
    page = new URL(pageUrl);
    start = new URL(applicationUrl);
  } catch {
    return false;
  }
  if (page.protocol !== "https:" && !(page.hostname === "127.0.0.1" || page.hostname === "localhost")) return false;
  const host = page.hostname.toLowerCase();
  if (baseDomain(host) === baseDomain(start.hostname)) return true;
  return ATS_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

async function settle(page: Page) {
  await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => undefined);
  // Job sites keep connections open, so "network idle" often never comes; don't wait long for it.
  await page.waitForLoadState("networkidle", { timeout: 2_500 }).catch(() => undefined);
  if (/myworkday(jobs|site)\.com/.test(page.url())) {
    // Workday draws each step after the page loads: wait for its fields or buttons, not a fixed time.
    await page.locator("[data-automation-id^='formField'], [data-automation-id='bottom-navigation-next-button'], [data-automation-id='applyManually'], [data-automation-id='adventureButton'], input[type='password']").first().waitFor({ timeout: 6_000 }).catch(() => undefined);
    await page.waitForTimeout(400);
  } else {
    await page.waitForTimeout(250);
  }
}

async function visible(locator: Locator) {
  const count = await locator.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    if (await locator.nth(index).isVisible().catch(() => false)) return locator.nth(index);
  }
  return null;
}

/** Buttons inside the form that holds the password box, so a header "Sign In" link isn't clicked by mistake. */
function formButton(page: Page, name: RegExp) {
  const form = page.locator("form").filter({ has: page.locator("input[type='password']") });
  return form.getByRole("button", { name }).or(form.locator("button[type='submit']").filter({ hasText: name }));
}

function button(page: Page, name: RegExp) {
  return page.getByRole("button", { name }).or(page.getByRole("link", { name })).or(page.locator("input[type='submit']").filter({ hasText: name }));
}

async function bodyText(page: Page) {
  return (await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "")).replace(/\s+/g, " ");
}

const VERIFY_TEXT = /((verify|confirm|activate) your (email|account)|check your (email|inbox)|we(?:'|’)?ve sent (you )?an? (email|verification|link)|verification (email|link) (has been|was) sent)/i;
const SIGNIN_ERROR = /(invalid|incorrect|wrong) (email|password|username|credentials)|(account|user) (not found|does not exist|doesn(?:'|’)t exist)|no account (found|exists)|sign[- ]in failed/i;
const SAFE_CONSENT = /(agree|terms|privacy|consent|acknowledge|accept)/i;
/** "I have read the Applicant Privacy Notice and agree": covered when the student allowed Unnepo to accept candidate terms and privacy policies. */
const PRIVACY_ACK = /(privacy (notice|policy|statement|terms)|applicant (privacy|notice|terms)|candidate (privacy|terms)|terms (and|&) conditions|terms of (use|service)|data (privacy|protection|processing) (notice|policy|statement))/i;
const ACK_WORDS = /\b(read|understand|agree|acknowledge|accept|consent|reviewed)\b/i;
const NOT_CONSENT = /(marketing|newsletter|offers|promotion|sms|text messages?|job alerts?|talent community)/i;

/** "signup" when the page asks to create an account, "signin" when it asks to log in, null otherwise. */
async function authKind(page: Page): Promise<"signup" | "signin" | null> {
  const passwords = page.locator("input[type='password']");
  let shown = 0;
  for (let index = 0; index < (await passwords.count()); index += 1) if (await passwords.nth(index).isVisible().catch(() => false)) shown += 1;
  if (!shown) return null;
  // A single password box is a sign-in form even when a "Create Account" link sits next to it (Workday).
  return shown >= 2 ? "signup" : "signin";
}

async function emailField(page: Page) {
  return (
    (await visible(page.locator("input[type='email']"))) ??
    (await visible(page.getByLabel(/e-?mail/i))) ??
    (await visible(page.locator("input[name*='email' i], input[id*='email' i], input[autocomplete='username']")))
  );
}

async function fillPasswords(page: Page, password: string) {
  const passwords = page.locator("input[type='password']");
  for (let index = 0; index < (await passwords.count()); index += 1) {
    const field = passwords.nth(index);
    if (await field.isVisible().catch(() => false)) await field.fill(password);
  }
}

/** Ticks only terms and privacy boxes on a sign-up form, never marketing or job-alert opt-ins. */
async function acceptSignupTerms(page: Page) {
  const boxes = page.locator("input[type='checkbox']");
  for (let index = 0; index < (await boxes.count()); index += 1) {
    const box = boxes.nth(index);
    if (!(await box.isVisible().catch(() => false)) || (await box.isChecked().catch(() => true))) continue;
    const label = await box.evaluate((el) => {
      const id = el.getAttribute("id");
      return ((id && document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent) || el.closest("label")?.textContent || el.getAttribute("aria-label") || "").replace(/\s+/g, " ");
    });
    if (SAFE_CONSENT.test(label) && !NOT_CONSENT.test(label)) await box.check().catch(() => undefined);
  }
}

/** Opens the form from a job page: Apply, Apply now, or Workday's Apply Manually. */
async function openForm(page: Page, hasResume: boolean) {
  // Workday's start page: Autofill with Resume reads the resume into My Experience, so it's preferred.
  const starts = hasResume ? [/^apply( for this job| now)?$/i, /^autofill with resume$/i, /^apply manually$/i] : [/^apply( for this job| now)?$/i, /^apply manually$/i];
  for (const name of starts) {
    const formFields = await page.locator("input:visible:not([type='search']):not([type='hidden']):not([type='checkbox']), textarea:visible, select:visible").count();
    if (formFields >= 2 || (await authKind(page))) return;
    const entry = await visible(button(page, name));
    if (entry) {
      await clickSmart(page, entry).catch(() => undefined);
      await settle(page);
    }
  }
  // Workday hides the email and password boxes behind "Sign in with email".
  const withEmail = await visible(page.getByRole("button", { name: /^sign in with email$/i }));
  if (withEmail && !(await authKind(page))) {
    await clickSmart(page, withEmail);
    await settle(page);
  }
}

/** Buttons that move to the next step without submitting. */
const NEXT_BUTTON = /^(next|continue|save and continue|save & continue|save and next|continue to (the )?application|continue application|start (my |your )?application|begin application|proceed|next step|continue to next step)$/i;

/** Text-message and marketing opt-ins. Unnepo always answers no; the student can change it in the live view. */
const OPT_IN_QUESTION = /\b(sms|text (message|messages|messaging|communications?)|receiv(e|ing) (text|sms)|auto-?dialed|marketing|newsletter|job alerts?|talent community)\b/i;

type RadioGroup = { name: string; question: string; options: Array<{ label: string; value: string }>; required: boolean; selector: (value: string) => string };

/** Unanswered radio-button questions, with the question text found around them. */
async function scanRadioGroups(page: Page): Promise<RadioGroup[]> {
  await helpers(page);
  const groups = await page.evaluate(() => {
    const u = (window as unknown as { __unnepo: PageHelpers }).__unnepo;
    const byName = new Map<string, HTMLInputElement[]>();
    for (const radio of Array.from(document.querySelectorAll<HTMLInputElement>("input[type='radio']"))) {
      const name = radio.getAttribute("name");
      if (!name) continue;
      byName.set(name, [...(byName.get(name) ?? []), radio]);
    }
    const out: Array<{ name: string; question: string; options: Array<{ label: string; value: string }>; required: boolean }> = [];
    for (const [name, radios] of byName) {
      if (radios.some((radio) => radio.checked)) continue;
      const labelOf = (radio: HTMLInputElement) => ((radio.id && document.querySelector(`label[for="${CSS.escape(radio.id)}"]`)?.textContent) || radio.closest("label")?.textContent || radio.getAttribute("aria-label") || radio.value || "").replace(/\s+/g, " ").trim();
      const options = radios.map((radio) => ({ label: labelOf(radio), value: radio.value }));
      const question = u.questionText(radios[0]);
      const required = radios.some((radio) => radio.required) || Boolean(radios[0].closest("[aria-required='true'], [role='radiogroup'][aria-required='true']"));
      if (question) out.push({ name, question: question.replace(/\*/g, "").replace(/\s+/g, " ").trim().slice(0, 600), options, required });
    }
    return out;
  });
  return groups.map((group) => ({ ...group, selector: (value: string) => `input[type="radio"][name="${cssAttr(group.name)}"][value="${cssAttr(value)}"]` }));
}

function radioAnswer(group: RadioGroup, answerFor: FlowOptions["answerFor"]) {
  const labels = group.options.map((option) => option.label);
  if (OPT_IN_QUESTION.test(group.question)) return group.options.find((option) => /^no\b/i.test(option.label)) ?? null;
  const answer = answerFor(group.question, "select", labels);
  return answer ? group.options.find((option) => option.label.toLowerCase() === answer.toLowerCase()) ?? null : null;
}

type ScannedField = { selector: string; label: string; section: string; format: string | null; kind: ApplicationQuestion["kind"]; options: string[]; listbox: boolean; required: boolean };

/** Visible empty fields on the page, with their labels, for questions the job board didn't publish. */
async function scanFields(page: Page): Promise<ScannedField[]> {
  await helpers(page);
  return page.evaluate(() => {
    const u = (window as unknown as { __unnepo: PageHelpers }).__unnepo;
    const out: Array<{ selector: string; label: string; section: string; format: string | null; kind: "text" | "textarea" | "select" | "file" | "checkbox"; options: string[]; listbox: boolean; required: boolean }> = [];
    const fields = Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select, button[aria-haspopup='listbox']"));
    fields.forEach((field, index) => {
      const type = (field.getAttribute("type") || "text").toLowerCase();
      const listbox = field.tagName === "BUTTON";
      const container0 = field.closest("[data-automation-id^='formField']");
      const checkbox = type === "checkbox";
      if (!listbox && ["hidden", "submit", "button", "password", "radio", "image", "reset"].includes(type)) return;
      // Checkboxes only when required and unticked (an agreement on the page); everything else is the student's call.
      if (checkbox && ((field as HTMLInputElement).checked || !(field.hasAttribute("required") || field.getAttribute("aria-required") === "true" || /\*/.test(container0?.textContent || field.closest("label")?.textContent || "")))) return;
      // A searchable prompt that already has a choice shows it as a selected item.
      if (field.closest("[data-automation-id='multiselectInputContainer']") && container0?.querySelector("[data-automation-id='selectedItem']")) return;
      if (type === "search" && field.getAttribute("data-automation-id") !== "searchBox") return;
      // Hidden "beecatcher" style fields exist to catch bots; never touch them.
      if (field.getAttribute("data-automation-id") === "beecatcher" || field.getAttribute("aria-hidden") === "true" || /honeypot|bee-?catcher/i.test(field.getAttribute("name") || "")) return;
      const rect = field.getBoundingClientRect();
      const style = window.getComputedStyle(field);
      if ((!rect.width && !rect.height && type !== "file") || style.visibility === "hidden" || style.display === "none") return;
      if (!checkbox && (listbox ? !/^(select one|select|choose( one)?|)$/i.test((field as HTMLElement).innerText.trim()) : type === "file" ? (field as HTMLInputElement).files?.length : String(field.value || "").trim())) return;
      const container = field.closest("[data-automation-id^='formField']");
      const label = u.questionText(field);
      if (!label) return;
      field.setAttribute("data-unnepo-field", String(index));
      const required = field.hasAttribute("required") || field.getAttribute("aria-required") === "true" || /\*/.test(container?.querySelector("label")?.textContent || "");
      const kind = checkbox ? "checkbox" : field.tagName === "SELECT" || listbox ? "select" : field.tagName === "TEXTAREA" ? "textarea" : type === "file" ? "file" : "text";
      const options = checkbox ? ["Yes"] : field.tagName === "SELECT" ? Array.from((field as HTMLSelectElement).options).map((option) => option.text.trim()).filter((text) => text && !/^(select|choose|--)/i.test(text)) : [];
      const placeholder = field.getAttribute("placeholder") || "";
      out.push({ selector: `[data-unnepo-field="${index}"]`, label: label.slice(0, 200), section: u.section(field), format: /[my]{2}|dd/i.test(placeholder) ? placeholder : field.getAttribute("type") === "date" ? "YYYY-MM-DD" : null, kind, options, listbox, required });
    });
    return out;
  });
}

/**
 * Fills the application page by page: signs in or creates the student's account when a page asks for
 * one, fills what it knows, clicks Next, and stops at the final page before Submit. Never clicks Submit.
 */
export async function runApplicationFlow(page: Page, options: FlowOptions): Promise<FlowResult> {
  const startHost = new URL(options.url).hostname;
  // No single step may hang the run: a missing field fails fast and goes to the student instead.
  page.setDefaultTimeout(10_000);
  // Checking for Stop reads the database, so it's done at most once a second.
  let lastCheck = 0;
  const checkStop = async () => {
    if (!options.shouldStop || Date.now() - lastCheck < 1_000) return;
    lastCheck = Date.now();
    if (await options.shouldStop()) throw new AutofillStopped();
  };
  if (options.navigate) {
    await page.goto(options.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await settle(page);
  } else if (VERIFY_TEXT.test(await bodyText(page))) {
    // The student clicked the verification link in their inbox; open the application again and sign in.
    await page.goto(options.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await settle(page);
  }
  const filled = new Set<string>();
  const failed = new Map<string, string>();
  let account: FlowResult["account"] = null;
  let triedSignin = false;
  let resumeUploaded = false;
  /** Required questions Unnepo couldn't answer, with their options, so the student can answer them in Unnepo. */
  const ask = new Map<string, { kind: ApplicationQuestion["kind"]; options: string[] }>();
  /** Resume-based answers, kept for the whole run so a redrawn page doesn't ask again. */
  const aiKnown = new Map<string, string>();
  const askedAi = new Set<string>();
  const fromResume = new Set<string>();
  /** Answers the fix-up pass decided, with why, so the student can check them. */
  const decided = new Map<string, { answer: string; why: string }>();
  const fixTried = new Set<string>();
  // The letter is written at most once per run, the first time a form asks for one.
  let letter: { text: string; file: ResumeFile } | null | undefined;
  let letterUsed = false;
  const putLetter = async (field: Locator, kind: ApplicationQuestion["kind"]) => {
    if (letter === undefined) letter = options.coverLetter ? await options.coverLetter().catch(() => null) : null;
    if (!letter) return false;
    try {
      if (kind === "file") await field.setInputFiles({ name: letter.file.name, mimeType: letter.file.mimeType, buffer: letter.file.buffer });
      else await field.fill(letter.text);
    } catch {
      return false;
    }
    letterUsed = true;
    return true;
  };
  const letterResult = (label: string, ok: boolean, required: boolean, kind: ApplicationQuestion["kind"]) => {
    if (ok) {
      filled.add(label);
      failed.delete(label);
      ask.delete(label);
    } else if (required) {
      failed.set(label, "Couldn't write a cover letter for this. Add one in the live view.");
      if (kind !== "file") ask.set(label, { kind, options: [] });
    }
  };
  const privacyAck = (label: string, choices: string[]) => {
    if (!options.allowSignup || !PRIVACY_ACK.test(label) || !ACK_WORDS.test(label) || NOT_CONSENT.test(label) || /\b(certify|attest|true and (complete|accurate)|background|non-?compete|arbitration)\b/i.test(label)) return null;
    return choices.length ? choices.find((choice) => /^(yes|i agree|agree|i accept|accept|i acknowledge|acknowledged?)\b/i.test(choice)) ?? null : "Yes";
  };
  const answerOf = (label: string, kind: ApplicationQuestion["kind"], choices: string[], where?: { section?: string; format?: string | null }) => options.answerFor(label, kind, choices, where) ?? aiKnown.get(label) ?? aiKnown.get(label.slice(0, 160)) ?? (kind === "checkbox" || kind === "select" ? privacyAck(label, kind === "checkbox" ? [] : choices) : null);
  const host = () => {
    try {
      return new URL(page.url()).hostname;
    } catch {
      return startHost;
    }
  };
  const done = (stoppedAt: FlowResult["stoppedAt"], pages: number): FlowResult => ({
    filled: [...filled],
    failed: [...failed].map(([label, reason]) => ({ label, reason })),
    stoppedAt,
    pages,
    account,
    host: host(),
    coverLetter: letterUsed && letter ? letter.text : undefined,
    fromResume: [...fromResume].filter((label) => filled.has(label)),
    decided: [...decided].map(([label, item]) => ({ label, ...item })),
    pending: [...ask].filter(([label]) => failed.has(label)).map(([label, item]) => ({ label, kind: item.kind, options: item.options })).slice(0, 25),
  });

  for (let pageIndex = 1; pageIndex <= MAX_PAGES; pageIndex += 1) {
    lastCheck = 0;
    await checkStop();
    await openForm(page, Boolean(options.resume));
    if (VERIFY_TEXT.test(await bodyText(page)) && !(await authKind(page))) return done("email_verification", pageIndex);

    const auth = await authKind(page);
    if (auth) {
      if (!options.credentials) return done("needs_account", pageIndex);
      if (!passwordAllowedOn(page.url(), options.url)) {
        failed.set("Account sign-in", `This page (${host()}) isn't the job site, so Unnepo didn't enter your password. Sign in in the live view.`);
        return done("needs_input", pageIndex);
      }
      if (auth === "signin" && !triedSignin) {
        triedSignin = true;
        const email = await emailField(page);
        if (email) await email.fill(options.credentials.email);
        await fillPasswords(page, options.credentials.password);
        const submit = (await visible(formButton(page, /^(sign in|log ?in|continue|next|submit)$/i))) ?? (await visible(button(page, /^(sign in|log ?in|continue|next|submit)$/i)));
        if (!submit) return done("signin_failed", pageIndex);
        await clickSmart(page, submit);
        await settle(page);
        if (!(await authKind(page))) {
          account = "signed_in";
          continue;
        }
        if (!SIGNIN_ERROR.test(await bodyText(page))) return done("signin_failed", pageIndex);
        // No account yet: switch to the create-account form.
        const create = await visible(button(page, /^(create (an )?account|sign up|register|new user\??)$/i));
        if (!create || !options.allowSignup) return done(options.allowSignup ? "signin_failed" : "needs_account", pageIndex);
        await clickSmart(page, create);
        await settle(page);
        continue;
      }
      if (auth === "signin") return done("signin_failed", pageIndex);
      if (!options.allowSignup) return done("needs_account", pageIndex);
      const email = await emailField(page);
      if (!email) return done("needs_input", pageIndex);
      await email.fill(options.credentials.email);
      await fillPasswords(page, options.credentials.password);
      await acceptSignupTerms(page);
      const create = (await visible(formButton(page, /^(create (an )?account|sign up|register|create|continue|submit)$/i))) ?? (await visible(button(page, /^(create (an )?account|sign up|register|create|continue|submit)$/i)));
      if (!create) return done("needs_input", pageIndex);
      await clickSmart(page, create);
      await settle(page);
      if (await authKind(page)) {
        const text = await bodyText(page);
        if (/already (exists|registered|in use)/i.test(text) && !triedSignin) {
          // An account exists already; go back to sign in with the same password.
          const signin = await visible(button(page, /^(sign in|log ?in)$/i));
          if (signin) {
            await clickSmart(page, signin);
            await settle(page);
            continue;
          }
        }
        failed.set("Create account", "The site didn't accept the new account. Finish it in the live view.");
        return done("needs_input", pageIndex);
      }
      account = "created";
      if (VERIFY_TEXT.test(await bodyText(page))) return done("email_verification", pageIndex);
      continue;
    }

    // Questions the job board published ahead of time.
    for (const question of options.questions) {
      const answer = question.answer?.trim();
      if (!answer && !filled.has(question.label) && COVER_LETTER.test(question.label) && (question.kind === "file" || question.kind === "textarea")) {
        await checkStop();
        const field = await locate(page, question);
        if (field && (question.kind === "file" || (await field.isVisible().catch(() => false)))) letterResult(question.label, await putLetter(field, question.kind), question.required, question.kind);
        continue;
      }
      if (!answer || filled.has(question.label)) continue;
      await checkStop();
      if (question.kind === "file" && resumeUploaded) continue;
      const field = await locate(page, question);
      // File inputs are usually hidden behind a styled button, so only other fields must be visible.
      if (!field || (question.kind !== "file" && !(await field.isVisible().catch(() => false)))) continue;
      try {
        await setValue(page, field, question, answer, options.resume);
        filled.add(question.label);
        failed.delete(question.label);
        if (question.kind === "file") resumeUploaded = true;
      } catch (error) {
        failed.set(question.label, error instanceof Error && /no resume/.test(error.message) ? "Upload a resume in Settings first." : "Couldn't fill this field. Fill it in the live view.");
      }
    }
    // Everything else on the page, matched by label to what Unnepo knows for sure.
    const pageText = await bodyText(page);
    /** Questions on this page nothing on file answers yet, for one resume-based AI pass. */
    const unknown = new Map<string, { section: string; kind: ApplicationQuestion["kind"]; options: string[] }>();
    const note = (label: string, kind: ApplicationQuestion["kind"], choices: string[], section = "") => {
      if (kind !== "file" && !askedAi.has(label)) unknown.set(label, { section, kind, options: choices });
    };
    // Sites like Workday redraw the form after each choice, so the page is scanned again after every field.
    const fillFields = async (only: Set<string> | null) => {
      const handled = new Set<string>();
      for (let guard = 0; guard < 60; guard += 1) {
        await checkStop();
        const field = (await scanFields(page)).find((item) => !handled.has(item.label) && (!only || only.has(item.label)));
        if (!field) break;
        handled.add(field.label);
        if (field.listbox) {
          const result = await decideListbox(page, page.locator(field.selector).first(), (choices) => answerOf(field.label, "select", choices, field)).catch(() => null);
          if (result && !result.answer) note(field.label, "select", result.options, field.section);
          if (result?.picked) {
            filled.add(field.label);
            failed.delete(field.label);
            ask.delete(field.label);
          } else if (result?.answer) {
            failed.set(field.label, "Couldn't pick this option. Choose it in the live view.");
            if (field.required) ask.set(field.label, { kind: "select", options: result.options });
          } else if (field.required) {
            ask.set(field.label, { kind: "select", options: result?.options ?? [] });
            failed.set(field.label, result ? "Required. Answer it below or in the live view." : "Couldn't open this dropdown. Choose it in the live view.");
          }
          continue;
        }
        const fieldOptions = field.options;
        let answer: string | null = null;
        if (COVER_LETTER.test(field.label) && (field.kind === "file" || field.kind === "textarea") && !answerOf(field.label, field.kind, fieldOptions, field)) {
          letterResult(field.label, await putLetter(page.locator(field.selector).first(), field.kind), field.required, field.kind);
          continue;
        }
        if (field.kind === "file") {
          // One resume upload per run, on a page that asks for a resume or CV.
          const wantsResume = /resume|cv|curriculum/i.test(field.label) || /\b(resume|cv)\b/i.test(pageText);
          answer = wantsResume && options.resume && !resumeUploaded && !pageText.includes(options.resume.name) ? options.resume.name : null;
        } else {
          answer = answerOf(field.label, field.kind, fieldOptions, field);
          if (!answer) note(field.label, field.kind, fieldOptions, field.section);
        }
        if (!answer) {
          if (field.required && field.kind !== "file") {
            ask.set(field.label, { kind: field.kind, options: fieldOptions });
            failed.set(field.label, "Required. Answer it below or in the live view.");
          }
          continue;
        }
        try {
          // The marker from the scan may be gone after a redraw; then find the field again by its label.
          const marked = (await page.locator(field.selector).count()) > 0;
          const fresh = marked ? null : (await scanFields(page)).find((item) => item.label === field.label);
          const locator = page.locator(fresh?.selector ?? field.selector).first();
          const question: ApplicationQuestion = { key: field.selector, label: field.label, kind: field.kind, required: false, options: fieldOptions, sensitive: false, answer, source: null, evidence: null };
          await setValue(page, locator, question, answer, options.resume);
          filled.add(field.label);
          failed.delete(field.label);
          ask.delete(field.label);
          if (field.kind === "file") resumeUploaded = true;
        } catch {
          failed.set(field.label, "Couldn't fill this field. Fill it in the live view.");
          if (field.required) ask.set(field.label, { kind: field.kind, options: fieldOptions });
        }
      }
    };

    const fillRadios = async () => {
      for (const group of await scanRadioGroups(page)) {
        const answer = radioAnswer(group, answerOf);
        const label = group.question.slice(0, 160);
        if (!answer && !OPT_IN_QUESTION.test(group.question)) note(label, "select", group.options.map((option) => option.label));
        if (!answer) {
          if (group.required) {
            failed.set(label, "Required. Answer it below or in the live view.");
            ask.set(label, { kind: "select", options: group.options.map((option) => option.label) });
          }
          continue;
        }
        try {
          await page.locator(group.selector(answer.value)).first().check({ force: true });
          filled.add(label);
          failed.delete(label);
          ask.delete(label);
        } catch {
          failed.set(label, "Couldn't pick an answer. Choose it in the live view.");
        }
      }
    };

    await fillFields(null);
    await fillRadios();
    // One AI pass per page for the questions nothing on file answers, using only the resume and profile.
    if (options.aiAnswers && unknown.size) {
      await checkStop();
      const asked = [...unknown].slice(0, 30);
      for (const [label] of asked) askedAi.add(label);
      const got = await options.aiAnswers(asked.map(([label, item]) => ({ label, ...item }))).catch(() => ({}) as Record<string, string>);
      const labels = Object.keys(got).filter((label) => got[label]?.trim());
      if (labels.length) {
        for (const label of labels) aiKnown.set(label, got[label].trim());
        await fillFields(new Set(labels));
        await fillRadios();
        for (const label of labels) if (filled.has(label)) fromResume.add(label);
      }
    }

    // Fix-up: anything required still empty gets one decision pass (two if new fields appear), never a blind guess.
    for (let round = 0; round < 2 && options.fixFields; round += 1) {
      await checkStop();
      const open = (await emptyRequired(page)).filter((field) => field.control !== "file" && !fixTried.has(field.label));
      if (!open.length) break;
      for (const field of open) {
        fixTried.add(field.label);
        if (field.control === "listbox") field.options = (await decideListbox(page, page.locator(field.selector).first(), () => null).catch(() => null))?.options ?? [];
      }
      const actions = await options.fixFields(open, await siteErrors(page)).catch(() => []);
      if (!actions.length) break;
      for (const action of actions) {
        const field = open[action.index];
        if (!field || !action.value.trim()) continue;
        try {
          await applyFix(page, field, action.value.trim());
          decided.set(field.label, { answer: action.value.trim(), why: action.why });
          filled.add(field.label);
          failed.delete(field.label);
          ask.delete(field.label);
        } catch {
          // Left for the student below.
        }
      }
    }

    // Whatever is still empty comes back to the student as a question they can answer in Unnepo.
    const remaining = await emptyRequired(page);
    const empty = [...new Set(remaining.map((field) => field.label))];
    for (const field of remaining) {
      if (!failed.has(field.label)) failed.set(field.label, field.control === "file" ? "Upload this in the live view." : "Required. Answer it below or in the live view.");
      if (field.control !== "file") ask.set(field.label, { kind: field.control === "textarea" ? "textarea" : field.control === "checkbox" ? "checkbox" : field.options.length ? "select" : "text", options: field.options });
    }
    const next = await visible(button(page, NEXT_BUTTON));
    const submit = await visible(page.getByRole("button", { name: /^(submit( application)?|send application|complete application|submit my application)$/i }).or(page.locator("input[type='submit'][value*='Submit' i]")));
    if (submit && !next) return done("review", pageIndex);
    const unanswered = [...ask.keys()].some((label) => failed.has(label));
    if (empty.length || unanswered || !next) return done("needs_input", pageIndex);

    const before = page.url() + (await bodyText(page));
    await clickSmart(page, next);
    // Workday moves between steps without a page load; wait for the content to change.
    const deadline = Date.now() + 12_000;
    let after = before;
    while (Date.now() < deadline && after === before) {
      await page.waitForTimeout(300);
      after = page.url() + (await bodyText(page));
    }
    await settle(page);
    if (after === before) {
      // The site refused to move on. Its own error messages say why.
      const errors = await page.locator("[data-automation-id='errorMessage'], [role='alert']:visible, .error:visible, [aria-invalid='true']").allInnerTexts().catch(() => []);
      for (const message of errors.map((text) => text.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 8)) failed.set(message.slice(0, 160), "The site flagged this. Fix it below or in the live view.");
      return done("needs_input", pageIndex);
    }
    // A new page: earlier "needs you" notes belong to the page just left.
    for (const [label, reason] of failed) if (reason.startsWith("Required")) failed.delete(label);
    ask.clear();
  }
  return done("needs_input", MAX_PAGES);
}

/** Single-page fill, kept for callers that don't need accounts or multiple pages. */
export async function fillApplicationForm(page: Page, applicationUrl: string, questions: ApplicationQuestion[], resume: ResumeFile | null) {
  const result = await runApplicationFlow(page, { url: applicationUrl, navigate: true, questions, resume, credentials: null, allowSignup: false, answerFor: () => null });
  for (const question of questions) {
    if (question.answer?.trim() && !result.filled.includes(question.label) && !result.failed.some((item) => item.label === question.label)) {
      result.failed.push({ label: question.label, reason: "Couldn't find this field on the form." });
    }
  }
  return result;
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
