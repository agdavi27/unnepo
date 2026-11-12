import { stageOf } from "@/lib/apply/stats";
import { followUpsDue } from "@/lib/apply/follow-ups";
import { STEPS, STEP_LABEL, progressOf as sharedProgress, type Progress } from "@/lib/apply/progress";
import { MAX_FOLLOW_UPS, reminders, type Reminder } from "./reminders";
import type { Detected, Mailer, OpenedEmails, ReminderMarks, Tracker, TrackerContact, TrackerJob } from "./types";

/**
 * What the side panel and the dashboard share: the tracker as the extension keeps it, a job's own page with the
 * People card, Home's reminders, and the Detected jobs menu. Each page draws these as HTML and wires them after.
 * Every action goes through the background worker, which holds the token.
 */

export const escape = (text: string) => text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const ask = <T>(message: unknown) => chrome.runtime.sendMessage(message) as Promise<T>;
const short = (text: string, max = 60) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** What the page around this does: draw again, open a job (and a person on it), and where the plans are. */
export type Host = { redraw: () => void; openJob: (id: string, contactId?: string) => void; upgradeUrl: () => string; addJob?: (from: Detected) => void };

// ---- The tracker, kept here between draws ----

export const store = {
  tracker: null as Tracker | null, error: "", loading: false, loadedAt: 0,
  detected: null as Detected[] | null,
  marks: {} as ReminderMarks, opened: {} as OpenedEmails, followUps: {} as Record<string, number>,
  mailer: "gmail" as Mailer,
  /** What happened last, per job: "Copied", an error. */
  notes: {} as Record<string, string>,
  busy: new Set<string>(),
};

let host: Host = { redraw: () => undefined, openJob: () => undefined, upgradeUrl: () => "" };
export function setHost(next: Host) { host = next; }
/** Draws the page around this again. */
export const redraw = () => host.redraw();

export async function loadTracker(fresh = false) {
  if (store.loading) return;
  store.loading = true;
  const [result, local, detected] = await Promise.all([
    ask<{ ok: boolean; tracker?: Tracker; error?: string }>({ type: "tracker", fresh }).catch(() => ({ ok: false, error: "Couldn't reach Unnepo." })),
    chrome.storage.local.get(["reminderMarks", "openedEmails", "followUps", "mailer"]),
    ask<{ ok: boolean; list?: Detected[] }>({ type: "detected-list" }).catch(() => ({ ok: false, list: [] })),
  ]);
  store.loading = false;
  store.loadedAt = Date.now();
  if (result.ok && "tracker" in result && result.tracker) { store.tracker = result.tracker; store.error = ""; }
  else store.error = (result as { error?: string }).error ?? "Couldn't load your jobs.";
  store.marks = (local.reminderMarks as ReminderMarks | undefined) ?? {};
  store.opened = (local.openedEmails as OpenedEmails | undefined) ?? {};
  store.followUps = (local.followUps as Record<string, number> | undefined) ?? {};
  store.mailer = (local.mailer as Mailer | undefined) ?? "gmail";
  store.detected = (detected as { list?: Detected[] }).list ?? [];
  host.redraw();
  pollWhileFinding();
}

/** Loads the tracker the first time, and again when it's older than `maxAge`. */
export function ensureTracker(maxAge = 20_000) {
  if (!store.loading && (!store.tracker || Date.now() - store.loadedAt > maxAge)) void loadTracker();
}

// A people search runs on the server for up to a minute: the job is read again until it's done.
let pollTimer = 0;
function pollWhileFinding() {
  clearTimeout(pollTimer);
  if (store.tracker?.jobs.some((job) => job.contactsStatus === "finding" || job.contactsStatus === "writing")) pollTimer = window.setTimeout(() => void loadTracker(true), 4000);
}

export const jobById = (id: string) => store.tracker?.jobs.find((job) => job.id === id) ?? null;

// ---- Labels ----

const STAGE_LABEL: Record<string, string> = {
  in_progress: "Not applied yet", submitted: "Applied", no_response: "No response", follow_up: "Follow up",
  assessment: "Assessment", interviewing: "Interviewing", offer: "Offer", rejected: "Rejected",
};
export const stageLabel = (job: TrackerJob) => STAGE_LABEL[stageOf(job as never)] ?? "Applied";
export const isAppliedJob = (job: TrackerJob) => job.status === "submitted" || job.status === "applied_manual";
/** How many people were emailed about a job: the student's own count, or the people on the list marked emailed. */
export const emailedCount = (job: TrackerJob) => Math.max(job.fillReport?.reachedOut?.count ?? 0, job.contacts.filter((person) => person.outreachStatus !== "not_contacted").length);
/** Applied, still in the running, and nobody emailed yet: the Follow up tab's list. */
export const needsFirstEmail = (job: TrackerJob) => {
  if (!isAppliedJob(job) || emailedCount(job)) return false;
  const stage = stageOf(job as never);
  return stage !== "rejected" && stage !== "offer";
};

// ---- A job's progress: Applied → Reach out → Waiting → Follow up → Interview ----

/** Where a job is; the extension also knows who was sent a follow-up. */
export function progressOf(job: TrackerJob, now = new Date()): Progress {
  return sharedProgress(job, job.contacts.some((person) => (store.followUps[person.id] ?? 0) > 0), now);
}

/** The progress line on a job's page: five dots joined by a line, done ones green, the current one ringed. */
export function progressLine(job: TrackerJob) {
  const progress = progressOf(job);
  const steps = STEPS.map((label, index) => {
    const state = index < progress.done ? "done" : index === progress.done && !progress.ended ? (progress.due ? "due" : "now") : "";
    return `<li class="step ${state}"${state === "now" || state === "due" ? ' aria-current="step"' : ""}><i aria-hidden="true">${state === "done" ? "✓" : ""}</i>${label}</li>`;
  }).join("");
  return `<div class="progress${progress.ended ? ` ended ${progress.ended.toLowerCase()}` : ""}">
    <ol class="steps-line" aria-label="Progress">${steps}</ol>
    <p class="progress-next${progress.due ? " due" : ""}">${progress.ended ? `<span class="status${progress.ended === "Offer" ? " done" : ""}">${progress.ended}</span> ` : ""}${escape(progress.next)}</p>
  </div>`;
}

