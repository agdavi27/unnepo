import { bestOption } from "@/lib/apply/options";
import { answerChoices } from "@/lib/apply/questions";
import type { Answer, DropdownMethod, FileData, FillAttempt, FillFailure, PageField } from "../shared/types";
import { attachFile, chooseCustom, chooseNativeSelect, FillError, press, shownChoice, sleep, typeInto, typeKeys, waysFrom, YES } from "./dom";
import { findMarked, isEmpty, labelOf, rootOf } from "./scan";

/**
 * Any other form (Lever, Ashby, company career sites): filled by the data-unnepo-id the scanner set on
 * each field. Covers text, native selects, radio groups, checkboxes and checkbox groups, custom
 * dropdowns, and file uploads.
 */

const COVER_LETTER = /cover ?letter|letter of (interest|motivation)|motivation(al)? letter/i;
const RESUME = /r[eé]sum[eé]|\bcv\b|curriculum vitae/i;
// Uploads that are something else, which the resume must never go into.
const OTHER_DOCUMENT = /transcript|portfolio|writing sample|work sample|photo|picture|headshot|certificat|licen[cs]e|\bid\b|identification|reference|recommendation/i;

/** Which of the student's files belongs in an upload box, judging by its question and section. */
export function fileFor(field: PageField, files: { resume: FileData | null; coverLetter: FileData | null }) {
  const words = `${field.label} ${field.section}`;
  if (COVER_LETTER.test(field.label)) return files.coverLetter;
  if (RESUME.test(words)) return files.resume;
  return OTHER_DOCUMENT.test(words) ? null : files.resume;
}

// Upload boxes already filled on this page. A site that reads the resume (Workday) redraws the page after
// an upload; uploading again would start that over, again and again.
const uploadedHere = new Set<string>();

/** Whether this box already has a file: the page shows one, or Unnepo already uploaded into it here. */
function alreadyUploaded(field: PageField) {
  if (uploadedHere.has(`${location.pathname}|${field.label}`)) return true;
  const el = findMarked(field.id);
  return Boolean(el && !isEmpty(el));
}

/**
 * Upload boxes that get a file on this form. A box that doesn't say what it's for ("Choose a file")
 * gets the resume only when no box asks for the resume by name, and then only the first such box,
 * so the resume never lands in a second box meant for something else.
 */
function uploadPlan(fields: PageField[], files: { resume: FileData | null; coverLetter: FileData | null }) {
  const boxes = fields.filter((field) => field.type === "file");
  const named = boxes.some((field) => RESUME.test(`${field.label} ${field.section}`));
  let generic = 0;
  return new Set(boxes.filter((field) => {
    if (alreadyUploaded(field)) return false;
    const file = fileFor(field, files);
    if (!file) return false;
    if (file !== files.resume || RESUME.test(`${field.label} ${field.section}`)) return true;
    return !named && generic++ === 0;
  }).map((field) => field.id));
}

function pickLabel(answer: string, labels: string[]) {
  return answerChoices(answer).map((candidate) => bestOption(candidate, labels)).find(Boolean) ?? null;
}

const COUNTRY_CODE = /country (phone )?code|phone (country )?code|dialing code|^country code$|calling code/i;
const PHONE_NUMBER = /\b(phone|mobile|cell)\b/i;

/**
 * The phone number without its country code ("+1 (207) 555-0100" becomes "2075550100"), for forms that ask
 * for the code in its own dropdown. Workday rejects the number with the code in it ("Invalid Data").
 */
export function nationalNumber(value: string) {
  const trimmed = value.trim();
  let digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) {
    // +1 for the US and Canada; other codes are 2 or 3 digits before a space, dash, or bracket.
    const code = trimmed.match(/^\+(\d{1,3})[\s.\-(]/)?.[1] ?? (digits.startsWith("1") && digits.length === 11 ? "1" : "");
    if (code) digits = digits.slice(code.length);
  } else if (digits.length === 11 && digits.startsWith("1")) {
    digits = digits.slice(1);
  }
  return digits;
}

let separateCountryCode = false;
let dropdownWays: DropdownMethod[] = waysFrom();

/** The ways each kind of field can be filled, tried in order until the answer sticks. */
const TEXT_WAYS = ["set", "keys"] as const;
const CHECK_WAYS = ["press", "label"] as const;

/** Clicks a radio button or checkbox's own label, for inputs hidden behind a styled one. */
function pressLabel(input: HTMLInputElement) {
  const label = (input.id ? rootOf(input).querySelector<HTMLElement>(`label[for="${CSS.escape(input.id)}"]`) : null) ?? input.closest("label");
  press(label ?? input);
}

