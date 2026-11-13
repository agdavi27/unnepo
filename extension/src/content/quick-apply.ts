/** Job boards where applying is often one press, with no confirmation page: Handshake, LinkedIn (Easy Apply), ZipRecruiter, Indeed… */
export const QUICK_BOARDS = /(^|\.)((joinhandshake|linkedin|ziprecruiter|indeed|simplyhired|wellfound|glassdoor|dice|builtin|monster|careerbuilder|wayup)\.com|simplify\.jobs|idealist\.org|usajobs\.gov)$/;
// An Apply press. `FINAL` ones send the application right away; plain "Apply" may open a form first.
const APPLY_PRESS = /^(1-click apply|one-click apply|quick apply|easy apply|instant apply|apply|apply now|submit( my)? application|send( my)? application|submit|apply with (my )?(profile|resume))$/i;
const FINAL_PRESS = /1-click|one-click|quick apply|instant apply|submit|send|apply with/i;
// Apply buttons that go to the company's own site: that site's page is where the applying happens.
const ELSEWHERE = /externally|company('|’)?s? (site|website)|employer('|’)?s? (site|website)|on company site/i;
// What a job board shows once it's done: the button now says Applied, or a note says the application went.
// Short labels only, so a long paragraph that mentions "applied" doesn't count: "Applied 2 min ago", "✓ Application
// submitted to MealPal", "Your application was sent!".
const APPLIED_NOW = /^([✓✔☑]\s*)?((you )?applied|application (sent|submitted|received|complete)|you(?:'|’| ha)ve applied|already applied|your application (was |has been )?(sent|submitted|received))\b.{0,40}$/i;
// "Applied Scientist" is a job, not a status: a label that goes on with a job word isn't one.
const NOT_STATUS = /^([✓✔☑]\s*)?applied (scientist|research|mathematics|physics|ai|ml|machine|data|economist|statistic|behavior|linguist)/i;

const shortText = (el: Element) => ((el as HTMLElement).innerText || el.textContent || "").replace(/\s+/g, " ").trim();
const shown = (el: Element) => (el as HTMLElement).getBoundingClientRect().height > 0;

/**
 * "Applied" labels showing now, by their text and how many times each shows: buttons, badges and notes whose
 * whole text is the label, however deeply the board wraps it ("Applied on November 12, 2026" in Handshake's pane).
 * Compared by text, not element: boards redraw the page and the same badges come back as new elements.
 */
export function appliedLabels() {
  const counts = new Map<string, number>();
  for (const el of Array.from(document.querySelectorAll("button, a, [role=button], [role=status], [role=alert], span, p, div, li, time, small, strong, h2, h3, h4"))) {
    if (el.closest("[data-unnepo-launcher]")) continue;
    const text = shortText(el);
    if (!text || text.length > 80 || !shown(el) || !APPLIED_NOW.test(text) || NOT_STATUS.test(text)) continue;
    // Once per label: an element whose child holds the same text is the same label.
    if (Array.from(el.children).some((child) => shortText(child) === text)) continue;
    counts.set(text, (counts.get(text) ?? 0) + 1);
  }
  return counts;
}

/** A label now showing more often than before the press: the text, or "". */
export function newLabel(before: Map<string, number>, now: Map<string, number>) {
  for (const [text, count] of now) if (count > (before.get(text) ?? 0)) return text;
  return "";
}

/**
 * On job boards, watches the Apply press itself, since 1-click and quick applies often show no thank-you page:
 * the extension notes the job on the page, then the press counts once, within a minute and a half, the button
 * turns into "Applied" or a new "Applied" label shows up. Each press is its own job.
 */
export function watchApplyPresses(tell: (message: Record<string, unknown>) => void) {
  let watching = 0;
  document.addEventListener("click", (event) => {
    const button = (event.target as Element | null)?.closest<HTMLElement>("button, a, [role=button], input[type=submit]");
    const label = button ? shortText(button) || (button as HTMLInputElement).value || "" : "";
    if (!button) return;
    // Marked on the page, so reading the job later starts from the pane this button is in, not a result beside it.
    const mark = () => {
      document.querySelectorAll("[data-unnepo-pressed]").forEach((el) => el.removeAttribute("data-unnepo-pressed"));
      button.setAttribute("data-unnepo-pressed", String(Date.now()));
    };
    // "Apply on company site": the job is kept, so the company's tab that opens knows which job it is.
    if (ELSEWHERE.test(label) || /^apply( now)? (on|at) /i.test(label)) {
      mark();
      tell({ type: "apply-clicked", url: location.href, label, final: false, elsewhere: true });
      return;
    }
    if (!APPLY_PRESS.test(label)) return;
    mark();
    tell({ type: "apply-clicked", url: location.href, label, final: FINAL_PRESS.test(label) });
    // Counted, not compared one by one: job boards redraw their lists, so the same badges come back as new elements.
    const before = appliedLabels();
    const run = ++watching;
    const started = Date.now();
    const check = () => {
      if (run !== watching) return;
      // The pressed button now says Applied, by its text or its label, often turned off so it can't be pressed twice.
      const said = `${shortText(button)} ${button.getAttribute("aria-label") ?? ""}`.trim();
      const changed = button.isConnected && (APPLIED_NOW.test(shortText(button)) || (/\bapplied\b/i.test(said) && ((button as HTMLButtonElement).disabled || button.getAttribute("aria-disabled") === "true")));
      const added = newLabel(before, appliedLabels());
      if (changed || added) {
        tell({ type: "applied-detected", text: (changed ? shortText(button) : added).slice(0, 120), url: location.href });
        return;
      }
      // Two minutes: a pop-up with questions can take a while before its Submit.
      if (Date.now() - started < 120_000) setTimeout(check, 700);
    };
    setTimeout(check, 700);
  }, true);
}

