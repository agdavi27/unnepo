import { weekStart } from "@/lib/apply/stats";
import { escape, redraw } from "./tracker-view";

/**
 * Friends, in the side panel. On Week, once there's a friend: each friend and how many jobs they applied to this
 * week. On Me: add a friend by email, answer requests, and remove friends; tapping a friend shows this week's
 * points against them. Only counts are shared (never who or where), and only once the friend accepts.
 */

type Stats = { applied: number; emails: number; followUps: number; letters: number; replies: number; interviews: number };
type Friend = { id: string; name: string; applied: number; stats?: Stats; points?: number };
type Incoming = { id: string; name: string; email: string };
type Outgoing = { id: string; email: string };

const ask = <T>(message: unknown) => chrome.runtime.sendMessage(message) as Promise<T>;

const friends = {
  list: null as Friend[] | null, incoming: [] as Incoming[], outgoing: [] as Outgoing[],
  /** The student's own week, and what each thing is worth. */
  me: null as { stats: Stats; points: number } | null, weights: null as Stats | null,
  error: "", loading: false, loadedAt: 0,
  /** What happened after Add, Accept or Remove. */
  note: "", noteBad: false, busy: false, email: "",
  /** A line in the top banner after answering a request there, gone after a few seconds. */
  flash: "",
};

export async function loadFriends() {
  if (friends.loading) return;
  friends.loading = true;
  type Answer = { ok: boolean; error?: string; friends?: Friend[]; incoming?: Incoming[]; outgoing?: Outgoing[]; me?: { stats: Stats; points: number }; points?: Stats };
  const result = await ask<Answer>({ type: "friends", since: weekStart(new Date()).toISOString() }).catch((): Answer => ({ ok: false, error: "Couldn't reach Unnepo." }));
  friends.loading = false;
  friends.loadedAt = Date.now();
  if (result.ok) {
    friends.list = result.friends ?? [];
    friends.incoming = result.incoming ?? [];
    friends.outgoing = result.outgoing ?? [];
    friends.me = result.me ?? null;
    friends.weights = result.points ?? null;
    friends.error = "";
  } else friends.error = result.error ?? "Couldn't load your friends.";
  redraw();
}

/** Loads friends the first time, and again when the copy is a minute old. */
export function ensureFriends(maxAge = 60_000) {
  if (!friends.loading && (!friends.list || Date.now() - friends.loadedAt > maxAge)) void loadFriends();
}

/** Requests waiting on the student, for Me's badge. */
export const friendRequests = () => friends.incoming.length;

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join("") || "?";

/**
 * At the top of the panel on every tab: each request waiting on the student, as a gold profile picture with
 * "… added you" and Yes / No.
 */
export function friendAsks() {
  ensureFriends();
  const flash = friends.flash ? `<p class="friend-ask-flash" role="status">${escape(friends.flash)}</p>` : "";
  if (!friends.incoming.length) return flash;
  const busy = friends.busy ? "disabled" : "";
  return `${friends.incoming.slice(0, 3).map((item) => `
    <section class="friend-ask" aria-label="Friend request from ${escape(item.name)}">
      <span class="friend-av gold" aria-hidden="true">${escape(initials(item.name))}</span>
      <span class="friend-ask-text"><strong>${escape(item.name)}</strong> added you<span class="sub">Accept and compete each week?</span></span>
      <span class="friend-ask-btns">
        <button type="button" class="solid" data-ask-accept="${item.id}" data-ask-name="${escape(item.name)}" ${busy}>Yes</button>
        <button type="button" class="link" data-ask-decline="${item.id}" ${busy}>No</button>
      </span>
    </section>`).join("")}${flash}`;
}