/** The same line, small: five bars for a job's row in a list. */
export function progressDots(job: TrackerJob) {
  const progress = progressOf(job);
  const bars = STEPS.map((_, index) => `<i class="${index < progress.done ? "d" : index === progress.done && !progress.ended ? (progress.due ? "w" : "n") : ""}"></i>`).join("");
  const label = progress.ended ?? STEP_LABEL[progress.done];
  return `<span class="dots-wrap"><span class="dots" aria-hidden="true">${bars}</span><span class="dots-label${progress.due ? " due" : progress.ended === "Offer" || progress.done >= 5 ? " ok" : ""}">${escape(label)}</span></span>`;
}

const ROLE_LABEL: Record<string, string> = { alumni: "Alum", recruiter: "Recruiter", department: "Team", poster: "Posted the job" };
const EMAIL_SOURCE: Record<string, string> = {
  apollo: "Verified", hunter: "Verified", pattern: "Verified", job_posting: "From the job posting", website: "From the company's website",
  likely: "Likely: follows the company's format, not checked", cant_check: "Can't be checked: the company accepts every address", guess: "Best guess",
};
const when = (at: string) => {
  const date = new Date(at);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }) });
};

// ---- The email link ----

/** Links that are cut off past this length (mailto and Outlook): longer emails go on the clipboard instead. */
const MAX_LINK = 2000;

/** The email ready to send, in Gmail, Outlook on the web, or the mail app. `cut`: the body didn't fit in the link. */
export function composeLink(mailer: Mailer, to: string, subject: string, body: string) {
  const q = (pairs: Record<string, string>) => Object.entries(pairs).filter(([, value]) => value).map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&");
  const build = (text: string) => mailer === "gmail"
    ? `https://mail.google.com/mail/?${q({ view: "cm", fs: "1", to, su: subject, body: text })}`
    : mailer === "outlook"
      ? `https://outlook.office.com/mail/deeplink/compose?${q({ to, subject, body: text })}`
      : `mailto:${encodeURIComponent(to).replace(/%40/g, "@")}?${q({ subject, body: text })}`;
  const full = build(body);
  return full.length <= MAX_LINK ? { url: full, cut: false } : { url: build(""), cut: true };
}

const MAILER_NAME: Record<Mailer, string> = { gmail: "Gmail", outlook: "Outlook", mailto: "your mail app" };

// ---- A job's page ----

/** Which people on a job are open (their email showing), kept between draws. */
const openPeople = new Set<string>();
/** People whose email link was just opened, for the "I emailed them" button right under it. */
const justOpened = new Map<string, boolean>();
const drafts: Record<string, { subject: string; body: string }> = {};
const websites: Record<string, string> = {};

export function jobPage(job: TrackerJob, focus?: string) {
  if (focus) openPeople.add(focus);
  const applied = isAppliedJob(job);
  const stage = stageOf(job as never);
  const pick = (value: string, label: string) => `<option value="${value}"${(stage === "no_response" ? "submitted" : stage) === value ? " selected" : ""}>${label}</option>`;
  const note = store.notes[job.id];
  return `
    <section class="page job-view" aria-label="${escape(job.title)}">
      <div>
        <div class="job-name small-name">${escape(job.titleMissing ? "Job title missing" : job.title)}</div>
        <div class="job-detail">${escape(job.companyMissing ? "Company missing" : job.company)}${job.location ? ` · ${escape(job.location)}` : ""}</div>
        <div class="sub">${applied ? `Applied ${when(job.submittedAt ?? job.createdAt)}${job.confirmation?.confidence === "confirmed" ? " · the site confirmed it" : ""}` : `Saved ${when(job.createdAt)}`}</div>
      </div>
      ${progressLine(job)}
      ${applied
        ? `<label class="question"><span class="q-label">Status</span><select class="field" data-outcome="${job.id}">${pick("submitted", "Applied")}${pick("follow_up", "Follow up")}${stage === "assessment" ? pick("assessment", "Assessment") : ""}${pick("interviewing", "Interviewing")}${pick("offer", "Offer")}${pick("rejected", "Rejected")}</select></label>`
        : `<button type="button" class="solid" data-mark-applied="${job.id}">I applied to this</button>`}
      ${applied ? reachPicker(job) : ""}
      <div class="links">
        ${job.url ? `<a class="link" href="${escape(job.url)}" target="_blank" rel="noreferrer">Job posting ↗</a>` : ""}
        <button type="button" class="link" data-delete-job="${job.id}">Delete job</button>
      </div>
      ${note ? `<p class="small" role="status">${escape(note)}</p>` : ""}
    </section>
    ${peopleCard(job)}`;
}

/** "People you emailed: None · 1 · 2 · 3+", one tap to say how many people were reached out to. */
function reachPicker(job: TrackerJob) {
  const count = emailedCount(job);
  const busy = store.busy.has(`reach:${job.id}`);
  const option = (value: number, label: string) => {
    const on = value === 3 ? count >= 3 : count === value;
    return `<button type="button" class="seg-btn${on ? " on" : ""}" data-reach="${value}" data-reach-job="${job.id}" aria-pressed="${on}" ${busy ? "disabled" : ""}>${label}</button>`;
  };
  return `<div class="question" role="group" aria-label="People you emailed about this job">
    <span class="q-label">People you emailed</span>
    <div class="seg">${option(0, "None yet")}${option(1, "1")}${option(2, "2")}${option(3, "3+")}</div>
  </div>`;
}

