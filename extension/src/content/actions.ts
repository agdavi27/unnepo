import { CONFIRM_TEXT } from "../shared/types";
import { press } from "./dom";
import { deepAll, openDialog } from "./scan";

/**
 * The buttons that move an application along: Apply on a job posting, Create account or Sign in, Next,
 * and Submit. Workday's are found by their stable automation ids first; everything else by the words
 * sites use. Header links like "Sign In" or "Apply with LinkedIn" are never pressed.
 */

export type ActionKind = "apply" | "create_account" | "sign_in" | "next" | "submit";
export type PageAction = { kind: ActionKind; label: string };

export const SUBMIT = /^(submit( (my )?application)?|send( my)? application|complete( my)? application|submit (and|&) apply|finish( application)?)$/i;
const APPLY_SUBMIT = /^apply( now)?$/i;
// "Next", "Continue", "Continue To Application", "Save and Continue", "Proceed to questions"…
const NEXT = /^(next|continue|proceed|save (and|&) (continue|next|proceed))\b[^.?!]{0,32}$|^(next|continue) ?[›>]$/i;
// …but not "Continue with LinkedIn" and the like, which hand the student to another sign-in.
const NOT_NEXT = /\b(with|using|via) (linkedin|google|indeed|facebook|apple|microsoft|seek|email)\b|sign ?in|log ?in|shopping/i;
const APPLY = /^(apply( now| for this (job|position|role|opportunity)| here| online| today)?|i(?:'|’)?m interested|start (my |your )?application|begin application|apply manually)$/i;
const CREATE = /^(create (an |my |your )?account|register|sign up|create account (and|&) continue)$/i;
const SIGN_IN = /^(sign in|log ?in)$/i;

const text = (el: HTMLElement) => (el.textContent || (el as HTMLInputElement).value || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();

function usable(el: HTMLElement | null): el is HTMLElement {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width < 4 || rect.height < 4) return false;
  if ((el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") return false;
  const style = getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none";
}

const byId = (id: string) => Array.from(document.querySelectorAll<HTMLElement>(`[data-automation-id='${id}']`)).find(usable) ?? null;

/** Buttons and button-like links on the page (or only in the open popup), minus the site header and footer. */
function buttons() {
  return deepAll<HTMLElement>("button, input[type=submit], input[type=button], a, [role=button]", openDialog() ?? document)
    .filter(usable)
    .filter((el) => !el.closest("header, footer, nav, [data-automation-id='utilityButtonBar'], [role=banner], [role=navigation]"));
}

const find = (pattern: RegExp) => buttons().find((el) => pattern.test(text(el))) ?? null;

/** What to press next on this page, if anything. `knownAccount`: the student already has an account on this site. */
export function findAction(knownAccount: boolean, formFields: number): (PageAction & { el: HTMLElement }) | null {
  const passwords = deepAll<HTMLInputElement>("input[type=password]").filter(usable).length;
  const make = (kind: ActionKind, el: HTMLElement | null) => (el ? { kind, label: text(el) || kind, el } : null);

  // Workday's account page: create an account the first time, sign in after that.
  const createSubmit = byId("createAccountSubmitButton");
  if (createSubmit) return knownAccount && byId("signInLink") ? make("sign_in", byId("signInLink")) : make("create_account", createSubmit);
  const signInSubmit = byId("signInSubmitButton");
  if (signInSubmit) return !knownAccount && byId("createAccountLink") ? make("create_account", byId("createAccountLink")) : make("sign_in", signInSubmit);
  // Other sites' account forms.
  if (passwords >= 2) {
    const create = find(CREATE);
    if (create) return make("create_account", create);
  }
  if (passwords === 1) {
    const signIn = knownAccount ? find(SIGN_IN) : find(CREATE) ?? find(SIGN_IN);
    if (signIn) return make(CREATE.test(text(signIn)) ? "create_account" : "sign_in", signIn);
  }

  // Workday's footer button says "Next" or "Save and Continue" on every page, and "Submit" on the last.
  const footer = byId("bottom-navigation-next-button") ?? byId("pageFooterNextButton");
  if (footer) return make(SUBMIT.test(text(footer)) ? "submit" : "next", footer);
  const next = buttons().find((el) => NEXT.test(text(el)) && !NOT_NEXT.test(text(el))) ?? null;
  if (next) return make("next", next);
  const submit = find(SUBMIT) ?? (formFields >= 3 ? find(APPLY_SUBMIT) : null);
  if (submit) return make("submit", submit);

  // A job posting, not the form yet: Workday asks how to apply, and "Apply Manually" is the predictable one.
  if (formFields < 3 && !inApplication()) {
    const apply = byId("applyManually") ?? byId("adventureButton") ?? find(APPLY);
    if (apply) return make("apply", apply);
  }
  return null;
}

/**
 * The Apply button on a job posting, looked for first whenever Fill starts, even when the page also shows
 * some fields (a search box, a newsletter, the form further down). A form's own "Apply" submit button
 * doesn't count: that would send an empty application.
 */
export function findApply(): HTMLElement | null {
  // Already inside an application (a Workday step, or a page with a form and a Next button): pressing
  // "Apply" here would start over, back at the resume step.
  if (inApplication()) return null;
  const known = byId("applyManually") ?? byId("adventureButton");
  if (known) return known;
  return buttons().find((el) => {
    if (!APPLY.test(text(el))) return false;
    const form = el.closest("form");
    const isSubmit = (el as HTMLButtonElement).type === "submit" || el.matches("input[type=submit]");
    return !(form && (isSubmit || form.querySelectorAll("input:not([type=hidden]), select, textarea").length >= 3));
  }) ?? null;
}

/** Whether the page is a step of an application already, not the job posting. */
export function inApplication() {
  if (/\/apply(\/|$|\?)/.test(location.pathname + location.search) && !byId("applyManually")) return true;
  if (byId("bottom-navigation-next-button") || byId("pageFooterNextButton") || byId("progressBar")) return true;
  return false;
}

/** Presses the button. Workday puts a clickable overlay over some of its buttons; that's what listens. */
export function pressAction(el: HTMLElement) {
  el.scrollIntoView({ block: "center" });
  const overlay = el.parentElement?.querySelector<HTMLElement>("[data-automation-id='click_filter']");
  press(overlay && usable(overlay) ? overlay : el);
}

/** What the page says that changes what to do: the account exists, an email to verify, or it went through. */
export function pageNotes() {
  const alerts = Array.from(document.querySelectorAll<HTMLElement>("[role=alert], [aria-live=assertive], [data-automation-id*='error' i], [class*='error' i]"))
    .map((el) => el.innerText || "").join(" ");
  const body = (document.body.innerText || "").replace(/\s+/g, " ");
  return {
    accountExists: /(already|previously) (been )?(registered|exists?|in use|taken)|account (already )?exists|email address is already|already have an account/i.test(alerts),
    // "You may have entered the wrong email address or password or your account might be locked."
    signInFailed: /wrong (email|e-mail|username|password)|(email|username|password)( address)? (or password )?(is |was )?(incorrect|invalid|not recogni[sz]ed)|incorrect (email|e-mail|username|password)|invalid (email|username|password|credentials|login)|account (might be|may be|is|has been) locked|couldn(?:'|’)?t sign you in|sign[- ]?in (failed|unsuccessful)|unable to sign in|login failed/i.test(`${alerts} ${deepAll<HTMLInputElement>("input[type=password]").length ? body : ""}`),
    verifyEmail: /verify your (email|account)|verification (email|link|code)|check your (email|inbox)|confirm your email/i.test(body) && !document.querySelector("input:not([type=hidden])"),
    confirmed: CONFIRM_TEXT.test(body),
  };
}