/** Week's friends box: each friend's applications this week, most first. Shown only once a friend is added. */
export function friendsWeekCard(myWeek: number) {
  ensureFriends();
  const head = (extra = "") => `<div class="row-between"><span class="eyebrow">Friends this week</span>${extra}</div>`;
  if (!friends.list) return "";
  const requests = friends.incoming.length ? `<button type="button" class="note warn nudge" data-go="settings">${friends.incoming.length} friend ${friends.incoming.length === 1 ? "request" : "requests"} waiting. See ${friends.incoming.length === 1 ? "it" : "them"} →</button>` : "";
  // No friends yet: the giveaway and a request waiting, if there is one. Friends are added under Me.
  if (!friends.list.length) return `<section class="page friends-card" aria-label="Friends this week">${head(`<button type="button" class="quiet-link tight" data-go="settings">Add</button>`)}${giveawayRow()}${requests}</section>`;
  const rows = [{ id: "me", name: "You", applied: myWeek }, ...friends.list].sort((a, b) => b.applied - a.applied);
  const top = Math.max(1, ...rows.map((row) => row.applied));
  return `<section class="page friends-card" aria-label="Friends this week">
    ${head(`<button type="button" class="quiet-link tight" data-go="settings">Add</button>`)}
    ${giveawayRow()}
    <ul class="friend-list">${rows.map((row) => `
      <li class="friend${row.id === "me" ? " me" : ""}">
        <span class="friend-av" aria-hidden="true">${escape(row.id === "me" ? "★" : initials(row.name))}</span>
        <span class="friend-name">${escape(row.name)}</span>
        <span class="friend-bar" aria-hidden="true"><span style="width:${Math.round((row.applied / top) * 100)}%"></span></span>
        <span class="friend-count">${row.applied}</span>
      </li>`).join("")}</ul>
    ${requests}
  </section>`;
}

/**
 * Me's friends strip: a + to add someone, then each person as a round avatar with their count this week.
 * Requests to answer come first (orange, "Accept"), sent ones last (faded). Tapping one opens a small popup.
 */
export function friendsStrip() {
  ensureFriends();
  const list = [...(friends.list ?? [])].sort((a, b) => b.applied - a.applied);
  const person = (key: string, label: string, sub: string, kind: string, name: string) => `<button type="button" class="strip-person ${kind}" data-friend-open="${key}" aria-label="${escape(name)}"><span class="friend-av" aria-hidden="true">${escape(label)}</span><span class="strip-sub">${escape(sub)}</span></button>`;
  const people = [
    `<button type="button" class="strip-person add" data-friend-open="add" aria-label="Add a friend"><span class="friend-av" aria-hidden="true">+</span><span class="strip-sub">Add</span></button>`,
    ...friends.incoming.map((item) => person(`in:${item.id}`, initials(item.name), "Accept", "asking gold", `${item.name} added you`)),
    ...list.map((item) => person(`f:${item.id}`, initials(item.name), String(item.applied), "", `${item.name}: ${item.applied} this week`)),
    ...friends.outgoing.map((item) => person(`out:${item.id}`, initials(item.email.split("@")[0]!.replace(/[._-]+/g, " ")), "Sent", "waiting", `Request sent to ${item.email}`)),
  ].join("");
  return `
    <section class="friends-strip" aria-label="Friends this week">
      <span class="eyebrow">Friends this week</span>
      ${giveawayRow()}
      <div class="strip-row">${people}</div>
      ${friends.note ? `<p class="small" role="status"${friends.noteBad ? ' style="color: var(--warn)"' : ""}>${escape(friends.note)}</p>` : ""}
      ${friends.error && !friends.list ? `<p class="small">${escape(friends.error)}</p>` : ""}
    </section>`;
}

