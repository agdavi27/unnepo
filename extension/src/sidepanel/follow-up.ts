/**
 * The Scan email tab (named Follow up in code), kept simple: one bar to scan Gmail, then two short lists. "Inbox" is the emails that ask for
 * a next step (replies, interviews, offers, no's, and any other follow-up), one per person, job or company, each
 * with the one button that does it, Open email, and × to clear it. "Follow-ups" is up to five people to nudge or
 * email first. How the scan works sits behind "How it works". The scan runs in the background worker.
 */

import { companyWords, type InboxItem, type InboxScan } from "@/lib/apply/inbox-scan";
import { escape, isHiddenJob, jobById, needsFirstEmail, store, todayList } from "../shared/tracker-view";
import type { TrackerJob } from "../shared/types";

const ask = <T>(message: unknown) => chrome.runtime.sendMessage(message) as Promise<T>;

/**
 * `ignored`: what was cleared, with when. An inbox to-do comes back only when a newer email arrives from that
 * person, job or company; a suggestion stays gone.
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

type Words = { title: (item: InboxItem) => string; action: string; tone: "ok" | "accent" | "muted" };
type Outcome = NonNullable<NonNullable<TrackerJob["fillReport"]>["outcome"]>;
/** The status an email moves its job to, with how the button names it. A reply is about the person, not the job. */
const STATUS: Partial<Record<string, { outcome: Outcome; label: string }>> = {
  offer: { outcome: "offer", label: "Offer" },
  interview: { outcome: "interviewing", label: "Interviewing" },
  followup: { outcome: "follow_up", label: "Follow up" },
  rejected: { outcome: "rejected", label: "Rejected" },
};

// How far along a job is. A status button only moves a job forward (or to Rejected), never back from an offer.
const RANK: Record<Outcome, number> = { follow_up: 1, assessment: 2, interviewing: 3, offer: 4, rejected: 5 };
const moves = (job: TrackerJob, to: Outcome) => {
  const now = job.fillReport?.outcome ?? null;
  if (now === "rejected") return false;
  return to === "rejected" || !now || RANK[to] > RANK[now];
};

/**
 * The tracked job an email is about: the one the scan matched, or else one at the same company, since the job may
 * have been added after the scan or named a little differently ("McCormick Taylor, Inc."). Null when none is.
 */
function jobOf(item: InboxItem): TrackerJob | null {
  if (item.applicationId) return jobById(item.applicationId);
  const want = companyWords(item.company).replace(/ /g, "");
  if (want.length < 3 || !store.tracker) return null;
  const same = store.tracker.jobs.filter((job) => {
    const have = companyWords(job.company).replace(/ /g, "");
    return have.length >= 3 && (have === want || (Math.min(have.length, want.length) >= 4 && (have.startsWith(want) || want.startsWith(have))));
  });
  // Several at one company: the one whose title the email names, else the newest.
  const title = (job: TrackerJob) => `${item.subject} ${item.snippet}`.toLowerCase().includes(job.title.toLowerCase());
  return same.find(title) ?? same.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] ?? null;
}
const WORDS: Partial<Record<string, Words>> = {
  reply: { title: (item) => `${item.contactName || item.fromName} replied`, action: "Mark replied", tone: "ok" },
  offer: { title: (item) => `Offer from ${item.company}`, action: "Mark offer", tone: "ok" },
  interview: { title: (item) => `Interview step at ${item.company}`, action: "Mark interviewing", tone: "accent" },
  followup: { title: (item) => `Next step at ${item.company}`, action: "", tone: "accent" },
  rejected: { title: (item) => `${item.company} passed`, action: "Mark rejected", tone: "muted" },
};
const ORDER: Record<string, number> = { reply: 0, offer: 1, interview: 2, followup: 3, rejected: 4 };

const showing = (item: InboxItem) => !(inbox.ignored[item.key] >= item.at);
// Scans saved before this version can hold "thanks for applying" kinds that aren't shown anymore.
const emails = () => (inbox.scan?.items ?? []).filter((item) => WORDS[item.kind] && showing(item)).sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || b.at - a.at);

