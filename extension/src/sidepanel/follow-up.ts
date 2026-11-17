/**
 * The Follow up tab: Scan my email, then a to-do list from the inbox (replies, interviews, offers, no's and
 * applications Unnepo missed), each with the one button that does it and a box to tick it off, then the follow-ups
 * that are due, and the quiet updates (applications confirmed) last. The scan runs in the background worker.
 */

import type { InboxItem, InboxScan } from "@/lib/apply/inbox-scan";
import { escape, remindersCard, todayList } from "../shared/tracker-view";

const ask = <T>(message: unknown) => chrome.runtime.sendMessage(message) as Promise<T>;

const inbox = { scan: null as InboxScan | null, done: new Set<string>(), busy: false, error: "", acting: new Set<string>(), loaded: false };
let redraw = () => undefined as void;

void chrome.storage.local.get(["inboxScan", "inboxDone"]).then((stored) => {
  inbox.scan = (stored.inboxScan as InboxScan | undefined) ?? null;
  inbox.done = new Set((stored.inboxDone as string[] | undefined) ?? []);
  inbox.loaded = true;
  redraw();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.inboxScan) inbox.scan = (changes.inboxScan.newValue as InboxScan | undefined) ?? null;
  if (changes.inboxDone) inbox.done = new Set((changes.inboxDone.newValue as string[] | undefined) ?? []);
  if (changes.inboxScan || changes.inboxDone) redraw();
});

const TODO_KINDS = new Set<InboxItem["kind"]>(["reply", "offer", "interview", "rejected", "new"]);
const ORDER: Record<InboxItem["kind"], number> = { reply: 0, offer: 1, interview: 2, new: 3, rejected: 4, confirmed: 5 };
const todos = () => (inbox.scan?.items ?? []).filter((item) => TODO_KINDS.has(item.kind) && !inbox.done.has(item.key)).sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || b.at - a.at);
const updates = () => (inbox.scan?.items ?? []).filter((item) => item.kind === "confirmed");

/** How many things the Follow up tab has to do: the inbox's to-dos and the follow-ups due. */
export const followCount = () => todos().length + todayList().items.length;

const day = (at: number) => new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const ago = (at: number) => {
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
};

const WORDS: Record<InboxItem["kind"], { title: (item: InboxItem) => string; action: string; tone: string }> = {
  reply: { title: (item) => `${item.contactName || item.fromName} replied`, action: "Mark replied", tone: "ok" },
  offer: { title: (item) => `Offer from ${item.company}`, action: "Set Offer", tone: "ok" },
  interview: { title: (item) => `Next step at ${item.company}`, action: "Set Interviewing", tone: "accent" },
  rejected: { title: (item) => `${item.company} said no`, action: "Set Rejected", tone: "muted" },
  new: { title: (item) => `Applied to ${item.company}?`, action: "Add job", tone: "warn" },
  confirmed: { title: (item) => `${item.company} got your application`, action: "", tone: "muted" },
};

function row(item: InboxItem) {
  const words = WORDS[item.kind];
  const busy = inbox.acting.has(item.key);
  const sub = [item.kind === "new" ? "Not in your jobs yet" : item.jobTitle, item.subject, day(item.at)].filter(Boolean).join(" · ");
  return `
    <li class="todo ${words.tone}">
      <button type="button" class="todo-check" data-inbox-done="${escape(item.key)}" aria-label="Done: ${escape(words.title(item))}" title="Done"></button>
      <div class="todo-text">
        <span class="todo-title">${escape(words.title(item))}</span>
        <span class="sub">${escape(sub)}</span>
        <div class="todo-actions">
          ${words.action ? `<button type="button" class="solid" data-inbox-act="${escape(item.key)}" ${busy ? "disabled" : ""}>${busy ? "Saving…" : words.action}</button>` : ""}
          <a class="quiet-link" href="${escape(item.url)}" target="_blank" rel="noreferrer">Open email ↗</a>
        </div>
      </div>
    </li>`;
}

