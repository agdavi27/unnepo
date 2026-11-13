"use client";

import { useEffect, useState } from "react";
import { composeLink } from "@/lib/apply/compose-link";
import { Popup } from "@/components/unnepo/popup";
import type { TrackerJob } from "@/lib/extension/service";

/**
 * A job's people on the website, doing what the extension's People card does: find people at the company, show a
 * hidden person, write an email to one (or a follow-up), edit it, send it in Gmail (a new tab with it filled in),
 * then mark them emailed, replied or no reply, or say the address bounced. Every action goes to /api/app/people
 * and the job list is read again after it.
 */

type Person = TrackerJob["contacts"][number];
type Draft = { subject: string; body: string };

const ROLE_LABEL: Record<string, string> = { job_poster: "Shown on job posting", poster: "Shown on job posting", recruiter: "Recruiter", alumni: "Alum", team_member: "Team", department: "Team" };
const PERSON_STATUS: Record<string, string> = { emailed: "Emailed", replied: "Replied", no_response: "No reply" };
const EMAIL_SOURCE: Record<string, string> = {
  apollo: "Verified", hunter: "Verified", pattern: "Verified", job_posting: "From the job posting", website: "From the company's website",
  likely: "Likely: follows the company's format, not checked", cant_check: "Can't be checked: the company accepts every address", guess: "Best guess",
};
const MAX_REVEALS = 3;
const isApplied = (job: TrackerJob) => job.status === "submitted" || job.status === "applied_manual";

const primary = "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-white px-3.5 text-[13px] font-semibold text-black hover:bg-zinc-200 disabled:opacity-50";
const secondary = "inline-flex h-9 items-center justify-center rounded-lg border border-[#26262C] px-3 text-[13px] font-medium hover:border-[#F7F7F8] hover:bg-white/5 disabled:opacity-50";
const quiet = "text-[13px] text-[#9A9AA3] underline-offset-4 hover:text-white hover:underline disabled:opacity-50";
const eyebrow = "m-0 font-mono text-[11px] uppercase tracking-[1.4px] text-[#8B8B94]";

const AVATAR = ["#3D8BFF", "#8B5CF6", "#EC4899", "#14B8A6", "#F59E0B", "#22C55E", "#EF4444", "#06B6D4"];

/** A person's icon: their initials on a color picked from their name, or a silhouette while the name is hidden. */
function Avatar({ name, size = 40 }: { name?: string; size?: number }) {
  const words = (name ?? "").replace(/[^\p{L}\s]/gu, "").trim().split(/\s+/).filter(Boolean);
  const initials = words.length ? (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase() : "";
  if (!initials) {
    return (
      <span aria-hidden className="grid flex-none place-items-end overflow-hidden rounded-full bg-[#26262C]" style={{ width: size, height: size }}>
        <svg viewBox="0 0 24 24" fill="currentColor" className="text-[#8B8B94]" style={{ width: size * 0.78, height: size * 0.78 }}><circle cx="12" cy="9" r="4.2" /><path d="M3.5 24c.8-5 4.2-8 8.5-8s7.7 3 8.5 8z" /></svg>
      </span>
    );
  }
  const color = AVATAR[[...(name ?? "")].reduce((sum, char) => sum + char.charCodeAt(0), 0) % AVATAR.length];
  return (
    <span aria-hidden className="grid flex-none place-items-center rounded-full font-semibold" style={{ width: size, height: size, fontSize: size * 0.38, color, background: `${color}22`, boxShadow: `inset 0 0 0 1.5px ${color}66` }}>
      {initials}
    </span>
  );
}

function GmailIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 18" className="h-3.5 w-[18px]">
      <path fill="#4285F4" d="M1.6 18h3.8V8.7L0 4.6v11.8C0 17.3.7 18 1.6 18z" />
      <path fill="#34A853" d="M18.6 18h3.8c.9 0 1.6-.7 1.6-1.6V4.6l-5.4 4.1z" />
      <path fill="#FBBC04" d="M18.6 1.6v7.1L24 4.6V2.4C24 .4 21.7-.7 20.1.5z" />
      <path fill="#EA4335" d="M5.4 8.7V1.6L12 6.5l6.6-4.9v7.1L12 13.6z" />
      <path fill="#C5221F" d="M0 2.4v2.2l5.4 4.1V1.6L3.9.5C2.3-.7 0 .4 0 2.4z" />
    </svg>
  );
}

