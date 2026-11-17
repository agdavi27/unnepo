/**
 * "How Unnepo works", inside the side panel: the panel dims, and an arrow points at the real part of it each step
 * talks about (the spider, then the Home, Tools, Jobs and Me tabs), switching to that tab as it goes. It opens by itself
 * the first time the panel opens connected, never again after that; Me → "Show me how it works" brings it back.
 */

export const WALKTHROUGH_SEEN = "walkthroughSeen";

type Tab = "home" | "jobs" | "tools" | "settings";
type Step = { target: string; tab: Tab | null; title: string; body: string };

const STEPS: Step[] = [
  {
    target: "#spider", tab: null, title: "Hi! This is Unnepo",
    body: "It lives in this panel, beside the job you're looking at. On job pages a little spider drops in at the top right. Click it to open this panel.",
  },
  {
    target: "[data-tab='jobs']", tab: "jobs", title: "Home",
    body: "The graph shows every day you did something, with your streak and weekly goal. Under it, add friends and see who applied to the most jobs this week.",
  },
  {
    target: "[data-tab='tools']", tab: "tools", title: "Tools",
    body: "Write a cover letter for the job on your tab, answer questions like \"Why do you want to work here?\", autofill an application, or add a job by hand.",
  },
  {
    target: "[data-tab='home']", tab: "home", title: "Jobs: your tracker",
    body: "Jobs you apply to on Indeed, LinkedIn, Handshake and company sites are caught by themselves and kept here, each with its next step.",
  },
  {
    target: "[data-tab='home']", tab: "home", title: "Find people to email",
    body: "Open a job, then pick Find with LinkedIn (names from LinkedIn, guessed emails, free) or Find verified emails (checked work emails). Unnepo reminds you when to follow up.",
  },
  {
    target: "[data-tab='settings']", tab: "settings", title: "Me",
    body: "Your profile, your plan and what's left, and settings. Want this tour again? It's here under Show me how it works.",
  },
];

let root: HTMLElement | null = null;
let step = 0;
let showTab: (tab: Tab) => void = () => undefined;
let place = () => undefined as void;

/** Opens the tour at its first step. `go` switches the panel to a tab. */
export function startWalkthrough(go: (tab: Tab) => void) {
  showTab = go;
  step = 0;
  if (!root) build();
  drawStep();
}

/** The first time the panel opens connected: the tour, once. */
let checked = false;
export async function walkthroughOnce(go: (tab: Tab) => void) {
  // Asked once per panel opening: the panel redraws often.
  if (checked) return;
  checked = true;
  const stored = await chrome.storage.local.get(WALKTHROUGH_SEEN).catch(() => ({} as Record<string, unknown>));
  if (stored[WALKTHROUGH_SEEN] || root) return;
  // Marked as soon as it shows, so closing the panel halfway doesn't bring it back every time.
  await chrome.storage.local.set({ [WALKTHROUGH_SEEN]: new Date().toISOString() }).catch(() => undefined);
  startWalkthrough(go);
}

function close() {
  root?.remove();
  root = null;
  window.removeEventListener("resize", place);
  document.removeEventListener("keydown", onKey, true);
  void chrome.storage.local.set({ [WALKTHROUGH_SEEN]: new Date().toISOString() }).catch(() => undefined);
}

function onKey(event: KeyboardEvent) {
  if (!root) return;
  if (event.key === "Escape") { event.preventDefault(); close(); }
  else if (event.key === "ArrowRight") { event.preventDefault(); next(); }
  else if (event.key === "ArrowLeft" && step > 0) { event.preventDefault(); step -= 1; drawStep(); }
}

function next() {
  if (step >= STEPS.length - 1) return close();
  step += 1;
  drawStep();
}

function build() {
  root = document.createElement("div");
  root.className = "tour";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-labelledby", "tour-title");
  root.innerHTML = `
    <div class="tour-hole" aria-hidden="true"></div>
    <svg class="tour-arrow" width="34" height="44" viewBox="0 0 34 44" fill="none" aria-hidden="true"><path d="M17 42V5M17 5L4 18M17 5l13 13" stroke="#FFD34D" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>
    <div class="tour-card">
      <button type="button" class="tour-x" aria-label="Close the tour">×</button>
      <p class="tour-count"></p>
      <h2 id="tour-title" class="tour-title"></h2>
      <p class="tour-body"></p>
      <div class="tour-foot">
        <div class="tour-dots"></div>
        <div class="tour-buttons">
          <button type="button" class="btn tour-back">Back</button>
          <button type="button" class="btn primary tour-next">Next</button>
        </div>
      </div>
    </div>`;
  root.querySelector(".tour-x")!.addEventListener("click", close);
  root.querySelector(".tour-next")!.addEventListener("click", next);
  root.querySelector(".tour-back")!.addEventListener("click", () => { if (step > 0) { step -= 1; drawStep(); } });
  // A click on the dimmed panel doesn't reach what's under it.
  root.addEventListener("click", (event) => event.stopPropagation());
  document.body.append(root);
  place = () => position();
  window.addEventListener("resize", place);
  document.addEventListener("keydown", onKey, true);
}