/** Saves how many people were emailed; the job leaves the Follow up tab's "No email yet" list once it's 1 or more. */
async function setReached(jobId: string, count: number) {
  const key = `reach:${jobId}`;
  store.busy.add(key);
  // Shown at once; the tracker is read again behind it.
  const job = jobById(jobId);
  if (job) job.fillReport = { ...(job.fillReport ?? { outcome: null, peopleReveals: 0 }), reachedOut: count ? { count, at: job.fillReport?.reachedOut?.at ?? new Date().toISOString() } : undefined };
  host.redraw();
  const result = await ask<{ ok: boolean; error?: string }>({ type: "job-status", applicationId: jobId, reachedOut: count }).catch(() => ({ ok: false, error: "Couldn't reach Unnepo." }));
  store.busy.delete(key);
  store.notes[jobId] = result.ok ? "" : result.error ?? "Couldn't save it.";
  await loadTracker(true);
}

/** The emailed buttons, on a job's page and on the Follow up tab. */
export function wireReach(root: HTMLElement) {
  root.querySelectorAll<HTMLButtonElement>("[data-reach-job]").forEach((button) => button.addEventListener("click", () => void setReached(button.dataset.reachJob!, Number(button.dataset.reach))));
}

function peopleCard(job: TrackerJob) {
  const company = job.companyMissing ? "this company" : job.company;
  const posted = job.postedRecruiter
    ? `<p class="small">Posted by <strong>${escape(job.postedRecruiter.name)}</strong>${job.postedRecruiter.title ? `, ${escape(job.postedRecruiter.title)}` : ""}${job.postedRecruiter.linkedinUrl ? ` · <a href="${escape(job.postedRecruiter.linkedinUrl)}" target="_blank" rel="noreferrer">LinkedIn ↗</a>` : ""}</p>`
    : "";
  const head = `<div class="row-between"><span class="eyebrow">People at ${escape(short(company, 28))}</span>${job.contacts.length ? `<span class="mono">${job.contacts.length}</span>` : ""}</div>`;
  if (!isAppliedJob(job)) {
    return `<section class="page people" aria-label="People">${head}${posted}<p class="note">Once you apply, Unnepo finds who to email here: recruiters, the team, and people from your school.</p></section>`;
  }
  const preview = !job.contacts.length && job.contactsStatus === "done" ? job.fillReport?.peoplePreview : undefined;
  if (preview?.rows.length && store.tracker?.free) {
    const count = (role: string) => preview.rows.filter((row) => row.role === role).length;
    const words = (n: number, one: string, many: string) => (n ? `${n} ${n === 1 ? one : many}` : "");
    const parts = [words(count("recruiter"), "recruiter", "recruiters"), words(count("alumni"), "alum", "alumni"), words(count("department"), "person on the team", "people on the team")].filter(Boolean);
    return `<section class="page people" aria-label="People">${head}${posted}
      <p class="note">Unnepo found ${escape(parts.join(", ") || `${preview.rows.length} people`)} at ${escape(company)}.</p>
      <a class="btn primary" href="${escape(host.upgradeUrl())}" target="_blank" rel="noreferrer">See who they are with Pro</a></section>`;
  }
  if (job.contactsStatus === "idle" || (preview && !store.tracker?.free)) {
    return `<section class="page people" aria-label="People">${head}${posted}
      <p class="note">Recruiters, the team, and people you have something in common with.</p>
      <button type="button" class="btn primary" data-find-people="${job.id}" ${store.busy.has(`find:${job.id}`) ? "disabled" : ""}>Find people</button>
      ${store.tracker?.peopleNote ? `<p class="small" style="color: var(--warn)">${escape(store.tracker.peopleNote)}</p>` : ""}</section>`;
  }
  const stale = job.contactsStatus === "finding" && Date.now() - Date.parse(job.updatedAt) > 2 * 60 * 1000;
  if ((job.contactsStatus === "finding" || job.contactsStatus === "writing") && !stale) {
    return `<section class="page people" aria-label="People">${head}${posted}<p class="note" role="status">${escape(job.contactsMessage || `Searching for people at ${company}…`)}</p></section>`;
  }
  const none = !job.contacts.length;
  const linkedIn = (label: string, keywords: string) => `<a class="link" href="https://www.linkedin.com/search/results/people/?${new URLSearchParams({ keywords })}" target="_blank" rel="noreferrer">${label} on LinkedIn ↗</a>`;
  return `
    <section class="page people" aria-label="People">${head}${posted}
      ${job.contactsMessage && none ? `<p class="small">${escape(job.contactsMessage)}</p>` : ""}
      ${none ? `
        <p class="note">${stale || job.contactsStatus === "failed" ? "That search didn't finish." : `No one found at ${escape(company)} yet.`}</p>
        <div class="links">${linkedIn("Recruiters", `recruiter ${job.company}`)}${linkedIn("The team", `${job.department || job.title} ${job.company}`)}</div>
        <div class="connect-code"><input class="field" data-website="${job.id}" value="${escape(websites[job.id] ?? "")}" placeholder="Company website, like acme.com" aria-label="Company website"><button type="button" class="solid" data-find-people="${job.id}">Search again</button></div>`
        : `<ul class="people-list">${job.contacts.map((person, index) => personRow(job, person, index === job.contacts.findIndex((other) => other.email))).join("")}</ul>`}
    </section>`;
}

