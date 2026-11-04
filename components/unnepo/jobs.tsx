"use client";

import { useCallback, useEffect, useState } from "react";
import type { Highlight } from "@/components/unnepo/UnnepoForms";
import { categoryColor, categoryOf } from "@/lib/jobs/category";

export type Job = {
  id: string;
  title: string;
  company: string;
  location: string;
  postedAt: string;
  postedKind: "posted" | "updated";
  url: string;
  source: string;
  sourceLabel: string;
  description: string;
  reasons: string[];
  /** Not shown to the student before this load. */
  isNew?: boolean;
  /** How well it fits the student's profile, 0 to 99. */
  score: number;
  category: string;
  saved?: boolean;
};

type LetterInput = { job: { title: string; company: string; description: string; url?: string }; studentFactIds: string[]; detailFactIds: string[]; tone: string; length: string; notes: string };

const btn = "inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40";
const primary = `${btn} bg-white text-black hover:bg-zinc-200`;
const secondary = `${btn} border border-line bg-transparent text-ink hover:bg-white/5`;
const field = "w-full rounded-xl border border-line bg-card px-3 py-2.5 text-sm text-ink outline-none placeholder:text-faint focus:border-zinc-500";
const label = "mb-1.5 block text-xs font-medium text-muted";

/** "Today", "3 days ago", "Oct 2". */
function postedLabel(job: Pick<Job, "postedAt">, now: number) {
  if (!job.postedAt) return "";
  const date = new Date(job.postedAt);
  const days = Math.floor((now - date.getTime()) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const chipOn = "border-[#F7F7F8] bg-[#F7F7F8] text-[#070708]";
const chipOff = "border-[#26262C] bg-transparent text-[#9A9AA3] hover:text-white";
const heading = "m-0 text-[28px] font-extrabold tracking-[-1.1px] sm:text-[34px]";

export function JobsPage({ onCoverLetter }: { onCoverLetter: (job: Job | null, jobs: Job[]) => void }) {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [roles, setRoles] = useState<string[]>([]);
  const [now, setNow] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [off, setOff] = useState<string[]>([]);
  const [savedOnly, setSavedOnly] = useState(false);
  const [notice, setNotice] = useState("");
  const [cachedAt, setCachedAt] = useState("");
  const [editing, setEditing] = useState(false);

  const load = useCallback(async (refresh: boolean) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/app/jobs${refresh ? "?refresh=1" : ""}`, { signal: AbortSignal.timeout(45_000) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Jobs could not be loaded.");
      const list: Job[] = payload.jobs ?? [];
      setJobs(list);
      setRoles(payload.matchedOn?.roles ?? []);
      setCachedAt(payload.cachedAt ?? new Date().toISOString());
      setNow(Date.now());
      setOpen((current) => (current && list.some((job) => job.id === current) ? current : list[0]?.id ?? null));
      if (refresh) setNotice(payload.newCount ? `${payload.newCount} new ${payload.newCount === 1 ? "match" : "matches"} since you last looked.` : "No new matches right now. Check back later.");
      return list.length;
    } catch (reason) {
      setError(reason instanceof Error && reason.name !== "TimeoutError" ? reason.message : "Job boards took too long to answer. Try again.");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void load(false));
  }, [load]);

  /** "Not for me": gone from the list now, and for good. */
  async function hide(job: Job) {
    setJobs((list) => (list ?? []).filter((item) => item.id !== job.id));
    await fetch("/api/app/jobs/dismiss", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId: job.id }) }).catch(() => undefined);
  }
  async function save(job: Job) {
    const saved = !job.saved;
    const mark = (value: boolean) => setJobs((list) => (list ?? []).map((item) => (item.id === job.id ? { ...item, saved: value } : item)));
    mark(saved);
    const response = await fetch("/api/app/jobs/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(saved ? { job, saved } : { jobId: job.id, saved }) }).catch(() => null);
    if (!response?.ok) {
      mark(!saved);
      setError("Couldn't save that job. Try again.");
    }
  }

  const all = jobs ?? [];
  const categories = [...new Set(all.map((job) => job.category))];
  const shown = all.filter((job) => (savedOnly ? job.saved : !off.includes(job.category)));
  const savedCount = all.filter((job) => job.saved).length;
  const updated = cachedAt && now ? Math.max(0, Math.round((now - Date.parse(cachedAt)) / 60000)) : null;

  if (editing) {
    return (
      <EditCareers
        onClose={() => setEditing(false)}
        onSaved={async (count) => {
          setEditing(false);
          setOff([]);
          setSavedOnly(false);
          window.scrollTo({ top: 0 });
          const found = await load(false);
          if (found !== null) setNotice(`Saved. Matches refreshed for your ${count} ${count === 1 ? "role" : "roles"}.`);
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className={heading}>Jobs for you {jobs && <span className="text-base font-medium tracking-normal text-[#8B8B94]">{shown.length} {shown.length === 1 ? "match" : "matches"}, best first</span>}</h1>
          <div className="flex flex-wrap items-center gap-1.5 text-[13px] text-[#9A9AA3]">
            {roles.length > 0 && "Matching"}
            {roles.map((role) => (
              <span key={role} className="inline-flex items-center gap-1.5 rounded-full border border-[#26262C] px-[9px] py-[3px] text-[#E4E4E8]">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: categoryOf(role).color }} />{role}
              </span>
            ))}
            <button type="button" onClick={() => setEditing(true)} className="h-7 px-2.5 text-[13px] font-medium text-[#3D8BFF] hover:underline">Edit careers &amp; roles</button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void load(true)} disabled={loading} className="h-10 rounded-[10px] border border-[#26262C] px-3.5 text-[13px] font-medium hover:bg-white/5 disabled:opacity-50">{loading ? "Searching…" : "↻ Find new jobs"}</button>
          <button type="button" onClick={() => onCoverLetter(null, all)} className="h-10 rounded-[10px] bg-[#F7F7F8] px-3.5 text-[13px] font-semibold text-[#070708] hover:bg-white">✦ Write me a cover letter</button>
        </div>
      </div>

      {notice && <p role="status" className="m-0 rounded-[10px] border border-[#1F4D2E] bg-[#0B1A11] px-3.5 py-2.5 text-[13px] text-[#B4E8C5]">{notice}</p>}
      {error && <p role="alert" className="m-0 rounded-[10px] border border-red-900/60 bg-red-950/40 px-3.5 py-2.5 text-[13px] text-red-300">{error}</p>}

      {jobs && all.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div role="group" aria-label="Show jobs" className="flex flex-wrap gap-1.5">
            {categories.map((name) => {
              const on = !savedOnly && !off.includes(name);
              return (
                <button key={name} type="button" aria-pressed={on} onClick={() => { setSavedOnly(false); setOff((list) => (list.includes(name) ? list.filter((item) => item !== name) : [...list, name])); }} className={`inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs font-medium ${on ? chipOn : chipOff}`}>
                  <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: categoryColor(name) }} />{name} <span className="opacity-70">{all.filter((job) => job.category === name).length}</span>
                </button>
              );
            })}
            {savedCount > 0 && <button type="button" aria-pressed={savedOnly} onClick={() => setSavedOnly((value) => !value)} className={`inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs font-medium ${savedOnly ? chipOn : chipOff}`}>Saved <span className="opacity-70">{savedCount}</span></button>}
          </div>
          <span className="text-xs text-[#8B8B94]">Greenhouse, Lever, Ashby, Remotive and The Muse · updated {updated === null || updated < 1 ? "just now" : `${updated} min ago`}</span>
        </div>
      )}

      {loading && !jobs && <p className="m-0 rounded-2xl border border-[#1F1F24] p-8 text-center text-sm text-[#8B8B94]">Looking across job boards. This can take up to 20 seconds.</p>}
      {jobs && !shown.length && !loading && (
        <p className="m-0 p-8 text-center text-sm text-[#8B8B94]">
          {all.length ? "Nothing here with these filters." : "No matches right now."} <button type="button" onClick={() => setEditing(true)} className="font-medium text-[#F7F7F8] underline underline-offset-4">Add a role</button>
        </p>
      )}

      {shown.length > 0 && (
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(280px,100%),1fr))] items-start gap-3 p-0">
          {shown.map((job) => {
            const on = open === job.id;
            const panel = `job-card-${job.id.replace(/[^a-z0-9]/gi, "-")}`;
            const posted = postedLabel(job, now);
            return (
              <li key={job.id} className={`flex min-w-0 flex-col rounded-2xl border ${on ? "border-[#3D8BFF] bg-[#0F0F12]" : "border-[#1F1F24] hover:border-[#3A3A42]"}`}>
                <button type="button" aria-expanded={on} aria-controls={panel} onClick={() => setOpen(on ? null : job.id)} className="flex flex-col gap-2.5 p-4 text-left">
                  <span className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-[11px] text-[#9A9AA3]"><span aria-hidden className="h-[7px] w-[7px] rounded-full" style={{ background: categoryColor(job.category) }} />{job.category}</span>
                    <span className={`font-mono text-xs ${job.score >= 75 ? "text-[#3D8BFF]" : "text-[#9A9AA3]"}`}><span className="sr-only">Match: </span>{job.score}%</span>
                  </span>
                  <span className="break-words text-[15px] font-semibold leading-[1.3]">{job.title}</span>
                  <span className="break-words text-xs text-[#8B8B94]">
                    {[job.company, job.location, posted].filter(Boolean).join(" · ")}
                    {job.isNew && <span className="text-[#3D8BFF]"> · New</span>}
                    {job.saved && <span className="text-[#3D8BFF]"> · Saved</span>}
                  </span>
                </button>
                {on && (
                  <div id={panel} className="flex flex-col gap-3 px-4 pb-4">
                    {job.reasons.length > 0 && (
                      <ul aria-label="Why it matches" className="m-0 flex list-none flex-col gap-1.5 border-t border-[#1F1F24] p-0 pt-3">
                        {job.reasons.map((reason) => <li key={reason} className="flex gap-2 text-xs text-[#E4E4E8]"><span aria-hidden className="text-[#3D8BFF]">✓</span><span className="min-w-0">{reason}</span></li>)}
                      </ul>
                    )}
                    {job.description && (
                      <details className="text-xs text-[#9A9AA3]">
                        <summary className="cursor-pointer select-none hover:text-white">Read the description</summary>
                        <p className="mb-0 mt-2 max-h-60 overflow-auto whitespace-pre-line break-words">{job.description}</p>
                      </details>
                    )}
                    <div className="grid grid-cols-2 gap-1.5">
                      <a href={job.url} target="_blank" rel="noopener noreferrer" className="flex h-[38px] items-center justify-center rounded-[10px] bg-[#F7F7F8] text-[13px] font-semibold text-[#070708] hover:bg-white">Apply <span aria-hidden>&nbsp;↗</span></a>
                      <button type="button" onClick={() => onCoverLetter(job, all)} className="h-[38px] rounded-[10px] border border-[#26262C] text-[13px] font-medium hover:bg-white/5">✦ Cover letter</button>
                    </div>
                    <div className="flex justify-between">
                      <button type="button" onClick={() => void save(job)} aria-pressed={Boolean(job.saved)} className="h-8 text-xs font-medium hover:underline">{job.saved ? "✓ Saved" : "+ Save for later"}</button>
                      <button type="button" onClick={() => void hide(job)} aria-label={`Not for me: hide ${job.title} at ${job.company}`} className="h-8 text-xs font-medium text-[#9A9AA3] hover:text-white">✕ Not for me</button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

type Preferences = { chosen: boolean; roles: string[]; companies: string[]; industries: string[]; locations: string[]; remote: "yes" | "no" | "either"; jobType: "internship" | "full_time" | "either"; suggestedRoles: string[]; industryOptions: string[] };

function AddBox({ label, placeholder, onAdd }: { label: string; placeholder: string; onAdd: (value: string) => void }) {
  const [value, setValue] = useState("");
  const add = () => {
    if (value.trim()) onAdd(value.trim());
    setValue("");
  };
  return (
    <label className="inline-flex h-[34px] items-center rounded-lg border border-dashed border-[#3A3A42] px-2.5 focus-within:border-[#3D8BFF]">
      <span className="sr-only">{label}</span>
      <input
        type="text"
        value={value}
        maxLength={80}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add(); } }}
        onBlur={add}
        placeholder={placeholder}
        className="w-40 border-0 bg-transparent text-[13px] text-[#F7F7F8] outline-none placeholder:text-[#8B8B94]"
      />
    </label>
  );
}

/** Edit careers & roles: what jobs are matched against. Starts from the student's resume until they save it. */
function EditCareers({ onClose, onSaved }: { onClose: () => void; onSaved: (roleCount: number) => Promise<void> }) {
  const [draft, setDraft] = useState<Preferences | null>(null);
  const [places, setPlaces] = useState<string[]>([]);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/app/job-preferences");
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "Couldn't load your careers and roles.");
        setDraft(payload);
        setPlaces([...new Set([...(payload.locations as string[]), "Anywhere in the US"])]);
      } catch (reason) {
        setProblem(reason instanceof Error ? reason.message : "Couldn't load your careers and roles.");
      }
    })();
  }, []);
  const toggled = (list: string[], value: string) => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  const added = (list: string[], value: string) => (list.some((item) => item.toLowerCase() === value.toLowerCase()) ? list : [...list, value]);
  const chip = "h-9 rounded-full border px-3.5 text-[13px] font-medium";
  const section = "flex flex-col gap-3 border-t border-[#17171B] pt-6";
  const title = "m-0 text-[17px] font-semibold";
  const back = <button type="button" onClick={onClose} className="h-8 self-start text-[13px] font-medium text-[#9A9AA3] hover:text-white">← Back to jobs</button>;

  if (!draft) return <div className="mx-auto flex w-full max-w-[880px] flex-col gap-3">{back}{problem ? <p role="alert" className="m-0 text-sm text-red-300">{problem}</p> : <p className="m-0 text-sm text-[#8B8B94]">Loading your careers and roles…</p>}</div>;
  const set = (change: Partial<Preferences>) => setDraft({ ...draft, ...change });
  const remoteOn = draft.remote !== "no";
  const onlyPlaces = draft.locations.length > 0;
  async function submit() {
    setBusy(true);
    setProblem("");
    try {
      const response = await fetch("/api/app/job-preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // Remote with no other place picked means only remote jobs.
        body: JSON.stringify({ ...draft, remote: !remoteOn ? "no" : onlyPlaces ? "either" : "yes" }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Couldn't save your careers and roles.");
      await onSaved(draft!.roles.length);
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : "Couldn't save your careers and roles.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-7">
      <div className="flex flex-col gap-2">
        {back}
        <h1 className={heading}>Edit careers &amp; roles</h1>
        <p className="m-0 text-[15px] text-[#9A9AA3]">Unnepo finds jobs that match these.{draft.chosen ? "" : " We started from your resume, so change anything that's off."}</p>
      </div>

      <section aria-labelledby="edit-roles" className="flex flex-col gap-3">
        <h2 id="edit-roles" className={title}>Roles you want <span className="text-[13px] font-normal text-[#8B8B94]">{draft.roles.length}</span></h2>
        <div className="flex flex-wrap items-center gap-2">
          {draft.roles.map((role) => (
            <span key={role} className="inline-flex h-[38px] items-center gap-2 rounded-full border border-[#3A3A42] bg-[#111114] pl-3.5 pr-1.5 text-sm">
              <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: categoryOf(role).color }} />{role}
              <button type="button" aria-label={`Remove ${role}`} onClick={() => set({ roles: draft.roles.filter((item) => item !== role) })} className="h-7 w-7 rounded-full text-[#9A9AA3] hover:text-white">✕</button>
            </span>
          ))}
          <AddBox label="Add a role" placeholder="+ Add a role" onAdd={(value) => set({ roles: added(draft.roles, value) })} />
        </div>
        {draft.suggestedRoles.filter((role) => !draft.roles.includes(role)).length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] text-[#8B8B94]">Suggested from your resume:</span>
            {draft.suggestedRoles.filter((role) => !draft.roles.includes(role)).map((role) => (
              <button key={role} type="button" onClick={() => set({ roles: [...draft.roles, role] })} className="h-8 rounded-full border border-dashed border-[#3A3A42] px-3 text-[13px] font-medium text-[#B4B4BC] hover:text-white">+ {role}</button>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="edit-industries" className={section}>
        <h2 id="edit-industries" className={title}>Industries</h2>
        <div className="flex flex-wrap gap-2">
          {draft.industryOptions.map((name) => <button key={name} type="button" aria-pressed={draft.industries.includes(name)} onClick={() => set({ industries: toggled(draft.industries, name) })} className={`${chip} ${draft.industries.includes(name) ? chipOn : chipOff}`}>{name}</button>)}
        </div>
      </section>

      <section aria-labelledby="edit-companies" className={section}>
        <h2 id="edit-companies" className={title}>Dream companies <span className="text-[13px] font-normal text-[#8B8B94]">checked first</span></h2>
        <div className="flex flex-wrap items-center gap-2">
          {draft.companies.map((name) => (
            <span key={name} className="inline-flex h-[34px] items-center gap-1 rounded-lg border border-[#26262C] pl-3 pr-1 text-[13px]">
              {name}
              <button type="button" aria-label={`Remove ${name}`} onClick={() => set({ companies: draft.companies.filter((item) => item !== name) })} className="h-6 w-6 rounded text-[#9A9AA3] hover:text-white">✕</button>
            </span>
          ))}
          <AddBox label="Add a company" placeholder="+ Add a company" onAdd={(value) => set({ companies: added(draft.companies, value) })} />
        </div>
      </section>

      <section className="flex flex-wrap gap-8 border-t border-[#17171B] pt-6">
        <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-3">
          <h2 id="edit-where" className={title}>Where</h2>
          <div role="group" aria-labelledby="edit-where" className="flex flex-wrap items-center gap-2">
            <button type="button" aria-pressed={remoteOn} onClick={() => set({ remote: remoteOn ? "no" : "either" })} className={`${chip} ${remoteOn ? chipOn : chipOff}`}>Remote</button>
            {places.map((place) => <button key={place} type="button" aria-pressed={draft.locations.includes(place)} onClick={() => set({ locations: toggled(draft.locations, place) })} className={`${chip} ${draft.locations.includes(place) ? chipOn : chipOff}`}>{place}</button>)}
            <AddBox label="Add a place" placeholder="+ Add a place" onAdd={(value) => { setPlaces((list) => added(list, value)); set({ locations: added(draft.locations, value) }); }} />
          </div>
        </div>
        <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-3">
          <h2 id="edit-type" className={title}>Job type</h2>
          <div role="group" aria-labelledby="edit-type" className="flex self-start rounded-[10px] border border-[#26262C] p-[3px]">
            {([["internship", "Internship"], ["full_time", "Full-time"], ["either", "Both"]] as const).map(([id, name]) => <button key={id} type="button" aria-pressed={draft.jobType === id} onClick={() => set({ jobType: id })} className={`h-8 rounded-[7px] px-3 text-[13px] font-medium ${draft.jobType === id ? "bg-[#F7F7F8] text-[#070708]" : "text-[#9A9AA3] hover:text-white"}`}>{name}</button>)}
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3 border-t border-[#17171B] pt-6">
        <button type="button" disabled={busy || !draft.roles.length} onClick={() => void submit()} className="h-12 rounded-xl bg-[#F7F7F8] px-[22px] text-[15px] font-semibold text-[#070708] hover:bg-white disabled:opacity-50">{busy ? "Saving…" : "Save and refresh matches"}</button>
        {!draft.roles.length && <span className="text-[13px] text-[#8B8B94]">Add at least one role.</span>}
        {problem && <span role="alert" className="text-[13px] text-red-300">{problem}</span>}
      </div>
    </div>
  );
}

export function CoverLetterModal({ jobs, initialJob, highlights, highlightsLoading, onClose, onGenerate }: {
  jobs: Job[];
  initialJob: Job | null;
  highlights: Highlight[];
  highlightsLoading: boolean;
  onClose: () => void;
  onGenerate: (input: LetterInput) => Promise<string>;
}) {
  const [step, setStep] = useState(initialJob ? 1 : 0);
  const [jobId, setJobId] = useState(initialJob?.id ?? "");
  const [custom, setCustom] = useState({ title: "", company: "", description: "" });
  const [mine, setMine] = useState<string[]>([]);
  const [details, setDetails] = useState<string[]>([]);
  const [tone, setTone] = useState("professional");
  const [length, setLength] = useState("standard");
  const [notes, setNotes] = useState("");
  const [letter, setLetter] = useState("");
  // Part of the letter the student selected, to have just that rewritten.
  const [part, setPart] = useState("");
  const [partAsk, setPartAsk] = useState("");
  const [partBusy, setPartBusy] = useState(false);
  const [partError, setPartError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const picked = jobs.find((item) => item.id === jobId) ?? (initialJob?.id === jobId ? initialJob : null);
  const job = picked ? { title: picked.title, company: picked.company, description: picked.description, url: picked.url } : custom;
  const jobReady = Boolean(job.title.trim() && job.company.trim());
  const toggle = (value: string, list: string[], set: (next: string[]) => void) => set(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);

  async function rewritePart(ask: string) {
    if (!part || !ask.trim()) return;
    setPartBusy(true);
    setPartError("");
    try {
      const response = await fetch("/api/app/cover-letter-part", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ letter, part, ask, job }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Couldn't rewrite that part.");
      setLetter(payload.letter);
      setPart("");
      setPartAsk("");
    } catch (reason) {
      setPartError(reason instanceof Error ? reason.message : "Couldn't rewrite that part.");
    } finally {
      setPartBusy(false);
    }
  }

  async function generate() {
    setBusy(true);
    setError("");
    try {
      setLetter(await onGenerate({ job, studentFactIds: mine, detailFactIds: details.filter((item) => mine.includes(item)), tone, length, notes }));
      setStep(3);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not write the letter.");
    } finally {
      setBusy(false);
    }
  }

  function download() {
    const blob = new Blob([letter], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Cover letter - ${job.company} - ${job.title}.txt`.replace(/[\\/:*?"<>|]+/g, " ");
    link.click();
    URL.revokeObjectURL(url);
  }

  const steps = ["Job", "Highlights", "Style", "Review"];
  return (
    <div role="presentation" className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-3 sm:p-6">
      <div role="dialog" aria-modal="true" aria-label="Write a cover letter" className="max-h-[calc(100vh-1.5rem)] w-full max-w-3xl space-y-5 overflow-y-auto rounded-2xl border border-line bg-panel p-5 shadow-2xl sm:p-7">
        <div className="flex justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-2xl font-bold">✦ Write a cover letter</h2>
            <p className="truncate text-sm text-muted">{jobReady ? `${job.title} · ${job.company}` : "Pick a job or paste one in"}</p>
          </div>
          <button aria-label="Close" className={secondary} onClick={onClose}>✕</button>
        </div>
        <div className="grid grid-cols-4 gap-1">
          {steps.map((name, index) => (
            <div key={name}>
              <div className={`h-1.5 rounded-full ${index <= step ? "bg-white" : "bg-line"}`} />
              <div className="mt-1 text-center text-[10px] text-muted">{name}</div>
            </div>
          ))}
        </div>

        {step === 0 && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Which job is this for?</h3>
            {jobs.length > 0 && (
              <div>
                <label className={label} htmlFor="letter-job">From your recommended jobs</label>
                <select id="letter-job" className={field} value={jobId} onChange={(event) => setJobId(event.target.value)}>
                  <option value="">Paste a different job instead…</option>
                  {jobs.map((item) => <option key={item.id} value={item.id}>{item.title} · {item.company}</option>)}
                </select>
              </div>
            )}
            {!picked && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={label} htmlFor="letter-title">Job title</label>
                  <input id="letter-title" className={field} value={custom.title} onChange={(event) => setCustom({ ...custom, title: event.target.value })} placeholder="Marketing Intern" />
                </div>
                <div>
                  <label className={label} htmlFor="letter-company">Company</label>
                  <input id="letter-company" className={field} value={custom.company} onChange={(event) => setCustom({ ...custom, company: event.target.value })} placeholder="Patagonia" />
                </div>
                <div className="sm:col-span-2">
                  <label className={label} htmlFor="letter-description">Job description</label>
                  <textarea id="letter-description" rows={6} className={field} value={custom.description} onChange={(event) => setCustom({ ...custom, description: event.target.value })} placeholder="Paste the posting so the letter can speak to what they're looking for." />
                </div>
              </div>
            )}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">What should the letter feature?</h3>
            <p className="text-sm text-muted">Pick two or three highlights that fit this job. The letter also draws on your uploaded resume.</p>
            {highlightsLoading ? (
              <p className="rounded-xl border border-line px-3 py-3 text-sm text-muted">Picking highlights from your profile…</p>
            ) : highlights.length ? (
              <div className="flex flex-wrap gap-2">
                {highlights.map((item) => (
                  <button key={item.id} type="button" title={item.detail} onClick={() => toggle(item.id, mine, setMine)} className={`${btn} border text-left ${mine.includes(item.id) ? "border-white bg-white text-black" : "border-line text-zinc-300 hover:bg-white/5"}`}>
                    {mine.includes(item.id) ? "✓ " : "+ "}{item.label}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">No highlights yet. The letter will use your resume and profile.</p>
            )}
            {highlights.filter((item) => item.experienceDetails && mine.includes(item.id)).map((item) => (
              <label key={item.id} className="flex items-start gap-3 rounded-xl border border-line p-3 text-sm">
                <input type="checkbox" className="mt-1" checked={details.includes(item.id)} onChange={() => toggle(item.id, details, setDetails)} />
                <span><span className="font-medium">Include details about {item.label}</span><span className="mt-0.5 block text-xs text-muted">{item.experienceDetails}</span></span>
              </label>
            ))}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">How should it sound?</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={label} htmlFor="letter-tone">Tone</label>
                <select id="letter-tone" className={field} value={tone} onChange={(event) => setTone(event.target.value)}>
                  <option value="professional">Professional and polished</option>
                  <option value="friendly">Warm and personable</option>
                  <option value="confident">Confident and direct</option>
                  <option value="enthusiastic">Enthusiastic</option>
                </select>
              </div>
              <div>
                <label className={label} htmlFor="letter-length">Length</label>
                <select id="letter-length" className={field} value={length} onChange={(event) => setLength(event.target.value)}>
                  <option value="short">Short (about 200 words)</option>
                  <option value="standard">Standard (about 300 words)</option>
                  <option value="detailed">Detailed (about 400 words)</option>
                </select>
              </div>
            </div>
            <div>
              <label className={label} htmlFor="letter-notes">Anything else to mention?</label>
              <textarea id="letter-notes" rows={3} className={field} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="e.g. I can start in June, or why this company matters to me" />
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            <h3 className="text-lg font-semibold">Review your letter</h3>
            <textarea
              aria-label="Cover letter. Edit it here, or select part of it to have it rewritten."
              rows={16}
              className={`${field} leading-relaxed`}
              value={letter}
              readOnly={partBusy}
              onChange={(event) => setLetter(event.target.value)}
              onSelect={(event) => {
                const box = event.currentTarget;
                const chosen = box.value.slice(box.selectionStart, box.selectionEnd);
                if (chosen.trim().length >= 12) setPart(chosen);
              }}
            />
            {part && (
              <div className="flex flex-col gap-2 rounded-xl border border-dashed border-line p-3 text-sm" role="group" aria-label="Change the selected part">
                <p className="m-0 truncate text-xs text-muted">Selected: “{part.trim().slice(0, 90)}{part.trim().length > 90 ? "…" : ""}”</p>
                <div className="flex flex-wrap gap-2">
                  {[["shorter", "Shorter"], ["specific", "More specific"], ["confident", "More confident"], ["rewrite", "Rewrite"]].map(([ask, label]) => (
                    <button key={ask} type="button" className={secondary} disabled={partBusy} onClick={() => void rewritePart(ask)}>{label}</button>
                  ))}
                  <button type="button" className="text-xs text-muted hover:text-white" onClick={() => setPart("")}>Cancel</button>
                </div>
                <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); void rewritePart(partAsk); }}>
                  <input className={field} value={partAsk} onChange={(event) => setPartAsk(event.target.value)} placeholder="Or say how: mention my internship…" maxLength={300} aria-label="How to change the selected part" />
                  <button type="submit" className={secondary} disabled={partBusy || !partAsk.trim()}>{partBusy ? "Rewriting…" : "Go"}</button>
                </form>
                {partError && <p role="alert" className="m-0 text-xs text-red-300">{partError}</p>}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="button" className={secondary} disabled={busy} onClick={() => void generate()}>{busy ? "Writing…" : "↻ Regenerate"}</button>
              <button type="button" className={secondary} onClick={() => void navigator.clipboard.writeText(letter).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}>{copied ? "Copied" : "Copy"}</button>
              <button type="button" className={secondary} onClick={download}>Download .txt</button>
            </div>
            <p className="text-xs text-muted">Check every claim before you send it. The letter only uses your profile and resume, but always read it over.</p>
          </div>
        )}

        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        <div className="flex justify-between border-t border-line pt-4">
          <button className={secondary} disabled={step === 0} onClick={() => setStep((current) => Math.max(0, current - 1))}>← Back</button>
          {step < 2 ? (
            <button className={primary} disabled={step === 0 && !jobReady} onClick={() => setStep((current) => current + 1)}>Continue →</button>
          ) : step === 2 ? (
            <button className={primary} disabled={busy || !jobReady} onClick={() => void generate()}>{busy ? "Writing…" : "✦ Write my letter"}</button>
          ) : (
            <button className={primary} onClick={onClose}>Done</button>
          )}
        </div>
      </div>
    </div>
  );
}
