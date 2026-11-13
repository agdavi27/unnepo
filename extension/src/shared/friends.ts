import { weekStart } from "@/lib/apply/stats";
import { escape, redraw } from "./tracker-view";

/**
 * Friends, in the side panel. On Week, once there's a friend: each friend and how many jobs they applied to this
 * week. On Me: add a friend by email, answer requests, and remove friends. Only the count
 * is shared, and only once the friend accepts.
 */

type Friend = { id: string; name: string; applied: number };
type Incoming = { id: string; name: string; email: string };
type Outgoing = { id: string; email: string };

const ask = <T>(message: unknown) => chrome.runtime.sendMessage(message) as Promise<T>;

const friends = {
  list: null as Friend[] | null, incoming: [] as Incoming[], outgoing: [] as Outgoing[],
  error: "", loading: false, loadedAt: 0,
  /** What happened after Add, Accept or Remove. */
  note: "", noteBad: false, busy: false, email: "",
};

export async function loadFriends() {
  if (friends.loading) return;
  friends.loading = true;
  type Answer = { ok: boolean; error?: string; friends?: Friend[]; incoming?: Incoming[]; outgoing?: Outgoing[] };
  const result = await ask<Answer>({ type: "friends", since: weekStart(new Date()).toISOString() }).catch((): Answer => ({ ok: false, error: "Couldn't reach Unnepo." }));
  friends.loading = false;
  friends.loadedAt = Date.now();
  if (result.ok) {
    friends.list = result.friends ?? [];
    friends.incoming = result.incoming ?? [];
    friends.outgoing = result.outgoing ?? [];
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

/** Week's friends box: each friend's applications this week, most first. Shown only once a friend is added. */
export function friendsWeekCard(myWeek: number) {
  ensureFriends();
  const head = (extra = "") => `<div class="row-between"><span class="eyebrow">Friends this week</span>${extra}</div>`;
  if (!friends.list) return "";
  const requests = friends.incoming.length ? `<button type="button" class="note warn nudge" data-go="settings">${friends.incoming.length} friend ${friends.incoming.length === 1 ? "request" : "requests"} waiting. See ${friends.incoming.length === 1 ? "it" : "them"} →</button>` : "";
  // No friends yet: nothing here but a request waiting, if there is one. Friends are added under Me.
  if (!friends.list.length) return requests;
  const rows = [{ id: "me", name: "You", applied: myWeek }, ...friends.list].sort((a, b) => b.applied - a.applied);
  const top = Math.max(1, ...rows.map((row) => row.applied));
  return `<section class="page friends-card" aria-label="Friends this week">
    ${head(`<button type="button" class="quiet-link tight" data-go="settings">Add</button>`)}
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
    ...friends.incoming.map((item) => person(`in:${item.id}`, initials(item.name), "Accept", "asking", `${item.name} wants to be friends`)),
    ...list.map((item) => person(`f:${item.id}`, initials(item.name), String(item.applied), "", `${item.name}: ${item.applied} this week`)),
    ...friends.outgoing.map((item) => person(`out:${item.id}`, initials(item.email.split("@")[0]!.replace(/[._-]+/g, " ")), "Sent", "waiting", `Request sent to ${item.email}`)),
  ].join("");
  return `
    <section class="friends-strip" aria-label="Friends this week">
      <span class="eyebrow">Friends this week</span>
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
      <p class="small">Once they accept, you each see how many jobs the other applied to this week. Nothing else is shared.</p>
      <form class="add-row" id="friend-form">
        <input class="field" id="friend-email" type="email" placeholder="friend@school.edu" aria-label="Friend's email" value="${escape(friends.email)}" autocomplete="off" required>
        <button type="submit" class="btn accent" ${busy}>${friends.busy ? "Adding…" : "Add"}</button>
      </form>${note}` };
  }
  const [kind, id] = key.split(":");
  if (kind === "in") {
    const item = friends.incoming.find((entry) => entry.id === id);
    return item ? { title: "Friend request", body: `${head(item.name, item.email, " asking")}<p class="small">${escape(item.name.split(" ")[0]!)} wants to compare weekly applications with you.</p><div class="add-row"><button type="button" class="btn primary grow" data-friend-accept="${item.id}" ${busy}>Accept</button><button type="button" class="btn" data-friend-decline="${item.id}" ${busy}>Decline</button></div>` } : null;
  }
  if (kind === "f") {
    const item = friends.list?.find((entry) => entry.id === id);
    return item ? { title: item.name, body: `${head(item.name, `${item.applied} ${item.applied === 1 ? "job" : "jobs"} this week`)}<button type="button" class="btn" data-friend-remove="${item.id}" ${busy}>Remove friend</button>` } : null;
  }
  const item = friends.outgoing.find((entry) => entry.id === id);
  return item ? { title: "Request sent", body: `${head(item.email, "Waiting for them to accept", " waiting")}<button type="button" class="btn" data-friend-remove="${item.id}" ${busy}>Cancel request</button>` } : null;
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
  root.querySelectorAll<HTMLButtonElement>("[data-friend-accept]").forEach((button) => button.addEventListener("click", () => void act({ action: "respond", id: button.dataset.friendAccept, accept: true }, () => "You're friends now.")));
  root.querySelectorAll<HTMLButtonElement>("[data-friend-decline]").forEach((button) => button.addEventListener("click", () => void act({ action: "respond", id: button.dataset.friendDecline, accept: false }, () => "Declined.")));
  root.querySelectorAll<HTMLButtonElement>("[data-friend-remove]").forEach((button) => button.addEventListener("click", () => void act({ action: "remove", id: button.dataset.friendRemove }, () => "Removed.")));
}