function personRow(job: TrackerJob, person: TrackerContact, first: boolean) {
  const key = person.name.toLowerCase();
  const hidden = job.hidden.includes(key);
  const revealsLeft = (job.fillReport?.peopleReveals ?? 0) < 3;
  const open = openPeople.has(person.id);
  const followUps = store.followUps[person.id] ?? 0;
  const due = person.outreachStatus === "emailed" && Boolean(job.fillReport?.emailedAt?.[person.id]);
  const busy = (what: string) => store.busy.has(`${what}:${person.id}`);
  const draft = drafts[person.id] ?? { subject: person.emailSubject ?? "", body: person.emailBody ?? "" };
  const link = person.email && draft.body ? composeLink(store.mailer, person.email, draft.subject, draft.body) : null;
  const followUp = person.outreachStatus === "emailed" || person.outreachStatus === "no_response";
  const status = { not_contacted: "", emailed: "Emailed", replied: "Replied", no_response: "No reply" }[person.outreachStatus];
  // The address is the link: it opens the email, written and filled in, ready to send.
  const address = person.email
    ? link
      ? `<a class="email-link" href="${escape(link.url)}" ${link.url.startsWith("mailto:") ? "" : 'target="_blank" rel="noreferrer"'} data-email-link="${person.id}" data-cut="${link.cut}" title="Open this email in ${MAILER_NAME[store.mailer]}">${escape(person.email)} ↗</a>`
      : `<button type="button" class="email-link" data-write-open="${person.id}" ${busy("write") ? "disabled" : ""} title="Write the email, then open it in ${MAILER_NAME[store.mailer]}">${busy("write") ? "Writing your email…" : `${escape(person.email)} ↗`}</button>`
    : hidden
      ? revealsLeft ? `<button type="button" class="solid" data-reveal="${person.id}" ${busy("reveal") ? "disabled" : ""}>${busy("reveal") ? "Looking…" : "Show person"}</button>` : `<span class="small">You've shown 3 people for this job.</span>`
      : `<span class="small">No email found</span>`;
  return `
    <li class="person${first ? " first" : ""}">
      <div class="row-between"><span class="person-name">${escape(person.name)} <span class="role">${escape(ROLE_LABEL[person.role] ?? person.role)}</span></span>${status ? `<span class="status${person.outreachStatus === "replied" ? " done" : ""}">${status}</span>` : ""}</div>
      ${person.title ? `<span class="sub">${escape(person.title)}</span>` : ""}
      ${first ? `<span class="small start-here">★ Start here</span>` : ""}
      <div class="person-line">${address}${person.linkedinUrl ? `<a class="link" href="${escape(person.linkedinUrl)}" target="_blank" rel="noreferrer">LinkedIn ↗</a>` : ""}</div>
      ${person.emailSource && person.email ? `<span class="small"${person.emailSource === "likely" || person.emailSource === "guess" ? ' style="color: var(--warn)"' : ""}>${escape(EMAIL_SOURCE[person.emailSource] ?? "")}</span>` : ""}
      ${justOpened.has(person.id) ? `
        <div class="sent-check" role="status"><span class="small">${justOpened.get(person.id) ? "Sent the follow-up?" : "Sent it?"}</span>
          <button type="button" class="solid" data-sent="${person.id}" data-follow="${justOpened.get(person.id)}">${justOpened.get(person.id) ? "I sent the follow-up" : "I emailed them"}</button></div>` : ""}
      ${person.email && !hidden ? `
        <details class="q-answer" data-person="${person.id}" ${open ? "open" : ""}><summary>${draft.body ? "The email" : "Write the email first"}</summary>
          <div class="letter-form flat">
            ${draft.body ? `<input class="field" data-subject="${person.id}" value="${escape(draft.subject)}" aria-label="Subject" maxlength="200">
            <textarea class="field letter-input" rows="7" data-body="${person.id}" aria-label="Email to ${escape(person.name)}">${escape(draft.body)}</textarea>` : ""}
            <div class="links">
              <button type="button" class="link" data-write="${person.id}" ${busy("write") ? "disabled" : ""}>${busy("write") ? "Writing…" : draft.body ? "Write it again" : "Write email"}</button>
              ${drafts[person.id] ? `<button type="button" class="link" data-save-draft="${person.id}">Save my edits</button>` : ""}
              ${draft.body ? `<button type="button" class="link" data-copy-email="${person.id}">Copy</button>` : ""}
              <button type="button" class="link" data-bounced="${person.id}">It bounced</button>
            </div>
          </div>
        </details>` : ""}
      ${person.email && !hidden ? `<div class="links">
        ${person.outreachStatus === "not_contacted" ? `<button type="button" class="quiet-link" data-status="${person.id}" data-value="emailed">I emailed them</button>` : ""}
        ${followUp && due ? `${followUps < MAX_FOLLOW_UPS ? `<button type="button" class="quiet-link" data-follow-up="${person.id}" ${busy("follow") ? "disabled" : ""}>${busy("follow") ? "Writing…" : "Write follow-up"}</button>` : ""}<button type="button" class="quiet-link" data-status="${person.id}" data-value="replied">They replied</button><button type="button" class="quiet-link" data-status="${person.id}" data-value="no_response">No reply, stop</button>` : ""}
      </div>` : ""}
    </li>`;
}

