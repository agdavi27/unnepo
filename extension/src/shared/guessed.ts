import { COMMON_FORMATS, buildEmail } from "@/lib/apply/email-format";
import { escape, redraw } from "./tracker-view";
import type { TrackerJob } from "./types";

/**
 * "Find with LinkedIn": a job's own page of people, free. Unnepo opens LinkedIn's people search for the company in
 * a tab, reads the names and titles off it, and builds each person's email from the company's email format (learned
 * from the company's own website, or first.last when it isn't known). The emails are guesses, never checked, and the
 * page says so. Kept on this computer, per job.
 */

const ask = <T>(message: unknown) => chrome.runtime.sendMessage(message) as Promise<T>;

type Person = { name: string; title: string; linkedinUrl: string };
type Saved = { people: Person[]; domain: string | null; pattern: string | null; source: string; formatRead: boolean };
type Live = { tabId?: number; busy: "" | "opening" | "reading" | "format"; note: string; website: string; copied: string };

const STORE_KEY = "guessedPeople";
const saved: Record<string, Saved> = {};
const live: Record<string, Live> = {};
void chrome.storage.local.get(STORE_KEY).then((stored) => { Object.assign(saved, (stored[STORE_KEY] as Record<string, Saved> | undefined) ?? {}); redraw(); });
const save = () => void chrome.storage.local.set({ [STORE_KEY]: saved });

const savedFor = (id: string) => (saved[id] ??= { people: [], domain: null, pattern: null, source: "none", formatRead: false });
const liveFor = (id: string) => (live[id] ??= { busy: "", note: "", website: "", copied: "" });

/** How many people the LinkedIn page has for a job, for its button. */
export const guessedCount = (jobId: string) => saved[jobId]?.people.length ?? 0;

