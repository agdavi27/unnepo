"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LOCATIONS } from "@/lib/catalog";
import { PageLoading } from "@/components/product/bits";

const STEPS = ["resume", "interests", "roles", "location", "employment", "timing", "contacts", "networking", "extra", "story"] as const;
type StepId = (typeof STEPS)[number];

const INTERESTS = ["Technology / AI", "Finance", "Consulting", "Marketing", "Sales", "Music / Entertainment", "Sports", "Outdoor / Adventure", "Fashion", "Consumer Products", "Healthcare", "Startups"];
const ROLES = ["Software Engineering", "Marketing", "eCommerce", "Sales", "Product Management", "Finance", "Consulting", "Operations", "Design", "Data Analytics"];
const EMPLOYMENT = ["Internship", "Full-time", "Part-time", "Contract", "Freelance", "Open to anything"];
const STARTS = ["Immediately", "Within one month", "Summer 2027", "After graduation", "Flexible"];
const PEOPLE = ["Recruiters", "Hiring managers", "Employees in desired roles", "Alumni", "Founders", "Executives", "Anyone relevant"];
const GOALS = ["Informational interviews", "Referrals", "Internships", "Full-time opportunities", "Career advice", "Mentorship", "General networking"];
const STORIES = ["I knew someone.", "I applied to 400 jobs and developed character.", "My dad knows a guy.", "I'm still waiting for one.", "That's literally why I'm here."];
const MODES = ["Remote", "Hybrid", "In-person"];

const FROM_OLD: Record<string, StepId> = {
  profile: "resume",
  goals: "interests",
  resume: "resume",
  interests: "interests",
  roles: "roles",
  location: "location",
  employment: "employment",
  timing: "timing",
  contacts: "contacts",
  networking: "networking",
  extra: "extra",
  story: "story",
};