function drawStep() {
  if (!root) return;
  const current = STEPS[step];
  if (current.tab) showTab(current.tab);
  root.querySelector(".tour-count")!.textContent = `How Unnepo works · ${step + 1} of ${STEPS.length}`;
  root.querySelector(".tour-title")!.textContent = current.title;
  root.querySelector(".tour-body")!.textContent = current.body;
  root.querySelector<HTMLButtonElement>(".tour-back")!.hidden = step === 0;
  root.querySelector(".tour-next")!.textContent = step === STEPS.length - 1 ? "Done" : "Next";
  root.querySelector(".tour-dots")!.innerHTML = STEPS.map((_, index) => `<span class="${index === step ? "on" : ""}"></span>`).join("");
  // The tab's page draws a moment after it's picked: place the arrow now and again once it has.
  position();
  requestAnimationFrame(position);
  setTimeout(position, 150);
  root.querySelector<HTMLButtonElement>(".tour-next")!.focus();
}

/** Whether the part a step points at is on the page and can be seen (the spider is hidden while he's off typing). */
function shown(target: HTMLElement | null) {
  if (!target) return false;
  const rect = target.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && getComputedStyle(target).visibility !== "hidden";
}

/**
 * Puts the hole around the part this step talks about, the arrow at it, and the card beside it, so all three fit
 * whatever size the panel is. Chrome doesn't let an extension set its side panel's width, so the tour fits the panel
 * instead: the part is scrolled into view, and the card goes on the side with room for it, measured, never on top
 * of the part, and scrolls inside itself when the panel is too short for all of it.
 */
function position() {
  if (!root) return;
  let target = document.querySelector<HTMLElement>(STEPS[step].target);
  // The spider is off typing on a job's page (hidden up here): point at the logo and his line instead of nothing.
  if (!shown(target) && STEPS[step].target === "#spider") target = document.querySelector<HTMLElement>(".top-text");
  const hole = root.querySelector<HTMLElement>(".tour-hole")!;
  const arrow = root.querySelector<SVGElement>(".tour-arrow")!;
  const card = root.querySelector<HTMLElement>(".tour-card")!;
  if (!target || !shown(target)) {
    // Nothing to point at: the card in the middle, the whole panel dimmed.
    hole.style.cssText = "left:50%;top:50%;width:0;height:0;";
    arrow.style.display = "none";
    card.style.cssText = `top:50%;transform:translateY(-50%);max-height:${window.innerHeight - 24}px;overflow-y:auto;`;
    return;
  }
  // Scrolled out of sight (the spider, once the page is scrolled down): bring it back first.
  let rect = target.getBoundingClientRect();
  if (rect.top < 0 || rect.bottom > window.innerHeight) {
    target.scrollIntoView({ block: "nearest", behavior: "instant" as ScrollBehavior });
    rect = target.getBoundingClientRect();
  }
  const pad = 6;
  const gap = 54;
  const edge = 10;
  hole.style.cssText = `left:${rect.left - pad}px;top:${Math.max(rect.top - pad, 2)}px;width:${rect.width + pad * 2}px;height:${Math.min(rect.height + pad * 2, window.innerHeight - 4)}px;`;
  arrow.style.display = "";
  const centre = rect.left + rect.width / 2;
  const arrowLeft = Math.min(Math.max(centre - 17, 8), window.innerWidth - 42);
  // The card's real height at this width, with nothing limiting it.
  card.style.cssText = "top:0;visibility:hidden;";
  const needed = card.offsetHeight;
  const roomBelow = window.innerHeight - (rect.bottom + pad + gap) - edge;
  const roomAbove = rect.top - pad - gap - edge;
  // Under the part when it fits there (the spider at the top), else over it (the tabs along the bottom), else
  // whichever side has more room, with the card scrolling inside itself.
  const below = needed <= roomBelow || (needed > roomAbove && roomBelow >= roomAbove);
  const room = Math.max(below ? roomBelow : roomAbove, 120);
  const fit = needed > room ? `max-height:${room}px;overflow-y:auto;` : "";
  if (below) {
    arrow.style.cssText = `left:${arrowLeft}px;top:${rect.bottom + pad + 4}px;`;
    arrow.classList.remove("down");
    card.style.cssText = `top:${rect.bottom + pad + gap}px;${fit}`;
  } else {
    arrow.style.cssText = `left:${arrowLeft}px;top:${rect.top - pad - 48}px;`;
    arrow.classList.add("down");
    card.style.cssText = `bottom:${window.innerHeight - rect.top + pad + gap}px;${fit}`;
  }
}
