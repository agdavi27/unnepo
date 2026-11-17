/**
 * The Follow up tab: Scan my email, then what it found in two lists: Emails to you (replies, interviews, offers,
 * no's) and Add jobs (applications Unnepo missed). Each is one to-do per person, job or company, with the button
 * that does it, Done and Ignore; each list can be ignored all at once. Under them, five suggested follow-ups, and
 * the quiet updates (applications confirmed) last. The scan runs in the background worker.
 */

import type { InboxItem, InboxScan } from "@/lib/apply/inbox-scan";
import { escape, isHiddenJob, needsFirstEmail, store, todayList } from "../shared/tracker-view";

const ask = <T>(message: unknown) => chrome.runtime.sendMessage(message) as Promise<T>;

/**
 * `ignored`: what was ticked off or ignored, with when. An inbox to-do comes back only when a newer email arrives
 * from that person, job or company; a suggestion stays gone.
 */
const inbox = { scan: null as InboxScan | null, ignored: {} as Record<string, number>, busy: false, error: "", acting: new Set<string>(), loaded: false };
let redraw = () => undefined as void;

void chrome.storage.local.get(["inboxScan", "inboxIgnored"]).then((stored) => {
  inbox.scan = (stored.inboxScan as InboxScan | undefined) ?? null;
  inbox.ignored = (stored.inboxIgnored as Record<string, number> | undefined) ?? {};
  inbox.loaded = true;
  redraw();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.inboxScan) inbox.scan = (changes.inboxScan.newValue as InboxScan | undefined) ?? null;
  if (changes.inboxIgnored) inbox.ignored = (changes.inboxIgnored.newValue as Record<string, number> | undefined) ?? {};
  if (changes.inboxScan || changes.inboxIgnored) redraw();
});

const showing = (item: InboxItem) => !(inbox.ignored[item.key] >= item.at);
const EMAIL_KINDS = new Set<InboxItem["kind"]>(["reply", "offer", "interview", "rejected"]);
const ORDER: Record<InboxItem["kind"], number> = { reply: 0, offer: 1, interview: 2, rejected: 3, new: 4, confirmed: 5 };
const emails = () => (inbox.scan?.items ?? []).filter((item) => EMAIL_KINDS.has(item.kind) && showing(item)).sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || b.at - a.at);
const missed = () => (inbox.scan?.items ?? []).filter((item) => item.kind === "new" && showing(item)).sort((a, b) => b.at - a.at);
const updates = () => (inbox.scan?.items ?? []).filter((item) => item.kind === "confirmed");

type Suggestion = { key: string; title: string; detail: string; button: string; later: string };
/**
 * Five follow-ups to do: the follow-ups that are due first (from the reminders), then jobs applied to where
 * nobody's been emailed yet, the longest waiting first.
 */
function suggestions(): Suggestion[] {
  if (!store.tracker) return [];
  const due = todayList().items.map((item): Suggestion => ({
    key: item.key, title: item.title, detail: item.detail,
    button: `<button type="button" class="solid" data-remind="${escape(item.key)}">${escape(item.action)}</button>`,
    later: item.kind === "sent" ? `<button type="button" class="quiet-link" data-remind-mark="${escape(item.key)}">Not yet</button>` : `<button type="button" class="quiet-link" data-remind-snooze="${escape(item.key)}" title="Hide for 3 days">Later</button>`,
  }));
  const days = (at: string) => Math.max(0, Math.floor((Date.now() - Date.parse(at)) / 86_400_000));
  const first = store.tracker.jobs
    .filter((job) => needsFirstEmail(job) && !isHiddenJob(job) && !inbox.ignored[`first:${job.id}`])
    .sort((a, b) => Date.parse(a.submittedAt ?? a.createdAt) - Date.parse(b.submittedAt ?? b.createdAt))
    .map((job): Suggestion => {
      const waited = days(job.submittedAt ?? job.createdAt);
      return {
        key: `first:${job.id}`,
        title: `Email someone at ${job.companyMissing ? "this company" : job.company}`,
        detail: `${job.titleMissing ? "Job title missing" : job.title} · ${waited ? `applied ${waited} ${waited === 1 ? "day" : "days"} ago` : "applied today"}`,
        button: `<button type="button" class="solid" data-bubble-open="${job.id}">${job.contacts.length ? "See who to email" : "Find people"}</button>`,
        later: `<button type="button" class="quiet-link" data-inbox-ignore="first:${job.id}">Ignore</button>`,
      };
    });
  return [...due, ...first].slice(0, 5);
}