/** The small popup for one spot on the strip: adding someone, a request, a friend, or a request sent. Null once it's gone. */
export function friendPopup(key: string): { title: string; body: string } | null {
  const busy = friends.busy ? "disabled" : "";
  const note = friends.note ? `<p class="small" role="status"${friends.noteBad ? ' style="color: var(--warn)"' : ""}>${escape(friends.note)}</p>` : "";
  const head = (name: string, sub: string, mark = "") => `<div class="account-head"><span class="friend-av big${mark}" aria-hidden="true">${escape(initials(name))}</span><span class="account-text"><span class="account-name">${escape(name)}</span><span class="sub">${escape(sub)}</span></span></div>`;
  if (key === "add") {
    return { title: "Add a friend", body: `
      <p class="small">Once they accept, you each see what the other did this week: applications, emails, follow-ups, cover letters, replies and interviews. Never who you emailed or where you applied.</p>
      <form class="add-row" id="friend-form">
        <input class="field" id="friend-email" type="email" placeholder="friend@school.edu" aria-label="Friend's email" value="${escape(friends.email)}" autocomplete="off" required>
        <button type="submit" class="btn accent" ${busy}>${friends.busy ? "Adding…" : "Add"}</button>
      </form>${note}` };
  }
  const [kind, id] = key.split(":");
  if (kind === "in") {
    const item = friends.incoming.find((entry) => entry.id === id);
    return item ? { title: "Friend request", body: `${head(item.name, item.email, " asking gold")}<p class="small">${escape(item.name.split(" ")[0]!)} added you and wants to compete with you each week: applications, emails, follow-ups, cover letters, replies and interviews.</p><div class="add-row"><button type="button" class="btn primary grow" data-friend-accept="${item.id}" ${busy}>Accept</button><button type="button" class="btn" data-friend-decline="${item.id}" ${busy}>Decline</button></div>` } : null;
  }
  if (kind === "f") {
    const item = friends.list?.find((entry) => entry.id === id);
    return item ? { title: `You vs ${item.name.split(" ")[0]}`, body: `${scoreCard(item)}<button type="button" class="btn quiet-remove" data-friend-remove="${item.id}" ${busy}>Remove friend</button>` } : null;
  }
  const item = friends.outgoing.find((entry) => entry.id === id);
  return item ? { title: "Request sent", body: `${head(item.email, "Waiting for them to accept", " waiting")}<button type="button" class="btn" data-friend-remove="${item.id}" ${busy}>Cancel request</button>` } : null;
}

/** The monthly giveaway: connect with this many friends (accepted) to be entered. */
export const GIVEAWAY_FRIENDS = 5;
export const GIVEAWAY_PRIZE = "AirPods Max";
const connected = () => Math.min(GIVEAWAY_FRIENDS, friends.list?.length ?? 0);

/** Next to Friends this week: how many more friends until you're entered, as pips, and More info. */
function giveawayRow() {
  const have = connected();
  const left = GIVEAWAY_FRIENDS - have;
  const pips = Array.from({ length: GIVEAWAY_FRIENDS }, (_, at) => `<span class="${at < have ? "on" : ""}"></span>`).join("");
  const line = left
    ? `Connect with ${GIVEAWAY_FRIENDS} friends and be entered to win <strong>${GIVEAWAY_PRIZE}</strong>`
    : `<strong>Entered!</strong> We'll let you know if you win ${GIVEAWAY_PRIZE}`;
  return `<div class="giveaway-row${left ? "" : " in"}">
    <span class="giveaway-gift" aria-hidden="true">${GIFT}</span>
    <span class="giveaway-text"><span>${line}</span>
      <span class="giveaway-sub"><span class="giveaway-pips" role="img" aria-label="${have} of ${GIVEAWAY_FRIENDS} friends">${pips}</span>${left ? `${left} more to go` : "5 friends connected ✓"}</span>
    </span>
    <button type="button" class="quiet-link tight" data-giveaway>More info</button>
  </div>`;
}

const GIFT = `<svg width="22" height="22" viewBox="0 0 11 11" shape-rendering="crispEdges" aria-hidden="true"><path fill="#F5A524" d="M1 4h9v2H1zM2 6h7v4H2z"/><path fill="#3D8BFF" d="M5 4h1v6H5z"/><path fill="#F5A524" d="M3 1h1v1H3zM4 2h1v2H4zM7 1h1v1H7zM6 2h1v2H6z"/></svg>`;

/**
 * AirPods Max (silver) in pixel art, after Apple's three-quarter product shot. Drawn from shapes back to front:
 * the headband and its knit canopy, the stems and steel rods, the far cup (cushion and the mesh inside), the near
 * cup's cushion, then its aluminum shell with the Digital Crown and noise button. Each shape gets a darker edge,
 * and the whole thing a dark outline.
 */