/** Wires a job page drawn by `jobPage` inside `root`. */
export function wireJobPage(root: HTMLElement, job: TrackerJob) {
  wireReach(root);
  const say = (text: string) => { store.notes[job.id] = text; host.redraw(); };
  const run = async (what: string, contactId: string, message: Record<string, unknown>) => {
    store.busy.add(`${what}:${contactId}`);
    host.redraw();
    const result = await ask<{ ok: boolean; error?: string; contact?: TrackerContact }>({ type: "people", body: { applicationId: job.id, contactId, ...message } }).catch(() => ({ ok: false, error: "Couldn't reach Unnepo." }));
    store.busy.delete(`${what}:${contactId}`);
    if (!result.ok) store.notes[job.id] = result.error ?? "Couldn't do that.";
    else store.notes[job.id] = "";
    await loadTracker();
    return result;
  };
  const person = (id: string) => job.contacts.find((item) => item.id === id);
  root.querySelectorAll<HTMLSelectElement>("[data-outcome]").forEach((select) => select.addEventListener("change", async () => {
    const outcome = select.value === "submitted" ? null : select.value;
    const result = await ask<{ ok: boolean; error?: string }>({ type: "job-status", applicationId: job.id, outcome }).catch(() => ({ ok: false, error: "Couldn't reach Unnepo." }));
    say(result.ok ? "" : result.error ?? "Couldn't change it.");
    void loadTracker();
  }));
  root.querySelector<HTMLButtonElement>("[data-mark-applied]")?.addEventListener("click", async () => {
    const result = await ask<{ ok: boolean; error?: string }>({ type: "job-status", applicationId: job.id, applied: true }).catch(() => ({ ok: false, error: "Couldn't reach Unnepo." }));
    say(result.ok ? "Marked as applied." : result.error ?? "Couldn't change it.");
    void loadTracker();
  });
  root.querySelector<HTMLButtonElement>("[data-delete-job]")?.addEventListener("click", async () => {
    if (!confirm(`Delete ${job.title} at ${job.company} from your tracker? Its people go too.`)) return;
    const result = await ask<{ ok: boolean; error?: string }>({ type: "delete-job", applicationId: job.id }).catch(() => ({ ok: false, error: "Couldn't reach Unnepo." }));
    if (!result.ok) return say(result.error ?? "Couldn't delete it.");
    await loadTracker();
    host.openJob("");
  });
  root.querySelectorAll<HTMLInputElement>("[data-website]").forEach((box) => box.addEventListener("input", () => { websites[job.id] = box.value; }));
  root.querySelectorAll<HTMLButtonElement>("[data-find-people]").forEach((button) => button.addEventListener("click", async () => {
    store.busy.add(`find:${job.id}`);
    host.redraw();
    const website = (websites[job.id] ?? "").trim();
    const result = await ask<{ ok: boolean; error?: string }>({ type: "people", body: { action: "find", applicationId: job.id, ...(website ? { website } : {}) } }).catch(() => ({ ok: false, error: "Couldn't reach Unnepo." }));
    store.busy.delete(`find:${job.id}`);
    store.notes[job.id] = result.ok ? "" : result.error ?? "Couldn't start the search.";
    await loadTracker(true);
  }));
  root.querySelectorAll<HTMLButtonElement>("[data-reveal]").forEach((button) => button.addEventListener("click", () => void run("reveal", button.dataset.reveal!, { action: "reveal" })));
  root.querySelectorAll<HTMLDetailsElement>("details[data-person]").forEach((box) => box.addEventListener("toggle", () => {
    if (box.open) openPeople.add(box.dataset.person!);
    else openPeople.delete(box.dataset.person!);
  }));
  root.querySelectorAll<HTMLButtonElement>("[data-write]").forEach((button) => button.addEventListener("click", async () => {
    delete drafts[button.dataset.write!];
    await run("write", button.dataset.write!, { action: "write" });
  }));
  root.querySelectorAll<HTMLInputElement>("[data-subject]").forEach((box) => box.addEventListener("input", () => {
    const id = box.dataset.subject!;
    const current = drafts[id] ?? { subject: person(id)?.emailSubject ?? "", body: person(id)?.emailBody ?? "" };
    drafts[id] = { ...current, subject: box.value };
  }));
  root.querySelectorAll<HTMLTextAreaElement>("[data-body]").forEach((box) => box.addEventListener("input", () => {
    const id = box.dataset.body!;
    const current = drafts[id] ?? { subject: person(id)?.emailSubject ?? "", body: person(id)?.emailBody ?? "" };
    drafts[id] = { ...current, body: box.value };
  }));
  root.querySelectorAll<HTMLButtonElement>("[data-save-draft]").forEach((button) => button.addEventListener("click", async () => {
    const id = button.dataset.saveDraft!;
    const draft = drafts[id];
    if (!draft) return;
    const result = await run("save", id, { action: "write", subject: draft.subject, body: draft.body });
    if (result.ok) delete drafts[id];
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    host.redraw();
  }));
  root.querySelectorAll<HTMLButtonElement>("[data-copy-email]").forEach((button) => button.addEventListener("click", () => {
    const id = button.dataset.copyEmail!;
    const body = drafts[id]?.body ?? person(id)?.emailBody ?? "";
    void navigator.clipboard.writeText(body).then(() => say("Copied."), () => say("Couldn't copy. Select the text and copy it."));
  }));
  root.querySelectorAll<HTMLButtonElement>("[data-bounced]").forEach((button) => button.addEventListener("click", () => {
    if (confirm("Did the email bounce? Unnepo drops this address and checks the company's format again.")) void run("bounced", button.dataset.bounced!, { action: "bounced" });
  }));
  // The address opens the email. A body too long for the link goes on the clipboard first.
  const opened = async (contact: TrackerContact, followUp: boolean) => {
    justOpened.set(contact.id, followUp);
    await ask({ type: "email-opened", contactId: contact.id, applicationId: job.id, name: contact.name, company: job.company, followUp });
    host.redraw();
  };
  const openLink = async (contact: TrackerContact, followUp: boolean) => {
    const draft = drafts[contact.id] ?? { subject: contact.emailSubject ?? "", body: contact.emailBody ?? "" };
    const link = composeLink(store.mailer, contact.email!, draft.subject, draft.body);
    if (link.cut) {
      await navigator.clipboard.writeText(draft.body).catch(() => undefined);
      say("The email was too long for the link: it's copied. Paste it into the email that opened.");
    }
    if (link.url.startsWith("mailto:")) window.location.href = link.url;
    else void chrome.tabs.create({ url: link.url });
    await opened(contact, followUp);
  };
  root.querySelectorAll<HTMLAnchorElement>("[data-email-link]").forEach((anchor) => anchor.addEventListener("click", (event) => {
    const contact = person(anchor.dataset.emailLink!);
    if (!contact) return;
    event.preventDefault();
    void openLink(contact, contact.outreachStatus !== "not_contacted");
  }));
  root.querySelectorAll<HTMLButtonElement>("[data-write-open]").forEach((button) => button.addEventListener("click", async () => {
    const result = await run("write", button.dataset.writeOpen!, { action: "write" });
    const contact = result.ok ? jobById(job.id)?.contacts.find((item) => item.id === button.dataset.writeOpen) : null;
    if (contact?.email && contact.emailBody) await openLink(contact, false);
  }));
  root.querySelectorAll<HTMLButtonElement>("[data-follow-up]").forEach((button) => button.addEventListener("click", async () => {
    const id = button.dataset.followUp!;
    delete drafts[id];
    const result = await run("follow", id, { action: "write", followUp: true });
    const contact = result.ok ? jobById(job.id)?.contacts.find((item) => item.id === id) : null;
    openPeople.add(id);
    if (contact?.email && contact.emailBody) await openLink(contact, true);
  }));
  root.querySelectorAll<HTMLButtonElement>("[data-sent]").forEach((button) => button.addEventListener("click", async () => {
    const id = button.dataset.sent!;
    justOpened.delete(id);
    await run("status", id, { action: "status", status: "emailed", followedUp: button.dataset.follow === "true" });
  }));
  root.querySelectorAll<HTMLButtonElement>("[data-status]").forEach((button) => button.addEventListener("click", () => {
    justOpened.delete(button.dataset.status!);
    void run("status", button.dataset.status!, { action: "status", status: button.dataset.value });
  }));
}