/** How many things the Follow up tab has to do: emails to answer, jobs to add, and the follow-ups due. */
export const followCount = () => emails().length + missed().length + todayList().items.length;

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
  const more = item.count > 1 ? `${item.count} emails` : "";
  const sub = [item.kind === "new" ? "" : item.jobTitle, item.subject, more || day(item.at)].filter(Boolean).join(" · ");
  return `
    <li class="todo ${words.tone}">
      <button type="button" class="todo-check" data-inbox-ignore="${escape(item.key)}" aria-label="Done: ${escape(words.title(item))}" title="Done"></button>
      <div class="todo-text">
        <span class="todo-title">${escape(words.title(item))}</span>
        <span class="sub">${escape(sub)}</span>
        <div class="todo-actions">
          ${words.action ? `<button type="button" class="solid" data-inbox-act="${escape(item.key)}" ${busy ? "disabled" : ""}>${busy ? "Saving…" : words.action}</button>` : ""}
          <a class="quiet-link" href="${escape(item.url)}" target="_blank" rel="noreferrer">Open email ↗</a>
          <button type="button" class="quiet-link" data-inbox-ignore="${escape(item.key)}">Ignore</button>
        </div>
      </div>
    </li>`;
}

/** One list: its name, how many, Ignore all, then the to-dos (or a line when there are none). */
function list(name: string, items: InboxItem[], group: string, empty: string) {
  return `
    <section class="page" aria-label="${escape(name)}">
      <div class="row-between"><span class="eyebrow">${escape(name)}${items.length ? ` · ${items.length}` : ""}</span>${items.length > 1 ? `<button type="button" class="quiet-link tight" data-inbox-ignore-all="${group}">Ignore all</button>` : ""}</div>
      ${items.length ? `<ul class="todo-list">${items.map(row).join("")}</ul>` : `<p class="note">${escape(empty)}</p>`}
    </section>`;
}

