import { CONFIRM_TEXT, type FillPlan, type FillReport, type PageField } from "../shared/types";
import { findAction, findApply, pageNotes, pressAction, SUBMIT } from "./actions";
import { press, sleep, typeInto, visibleOptions, waitFor } from "./dom";
import { fillGeneric } from "./generic";
import { fillGreenhouse, greenhouseValue } from "./greenhouse";
import { deepAll, emptyRequired, findMarked, isEmpty, labelOf, rootOf, scanFields, scanPage } from "./scan";
import { fieldControl, markNeeds } from "./needs";
import { startSpiders, stopSpiders } from "./spiders";

/**
 * Injected into the job page when the student presses Fill. Scans the form, fills it from the plan the
 * background worker got from Unnepo, checks every required field, reports which button moves things
 * along (Apply, Create account, Next, Submit), presses it when asked, and watches for the submit.
 */

declare global {
  interface Window {
    __unnepo?: { scan: typeof scanPage; fill: typeof fill; alive: () => boolean };
  }
}

/**
 * Types the student's job-site password into every empty, visible password box: sign-in, create account,
 * and the "confirm password" box beside it. Boxes the student already filled are left alone.
 */
function fillPasswords(password: string | null) {
  if (!password) return [];
  const boxes = deepAll<HTMLInputElement>("input[type=password]")
    .filter((box) => !box.disabled && !box.readOnly && !box.value && box.getBoundingClientRect().height > 0);
  boxes.forEach((box) => typeInto(box, password));
  return boxes.map((box, index) => (index === 0 ? "Password" : /confirm|verify|re-?enter|again/i.test(`${labelOf(box)} ${box.name} ${box.id} ${box.getAttribute("aria-label") ?? ""} ${box.getAttribute("data-automation-id") ?? ""}`) ? "Confirm password" : `Password ${index + 1}`));
}

