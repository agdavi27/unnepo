"use client";

import { SpiderLoader } from "@/components/unnepo/spider-loader";
import { useCallback, useEffect, useId, useState } from "react";
import { CLASS_YEARS, EEO_OPTIONS, classYearOf, missingDates, type Education, type Experience, type GapId, type Project, type StudentProfile } from "@/lib/profile/student";

/**
 * Resume-first onboarding: upload a resume, confirm what Unnepo read, then answer only what's missing,
 * one short card at a time. The same screens edit the profile later from Settings.
 */

type Gap = { id: GapId; title: string; why: string; optional: boolean };
type State = { profile: StudentProfile; missing: Gap[]; ready: boolean; resume: { id: string; fileName: string } | null; resumes?: Array<{ id: string; fileName: string; uploadedAt: string }>; extensionUrl: string };

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

function Text({ title, value, onChange, placeholder, tag = false, type = "text", needed = false }: { title: string; value: string | undefined; onChange: (value: string) => void; placeholder?: string; tag?: boolean; type?: string; needed?: boolean }) {
  const id = useId();
  const empty = needed && !value?.trim();
  return (
    <div>
      <label htmlFor={id} className={label}>{title}<FromResume show={tag} />{empty && <span className="ml-1.5 text-[11px] text-[#F5A524]">needed</span>}</label>
      <input id={id} type={type} className={`${input}${empty ? " !border-[#F5A524]" : ""}`} aria-invalid={empty || undefined} value={value ?? ""} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

/**
 * A list typed as bubbles: press Enter or comma to turn what you typed into a bubble, × or Backspace to
 * take one out. Pasting "a, b, c" makes three. Whatever's left in the box when you leave it is kept too.
 */
function Tags({ title, values, onChange, placeholder, tag = false }: { title: string; values: string[]; onChange: (values: string[]) => void; placeholder?: string; tag?: boolean }) {
  const id = useId();
  const [draft, setDraft] = useState("");
  const add = (text: string) => {
    const fresh = text.split(/[,\n]/).map((item) => item.trim()).filter(Boolean)
      .filter((item, index, list) => list.findIndex((other) => other.toLowerCase() === item.toLowerCase()) === index)
      .filter((item) => !values.some((value) => value.toLowerCase() === item.toLowerCase()));
    if (fresh.length) onChange([...values, ...fresh]);
    setDraft("");
  };
  return (
    <div>
      <label htmlFor={id} className={label}>{title}<FromResume show={tag} /></label>
      <div className={`${input} flex min-h-11 flex-wrap items-center gap-1.5 py-1.5 focus-within:border-zinc-500`} onClick={() => document.getElementById(id)?.focus()}>
        {values.map((value, index) => (
          <span key={`${value}-${index}`} className="inline-flex items-center gap-1 rounded-full border border-[#26262C] bg-[#17171B] py-0.5 pl-2.5 pr-1 text-[13px] text-ink">
            {value}
            <button type="button" aria-label={`Remove ${value}`} className="flex h-5 w-5 items-center justify-center rounded-full text-[#8B8B94] hover:bg-white/10 hover:text-white" onClick={(event) => { event.stopPropagation(); onChange(values.filter((_, other) => other !== index)); }}>×</button>
          </span>
        ))}
        <input
          id={id}
          className="min-w-[8rem] flex-1 bg-transparent py-1 text-sm text-ink outline-none placeholder:text-faint"
          value={draft}
          placeholder={values.length ? "Add another" : placeholder ?? "Type, then press Enter"}
          enterKeyHint="done"
          onChange={(event) => (/[,\n]/.test(event.target.value) ? add(event.target.value) : setDraft(event.target.value))}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); add(draft); }
            else if (event.key === "Backspace" && !draft && values.length) onChange(values.slice(0, -1));
          }}
          onBlur={() => add(draft)}
        />
      </div>
    </div>
  );
}

