/**
 * "How Unnepo works", inside the side panel: the panel dims, and an arrow points at the real part of it each step
 * talks about (the spider, then the Tools, Jobs and Me tabs), switching to that tab as it goes. It opens by itself
 * the first time the panel opens connected, never again after that; Me → "Show me how it works" brings it back.
 */

export const WALKTHROUGH_SEEN = "walkthroughSeen";

type Tab = "home" | "jobs" | "settings";
type Step = { target: string; tab: Tab | null; title: string; body: string };

const STEPS: Step[] = [
  {
    target: "#spider", tab: null, title: "Hi! This is Unnepo",
    body: "It lives in this panel, beside the job you're looking at. On job pages a little spider drops in at the top right. Click it to open this panel.",
  },
  {
    target: "[data-tab='jobs']", tab: "jobs", title: "Tools",
    body: "Write a cover letter for the job on your tab, answer questions like \"Why do you want to work here?\", or add a job by hand.",
  },
  {
    target: "[data-tab='home']", tab: "home", title: "Jobs: your tracker",
    body: "Jobs you apply to on Indeed, LinkedIn, Handshake and company sites are caught by themselves and kept here, each with its next step.",
  },
  {
    target: "[data-tab='home']", tab: "home", title: "Find people to email",
    body: "Open a job and press Find people: recruiters, the team and alumni, with their emails. Unnepo reminds you when to follow up.",
  },
  {
    target: "[data-tab='settings']", tab: "settings", title: "Me",
    body: "Your plan, resume, friends and settings. Want this tour again? It's here under Show me how it works.",
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

function position() {
  if (!root) return;
  const target = document.querySelector<HTMLElement>(STEPS[step].target);
  const hole = root.querySelector<HTMLElement>(".tour-hole")!;
  const arrow = root.querySelector<SVGElement>(".tour-arrow")!;
  const card = root.querySelector<HTMLElement>(".tour-card")!;
  const rect = target && target.getBoundingClientRect().height > 0 ? target.getBoundingClientRect() : null;
  if (!rect) {
    // Nothing to point at: the card in the middle, the whole panel dimmed.
    hole.style.cssText = "left:50%;top:50%;width:0;height:0;";
    arrow.style.display = "none";
    card.style.cssText = "top:50%;transform:translateY(-50%);";
    return;
  }
  const pad = 6;
  hole.style.cssText = `left:${rect.left - pad}px;top:${rect.top - pad}px;width:${rect.width + pad * 2}px;height:${rect.height + pad * 2}px;`;
  arrow.style.display = "";
  const centre = rect.left + rect.width / 2;
  const arrowLeft = Math.min(Math.max(centre - 17, 8), window.innerWidth - 42);
  // Room below the target (the spider at the top): the card goes under it, the arrow pointing up. Otherwise (the
  // tabs along the bottom) above it, the arrow pointing down.
  const below = rect.bottom + 230 < window.innerHeight;
  if (below) {
    arrow.style.cssText = `left:${arrowLeft}px;top:${rect.bottom + pad + 4}px;`;
    arrow.classList.remove("down");
    card.style.cssText = `top:${rect.bottom + pad + 54}px;`;
  } else {
    arrow.style.cssText = `left:${arrowLeft}px;top:${rect.top - pad - 48}px;`;
    arrow.classList.add("down");
    card.style.cssText = `bottom:${window.innerHeight - rect.top + pad + 54}px;`;
  }
}
