import { CONFIRM_TEXT, type FillPlan, type FillReport, type PageField } from "../shared/types";
import { press, sleep, typeInto } from "./dom";
import { fillGeneric } from "./generic";
import { fillGreenhouse, greenhouseValue } from "./greenhouse";
import { emptyRequired, isEmpty, scanFields, scanPage } from "./scan";

/**
 * Injected into the job page when the student presses Fill. Scans the form, fills it from the plan the
 * background worker got from Unnepo, checks every required field, and watches for the submit. It clicks
 * Submit only when the student turned on auto-submit and nothing is missing.
 */

declare global {
  interface Window {
    __unnepo?: { scan: typeof scanPage; fill: typeof fill };
  }
}

const SUBMIT = /^(submit( application| my application)?|send application|apply( now)?|complete application)$/i;

function submitButton() {
  const buttons = Array.from(document.querySelectorAll<HTMLElement>("button, input[type=submit]")).filter((el) => el.getBoundingClientRect().height > 0);
  return buttons.find((el) => SUBMIT.test((el.textContent || (el as HTMLInputElement).value || "").replace(/\s+/g, " ").trim())) ?? null;
}

/**
 * Types the student's job-site password into every empty, visible password box: sign-in, create account,
 * and the "confirm password" box beside it. Boxes the student already filled are left alone.
 */
function fillPasswords(password: string | null) {
  if (!password) return [];
  const boxes = Array.from(document.querySelectorAll<HTMLInputElement>("input[type=password]"))
    .filter((box) => !box.disabled && !box.readOnly && !box.value && box.getBoundingClientRect().height > 0);
  boxes.forEach((box) => typeInto(box, password));
  return boxes.map((box, index) => (index === 0 ? "Password" : /confirm|verify|re-?enter|again/i.test(`${box.name} ${box.id} ${box.getAttribute("aria-label") ?? ""} ${box.getAttribute("data-automation-id") ?? ""}`) ? "Confirm password" : `Password ${index + 1}`));
}

let planned: PageField[] = [];
let plannedValues = new Map<string, string>();

async function fill(plan: FillPlan): Promise<FillReport> {
  const started = Date.now();
  const files = { resume: plan.resume, coverLetter: plan.coverLetter };
  const result = plan.useServerSchema
    ? await fillGreenhouse(plan.answers, files)
    : await fillGeneric((planned = scanFields()), plan.answers, files);
  result.filled.push(...fillPasswords(plan.password));
  plannedValues = new Map(plan.answers.map((answer) => [answer.label, answer.values.join(", ")]));
  await sleep(300);
  // Verify: what the page itself marks required and is still empty is the student's turn.
  const missing = emptyRequired().map((field) => field.label);
  if (plan.useServerSchema) {
    for (const answer of plan.answers) {
      if (answer.required && document.getElementById(answer.id) && !greenhouseValue(answer.id, answer.type) && !missing.includes(answer.label)) missing.push(answer.label);
    }
  }
  const captcha = scanPage().captcha;
  let submitted = false;
  if (plan.autoSubmit && !missing.length && !captcha && !result.failed.length) {
    const button = submitButton();
    if (button) {
      announceSubmit();
      press(button);
      submitted = true;
    }
  }
  return { filled: result.filled, failed: result.failed, needsYou: [...new Set(missing)], captcha, submitted, ms: Date.now() - started };
}

/** Answers the student typed themselves: anything with a value that Unnepo didn't fill or that they changed. */
function typedAnswers() {
  const fields = planned.length ? planned : scanFields();
  return fields.flatMap((field) => {
    const el = document.querySelector<HTMLElement>(`[data-unnepo-id="${field.id}"]`);
    if (!el || field.type === "file") return [];
    const control = el.matches("input, select, textarea, button") ? el : (el.querySelector("input") as HTMLElement | null) ?? el;
    if (isEmpty(control)) return [];
    const value = control instanceof HTMLSelectElement ? control.selectedOptions[0]?.textContent?.trim() ?? ""
      : control instanceof HTMLInputElement && (control.type === "radio" || control.type === "checkbox") ? (document.querySelector<HTMLInputElement>(`input[name="${CSS.escape(control.name)}"]:checked`)?.closest("label")?.textContent ?? "").trim()
        : control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement ? control.value.trim() : (control.textContent ?? "").trim();
    if (!value || value.length > 400 || plannedValues.get(field.label) === value) return [];
    return [{ question: field.label, answer: value, section: field.section }];
  });
}

function announceSubmit() {
  void chrome.runtime.sendMessage({ type: "submit-clicked", answers: typedAnswers(), url: location.href });
  // The page's own words count as "likely" if the network didn't already confirm it.
  const until = Date.now() + 20_000;
  const timer = setInterval(() => {
    const text = (document.body.innerText || "").replace(/\s+/g, " ");
    const match = text.match(CONFIRM_TEXT);
    if (match) {
      clearInterval(timer);
      const start = Math.max(0, (match.index ?? 0) - 40);
      void chrome.runtime.sendMessage({ type: "submitted-page", text: text.slice(start, start + 200), url: location.href });
    } else if (Date.now() > until) clearInterval(timer);
  }, 700);
}

/** Watches for the student pressing Submit themselves. */
function watchSubmit() {
  document.addEventListener("click", (event) => {
    const target = (event.target as Element | null)?.closest("button, input[type=submit]") as HTMLElement | null;
    if (target && SUBMIT.test((target.textContent || (target as HTMLInputElement).value || "").replace(/\s+/g, " ").trim())) announceSubmit();
  }, true);
}

if (!window.__unnepo) {
  window.__unnepo = { scan: scanPage, fill };
  watchSubmit();
  chrome.runtime.onMessage.addListener((message, _sender, reply) => {
    if (message?.type === "scan") {
      reply(scanPage());
      return false;
    }
    if (message?.type === "fill") {
      fill(message.plan as FillPlan).then(reply, (error) => reply({ filled: [], failed: [{ label: "Form", reason: error instanceof Error ? error.message : "couldn't fill" }], needsYou: [], captcha: false, submitted: false, ms: 0 } satisfies FillReport));
      return true;
    }
    return false;
  });
}