const PODS_W = 64;
const PODS_H = 83;
const SILVER = {
  outline: "#2B2F35",
  band: ["#FBFBFC", "#EFF0F2", "#E2E4E7", "#D2D5DA"], bandEdge: "#B4B9C0",
  knit: ["#F1F2F4", "#E6E8EB", "#DADDE1", "#CDD1D6"], knitEdge: "#C2C6CC",
  steelLight: "#F6F7F8", steel: "#C9CED5", steelDark: "#868C96", steelEdge: "#6E747E",
  cushion: ["#ECEEF0", "#DFE2E6", "#D0D4D9", "#BFC4CB"], cushionEdge: "#A6ABB3",
  hole: ["#6F7580", "#828893", "#969CA6", "#AAB0B8"],
  shell: ["#FFFFFF", "#EEF0F2", "#E0E3E7", "#D0D4D9", "#BEC2C9", "#A9AEB6"], shellEdge: "#8E949D",
  crown: "#E4E7EA", crownRidge: "#A3A8B0", slot: "#454A52",
};
function podsGrid() {
  const C = SILVER;
  const grid: Array<Array<string | null>> = Array.from({ length: PODS_H }, () => Array(PODS_W).fill(null));
  /** Paints every pixel where inside(x, y) holds, with color(x, y); the shape's own edge gets the edge color. */
  const paint = (inside: (x: number, y: number) => boolean, color: (x: number, y: number) => string, edge?: string) => {
    for (let y = 0; y < PODS_H; y++) for (let x = 0; x < PODS_W; x++) {
      if (!inside(x, y)) continue;
      const rim = edge && (!inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1));
      grid[y]![x] = rim ? edge : color(x, y);
    }
  };
  /** A tone from a ramp, light to dark, for a shade from 0 to 1, dithered in a checker where two tones meet. */
  const tone = (ramp: string[], v: number, x: number, y: number) => {
    const at = Math.max(0, Math.min(1, v)) * (ramp.length - 1) + ((x + y) % 2 ? 0.22 : -0.22);
    return ramp[Math.max(0, Math.min(ramp.length - 1, Math.round(at)))]!;
  };
  /** Knit: faint diagonal rows a step darker. */
  const knitted = (ramp: string[], v: number, x: number, y: number) => tone(ramp, v + ((x + 2 * y) % 4 === 0 ? 0.3 : 0), x, y);
  /** How far (x, y) is from a squircle's middle: 0 at the center, 1 on its edge. */
  const sq = (cx: number, cy: number, rx: number, ry: number, n = 3) => (x: number, y: number) => Math.abs((x - cx) / rx) ** n + Math.abs((y - cy) / ry) ** n;
  const within = (shape: (x: number, y: number) => number, limit = 1) => (x: number, y: number) => shape(x, y) <= limit;
  const ell = (cx: number, cy: number, rx: number, ry: number) => (x: number, y: number) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;

  // Headband: a tall arch with a soft white rim outside and inside, the knit canopy set between them.
  const outer = ell(32, 40, 23, 38), inner = ell(32, 41, 15, 27);
  const canopyOut = ell(32, 40, 20.3, 35), canopyIn = ell(32, 41, 17.6, 30);
  const band = (x: number, y: number) => y <= 27 && outer(x, y) <= 1 && inner(x, y) > 1;
  // The rim: lit on top and on the left, rounding off into shade.
  paint(band, (x, y) => tone(C.band, (outer(x, y) > 0.9 ? 0.05 : 0.35) + ((x - 32) / 23) * 0.4, x, y), C.bandEdge);
  paint((x, y) => band(x, y) && canopyOut(x, y) <= 1 && canopyIn(x, y) > 1 && y <= 25, (x, y) => knitted(C.knit, 0.2 + ((x - 32) / 23) * 0.35 + (y > 14 ? 0.15 : 0), x, y), C.knitEdge);

  // Stems: white and rounded, lit on the left, down to the steel collars.
  const stem = (x0: number) => (x: number, y: number) => x >= x0 && x <= x0 + 4 && y >= 25 && y <= 38;
  paint(stem(10), (x, y) => tone(C.band, (x - 10) / 4.5, x, y), C.bandEdge);
  paint(stem(50), (x, y) => tone(C.band, 0.15 + (x - 50) / 4, x, y), C.bandEdge);
  // Steel: a collar, then a polished rod down into each cup.
  const steelShade = (x0: number) => (x: number) => (x === x0 ? C.steelLight : x === x0 + 1 ? C.steel : C.steelDark);
  paint((x, y) => x >= 9 && x <= 15 && y >= 38 && y <= 39, steelShade(9), C.steelEdge);
  paint((x, y) => x >= 49 && x <= 55 && y >= 38 && y <= 39, steelShade(49), C.steelEdge);
  paint((x, y) => x >= 11 && x <= 13 && y >= 40 && y <= 45, steelShade(11));
  paint((x, y) => x >= 51 && x <= 53 && y >= 40 && y <= 48, steelShade(51));

  // Far cup (left): its aluminum shell shows as a rim around the cushion, bright on the left.
  const farShell = sq(15.5, 60, 15, 19.5, 2.6);
  paint(within(farShell), (x, y) => {
    const t = (x - 15.5) / 15, u = (y - 60) / 19.5;
    if (t < -0.86) return C.shell[2]!;
    if (t < -0.7) return C.shell[0]!;
    return tone(C.shell, 0.25 + u * 0.35 + t * 0.2, x, y);
  }, C.shellEdge);
  // Two mic slits and a port along its bottom edge.
  paint((x, y) => (y === 73 && x >= 7 && x <= 10) || (y === 75 && x >= 12 && x <= 14) || (y === 76 && x === 17), () => C.slot);
  // The cushion: knit, in shadow toward the middle, around the mesh opening.
  const farCushion = sq(18.5, 58.5, 12.5, 17.5, 2.5);
  paint(within(farCushion), (x, y) => knitted(C.cushion, 0.15 + Math.max(0, (x - 18.5) / 12.5) * 0.5 + (y - 58.5) / 17.5 * 0.2, x, y), C.cushionEdge);
  // The opening: the inner wall in shadow at the top left, the mesh lighter toward the bottom right.
  const hole = sq(20, 57.5, 5.8, 10.5, 2.2);
  paint(within(hole), (x, y) => tone(C.hole, 0.45 + ((x - 20) / 5.8) * 0.35 + ((y - 57.5) / 10.5) * 0.35 + ((x + y) % 3 ? 0 : -0.15), x, y), C.hole[0]);

  // Near cup's cushion, peeking out above and left of its shell.
  const nearCushion = sq(40, 57, 13.5, 16.5, 2.5);
  paint(within(nearCushion), (x, y) => knitted(C.cushion, 0.3 + (x < 32 ? 0.35 : 0) + (y - 57) / 16.5 * 0.2, x, y), C.cushionEdge);

  // Near cup's shell: aluminum, a bright streak down its left side, falling into shade at the bottom right.
  const shell = sq(46, 62, 16.8, 17.8, 2.7);
  paint(within(shell), (x, y) => {
    const t = (x - 46) / 16.8, u = (y - 62) / 17.8;
    if (t < -0.86) return C.shell[2]!;
    if (t < -0.72) return C.shell[0]!;
    if (t < -0.62) return C.shell[3]!;
    // A soft shine high on the left.
    if (((x - 38) / 5) ** 2 + ((y - 53) / 7) ** 2 <= 1) return tone(C.shell, 0.05, x, y);
    return tone(C.shell, 0.3 + t * 0.35 + u * 0.4, x, y);
  }, C.shellEdge);
  // Where the rod meets the shell.
  paint((x, y) => x >= 51 && x <= 53 && y === 46, () => C.slot);
  // Digital Crown: a ridged dial sitting on top, and the noise control button to its right.
  const crown = (x: number, y: number) => ((x - 40) / 4.6) ** 2 + ((y - 44.5) / 3.2) ** 2 <= 1;
  paint(crown, (x, y) => (y <= 43 ? C.shell[0]! : x % 2 ? C.crownRidge : C.crown), C.steelEdge);
  paint((x, y) => x >= 57 && x <= 60 && y >= 47 && y <= 48, () => C.crown, C.shellEdge);

  // The dark outline around everything.
  const out = grid.map((row) => [...row]);
  for (let y = 0; y < PODS_H; y++) for (let x = 0; x < PODS_W; x++) {
    if (grid[y]![x]) continue;
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => grid[y + dy!]?.[x + dx!])) out[y]![x] = C.outline;
  }
  return out;
}
function podsSvg(size = 3) {
  const rects = podsGrid().flatMap((row, y) => row.map((fill, x) => (fill ? `<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"/>` : ""))).join("");
  return `<svg class="pods-sprite" width="${PODS_W * size}" height="${PODS_H * size}" viewBox="0 0 ${PODS_W} ${PODS_H}" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
}

/** The More info popup: every month one student wins, the prize in pixel art, and how to get in. */
export function giveawayPopup(): { title: string; body: string } {
  const have = connected();
  const left = GIVEAWAY_FRIENDS - have;
  const pips = Array.from({ length: GIVEAWAY_FRIENDS }, (_, at) => `<span class="${at < have ? "on" : ""}"></span>`).join("");
  const sparkles = [[8, 18], [86, 10], [14, 70], [90, 62], [50, 4]].map(([x, y], at) => `<span class="pods-spark" style="left:${x}%;top:${y}%;animation-delay:${at * 0.37}s"></span>`).join("");
  return { title: `Win ${GIVEAWAY_PRIZE}`, body: `
    <div class="pods-stage" role="img" aria-label="${GIVEAWAY_PRIZE}">
      ${sparkles}
      ${podsSvg()}
      <div class="pods-shadow"></div>
    </div>
    <p class="giveaway-big">Every month, 1 student wins a pair of ${GIVEAWAY_PRIZE}.</p>
    <ol class="giveaway-steps">
      <li><strong>Connect with ${GIVEAWAY_FRIENDS} friends</strong> on Unnepo. A friend counts once they accept.</li>
      <li>You're entered in <strong>every monthly drawing</strong> from then on.</li>
      <li>We pick one winner at random each month and email them.</li>
    </ol>
    <div class="giveaway-progress">
      <span class="giveaway-pips big" role="img" aria-label="${have} of ${GIVEAWAY_FRIENDS} friends">${pips}</span>
      <span class="small">${left ? `${have} of ${GIVEAWAY_FRIENDS} friends. <strong>${left} more to go.</strong>` : "<strong>Entered!</strong> We'll let you know if you win."}</span>
    </div>
    ${left ? `<button type="button" class="btn primary big" data-friend-open="add">Add a friend</button>` : ""}
    <p class="sub">No purchase necessary.</p>` };
}

const ROWS: Array<[keyof Stats, string]> = [["applied", "Applied"], ["emails", "Email sent"], ["followUps", "Follow-up"], ["letters", "Cover letter"], ["replies", "Reply"], ["interviews", "Interview"]];

/** This week's points against one friend: both totals, who's ahead, and where each point came from. */
function scoreCard(friend: Friend) {
  const mine = friends.me;
  const weights = friends.weights;
  if (!mine || !friend.stats || !weights) return `<p class="small">${friend.applied} ${friend.applied === 1 ? "job" : "jobs"} this week.</p>`;
  const theirs = friend.points ?? 0;
  const gap = mine.points - theirs;
  const first = friend.name.split(" ")[0]!;
  const lead = gap > 0 ? `<span class="score-pill ahead">+${gap} ahead</span>` : gap < 0 ? `<span class="score-pill behind">${gap} behind</span>` : `<span class="score-pill">Tied</span>`;
  const side = (label: string, mark: string, points: number, win: boolean, who: string) => `<div class="score-side${win ? " win" : ""} ${who}"><span class="friend-av" aria-hidden="true">${escape(mark)}</span><span class="score-num">${points}</span><span class="sub">${escape(label)}</span></div>`;
  const rows = ROWS.map(([key, label]) => {
    const [a, b] = [mine.stats[key] * weights[key], friend.stats![key] * weights[key]];
    return `<tr><td>${label}</td><td class="pts">${weights[key]} each</td><td class="${a > b ? "win me" : ""}">${a}</td><td class="${b > a ? "win them" : ""}">${b}</td></tr>`;
  }).join("");
  return `<div class="score-top">${side("You", "★", mine.points, gap > 0, "me")}${lead}${side(first, initials(friend.name), theirs, gap < 0, "them")}</div>
    <table class="score-table"><thead><tr><th>Action</th><th class="pts">Points</th><th>You</th><th>${escape(first)}</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="small">Replies and interviews are worth the most, so reaching out pays.</p>`;
}

async function act(body: Record<string, unknown>, done: (result: { status?: string; emailed?: boolean }) => string) {
  friends.busy = true;
  friends.note = "";
  redraw();
  type Answer = { ok: boolean; error?: string; status?: string; emailed?: boolean };
  const result = await ask<Answer>({ type: "friend-action", body }).catch((): Answer => ({ ok: false, error: "Couldn't reach Unnepo." }));
  friends.busy = false;
  // An invite whose email didn't go out shows in the warning color.
  friends.noteBad = !result.ok || (body.action === "invite" && (result.status === "sent" || result.status === "waiting") && !result.emailed);
  friends.note = result.ok ? done(result) : result.error ?? "Couldn't do that.";
  await loadFriends();
}

export function wireFriends(root: HTMLElement) {
  const form = root.querySelector<HTMLFormElement>("#friend-form");
  const input = root.querySelector<HTMLInputElement>("#friend-email");
  input?.addEventListener("input", () => { friends.email = input.value; });
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const email = input?.value.trim() ?? "";
    if (!email) return;
    void act({ action: "invite", email }, (result) => {
      friends.email = "";
      if (result.status === "accepted") return "They'd already asked you, so you're friends now.";
      if (result.status === "already") return "You're already friends.";
      if (result.status === "waiting") return result.emailed ? "Already sent. Waiting for them to accept." : "Saved, but the email to them didn't go out. Unnepo's email isn't working right now; try adding them again later.";
      return result.emailed ? `Sent. ${email} got an email inviting them to compete.` : `Saved, but the email to ${email} didn't go out. They'll see your request under Me once they sign up.`;
    });
  });
  const answer = (id: string, accept: boolean, name = "") => {
    void act({ action: "respond", id, accept }, () => (accept ? "You're friends now." : "Declined.")).then(() => {
      friends.flash = accept ? `You and ${name || "your friend"} are friends now.` : "";
      redraw();
      if (friends.flash) setTimeout(() => { friends.flash = ""; redraw(); }, 4000);
    });
  };
  root.querySelectorAll<HTMLButtonElement>("[data-ask-accept]").forEach((button) => button.addEventListener("click", () => answer(button.dataset.askAccept!, true, button.dataset.askName)));
  root.querySelectorAll<HTMLButtonElement>("[data-ask-decline]").forEach((button) => button.addEventListener("click", () => answer(button.dataset.askDecline!, false)));
  root.querySelectorAll<HTMLButtonElement>("[data-friend-accept]").forEach((button) => button.addEventListener("click", () => void act({ action: "respond", id: button.dataset.friendAccept, accept: true }, () => "You're friends now.")));
  root.querySelectorAll<HTMLButtonElement>("[data-friend-decline]").forEach((button) => button.addEventListener("click", () => void act({ action: "respond", id: button.dataset.friendDecline, accept: false }, () => "Declined.")));
  root.querySelectorAll<HTMLButtonElement>("[data-friend-remove]").forEach((button) => button.addEventListener("click", () => void act({ action: "remove", id: button.dataset.friendRemove }, () => "Removed.")));
}
