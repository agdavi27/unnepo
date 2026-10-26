"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { ResumeFile } from "@/components/product/bits";

type Goals = { roles: string[]; locations: string[]; industries: string[]; companies: string[]; tracks?: string[]; timing?: string } | null;
type Suggestions = { fromResume: string[]; similar: string[] };

const TRACKS = ["Internship", "Full-time"];
const TIMINGS = ["As soon as possible", "Summer 2026", "Fall 2026", "2027"];

export function GoalChecklist({
  resumeName,
  suggestions,
  goals,
  onUpdated,
}: {
  resumeName: string | null;
  suggestions: Suggestions;
  goals: Goals;
  onUpdated: () => void;
}) {
  const [selected, setSelected] = useState<string[]>(goals?.roles ?? []);
  const [custom, setCustom] = useState("");
  const [location, setLocation] = useState(cityFrom(goals?.locations));
  const [remote, setRemote] = useState(hasRemote(goals?.locations));
  const [tracks, setTracks] = useState<string[]>(goals?.tracks ?? []);
  const [timing, setTiming] = useState(goals?.timing ?? "");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [pickedName, setPickedName] = useState("");

  useEffect(() => {
    setSelected(goals?.roles ?? []);
    setLocation(cityFrom(goals?.locations));
    setRemote(hasRemote(goals?.locations));
    setTracks(goals?.tracks ?? []);
    setTiming(goals?.timing ?? "");
  }, [goals]);

  const resumeDone = Boolean(resumeName);
  const rolesDone = (goals?.roles.length ?? 0) > 0;
  const questionsDone = Boolean((goals?.locations ?? []).some((place) => place.trim())) && (goals?.tracks?.length ?? 0) > 0;
  const phase = !resumeDone ? "resume" : !rolesDone ? "roles" : !questionsDone ? "questions" : "done";
  const step = phase === "resume" ? 1 : phase === "roles" ? 2 : 3;

  function toggleRole(role: string) {
    setSelected((current) => (current.includes(role) ? current.filter((item) => item !== role) : [...current, role]));
  }

  function addCustom() {
    const role = custom.trim();
    if (!role) return;
    setSelected((current) => (current.includes(role) ? current : [...current, role]));
    setCustom("");
  }

  function places() {
    return [location.trim(), remote ? "Remote" : ""].filter(Boolean);
  }

  async function saveGoals(next: { roles: string[]; locations: string[]; tracks: string[]; timing: string }) {
    const response = await fetch("/api/goals", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roles: next.roles,
        locations: next.locations,
        industries: goals?.industries ?? [],
        companies: goals?.companies ?? [],
        tracks: next.tracks,
        timing: next.timing,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not save.");
  }

  async function upload(file: File) {
    setPickedName(file.name);
    setBusy(true);
    setMessage("");
    const body = new FormData();
    body.set("file", file);
    const response = await fetch("/api/resume", { method: "POST", body });
    const data = await response.json();
    if (!response.ok) {
      setBusy(false);
      setMessage(data.error || "Could not read that resume.");
      return;
    }
    try {
      await saveGoals({ roles: [], locations: [], tracks: [], timing: "" });
    } catch (error) {
      setBusy(false);
      setMessage(error instanceof Error ? error.message : "Could not reset your answers.");
      return;
    }
    setSelected([]);
    setLocation("");
    setRemote(false);
    setTracks([]);
    setTiming("");
    setCustom("");
    setBusy(false);
    setMessage("New resume saved. Pick roles that match it.");
    onUpdated();
  }

  async function continueRoles() {
    if (!selected.length) return setMessage("Pick at least one role.");
    setBusy(true);
    setMessage("");
    try {
      await saveGoals({ roles: selected, locations: [], tracks: [], timing: "" });
    } catch (error) {
      setBusy(false);
      setMessage(error instanceof Error ? error.message : "Could not save.");
      return;
    }
    setBusy(false);
    onUpdated();
  }

  async function continueQuestions() {
    const nextPlaces = places();
    if (!nextPlaces.length || !tracks.length) return setMessage("Add a city or choose Remote, and choose internship, full-time, or both.");
    setBusy(true);
    setMessage("");
    try {
      await saveGoals({ roles: goals?.roles ?? selected, locations: nextPlaces, tracks, timing });
    } catch (error) {
      setBusy(false);
      setMessage(error instanceof Error ? error.message : "Could not save.");
      return;
    }
    setBusy(false);
    setMessage("Saved. Job postings use these answers.");
    onUpdated();
  }

  return (
    <section className="rounded-2xl border border-line bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">What are you looking for?</h2>
          <p className="text-sm text-muted">{phase === "done" ? "Your search is set. Upload a new resume to answer again." : "One step at a time. The next one shows up when this one is done."}</p>
        </div>
        <p className="text-sm text-faint">{phase === "done" ? "3 / 3" : `${step} / 3`}</p>
      </div>

      <div className="mt-4 space-y-3">
        {phase !== "resume" ? <DoneRow label="Resume uploaded" detail={resumeName || ""} file /> : null}
        {phase === "questions" || phase === "done" ? <DoneRow label="Roles you want" detail={(goals?.roles ?? []).join(", ")} /> : null}
        {phase === "done" ? <DoneRow label="A few questions" detail={[...(goals?.locations ?? []), (goals?.tracks ?? []).join(" · "), goals?.timing].filter(Boolean).join(" · ")} /> : null}

        {phase === "resume" ? (
          <Step title="Upload your resume">
            <p className="text-sm text-faint">PDF or DOCX. Roles on the next step come from this file.</p>
            {pickedName ? <div className="mt-3"><ResumeFile name={pickedName} /></div> : null}
            <FileButton label="Choose file" busy={busy} onFile={upload} />
          </Step>
        ) : null}

        {phase === "roles" ? (
          <Step title="Roles you want">
            <BubbleGroup label="From your resume" roles={suggestions.fromResume} selected={selected} onToggle={toggleRole} />
            <BubbleGroup label="Similar roles you might want" roles={suggestions.similar} selected={selected} onToggle={toggleRole} />
            {!suggestions.fromResume.length && !suggestions.similar.length ? <p className="text-sm text-faint">Nothing on the resume looked like a job title. Add the roles you want.</p> : null}
            <div className="mt-3 flex gap-2">
              <input value={custom} onChange={(event) => setCustom(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addCustom(); } }} placeholder="Add a role" className="field" />
              <button type="button" onClick={addCustom} className="rounded-xl border border-line px-3 text-sm">Add</button>
            </div>
            <button type="button" onClick={continueRoles} disabled={busy} className="mt-4 h-11 rounded-xl bg-white px-4 text-sm font-semibold text-black disabled:opacity-60">{busy ? "Saving…" : "Continue"}</button>
          </Step>
        ) : null}

        {phase === "questions" ? (
          <Step title="A few questions">
            <p className="text-sm text-muted">Where do you want to work?</p>
            <div className="mt-1 flex flex-col gap-2 sm:flex-row">
              <input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="New York, NY" className="field" />
              <button type="button" onClick={() => setRemote((on) => !on)} className={`h-11 shrink-0 rounded-xl px-4 text-sm ${remote ? "bg-white font-semibold text-black" : "border border-line text-muted"}`}>Remote</button>
            </div>
            <p className="mt-3 text-sm text-muted">Internship, full-time, or both?</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {TRACKS.map((track) => {
                const on = tracks.includes(track);
                return (
                  <button key={track} type="button" onClick={() => setTracks((current) => (on ? current.filter((item) => item !== track) : [...current, track]))} className={`rounded-full px-3 py-1.5 text-sm ${on ? "bg-[#3D8BFF] font-semibold text-white" : "border border-line text-muted"}`}>
                    {track}
                  </button>
                );
              })}
            </div>
            <label className="mt-3 block text-sm text-muted">
              When do you want to start?
              <select value={timing} onChange={(event) => setTiming(event.target.value)} className="field mt-1">
                <option value="">Choose one</option>
                {TIMINGS.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <button type="button" onClick={continueQuestions} disabled={busy} className="mt-4 h-11 rounded-xl bg-white px-4 text-sm font-semibold text-black disabled:opacity-60">{busy ? "Saving…" : "Continue"}</button>
          </Step>
        ) : null}

        {phase === "done" ? (
          <div className="rounded-xl border border-dashed border-line p-3">
            <p className="text-sm text-muted">Uploading a new resume clears these answers and starts the questions again.</p>
            <FileButton label="Upload a new resume" busy={busy} onFile={upload} />
          </div>
        ) : null}
      </div>
      {message ? <p className="mt-3 text-sm text-cream">{message}</p> : null}
    </section>
  );
}

function Step({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-panel p-3">
      <p className="font-medium">{title}</p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function DoneRow({ label, detail, file = false }: { label: string; detail: string; file?: boolean }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-line px-3 py-2 text-sm">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white text-black"><Check className="h-3 w-3" /></span>
      <span className="min-w-0 flex-1">
        <span className="font-medium">{label}</span>
        {file && detail ? <span className="mt-2 block"><ResumeFile name={detail} /></span> : detail ? <span className="mt-0.5 block text-faint">{detail}</span> : null}
      </span>
    </div>
  );
}

function cityFrom(locations: string[] | undefined) {
  return (locations ?? []).find((place) => place.trim() && !/^remote$/i.test(place)) ?? "";
}

function hasRemote(locations: string[] | undefined) {
  return (locations ?? []).some((place) => /^remote$/i.test(place.trim()));
}

function BubbleGroup({ label, roles, selected, onToggle }: { label: string; roles: string[]; selected: string[]; onToggle: (role: string) => void }) {
  if (!roles.length) return null;
  return (
    <div className="mt-3">
      <p className="text-xs font-semibold tracking-[0.14em] text-faint">{label}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {roles.map((role) => {
          const on = selected.includes(role);
          return (
            <button key={role} type="button" onClick={() => onToggle(role)} className={`rounded-full px-3 py-1.5 text-sm ${on ? "bg-white font-semibold text-black" : "border border-line text-muted hover:text-white"}`}>
              {role}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function FileButton({ label, busy, onFile }: { label: string; busy: boolean; onFile: (file: File) => void }) {
  return (
    <label className={`mt-3 inline-flex cursor-pointer rounded-lg border border-line px-3 py-2 text-sm ${busy ? "opacity-60" : ""}`}>
      {label}
      <input type="file" accept=".pdf,.docx,application/pdf" className="hidden" disabled={busy} onChange={(event) => event.target.files?.[0] && onFile(event.target.files[0])} />
    </label>
  );
}
