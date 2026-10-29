"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { EEO_OPTIONS, type Education, type Experience, type GapId, type Project, type StudentProfile } from "@/lib/profile/student";

/**
 * Resume-first onboarding: upload a resume, confirm what Unnepo read, then answer only what's missing,
 * one short card at a time. The same screens edit the profile later from Settings.
 */

type Gap = { id: GapId; title: string; why: string; optional: boolean };
type State = { profile: StudentProfile; missing: Gap[]; ready: boolean; resume: { id: string; fileName: string } | null; extensionUrl: string | null };

const btn = "inline-flex min-h-11 items-center justify-center gap-2 rounded-[10px] px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40";
const primary = `${btn} bg-white text-black hover:bg-zinc-200`;
const secondary = `${btn} border border-[#26262C] text-ink hover:bg-white/5`;
const input = "w-full rounded-[10px] border border-[#26262C] bg-[#0C0C0E] px-3 py-2.5 text-sm text-ink outline-none placeholder:text-faint focus:border-zinc-500";
const label = "mb-1.5 block text-xs font-medium text-[#9A9AA3]";
const eyebrow = "font-mono text-[11px] uppercase tracking-[1.2px] text-[#8B8B94]";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/profile${path}`, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Something went wrong (${response.status}).`);
  return body as T;
}