type Suggestion = { key: string; title: string; detail: string; button: string; later: string };
/**
 * Five follow-ups to do: the ones that are due first (from the reminders), then jobs applied to where nobody's
 * been emailed yet, the longest waiting first.
 */
function suggestions(): Suggestion[] {
  if (!store.tracker) return [];
  const due = todayList().items.map((item): Suggestion => ({
    key: item.key, title: item.title, detail: item.detail,
    button: `<button type="button" class="fu-go" data-remind="${escape(item.key)}">${escape(item.action)}</button>`,
    later: item.kind === "sent"
      ? `<button type="button" class="fu-link" data-remind-mark="${escape(item.key)}">Not yet</button>`
      : `<button type="button" class="fu-link" data-remind-snooze="${escape(item.key)}" title="Hide for 3 days">Later</button>`,
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
        detail: `${job.titleMissing ? "Job title missing" : job.title} · ${waited ? `applied ${waited}d ago` : "applied today"}`,
        button: `<button type="button" class="fu-go" data-bubble-open="${job.id}">${job.contacts.length ? "See who" : "Find people"}</button>`,
        later: "",
      };
    });
  return [...due, ...first].slice(0, 5);
}

/** How many things the Follow up tab has to do: emails that need a next step, and the follow-ups due. */
export const followCount = () => emails().length + todayList().items.length;

const day = (at: number) => new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const ago = (at: number) => {
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
};

const clear = (key: string, label: string) => `<button type="button" class="fu-x" data-inbox-ignore="${escape(key)}" aria-label="Clear: ${escape(label)}" title="Clear">×</button>`;

function emailRow(item: InboxItem) {
  const words = WORDS[item.kind]!;
  const title = words.title(item);
  const busy = inbox.acting.has(item.key);
  // A job already in Unnepo: set its status (a reply marks the person). Otherwise opening the email is the thing to do.
  const job = jobOf(item);
  const status = STATUS[item.kind];
  const action = item.kind === "reply" ? (item.applicationId ? words.action : "") : job && status && moves(job, status.outcome) ? `Update status to ${status.label}` : "";
  const sub = [item.subject || item.snippet, item.count > 1 ? `${item.count} emails` : day(item.at)].filter(Boolean).join(" · ");
  return `
    <li class="fu-item ${words.tone}">
      <span class="fu-dot" aria-hidden="true"></span>
      <div class="fu-body">
        <span class="fu-title">${escape(title)}</span>
        <span class="fu-sub">${escape(sub)}</span>
        <div class="fu-actions">
          ${action ? `<button type="button" class="fu-go" data-inbox-act="${escape(item.key)}" ${busy ? "disabled" : ""}>${busy ? "Saving…" : action}</button>` : ""}
          <a class="${action ? "fu-link" : "fu-go"}" href="${escape(item.url)}" target="_blank" rel="noreferrer">Open email</a>
          ${!job && item.kind !== "rejected" ? `<button type="button" class="fu-link" data-inbox-add="${escape(item.key)}">Add job</button>` : ""}
        </div>
      </div>
      ${clear(item.key, title)}
    </li>`;
}

function suggestionRow(idea: Suggestion) {
  return `
    <li class="fu-item">
      <span class="fu-dot" aria-hidden="true"></span>
      <div class="fu-body">
        <span class="fu-title">${escape(idea.title)}</span>
        ${idea.detail ? `<span class="fu-sub">${escape(idea.detail)}</span>` : ""}
        <div class="fu-actions">${idea.button}${idea.later}</div>
      </div>
      ${idea.key.startsWith("first:") ? clear(idea.key, idea.title) : ""}
    </li>`;
}

const HOW = `
  <details class="fu-how">
    <summary>How it works</summary>
    <p>Unnepo opens Gmail in a background tab for a few seconds, reads the subject and preview of recent emails about jobs, then closes it. Only emails asking for a next step show up here: replies, interviews, offers, no's, and anything asking you to follow up. "Thanks for applying" emails are skipped.</p>
    <p>Your emails are read on this computer and never leave it. Use the Gmail account you're signed in to in Chrome.</p>
    <p>Scan email is still being finished, so it can miss an email now and then.</p>
  </details>`;