export function OnboardingView() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [step, setStep] = useState<StepId>("resume");
  const [message, setMessage] = useState("");
  const [custom, setCustom] = useState("");
  const [resumeName, setResumeName] = useState<string | null>(null);
  const [interests, setInterests] = useState<string[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [workModes, setWorkModes] = useState<string[]>([]);
  const [relocate, setRelocate] = useState(false);
  const [tracks, setTracks] = useState<string[]>([]);
  const [timing, setTiming] = useState("");
  const [contactTypes, setContactTypes] = useState<string[]>([]);
  const [networkingGoals, setNetworkingGoals] = useState<string[]>([]);
  const [extraNote, setExtraNote] = useState("");
  const [originStory, setOriginStory] = useState("");

  useEffect(() => {
    fetch("/api/dashboard")
      .then((response) => response.json())
      .then((data) => {
        const saved = data.goals;
        if (saved) {
          setInterests(saved.industries ?? []);
          setRoles(saved.roles ?? []);
          setLocations((saved.locations ?? []).filter((place: string) => !MODES.includes(place)));
          setWorkModes(saved.workModes ?? []);
          setRelocate(Boolean(saved.relocate));
          setTracks(saved.tracks ?? []);
          setTiming(saved.timing ?? "");
          setContactTypes(saved.contactTypes ?? []);
          setNetworkingGoals(saved.networkingGoals ?? []);
          setExtraNote(saved.extraNote ?? "");
          setOriginStory(saved.originStory ?? "");
        }
        if (data.resume?.fileName) setResumeName(data.resume.fileName);
        const current = FROM_OLD[data.user?.onboardingStep] || "resume";
        setStep(current);
      })
      .finally(() => setReady(true));
  }, []);

  const index = STEPS.indexOf(step);
  const progress = ((index + 1) / STEPS.length) * 100;

  async function persist(next: StepId | "done", patch: Record<string, unknown> = {}) {
    const response = await fetch("/api/goals", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roles,
        industries: interests,
        locations,
        tracks,
        timing,
        workModes,
        relocate,
        contactTypes,
        networkingGoals,
        extraNote,
        originStory,
        onboardingStep: next,
        ...patch,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.error || "Could not save that answer.");
      return false;
    }
    return true;
  }

  async function go(nextIndex: number) {
    if (nextIndex < 0) return;
    if (nextIndex >= STEPS.length) {
      const ok = await persist("done");
      if (ok) router.push("/home");
      return;
    }
    const next = STEPS[nextIndex];
    const ok = await persist(next);
    if (ok) setStep(next);
  }

  async function upload(file: File) {
    const body = new FormData();
    body.set("file", file);
    const response = await fetch("/api/resume", { method: "POST", body });
    const data = await response.json();
    if (!response.ok) return setMessage(data.error || "Could not read that file.");
    setResumeName(data.resume.fileName);
    setMessage(`Saved ${data.facts.length} lines from the resume. Nothing was added that was not written there.`);
  }

  function toggle(list: string[], value: string, setList: (values: string[]) => void) {
    setList(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  }

  if (!ready) return <PageLoading label="Loading your setup…" />;

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col px-4 py-8">
      <p className="text-sm text-faint">Question {index + 1} of {STEPS.length}</p>
      <h1 className="mt-2 text-3xl font-semibold">
        {step === "resume" ? "Upload your resume" : null}
        {step === "interests" ? "What industries or topics are you interested in?" : null}
        {step === "roles" ? "What kind of work are you looking for?" : null}
        {step === "location" ? "Where would you like to work?" : null}
        {step === "employment" ? "What kind of role?" : null}
        {step === "timing" ? "When do you want to start?" : null}
        {step === "contacts" ? "Who would you like to connect with?" : null}
        {step === "networking" ? "What are you hoping to get from a conversation?" : null}
        {step === "extra" ? "Anything else we should know?" : null}
        {step === "story" ? "How did you get your last opportunity?" : null}
      </h1>
      {message ? <p className="mt-3 text-sm text-cream">{message}</p> : null}
      <div className="mt-6 flex-1">
        {step === "resume" ? (
          <label className="block rounded-2xl border border-dashed border-line p-8 text-center">
            {resumeName ? <p className="mb-3 text-sm">{resumeName}</p> : <p className="mb-3 text-sm text-muted">PDF or DOCX. We only keep lines that are actually on the file.</p>}
            <input type="file" accept=".pdf,.docx" className="block w-full text-sm" onChange={(event) => event.target.files?.[0] && upload(event.target.files[0])} />
          </label>
        ) : null}
        {step === "interests" ? <Choices options={INTERESTS} selected={interests} onToggle={(value) => toggle(interests, value, setInterests)} custom={custom} setCustom={setCustom} onAdd={() => addCustom(custom, interests, setInterests, setCustom)} /> : null}
        {step === "roles" ? <Choices options={ROLES} selected={roles} onToggle={(value) => toggle(roles, value, setRoles)} custom={custom} setCustom={setCustom} onAdd={() => addCustom(custom, roles, setRoles, setCustom)} /> : null}
        {step === "location" ? (
          <div className="space-y-4">
            <Choices options={LOCATIONS.slice(0, 12)} selected={locations} onToggle={(value) => toggle(locations, value, setLocations)} custom={custom} setCustom={setCustom} onAdd={() => addCustom(custom, locations, setLocations, setCustom)} />
            <div className="flex flex-wrap gap-2">
              {MODES.map((mode) => (
                <button key={mode} type="button" onClick={() => toggle(workModes, mode, setWorkModes)} className={chip(workModes.includes(mode))}>{mode}</button>
              ))}
              <button type="button" onClick={() => setRelocate((value) => !value)} className={chip(relocate)}>Willing to relocate</button>
            </div>
          </div>
        ) : null}
        {step === "employment" ? <Choices options={EMPLOYMENT} selected={tracks} onToggle={(value) => toggle(tracks, value, setTracks)} /> : null}
        {step === "timing" ? (
          <div className="flex flex-wrap gap-2">
            {STARTS.map((option) => (
              <button key={option} type="button" onClick={() => setTiming(option)} className={chip(timing === option)}>{option}</button>
            ))}
            <input value={STARTS.includes(timing) ? "" : timing} onChange={(event) => setTiming(event.target.value)} placeholder="Custom date" className="rounded-full border border-line bg-transparent px-3 py-2 text-sm outline-none" />
          </div>
        ) : null}
        {step === "contacts" ? <Choices options={PEOPLE} selected={contactTypes} onToggle={(value) => toggle(contactTypes, value, setContactTypes)} /> : null}
        {step === "networking" ? <Choices options={GOALS} selected={networkingGoals} onToggle={(value) => toggle(networkingGoals, value, setNetworkingGoals)} /> : null}
        {step === "extra" ? <textarea value={extraNote} onChange={(event) => setExtraNote(event.target.value)} placeholder="Optional. Your dream job, a constraint, a company you care about." className="h-36 w-full rounded-2xl border border-line bg-transparent px-3 py-2 text-sm outline-none" /> : null}
        {step === "story" ? (
          <div className="space-y-2">
            <p className="text-sm text-muted">Optional. This does not change who we search for.</p>
            <div className="flex flex-wrap gap-2">
              {STORIES.map((option) => (
                <button key={option} type="button" onClick={() => setOriginStory(option)} className={chip(originStory === option)}>{option}</button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <div className="mt-8">
        <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800"><div className="h-full bg-white" style={{ width: `${progress}%` }} /></div>
        <div className="mt-4 flex items-center justify-between">
          <button type="button" onClick={() => index > 0 && setStep(STEPS[index - 1])} disabled={index === 0} className="text-sm text-muted disabled:opacity-40">Back</button>
          <div className="flex gap-2">
            {step !== "roles" && step !== "interests" ? <button type="button" onClick={() => go(index + 1)} className="rounded-xl border border-line px-4 py-2 text-sm">Skip</button> : null}
            <button type="button" onClick={() => go(index + 1)} className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black">{index === STEPS.length - 1 ? "Finish" : "Next"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Choices({ options, selected, onToggle, custom, setCustom, onAdd }: { options: string[]; selected: string[]; onToggle: (value: string) => void; custom?: string; setCustom?: (value: string) => void; onAdd?: () => void }) {
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button key={option} type="button" onClick={() => onToggle(option)} className={chip(selected.includes(option))}>{option}</button>
        ))}
      </div>
      {onAdd && setCustom ? (
        <div className="mt-4 flex gap-2">
          <input value={custom} onChange={(event) => setCustom(event.target.value)} placeholder="Add your own" className="flex-1 rounded-xl border border-line bg-transparent px-3 py-2 text-sm outline-none" />
          <button type="button" onClick={onAdd} className="rounded-xl border border-line px-3 text-sm">Add</button>
        </div>
      ) : null}
    </div>
  );
}

function chip(on: boolean) {
  return `rounded-full border px-3 py-2 text-sm ${on ? "border-white bg-white text-black" : "border-line text-muted"}`;
}

function addCustom(value: string, list: string[], setList: (values: string[]) => void, setCustom: (value: string) => void) {
  const next = value.trim();
  if (!next || list.some((item) => item.toLowerCase() === next.toLowerCase())) return;
  setList([...list, next]);
  setCustom("");
}
