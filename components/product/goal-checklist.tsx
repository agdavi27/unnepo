"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";

type Goals = { roles: string[]; locations: string[]; industries: string[]; companies: string[]; tracks?: string[]; timing?: string } | null;

const TRACKS = ["Internship", "Full-time"];
const TIMINGS = ["As soon as possible", "Summer 2026", "Fall 2026", "2027"];

export function GoalChecklist({
  resumeName,
  suggestions,
  goals,
  onUpdated,
}: {
  resumeName: string | null;
  suggestions: string[];
  goals: Goals;
  onUpdated: () => void;
}) {
  const [selected, setSelected] = useState<string[]>(goals?.roles ?? []);
  const [custom, setCustom] = useState("");
  const [location, setLocation] = useState(goals?.locations?.[0] ?? "");
  const [tracks, setTracks] = useState<string[]>(goals?.tracks ?? []);
  const [timing, setTiming] = useState(goals?.timing ?? "");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSelected(goals?.roles ?? []);
    setLocation(goals?.locations?.[0] ?? "");
    setTracks(goals?.tracks ?? []);
    setTiming(goals?.timing ?? "");
  }, [goals]);

  const bubbles = [...new Set([...(goals?.roles ?? []), ...suggestions])];
  const resumeDone = Boolean(resumeName);
  const rolesDone = selected.length > 0;
  const questionsDone = Boolean(location.trim()) && tracks.length > 0;

  function toggleRole(role: string) {
    setSelected((current) => (current.includes(role) ? current.filter((item) => item !== role) : [...current, role]));
  }

  function addCustom() {
    const role = custom.trim();
    if (!role) return;
    setSelected((current) => (current.includes(role) ? current : [...current, role]));
    setCustom("");
  }

  async function upload(file: File) {
    setBusy(true);
    setMessage("");
    const body = new FormData();
    body.set("file", file);
    const response = await fetch("/api/resume", { method: "POST", body });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) return setMessage(data.error || "Could not read that resume.");
    setMessage("Resume read. Role suggestions now follow it.");
    onUpdated();
  }

  async function save() {
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/goals", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roles: selected,
        locations: location.trim() ? [location.trim()] : [],
        industries: goals?.industries ?? [],
        companies: goals?.companies ?? [],
        tracks,
        timing,
      }),
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) return setMessage(data.error || "Could not save.");
    setMessage("Saved. Job postings use these roles.");
    onUpdated();
  }

  return (
    <section className="rounded-2xl border border-line bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">What are you looking for?</h2>
          <p className="text-sm text-muted">Answer these and the role bubbles follow your resume.</p>
        </div>
        <p className="text-sm text-faint">{[resumeDone, rolesDone, questionsDone].filter(Boolean).length} / 3</p>
      </div>

      <ol className="mt-4 space-y-4">
        <li className="rounded-xl border border-line bg-panel p-3">
          <Row done={resumeDone} label="Upload your resume" />
          <p className="mt-1 text-sm text-faint">{resumeName || "PDF or DOCX. We only use lines that are actually on it."}</p>
          <label className="mt-3 inline-flex cursor-pointer rounded-lg border border-line px-3 py-2 text-sm">
            {resumeName ? "Replace resume" : "Choose file"}
            <input type="file" accept=".pdf,.docx,application/pdf" className="hidden" onChange={(event) => event.target.files?.[0] && upload(event.target.files[0])} />
          </label>
        </li>

        <li className="rounded-xl border border-line bg-panel p-3">
          <Row done={rolesDone} label="Roles you want" />
          <div className="mt-3 flex flex-wrap gap-2">
            {bubbles.map((role) => {
              const on = selected.includes(role);
              return (
                <button key={role} type="button" onClick={() => toggleRole(role)} className={`rounded-full px-3 py-1.5 text-sm ${on ? "bg-white font-semibold text-black" : "border border-line text-muted hover:text-white"}`}>
                  {role}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex gap-2">
            <input value={custom} onChange={(event) => setCustom(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addCustom(); } }} placeholder="Add a role" className="field" />
            <button type="button" onClick={addCustom} className="rounded-xl border border-line px-3 text-sm">Add</button>
          </div>
        </li>

        <li className="rounded-xl border border-line bg-panel p-3">
          <Row done={questionsDone} label="A few questions" />
          <label className="mt-3 block text-sm text-muted">
            Where do you want to work?
            <input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="New York, NY" className="field mt-1" />
          </label>
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
        </li>
      </ol>

      {message ? <p className="mt-3 text-sm text-cream">{message}</p> : null}
      <button type="button" onClick={save} disabled={busy} className="mt-4 h-11 rounded-xl bg-white px-4 text-sm font-semibold text-black disabled:opacity-60">
        {busy ? "Saving…" : "Save answers"}
      </button>
    </section>
  );
}

function Row({ done, label }: { done: boolean; label: string }) {
  return (
    <p className="flex items-center gap-2 font-medium">
      <span className={`flex h-5 w-5 items-center justify-center rounded-full ${done ? "bg-white text-black" : "border border-line text-transparent"}`}>
        <Check className="h-3 w-3" />
      </span>
      {label}
    </p>
  );
}
