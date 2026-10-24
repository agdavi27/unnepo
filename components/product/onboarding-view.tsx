"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SCHOOLS } from "@/lib/schools";

const STEPS = ["profile", "goals", "resume", "mailbox"] as const;

export function OnboardingView() {
  const router = useRouter();
  const [step, setStep] = useState<(typeof STEPS)[number]>("profile");
  const [message, setMessage] = useState("");
  const [profile, setProfile] = useState({ name: "", school: "Colby College", major: "", graduationYear: "2027", bio: "" });
  const [goals, setGoals] = useState({ roles: "Marketing", industries: "Outdoor / Apparel", locations: "New York, NY", companies: "Patagonia" });

  async function saveProfile() {
    const response = await fetch("/api/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...profile, onboardingStep: "goals" }) });
    const data = await response.json();
    if (!response.ok) return setMessage(data.error);
    setStep("goals");
  }

  async function saveGoals() {
    const response = await fetch("/api/goals", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roles: split(goals.roles),
        industries: split(goals.industries),
        locations: split(goals.locations),
        companies: split(goals.companies),
        onboardingStep: "resume",
      }),
    });
    const data = await response.json();
    if (!response.ok) return setMessage(data.error);
    setStep("resume");
  }

  async function upload(file: File) {
    const body = new FormData();
    body.set("file", file);
    const response = await fetch("/api/resume", { method: "POST", body });
    const data = await response.json();
    if (!response.ok) return setMessage(data.error);
    setMessage(`Saved ${data.facts.length} facts from ${data.resume.fileName}.`);
    setStep("mailbox");
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <p className="text-sm text-faint">Step {STEPS.indexOf(step) + 1} of {STEPS.length}</p>
      <h1 className="mt-2 text-3xl font-semibold">Set up Unnepo</h1>
      <p className="mt-2 text-muted">You can leave and come back. Credits are already on your account after your school email is verified.</p>
      {message ? <p className="mt-3 text-sm text-cream">{message}</p> : null}
      {step === "profile" ? (
        <div className="mt-6 space-y-3">
          <input className="field" placeholder="Name" value={profile.name} onChange={(event) => setProfile({ ...profile, name: event.target.value })} />
          <select className="field" value={profile.school} onChange={(event) => setProfile({ ...profile, school: event.target.value })}>{SCHOOLS.map((school) => <option key={school}>{school}</option>)}</select>
          <input className="field" placeholder="Major" value={profile.major} onChange={(event) => setProfile({ ...profile, major: event.target.value })} />
          <input className="field" placeholder="Graduation year" value={profile.graduationYear} onChange={(event) => setProfile({ ...profile, graduationYear: event.target.value })} />
          <textarea className="field h-24" placeholder="Short bio" value={profile.bio} onChange={(event) => setProfile({ ...profile, bio: event.target.value })} />
          <button onClick={saveProfile} className="rounded-xl bg-white px-4 py-2 font-semibold text-black">Continue</button>
        </div>
      ) : null}
      {step === "goals" ? (
        <div className="mt-6 space-y-3">
          <input className="field" placeholder="Roles, comma separated" value={goals.roles} onChange={(event) => setGoals({ ...goals, roles: event.target.value })} />
          <input className="field" placeholder="Industries" value={goals.industries} onChange={(event) => setGoals({ ...goals, industries: event.target.value })} />
          <input className="field" placeholder="Locations" value={goals.locations} onChange={(event) => setGoals({ ...goals, locations: event.target.value })} />
          <input className="field" placeholder="Companies" value={goals.companies} onChange={(event) => setGoals({ ...goals, companies: event.target.value })} />
          <button onClick={saveGoals} className="rounded-xl bg-white px-4 py-2 font-semibold text-black">Continue</button>
        </div>
      ) : null}
      {step === "resume" ? (
        <label className="mt-6 block rounded-2xl border border-dashed border-line p-8 text-center">
          Upload a PDF or DOCX resume
          <input type="file" accept=".pdf,.docx" className="mt-3 block w-full text-sm" onChange={(event) => event.target.files?.[0] && upload(event.target.files[0])} />
          <button onClick={() => setStep("mailbox")} className="mt-4 text-sm text-muted">Skip for now</button>
        </label>
      ) : null}
      {step === "mailbox" ? (
        <div className="mt-6 space-y-3">
          <a href="/api/oauth/gmail" className="block rounded-xl bg-white px-4 py-3 text-center font-semibold text-black">Connect Gmail</a>
          <a href="/api/oauth/outlook" className="block rounded-xl border border-line px-4 py-3 text-center">Connect Outlook</a>
          <button onClick={() => router.push("/home")} className="text-sm text-muted">Finish without a mailbox</button>
        </div>
      ) : null}
    </div>
  );
}

function split(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}
