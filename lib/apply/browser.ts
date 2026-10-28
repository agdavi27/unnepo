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
      if (type === "hidden" || type === "submit" || type === "radio") continue;
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
  /** Answers for fields the job board didn't publish ahead of time, matched by label. Null leaves the field for the student. */
  answerFor: (label: string, kind: ApplicationQuestion["kind"], options: string[]) => string | null;
};

export type FlowResult = Omit<FillReport, "liveViewUrl" | "screenshotAt"> & { stoppedAt: NonNullable<FillReport["stoppedAt"]>; host: string };

const MAX_PAGES = 10;

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
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
  await page.waitForTimeout(500);
}

async function visible(locator: Locator) {
  const count = await locator.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    if (await locator.nth(index).isVisible().catch(() => false)) return locator.nth(index);
  }
  return null;
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
const NOT_CONSENT = /(marketing|newsletter|offers|promotion|sms|text messages?|job alerts?|talent community)/i;

/** "signup" when the page asks to create an account, "signin" when it asks to log in, null otherwise. */
async function authKind(page: Page): Promise<"signup" | "signin" | null> {
  const passwords = page.locator("input[type='password']");
  let shown = 0;
  for (let index = 0; index < (await passwords.count()); index += 1) if (await passwords.nth(index).isVisible().catch(() => false)) shown += 1;
  if (!shown) return null;
  const create = await visible(page.getByRole("button", { name: /^(create (an )?account|sign up|register|create)$/i }));
  if (shown >= 2 || create) return "signup";
  return "signin";
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
async function openForm(page: Page) {
  for (const name of [/^apply( for this job| now)?$/i, /^apply manually$/i]) {
    const formFields = await page.locator("input:visible:not([type='search']):not([type='hidden']):not([type='checkbox']), textarea:visible, select:visible").count();
    if (formFields >= 2 || (await authKind(page))) return;
    const entry = await visible(button(page, name));
    if (entry) {
      await entry.click().catch(() => undefined);
      await settle(page);
    }
  }
}

/** Buttons that move to the next step without submitting. */
const NEXT_BUTTON = /^(next|continue|save and continue|save & continue|save and next|continue to (the )?application|continue application|start (my |your )?application|begin application|proceed|next step|continue to next step)$/i;

/** Text-message and marketing opt-ins. Unnepo always answers no; the student can change it in the live view. */
const OPT_IN_QUESTION = /\b(sms|text (message|messages|messaging|communications?)|receiv(e|ing) (text|sms)|auto-?dialed|marketing|newsletter|job alerts?|talent community)\b/i;

type RadioGroup = { name: string; question: string; options: Array<{ label: string; value: string }>; required: boolean; selector: (value: string) => string };

/** Unanswered radio-button questions, with the question text found around them. */
async function scanRadioGroups(page: Page): Promise<RadioGroup[]> {
  const groups = await page.evaluate(() => {
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
      // The question is the nearest text around the group that is more than its own option labels.
      let node: HTMLElement | null = radios[0].parentElement;
      let question = "";
      const optionText = options.map((option) => option.label).join(" ");
      while (node && node !== document.body && !question) {
        const contains = radios.every((radio) => node!.contains(radio));
        if (contains) {
          const legend = node.querySelector("legend")?.textContent?.trim();
          const text = (legend || node.innerText || "").replace(/\s+/g, " ").trim();
          if (text.replace(optionText, "").trim().length > 12) question = text.replace(optionText, "").trim();
          else if (node.previousElementSibling) {
            const before = (node.previousElementSibling as HTMLElement).innerText?.replace(/\s+/g, " ").trim() ?? "";
            if (before.length > 12) question = before;
          }
        }
        node = node.parentElement;
      }
      const required = radios.some((radio) => radio.required) || Boolean(radios[0].closest("[aria-required='true'], [role='radiogroup'][aria-required='true']"));
      if (question) out.push({ name, question: question.slice(0, 600), options, required });
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

type ScannedField = { selector: string; label: string; kind: ApplicationQuestion["kind"]; options: string[] };

/** Visible empty fields on the page, with their labels, for questions the job board didn't publish. */
async function scanFields(page: Page): Promise<ScannedField[]> {
  return page.evaluate(() => {
    const out: Array<{ selector: string; label: string; kind: "text" | "textarea" | "select" | "file"; options: string[] }> = [];
    const fields = Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select"));
    fields.forEach((field, index) => {
      const type = (field.getAttribute("type") || "text").toLowerCase();
      if (["hidden", "submit", "button", "password", "checkbox", "radio", "search", "image", "reset"].includes(type)) return;
      const rect = field.getBoundingClientRect();
      const style = window.getComputedStyle(field);
      if ((!rect.width && !rect.height && type !== "file") || style.visibility === "hidden" || style.display === "none") return;
      if (type === "file" ? (field as HTMLInputElement).files?.length : String(field.value || "").trim()) return;
      const id = field.getAttribute("id");
      const label = ((id && document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent) || field.closest("label")?.textContent || field.getAttribute("aria-label") || field.getAttribute("placeholder") || "").replace(/\s+/g, " ").replace(/\*$/, "").trim();
      if (!label) return;
      field.setAttribute("data-unnepo-field", String(index));
      const kind = field.tagName === "SELECT" ? "select" : field.tagName === "TEXTAREA" ? "textarea" : type === "file" ? "file" : "text";
      const options = field.tagName === "SELECT" ? Array.from((field as HTMLSelectElement).options).map((option) => option.text.trim()).filter((text) => text && !/^(select|choose|--)/i.test(text)) : [];
      out.push({ selector: `[data-unnepo-field="${index}"]`, label: label.slice(0, 200), kind, options });
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
  });

  for (let pageIndex = 1; pageIndex <= MAX_PAGES; pageIndex += 1) {
    await openForm(page);
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
        const submit = await visible(button(page, /^(sign in|log ?in|continue|next|submit)$/i));
        if (!submit) return done("signin_failed", pageIndex);
        await submit.click();
        await settle(page);
        if (!(await authKind(page))) {
          account = "signed_in";
          continue;
        }
        if (!SIGNIN_ERROR.test(await bodyText(page))) return done("signin_failed", pageIndex);
        // No account yet: switch to the create-account form.
        const create = await visible(button(page, /^(create (an )?account|sign up|register|new user\??)$/i));
        if (!create || !options.allowSignup) return done(options.allowSignup ? "signin_failed" : "needs_account", pageIndex);
        await create.click();
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
      const create = await visible(button(page, /^(create (an )?account|sign up|register|create|continue|submit)$/i));
      if (!create) return done("needs_input", pageIndex);
      await create.click();
      await settle(page);
      if (await authKind(page)) {
        const text = await bodyText(page);
        if (/already (exists|registered|in use)/i.test(text) && !triedSignin) {
          // An account exists already; go back to sign in with the same password.
          const signin = await visible(button(page, /^(sign in|log ?in)$/i));
          if (signin) {
            await signin.click();
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
      if (!answer || filled.has(question.label)) continue;
      const field = await locate(page, question);
      // File inputs are usually hidden behind a styled button, so only other fields must be visible.
      if (!field || (question.kind !== "file" && !(await field.isVisible().catch(() => false)))) continue;
      try {
        await setValue(page, field, question, answer, options.resume);
        filled.add(question.label);
        failed.delete(question.label);
      } catch (error) {
        failed.set(question.label, error instanceof Error && /no resume/.test(error.message) ? "Upload a resume in Settings first." : "Couldn't fill this field. Fill it in the live view.");
      }
    }
    // Everything else on the page, matched by label to what Unnepo knows for sure.
    for (const field of await scanFields(page)) {
      const answer = field.kind === "file" ? (/resume|cv/i.test(field.label) && options.resume ? options.resume.name : null) : options.answerFor(field.label, field.kind, field.options);
      if (!answer) continue;
      try {
        const locator = page.locator(field.selector).first();
        const question: ApplicationQuestion = { key: field.selector, label: field.label, kind: field.kind, required: false, options: field.options, sensitive: false, answer, source: null, evidence: null };
        await setValue(page, locator, question, answer, options.resume);
        filled.add(field.label);
      } catch {
        failed.set(field.label, "Couldn't fill this field. Fill it in the live view.");
      }
    }

    for (const group of await scanRadioGroups(page)) {
      const answer = radioAnswer(group, options.answerFor);
      if (!answer) {
        if (group.required) failed.set(group.question.slice(0, 120), "Required. Only you can answer this one. Choose it in the live view.");
        continue;
      }
      try {
        await page.locator(group.selector(answer.value)).first().check({ force: true });
        filled.add(group.question.slice(0, 120));
      } catch {
        failed.set(group.question.slice(0, 120), "Couldn't pick an answer. Choose it in the live view.");
      }
    }

    const empty = await emptyRequiredLabels(page);
    const next = await visible(button(page, NEXT_BUTTON));
    const submit = await visible(page.getByRole("button", { name: /^(submit( application)?|send application|complete application|submit my application)$/i }).or(page.locator("input[type='submit'][value*='Submit' i]")));
    if (submit && !next) {
      for (const label of empty) if (!failed.has(label)) failed.set(label, "Required. Fill it in the live view.");
      return done("review", pageIndex);
    }
    const unansweredRadios = [...failed.keys()].some((label) => failed.get(label)?.startsWith("Required. Only you"));
    if (empty.length || unansweredRadios || !next) {
      for (const label of empty) if (!failed.has(label)) failed.set(label, "Required. Fill it in the live view.");
      return done("needs_input", pageIndex);
    }
    const before = page.url() + (await bodyText(page)).slice(0, 400);
    await next.click();
    await settle(page);
    if (page.url() + (await bodyText(page)).slice(0, 400) === before) return done("needs_input", pageIndex);
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
