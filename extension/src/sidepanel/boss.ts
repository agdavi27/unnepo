import { BOSS_CSS, DIFFICULTIES, TARGETS, bossFor, bossPopupHtml, nextUi, normalizeGame, POPUP_UI, xpOf, type BossTap, type Difficulty, type GameCounts, type GameSettings, type PopupUi } from "@/lib/game/boss";

/**
 * Game mode in the side panel: the daily boss as a small popup above the tabs, and its settings on Me. It's drawn
 * apart from the rest of the panel (in #boss), so redrawing the page never loses it. Counts come from the account
 * (the same ones unnepo.com/home shows), loaded when the panel opens, every half minute it's drawn, and right after
 * an application is saved.
 */

const ask = <T>(message: unknown) => chrome.runtime.sendMessage(message) as Promise<T>;
const slot = document.getElementById("boss")!;
const style = document.createElement("style");
style.textContent = BOSS_CSS;
document.head.append(style);

const UI_KEY = "bossUi";
const game = {
  counts: null as GameCounts | null,
  settings: normalizeGame(null),
  loading: false,
  loadedAt: 0,
  /** The day the counts are for, so a panel left open overnight starts the new boss. */
  day: "",
  ui: { ...POPUP_UI } as PopupUi,
  /** Plays the knockout once, when the XP crosses the target while the panel is open. */
  celebrate: false,
  /** "Game mode is off" with Undo, for a few seconds after turning it off from the popup. */
  offNote: false,
  saving: false,
};
let redraw = () => {};
let shown = false;
let appliedSeen = -1;

void chrome.storage.local.get(UI_KEY).then((stored) => {
  const saved = stored[UI_KEY] as Partial<PopupUi> | undefined;
  game.ui = { ...POPUP_UI, open: Boolean(saved?.open), min: Boolean(saved?.min) };
  paint();
});

const startOfDay = (now = new Date()) => new Date(now.getFullYear(), now.getMonth(), now.getDate());
const dayOf = (now = new Date()) => startOfDay(now).toDateString();

/** The panel's redraw, for after a setting changes. */
export function onGameChange(fn: () => void) {
  redraw = fn;
}

async function loadGame() {
  if (game.loading) return;
  game.loading = true;
  type Answer = { ok: boolean; counts?: GameCounts; settings?: GameSettings };
  const result = await ask<Answer>({ type: "game", since: startOfDay().toISOString() }).catch((): Answer => ({ ok: false }));
  game.loading = false;
  game.loadedAt = Date.now();
  if (!result.ok || !result.counts) return paint();
  const target = TARGETS[normalizeGame(result.settings).target];
  const wasLeft = game.counts && game.day === dayOf() ? xpOf(game.counts) < TARGETS[game.settings.target] : false;
  game.counts = result.counts;
  game.settings = normalizeGame(result.settings);
  game.day = dayOf();
  if (wasLeft && xpOf(result.counts) >= target) game.celebrate = true;
  paint();
}

/**
 * Draws the popup, or hides it (signed out, or while autofill runs). `applied` is how many jobs the account has
 * saved as applied: when it changes, the counts are loaded again straight away.
 */
export function drawBoss(show: boolean, applied: number) {
  shown = show;
  const stale = Date.now() - game.loadedAt > 30_000 || game.day !== dayOf();
  if (show && (stale || (appliedSeen >= 0 && applied !== appliedSeen))) void loadGame();
  appliedSeen = applied;
  paint();
}

function paint() {
  const html = shown && game.counts ? bossPopupHtml({ counts: game.counts, settings: game.settings, ui: game.ui, where: "panel", celebrate: game.celebrate }) : "";
  game.celebrate = false;
  const note = shown && game.offNote ? `<div class="boss-off" role="status"><span>Game mode is off. Turn it back on in Me.</span><button type="button" class="quiet-link" data-boss-undo>Undo</button></div>` : "";
  slot.innerHTML = html || note;
  const tabs = document.getElementById("tabs");
  slot.style.bottom = `${(tabs && !tabs.hidden ? tabs.offsetHeight : 0) + 10}px`;
  // Room under the page, so the last of it can scroll out from under the popup.
  document.body.style.setProperty("--boss-room", slot.innerHTML ? `${slot.offsetHeight + 12}px` : "0px");
}

