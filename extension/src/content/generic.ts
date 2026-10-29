import { bestOption } from "@/lib/apply/options";
import { answerChoices } from "@/lib/apply/questions";
import type { Answer, FileData, PageField } from "../shared/types";
import { attachFile, chooseCustom, chooseNativeSelect, press, typeInto, YES } from "./dom";
import { labelOf } from "./scan";

/**
 * Any other form (Lever, Ashby, company career sites): filled by the data-unnepo-id the scanner set on
 * each field. Covers text, native selects, radio groups, checkboxes and checkbox groups, custom
 * dropdowns, and file uploads.
 */

const COVER_LETTER = /cover ?letter|letter of (interest|motivation)|motivation(al)? letter/i;

function pickLabel(answer: string, labels: string[]) {
  return answerChoices(answer).map((candidate) => bestOption(candidate, labels)).find(Boolean) ?? null;
}

async function fillOne(field: PageField, answer: Answer, files: { resume: FileData | null; coverLetter: FileData | null }) {
  const el = document.querySelector<HTMLElement>(`[data-unnepo-id="${field.id}"]`);
  if (!el) throw new Error("not on the page");
  const value = answer.values[0] ?? "";
  switch (field.type) {
    case "radio": {
      const name = (el as HTMLInputElement).name;
      const radios = Array.from(document.querySelectorAll<HTMLInputElement>(`input[type=radio][name="${CSS.escape(name)}"]`));
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
      const file = COVER_LETTER.test(field.label) ? files.coverLetter : files.resume;
      if (!file) throw new Error("no file");
      attachFile(el as HTMLInputElement, file);
      return;
    }
    default:
      typeInto(el as HTMLInputElement | HTMLTextAreaElement, value);
  }
}

export async function fillGeneric(fields: PageField[], answers: Answer[], files: { resume: FileData | null; coverLetter: FileData | null }) {
  const filled: string[] = [];
  const failed: Array<{ label: string; reason: string }> = [];
  const byId = new Map(answers.map((answer) => [answer.id, answer]));
  for (const field of fields) {
    const answer = byId.get(field.id);
    const isFile = field.type === "file";
    // Files are attached even without a mapped answer, when the form asks for a resume or cover letter.
    if (!answer?.values.length && !(isFile && (/resume|cv\b/i.test(field.label) ? files.resume : COVER_LETTER.test(field.label) ? files.coverLetter : null))) continue;
    try {
      await fillOne(field, answer ?? { id: field.id, label: field.label, type: field.type, required: field.required, values: [field.label], source: null, why: null }, files);
      filled.push(field.label);
    } catch (error) {
      failed.push({ label: field.label, reason: error instanceof Error ? error.message : "couldn't fill" });
    }
  }
  return { filled, failed };
}