export function followView() {
  const scan = inbox.scan;
  const list = todos();
  const news = updates();
  const status = inbox.busy ? "Reading your Gmail…" : scan ? `Scanned ${ago(scan.at)} · ${scan.looked} ${scan.looked === 1 ? "email" : "emails"}` : "Not scanned yet";
  return `
    <section class="page follow-scan" aria-label="Scan my email">
      <div class="row-between"><span class="eyebrow">Your inbox</span><span class="sub mono">${escape(status)}</span></div>
      <p class="small">Unnepo looks through your Gmail for replies, interviews, offers, no's and application confirmations, and turns them into a to-do list. Your emails are read on this computer and never leave it.</p>
      <button type="button" class="btn primary big" id="scan-mail" ${inbox.busy ? "disabled" : ""}>${inbox.busy ? "Scanning…" : scan ? "Scan again" : "Scan my email"}</button>
      ${inbox.busy ? `<div class="bar scan-bar" role="progressbar" aria-label="Scanning your email"><div></div></div><span class="sub">A Gmail tab opens in the background for a few seconds, then closes.</span>` : ""}
      ${inbox.error ? `<p class="small" style="color: var(--warn)" role="alert">${escape(inbox.error)}</p>` : ""}
    </section>
    <section class="page" aria-label="To do">
      <div class="row-between"><span class="eyebrow">To do</span>${list.length ? `<span class="mono">${list.length}</span>` : ""}</div>
      ${list.length ? `<ul class="todo-list">${list.map(row).join("")}</ul>`
        : `<p class="note${scan ? " ok" : ""}">${scan ? "Nothing new from your inbox. You're caught up." : "Scan your email to see replies, interviews and updates here."}</p>`}
    </section>
    ${remindersCard(8, "Follow-ups due", false)}
    ${news.length ? `<details class="page follow-updates"><summary><span class="eyebrow">Updates</span><span class="mono">${news.length}</span></summary>
      <ul class="todo-list quiet">${news.map((item) => `<li class="todo muted"><span class="todo-dot" aria-hidden="true">✓</span><div class="todo-text"><span class="todo-title">${escape(WORDS.confirmed.title(item))}</span><span class="sub">${escape([item.jobTitle, day(item.at)].filter(Boolean).join(" · "))}</span></div></li>`).join("")}</ul>
    </details>` : ""}`;
}

async function markDone(key: string) {
  inbox.done.add(key);
  const kept = [...inbox.done].slice(-500);
  await chrome.storage.local.set({ inboxDone: kept });
  redraw();
}

/**
 * Wires the tab. `addJob` opens the add-a-job form filled in with the company, for an application Unnepo missed;
 * `refresh` reads the tracker again after a change.
 */
export function wireFollow(root: HTMLElement, hooks: { redraw: () => void; addJob: (item: InboxItem) => void; refresh: () => Promise<void> | void }) {
  redraw = hooks.redraw;
  if (!inbox.loaded) return;
  root.querySelector<HTMLButtonElement>("#scan-mail")?.addEventListener("click", async () => {
    inbox.busy = true;
    inbox.error = "";
    redraw();
    type Scanned = { ok: boolean; error?: string; scan?: InboxScan };
    const result = await ask<Scanned>({ type: "inbox-scan" }).catch((): Scanned => ({ ok: false, error: "Couldn't reach Unnepo." }));
    inbox.busy = false;
    if (result.ok && result.scan) inbox.scan = result.scan;
    else inbox.error = result.error ?? "Couldn't read your email.";
    redraw();
  });
  root.querySelectorAll<HTMLButtonElement>("[data-inbox-done]").forEach((button) => button.addEventListener("click", () => void markDone(button.dataset.inboxDone!)));
  root.querySelectorAll<HTMLButtonElement>("[data-inbox-act]").forEach((button) => button.addEventListener("click", async () => {
    const item = inbox.scan?.items.find((entry) => entry.key === button.dataset.inboxAct);
    if (!item) return;
    if (item.kind === "new") {
      await markDone(item.key);
      return hooks.addJob(item);
    }
    inbox.acting.add(item.key);
    redraw();
    const outcome = { offer: "offer", interview: "interviewing", rejected: "rejected" }[item.kind as "offer" | "interview" | "rejected"];
    const result = item.kind === "reply"
      ? await ask<{ ok: boolean; error?: string }>({ type: "people", body: { action: "status", applicationId: item.applicationId, contactId: item.contactId, status: "replied" } }).catch(() => ({ ok: false, error: "Couldn't reach Unnepo." }))
      : await ask<{ ok: boolean; error?: string }>({ type: "job-status", applicationId: item.applicationId, outcome }).catch(() => ({ ok: false, error: "Couldn't reach Unnepo." }));
    inbox.acting.delete(item.key);
    if (result.ok) await markDone(item.key);
    else { inbox.error = result.error ?? "Couldn't save it."; redraw(); }
    await hooks.refresh();
  }));
}