export function followView() {
  const scan = inbox.scan;
  const items = scan ? emails() : [];
  const ideas = suggestions();
  const button = `<button type="button" class="${scan ? "fu-scan" : "btn primary big fu-first"}" id="scan-mail" ${inbox.busy ? "disabled" : ""}>${inbox.busy ? "Scanning…" : scan ? "Scan again" : "Scan my email"}</button>`;
  const error = inbox.error ? `<p class="fu-error" role="alert">${escape(inbox.error)}</p>` : "";
  const progress = inbox.busy ? `<div class="bar scan-bar" role="progressbar" aria-label="Scanning your email"><div></div></div>` : "";

  const top = scan
    ? `<div class="fu-bar"><span class="fu-status">${inbox.busy ? "Reading your Gmail…" : `Checked ${ago(scan.at)}`}</span>${button}</div>${progress}${error}`
    : `<section class="fu-start" aria-label="Scan my email">
        <p class="fu-lead">Find replies and next steps in your Gmail.</p>
        ${button}${progress}${error}${HOW}
      </section>`;

  const inboxList = scan ? `
    <section class="fu-section" aria-label="Inbox">
      <div class="fu-head"><span>Inbox${items.length ? ` <b>${items.length}</b>` : ""}</span>${items.length > 1 ? `<button type="button" class="fu-link" data-inbox-ignore-all>Clear all</button>` : ""}</div>
      ${items.length ? `<ul class="fu-list">${items.map(emailRow).join("")}</ul>` : `<p class="fu-empty">Nothing waiting on you.</p>`}
    </section>` : "";

  const followList = `
    <section class="fu-section" aria-label="Follow-ups">
      <div class="fu-head"><span>Follow-ups${ideas.length ? ` <b>${ideas.length}</b>` : ""}</span></div>
      ${ideas.length ? `<ul class="fu-list">${ideas.map(suggestionRow).join("")}</ul>` : `<p class="fu-empty">You're caught up.</p>`}
    </section>`;

  const demo = `<p class="demo-note"><span class="demo-badge">Demo</span>It works, but it's still being finished.</p>`;
  return `<div class="fu">${demo}${top}${inboxList}${followList}${scan ? HOW : ""}</div>`;
}

/** Clears to-dos. An inbox one remembers its newest email, so a newer one brings it back. */
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
 * Wires the tab. `addJob` opens the add-a-job form filled in with the company, for an email about a job that isn't
 * in Unnepo; `refresh` reads the tracker again after a change.
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
  root.querySelector<HTMLButtonElement>("[data-inbox-ignore-all]")?.addEventListener("click", () => {
    const items = emails();
    if (confirm(`Clear all ${items.length}? They come back only if a newer email arrives.`)) void ignore(items.map((item) => item.key));
  });
  root.querySelectorAll<HTMLButtonElement>("[data-inbox-add]").forEach((button) => button.addEventListener("click", () => {
    const item = inbox.scan?.items.find((entry) => entry.key === button.dataset.inboxAdd);
    if (item) hooks.addJob(item);
  }));
  root.querySelectorAll<HTMLButtonElement>("[data-inbox-act]").forEach((button) => button.addEventListener("click", async () => {
    const item = inbox.scan?.items.find((entry) => entry.key === button.dataset.inboxAct);
    if (!item) return;
    inbox.acting.add(item.key);
    redraw();
    const result = item.kind === "reply"
      ? await ask<{ ok: boolean; error?: string }>({ type: "people", body: { action: "status", applicationId: item.applicationId, contactId: item.contactId, status: "replied" } }).catch(() => ({ ok: false, error: "Couldn't reach Unnepo." }))
      : await ask<{ ok: boolean; error?: string }>({ type: "job-status", applicationId: jobOf(item)?.id ?? item.applicationId, outcome: STATUS[item.kind]?.outcome ?? null }).catch(() => ({ ok: false, error: "Couldn't reach Unnepo." }));
    inbox.acting.delete(item.key);
    if (result.ok) await ignore([item.key]);
    else { inbox.error = result.error ?? "Couldn't save it."; redraw(); }
    await hooks.refresh();
  }));
}