async function save(change: Partial<GameSettings>) {
  game.settings = { ...game.settings, ...change };
  game.saving = true;
  paint();
  redraw();
  const result = await ask<{ ok: boolean; settings?: GameSettings }>({ type: "game-settings", body: change }).catch(() => ({ ok: false }) as { ok: boolean; settings?: GameSettings });
  game.saving = false;
  if (result.ok && result.settings) game.settings = normalizeGame(result.settings);
  paint();
  redraw();
}

let offTimer = 0;
slot.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  if (target.closest("[data-boss-undo]")) {
    game.offNote = false;
    clearTimeout(offTimer);
    void save({ on: true });
    return;
  }
  const button = target.closest<HTMLElement>("[data-boss]");
  if (!button) return;
  const tap = button.dataset.boss as BossTap;
  game.ui = nextUi(game.ui, tap);
  void chrome.storage.local.set({ [UI_KEY]: { open: game.ui.open, min: game.ui.min } });
  if (tap === "off") {
    game.offNote = true;
    clearTimeout(offTimer);
    offTimer = window.setTimeout(() => { game.offNote = false; paint(); }, 6000);
    void save({ on: false });
    return;
  }
  paint();
});
// Clicking anywhere else closes the ⋯ menu.
document.addEventListener("click", (event) => {
  if (game.ui.more && !slot.contains(event.target as Node)) {
    game.ui = { ...game.ui, more: false };
    paint();
  }
});

/** Me's settings: game mode, where the popup shows, and the daily XP target. */
export function gameSettingsCard() {
  const s = game.settings;
  const toggle = (id: string, label: string, sub: string, on: boolean, off = false) => `<label class="set-row${off ? " set-off" : ""}"><span class="set-text"><span>${label}</span>${sub ? `<span class="sub">${sub}</span>` : ""}</span><input type="checkbox" class="switch" id="${id}" ${on ? "checked" : ""} ${off ? "disabled" : ""}></label>`;
  const option = (value: Difficulty) => `<option value="${value}"${s.target === value ? " selected" : ""}>${value[0]!.toUpperCase()}${value.slice(1)} · ${TARGETS[value]} XP</option>`;
  return `
    <section class="page settings-card" aria-label="Game mode">
      <span class="eyebrow">Game mode</span>
      <div class="set-rows">
        ${toggle("game-on", "Daily boss", `Earn XP to beat ${bossFor().name} each day`, s.on)}
        ${toggle("game-panel", "Popup in this panel", "Above the tabs", s.panel, !s.on)}
        ${toggle("game-home", "Popup on unnepo.com", "Bottom right of your home page", s.home, !s.on)}
        <label class="set-row${s.on ? "" : " set-off"}"><span class="set-text"><span>XP to beat each boss</span></span><select class="field set-select" id="game-target" ${s.on ? "" : "disabled"}>${DIFFICULTIES.map(option).join("")}</select></label>
      </div>
    </section>`;
}

export function wireGameSettings(root: HTMLElement) {
  const flip = (id: string, key: "on" | "panel" | "home") => root.querySelector<HTMLInputElement>(`#${id}`)?.addEventListener("change", (event) => {
    if (key === "on") game.offNote = false;
    void save({ [key]: (event.target as HTMLInputElement).checked });
  });
  flip("game-on", "on");
  flip("game-panel", "panel");
  flip("game-home", "home");
  root.querySelector<HTMLSelectElement>("#game-target")?.addEventListener("change", (event) => {
    const select = event.target as HTMLSelectElement;
    select.blur();
    void save({ target: select.value as Difficulty });
  });
}