/** The value a field gets: the number box next to a country code dropdown gets just the number. */
function valueFor(field: PageField, answer: Answer) {
  const value = answer.values[0] ?? "";
  if (separateCountryCode && (field.type === "tel" || PHONE_NUMBER.test(field.label)) && !COUNTRY_CODE.test(field.label) && !/type|extension|\bext\b/i.test(field.label) && field.type !== "select" && field.type !== "combobox") {
    return nationalNumber(value) || value;
  }
  return value;
}

/** The radio button an answer picks. */
function chosenRadio(el: HTMLElement, value: string) {
  const name = (el as HTMLInputElement).name;
  const radios = Array.from(rootOf(el).querySelectorAll<HTMLInputElement>(`input[type=radio][name="${CSS.escape(name)}"]`));
  const labels = radios.map(labelOf);
  const choice = pickLabel(value, labels);
  if (!choice) throw new FillError(`no option matching "${value}"`, "no_option", labels.filter(Boolean).slice(0, 100));
  return radios[labels.indexOf(choice)];
}

/**
 * Fills one field the given way (the n-th of its ways; 0 is the usual one). Returns the name of the way,
 * or null when the field has no way that number.
 */
async function fillOne(field: PageField, answer: Answer, files: { resume: FileData | null; coverLetter: FileData | null }, way: number): Promise<string | null> {
  const el = findMarked(field.id);
  if (!el) throw new FillError("not on the page", "not_on_page");
  const value = valueFor(field, answer);
  switch (field.type) {
    case "radio": {
      if (way >= CHECK_WAYS.length) return null;
      const radio = chosenRadio(el, value);
      if (way === 0) press(radio);
      else pressLabel(radio);
      return CHECK_WAYS[way];
    }
    case "checkbox": {
      if (way >= CHECK_WAYS.length) return null;
      const box = el as HTMLInputElement;
      if (YES.test(value) !== box.checked) (way === 0 ? press : pressLabel)(box);
      return CHECK_WAYS[way];
    }
    case "multiselect": {
      if (way >= CHECK_WAYS.length) return null;
      for (const box of Array.from(el.querySelectorAll<HTMLInputElement>("input[type=checkbox]"))) {
        const wanted = answer.values.some((chosen) => pickLabel(chosen, [labelOf(box)]));
        if (wanted !== box.checked) (way === 0 ? press : pressLabel)(box);
      }
      return CHECK_WAYS[way];
    }
    case "select":
      if (way > 0) return null;
      chooseNativeSelect(el as HTMLSelectElement, value);
      return "select";
    case "combobox": {
      // The dropdown ladder (clicks, then the keyboard) runs inside and checks the box shows the choice.
      // A second go, for a choice the page cleared afterwards, starts with the other way.
      if (way > 1) return null;
      const ways = way === 0 ? dropdownWays : [...dropdownWays].reverse();
      // Searchable boxes filter as you type; button dropdowns just open.
      return chooseCustom(el, value, { type: el instanceof HTMLInputElement ? value : undefined, ways });
    }
    case "file": {
      if (way > 0) return null;
      const file = fileFor(field, files);
      if (!file) throw new FillError("no file", "no_file");
      attachFile(el as HTMLInputElement, file);
      return "upload";
    }
    default: {
      if (way >= TEXT_WAYS.length) return null;
      const box = el as HTMLInputElement | HTMLTextAreaElement;
      if (way === 0) typeInto(box, value);
      else await typeKeys(box, value);
      return TEXT_WAYS[way];
    }
  }
}

/** Reads a field back: null when the answer is there, or what's wrong. Custom dropdowns check themselves. */
export function readBack(field: PageField, answer: Answer): string | null {
  const el = findMarked(field.id);
  if (!el) return "it went from the page";
  const value = valueFor(field, answer);
  switch (field.type) {
    case "radio":
      return rootOf(el).querySelector(`input[type=radio][name="${CSS.escape((el as HTMLInputElement).name)}"]:checked`) ? null : "no choice is selected";
    case "checkbox":
      return (el as HTMLInputElement).checked === YES.test(value) ? null : "the box didn't change";
    case "multiselect": {
      const boxes = Array.from(el.querySelectorAll<HTMLInputElement>("input[type=checkbox]"));
      const wrong = boxes.filter((box) => answer.values.some((chosen) => pickLabel(chosen, [labelOf(box)])) !== box.checked);
      return wrong.length ? `${wrong.length} box${wrong.length === 1 ? "" : "es"} didn't change` : null;
    }
    case "select":
      return isEmpty(el) ? "the list still shows no choice" : null;
    case "combobox":
      return shownChoice(el) === "" ? "the box shows no choice" : null;
    case "file":
      return isEmpty(el) ? "the page shows no file" : null;
    default:
      return (el as HTMLInputElement).value.trim() ? null : "the box is empty";
  }
}