export function followView() {
  const scan = inbox.scan;
  const news = updates();
  const ideas = suggestions();
  const status = inbox.busy ? "Reading your Gmail…" : scan ? `Scanned ${ago(scan.at)} · ${scan.looked} ${scan.looked === 1 ? "email" : "emails"}` : "Not scanned yet";
  return `
    <section class="page follow-scan" aria-label="Scan my email">
      <div class="row-between"><span class="eyebrow">Your inbox</span><span class="sub mono">${escape(status)}</span></div>
      <p class="small">Unnepo looks through your Gmail for replies, interviews, offers, no's and applications it missed. Your emails are read on this computer and never leave it.</p>
      <button type="button" class="btn primary big" id="scan-mail" ${inbox.busy ? "disabled" : ""}>${inbox.busy ? "Scanning…" : scan ? "Scan again" : "Scan my email"}</button>
      ${inbox.busy ? `<div class="bar scan-bar" role="progressbar" aria-label="Scanning your email"><div></div></div><span class="sub">A Gmail tab opens in the background for a few seconds, then closes.</span>` : ""}
      ${inbox.error ? `<p class="small" style="color: var(--warn)" role="alert">${escape(inbox.error)}</p>` : ""}
    </section>
    ${scan ? `${list("Emails to you", emails(), "emails", "Nothing new: no replies, interviews or no's to deal with.")}
    ${list("Add jobs", missed(), "missed", "Every application in your inbox is in Unnepo.")}` : ""}
    <section class="page" aria-label="Suggested follow-ups">
      <div class="row-between"><span class="eyebrow">Suggested follow-ups</span>${ideas.length ? `<span class="mono">${ideas.length}</span>` : ""}</div>
      ${ideas.length ? `<ul class="todo-list">${ideas.map((idea) => `
        <li class="todo"><span class="todo-num" aria-hidden="true">${ideas.indexOf(idea) + 1}</span>
          <div class="todo-text"><span class="todo-title">${escape(idea.title)}</span>${idea.detail ? `<span class="sub">${escape(idea.detail)}</span>` : ""}
            <div class="todo-actions">${idea.button}${idea.later}</div></div></li>`).join("")}</ul>`
        : `<p class="note ok">Nothing to follow up on. Apply to a job and email someone there, and Unnepo suggests when to follow up.</p>`}
    </section>
    ${news.length ? `<details class="page follow-updates"><summary><span class="eyebrow">Updates</span><span class="mono">${news.length}</span></summary>
      <ul class="todo-list quiet">${news.map((item) => `<li class="todo muted"><span class="todo-dot" aria-hidden="true">✓</span><div class="todo-text"><span class="todo-title">${escape(WORDS.confirmed.title(item))}</span><span class="sub">${escape([item.jobTitle, day(item.at)].filter(Boolean).join(" · "))}</span></div></li>`).join("")}</ul>
    </details>` : ""}`;
}

/** Ticks off or ignores to-dos. An inbox one remembers its newest email, so a newer one brings it back. */
async function ignore(keys: string[]) {
  const items = inbox.scan?.items ?? [];
  for (const key of keys) inbox.ignored[key] = items.find((item) => item.key === key)?.at ?? Date.now();
  // Kept small: the newest 500.
  const kept = Object.fromEntries(Object.entries(inbox.ignored).sort((a, b) => b[1] - a[1]).slice(0, 500));
  inbox.ignored = kept;
  await chrome.storage.local.set({ inboxIgnored: kept });
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
  root.querySelectorAll<HTMLButtonElement>("[data-inbox-ignore]").forEach((button) => button.addEventListener("click", () => void ignore([button.dataset.inboxIgnore!])));
  root.querySelectorAll<HTMLButtonElement>("[data-inbox-ignore-all]").forEach((button) => button.addEventListener("click", () => {
    const items = button.dataset.inboxIgnoreAll === "emails" ? emails() : missed();
    if (confirm(`Ignore all ${items.length}? They come back only if a newer email arrives.`)) void ignore(items.map((item) => item.key));
  }));
  root.querySelectorAll<HTMLButtonElement>("[data-inbox-act]").forEach((button) => button.addEventListener("click", async () => {
    const item = inbox.scan?.items.find((entry) => entry.key === button.dataset.inboxAct);
    if (!item) return;
    if (item.kind === "new") {
      await ignore([item.key]);
      return hooks.addJob(item);
    }
    inbox.acting.add(item.key);
    redraw();
    const outcome = { offer: "offer", interview: "interviewing", rejected: "rejected" }[item.kind as "offer" | "interview" | "rejected"];
    const result = item.kind === "reply"
      ? await ask<{ ok: boolean; error?: string }>({ type: "people", body: { action: "status", applicationId: item.applicationId, contactId: item.contactId, status: "replied" } }).catch(() => ({ ok: false, error: "Couldn't reach Unnepo." }))
      : await ask<{ ok: boolean; error?: string }>({ type: "job-status", applicationId: item.applicationId, outcome }).catch(() => ({ ok: false, error: "Couldn't reach Unnepo." }));
    inbox.acting.delete(item.key);
    if (result.ok) await ignore([item.key]);
    else { inbox.error = result.error ?? "Couldn't save it."; redraw(); }
    await hooks.refresh();
  }));
}
