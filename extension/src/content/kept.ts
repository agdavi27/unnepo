import type { Answer } from "../shared/types";
import { editedByStudent } from "./edits";
import { greenhouseValue } from "./greenhouse";
import { findMarked, isEmpty } from "./scan";

/** Whether the student already answered this question by hand: pressing Fill again keeps their answer. */
export function keptByStudent(answer: Answer, useServerSchema: boolean) {
  if (answer.type === "file") return false;
  const el = useServerSchema ? document.getElementById(answer.id) : findMarked(answer.id);
  if (!el || !editedByStudent(el)) return false;
  if (useServerSchema) return Boolean(greenhouseValue(answer.id, answer.type));
  const control = el.matches("input, select, textarea, button") ? el : (el.querySelector("input") as HTMLElement | null) ?? el;
  return !isEmpty(control);
}
