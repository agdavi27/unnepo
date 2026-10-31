/** Where a Workday application is: its step bar's current step. */
export type Step = { index: number; total: number; name: string };

/** "step 3 of 6 (My Experience)", or "the start" for a page without the step bar. */
export const stepText = (step: Step | null) => (step ? `step ${step.index} of ${step.total}${step.name ? ` (${step.name})` : ""}` : "the start");

/**
 * Whether the application went backward from the furthest step reached: to an earlier step, or out of the
 * steps and back to Workday's "how do you want to apply" choice (no step bar, an Apply choice showing).
 */
export function wentBack(before: Step | null, after: Step | null, applyShown: boolean) {
  if (!before) return false;
  if (!after) return applyShown;
  return after.total === before.total && after.index < before.index;
}
