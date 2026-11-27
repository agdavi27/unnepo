/**
 * What the student can do about a failed tailor or cover letter, right where it failed: a row in the button's menu
 * (or the letter writer) that fixes it, instead of only a message. The server's error code says which:
 *   - Unnepo was updated since the page opened: refresh the page.
 *   - not connected, no resume, a resume Unnepo can't read, no profile, or today's limit reached: open the side panel,
 *     where each of those is fixed (connect, add or switch a resume, finish the profile, see Pro).
 *   - anything else (the AI's answer didn't hold up, a network blip): try again.
 */

export type Failure = { error?: string | null; code?: string; status?: number };
export type Fix = { kind: "retry" | "panel" | "reload"; label: string; hint: string };

const STALE = /refresh this page|extension context invalidated/i;
const PANEL_CODES: Record<string, string> = {
  no_resume: "Add a resume in the side panel",
  resume_text: "Upload a different resume in the side panel",
  profile: "Finish your profile in the side panel",
  resumes: "None left today on Free. See Pro in the side panel",
  letters: "None left today on Free. See Pro in the side panel",
  answers: "None left today on Free. See Pro in the side panel",
};

export function fixesFor(failure: Failure): Fix[] {
  const error = failure.error ?? "";
  if (STALE.test(error)) return [{ kind: "reload", label: "↻ Refresh this page", hint: "Unnepo was updated since this page opened" }];
  if (failure.status === 401 || /connect the extension|sign in/i.test(error)) return [{ kind: "panel", label: "Connect Unnepo", hint: "Opens the side panel to sign in" }];
  const panel = failure.code ? PANEL_CODES[failure.code] : undefined;
  if (panel) return [{ kind: "panel", label: "Fix it in Unnepo", hint: panel }];
  if (failure.code === "job" || /open the job posting/i.test(error)) {
    return [{ kind: "retry", label: "↻ Try again", hint: "Once the job's page has loaded" }, { kind: "panel", label: "Open Unnepo", hint: "Paste the job description in the side panel" }];
  }
  return [{ kind: "retry", label: "↻ Try again", hint: "Usually works on a second try" }];
}

/** Opens the side panel for this tab (Chrome allows it right after a click), else says where it is. */
export async function openPanel() {
  const got = await (chrome.runtime.sendMessage({ type: "open-panel" }) as Promise<{ ok?: boolean }>).catch(() => null);
  return Boolean(got?.ok);
}