function Progress({ value }: { value: number }) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs text-[#9A9AA3]"><span>Profile {value}% ready</span></div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#17171B]" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} aria-label="Profile completeness">
        <div className="h-full bg-[#3D8BFF] transition-[width]" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function FromResume({ show }: { show: boolean }) {
  return show ? <span className="ml-1.5 rounded border border-[#1F1F24] px-1 py-px font-mono text-[10px] uppercase tracking-wide text-[#8B8B94]">from your resume</span> : null;
}

function Text({ title, value, onChange, placeholder, tag = false, type = "text" }: { title: string; value: string | undefined; onChange: (value: string) => void; placeholder?: string; tag?: boolean; type?: string }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className={label}>{title}<FromResume show={tag} /></label>
      <input id={id} type={type} className={input} value={value ?? ""} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function Area({ title, value, onChange, placeholder, tag = false }: { title: string; value: string | undefined; onChange: (value: string) => void; placeholder?: string; tag?: boolean }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className={label}>{title}<FromResume show={tag} /></label>
      <textarea id={id} className={`${input} min-h-24`} value={value ?? ""} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function Choice<T extends string | boolean | null>({ title, value, options, onChange }: { title: string; value: T | undefined; options: Array<[T, string]>; onChange: (value: T) => void }) {
  return (
    <fieldset>
      <legend className={label}>{title}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map(([option, text]) => (
          <button key={String(option)} type="button" aria-pressed={value === option} onClick={() => onChange(option)} className={`min-h-10 rounded-full border px-3.5 text-sm ${value === option ? "border-white bg-white text-black" : "border-[#26262C] text-[#B4B4BC] hover:border-zinc-500"}`}>{text}</button>
        ))}
      </div>
    </fieldset>
  );
}

const YES_NO: Array<[boolean, string]> = [[true, "Yes"], [false, "No"]];
const lines = (values: string[] | undefined) => (values ?? []).join("\n");
const fromLines = (value: string) => value.split("\n").map((item) => item.trim()).filter(Boolean);
const commas = (values: string[] | undefined) => (values ?? []).join(", ");
const fromCommas = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean);

/** Contact, links, education, experience, projects, and skills: every value editable. */
function Sections({ profile, set }: { profile: StudentProfile; set: (next: StudentProfile) => void }) {
  const tag = (path: string) => profile.sources[path] === "resume";
  const contact = (key: keyof StudentProfile["contact"]) => (value: string) => set({ ...profile, contact: { ...profile.contact, [key]: value } });
  const link = (key: "linkedin" | "github" | "portfolio") => (value: string) => set({ ...profile, links: { ...profile.links, [key]: value } });
  const updateList = <K extends "education" | "experience" | "projects">(key: K, index: number, patch: Partial<StudentProfile[K][number]>) =>
    set({ ...profile, [key]: profile[key].map((item, i) => (i === index ? { ...item, ...patch } : item)) });
  const removeAt = (key: "education" | "experience" | "projects", index: number) => set({ ...profile, [key]: profile[key].filter((_, i) => i !== index) });
  const section = "space-y-4 border-t border-[#17171B] pt-6";
  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <h3 className={eyebrow}>Contact</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Text title="First name" value={profile.contact.firstName} onChange={contact("firstName")} tag={tag("contact.firstName")} />
          <Text title="Last name" value={profile.contact.lastName} onChange={contact("lastName")} tag={tag("contact.lastName")} />
          <Text title="Preferred name (optional)" value={profile.contact.preferredName} onChange={contact("preferredName")} />
          <Text title="Email" type="email" value={profile.contact.email} onChange={contact("email")} tag={tag("contact.email")} />
          <Text title="Phone" type="tel" value={profile.contact.phone} onChange={contact("phone")} tag={tag("contact.phone")} />
          <Text title="City" value={profile.contact.city} onChange={contact("city")} tag={tag("contact.city")} />
          <Text title="State" value={profile.contact.state} onChange={contact("state")} placeholder="e.g. Maine" tag={tag("contact.state")} />
          <Text title="ZIP code" value={profile.contact.zip} onChange={contact("zip")} tag={tag("contact.zip")} />
          <Text title="Country" value={profile.contact.country} onChange={contact("country")} placeholder="e.g. United States" tag={tag("contact.country")} />
        </div>
      </section>
      <section className={section}>
        <h3 className={eyebrow}>Links</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <Text title="LinkedIn" value={profile.links.linkedin} onChange={link("linkedin")} tag={tag("links.linkedin")} />
          <Text title="GitHub" value={profile.links.github} onChange={link("github")} tag={tag("links.github")} />
          <Text title="Portfolio" value={profile.links.portfolio} onChange={link("portfolio")} tag={tag("links.portfolio")} />
        </div>
      </section>
      <section className={section}>
        <div className="flex items-center justify-between"><h3 className={eyebrow}>Education</h3><button type="button" className="text-xs text-[#9A9AA3] hover:text-white" onClick={() => set({ ...profile, education: [...profile.education, { school: "", degree: "", major: "", gradDate: "" } as Education] })}>+ Add school</button></div>
        {profile.education.length === 0 && <p className="text-sm text-[#8B8B94]">No schools yet.</p>}
        {profile.education.map((item, i) => (
          <div key={i} className="grid gap-3 rounded-xl border border-[#17171B] p-4 sm:grid-cols-2">
            <Text title="School" value={item.school} onChange={(value) => updateList("education", i, { school: value })} tag={tag(`education.${i}.school`)} />
            <Text title="Degree" value={item.degree} onChange={(value) => updateList("education", i, { degree: value })} placeholder="e.g. B.A." tag={tag(`education.${i}.degree`)} />
            <Text title="Major" value={item.major} onChange={(value) => updateList("education", i, { major: value })} tag={tag(`education.${i}.major`)} />
            <Text title="Minor (optional)" value={item.minor} onChange={(value) => updateList("education", i, { minor: value })} tag={tag(`education.${i}.minor`)} />
            <Text title="Graduation (month and year)" value={item.gradDate} onChange={(value) => updateList("education", i, { gradDate: value })} placeholder="e.g. May 2027" tag={tag(`education.${i}.gradDate`)} />
            <Text title="GPA (optional)" value={item.gpa} onChange={(value) => updateList("education", i, { gpa: value })} tag={tag(`education.${i}.gpa`)} />
            <button type="button" className="justify-self-start text-xs text-[#8B8B94] hover:text-red-300" onClick={() => removeAt("education", i)}>Remove</button>
          </div>
        ))}
      </section>
      <section className={section}>
        <div className="flex items-center justify-between"><h3 className={eyebrow}>Experience</h3><button type="button" className="text-xs text-[#9A9AA3] hover:text-white" onClick={() => set({ ...profile, experience: [...profile.experience, { company: "", title: "", startDate: "", current: false, bullets: [] } as Experience] })}>+ Add job</button></div>
        {profile.experience.length === 0 && <p className="text-sm text-[#8B8B94]">No jobs yet. Internships, research, and campus jobs all count.</p>}
        {profile.experience.map((item, i) => (
          <div key={i} className="grid gap-3 rounded-xl border border-[#17171B] p-4 sm:grid-cols-2">
            <Text title="Title" value={item.title} onChange={(value) => updateList("experience", i, { title: value })} tag={tag(`experience.${i}.title`)} />
            <Text title="Company" value={item.company} onChange={(value) => updateList("experience", i, { company: value })} tag={tag(`experience.${i}.company`)} />
            <Text title="Start" value={item.startDate} onChange={(value) => updateList("experience", i, { startDate: value })} placeholder="e.g. May 2024" tag={tag(`experience.${i}.startDate`)} />
            <Text title="End" value={item.current ? "Present" : item.endDate} onChange={(value) => updateList("experience", i, { endDate: value, current: /present/i.test(value) })} placeholder="e.g. Aug 2024, or Present" tag={tag(`experience.${i}.endDate`)} />
            <div className="sm:col-span-2"><Area title="What you did (one per line)" value={lines(item.bullets)} onChange={(value) => updateList("experience", i, { bullets: fromLines(value) })} tag={tag(`experience.${i}.bullets`)} /></div>
            <button type="button" className="justify-self-start text-xs text-[#8B8B94] hover:text-red-300" onClick={() => removeAt("experience", i)}>Remove</button>
          </div>
        ))}
      </section>
      <section className={section}>
        <div className="flex items-center justify-between"><h3 className={eyebrow}>Projects</h3><button type="button" className="text-xs text-[#9A9AA3] hover:text-white" onClick={() => set({ ...profile, projects: [...profile.projects, { name: "", bullets: [] } as Project] })}>+ Add project</button></div>
        {profile.projects.length === 0 && <p className="text-sm text-[#8B8B94]">No projects yet.</p>}
        {profile.projects.map((item, i) => (
          <div key={i} className="grid gap-3 rounded-xl border border-[#17171B] p-4 sm:grid-cols-2">
            <Text title="Name" value={item.name} onChange={(value) => updateList("projects", i, { name: value })} tag={tag(`projects.${i}.name`)} />
            <Text title="Link (optional)" value={item.url} onChange={(value) => updateList("projects", i, { url: value })} tag={tag(`projects.${i}.url`)} />
            <div className="sm:col-span-2"><Area title="What you built (one per line)" value={lines(item.bullets)} onChange={(value) => updateList("projects", i, { bullets: fromLines(value) })} tag={tag(`projects.${i}.bullets`)} /></div>
            <div className="sm:col-span-2"><Text title="Tech (comma-separated)" value={commas(item.tech)} onChange={(value) => updateList("projects", i, { tech: fromCommas(value) })} tag={tag(`projects.${i}.tech`)} /></div>
            <button type="button" className="justify-self-start text-xs text-[#8B8B94] hover:text-red-300" onClick={() => removeAt("projects", i)}>Remove</button>
          </div>
        ))}
      </section>
      <section className={section}>
        <h3 className={eyebrow}>Skills</h3>
        <Text title="Technical skills (comma-separated)" value={commas(profile.skills.technical)} onChange={(value) => set({ ...profile, skills: { ...profile.skills, technical: fromCommas(value) } })} tag={tag("skills.technical")} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Text title="Languages you speak" value={commas(profile.skills.languages)} onChange={(value) => set({ ...profile, skills: { ...profile.skills, languages: fromCommas(value) } })} tag={tag("skills.languages")} />
          <Text title="Certifications" value={commas(profile.skills.certifications)} onChange={(value) => set({ ...profile, skills: { ...profile.skills, certifications: fromCommas(value) } })} tag={tag("skills.certifications")} />
        </div>
      </section>
    </div>
  );
}