// ---- Home's reminders ----

const SNOOZE_MS = 3 * 86_400_000;

export function todayList() {
  if (!store.tracker) return { goal: null, items: [] as Reminder[] };
  return reminders(store.tracker, store.marks, store.opened, store.followUps);
}

export function remindersCard(limit = 6, title = "Today", showGoal = true) {
  if (!store.tracker) {
    return `<section class="page" aria-label="Today"><span class="eyebrow">Today</span><p class="note">${store.error ? escape(store.error) : "Loading your reminders…"}</p></section>`;
  }
  const { goal, items } = todayList();
  const goalLine = showGoal && goal?.daily ? `<div class="goal"><span>Applied today</span><span>${goal.today} of ${goal.daily}</span></div><div class="bar" role="progressbar" aria-label="Goal for today" aria-valuemin="0" aria-valuemax="${goal.daily}" aria-valuenow="${Math.min(goal.today, goal.daily)}"><div style="width:${Math.min(100, Math.round((goal.today / goal.daily) * 100))}%"></div></div>` : "";
  const row = (item: Reminder) => `
    <li class="reminder">
      <div class="reminder-text"><span class="reminder-title">${escape(item.title)}</span>${item.detail ? `<span class="sub">${escape(item.detail)}</span>` : ""}</div>
      <div class="reminder-actions">
        <button type="button" class="solid" data-remind="${escape(item.key)}">${escape(item.action)}</button>
        ${item.kind === "sent" ? `<button type="button" class="quiet-link" data-remind-mark="${escape(item.key)}">Not yet</button>` : `<button type="button" class="quiet-link" data-remind-snooze="${escape(item.key)}" title="Hide for 3 days">Later</button><button type="button" class="quiet-link" data-remind-mark="${escape(item.key)}" title="Done">Done</button>`}
      </div>
    </li>`;
  return `
    <section class="page" aria-label="${title}">
      <div class="row-between"><span class="eyebrow">${title}</span>${items.length ? `<span class="mono">${items.length} TO DO</span>` : ""}</div>
      ${goalLine}
      ${items.length ? `<ul class="reminders">${items.slice(0, limit).map(row).join("")}</ul>${items.length > limit ? `<p class="small">And ${items.length - limit} more on the dashboard.</p>` : ""}` : `<p class="note">Nothing due. Email someone at a company you applied to, and Unnepo reminds you to follow up.</p>`}
    </section>`;
}

export function wireReminders(root: HTMLElement) {
  const items = todayList().items;
  const find = (key: string) => items.find((item) => item.key === key);
  const mark = async (key: string, until?: number) => {
    await ask({ type: "reminder-mark", key, until });
    await loadTracker();
  };
  root.querySelectorAll<HTMLButtonElement>("[data-remind-mark]").forEach((button) => button.addEventListener("click", () => void mark(button.dataset.remindMark!)));
  root.querySelectorAll<HTMLButtonElement>("[data-remind-snooze]").forEach((button) => button.addEventListener("click", () => void mark(button.dataset.remindSnooze!, Date.now() + SNOOZE_MS)));
  root.querySelectorAll<HTMLButtonElement>("[data-remind]").forEach((button) => button.addEventListener("click", async () => {
    const item = find(button.dataset.remind!);
    if (!item) return;
    if (item.kind === "sent" && item.contactId && item.applicationId) {
      const followUp = item.title.includes("follow-up");
      await ask({ type: "people", body: { action: "status", applicationId: item.applicationId, contactId: item.contactId, status: "emailed", followedUp: followUp } });
      return void loadTracker();
    }
    if (item.action === "Stop following up" && item.contactId && item.applicationId) {
      await ask({ type: "people", body: { action: "status", applicationId: item.applicationId, contactId: item.contactId, status: "no_response" } });
      return void loadTracker();
    }
    if (item.kind === "finish" && item.applicationId) {
      const job = jobById(item.applicationId);
      if (job?.url) return void chrome.tabs.create({ url: job.url });
    }
    if (item.applicationId) host.openJob(item.applicationId, item.contactId);
  }));
}

// ---- Detected jobs ----

