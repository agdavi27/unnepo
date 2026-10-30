import { bestOption } from "@/lib/apply/options";
import { answerChoices } from "@/lib/apply/questions";
import type { Answer, FileData, PageField } from "../shared/types";
import { attachFile, chooseCustom, chooseNativeSelect, press, sleep, typeInto, YES } from "./dom";
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

async function fillOne(field: PageField, answer: Answer, files: { resume: FileData | null; coverLetter: FileData | null }) {
  const el = findMarked(field.id);
  if (!el) throw new Error("not on the page");
  let value = answer.values[0] ?? "";
  // The number box next to a country code dropdown gets just the number.
  if (separateCountryCode && (field.type === "tel" || PHONE_NUMBER.test(field.label)) && !COUNTRY_CODE.test(field.label) && !/type|extension|\bext\b/i.test(field.label) && field.type !== "select" && field.type !== "combobox") {
    value = nationalNumber(value) || value;
  }
  switch (field.type) {
    case "radio": {
      const name = (el as HTMLInputElement).name;
      const radios = Array.from(rootOf(el).querySelectorAll<HTMLInputElement>(`input[type=radio][name="${CSS.escape(name)}"]`));
      const labels = radios.map(labelOf);
      const choice = pickLabel(value, labels);
      if (!choice) throw new Error(`no option matching "${value}"`);
      press(radios[labels.indexOf(choice)]);
      return;
    }
    case "checkbox": {
      const box = el as HTMLInputElement;
      if (YES.test(value) !== box.checked) press(box);
      return;
    }
    case "multiselect": {
      for (const box of Array.from(el.querySelectorAll<HTMLInputElement>("input[type=checkbox]"))) {
        const wanted = answer.values.some((chosen) => pickLabel(chosen, [labelOf(box)]));
        if (wanted !== box.checked) press(box);
      }
      return;
    }
    case "select":
      chooseNativeSelect(el as HTMLSelectElement, value);
      return;
    case "combobox":
      // Searchable boxes filter as you type; button dropdowns just open.
      await chooseCustom(el, value, { type: el instanceof HTMLInputElement ? value : undefined });
      return;
    case "file": {
      const file = fileFor(field, files);
      if (!file) throw new Error("no file");
      attachFile(el as HTMLInputElement, file);
      return;
    }
    default:
      typeInto(el as HTMLInputElement | HTMLTextAreaElement, value);
  }
}

// What sites show while they read an uploaded resume to fill the form themselves (Lever, Ashby, Workday).
const READING = /(analy[sz]ing|parsing|uploading|reading|processing|scanning) (your )?(r[eé]sum[eé]|cv|file|document)|autofill(ing)? (in progress|your application)/i;

/** Waits (up to six seconds) for a site to finish reading an uploaded resume, so it can't overwrite answers typed after. */
async function settleAfterUpload() {
  await sleep(700);
  const until = Date.now() + 6000;
  while (Date.now() < until && READING.test(document.body.innerText || "")) await sleep(250);
}

export async function fillGeneric(fields: PageField[], answers: Answer[], files: { resume: FileData | null; coverLetter: FileData | null }) {
  const filled: string[] = [];
  const failed: Array<{ label: string; reason: string }> = [];
  const byId = new Map(answers.map((answer) => [answer.id, answer]));
  // Uploads go first: many sites read the resume and fill fields from it, which would overwrite answers
  // typed before it finished.
  const ordered = [...fields.filter((field) => field.type === "file"), ...fields.filter((field) => field.type !== "file")];
  const uploads = uploadPlan(fields, files);
  separateCountryCode = fields.some((field) => COUNTRY_CODE.test(field.label));
  let uploaded = false;
  for (const field of ordered) {
    if (uploaded && field.type !== "file") {
      uploaded = false;
      await settleAfterUpload();
    }
    const answer = byId.get(field.id);
    const isFile = field.type === "file";
    // Files are attached even without a mapped answer, when the form asks for a resume or cover letter.
    if (isFile ? !uploads.has(field.id) : !answer?.values.length) continue;
    try {
      await fillOne(field, answer ?? { id: field.id, label: field.label, type: field.type, required: field.required, values: [field.label], source: null, why: null }, files);
      filled.push(field.label);
      if (field.type === "file") {
        uploaded = true;
        uploadedHere.add(`${location.pathname}|${field.label}`);
      }
    } catch (error) {
      failed.push({ label: field.label, reason: error instanceof Error ? error.message : "couldn't fill" });
    }
  }
  return { filled, failed };
}
