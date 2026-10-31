/** Where a Workday application is: its step bar's current step. */
export type Step = { index: number; total: number; name: string };

/** "step 3 of 6 (My Experience)", or "the start" for a page without the step bar. */
export const stepText = (step: Step | null) => (step ? `step ${step.index} of ${step.total}${step.name ? ` (${step.name})` : ""}` : "the start");

/**
 * Whether a press sent the application backward: to an earlier step, or out of the steps and back to
 * Workday's "how do you want to apply" choice (no step bar, an Apply choice showing).
 */
export function wentBack(before: Step | null, after: Step | null, applyShown: boolean) {
  if (!before) return false;
  if (!after) return applyShown;
  return after.total === before.total && after.index < before.index;
}

/** One press, for the record kept while Unnepo works through an application. */
export type PressRecord = { label: string; id: string; overlay: boolean; from: Step | null; to?: Step | null };

/** The record as one line for the issues list: "Save and Continue [pageFooterNextButton] step 2 → step 3". */
export function pressLine(item: PressRecord) {
  const how = [item.id && `[${item.id}]`, item.overlay && "via overlay"].filter(Boolean).join(" ");
  return `"${item.label}"${how ? ` ${how}` : ""}: ${stepText(item.from)} → ${item.to === undefined ? "?" : stepText(item.to)}`;
}