/** Dropdowns that only show their choices when opened: open each once, read the choices, close it. */
async function withOptions(fields: PageField[]) {
  for (const field of fields) {
    if (field.type !== "combobox" || field.options.length) continue;
    const el = findMarked(field.id);
    if (!el) continue;
    const control = (el.closest("[class*='select__control'], [class*='-control']") as HTMLElement | null) ?? el;
    press(control);
    const options = await waitFor(() => (visibleOptions().length ? visibleOptions() : null), 1500);
    field.options = (options ?? []).map((option) => (option.textContent ?? "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 100);
    (el instanceof HTMLInputElement ? el : control).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    el.blur();
    await sleep(80);
  }
  return fields;
}

/** Scrolls to a question the student still has to answer, puts the cursor in it, and flashes a ring around it. */
function showField(label: string) {
  const control = fieldControl(label);
  if (!control) return false;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  control.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  const before = { outline: control.style.outline, outlineOffset: control.style.outlineOffset, boxShadow: control.style.boxShadow };
  control.style.outline = "3px solid #3D8BFF";
  control.style.outlineOffset = "3px";
  control.style.boxShadow = "0 0 0 8px rgba(61, 139, 255, .25)";
  setTimeout(() => control.focus({ preventScroll: true }), reduce ? 0 : 350);
  setTimeout(() => Object.assign(control.style, before), 2600);
  return true;
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
  // Pressing Submit is the background worker's call (see "press"), so a fill never submits by itself.
  return { filled: result.filled, failed: result.failed, needsYou: [...new Set(missing)], captcha: scanPage().captcha, submitted: false, ms: Date.now() - started };
}

/** Answers the student typed themselves: anything with a value that Unnepo didn't fill or that they changed. */
function typedAnswers() {
  const fields = planned.length ? planned : scanFields();
  return fields.flatMap((field) => {
    const el = findMarked(field.id);
    if (!el || field.type === "file") return [];
    const control = el.matches("input, select, textarea, button") ? el : (el.querySelector("input") as HTMLElement | null) ?? el;
    if (isEmpty(control)) return [];
    const value = control instanceof HTMLSelectElement ? control.selectedOptions[0]?.textContent?.trim() ?? ""
      : control instanceof HTMLInputElement && (control.type === "radio" || control.type === "checkbox") ? (rootOf(control).querySelector<HTMLInputElement>(`input[name="${CSS.escape(control.name)}"]:checked`)?.closest("label")?.textContent ?? "").trim()
        : control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement ? control.value.trim() : (control.textContent ?? "").trim();
    if (!value || value.length > 400 || plannedValues.get(field.label) === value) return [];
    return [{ question: field.label, answer: value, section: field.section }];
  });
}

/**
 * Whether this copy of the script still belongs to a running extension. After the extension is reloaded
 * or updated, scripts already in the page are cut off and every chrome.runtime call throws.
 */
function alive() {
  try {
    return Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
}

/** Tells the extension something, quietly doing nothing once this copy is cut off. */
function tell(message: unknown) {
  if (!alive()) return;
  try {
    void chrome.runtime.sendMessage(message).catch(() => undefined);
  } catch {
    // The extension was reloaded between the check and the call.
  }
}

let announcedAt = 0;
function announceSubmit() {
  // Pressing Submit for the student also fires the click watcher; one announcement is enough.
  if (Date.now() - announcedAt < 3000) return;
  announcedAt = Date.now();
  if (!alive()) return;
  tell({ type: "submit-clicked", answers: typedAnswers(), url: location.href });
  // The page's own words count as "likely" if the network didn't already confirm it.
  const until = Date.now() + 20_000;
  const timer = setInterval(() => {
    const text = (document.body.innerText || "").replace(/\s+/g, " ");
    const match = text.match(CONFIRM_TEXT);
    if (match) {
      clearInterval(timer);
      const start = Math.max(0, (match.index ?? 0) - 40);
      tell({ type: "submitted-page", text: text.slice(start, start + 200), url: location.href });
    } else if (Date.now() > until) clearInterval(timer);
  }, 700);
}

/** Watches for the student pressing Submit themselves. */
function watchSubmit() {
  document.addEventListener("click", (event) => {
    let target = (event.target as Element | null)?.closest("button, input[type=submit], [data-automation-id='click_filter']") as HTMLElement | null;
    // Workday's overlay sits on top of the real button.
    if (target?.matches("[data-automation-id='click_filter']")) target = target.parentElement?.querySelector("button") ?? target;
    if (target && SUBMIT.test((target.textContent || (target as HTMLInputElement).value || target.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim())) announceSubmit();
  }, true);
}

// One live copy per page. A copy left from before the extension was reloaded is cut off, so a new copy
// takes over instead of leaving the page unreachable until it's refreshed.
if (!window.__unnepo || !window.__unnepo.alive()) {
  window.__unnepo = { scan: scanPage, fill, alive };
  watchSubmit();
  chrome.runtime.onMessage.addListener((message, _sender, reply) => {
    if (message?.type === "scan") {
      reply(scanPage());
      return false;
    }
    if (message?.type === "spiders") {
      if (message.on) startSpiders(Boolean(message.drop));
      else stopSpiders();
      reply({ ok: true });
      return false;
    }
    if (message?.type === "status") {
      // What still needs the student, and which button would move the application along.
      const fields = scanFields();
      const action = findAction(Boolean(message.knownAccount), fields.length);
      const apply = findApply();
      reply({ needsYou: emptyRequired(fields).map((field) => field.label), action: action ? { kind: action.kind, label: action.label } : null, apply: apply ? (apply.textContent ?? "").trim() || "Apply" : null, captcha: scanPage().captcha, ...pageNotes() });
      return false;
    }
    if (message?.type === "leftovers") {
      // Fields Greenhouse's API doesn't list (its newer demographic questions): empty and not one of its ids.
      const known = new Set<string>(message.ids ?? []);
      const fields = scanFields().filter((field) => {
        const el = findMarked(field.id);
        if (!el || field.type === "file") return false;
        const control = el.matches("input, select, textarea, button") ? el : (el.querySelector("input") as HTMLElement | null) ?? el;
        const ids = [control.id, (control as HTMLInputElement).name, el.id].filter(Boolean);
        return !ids.some((id) => known.has(id) || [...known].some((k) => id.startsWith(`${k}-`) || id.startsWith(`${k}_`))) && isEmpty(control);
      });
      void withOptions(fields).then((withChoices) => reply({ fields: withChoices }));
      return true;
    }
    if (message?.type === "mark-needs") {
      reply({ marked: markNeeds(Array.isArray(message.labels) ? message.labels.map(String) : []) });
      return false;
    }
    if (message?.type === "focus-field") {
      reply({ ok: showField(String(message.label ?? "")) });
      return false;
    }
    if (message?.type === "press" && message.first) {
      const apply = findApply();
      if (apply) pressAction(apply);
      reply({ pressed: Boolean(apply), label: apply?.textContent?.trim() });
      return false;
    }
    if (message?.type === "press") {
      const fields = scanFields();
      const action = findAction(Boolean(message.knownAccount), fields.length);
      if (!action || action.kind !== message.kind) {
        reply({ pressed: false });
        return false;
      }
      if (action.kind === "submit") announceSubmit();
      pressAction(action.el);
      reply({ pressed: true, label: action.label });
      return false;
    }
    if (message?.type === "fill") {
      // No spiders from here: the background worker sends them out once, on the page itself, so a form in a
      // frame doesn't get a second set of its own.
      fill(message.plan as FillPlan).then(reply, (error) => reply({ filled: [], failed: [{ label: "Form", reason: error instanceof Error ? error.message : "couldn't fill" }], needsYou: [], captcha: false, submitted: false, ms: 0 } satisfies FillReport));
      return true;
    }
    return false;
  });
}