/** Who Unnepo looks for, as empty spots until it finds them. */
function Spots({ searching = false }: { searching?: boolean }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {["Recruiter", "Hiring manager", "Someone on the team"].map((role) => (
        <div key={role} className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-[#26262C] px-2 py-4 text-center">
          <span aria-hidden className={`grid h-11 w-11 place-items-center rounded-full bg-[#141418] text-[#5C5C66] ${searching ? "animate-pulse" : ""}`}>?</span>
          <span className="text-xs leading-tight text-[#5C5C66]">{role}</span>
        </div>
      ))}
    </div>
  );
}

async function post(body: Record<string, unknown>) {
  const response = await fetch("/api/app/people", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const payload = await response?.json().catch(() => ({}));
  if (!response?.ok) throw new Error(payload?.error || "Couldn't do that. Try again.");
  return payload as { contact?: Person; gone?: boolean };
}

export function PeoplePanel({ job, free, badge, note, emailsLeft = null, reload, say }: { job: TrackerJob; free: boolean; badge?: string; note?: string; /** Free: written emails left today. */ emailsLeft?: number | null; reload: () => Promise<void>; say: (message: string) => void }) {
  // Free sees one person at each job: the one the posting names, else the first with an email, else the first.
  const shown = free && job.contacts.length ? [job.contacts.find((person) => person.role === "job_poster") ?? job.contacts.find((person) => person.email) ?? job.contacts[0]] : job.contacts;
  const company = job.companyMissing ? "this company" : job.company;
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [website, setWebsite] = useState("");
  /** Edits not saved yet, by person. */
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  /** People whose email was just opened in Gmail, for "Sent it?" (true: it was a follow-up). */
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  /** The person whose popup is open. */
  const [focus, setFocus] = useState<string | null>(null);

  const searching = job.contactsStatus === "finding" || job.contactsStatus === "writing";
  const stale = searching && Date.now() - Date.parse(job.updatedAt) > 2 * 60 * 1000;
  // While the search runs on the server, the list is read again every few seconds.
  useEffect(() => {
    if (!searching || stale) return;
    const timer = setInterval(() => void reload(), 3000);
    return () => clearInterval(timer);
  }, [searching, stale, reload]);

  const run = async (key: string, body: Record<string, unknown>, done?: string) => {
    setBusy((set) => new Set(set).add(key));
    setError("");
    try {
      const result = await post({ applicationId: job.id, ...body });
      await reload();
      if (done) say(done);
      return result;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't do that.");
      return null;
    } finally {
      setBusy((set) => { const next = new Set(set); next.delete(key); return next; });
    }
  };

  const draftOf = (person: Person): Draft => drafts[person.id] ?? { subject: person.emailSubject ?? "", body: person.emailBody ?? "" };
  const edit = (person: Person, change: Partial<Draft>) => setDrafts((all) => ({ ...all, [person.id]: { ...draftOf(person), ...change } }));
  const forget = (id: string) => setDrafts((all) => { const { [id]: gone, ...rest } = all; void gone; return rest; });

  const write = async (person: Person, followUp: boolean) => {
    forget(person.id);
    await run(`write:${person.id}`, { action: "write", contactId: person.id, followUp }, followUp ? "Follow-up written. Read it over, then send it in Gmail." : "Email written. Read it over, then send it in Gmail.");
  };
  const save = async (person: Person) => {
    const draft = drafts[person.id];
    if (!draft) return;
    const result = await run(`save:${person.id}`, { action: "write", contactId: person.id, subject: draft.subject, body: draft.body }, "Saved your edits.");
    if (result) forget(person.id);
  };
  // Opens Gmail right away (inside the click, so the browser doesn't block the tab), then saves any edits.
  const sendInGmail = (person: Person) => {
    const draft = draftOf(person);
    const link = composeLink("gmail", person.email!, draft.subject, draft.body);
    window.open(link.url, "_blank", "noopener,noreferrer");
    if (link.cut) {
      void navigator.clipboard.writeText(draft.body).catch(() => undefined);
      say("The email was too long for the link, so it's copied. Paste it into Gmail.");
    }
    setOpened((all) => ({ ...all, [person.id]: person.outreachStatus === "emailed" || person.outreachStatus === "no_response" }));
    if (drafts[person.id]) void save(person);
  };
  // Copies the whole email, then opens Gmail to them with just the subject: paste it in (keeps long emails whole).
  const copyIntoGmail = (person: Person) => {
    const draft = draftOf(person);
    const link = composeLink("gmail", person.email!, draft.subject, "");
    window.open(link.url, "_blank", "noopener,noreferrer");
    void navigator.clipboard.writeText(draft.body).then(() => say("Copied. Paste it into the Gmail tab."), () => say("Couldn't copy. Select the text and copy it."));
    setOpened((all) => ({ ...all, [person.id]: person.outreachStatus === "emailed" || person.outreachStatus === "no_response" }));
    if (drafts[person.id]) void save(person);
  };
  const markSent = async (person: Person) => {
    const followedUp = opened[person.id] === true;
    setOpened((all) => { const { [person.id]: gone, ...rest } = all; void gone; return rest; });
    await run(`status:${person.id}`, { action: "status", contactId: person.id, status: "emailed", followedUp }, followedUp ? "Marked the follow-up as sent." : `Marked ${person.name.split(" ")[0]} as emailed. Unnepo reminds you to follow up.`);
  };
  const setStatus = (person: Person, status: string, done: string) => run(`status:${person.id}`, { action: "status", contactId: person.id, status }, done);
  const bounced = async (person: Person) => {
    if (!window.confirm("Did the email bounce? Unnepo drops this address and checks the company's format again.")) return;
    await run(`bounced:${person.id}`, { action: "bounced", contactId: person.id }, "Dropped that address.");
  };
  const copy = (person: Person) => {
    const draft = draftOf(person);
    void navigator.clipboard.writeText(draft.subject ? `${draft.subject}\n\n${draft.body}` : draft.body).then(() => say("Copied."), () => say("Couldn't copy. Select the text and copy it."));
  };
  const find = () => run("find", { action: "find", ...(website.trim() ? { website: website.trim() } : {}) }, `Searching for people at ${company}…`);

  const head = (
    <div className="flex items-center justify-between gap-3">
      <p className={eyebrow}>People{shown.length ? ` · ${shown.length}` : ""}</p>
      {badge && isApplied(job) && <span className={`rounded-full border px-2 py-0.5 font-mono text-[10.5px] uppercase ${/^0 /.test(badge) ? "border-[#3A2020] text-[#F87171]" : "border-[#26262C] text-[#9A9AA3]"}`}>{badge}</span>}
    </div>
  );
  const errorLine = error ? <p role="alert" className="m-0 text-[13px] text-[#F87171]">{error}</p> : null;
  const linkedIn = (label: string, keywords: string) => <a href={`https://www.linkedin.com/search/results/people/?${new URLSearchParams({ keywords })}`} target="_blank" rel="noreferrer" className="text-[#F7F7F8] underline underline-offset-4">{label}</a>;

  if (!isApplied(job)) {
    return <div className="flex flex-col gap-3">{head}<Spots /><p className="m-0 text-sm text-muted">Once you apply, Unnepo finds who to email here.</p></div>;
  }

  const preview = !job.contacts.length && job.contactsStatus === "done" ? job.fillReport?.peoplePreview?.rows ?? [] : [];
  const locked = (key: string, main: string, sub: string) => (
    <li key={key} className="flex items-center gap-3 rounded-xl border border-[#1F1F24] px-3 py-2.5">
      <Avatar />
      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{main}</span><span className="block truncate text-xs text-[#8B8B94]">{sub}</span></span>
      <span className="flex-none rounded-[5px] border border-[#3D8BFF] px-1.5 font-mono text-[10px] font-semibold uppercase tracking-[.6px] text-[#3D8BFF]">Pro</span>
      <a href="/home?tab=pro" className="flex-none rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-black hover:bg-zinc-200">Show person</a>
    </li>
  );

  const firstWithEmail = job.contacts.find((person) => person.email)?.id;
  // Free shows one person; the rest of who the search found (and checked emails) come with Pro.
  const moreFound = Math.max(0, job.contacts.length - 1) + (job.fillReport?.peopleLocked ?? 0);
  const revealsLeft = (job.fillReport?.peopleReveals ?? 0) < MAX_REVEALS;
  const isHiddenPerson = (person: Person) => !person.email && job.hidden.includes(person.name.toLowerCase());
  const focused = focus ? job.contacts.find((person) => person.id === focus) ?? null : null;

  /** Everything about one person, in their popup: their email, the draft, and what happened. */
  const details = (person: Person) => {
    const hidden = isHiddenPerson(person);
    const draft = draftOf(person);
    const dirty = Boolean(drafts[person.id]);
    const isBusy = (what: string) => busy.has(`${what}:${person.id}`);
    const contacted = person.outreachStatus === "emailed" || person.outreachStatus === "no_response";
    const source = person.email && person.emailSource ? EMAIL_SOURCE[person.emailSource] : "";
    const unsure = person.emailSource === "likely" || person.emailSource === "guess";
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3 pr-8">
          <Avatar name={person.name} size={52} />
          <div className="min-w-0 flex-1">
            <h2 className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-lg font-semibold tracking-tight">
              <span className="truncate">{person.name}</span>
              <span className="rounded-full border border-[#26262C] px-1.5 font-mono text-[10px] font-normal text-[#B4B4BC]">{ROLE_LABEL[person.role] ?? person.role}</span>
            </h2>
            <p className="m-0 truncate text-sm text-[#8B8B94]">{[person.title, company].filter(Boolean).join(" · ")}</p>
          </div>
        </div>

        {person.email && (
          <div className="flex items-center gap-2 rounded-xl border border-[#1F1F24] bg-[#0A0A0C] px-3 py-2.5">
            <GmailIcon />
            <span className="min-w-0 flex-1">
              <span className="block select-all truncate font-mono text-[13px] text-[#D4D4DA]">{person.email}</span>
              {source && <span className={`block text-[11px] ${unsure ? "text-[#F5A524]" : "text-[#8B8B94]"}`}>{source}</span>}
            </span>
            <button type="button" onClick={() => void navigator.clipboard.writeText(person.email!).then(() => say("Copied the address."), () => say("Couldn't copy."))} className="flex-none text-xs text-[#9A9AA3] underline-offset-4 hover:text-white hover:underline">Copy</button>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {PERSON_STATUS[person.outreachStatus] && <span className={`font-mono text-[11px] uppercase ${person.outreachStatus === "replied" ? "text-[#4ADE80]" : "text-[#9A9AA3]"}`}>{PERSON_STATUS[person.outreachStatus]}</span>}
          {person.linkedinUrl && <a href={person.linkedinUrl} target="_blank" rel="noreferrer" className="text-[13px] underline underline-offset-4">LinkedIn ↗</a>}
        </div>
        {errorLine}

        {hidden && (revealsLeft
          ? <div><button type="button" disabled={isBusy("reveal")} onClick={() => void run(`reveal:${person.id}`, { action: "reveal", contactId: person.id }, `Looked up ${person.name.split(" ")[0]}.`)} className={primary}>{isBusy("reveal") ? "Looking…" : "Show person"}</button></div>
          : <p className="m-0 text-[13px] text-muted">You&apos;ve shown {MAX_REVEALS} people for this job.</p>)}
        {!hidden && !person.email && <p className="m-0 text-[13px] text-muted">No email found.</p>}

        {person.email && !hidden && (
          <div className="flex flex-col gap-2">
            {draft.body ? (
              <>
                <input value={draft.subject} onChange={(event) => edit(person, { subject: event.target.value })} maxLength={200} aria-label={`Subject of the email to ${person.name}`} placeholder="Subject" className="h-9 w-full rounded-lg border border-[#26262C] bg-[#0A0A0C] px-3 text-sm font-medium focus:border-[#3D8BFF] focus:outline-none" />
                <textarea value={draft.body} onChange={(event) => edit(person, { body: event.target.value })} rows={9} aria-label={`Email to ${person.name}`} className="w-full resize-y rounded-lg border border-[#26262C] bg-[#0A0A0C] px-3 py-2 text-sm leading-relaxed focus:border-[#3D8BFF] focus:outline-none" />
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => sendInGmail(person)} className={primary}><GmailIcon />Send in Gmail ↗</button>
                  <button type="button" onClick={() => copyIntoGmail(person)} className={secondary} title="Copies the email, then opens Gmail to them so you paste it in"><GmailIcon />Copy into Gmail</button>
                  <button type="button" onClick={() => copy(person)} className={quiet}>Copy</button>
                  {dirty && <button type="button" disabled={isBusy("save")} onClick={() => void save(person)} className={secondary}>{isBusy("save") ? "Saving…" : "Save edits"}</button>}
                  <button type="button" disabled={isBusy("write")} onClick={() => void write(person, false)} className={quiet}>{isBusy("write") ? "Writing…" : "Write it again"}</button>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-start gap-2">
                <button type="button" disabled={isBusy("write")} onClick={() => void write(person, false)} className={primary}>{isBusy("write") ? "Writing your email…" : `Write email${emailsLeft !== null ? ` (${emailsLeft} left today)` : ""}`}</button>
                <span className="text-[12px] text-[#8B8B94]">Written from your resume and this job. You read it before it goes.</span>
              </div>
            )}

            {person.id in opened && (
              <div role="status" className="flex flex-wrap items-center gap-2 rounded-lg border border-[#2A3A5A] bg-[#3D8BFF]/[0.06] px-3 py-2">
                <span className="mr-auto text-[13px]">{opened[person.id] ? "Sent the follow-up?" : "Sent it?"}</span>
                <button type="button" disabled={isBusy("status")} onClick={() => void markSent(person)} className={primary}>{opened[person.id] ? "I sent the follow-up" : "I emailed them"}</button>
                <button type="button" onClick={() => setOpened((all) => { const { [person.id]: gone, ...rest } = all; void gone; return rest; })} className={quiet}>Not yet</button>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[#1F1F24] pt-3">
              {contacted && (free
                ? <a href="/home?tab=pro" className={quiet}>Write follow-up (Pro)</a>
                : <button type="button" disabled={isBusy("write")} onClick={() => void write(person, true)} className={quiet}>Write follow-up</button>)}
              {contacted && <button type="button" disabled={isBusy("status")} onClick={() => void setStatus(person, "replied", `${person.name.split(" ")[0]} replied. Nice.`)} className={quiet}>They replied</button>}
              {person.outreachStatus === "emailed" && <button type="button" disabled={isBusy("status")} onClick={() => void setStatus(person, "no_response", "Marked as no reply.")} className={quiet}>No reply</button>}
              {person.outreachStatus === "not_contacted" && !(person.id in opened) && <button type="button" disabled={isBusy("status")} onClick={() => void setStatus(person, "emailed", `Marked ${person.name.split(" ")[0]} as emailed.`)} className={quiet}>Already emailed them</button>}
              <button type="button" disabled={isBusy("bounced")} onClick={() => void bounced(person)} className={quiet}>It bounced</button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const list = (
    <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2">
      {shown.map((person) => {
        const hidden = isHiddenPerson(person);
        if (free && hidden) return locked(person.id, person.name, person.title || ROLE_LABEL[person.role] || "");
        const start = person.id === firstWithEmail;
        const status = PERSON_STATUS[person.outreachStatus];
        const written = Boolean(person.emailBody);
        return (
          <li key={person.id}>
            <button type="button" onClick={() => setFocus(person.id)} aria-label={`Open ${person.name}`}
              className={`group flex w-full items-center gap-3 rounded-xl border bg-[#0A0A0C] px-3 py-3 text-left transition-colors hover:border-[#3A3A42] hover:bg-white/[0.03] ${start ? "border-[#2A3A5A]" : "border-[#1F1F24]"}`}>
              <Avatar name={person.name} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold">{person.name}</span>
                  {start && <span className="flex-none font-mono text-[10px] uppercase tracking-[.6px] text-[#3D8BFF]">★ Start</span>}
                  {person.role === "job_poster" && <span className="flex-none rounded-full border border-[#26262C] px-1.5 font-mono text-[10px] text-[#B4B4BC]">Shown on job posting</span>}
                </span>
                <span className="block truncate text-xs text-[#8B8B94]">{person.title || ROLE_LABEL[person.role] || ""}</span>
                <span className="mt-1 flex items-center gap-1.5 text-xs">
                  {person.email
                    ? <><GmailIcon /><span className="truncate font-mono text-[#D4D4DA]">{person.email}</span></>
                    : <span className="text-[#8B8B94]">{hidden ? "Tap to show who it is" : "No email found"}</span>}
                </span>
              </span>
              <span className="flex flex-none flex-col items-end gap-1">
                {status
                  ? <span className={`font-mono text-[10px] uppercase ${person.outreachStatus === "replied" ? "text-[#4ADE80]" : "text-[#9A9AA3]"}`}>{status}</span>
                  : written ? <span className="font-mono text-[10px] uppercase text-[#3D8BFF]">Written</span> : null}
                <span aria-hidden className="text-[#5C5C66] transition-transform group-hover:translate-x-0.5 group-hover:text-white">›</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
  const popup = focused ? <Popup label={focused.name} onClose={() => setFocus(null)} width="max-w-xl">{details(focused)}</Popup> : null;

  // Free's preview: titles only, with Pro to see who they are.
  if (preview.length && free) {
    return (
      <div className="flex flex-col gap-2">
        {head}
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {preview.map((row, index) => locked(`preview-${index}`, row.title || ROLE_LABEL[row.role] || "Someone", [row.title ? ROLE_LABEL[row.role] : "", "Name hidden"].filter(Boolean).join(" · ")))}
        </ul>
      </div>
    );
  }

  // Not searched yet: the button.
  if (job.contactsStatus === "idle" || (preview.length && !free)) {
    return (
      <div className="flex flex-col gap-3">
        {head}
        {job.contacts.length ? <>{list}{popup}</> : <Spots />}
        <div className="flex flex-col gap-3 rounded-2xl border border-[#1F1F24] bg-[#0A0A0C] p-4">
          <p className="m-0 text-sm text-[#B4B4BC]">Unnepo finds recruiters, the team, and people you have something in common with, with their work emails.</p>
          <div><button type="button" onClick={() => void find()} disabled={busy.has("find")} className={primary}>{busy.has("find") ? "Starting…" : "Find people"}</button></div>
        </div>
        {note && <p className="m-0 text-[13px] text-[#F5A524]">{note}</p>}
        {errorLine}
      </div>
    );
  }

  if (searching && !stale) {
    return (
      <div className="flex flex-col gap-2">
        {head}
        {job.contacts.length ? <>{list}{popup}</> : <Spots searching />}
        <p role="status" className="m-0 flex items-center gap-2 text-sm text-muted"><span aria-hidden className="h-2 w-2 animate-pulse rounded-full bg-[#3D8BFF]" />{job.contactsMessage || `Searching for people at ${company}…`}</p>
      </div>
    );
  }

  if (!job.contacts.length) {
    return (
      <div className="flex flex-col gap-3">
        {head}
        <Spots />
        <div className="flex flex-col gap-3 rounded-2xl border border-[#1F1F24] bg-[#0A0A0C] p-4">
          <p className="m-0 text-sm text-[#B4B4BC]">{stale || job.contactsStatus === "failed" ? "That search didn't finish." : "No one found yet."} Add the company&apos;s website and Unnepo looks again.</p>
          <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); void find(); }}>
            <input value={website} onChange={(event) => setWebsite(event.target.value)} placeholder="Company website, like acme.com" aria-label="Company website" className="h-10 min-w-0 flex-1 basis-48 rounded-xl border border-[#26262C] bg-[#0C0C0E] px-3 text-sm placeholder:text-[#5C5C66] focus:border-[#3D8BFF] focus:outline-none" />
            <button type="submit" disabled={busy.has("find")} className="h-10 rounded-xl bg-white px-4 text-sm font-semibold text-black hover:bg-zinc-200 disabled:opacity-50">{busy.has("find") ? "Starting…" : "Search"}</button>
          </form>
          <p className="m-0 text-[13px] text-[#8B8B94]">Or look yourself: {linkedIn("recruiters", `recruiter ${job.company}`)} · {linkedIn("the team", `${job.department || job.title} ${job.company}`)} on LinkedIn ↗</p>
        </div>
        {note && <p className="m-0 text-[13px] text-[#F5A524]">{note}</p>}
        {errorLine}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {head}
      {!focused && errorLine}
      {list}
      {free && shown.length > 0 && <UnlockCard more={moreFound} company={company} />}
      {popup}
    </div>
  );
}

/** Free: under the one person shown, who else is there (blurred) and one button to Pro. */
function UnlockCard({ more, company }: { more: number; company: string }) {
  return (
    <div className="mt-1 flex flex-col gap-3 rounded-xl border border-[#3D8BFF]/40 bg-[radial-gradient(120%_140%_at_0%_0%,rgba(61,139,255,.16),transparent_60%)] p-4 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span aria-hidden className="relative flex flex-none pr-1.5">
          {["#3D8BFF", "#A78BFA", "#34D399"].map((color, index) => (
            <span key={color} className={`h-[26px] w-[26px] rounded-full blur-[0.6px] ${index ? "-ml-2" : ""}`} style={{ background: `${color}33`, boxShadow: `inset 0 0 0 1.5px ${color}88` }} />
          ))}
          <span className="absolute -bottom-1 -right-0.5 grid h-[18px] w-[18px] place-items-center rounded-full bg-[#3D8BFF] text-white ring-2 ring-[#0A0A0C]">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
          </span>
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold">{more ? `Unlock ${more} more ${more === 1 ? "person" : "people"}` : "Unlock more people"}</span>
          <span className="block text-xs leading-snug text-[#8B8B94]">Recruiters, the team and alumni at {company}, with checked emails.</span>
        </span>
      </div>
      <a href="/home?tab=pro" className="flex h-10 flex-none items-center justify-center gap-1.5 rounded-lg bg-[#3D8BFF] px-4 text-sm font-semibold text-white transition hover:brightness-110">Upgrade to Pro <span aria-hidden>→</span></a>
    </div>
  );
}