const SURE: Record<Detected["sure"], string> = { confirmed: "Confirmed", likely: "Likely", pressed: "Pressed Apply" };
let detectedOpen = false;
const ago = (at: number) => {
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

/** "Detected jobs (2)": closed by default; open, the last 5 jobs the extension caught, newest first. */
export function detectedMenu() {
  const list = store.detected ?? [];
  const asking = list.filter((item) => item.state === "ask").length;
  const row = (item: Detected) => {
    const answered = item.state === "yes" || item.state === "no" || item.state === "undone";
    const actions = item.state === "ask"
      ? `<button type="button" class="solid" data-detected-yes="${item.id}">✓ I applied</button><button type="button" class="quiet-link" data-detected-no="${item.id}">✗ No</button>`
      : item.state === "saved" ? `<span class="status done">Saved ✓</span><button type="button" class="quiet-link" data-detected-undo="${item.id}">Undo</button>`
      : item.state === "yes" ? `<span class="status done">Added ✓</span><button type="button" class="quiet-link" data-detected-undo="${item.id}">Undo</button>`
      : item.state === "undone" ? `<span class="status">Undone</span>` : `<span class="status">Not applied</span>`;
    return `
      <li class="detected${answered ? " answered" : ""}">
        <div class="detected-text">
          ${item.applicationId ? `<button type="button" class="detected-title" data-open-job="${item.applicationId}">${escape(short(item.title, 70))}</button>` : `<span class="detected-title">${escape(short(item.title, 70))}</span>`}
          <span class="sub">${escape([item.company, item.site, ago(item.at), SURE[item.sure]].filter(Boolean).join(" · "))}</span>
          ${item.error ? `<span class="small" style="color: var(--warn)">${escape(item.error)}</span>` : ""}
        </div>
        <div class="detected-actions">${actions}</div>
      </li>`;
  };
  return `
    <details class="detected-menu" id="detected-menu" ${detectedOpen ? "open" : ""}>
      <summary><span>Detected jobs${asking ? ` <span class="count">${asking}</span>` : ""}</span><span class="mono">LAST ${Math.min(5, list.length) || 5}</span></summary>
      ${list.length ? `<ul class="detected-list">${list.slice(0, 5).map(row).join("")}</ul><button type="button" class="quiet-link" id="detected-clear">Clear list</button>` : `<p class="note">When you apply somewhere, the job shows up here. Ones the site confirms are saved by themselves.</p>`}
    </details>`;
}

export function wireDetected(root: HTMLElement) {
  const menu = root.querySelector<HTMLDetailsElement>("#detected-menu");
  menu?.addEventListener("toggle", () => { detectedOpen = menu.open; });
  const act = async (message: Record<string, unknown>, item?: Detected) => {
    type Answered = { ok: boolean; error?: string; needsForm?: boolean };
    const result = await ask<Answered>(message).catch((): Answered => ({ ok: false, error: "Couldn't reach Unnepo." }));
    if (!result.ok && result.needsForm && item && host.addJob) host.addJob(item);
    await loadTracker();
  };
  const item = (id: string) => store.detected?.find((entry) => entry.id === id);
  root.querySelectorAll<HTMLButtonElement>("[data-detected-yes]").forEach((button) => button.addEventListener("click", () => { button.disabled = true; void act({ type: "detected-answer", id: button.dataset.detectedYes, applied: true }, item(button.dataset.detectedYes!)); }));
  root.querySelectorAll<HTMLButtonElement>("[data-detected-no]").forEach((button) => button.addEventListener("click", () => void act({ type: "detected-answer", id: button.dataset.detectedNo, applied: false })));
  root.querySelectorAll<HTMLButtonElement>("[data-detected-undo]").forEach((button) => button.addEventListener("click", () => void act({ type: "detected-undo", id: button.dataset.detectedUndo })));
  root.querySelector<HTMLButtonElement>("#detected-clear")?.addEventListener("click", () => void act({ type: "detected-clear" }));
  root.querySelectorAll<HTMLButtonElement>(".detected-title[data-open-job]").forEach((button) => button.addEventListener("click", () => host.openJob(button.dataset.openJob!)));
}

/** Just the Detected jobs list, read again (it changes as the extension catches applications). */
export async function refreshDetected() {
  const result = await ask<{ ok: boolean; list?: Detected[] }>({ type: "detected-list" }).catch(() => ({ ok: false, list: undefined }));
  if (!result.ok || !result.list) return;
  const changed = JSON.stringify(result.list) !== JSON.stringify(store.detected);
  store.detected = result.list;
  if (changed) host.redraw();
}

/** The newest jobs, each opening its page. */
export function recentJobs(limit = 5) {
  const jobs = store.tracker?.jobs ?? [];
  if (!jobs.length) return "";
  return `<ul class="jobs-list">${jobs.slice(0, limit).map((job) => `
    <li><button type="button" class="job-row" data-open-job="${job.id}">
      <span class="job-row-text"><span class="job-row-title">${escape(job.titleMissing ? "Job title missing" : job.title)}</span><span class="job-row-company">${escape(job.company)}</span></span>
      <span class="status${isAppliedJob(job) ? " done" : ""}">${escape(stageLabel(job))}</span>
    </button></li>`).join("")}</ul>`;
}

const day = (at: string | null) => (at ? new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");
const daysSince = (at: string | null) => (at ? Math.max(0, Math.floor((Date.now() - Date.parse(at)) / 86_400_000)) : 0);

/** One job as a floating bubble: its name, the company, when, and See info / Delete (or what's given instead). */
function bubble(job: TrackerJob, index: number, extra = "", actions?: string) {
  const busy = store.busy.has(`delete:${job.id}`);
  const stage = stageLabel(job);
  const when = isAppliedJob(job) ? day(job.submittedAt ?? job.createdAt) : "";
  return `<li class="bubble" style="--float-delay:${(index % 5) * -1.3}s">
    <span class="bubble-title">${escape(job.titleMissing ? "Job title missing" : job.title)}</span>
    <span class="bubble-sub">${escape(job.company)}${when ? ` · ${escape(when)}` : ""}</span>
    ${stage !== "Applied" ? `<span class="status${isAppliedJob(job) ? "" : " todo"}">${escape(stage)}</span>` : ""}
    ${extra}
    <span class="bubble-actions">${actions ?? `
      <button type="button" class="bubble-btn" data-bubble-open="${job.id}">See info</button>
      <button type="button" class="bubble-btn danger" data-bubble-delete="${job.id}" ${busy ? "disabled" : ""}>${busy ? "Deleting…" : "Delete"}</button>`}
    </span>
    ${store.notes[`delete:${job.id}`] ? `<span class="small" role="status">${escape(store.notes[`delete:${job.id}`])}</span>` : ""}
  </li>`;
}

const loadingNote = () => `<p class="note">${escape(store.error || "Loading your jobs…")}</p>`;

/** The Jobs tab: every job as a bubble, applied ones first, then the ones not applied to yet. */
export function jobBubbles() {
  if (!store.tracker) return loadingNote();
  const jobs = store.tracker.jobs;
  const applied = jobs.filter(isAppliedJob);
  const saved = jobs.filter((job) => !isAppliedJob(job));
  const group = (label: string, list: TrackerJob[], empty: string) => `
    <section class="page" aria-label="${label}">
      <div class="row-between"><span class="eyebrow">${label}</span><span class="mono">${list.length} ${list.length === 1 ? "JOB" : "JOBS"}</span></div>
      ${list.length ? `<ul class="bubbles">${list.map((job, index) => bubble(job, index)).join("")}</ul>` : `<p class="note">${empty}</p>`}
    </section>`;
  return group("Applied", applied, "Every job you apply to floats here.") + (saved.length ? group("Not applied yet", saved, "") : "");
}

/**
 * The Follow up tab: jobs applied to where nobody's been emailed yet, each with who Unnepo found there and one
 * tap to say you emailed 1 or 2 people. Then the ones waiting on a reply.
 */
export function followUpView() {
  if (!store.tracker) return loadingNote();
  const jobs = store.tracker.jobs;
  const todo = jobs.filter(needsFirstEmail).sort((a, b) => Date.parse(a.submittedAt ?? a.createdAt) - Date.parse(b.submittedAt ?? b.createdAt));
  const waiting = jobs.filter((job) => isAppliedJob(job) && emailedCount(job) > 0 && !["rejected", "offer"].includes(stageOf(job as never)));
  const due = new Set(followUpsDue(jobs as never).map((item) => item.applicationId));
  const people = (job: TrackerJob) => {
    const withEmail = job.contacts.filter((person) => person.email).length;
    if (job.contactsStatus === "finding") return "Finding people…";
    if (job.contacts.length) return `${job.contacts.length} ${job.contacts.length === 1 ? "person" : "people"} found${withEmail ? `, ${withEmail} with email` : ""}`;
    return "No one found yet";
  };
  const todoRow = (job: TrackerJob, index: number) => {
    const days = daysSince(job.submittedAt ?? job.createdAt);
    const busy = store.busy.has(`reach:${job.id}`);
    return bubble(job, index,
      `<span class="small">${days ? `Applied ${days} ${days === 1 ? "day" : "days"} ago` : "Applied today"} · ${escape(people(job))}</span>`,
      `<button type="button" class="bubble-btn wide" data-bubble-open="${job.id}">${job.contacts.length ? "See people" : "Find people"}</button>
       <span class="reach-row" role="group" aria-label="Already emailed people about this job?"><span class="small">Emailed</span>
         <button type="button" class="bubble-btn" data-reach-job="${job.id}" data-reach="1" aria-label="I emailed 1 person" ${busy ? "disabled" : ""}>1</button>
         <button type="button" class="bubble-btn" data-reach-job="${job.id}" data-reach="2" aria-label="I emailed 2 people" ${busy ? "disabled" : ""}>2</button></span>`);
  };
  const waitRow = (job: TrackerJob, index: number) => {
    const count = emailedCount(job);
    return bubble(job, index,
      `<span class="small">Emailed ${count} ${count === 1 ? "person" : "people"}${due.has(job.id) ? ` · <strong class="warn-text">follow-up due</strong>` : ""}</span>`,
      `<button type="button" class="bubble-btn" data-bubble-open="${job.id}">${due.has(job.id) ? "Write follow-up" : "See info"}</button>`);
  };
  return `
    <section class="page" aria-label="No email sent yet">
      <div class="row-between"><span class="eyebrow">No email sent yet</span><span class="mono">${todo.length}</span></div>
      <p class="small">Jobs you applied to where you haven't emailed anyone. A short note to a recruiter or someone on the team gets your application read.</p>
      ${todo.length ? `<ul class="bubbles">${todo.map(todoRow).join("")}</ul>` : `<p class="note ok">You've emailed someone for every job. Nice.</p>`}
    </section>
    ${waiting.length ? `<section class="page" aria-label="Waiting on a reply">
      <div class="row-between"><span class="eyebrow">Waiting on a reply</span><span class="mono">${waiting.length}</span></div>
      <ul class="bubbles">${waiting.map(waitRow).join("")}</ul>
    </section>` : ""}`;
}

/** How many applied jobs have nobody emailed yet, for the tab's count. */
export const firstEmailCount = () => (store.tracker?.jobs ?? []).filter(needsFirstEmail).length;

export function wireBubbles(root: HTMLElement) {
  root.querySelectorAll<HTMLButtonElement>("[data-bubble-open]").forEach((button) => button.addEventListener("click", () => host.openJob(button.dataset.bubbleOpen!)));
  root.querySelectorAll<HTMLButtonElement>("[data-bubble-delete]").forEach((button) => button.addEventListener("click", async () => {
    const job = jobById(button.dataset.bubbleDelete!);
    if (!job || !confirm(`Delete ${job.title} at ${job.company} from your tracker? Its people go too.`)) return;
    const key = `delete:${job.id}`;
    store.busy.add(key);
    delete store.notes[key];
    host.redraw();
    const result = await ask<{ ok: boolean; error?: string }>({ type: "delete-job", applicationId: job.id }).catch(() => ({ ok: false, error: "Couldn't reach Unnepo." }));
    store.busy.delete(key);
    if (!result.ok) store.notes[key] = result.error ?? "Couldn't delete it.";
    await loadTracker(true);
  }));
}

export function wireJobRows(root: HTMLElement) {
  root.querySelectorAll<HTMLButtonElement>(".job-row[data-open-job], .heat-event[data-open-job]").forEach((button) => button.addEventListener("click", () => host.openJob(button.dataset.openJob!)));
}
