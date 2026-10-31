import { watchEdits } from "@/extension/src/content/edits";
import { fillGeneric } from "@/extension/src/content/generic";
import { keptByStudent } from "@/extension/src/content/kept";
import { celebrateSpiders } from "@/extension/src/content/spiders";
import { scanFields } from "@/extension/src/content/scan";
import type { Answer, DropdownMethod } from "@/extension/src/shared/types";

/**
 * Runs the extension's real scanner and filler on a practice page: window.practice(answers by question,
 * ways) fills the page and returns the fill report next to what the page itself says it holds. Like Fill,
 * it leaves alone what was typed into the page by hand. window.celebrate() runs the spiders' dance.
 */

declare global {
  interface Window {
    practice: (answers: Record<string, string | string[]>, ways?: DropdownMethod[]) => Promise<unknown>;
    /** Each practice page's own record of what it holds, by question. */
    pageValues: () => Record<string, string>;
    celebrate: () => void;
  }
}

window.practice = async (answers, ways) => {
  const fields = scanFields();
  const list: Answer[] = fields.flatMap((field) => {
    const given = answers[field.label];
    return given ? [{ id: field.id, label: field.label, type: field.type, required: field.required, values: ([] as string[]).concat(given), source: "practice", why: null }] : [];
  });
  const kept = list.filter((answer) => keptByStudent(answer, false));
  const started = Date.now();
  const report = await fillGeneric(fields, list.filter((answer) => !kept.includes(answer)), { resume: null, coverLetter: null }, { dropdownWays: ways });
  return { scanned: fields.map((field) => `${field.type}: ${field.label}`), ...report, kept: kept.map((answer) => answer.label), holds: window.pageValues(), ms: Date.now() - started };
};
window.celebrate = celebrateSpiders;
watchEdits();
