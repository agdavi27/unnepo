import { press, sleep, waitFor } from "./dom";
import { deepAll, findMarked } from "./scan";

/** Entries Unnepo added itself: only these are ever taken away again. */
const ADDED = "data-unnepo-added";
const PANEL = "[role=group][aria-labelledby$='-panel']";

/**
 * Workday's repeating sections (Work Experience, Education): "Add" / "Add Another" is pressed until the section
 * has as many entries as the profile has jobs or schools. Entries already there (the student's, or Workday's
 * from the resume) count. How many it added.
 */
export async function addEntries(want: { experience?: number; education?: number; websites?: number }) {
  let added = 0;
  const sections: Array<[RegExp, number]> = [[/^(work )?experience|^employment|^work history/i, want.experience ?? 0], [/^education/i, want.education ?? 0], [/^(websites?|web sites?|links)$/i, want.websites ?? 0]];
  for (const [heading, count] of sections) {
    const group = deepAll<HTMLElement>("[role=group]").find((el) => heading.test((el.querySelector("h2, h3, h4")?.textContent ?? "").trim()) && el.querySelector("[data-automation-id='add-button']"));
    if (!group || !count) continue;
    const entries = () => group.querySelectorAll(PANEL).length;
    for (let tries = 0; entries() < count && tries < count + 2; tries += 1) {
      const button = Array.from(group.querySelectorAll<HTMLElement>("[data-automation-id='add-button']")).filter((el) => el.closest("[role=group]") === group).pop();
      if (!button) break;
      const before = entries();
      button.scrollIntoView({ block: "center" });
      press(button);
      if (!(await waitFor(() => entries() > before, 3000))) break;
      group.querySelectorAll(PANEL)[entries() - 1]?.setAttribute(ADDED, "");
      added += 1;
      await sleep(250);
    }
  }
  return added;
}

/**
 * A school Workday's list doesn't have (a high school, often): the Education entry Unnepo added for it is deleted
 * again, rather than left half filled for the student to clean up. Entries the student or Workday made stay.
 * The ids of the boxes that went with it, so their failures aren't reported.
 */
export async function dropUnfoundSchools(failed: Array<{ label: string; id?: string }>) {
  const gone = new Set<string>();
  for (const item of failed) {
    if (!item.id || !/\b(school|university|college|institution)\b/i.test(item.label) || /\b(year|date|from|to)\b/i.test(item.label)) continue;
    const panel = findMarked(item.id)?.closest<HTMLElement>(PANEL);
    if (!panel?.hasAttribute(ADDED) || !/education/i.test(panel.closest("[role=group]:not([aria-labelledby$='-panel'])")?.querySelector("h2, h3, h4")?.textContent ?? "education")) continue;
    const remove = Array.from(panel.querySelectorAll<HTMLElement>("button")).find((button) => /^delete\b/i.test((button.textContent ?? "").trim()) || button.getAttribute("data-automation-id") === "panel-set-delete-button");
    if (!remove) continue;
    panel.querySelectorAll("[data-unnepo-id]").forEach((el) => gone.add(el.getAttribute("data-unnepo-id")!));
    gone.add(item.id);
    remove.scrollIntoView({ block: "center" });
    press(remove);
    await waitFor(() => !panel.isConnected, 3000);
    await sleep(250);
  }
  return gone;
}
