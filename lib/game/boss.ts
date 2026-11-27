/**
 * Game mode: the daily boss. Every action the student takes earns XP, and each day's boss is beaten once the day's
 * XP reaches its target. A new boss comes every morning; missing a day costs nothing. Shared by unnepo.com/home and
 * the extension's side panel, which both draw the same small popup from `bossPopupHtml` and `BOSS_CSS`.
 */

/** What each action is worth. Reaching out and tailoring count for more than a bare application. */
export const ACTIONS = [
  { key: "apply", label: "Apply to a job", xp: 10 },
  { key: "tailor", label: "Tailor a resume", xp: 25 },
  { key: "email", label: "Email a person", xp: 30 },
  { key: "follow", label: "Send a follow-up", xp: 15 },
] as const;

export type ActionKey = (typeof ACTIONS)[number]["key"];
export type GameCounts = Record<ActionKey, number>;
export const NO_COUNTS: GameCounts = { apply: 0, tailor: 0, email: 0, follow: 0 };

/** The XP to beat each day's boss, by how hard the student wants it. */
export const TARGETS = { chill: 75, normal: 120, grind: 200 } as const;
export type Difficulty = keyof typeof TARGETS;
export const DIFFICULTIES = Object.keys(TARGETS) as Difficulty[];

/** Saved on the account. Game mode is on by default, with the popup in both places. */
export type GameSettings = { on: boolean; home: boolean; panel: boolean; target: Difficulty };
export const DEFAULT_GAME: GameSettings = { on: true, home: true, panel: true, target: "normal" };

export function normalizeGame(raw: unknown): GameSettings {
  const given = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof GameSettings, unknown>>;
  return {
    on: typeof given.on === "boolean" ? given.on : DEFAULT_GAME.on,
    home: typeof given.home === "boolean" ? given.home : DEFAULT_GAME.home,
    panel: typeof given.panel === "boolean" ? given.panel : DEFAULT_GAME.panel,
    target: DIFFICULTIES.includes(given.target as Difficulty) ? (given.target as Difficulty) : DEFAULT_GAME.target,
  };
}

export const xpOf = (counts: GameCounts) => ACTIONS.reduce((sum, action) => sum + (counts[action.key] ?? 0) * action.xp, 0);

/** One boss for each day of the week, Sunday first (Date#getDay), each named after a job-search habit. */
type Boss = { name: string; body: string; shade: string; glow: string; extra?: "horns" | "crown" | "antenna" | "hood"; extraColor?: string; sleepy?: boolean; blank?: boolean };
export const BOSSES: Boss[] = [
  { name: "The Sunday Scaries", body: "#3D8BFF", shade: "#1F5BB8", glow: "rgba(61,139,255,.18)", extra: "hood", extraColor: "#1B3F80" },
  { name: "Snooze Slime", body: "#3FAF6A", shade: "#24764A", glow: "rgba(63,175,106,.18)", sleepy: true },
  { name: "Inbox Golem", body: "#7C8594", shade: "#525A66", glow: "rgba(124,133,148,.18)", extra: "antenna", extraColor: "#B4B4BC" },
  { name: "The Ghoster", body: "#C9C6E0", shade: "#8F8AB0", glow: "rgba(201,198,224,.16)", blank: true },
  { name: "Copy-Paste Imp", body: "#8E5CE6", shade: "#5B35A8", glow: "rgba(142,92,230,.18)", extra: "horns", extraColor: "#EDE6D6" },
  { name: "The Doomscroller", body: "#E0457B", shade: "#9C2452", glow: "rgba(224,69,123,.18)", extra: "crown", extraColor: "#F2B227" },
  { name: "Weekend Wisp", body: "#F2B227", shade: "#B07D10", glow: "rgba(242,178,39,.18)", extra: "antenna", extraColor: "#FFE08A" },
];
export const bossFor = (now = new Date()) => BOSSES[now.getDay()]!;