/** One gap card's questions. */
function GapFields({ id, profile, set }: { id: GapId; profile: StudentProfile; set: (next: StudentProfile) => void }) {
  const p = profile;
  const school = p.education[0] ?? ({ school: "", degree: "", major: "", gradDate: "" } as Education);
  const setSchool = (patch: Partial<Education>) => set({ ...p, education: [{ ...school, ...patch }, ...p.education.slice(1)] });
  switch (id) {
    case "work_auth":
      return (
        <div className="space-y-5">
          <Choice title="Are you authorized to work in the United States?" value={p.workAuth.authorizedUS} options={YES_NO} onChange={(value) => set({ ...p, workAuth: { ...p.workAuth, authorizedUS: value } })} />
          <Choice title="Will you need visa sponsorship, now or in the future?" value={p.workAuth.needsSponsorship} options={YES_NO} onChange={(value) => set({ ...p, workAuth: { ...p.workAuth, needsSponsorship: value } })} />
          <Choice title="Are you 18 or older?" value={p.workAuth.over18} options={YES_NO} onChange={(value) => set({ ...p, workAuth: { ...p.workAuth, over18: value } })} />
        </div>
      );
    case "education":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          {!school.school.trim() && <div className="sm:col-span-2"><Text title="School" value={school.school} onChange={(value) => setSchool({ school: value })} /></div>}
          <Text title="Graduation (month and year)" value={school.gradDate} onChange={(value) => setSchool({ gradDate: value })} placeholder="e.g. May 2027" />
          <Text title="GPA (optional)" value={school.gpa} onChange={(value) => setSchool({ gpa: value })} placeholder="e.g. 3.6" />
        </div>
      );
    case "contact":
      return (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Text title="Phone" type="tel" value={p.contact.phone} onChange={(value) => set({ ...p, contact: { ...p.contact, phone: value } })} />
            <Text title="City" value={p.contact.city} onChange={(value) => set({ ...p, contact: { ...p.contact, city: value } })} />
            <Text title="State" value={p.contact.state} onChange={(value) => set({ ...p, contact: { ...p.contact, state: value } })} />
          </div>
          <Choice title="Willing to relocate?" value={p.contact.willingToRelocate ?? undefined} options={YES_NO} onChange={(value) => set({ ...p, contact: { ...p.contact, willingToRelocate: value } })} />
        </div>
      );
    case "links":
      return (
        <div className="grid gap-3 sm:grid-cols-3">
          <Text title="LinkedIn" value={p.links.linkedin} onChange={(value) => set({ ...p, links: { ...p.links, linkedin: value } })} placeholder="linkedin.com/in/…" />
          <Text title="GitHub" value={p.links.github} onChange={(value) => set({ ...p, links: { ...p.links, github: value } })} />
          <Text title="Portfolio" value={p.links.portfolio} onChange={(value) => set({ ...p, links: { ...p.links, portfolio: value } })} />
        </div>
      );
    case "eeo":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          {(Object.keys(EEO_OPTIONS) as Array<keyof StudentProfile["eeo"]>).map((key) => (
            <div key={key}>
              <label htmlFor={`eeo-${key}`} className={label}>{{ gender: "Gender", race: "Race", hispanicLatino: "Hispanic or Latino", veteran: "Veteran status", disability: "Disability" }[key]}</label>
              <select id={`eeo-${key}`} className={input} value={p.eeo[key]} onChange={(event) => set({ ...p, eeo: { ...p.eeo, [key]: event.target.value } })}>
                {EEO_OPTIONS[key].map(([value, text]) => <option key={value} value={value}>{text}</option>)}
              </select>
            </div>
          ))}
        </div>
      );
    case "preferences":
      return (
        <div className="space-y-4">
          <Text title="Roles you want (comma-separated)" value={commas(p.preferences.roles)} onChange={(value) => set({ ...p, preferences: { ...p.preferences, roles: fromCommas(value) } })} placeholder="e.g. Data analyst, Product intern" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Text title="Industries" value={commas(p.preferences.industries)} onChange={(value) => set({ ...p, preferences: { ...p.preferences, industries: fromCommas(value) } })} placeholder="e.g. Fintech, Climate" />
            <Text title="Locations" value={commas(p.preferences.locations)} onChange={(value) => set({ ...p, preferences: { ...p.preferences, locations: fromCommas(value) } })} placeholder="e.g. Boston, New York" />
            <Text title="Start term" value={p.preferences.startTerm} onChange={(value) => set({ ...p, preferences: { ...p.preferences, startTerm: value } })} placeholder="e.g. Summer 2027" />
          </div>
          <Choice title="Remote?" value={p.preferences.remote} options={[["yes", "Remote"], ["no", "In person"], ["either", "Either"]]} onChange={(value) => set({ ...p, preferences: { ...p.preferences, remote: value } })} />
          <Choice title="Looking for" value={p.preferences.jobType} options={[["internship", "Internship"], ["full_time", "Full-time"], ["either", "Either"]]} onChange={(value) => set({ ...p, preferences: { ...p.preferences, jobType: value } })} />
        </div>
      );
    case "standard":
      return (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Text title="How do you usually hear about jobs?" value={p.standardAnswers.heardAbout} onChange={(value) => set({ ...p, standardAnswers: { ...p.standardAnswers, heardAbout: value } })} placeholder="e.g. Company website" />
            <Text title="Earliest start date" value={p.standardAnswers.earliestStart} onChange={(value) => set({ ...p, standardAnswers: { ...p.standardAnswers, earliestStart: value } })} placeholder="e.g. June 2027" />
            <Text title="Salary expectation (optional)" value={p.standardAnswers.salaryExpectation} onChange={(value) => set({ ...p, standardAnswers: { ...p.standardAnswers, salaryExpectation: value } })} placeholder="e.g. Open to discussion" />
          </div>
          <Choice title="Open to working in person?" value={p.standardAnswers.inPerson ?? undefined} options={YES_NO} onChange={(value) => set({ ...p, standardAnswers: { ...p.standardAnswers, inPerson: value } })} />
        </div>
      );
    case "essays":
      return (
        <div className="space-y-4">
          <Area title="About you, in 2–3 sentences" value={p.essays.aboutMe} onChange={(value) => set({ ...p, essays: { ...p.essays, aboutMe: value } })} />
          <Area title="Why you're interested in your field" value={p.essays.whyField} onChange={(value) => set({ ...p, essays: { ...p.essays, whyField: value } })} />
        </div>
      );
    case "account":
      return <Text title="Email for job-site accounts" type="email" value={p.accountEmail ?? p.contact.email} onChange={(value) => set({ ...p, accountEmail: value })} />;
  }
}