/** Roles that fit the resume, as bubbles to tap into "Roles you want". Asked for once per visit. */
function RoleIdeas({ taken, onPick }: { taken: string[]; onPick: (role: string) => void }) {
  const [ideas, setIdeas] = useState<{ roles: string[]; ai: boolean } | null>(null);
  useEffect(() => {
    let live = true;
    api<{ roles: string[]; ai: boolean }>("/roles").then((result) => { if (live) setIdeas(result); }).catch(() => { if (live) setIdeas({ roles: [], ai: false }); });
    return () => { live = false; };
  }, []);
  const left = (ideas?.roles ?? []).filter((role) => !taken.some((other) => other.toLowerCase() === role.toLowerCase()));
  if (ideas && !left.length) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs text-[#8B8B94]">{ideas ? (ideas.ai ? "✦ Suggested from your resume and past experience. Tap to add." : "Suggested from your resume. Tap to add.") : "✦ Finding roles that fit your experience…"}</p>
      <div className="flex flex-wrap gap-2">
        {ideas
          ? left.map((role) => (
              <button key={role} type="button" onClick={() => onPick(role)} className="inline-flex min-h-9 items-center gap-1 rounded-full border border-dashed border-[#3D8BFF]/60 bg-[#3D8BFF]/10 px-3 text-[13px] text-[#BFD6FF] hover:border-[#3D8BFF] hover:bg-[#3D8BFF]/20">
                <span aria-hidden="true">+</span>{role}
              </button>
            ))
          : [0, 1, 2, 3].map((n) => <span key={n} className="h-9 w-28 animate-pulse rounded-full bg-[#17171B]" />)}
      </div>
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

/** The degree a school gave, as a choice. What a resume wrote ("B.A.") opens on the matching one. */
const DEGREES = ["High school diploma", "Associate's degree", "Bachelor of Arts (B.A.)", "Bachelor of Science (B.S.)", "Master's degree", "MBA", "PhD", "Other"];
function degreeChoice(raw: string | undefined) {
  const text = (raw ?? "").trim();
  if (!text || DEGREES.includes(text)) return text;
  if (/high school|diploma|\bged\b/i.test(text)) return DEGREES[0];
  if (/associate/i.test(text)) return DEGREES[1];
  if (/\bm\.?\s?b\.?\s?a\b/i.test(text)) return "MBA";
  if (/ph\.?\s?d|doctor/i.test(text)) return "PhD";
  if (/master|\bm\.?\s?[as]\b|\bm\.?\s?sc\b/i.test(text)) return DEGREES[4];
  if (/bachelor of science|\bb\.?\s?s\b|\bb\.?\s?sc\b/i.test(text)) return DEGREES[3];
  if (/bachelor|\bb\.?\s?a\b/i.test(text)) return DEGREES[2];
  return text;
}

function Degree({ value, onChange, tag }: { value: string | undefined; onChange: (value: string) => void; tag: boolean }) {
  const id = useId();
  const current = degreeChoice(value);
  const options = current && !DEGREES.includes(current) ? [current, ...DEGREES] : DEGREES;
  return (
    <div>
      <label htmlFor={id} className={label}>Degree<FromResume show={tag} /></label>
      <select id={id} className={input} value={current} onChange={(event) => onChange(event.target.value)}>
        <option value="">Choose a degree…</option>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </div>
  );
}

function DatesNeeded({ gaps }: { gaps: string[] }) {
  if (!gaps.length) return null;
  return <p role="status" className="w-full text-xs text-[#F5A524]">Fill in every date to save. Still blank: {gaps.slice(0, 4).join(", ")}{gaps.length > 4 ? `, and ${gaps.length - 4} more` : ""}.</p>;
}

const YES_NO: Array<[boolean, string]> = [[true, "Yes"], [false, "No"]];
const lines = (values: string[] | undefined) => (values ?? []).join("\n");
const fromLines = (value: string) => value.split("\n").map((item) => item.trim()).filter(Boolean);

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
          <Text title="Middle name (optional)" value={profile.contact.middleName} onChange={contact("middleName")} />
          <Text title="Suffix (optional)" value={profile.contact.suffix} onChange={contact("suffix")} placeholder="e.g. Jr., III" />
          <Text title="Title (optional)" value={profile.contact.salutation} onChange={contact("salutation")} placeholder="e.g. Mr., Ms., Mx., Dr." />
          <Text title="Last name" value={profile.contact.lastName} onChange={contact("lastName")} tag={tag("contact.lastName")} />
          <Text title="Preferred name (optional)" value={profile.contact.preferredName} onChange={contact("preferredName")} />
          <Text title="Email" type="email" value={profile.contact.email} onChange={contact("email")} tag={tag("contact.email")} />
          <Text title="Phone" type="tel" value={profile.contact.phone} onChange={contact("phone")} tag={tag("contact.phone")} />
          <Text title="Phone extension" value={profile.contact.phoneExtension ?? "1"} onChange={contact("phoneExtension")} placeholder="1" />
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
            <Degree value={item.degree} onChange={(value) => updateList("education", i, { degree: value })} tag={tag(`education.${i}.degree`)} />
            <Text title="Major" value={item.major} onChange={(value) => updateList("education", i, { major: value })} tag={tag(`education.${i}.major`)} />
            <Text title="Minor (optional)" value={item.minor} onChange={(value) => updateList("education", i, { minor: value })} tag={tag(`education.${i}.minor`)} />
            <Text title="From (MM/YYYY)" value={item.startDate} onChange={(value) => updateList("education", i, { startDate: value })} placeholder="09/2023" tag={tag(`education.${i}.startDate`)} needed />
            <Text title="To, actual or expected (MM/YYYY)" value={item.gradDate} onChange={(value) => updateList("education", i, { gradDate: value })} placeholder="05/2027" tag={tag(`education.${i}.gradDate`)} needed />
            <Text title="GPA (optional)" value={item.gpa} onChange={(value) => updateList("education", i, { gpa: value })} tag={tag(`education.${i}.gpa`)} />
            {i === 0 && <div className="sm:col-span-2"><Choice title="Year in school" value={classYearOf(item) ?? undefined} options={CLASS_YEARS} onChange={(value) => updateList("education", i, { classYear: value })} /></div>}
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
            <Text title="From (MM/YYYY)" value={item.startDate} onChange={(value) => updateList("experience", i, { startDate: value })} placeholder="05/2024" tag={tag(`experience.${i}.startDate`)} needed />
            <Text title="To (MM/YYYY, or Present)" value={item.current ? "Present" : item.endDate} onChange={(value) => updateList("experience", i, { endDate: value, current: /present/i.test(value) })} placeholder="08/2024 or Present" tag={tag(`experience.${i}.endDate`)} needed />
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
            <div className="sm:col-span-2"><Tags title="Tech" values={item.tech ?? []} onChange={(values) => updateList("projects", i, { tech: values })} tag={tag(`projects.${i}.tech`)} /></div>
            <button type="button" className="justify-self-start text-xs text-[#8B8B94] hover:text-red-300" onClick={() => removeAt("projects", i)}>Remove</button>
          </div>
        ))}
      </section>
      <section className={section}>
        <h3 className={eyebrow}>Skills</h3>
        <Tags title="Technical skills" values={profile.skills.technical ?? []} onChange={(values) => set({ ...profile, skills: { ...profile.skills, technical: values } })} tag={tag("skills.technical")} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Tags title="Languages you speak" values={profile.skills.languages ?? []} onChange={(values) => set({ ...profile, skills: { ...profile.skills, languages: values } })} tag={tag("skills.languages")} />
          <Tags title="Certifications" values={profile.skills.certifications ?? []} onChange={(values) => set({ ...profile, skills: { ...profile.skills, certifications: values } })} tag={tag("skills.certifications")} />
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
          <div className="sm:col-span-2"><Choice title="Year in school" value={classYearOf(school) ?? undefined} options={CLASS_YEARS} onChange={(value) => setSchool({ classYear: value })} /></div>
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
          <Tags title="Roles you want" values={p.preferences.roles ?? []} onChange={(values) => set({ ...p, preferences: { ...p.preferences, roles: values } })} placeholder="e.g. Data analyst, Product intern" />
          <RoleIdeas taken={p.preferences.roles ?? []} onPick={(role) => set({ ...p, preferences: { ...p.preferences, roles: [...(p.preferences.roles ?? []), role] } })} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Tags title="Industries" values={p.preferences.industries ?? []} onChange={(values) => set({ ...p, preferences: { ...p.preferences, industries: values } })} placeholder="e.g. Fintech, Climate" />
            <Tags title="Locations" values={p.preferences.locations ?? []} onChange={(values) => set({ ...p, preferences: { ...p.preferences, locations: values } })} placeholder="e.g. Boston, New York" />
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
          <p className="text-xs text-[#8B8B94]">Both are optional. Skip either one, or both.</p>
          <Area title="About you, in 2–3 sentences (optional)" value={p.essays.aboutMe} onChange={(value) => set({ ...p, essays: { ...p.essays, aboutMe: value } })} />
          <Area title="Why you're interested in your field (optional)" value={p.essays.whyField} onChange={(value) => set({ ...p, essays: { ...p.essays, whyField: value } })} />
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