// 16×16 pixels: o outline, B body, S shade, w eye, p pupil, m mouth, t tooth.
const BODY = [
  "................", "................", "......oooo......", "....ooBBBBoo....",
  "...oBBBBBBBBo...", "..oBBBBBBBBBBo..", ".oBBwwBBBBwwBBo.", ".oBBwpBBBBwpBBo.",
  "oBBBBBBBBBBBBBBo", "oBBBBBmmmmBBBBBo", "oBBBBmtmmtmBBBBo", "oSBBBBBBBBBBBBSo",
  ".oSSBBBBBBBBSSo.", ".oSSoSSSSSSoSSo.", ".oSo.oSSSSo.oSo.", "..o...oooo...o..",
];
const EXTRAS: Record<NonNullable<Boss["extra"]>, string> = {
  horns: "M3 1h1v1h1v2H4V3H3zM12 1h1v2h-1v1h-1V2h1z",
  crown: "M5 0h1v1h1V0h2v1h1V0h1v1h1V0h1v3H5z",
  antenna: "M8 0h1v3H8zM7 0h3v1H7z",
  hood: "M4 2h8v1h1v2h-1V4H4v1H3V3h1z",
};

export function bossSvg(boss: Boss) {
  const colors: Record<string, string> = { o: "#000", B: boss.body, S: boss.shade, w: "#EAF6F2", p: "#1B171F", m: "#1B171F", t: "#EAF6F2" };
  let rects = "";
  BODY.forEach((row, y) => [...row].forEach((pixel, x) => {
    let key = pixel;
    if (boss.sleepy && y === 6 && key === "w") key = "B";
    if (boss.sleepy && y === 7 && (key === "w" || key === "p")) key = "p";
    if (boss.blank && key === "p") key = "w";
    if (colors[key]) rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${colors[key]}"/>`;
  }));
  if (boss.extra) rects += `<path fill="${boss.extraColor}" d="${EXTRAS[boss.extra]}"/>`;
  return `<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
}

/** How the popup is showing in one place: expanded, shrunk to a pill, the ⋯ menu open, or How it works. */
export type PopupUi = { open: boolean; min: boolean; more: boolean; how: boolean };
export const POPUP_UI: PopupUi = { open: false, min: false, more: false, how: false };

/** The popup's HTML, or "" when game mode or this place is off. `celebrate` plays the knockout once. */
export function bossPopupHtml(input: { counts: GameCounts; settings: GameSettings; ui: PopupUi; where: "home" | "panel"; now?: Date; celebrate?: boolean }) {
  const { counts, settings, ui, where } = input;
  if (!settings.on || !settings[where]) return "";
  const boss = bossFor(input.now);
  const target = TARGETS[settings.target];
  const xp = xpOf(counts);
  const left = Math.max(0, target - xp);
  const down = left === 0;
  const pct = Math.round((left / target) * 100);
  const sprite = `<span class="ub-sprite${down ? " down" : ""}${input.celebrate ? " ko-now" : ""}">${bossSvg(boss)}</span>`;
  if (ui.min) {
    return `<button type="button" class="ub-pill" data-boss="min" aria-label="Show today's boss, ${down ? "beaten" : `${left} XP to go`}">${sprite}<span class="ub-minibar"><span style="width:${pct}%"></span></span><span class="ub-num">${down ? "K.O." : `${left} XP`}</span></button>`;
  }
  const menu = ui.more ? `<div class="ub-menu" role="menu"><button type="button" role="menuitem" data-boss="how">How it works</button><button type="button" role="menuitem" class="ub-off" data-boss="off">Turn off game mode</button></div>` : "";
  const how = `<div class="ub-section">
      <div class="ub-row"><strong>How it works</strong><button type="button" class="ub-link" data-boss="how">Back</button></div>
      <p class="ub-sub">Earn ${target} XP today to beat the boss. A new one shows up every morning.</p>
      <div class="ub-table">${ACTIONS.map((action) => `<div><span>${action.label}</span><b>+${action.xp} XP</b></div>`).join("")}</div>
      <p class="ub-sub">Miss a day and nothing is lost. Turn the game off anytime from ⋯ or Settings.</p>
    </div>`;
  const list = `<div class="ub-section ub-list">${ACTIONS.map((action) => `<div><span>${action.label}</span><span class="ub-count">${counts[action.key] ? `×${counts[action.key]}` : ""}</span><b>+${action.xp}</b></div>`).join("")}</div>`;
  const beaten = `<div class="ub-section"><p class="ub-sub"><strong>${boss.name} is beaten.</strong> A new boss shows up tomorrow morning.</p></div>`;
  return `<section class="ub-pop${down ? " ko" : ""}" style="--ub-glow:${boss.glow}" aria-label="Today's boss">
    <div class="ub-head">
      ${sprite}
      <div class="ub-main">
        <strong class="ub-name">${boss.name}</strong>
        <div class="ub-bar" role="progressbar" aria-label="Boss health" aria-valuemin="0" aria-valuemax="${target}" aria-valuenow="${left}"><span style="width:${pct}%"></span></div>
        <div class="ub-row"><span class="ub-sub">${down ? "Beaten today" : `${left} XP left`}</span><span class="ub-num ub-xp">${xp} / ${target} XP</span></div>
      </div>
      <div class="ub-ctl">
        <button type="button" data-boss="more" aria-label="More" aria-expanded="${ui.more}">⋯</button>
        <button type="button" data-boss="min" aria-label="Minimize">–</button>
        <button type="button" data-boss="open" aria-label="${ui.open ? "Collapse" : "Expand"}" aria-expanded="${ui.open}">${ui.open ? "▴" : "▾"}</button>
      </div>
    </div>
    ${menu}${ui.how ? how : ui.open ? (down ? beaten + list : list) : down ? beaten : ""}
  </section>`;
}

/** What a tap in the popup asks for. `off` turns game mode off; the rest only change how it shows. */
export type BossTap = "more" | "how" | "min" | "open" | "off";

/** The popup state after a tap (everything but `off`, which the caller saves). */
export function nextUi(ui: PopupUi, tap: BossTap): PopupUi {
  if (tap === "more") return { ...ui, more: !ui.more };
  if (tap === "how") return { ...ui, how: !ui.how, more: false, min: false };
  if (tap === "min") return { ...ui, min: !ui.min, more: false };
  if (tap === "open") return { ...ui, open: !ui.open, more: false, how: false };
  return { ...ui, more: false };
}

/** The popup's look, for both places. Dark by default; light under any `[data-theme="light"]`. */
export const BOSS_CSS = `
.ub-pop, .ub-pill { --ub-bg: #111114; --ub-raise: #070708; --ub-line: #1F1F24; --ub-edge: #33333B; --ub-track: #1A1A1F; --ub-fg: #F7F7F8; --ub-muted: #8B8B94; --ub-soft: #B4B4BC; --ub-xp: #A57BFF; --ub-red: #F87171; --ub-gold: #F2B227; --ub-hover: rgba(255,255,255,.06); --ub-mono: "Geist Mono", var(--font-geist-mono), ui-monospace, monospace;
  font-family: inherit; color: var(--ub-fg); box-sizing: border-box; }
[data-theme="light"] .ub-pop, [data-theme="light"] .ub-pill { --ub-bg: #FFFFFF; --ub-raise: #F5F5F7; --ub-line: #E7E7EC; --ub-edge: #D7D7DE; --ub-track: #E3E3E9; --ub-fg: #111114; --ub-muted: #6A6A74; --ub-soft: #45454E; --ub-xp: #7A3BEB; --ub-red: #DC2626; --ub-gold: #B98000; --ub-hover: rgba(0,0,0,.04); }
.ub-pop *, .ub-pill * { box-sizing: border-box; }
.ub-pop { position: relative; width: 100%; display: flex; flex-direction: column; gap: 8px; padding: 10px; border-radius: 14px; border: 1px solid var(--ub-edge); background: radial-gradient(circle at 12% 20%, var(--ub-glow), transparent 55%), var(--ub-bg); box-shadow: 0 18px 40px -16px rgba(0,0,0,.6); font-size: 13px; line-height: 1.4; text-align: left; }
.ub-pop.ko { border-color: var(--ub-gold); }
.ub-pop button, .ub-pill { font: inherit; color: inherit; cursor: pointer; }
.ub-head { display: flex; gap: 10px; align-items: center; }
.ub-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.ub-name { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ub-sprite { display: block; width: 44px; height: 44px; flex: none; }
.ub-sprite svg { display: block; width: 100%; height: 100%; animation: ub-hover 3s ease-in-out infinite; }
.ub-sprite.down svg { filter: grayscale(1) brightness(.55); animation: none; transform: rotate(-90deg); }
.ub-sprite.ko-now svg { animation: ub-ko .7s steps(5); }
.ub-bar { height: 10px; border-radius: 2px; background: var(--ub-track); overflow: hidden; }
.ub-bar span { display: block; height: 100%; background: linear-gradient(90deg, #F87171, #FF8A65); transition: width .5s steps(6); }
.ub-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.ub-sub { margin: 0; font-size: 11px; color: var(--ub-muted); }
.ub-row .ub-sub { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ub-num { font-family: var(--ub-mono); font-size: 11px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.ub-xp { color: var(--ub-xp); }
.ub-ctl { display: flex; gap: 1px; align-self: flex-start; }
.ub-ctl button { width: 22px; height: 22px; border: 0; border-radius: 6px; background: none; color: var(--ub-muted); font-size: 12px; line-height: 1; padding: 0; }
.ub-ctl button:hover { background: var(--ub-hover); color: var(--ub-fg); }
.ub-pop button:focus-visible, .ub-pill:focus-visible { outline: 2px solid #3D8BFF; outline-offset: 2px; }
.ub-section { display: flex; flex-direction: column; gap: 6px; border-top: 1px solid var(--ub-line); padding-top: 8px; }
.ub-list > div { display: grid; grid-template-columns: minmax(0, 1fr) auto 34px; gap: 8px; align-items: center; font-size: 12px; padding: 2px 0; }
.ub-list b, .ub-table b { font-family: var(--ub-mono); font-weight: 500; font-size: 11px; color: var(--ub-xp); text-align: right; }
.ub-count { font-family: var(--ub-mono); font-size: 11px; color: var(--ub-muted); }
.ub-table { display: flex; flex-direction: column; border: 1px solid var(--ub-line); border-radius: 8px; overflow: hidden; }
.ub-table > div { display: flex; justify-content: space-between; gap: 10px; padding: 6px 10px; font-size: 12px; border-bottom: 1px solid var(--ub-line); }
.ub-table > div:last-child { border-bottom: 0; }
.ub-link { border: 0; background: none; padding: 0; color: #3D8BFF; font-size: 12px; }
.ub-menu { position: absolute; right: 8px; top: 36px; z-index: 3; display: flex; flex-direction: column; min-width: 180px; padding: 4px; border-radius: 10px; background: var(--ub-bg); border: 1px solid var(--ub-edge); box-shadow: 0 16px 32px -12px rgba(0,0,0,.6); }
.ub-menu button { border: 0; background: none; text-align: left; padding: 7px 10px; border-radius: 6px; font-size: 13px; }
.ub-menu button:hover { background: var(--ub-hover); }
.ub-menu .ub-off { color: var(--ub-red); }
.ub-pill { display: inline-flex; align-items: center; gap: 8px; padding: 5px 10px 5px 6px; border-radius: 999px; border: 1px solid var(--ub-edge); background: var(--ub-bg); box-shadow: 0 12px 30px -12px rgba(0,0,0,.6); }
.ub-pill .ub-sprite { width: 26px; height: 26px; }
.ub-pill .ub-sprite svg { animation: none; }
.ub-minibar { display: block; width: 44px; height: 6px; border-radius: 1px; background: var(--ub-track); overflow: hidden; }
.ub-minibar span { display: block; height: 100%; background: #F87171; }
@keyframes ub-hover { 50% { transform: translateY(-2px); } }
@keyframes ub-ko { 0% { transform: scale(1); } 30% { transform: scale(1.25) rotate(-10deg); filter: brightness(2); } 100% { transform: rotate(-90deg); } }
@media (prefers-reduced-motion: reduce) { .ub-pop *, .ub-pill * { animation: none !important; transition: none !important; } }
`;
