import { press, sleep, waitFor } from "./dom";
import { deepAll } from "./scan";

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
    const entries = () => group.querySelectorAll("[role=group][aria-labelledby$='-panel']").length;
    for (let tries = 0; entries() < count && tries < count + 2; tries += 1) {
      const button = Array.from(group.querySelectorAll<HTMLElement>("[data-automation-id='add-button']")).filter((el) => el.closest("[role=group]") === group).pop();
      if (!button) break;
      const before = entries();
      button.scrollIntoView({ block: "center" });
      press(button);
      if (!(await waitFor(() => entries() > before, 3000))) break;
      added += 1;
      await sleep(250);
    }
  }
  return added;
}