const ALL_GAPS: Array<{ id: GapId; title: string }> = [
  { id: "work_auth", title: "Work authorization" }, { id: "education", title: "Graduation" }, { id: "contact", title: "Phone and location" },
  { id: "links", title: "Links" }, { id: "eeo", title: "Voluntary self-identification" }, { id: "preferences", title: "What you're looking for" },
  { id: "standard", title: "Common questions" }, { id: "essays", title: "A little about you" }, { id: "account", title: "Job-site accounts" },
];

export function ResumeFirst({ mode, onDone }: { mode: "onboarding" | "edit"; onDone: () => void }) {
  const [state, setState] = useState<State | null>(null);
  const [draft, setDraft] = useState<StudentProfile | null>(null);
  const [step, setStep] = useState<"upload" | "confirm" | "gaps" | "finish">("upload");
  const [busy, setBusy] = useState("");
  const [problem, setProblem] = useState("");
  const [note, setNote] = useState("");
  const [drag, setDrag] = useState(false);

  const take = useCallback((next: State) => {
    setState(next);
    setDraft(next.profile);
  }, []);

  useEffect(() => {
    api<State>("")
      .then((next) => {
        take(next);
        // A returning student skips the upload; someone who already confirmed goes straight to the gaps.
        if (mode === "onboarding" && next.profile.confirmedAt) setStep(next.missing.length ? "gaps" : "finish");
        else if (mode === "onboarding" && next.resume) setStep("confirm");
      })
      .catch((reason) => setProblem(reason instanceof Error ? reason.message : "Couldn't load your profile."));
  }, [mode, take]);

  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy("upload");
    setProblem("");
    try {
      const body = new FormData();
      body.set("file", file);
      const result = await api<State & { found: number; read: boolean }>("/resume", { method: "POST", body });
      take(result);
      setNote(result.read ? `Read ${result.found} details from ${file.name}. Check them below.` : `Saved ${file.name}. Unnepo couldn't read details from it automatically, so fill them in below.`);
      if (mode === "onboarding") setStep("confirm");
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : "Couldn't read that resume.");
    } finally {
      setBusy("");
    }
  }

  async function save(patch: Partial<StudentProfile> = {}, confirm = false) {
    if (!draft) return null;
    setBusy("save");
    setProblem("");
    try {
      const next = await api<State>("", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profile: { ...draft, ...patch }, confirm }) });
      take(next);
      return next;
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : "Couldn't save.");
      return null;
    } finally {
      setBusy("");
    }
  }

  if (!state || !draft) return problem ? <p role="alert" className="text-sm text-red-300">{problem}</p> : <p className="text-sm text-[#8B8B94]">Loading your profile…</p>;
  const gap = state.missing[0];

  return (
    <section className="mx-auto w-full max-w-3xl space-y-8">
      <div className="space-y-4">
        <p className={eyebrow}>{mode === "edit" ? "Your profile" : step === "upload" ? "Step 1 of 3" : step === "confirm" ? "Step 2 of 3" : "Step 3 of 3"}</p>
        <h1 className="text-[32px] font-bold leading-tight tracking-[-1.2px] sm:text-[40px] sm:tracking-[-1.4px]">
          {mode === "edit" ? "Everything Unnepo applies with" : step === "upload" ? "Start with your resume" : step === "confirm" ? "Check what we found" : step === "gaps" ? (gap?.title ?? "Almost done") : "You're ready"}
        </h1>
        <Progress value={draft.completeness} />
      </div>
      {problem && <p role="alert" className="rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">{problem}</p>}
      {note && step !== "upload" && <p className="text-sm text-[#9A9AA3]">{note}</p>}

      {(step === "upload" || mode === "edit") && (
        <div className="space-y-3">
          <label
            onDragOver={(event) => { event.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(event) => { event.preventDefault(); setDrag(false); void upload(event.dataTransfer.files?.[0]); }}
            className={`flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-dashed p-8 text-center ${drag ? "border-white bg-[#0C0C0E]" : "border-[#26262C]"} ${busy === "upload" ? "pointer-events-none opacity-60" : ""}`}
          >
            <span className="text-sm font-medium">{busy === "upload" ? "Reading your resume…" : state.resume ? `Replace ${state.resume.fileName}` : "Upload your resume"}</span>
            <span className="text-xs text-[#8B8B94]">PDF or DOCX, up to 10 MB. Drop it here or click to choose. Unnepo fills in everything it can.</span>
            <input type="file" className="sr-only" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void upload(file); }} />
          </label>
          {mode === "onboarding" && <button type="button" className="text-sm text-[#9A9AA3] underline-offset-4 hover:text-white hover:underline" onClick={() => setStep("confirm")}>No resume? Fill it in myself</button>}
        </div>
      )}

      {(step === "confirm" || mode === "edit") && (
        <div className="space-y-8">
          <Sections profile={draft} set={setDraft} />
          {mode === "onboarding" && (
            <div className="flex flex-wrap gap-3 border-t border-[#17171B] pt-6">
              <button type="button" className={primary} disabled={Boolean(busy)} onClick={async () => { const next = await save({}, true); if (next) { setNote(""); setStep(next.missing.length ? "gaps" : "finish"); } }}>
                {busy === "save" ? "Saving…" : "Looks right, continue"}
              </button>
            </div>
          )}
        </div>
      )}

      {step === "gaps" && mode === "onboarding" && gap && (
        <div className="space-y-6 rounded-2xl border border-[#17171B] bg-[#0C0C0E] p-5 sm:p-6">
          <p className="text-sm text-[#9A9AA3]">{gap.why}</p>
          <GapFields id={gap.id} profile={draft} set={setDraft} />
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className={primary} disabled={Boolean(busy)} onClick={async () => { const next = await save({ done: [...draft.done, gap.id] }); if (next && !next.missing.length) setStep("finish"); }}>{busy === "save" ? "Saving…" : "Save and continue"}</button>
            {gap.optional && <button type="button" className={secondary} disabled={Boolean(busy)} onClick={async () => { const next = await save({ done: [...draft.done, gap.id] }); if (next && !next.missing.length) setStep("finish"); }}>Skip</button>}
            <span className="text-xs text-[#8B8B94]">{state.missing.length} left</span>
          </div>
        </div>
      )}

      {mode === "edit" && (
        <div className="space-y-6">
          {ALL_GAPS.map((item) => (
            <section key={item.id} className="space-y-4 border-t border-[#17171B] pt-6">
              <h3 className={eyebrow}>{item.title}</h3>
              <GapFields id={item.id} profile={draft} set={setDraft} />
            </section>
          ))}
          <div className="sticky bottom-4 flex flex-wrap items-center gap-3 rounded-2xl border border-[#17171B] bg-bg/95 p-3 backdrop-blur">
            <button type="button" className={primary} disabled={Boolean(busy)} onClick={async () => { if (await save({}, true)) setNote("Saved. Every application uses these details from now on."); }}>{busy === "save" ? "Saving…" : "Save profile"}</button>
            <button type="button" className={secondary} onClick={onDone}>Done</button>
            {note && <span className="text-xs text-[#9A9AA3]">{note}</span>}
          </div>
        </div>
      )}

      {step === "finish" && mode === "onboarding" && (
        <div className="space-y-5 rounded-2xl border border-[#17171B] bg-[#0C0C0E] p-6">
          <p className="text-sm text-[#B4B4BC]">Your profile is {draft.completeness}% ready. The Unnepo Chrome extension fills applications from it, right in your own browser.</p>
          <div className="flex flex-wrap gap-3">
            {state.extensionUrl ? (
              <a href={state.extensionUrl} target="_blank" rel="noreferrer" className={primary}>Add to Chrome</a>
            ) : (
              <span className="inline-flex min-h-11 items-center rounded-[10px] border border-[#26262C] px-4 text-sm text-[#8B8B94]">Chrome extension coming soon</span>
            )}
            <button type="button" className={state.extensionUrl ? secondary : primary} onClick={onDone}>Go to Unnepo</button>
          </div>
          <p className="text-xs text-[#8B8B94]">You can change anything later in Settings, under Profile.</p>
        </div>
      )}
    </section>
  );
}
