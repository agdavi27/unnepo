import { bestOption, degreeAnswer } from "@/lib/apply/options";
import type { Answer, FileData, FillAttempt, FillFailure } from "../shared/types";
import { attachFile, chooseCustom, FillError, press, typeInto, waitFor } from "./dom";
import { labelOf } from "./scan";

/**
 * Greenhouse's hosted form, filled by the stable ids its API gives every field. Dropdowns are React
 * selects whose input id is the field name; their options appear as #react-select-{id}-option-N.
 * Multi-selects are checkbox groups; files go into the hidden inputs behind "Attach".
 */

const byId = (id: string) => document.getElementById(id);
const options = (id: string) => () => Array.from(document.querySelectorAll<HTMLElement>(`[id^="react-select-${CSS.escape(id)}-option-"]`));

/** What a field shows now: typed text, the chosen option, ticked boxes, or an attached file. */
export function greenhouseValue(id: string, type: string) {
  if (type === "multiselect") return document.getElementById(id)?.querySelector("input[type=checkbox]:checked") ? "checked" : "";
  const el = byId(id) as HTMLInputElement | null;
  if (!el) return "";
  if (el.type === "file") return el.files?.length ? el.files[0].name : "";
  if (el.getAttribute("role") === "combobox") return el.closest(".select")?.querySelector("[class*='single-value'], [class*='multi-value']")?.textContent?.trim() ?? "";
  return el.value.trim();
}

async function fillOne(answer: Answer, files: { resume: FileData | null; coverLetter: FileData | null }): Promise<string | void> {
  const value = answer.values[0] ?? "";
  const el = byId(answer.id);
  switch (answer.type) {
    case "text":
    case "email":
    case "tel":
    case "textarea":
      if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) throw new FillError("not on the page", "not_on_page");
      typeInto(el, value);
      return;
    case "file": {
      const file = answer.id === "cover_letter" ? files.coverLetter : files.resume;
      if (!(el instanceof HTMLInputElement) || !file) throw file ? new FillError("not on the page", "not_on_page") : new FillError("no file", "no_file");
      attachFile(el, file);
      return;
    }
    case "multiselect": {
      const group = el ?? document.getElementById(`${answer.id}`);
      if (!group) throw new FillError("not on the page", "not_on_page");
      for (const box of Array.from(group.querySelectorAll<HTMLInputElement>("input[type=checkbox]"))) {
        const wanted = answer.values.some((chosen) => bestOption(chosen, [labelOf(box)]));
        if (wanted !== box.checked) press(box);
      }
      return;
    }
    case "phone_country":
      if (!(el instanceof HTMLInputElement)) throw new FillError("not on the page", "not_on_page");
      return chooseCustom(el, value, { type: value, list: options(answer.id), pick: (texts) => texts.find((text) => text.toLowerCase().startsWith(value.toLowerCase())) ?? bestOption(value, texts) });
    case "location": {
      if (!(el instanceof HTMLInputElement)) throw new FillError("not on the page", "not_on_page");
      // "Waterville, Maine": type the city, then pick the suggestion that also names the state.
      const [city, state] = value.split(",").map((part) => part.trim());
      return chooseCustom(el, value, { type: city, list: options(answer.id), pick: (texts) => texts.find((text) => text.toLowerCase().startsWith(city.toLowerCase()) && (!state || text.toLowerCase().includes(state.toLowerCase()))) ?? (texts.length === 1 ? texts[0] : null) });
    }
    case "school":
      if (!(el instanceof HTMLInputElement)) throw new FillError("not on the page", "not_on_page");
      return chooseCustom(el, value, { type: value, list: options(answer.id), pick: (texts) => bestOption(value, texts) ?? texts.find((text) => /^other$/i.test(text)) ?? null });
    case "degree":
      if (!(el instanceof HTMLInputElement)) throw new FillError("not on the page", "not_on_page");
      return chooseCustom(el, value, { list: options(answer.id), pick: (texts) => degreeAnswer(value, texts) });
    default:
      // A dropdown: React select renders every option once it's open, so no typing is needed.
      if (!(el instanceof HTMLInputElement)) throw new FillError("not on the page", "not_on_page");
      return chooseCustom(el, value, { list: options(answer.id) });
  }
}

/** Waits for React to take over the server-rendered form; typing before that is wiped. */
export async function greenhouseReady() {
  await waitFor(() => {
    const el = byId("first_name");
    return Boolean(el && Object.keys(el).some((key) => key.startsWith("__react")));
  }, 5000);
}

export async function fillGreenhouse(answers: Answer[], files: { resume: FileData | null; coverLetter: FileData | null }) {
  await greenhouseReady();
  const filled: string[] = [];
  const failed: FillFailure[] = [];
  const attempts: FillAttempt[] = [];
  // The resume goes in even when the server didn't list it (a profile without its file name, say).
  if (files.resume && byId("resume") && !answers.some((answer) => answer.id === "resume")) {
    answers = [...answers, { id: "resume", label: "Resume/CV", type: "file", required: true, values: [files.resume.name], source: "resume_file", why: null }];
  }
  for (const answer of answers) {
    if (!answer.values.length) continue;
    if (!byId(answer.id)) continue; // fields the form may add (education, phone country) only when present
    const attempt: FillAttempt = { site: location.hostname, label: answer.label.slice(0, 200), type: answer.type, answer: answer.type === "select" || answer.type === "multiselect" ? answer.values.join(", ").slice(0, 60) : "", method: "greenhouse", ok: true };
    attempts.push(attempt);
    try {
      attempt.method = (await fillOne(answer, files)) ?? "greenhouse";
      filled.push(answer.label);
    } catch (error) {
      const known = error instanceof FillError ? error : null;
      Object.assign(attempt, { ok: false, problem: known?.problem ?? "error", reason: (error instanceof Error ? error.message : "couldn't fill").slice(0, 200) });
      failed.push({ label: answer.label, reason: attempt.reason!, id: answer.id });
    }
  }
  // A late re-render can clear a typed box; type those once more.
  for (const answer of answers) {
    if (!["text", "email", "tel", "textarea"].includes(answer.type) || !filled.includes(answer.label) || greenhouseValue(answer.id, answer.type)) continue;
    const el = byId(answer.id);
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) typeInto(el, answer.values[0]);
  }
  return { filled, failed, attempts };
}
