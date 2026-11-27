"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { BOSS_CSS, DIFFICULTIES, TARGETS, bossFor, bossPopupHtml, nextUi, normalizeGame, POPUP_UI, xpOf, type BossTap, type Difficulty, type GameCounts, type GameSettings, type PopupUi } from "@/lib/game/boss";

/**
 * Game mode on unnepo.com/home: the daily boss as a small popup in the bottom right corner, and its settings card.
 * Both read one store, so a change in Settings shows in the popup straight away. The extension's side panel draws
 * the same popup (extension/src/sidepanel/boss.ts) from the same counts and settings.
 */

type Game = { counts: GameCounts | null; settings: GameSettings; celebrate: boolean; offNote: boolean; error: string };
let game: Game = { counts: null, settings: normalizeGame(null), celebrate: false, offNote: false, error: "" };
const listeners = new Set<() => void>();
const set = (next: Partial<Game>) => {
  game = { ...game, ...next };
  listeners.forEach((listener) => listener());
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const useGame = () => useSyncExternalStore(subscribe, () => game, () => game);

const startOfDay = (now = new Date()) => new Date(now.getFullYear(), now.getMonth(), now.getDate());
let loading = false;
let loadedDay = "";

async function loadGame() {
  if (loading) return;
  loading = true;
  try {
    const response = await fetch(`/api/apply/game?since=${encodeURIComponent(startOfDay().toISOString())}`);
    if (!response.ok) return;
    const body = (await response.json()) as { counts: GameCounts; settings: GameSettings };
    const settings = normalizeGame(body.settings);
    const day = startOfDay().toDateString();
    const wasLeft = game.counts && loadedDay === day ? xpOf(game.counts) < TARGETS[game.settings.target] : false;
    loadedDay = day;
    set({ counts: body.counts, settings, celebrate: Boolean(wasLeft && xpOf(body.counts) >= TARGETS[settings.target]) });
  } catch {
    // Offline: keep what's showing.
  } finally {
    loading = false;
  }
}

async function saveGame(change: Partial<GameSettings>) {
  const before = game.settings;
  set({ settings: { ...before, ...change }, error: "" });
  try {
    const response = await fetch("/api/apply/game", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(change) });
    const body = (await response.json().catch(() => null)) as { settings?: GameSettings; error?: string } | null;
    if (!response.ok || !body?.settings) throw new Error(body?.error || "Couldn't save game mode.");
    set({ settings: normalizeGame(body.settings) });
  } catch (error) {
    set({ settings: before, error: error instanceof Error ? error.message : "Couldn't save game mode." });
  }
}

const UI_KEY = "unnepo-boss-ui";
const readUi = (): PopupUi => {
  try {
    const saved = JSON.parse(localStorage.getItem(UI_KEY) ?? "{}") as Partial<PopupUi>;
    return { ...POPUP_UI, open: saved.open ?? true, min: Boolean(saved.min) };
  } catch {
    return { ...POPUP_UI, open: true };
  }
};

/** The popup, bottom right. Loads today's counts on opening, when the tab comes back into view, and each minute. */
export function DailyBossPopup() {
  const state = useGame();
  const [ui, setUi] = useState<PopupUi>(() => ({ ...POPUP_UI, open: true }));
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Read after mounting, so the server's HTML and the first client render match.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUi(readUi());
    void loadGame();
    const again = () => { if (document.visibilityState === "visible") void loadGame(); };
    document.addEventListener("visibilitychange", again);
    const timer = window.setInterval(again, 60_000);
    return () => { document.removeEventListener("visibilitychange", again); window.clearInterval(timer); };
  }, []);

  // The knockout plays once.
  useEffect(() => {
    if (!state.celebrate) return;
    const timer = window.setTimeout(() => set({ celebrate: false }), 900);
    return () => window.clearTimeout(timer);
  }, [state.celebrate]);

  useEffect(() => {
    if (!state.offNote) return;
    const timer = window.setTimeout(() => set({ offNote: false }), 6000);
    return () => window.clearTimeout(timer);
  }, [state.offNote]);

  // Clicking anywhere else closes the ⋯ menu.
  useEffect(() => {
    if (!ui.more) return;
    const close = (event: MouseEvent) => { if (!box.current?.contains(event.target as Node)) setUi((now) => ({ ...now, more: false })); };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [ui.more]);

  const onClick = useCallback((event: React.MouseEvent) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>("[data-boss]");
    if (!button) return;
    const tap = button.dataset.boss as BossTap;
    setUi((now) => {
      const next = nextUi(now, tap);
      try { localStorage.setItem(UI_KEY, JSON.stringify({ open: next.open, min: next.min })); } catch { /* storage blocked */ }
      return next;
    });
    if (tap === "off") {
      set({ offNote: true });
      void saveGame({ on: false });
    }
  }, []);

  const html = state.counts ? bossPopupHtml({ counts: state.counts, settings: state.settings, ui, where: "home", celebrate: state.celebrate }) : "";
  if (!html && !state.offNote) return null;
  return (
    <div ref={box} className="fixed z-30 flex w-[min(300px,calc(100vw-32px))] justify-end" style={{ right: "max(16px, env(safe-area-inset-right, 0px))", bottom: "max(16px, env(safe-area-inset-bottom, 0px))" }}>
      <style>{BOSS_CSS}</style>
      {html
        ? <div className="w-full flex justify-end" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
        : (
          <div role="status" className="flex items-center gap-3 rounded-xl border border-line bg-panel px-3 py-2 text-sm text-muted shadow-lg">
            <span>Game mode is off. Turn it back on in Settings.</span>
            <button type="button" className="font-medium text-ink underline underline-offset-4" onClick={() => { set({ offNote: false }); void saveGame({ on: true }); }}>Undo</button>
          </div>
        )}
    </div>
  );
}