/**
 * Every resume the student uploaded, with the one Unnepo applies with checked. Picking another one changes only
 * the work experience below to that resume's; everything else stays.
 */
function ResumePicker({ state, busy, onPick, onRemove }: { state: State; busy: string; onPick: (id: string) => void; onRemove: (id: string) => void }) {
  const list = state.resumes ?? [];
  if (list.length < 2) return null;
  const day = (at: string) => new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return (
    <fieldset className="space-y-2" disabled={Boolean(busy)}>
      <legend className={`${eyebrow} mb-2`}>Apply with</legend>
      <ul className="divide-y divide-[#17171B] overflow-hidden rounded-xl border border-[#17171B]">
        {list.map((item) => {
          const on = item.id === state.resume?.id;
          return (
            <li key={item.id} className={`flex items-center gap-3 px-3 py-2.5 ${on ? "bg-[#0C0C0E]" : ""}`}>
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                <input type="radio" name="active-resume" checked={on} onChange={() => onPick(item.id)} className="accent-[#3D8BFF]" />
                <span className="min-w-0 truncate text-sm">{item.fileName}</span>
                <span className="shrink-0 text-xs text-[#8B8B94]">{busy === `pick:${item.id}` ? "Switching…" : day(item.uploadedAt)}</span>
              </label>
              <a href={`/api/resume-file?id=${encodeURIComponent(item.id)}`} target="_blank" rel="noreferrer" className="text-xs text-[#9A9AA3] hover:text-white">Open</a>
              <button type="button" onClick={() => onRemove(item.id)} className="text-xs text-[#8B8B94] hover:text-red-300">Remove</button>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-[#8B8B94]">Switching changes only your work experience to that resume&apos;s. The extension attaches the one checked.</p>
    </fieldset>
  );
}

/**
 * The student's own cover letter, optional. When one is saved, "Write with unnepo" on a job form first offers to
 * attach it as-is; otherwise (or if they'd rather) Unnepo writes one for that job.
 */
function DefaultCoverLetter() {
  const [letter, setLetter] = useState<{ fileName: string; uploadedAt: string } | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  useEffect(() => {
    api<{ coverLetter: { fileName: string; uploadedAt: string } | null }>("/my-letter").then((body) => setLetter(body.coverLetter)).catch(() => setLetter(null));
  }, []);

  async function send(init: RequestInit) {
    setBusy(true);
    setProblem("");
    try {
      setLetter((await api<{ coverLetter: { fileName: string; uploadedAt: string } | null }>("/my-letter", init)).coverLetter);
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : "Couldn't save it.");
    } finally {
      setBusy(false);
    }
  }
  function upload(file: File | undefined) {
    if (!file) return;
    const body = new FormData();
    body.set("file", file);
    void send({ method: "POST", body });
  }

  if (letter === undefined) return null;
  return (
    <section className="space-y-3 border-t border-[#17171B] pt-6">
      <h3 className={eyebrow}>Your cover letter <span className="normal-case tracking-normal text-[#6B6B74]">(optional)</span></h3>
      <p className="text-sm text-[#9A9AA3]">Have a cover letter you send everywhere? Add it and Unnepo offers to attach it when a form asks for one. Or skip this: Unnepo can write one for each job.</p>
      <div className="flex flex-wrap items-center gap-3">
        <label className={`${secondary} cursor-pointer ${busy ? "pointer-events-none opacity-60" : ""}`}>
          {busy ? "Saving…" : letter ? "Replace" : "Add my cover letter"}
          <input type="file" className="sr-only" accept=".pdf,.docx,.doc,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; upload(file); }} />
        </label>
        {letter && (
          <>
            <span className="min-w-0 truncate text-sm">{letter.fileName}</span>
            <button type="button" disabled={busy} onClick={() => void send({ method: "DELETE" })} className="text-xs text-[#8B8B94] hover:text-red-300">Remove</button>
          </>
        )}
      </div>
      {problem && <p role="alert" className="text-sm text-red-300">{problem}</p>}
    </section>
  );
}

export function ResumeFirst({ mode, onDone }: { mode: "onboarding" | "edit"; onDone: () => void }) {
  const [state, setState] = useState<State | null>(null);
  const [draft, setDraft] = useState<StudentProfile | null>(null);
  const [step, setStep] = useState<"upload" | "confirm" | "gaps" | "extension" | "finish">("upload");
  const [busy, setBusy] = useState("");
  const [problem, setProblem] = useState("");
  const [note, setNote] = useState("");
  const [drag, setDrag] = useState(false);
  /** Gap cards answered on this visit, newest last, so Back can open them again. */
  const [history, setHistory] = useState<Gap[]>([]);
  /** A gap card opened again with Back, shown instead of the next one missing. */
  const [revisit, setRevisit] = useState<Gap | null>(null);

  const take = useCallback((next: State) => {
    setState(next);
    setDraft(next.profile);
  }, []);

  useEffect(() => {
    api<State>("")
      .then((next) => {
        take(next);
        // A returning student skips the upload; someone who already confirmed goes straight to the gaps.
        if (mode === "onboarding" && next.profile.confirmedAt) setStep(next.missing.length ? "gaps" : "extension");
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

  async function pickResume(id: string) {
    setBusy(`pick:${id}`);
    setProblem("");
    try {
      const result = await api<State & { switched: boolean }>("/resume", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      take(result);
      setNote(result.switched ? `Applying with ${result.resume?.fileName}. Work experience updated from it.` : `Applying with ${result.resume?.fileName}. Unnepo couldn't read its work experience, so yours stayed the same.`);
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : "Couldn't switch resumes.");
    } finally {
      setBusy("");
    }
  }

  async function removeResume(id: string) {
    const name = state?.resumes?.find((item) => item.id === id)?.fileName ?? "this resume";
    if (!confirm(`Remove ${name} from Unnepo?`)) return;
    setBusy("remove");
    setProblem("");
    try {
      take(await api<State>(`/resume?id=${encodeURIComponent(id)}`, { method: "DELETE" }));
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : "Couldn't remove it.");
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

  if (!state || !draft) return problem ? <p role="alert" className="text-sm text-red-300">{problem}</p> : <SpiderLoader label="Loading your profile…" />;
  const gap = revisit ?? state.missing[0];
  const datesLeft = missingDates(draft);

  /** Saves the gap card showing (answered or skipped) and moves to the next one. */
  async function finishGap(current: Gap) {
    const next = await save({ done: [...new Set([...draft!.done, current.id])] });
    if (!next) return;
    setHistory((list) => [...list.filter((item) => item.id !== current.id), current]);
    setRevisit(null);
    if (!next.missing.length) setStep("extension");
  }

  /** Back: the card before this one, the gap cards answered on this visit one at a time. */
  function goBack() {
    setProblem("");
    if (step === "finish") return setStep("extension");
    if (step === "confirm") return setStep("upload");
    if (step === "gaps" || step === "extension") {
      const previous = history[history.length - 1];
      if (previous) {
        setHistory(history.slice(0, -1));
        setRevisit(previous);
        setStep("gaps");
      } else {
        setRevisit(null);
        setStep("confirm");
      }
    }
  }

  return (
    <section className="mx-auto w-full max-w-3xl space-y-8">
      <div className="space-y-4">
        {mode === "onboarding" && step !== "upload" && (
          <button type="button" onClick={goBack} disabled={Boolean(busy)} className="-ml-1 inline-flex min-h-9 items-center gap-1.5 rounded-lg px-1 text-sm text-[#9A9AA3] hover:text-white disabled:opacity-40">
            <span aria-hidden="true">←</span> Back
          </button>
        )}
        <p className={eyebrow}>{mode === "edit" ? "Your profile" : step === "upload" ? "Step 1 of 4" : step === "confirm" ? "Step 2 of 4" : step === "gaps" ? "Step 3 of 4" : step === "extension" ? "Step 4 of 4" : "All set"}</p>
        <h1 className="text-[32px] font-bold leading-tight tracking-[-1.2px] sm:text-[40px] sm:tracking-[-1.4px]">
          {mode === "edit" ? "Everything Unnepo applies with" : step === "upload" ? "Start with your resume" : step === "confirm" ? "Check what we found" : step === "gaps" ? (gap?.title ?? "Almost done") : step === "extension" ? "Add the Unnepo extension" : "You're ready"}
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
            <span className="text-sm font-medium">{busy === "upload" ? "Reading your resume…" : state.resume ? (mode === "edit" ? "Add another resume" : `Replace ${state.resume.fileName}`) : "Upload your resume"}</span>
            <span className="text-xs text-[#8B8B94]">PDF or DOCX, up to 10 MB. Drop it here or click to choose. Unnepo fills in everything it can.</span>
            <input type="file" className="sr-only" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void upload(file); }} />
          </label>
          {mode === "onboarding" && <button type="button" className="text-sm text-[#9A9AA3] underline-offset-4 hover:text-white hover:underline" onClick={() => setStep("confirm")}>No resume? Fill it in myself</button>}
          {mode === "edit" && <ResumePicker state={state} busy={busy} onPick={(id) => void pickResume(id)} onRemove={(id) => void removeResume(id)} />}
        </div>
      )}

      {(step === "confirm" || mode === "edit") && (
        <div className="space-y-8">
          <Sections profile={draft} set={setDraft} />
          <DefaultCoverLetter />
          {mode === "onboarding" && (
            <div className="flex flex-wrap gap-3 border-t border-[#17171B] pt-6">
              <button type="button" className={primary} disabled={Boolean(busy) || datesLeft.length > 0} onClick={async () => { const next = await save({}, true); if (next) { setNote(""); setStep(next.missing.length ? "gaps" : "extension"); } }}>
                {busy === "save" ? "Saving…" : "Looks right, continue"}
              </button>
              <DatesNeeded gaps={datesLeft} />
            </div>
          )}
        </div>
      )}

      {step === "gaps" && mode === "onboarding" && gap && (
        <div className="space-y-6 rounded-2xl border border-[#17171B] bg-[#0C0C0E] p-5 sm:p-6">
          <p className="text-sm text-[#9A9AA3]">{gap.why}</p>
          <GapFields key={gap.id} id={gap.id} profile={draft} set={setDraft} />
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className={primary} disabled={Boolean(busy)} onClick={() => void finishGap(gap)}>{busy === "save" ? "Saving…" : "Save and continue"}</button>
            {gap.optional && <button type="button" className={secondary} disabled={Boolean(busy)} onClick={() => void finishGap(gap)}>Skip</button>}
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
            <button type="button" className={primary} disabled={Boolean(busy) || datesLeft.length > 0} onClick={async () => { if (await save({}, true)) setNote("Saved. Every application uses these details from now on."); }}>{busy === "save" ? "Saving…" : "Save profile"}</button>
            <button type="button" className={secondary} onClick={onDone}>Done</button>
            {note && <span className="text-xs text-[#9A9AA3]">{note}</span>}
            <DatesNeeded gaps={datesLeft} />
          </div>
        </div>
      )}

      {step === "extension" && mode === "onboarding" && (
        <div className="space-y-6">
          <div className="space-y-3 rounded-2xl border border-[#17171B] bg-[#0C0C0E] p-5 text-[15px] leading-[1.55] text-[#B4B4BC] sm:p-6">
            <p className="m-0">Unnepo works from a side panel in Chrome. It keeps your job tracker, catches the jobs you apply to, finds who to email at each company, and reminds you when to follow up.</p>
            <ol className="m-0 list-decimal space-y-1.5 pl-5">
              <li>Add the extension to Chrome.</li>
              <li>Click the Unnepo icon in the toolbar to open the side panel.</li>
              <li>Press <strong className="text-[#F7F7F8]">Connect on Unnepo</strong>, then Connect on the page that opens.</li>
            </ol>
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-[#17171B] pt-6">
            <a href={state.extensionUrl} target="_blank" rel="noreferrer" className={primary}>Add to Chrome</a>
            <a href="/extension/connect" target="_blank" rel="noreferrer" className={secondary}>Connect the extension</a>
            <button type="button" className={secondary} onClick={() => setStep("finish")}>Next</button>
          </div>
        </div>
      )}

      {step === "finish" && mode === "onboarding" && (
        <div className="space-y-5 rounded-2xl border border-[#17171B] bg-[#0C0C0E] p-6">
          <p className="text-sm text-[#B4B4BC]">Your profile is {draft.completeness}% ready. The Unnepo Chrome extension fills applications from it, right in your own browser.</p>
          <div className="flex flex-wrap gap-3">
            <a href={state.extensionUrl} target="_blank" rel="noreferrer" className={primary}>Add to Chrome</a>
            <button type="button" className={secondary} onClick={onDone}>Go to Unnepo</button>
          </div>
          <p className="text-xs text-[#8B8B94]">You can change anything later in Settings, under Profile.</p>
        </div>
      )}
    </section>
  );
}