/** "Dr. Jane Doe, MBA 🌟" is "Jane Doe": the name an address is made from. */
const plainName = (name: string) => name.replace(/^(dr|mr|mrs|ms|mx|prof)\.?\s+/i, "").replace(/\s*\(.*?\)\s*/g, " ").replace(/[^\p{L}\s,.'-]/gu, "").trim();
const FORMAT_LABEL = (pattern: string) => pattern.replace("{first}", "first").replace("{last}", "last").replace("{f}", "f").replace("{l}", "l");
const SOURCE_LABEL: Record<string, string> = { website: "from the company's website", hunter: "learned before", apollo: "learned before", verified: "learned before", picked: "picked by you" };

function emailOf(data: Saved, name: string) {
  if (!data.domain) return null;
  return buildEmail(data.pattern ?? COMMON_FORMATS[0], plainName(name), data.domain);
}

const COPY = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/></svg>`;

function searches(job: TrackerJob) {
  const company = job.companyMissing ? "" : job.company;
  return [
    ["Anyone", company],
    ["Recruiters", `recruiter ${company}`],
    ["The team", `${job.department || job.title} ${company}`],
  ] as const;
}

export function guessedPage(job: TrackerJob) {
  const data = savedFor(job.id);
  const state = liveFor(job.id);
  const company = job.companyMissing ? "this company" : job.company;
  const busy = state.busy !== "";
  const searchButtons = searches(job).map(([label, keywords], index) =>
    `<button type="button" class="${index === 0 && !data.people.length ? "btn primary" : "chip"}" data-li-search="${escape(keywords)}" ${busy || job.companyMissing ? "disabled" : ""}>${index === 0 && !data.people.length ? `Open LinkedIn for ${escape(company)}` : escape(label)}</button>`).join("");
  const format = data.domain
    ? `<div class="guess-format">
        <span class="small">Email format${data.pattern ? ` <span class="sub">· ${escape(SOURCE_LABEL[data.source] ?? "found")}</span>` : ` <span class="sub">· not known, guessing</span>`}</span>
        <label class="guess-format-pick"><select class="field" id="guess-pattern" aria-label="Email format">${COMMON_FORMATS.map((pattern) => `<option value="${escape(pattern)}"${(data.pattern ?? COMMON_FORMATS[0]) === pattern ? " selected" : ""}>${escape(FORMAT_LABEL(pattern))}@${escape(data.domain!)}</option>`).join("")}</select></label>
      </div>`
    : data.formatRead && state.busy !== "format"
      ? `<p class="small">Couldn't find ${escape(company)}'s website, so there's no email format yet.</p>`
      : "";
  const website = `<div class="connect-code"><input class="field" id="guess-website" value="${escape(state.website)}" placeholder="${data.domain ? `Wrong site? Like ${escape(data.domain)}` : "Company website, like acme.com"}" aria-label="Company website"><button type="button" class="solid" id="guess-website-use" ${busy ? "disabled" : ""}>Use</button></div>`;
  const rows = data.people.map((person, index) => {
    const email = emailOf(data, person.name);
    return `<li class="guess-row">
      <div class="guess-text">
        <span class="guess-name">${escape(person.name)}</span>
        ${person.title ? `<span class="sub">${escape(person.title)}</span>` : ""}
        <span class="guess-mail mono">${email ? escape(email) : "No email: add the website"}</span>
      </div>
      <div class="guess-actions">
        ${email ? `<button type="button" class="icon-btn" data-guess-copy="${index}" aria-label="Copy ${escape(person.name)}'s email" title="Copy">${state.copied === String(index) ? "✓" : COPY}</button>` : ""}
        <a class="icon-btn" href="${escape(person.linkedinUrl)}" target="_blank" rel="noreferrer" aria-label="${escape(person.name)} on LinkedIn" title="LinkedIn">in</a>
      </div>
    </li>`;
  }).join("");
  const working = state.busy === "opening" || state.busy === "reading" ? "Reading names off LinkedIn…" : state.busy === "format" ? `Finding ${company}'s email format…` : "";
  return `
    <section class="page guessed" aria-label="People from LinkedIn">
      <div class="row-between"><span class="eyebrow">LinkedIn · ${escape(company)}</span>${data.people.length ? `<span class="mono">${data.people.length} PEOPLE</span>` : ""}</div>
      ${data.people.length ? "" : `<p class="note">Unnepo opens LinkedIn's people search for ${escape(company)} in a new tab and reads the names on it. Sign in to LinkedIn there if it asks. Emails are built from the company's email format.</p>`}
      <div class="guess-search${data.people.length ? " chips" : ""}">${data.people.length ? `<span class="small">Search again:</span>` : ""}${searchButtons}</div>
      ${state.tabId && data.people.length ? `<button type="button" class="quiet-link" id="guess-read" ${busy ? "disabled" : ""}>Scrolled or went to page 2? Read LinkedIn again</button>` : ""}
      ${working ? `<p class="small" role="status">${escape(working)}</p>` : ""}
      ${state.note ? `<p class="small" role="status" style="color: var(--warn)">${escape(state.note)}</p>` : ""}
      ${format}
      ${data.formatRead || data.domain ? website : ""}
    </section>
    ${data.people.length ? `
    <section class="page" aria-label="Names and emails">
      <ul class="guess-list">${rows}</ul>
      <div class="links"><button type="button" class="link" id="guess-copy-all">${state.copied === "all" ? "Copied" : "Copy all"}</button><button type="button" class="quiet-link" id="guess-clear">Clear list</button></div>
      <p class="small" style="color: var(--warn)">These emails are guesses and aren't checked. For checked emails, use Find verified emails on the job.</p>
    </section>` : ""}`;
}

/** The company's website and email format, from the server's free sources. */
async function readFormat(job: TrackerJob, website = "") {
  const data = savedFor(job.id);
  const state = liveFor(job.id);
  state.busy = "format";
  redraw();
  type Format = { ok: boolean; error?: string; domain?: string | null; pattern?: string | null; source?: string };
  const result = await ask<Format>({ type: "people", body: { action: "format", applicationId: job.id, website, names: data.people.map((person) => person.name) } }).catch((): Format => ({ ok: false, error: "Couldn't reach Unnepo." }));
  state.busy = "";
  if (result.ok) {
    Object.assign(data, { domain: result.domain ?? null, pattern: result.pattern ?? null, source: result.source ?? "none", formatRead: true });
    state.website = "";
    save();
  } else {
    // Not asked again on every redraw; a website typed in tries again.
    data.formatRead = true;
    state.note = result.error ?? "Couldn't find the email format.";
  }
  redraw();
}

function addPeople(job: TrackerJob, people: Person[] = []) {
  const data = savedFor(job.id);
  const known = new Set(data.people.map((person) => person.linkedinUrl));
  const fresh = people.filter((person) => !known.has(person.linkedinUrl));
  data.people.push(...fresh);
  save();
  return fresh.length;
}

async function readLinkedIn(job: TrackerJob, message: Record<string, unknown>) {
  const state = liveFor(job.id);
  state.busy = message.type === "linkedin-open" ? "opening" : "reading";
  state.note = "";
  redraw();
  type Read = { ok: boolean; tabId?: number; people?: Person[]; error?: string };
  const result = await ask<Read>(message).catch((): Read => ({ ok: false, error: "Couldn't reach LinkedIn." }));
  state.busy = "";
  if (result.tabId) state.tabId = result.tabId;
  if (!result.ok) state.note = result.error ?? "Couldn't read LinkedIn.";
  else {
    const added = addPeople(job, result.people);
    state.note = added ? "" : result.people?.length ? "No new names on that page. Scroll down or go to the next page, then read it again." : "No names on that page yet. Scroll through the results, then read it again.";
  }
  redraw();
  if (result.ok && !savedFor(job.id).formatRead) await readFormat(job);
}

export function wireGuessedPage(root: HTMLElement, job: TrackerJob) {
  const data = savedFor(job.id);
  const state = liveFor(job.id);
  root.querySelectorAll<HTMLButtonElement>("[data-li-search]").forEach((button) => button.addEventListener("click", () => void readLinkedIn(job, { type: "linkedin-open", keywords: button.dataset.liSearch })));
  root.querySelector("#guess-read")?.addEventListener("click", () => void readLinkedIn(job, { type: "linkedin-read", tabId: state.tabId }));
  root.querySelector<HTMLSelectElement>("#guess-pattern")?.addEventListener("change", (event) => {
    data.pattern = (event.target as HTMLSelectElement).value;
    data.source = "picked";
    save();
    redraw();
  });
  const websiteBox = root.querySelector<HTMLInputElement>("#guess-website");
  websiteBox?.addEventListener("input", () => { state.website = websiteBox.value; });
  root.querySelector("#guess-website-use")?.addEventListener("click", () => { if (state.website.trim()) void readFormat(job, state.website.trim()); });
  const copied = (what: string) => { state.copied = what; redraw(); setTimeout(() => { if (state.copied === what) { state.copied = ""; redraw(); } }, 1500); };
  root.querySelectorAll<HTMLButtonElement>("[data-guess-copy]").forEach((button) => button.addEventListener("click", () => {
    const person = data.people[Number(button.dataset.guessCopy)];
    const email = person && emailOf(data, person.name);
    if (email) void navigator.clipboard.writeText(email).then(() => copied(button.dataset.guessCopy!), () => undefined);
  }));
  root.querySelector("#guess-copy-all")?.addEventListener("click", () => {
    const lines = data.people.map((person) => [person.name, person.title, emailOf(data, person.name) ?? "", person.linkedinUrl].join("\t"));
    void navigator.clipboard.writeText(lines.join("\n")).then(() => copied("all"), () => undefined);
  });
  root.querySelector("#guess-clear")?.addEventListener("click", () => {
    data.people = [];
    state.note = "";
    save();
    redraw();
  });
  // The format is looked up once, when the page first opens, so it's there before any names are.
  if (!data.formatRead && !state.busy && !job.companyMissing) void readFormat(job);
}