function Switch({ id, on, disabled, label, onChange }: { id: string; on: boolean; disabled?: boolean; label: string; onChange: (on: boolean) => void }) {
  return (
    <button type="button" role="switch" id={id} aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)} className={`relative h-6 w-11 flex-none rounded-full transition-colors disabled:cursor-default ${on ? "bg-[#3D8BFF]" : "bg-[#26262C]"}`}>
      <span aria-hidden style={{ background: "#fff" }} className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full shadow transition-transform ${on ? "translate-x-5" : ""}`} />
    </button>
  );
}

/** Settings' Game mode card: on or off, where the popup shows, and the XP to beat each boss. */
export function GameSettingsCard({ titleClass }: { titleClass: string }) {
  const { settings, error } = useGame();
  useEffect(() => { void loadGame(); }, []);
  const row = "flex items-center justify-between gap-4 border-t border-line py-3 first:border-t-0";
  const sub = settings.on ? "" : "opacity-45";
  return (
    <section className="rounded-2xl border border-line bg-panel p-5" aria-label="Game mode">
      <h2 className={titleClass}>Game mode</h2>
      <div className="mt-2 flex flex-col">
        <div className={row}>
          <span><span className="block font-medium">Daily boss</span><span className="block text-sm text-muted">Earn XP to beat {bossFor().name} today. Here and in the extension.</span></span>
          <Switch id="game-on" label="Daily boss" on={settings.on} onChange={(on) => void saveGame({ on })} />
        </div>
        <div className={`${row} ${sub}`}>
          <span><span className="block font-medium">Popup on unnepo.com</span><span className="block text-sm text-muted">Bottom right of this page</span></span>
          <Switch id="game-home" label="Popup on unnepo.com" on={settings.home} disabled={!settings.on} onChange={(home) => void saveGame({ home })} />
        </div>
        <div className={`${row} ${sub}`}>
          <span><span className="block font-medium">Popup in the extension</span><span className="block text-sm text-muted">Above the side panel&apos;s tabs</span></span>
          <Switch id="game-panel" label="Popup in the extension" on={settings.panel} disabled={!settings.on} onChange={(panel) => void saveGame({ panel })} />
        </div>
        <div className={`${row} ${sub}`}>
          <span><span className="block font-medium">XP to beat each boss</span><span className="block text-sm text-muted">A new boss every morning</span></span>
          <div role="group" aria-label="XP to beat each boss" className="flex flex-none gap-0.5 rounded-lg border border-line p-0.5">
            {DIFFICULTIES.map((value: Difficulty) => (
              <button key={value} type="button" aria-pressed={settings.target === value} disabled={!settings.on} onClick={() => void saveGame({ target: value })} className={`rounded-md px-2.5 py-1 text-xs ${settings.target === value ? "bg-[#26262C] text-white" : "text-muted"}`}>
                {value[0]!.toUpperCase() + value.slice(1)} · {TARGETS[value]}
              </button>
            ))}
          </div>
        </div>
      </div>
      {error && <p className="mt-2 text-sm text-[#F5A524]" role="status">{error}</p>}
    </section>
  );
}