/** A few words of an answer, for the failure record. Only choices are kept; typed answers are personal. */
function brief(field: PageField, value: string) {
  if (!["select", "combobox", "radio", "checkbox", "multiselect"].includes(field.type)) return "";
  const words = value.split(/\s+/).filter(Boolean);
  const short = words.slice(0, 6).join(" ");
  return (words.length > 6 ? `${short}…` : short).slice(0, 60);
}

/** Fills a field one way after another until reading it back finds the answer. */
async function fillChecked(field: PageField, answer: Answer, files: { resume: FileData | null; coverLetter: FileData | null }, from = 0) {
  let problem = "";
  for (let way = from; ; way += 1) {
    const method = await fillOne(field, answer, files, way);
    if (!method) throw new FillError(problem ? `${problem}, however it was filled` : "couldn't fill", "didnt_stick");
    problem = readBack(field, answer) ?? "";
    if (!problem) return { method, way };
  }
}

export async function fillGeneric(fields: PageField[], answers: Answer[], files: { resume: FileData | null; coverLetter: FileData | null }, options: { dropdownFirst?: DropdownMethod; dropdownWays?: DropdownMethod[] } = {}) {
  const filled: string[] = [];
  const failed: FillFailure[] = [];
  const attempts: FillAttempt[] = [];
  const byId = new Map(answers.map((answer) => [answer.id, answer]));
  // Uploads go first: many sites read the resume and fill fields from it, which would overwrite answers
  // typed before it finished.
  const ordered = [...fields.filter((field) => field.type === "file"), ...fields.filter((field) => field.type !== "file")];
  const uploads = uploadPlan(fields, files);
  separateCountryCode = fields.some((field) => COUNTRY_CODE.test(field.label));
  dropdownWays = options.dropdownWays ?? waysFrom(options.dropdownFirst);
  const site = location.hostname;
  const done: Array<{ field: PageField; answer: Answer; way: number; attempt: FillAttempt }> = [];
  const fail = (field: PageField, attempt: FillAttempt, error: unknown) => {
    const known = error instanceof FillError ? error : null;
    attempt.ok = false;
    attempt.problem = known?.problem ?? "error";
    attempt.reason = (error instanceof Error ? error.message : "couldn't fill").slice(0, 200);
    failed.push({ label: field.label, reason: attempt.reason, id: field.id, ...(known?.problem === "no_option" && known.options.length ? { options: known.options } : {}) });
  };
  let uploaded = false;
  for (const field of ordered) {
    if (uploaded && field.type !== "file") {
      uploaded = false;
      await settleAfterUpload();
    }
    const given = byId.get(field.id);
    const isFile = field.type === "file";
    // Files are attached even without a mapped answer, when the form asks for a resume or cover letter.
    if (isFile ? !uploads.has(field.id) : !given?.values.length) continue;
    const answer = given ?? { id: field.id, label: field.label, type: field.type, required: field.required, values: [field.label], source: null, why: null };
    const attempt: FillAttempt = { site, label: field.label.slice(0, 200), type: field.type, answer: brief(field, answer.values.join(", ")), method: "", ok: true };
    attempts.push(attempt);
    try {
      const { method, way } = await fillChecked(field, answer, files);
      attempt.method = method;
      done.push({ field, answer, way, attempt });
      if (field.type === "file") {
        uploaded = true;
        uploadedHere.add(`${location.pathname}|${field.label}`);
      }
    } catch (error) {
      fail(field, attempt, error);
    }
  }
  // A late re-render can clear what was just typed. Read everything back once more; what's gone gets the
  // next way of filling it, and only what still doesn't stick is reported.
  if (done.length) await sleep(250);
  for (const item of done) {
    if (!readBack(item.field, item.answer)) continue;
    try {
      const { method } = await fillChecked(item.field, item.answer, files, item.way + 1);
      item.attempt.method = `${item.attempt.method}, then ${method}`;
    } catch (error) {
      fail(item.field, item.attempt, error);
      item.attempt.reason = `cleared after filling: ${item.attempt.reason}`;
    }
  }
  for (const item of done) if (item.attempt.ok) filled.push(item.field.label);
  return { filled, failed, attempts };
}

// What sites show while they read an uploaded resume to fill the form themselves (Lever, Ashby, Workday).
const READING = /(analy[sz]ing|parsing|uploading|reading|processing|scanning) (your )?(r[eé]sum[eé]|cv|file|document)|autofill(ing)? (in progress|your application)/i;

/** Waits (up to six seconds) for a site to finish reading an uploaded resume, so it can't overwrite answers typed after. */
async function settleAfterUpload() {
  await sleep(700);
  const until = Date.now() + 6000;
  while (Date.now() < until && READING.test(document.body.innerText || "")) await sleep(250);
}
