"use client";

/* The supplied form copy uses apostrophes. Keep that text as written. */
/* eslint-disable react/no-unescaped-entities */

import React, { useId, useState } from "react";
import { COLLEGE_SUGGESTIONS, COMPANY_SUGGESTIONS, INTEREST_SUGGESTIONS, LOCATION_SUGGESTIONS, MAJOR_SUGGESTIONS, ROLE_SUGGESTIONS, brandsForInterests, rankSuggestions } from "@/lib/suggestions";
import { formatLocation, joinProfileList, parseLocation, splitLocations, splitProfileList } from "@/lib/profile/lists";

/** Drop-in UI components. Wire callbacks to your existing authenticated backend. */
export type Profile = {
  school: string; major: string; graduationYear: string; interests: string[]; otherInterests: string;
  targetRoles: string; dreamCompanies: string; locations: string; workPreference: string;
  goals: string[]; contactTypes: string[]; seniority: string; bio: string;
  accomplishments: string; excludedTopics: string; emailTone: string;
};
export const emptyProfile: Profile = {
  school: "", major: "", graduationYear: "2027", interests: [], otherInterests: "",
  targetRoles: "", dreamCompanies: "", locations: "", workPreference: "either",
  goals: [], contactTypes: [], seniority: "balanced", bio: "", accomplishments: "", excludedTopics: "", emailTone: "friendly"
};

const btn = "inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const primary = `${btn} bg-white text-black hover:bg-zinc-200`;
const secondary = `${btn} border border-line bg-transparent text-ink hover:bg-white/5`;
const field = "w-full rounded-xl border border-line bg-card px-3 py-2.5 text-sm text-ink outline-none placeholder:text-faint focus:border-zinc-500";
const card = "rounded-2xl border border-line bg-panel p-5 sm:p-6";
const label = "mb-1.5 block text-xs font-medium text-muted";
const Toggle = ({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) => <button type="button" onClick={onClick} className={`${btn} border text-left ${active ? "border-white bg-white text-black" : "border-line text-zinc-300 hover:bg-white/5"}`}>{active ? "✓ " : "+ "}{children}</button>;
const Chips = ({ values, selected, onChange }: { values: string[]; selected: string[]; onChange: (next: string[]) => void }) => <div className="flex flex-wrap gap-2">{values.map(v => <Toggle key={v} active={selected.includes(v)} onClick={() => onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v])}>{v}</Toggle>)}</div>;
const Select = ({ value, onChange, options }: { value: string; onChange: (s: string) => void; options: [string, string][] }) => <select className={field} value={value} onChange={e => onChange(e.target.value)}>{options.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>;
const TextField = ({ title, value, onChange, placeholder, multiline = false }: { title: string; value: string; onChange: (s: string) => void; placeholder?: string; multiline?: boolean }) => <div><label className={label}>{title}</label>{multiline ? <textarea rows={3} className={field} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} /> : <input className={field} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />}</div>;

