import type { Answer, PageField } from "./types";

/**
 * "Date" on a signature or self-ID form (Workday's "Voluntary Self-Identification of Disability") is the day the
 * student fills it in: today, by their own computer's clock. A job's or school's dates are never this.
 */
const TODAY = /^(today'?s date|date|current date|date signed|signed date|signature date|date of signature|date \(mm\/dd\/yyyy\))$/i;
const ENTRY = /experience|employment|work history|education|school|degree/i;

export function isTodayField(field: Pick<PageField, "label" | "section" | "type">) {
  if (ENTRY.test(field.section ?? "") || !["text", "date", "combobox", "select"].includes(field.type)) return false;
  const base = field.label.replace(/\s*\((month|day|year)\)\s*$/i, "").replace(/[*:\s]+$/, "").trim();
  return TODAY.test(base);
}

/** Today in the box's own format: just the month ("MM"), day or year for Workday's split date, or the whole date. */
export function todayFor(format: string | null | undefined, now = new Date()) {
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const yyyy = String(now.getFullYear());
  const want = (format ?? "").toUpperCase();
  if (want === "MM") return mm;
  if (want === "DD") return dd;
  if (want === "YYYY") return yyyy;
  if (/^YYYY-MM-DD$/.test(want)) return `${yyyy}-${mm}-${dd}`;
  if (/^DD.MM.YYYY$/.test(want)) return `${dd}/${mm}/${yyyy}`;
  return `${mm}/${dd}/${yyyy}`;
}

/** The answers, with today's date added for each date box the server had nothing for. */
export function withToday(fields: PageField[], answers: Answer[], now = new Date()): Answer[] {
  const known = new Set(answers.filter((answer) => answer.values.length).map((answer) => answer.id));
  const added = fields.filter((field) => !known.has(field.id) && isTodayField(field)).map((field): Answer => ({
    id: field.id, label: field.label, type: field.type, required: field.required, values: [todayFor(field.format, now)], source: "default", why: null,
  }));
  return added.length ? [...answers.filter((answer) => !added.some((item) => item.id === answer.id)), ...added] : answers;
}