/** Text input with a typeahead list underneath. With multi, it completes the entry after the last comma. */
function AutoField({ title, value, onChange, options, placeholder, multi = false }: { title: string; value: string; onChange: (s: string) => void; options: readonly string[]; placeholder?: string; multi?: boolean }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const id = useId();
  const parts = multi ? value.split(",") : [value];
  const token = parts[parts.length - 1] ?? "";
  const chosen = multi ? parts.slice(0, -1).map((part) => part.trim()).filter(Boolean) : [];
  const matches = open ? rankSuggestions(options, token, chosen) : [];
  const current = Math.min(active, Math.max(0, matches.length - 1));
  const pick = (option: string) => {
    onChange(multi ? `${[...chosen, option].join(", ")}, ` : option);
    setActive(0);
    setOpen(multi);
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!matches.length) return;
    if (event.key === "ArrowDown") { event.preventDefault(); setActive((current + 1) % matches.length); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive((current - 1 + matches.length) % matches.length); }
    else if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); pick(matches[current]); }
    else if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
  };
  return (
    <div className="relative">
      <label htmlFor={`${id}-input`} className={label}>{title}</label>
      <input
        id={`${id}-input`}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={matches.length > 0}
        aria-controls={`${id}-list`}
        aria-activedescendant={matches.length ? `${id}-option-${current}` : undefined}
        autoComplete="off"
        className={field}
        value={value}
        placeholder={placeholder}
        onChange={(event) => { onChange(event.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => { setOpen(false); if (multi) onChange(value.replace(/,\s*$/, "")); }}
        onKeyDown={onKeyDown}
      />
      {matches.length > 0 && (
        <ul id={`${id}-list`} role="listbox" className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-line bg-card p-1 shadow-2xl">
          {matches.map((option, index) => (
            <li
              key={option}
              id={`${id}-option-${index}`}
              role="option"
              aria-selected={index === current}
              onMouseDown={(event) => { event.preventDefault(); pick(option); }}
              onMouseEnter={() => setActive(index)}
              className={`cursor-pointer rounded-lg px-3 py-2 text-sm ${index === current ? "bg-white/10 text-white" : "text-zinc-300"}`}
            >
              {option}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const interestOptions=["Technology","Marketing","Finance","Consulting","Entrepreneurship","Music","Sports","Outdoor & Adventure","Fashion","Design","Healthcare","Media","Engineering","Real Estate","Education","Nonprofits","Government","Food & Beverage","Gaming","Sustainability"];
const goalOptions=["Find a job","Find an internship","Get referrals","Learn about careers","Find a mentor","Build my network","Explore starting a business"];
const contactOptions=["Alumni","Recruiters","Hiring managers","People doing my dream job","Recent graduates","Founders","Industry leaders"];
const RADIUS_OPTIONS: [string, string][] = [["0", "Exact city"], ["10", "+ 10 mi"], ["25", "+ 25 mi"], ["50", "+ 50 mi"], ["100", "+ 100 mi"]];

/**
 * Bubble input: Enter (or a comma, or leaving the field) turns the typed text into a bubble.
 * A suggestion that starts with the typed text is highlighted, so Enter completes it.
 */
function TagInput({ title, values, onChange, options = [], placeholder, hint, commaAdds = true, format, display }: {
  title: string; values: string[]; onChange: (next: string[]) => void; options?: readonly string[]; placeholder?: string; hint?: string;
  commaAdds?: boolean; format?: (item: string) => string; display?: (item: string) => string;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const id = useId();
  const matches = open ? rankSuggestions(options, text, values) : [];
  const autoPick = matches.length && matches[0].toLowerCase().startsWith(text.trim().toLowerCase()) ? 0 : -1;
  const current = active >= 0 && active < matches.length ? active : autoPick;
  const add = (raw: string) => {
    const item = raw.trim().replace(/,$/, "").trim();
    if (!item) return;
    const value = format ? format(item) : item;
    if (!values.some((existing) => existing.toLowerCase() === value.toLowerCase())) onChange([...values, value]);
    setText("");
    setActive(-1);
  };
  const remove = (item: string) => onChange(values.filter((existing) => existing !== item));
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && matches.length) { event.preventDefault(); setActive((current + 1) % matches.length); }
    else if (event.key === "ArrowUp" && matches.length) { event.preventDefault(); setActive((current - 1 + matches.length) % matches.length); }
    else if (event.key === "Enter" || (event.key === "Tab" && text.trim())) {
      if (!text.trim()) return;
      event.preventDefault();
      add(current >= 0 ? matches[current] : text);
    } else if (event.key === "," && commaAdds) { event.preventDefault(); add(text); }
    else if (event.key === "Escape") { setOpen(false); }
    else if (event.key === "Backspace" && !text && values.length) { remove(values[values.length - 1]); }
  };
  return (
    <div className="relative">
      <label htmlFor={`${id}-input`} className={label}>{title}</label>
      <div className="flex min-h-[2.75rem] flex-wrap items-center gap-1.5 rounded-xl border border-line bg-card px-2 py-1.5 focus-within:border-zinc-500">
        {values.map((item) => (
          <span key={item} className="inline-flex items-center gap-1 rounded-full bg-white py-1 pl-3 pr-1.5 text-xs font-medium text-black">
            {display ? display(item) : item}
            <button type="button" aria-label={`Remove ${item}`} onClick={() => remove(item)} className="rounded-full px-1 text-zinc-500 hover:bg-zinc-200 hover:text-black">✕</button>
          </span>
        ))}
        <input
          id={`${id}-input`}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={matches.length > 0}
          aria-controls={`${id}-list`}
          aria-activedescendant={current >= 0 ? `${id}-option-${current}` : undefined}
          autoComplete="off"
          className="min-w-[8rem] flex-1 bg-transparent px-1.5 py-1 text-sm text-ink outline-none placeholder:text-faint"
          value={text}
          placeholder={values.length ? "Add another…" : placeholder}
          onChange={(event) => { setText(event.target.value); setOpen(true); setActive(-1); }}
          onFocus={() => setOpen(true)}
          onBlur={() => { setOpen(false); add(text); }}
          onKeyDown={onKeyDown}
        />
      </div>
      {matches.length > 0 && (
        <ul id={`${id}-list`} role="listbox" className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-line bg-card p-1 shadow-2xl">
          {matches.map((option, index) => (
            <li
              key={option}
              id={`${id}-option-${index}`}
              role="option"
              aria-selected={index === current}
              onMouseDown={(event) => { event.preventDefault(); add(option); }}
              onMouseEnter={() => setActive(index)}
              className={`cursor-pointer rounded-lg px-3 py-2 text-sm ${index === current ? "bg-white/10 text-white" : "text-zinc-300"}`}
            >
              {option}
            </li>
          ))}
        </ul>
      )}
      {hint && <p className="mt-1.5 text-xs text-faint">{hint}</p>}
    </div>
  );
}

const PROFILE_STEPS = ["Resume", "Interests", "Career goals", "Connections", "Your story", "Review"];

/** Legacy profiles kept extra interests as comma text; they become bubbles in the interests list. */
function withLegacyInterests(profile: Profile): Profile {
  const extra = splitProfileList(profile.otherInterests);
  if (!extra.length) return profile;
  const interests = [...profile.interests];
  for (const item of extra) if (!interests.some((existing) => existing.toLowerCase() === item.toLowerCase())) interests.push(item);
  return { ...profile, interests, otherInterests: "" };
}

export function ProfileOnboarding({ initialProfile = emptyProfile, onSave, onResumeUpload, onCancel, saving = false, editing = false, initialStep = 0 }: {
  initialProfile?: Profile; onSave: (p: Profile) => void | Promise<void>; onResumeUpload?: (file: File) => void | Promise<void>;
  onCancel?: () => void; saving?: boolean; editing?: boolean; initialStep?: number;
}) {
  const [p,setP] = useState<Profile>(() => withLegacyInterests(initialProfile)); const [step,setStep] = useState(initialStep); const [file,setFile] = useState<string>(""); const [drag,setDrag] = useState(false);
  const [miles,setMiles] = useState("25");
  const set = <K extends keyof Profile>(k:K, v:Profile[K]) => setP(prev=>({...prev,[k]:v}));
  const list = (k: "major" | "targetRoles" | "dreamCompanies") => splitProfileList(p[k]);
  const setList = (k: "major" | "targetRoles" | "dreamCompanies") => (items: string[]) => set(k, joinProfileList(items));
  const locations = splitLocations(p.locations);
  const customInterests = p.interests.filter(item => !interestOptions.includes(item));
  const brandIdeas = brandsForInterests(p.interests, list("dreamCompanies"));
  const acceptResume = (f?: File) => { if(!f)return; const named=/\.(pdf|docx)$/i.test(f.name); const typed=f.type==="application/pdf"||f.type.includes("wordprocessingml"); if(!named&&!typed){alert("Upload a PDF or DOCX file.");return;} if(f.size>10*1024*1024){alert("Resume must be under 10 MB");return;} setFile(f.name); void onResumeUpload?.(f); };
  const save = () => onSave({ ...p, otherInterests: "" });
  const showLocation = (entry: string) => { const parsed = parseLocation(entry); return parsed.miles ? `${parsed.place} · ${parsed.miles} mi` : parsed.place; };
  const listText = (value: string, fallback: string) => splitProfileList(value).join(", ") || fallback;
  return <section className={`${card} space-y-5`}>
    <div className="flex items-start justify-between gap-3"><div><h2 className="text-2xl font-semibold tracking-tight">{editing ? "Edit your profile" : "Let's get to know you."}</h2><p className="text-sm text-muted">{editing ? "Jump to any section, change what you need, and save." : "Your profile powers personalized search and outreach."}</p></div>{editing && onCancel ? <button type="button" className={secondary} onClick={onCancel}>Cancel</button> : <span className="text-xs text-muted">{step+1} of 6</span>}</div>
    <div className="grid grid-cols-6 gap-1">{PROFILE_STEPS.map((s,i)=>editing ? <button key={s} type="button" onClick={()=>setStep(i)} className="text-left"><div className={`h-1.5 rounded-full ${i===step?"bg-white":"bg-line hover:bg-zinc-600"}`}/><div className={`mt-1 text-center text-[10px] ${i===step?"text-white":"text-muted hover:text-white"}`}>{s}</div></button> : <div key={s}><div className={`h-1.5 rounded-full ${i<=step?"bg-white":"bg-line"}`}/><div className="mt-1 text-center text-[9px] text-muted">{s}</div></div>)}</div>
  {step===0 && <div className="space-y-4"><h3 className="text-lg font-semibold">First, the basics.</h3><p className="text-sm text-muted">Upload your resume and we'll extract education, experience, skills, and projects. Review everything before saving.</p><label onDragOver={e=>{e.preventDefault();setDrag(true);}} onDragLeave={()=>setDrag(false)} onDrop={e=>{e.preventDefault();setDrag(false);acceptResume(e.dataTransfer.files?.[0]);}} className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed p-6 text-center ${drag?"border-white bg-card":"border-line"}`}><span className="text-2xl">⇧</span><strong className="text-sm">Upload your resume</strong><span className="text-xs text-muted">PDF or DOCX · Max 10 MB · Drop a file here</span><input type="file" className="max-w-full text-xs" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={e=>acceptResume(e.target.files?.[0])}/>{file && <span className="text-xs text-emerald-400">✓ {file}</span>}</label><AutoField title="College / University" value={p.school} onChange={v=>set("school",v)} options={COLLEGE_SUGGESTIONS} placeholder="e.g. Colby College"/><div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]"><TagInput title="Majors / fields of study" values={list("major")} onChange={setList("major")} options={MAJOR_SUGGESTIONS} placeholder="e.g. Economics" hint="Press Enter to add each one."/><div><label className={label}>Graduation year</label><Select value={p.graduationYear} onChange={v=>set("graduationYear",v)} options={Array.from({length:10},(_,i)=>String(2025+i)).map(v=>[v,v])}/></div></div></div>}
  {step===1 && <div className="space-y-4"><h3 className="text-lg font-semibold">What are you into?</h3><p className="text-sm text-muted">Choose anything that interests you, even if it isn't related to your major.</p><Chips values={[...interestOptions, ...customInterests]} selected={p.interests} onChange={v=>set("interests",v)}/><TagInput title="Add your own" values={[]} onChange={items=>set("interests",[...p.interests, ...items.filter(item=>!p.interests.some(existing=>existing.toLowerCase()===item.toLowerCase()))])} options={INTEREST_SUGGESTIONS} placeholder="Guitar building, trail running, photography…" hint="Press Enter after each one. It's added to the bubbles above."/></div>}
  {step===2 && <div className="space-y-5"><h3 className="text-lg font-semibold">Where do you want to go?</h3><TagInput title="Roles that interest you" values={list("targetRoles")} onChange={setList("targetRoles")} options={ROLE_SUGGESTIONS} placeholder="eCommerce, brand marketing, software engineering…" hint="Press Enter after each role."/><div className="space-y-2"><TagInput title="Dream companies or brands" values={list("dreamCompanies")} onChange={setList("dreamCompanies")} options={COMPANY_SUGGESTIONS} placeholder="Type a company and press Enter"/>{brandIdeas.length>0 && <div><p className="mb-1.5 text-xs text-faint">Suggested from your interests</p><div className="flex flex-wrap gap-1.5">{brandIdeas.map(brand=><button key={brand} type="button" onClick={()=>setList("dreamCompanies")([...list("dreamCompanies"), brand])} className="rounded-full border border-line px-3 py-1 text-xs text-zinc-300 hover:border-zinc-500 hover:text-white">+ {brand}</button>)}</div></div>}</div><div><label className={label}>Work location preference</label><Select value={p.workPreference} onChange={v=>set("workPreference",v)} options={[["either","Open to anything"],["remote","Remote only"],["hybrid","Hybrid preferred"],["onsite","In-person preferred"]]}/></div>{p.workPreference==="remote" ? <p className="rounded-xl border border-line px-3 py-2 text-sm text-muted">Remote only, so no city is needed. Switch the preference above to add places.</p> : <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem] sm:items-start"><TagInput title="Where would you like to work?" values={locations} onChange={items=>set("locations",joinProfileList(items))} options={LOCATION_SUGGESTIONS} commaAdds={false} placeholder="e.g. New York, NY" format={place=>formatLocation(parseLocation(place).place, Number(miles)||null)} display={showLocation} hint="Pick a distance, then type a city and press Enter."/><div><label className={label}>Distance</label><Select value={miles} onChange={setMiles} options={RADIUS_OPTIONS}/></div></div>}</div>}
  {step===3 && <div className="space-y-4"><h3 className="text-lg font-semibold">What are you hoping to get out of this?</h3><p className="text-sm text-muted">Pick as many as you like.</p><label className={label}>My networking goals</label><Chips values={goalOptions} selected={p.goals} onChange={v=>set("goals",v)}/><label className={label}>Who would you like to connect with?</label><Chips values={contactOptions} selected={p.contactTypes} onChange={v=>set("contactTypes",v)}/><div><label className={label}>Preferred experience level</label><Select value={p.seniority} onChange={v=>set("seniority",v)} options={[["balanced","A mix of experience levels"],["early","Early-career professionals"],["manager","Managers and directors"],["executive","Founders and executives"]]}/></div></div>}
  {step===4 && <div className="space-y-4"><h3 className="text-lg font-semibold">What should people know about you?</h3><p className="text-sm text-muted">These details help write personal emails without inventing anything.</p><TextField title="Tell us a little about yourself" multiline value={p.bio} onChange={v=>set("bio",v)} placeholder="What do you care about? What makes you interesting?"/><TextField title="Experiences or accomplishments you're proud of" multiline value={p.accomplishments} onChange={v=>set("accomplishments",v)} placeholder="Projects, jobs, athletics, volunteering…"/><TextField title="Anything you don't want mentioned in outreach?" multiline value={p.excludedTopics} onChange={v=>set("excludedTopics",v)} placeholder="Optional topics to avoid"/></div>}
  {step===5 && <div className="space-y-4"><h3 className="text-lg font-semibold">Your profile is ready to review.</h3><p className="text-sm text-muted">Check your details before saving. {editing ? "Click a section above to change it." : "Use Back to make changes."}</p><div className="space-y-3 rounded-xl bg-card p-4 text-sm"><p><strong>Education:</strong> {p.school||"Not provided"} · {listText(p.major,"No major")} · {p.graduationYear}</p><p><strong>Interests:</strong> {p.interests.join(", ")||"Not provided"}</p><p><strong>Target roles:</strong> {listText(p.targetRoles,"Not specified")}</p><p><strong>Dream companies:</strong> {listText(p.dreamCompanies,"Not specified")}</p><p><strong>Locations:</strong> {p.workPreference==="remote" ? "Remote only" : locations.map(showLocation).join(", ")||"Anywhere"}</p><p><strong>Goals:</strong> {p.goals.join(", ")||"Not specified"}</p><p><strong>Preferred contacts:</strong> {p.contactTypes.join(", ")||"Not specified"}</p><p><strong>Your story:</strong> {p.bio||"Not provided"}</p><p><strong>Accomplishments:</strong> {p.accomplishments||"Not provided"}</p><p><strong>Do not mention:</strong> {p.excludedTopics||"None"}</p></div></div>}
  <div className="flex justify-between gap-2 border-t border-line pt-4"><button className={secondary} disabled={step===0} onClick={()=>setStep(s=>Math.max(0,s-1))}>← Back</button><div className="flex gap-2">{editing && step<5 && <button className={secondary} disabled={saving} onClick={save}>{saving?"Saving…":"Save changes"}</button>}{step<5?<button className={primary} onClick={()=>setStep(s=>Math.min(5,s+1))}>Continue →</button>:<button className={primary} disabled={saving} onClick={save}>{saving?"Organizing…":editing?"Save changes":"Save My Profile →"}</button>}</div></div></section>;
}

export type Highlight = { id: string; label: string; detail: string; category: string; experienceDetails: string | null };
