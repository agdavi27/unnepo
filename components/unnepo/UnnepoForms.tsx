"use client";

/* The supplied form copy uses apostrophes. Keep that text as written. */
/* eslint-disable react/no-unescaped-entities */

import React, { useId, useMemo, useState } from "react";
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
export type Contact = { id: string; name: string; title: string; company: string; email?: string; status?: string; foundAt?: string; location?: string; photoUrl?: string; links?: { kind: "linkedin" | "x" | "github" | "facebook"; url: string }[]; facts: { id: string; text: string; verified: boolean }[] };
export type SearchRequest = { mode: "automatic" | "custom"; quantity: number; credits: number; prompt?: string; filters?: Record<string, unknown> };

const btn = "inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const primary = `${btn} bg-white text-black hover:bg-zinc-200`;
const secondary = `${btn} border border-line bg-transparent text-ink hover:bg-white/5`;
const field = "w-full rounded-xl border border-line bg-card px-3 py-2.5 text-sm text-ink outline-none placeholder:text-faint focus:border-zinc-500";
const card = "rounded-2xl border border-line bg-panel p-5 sm:p-6";
const label = "mb-1.5 block text-xs font-medium text-muted";
const quantities = Array.from({ length: 10 }, (_, i) => (i + 1) * 25);
const Toggle = ({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) => <button type="button" onClick={onClick} className={`${btn} border text-left ${active ? "border-white bg-white text-black" : "border-line text-zinc-300 hover:bg-white/5"}`}>{active ? "✓ " : "+ "}{children}</button>;
const Chips = ({ values, selected, onChange }: { values: string[]; selected: string[]; onChange: (next: string[]) => void }) => <div className="flex flex-wrap gap-2">{values.map(v => <Toggle key={v} active={selected.includes(v)} onClick={() => onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v])}>{v}</Toggle>)}</div>;
const Quantity = ({ value, onChange }: { value: number; onChange: (n: number) => void }) => <div><div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-semibold">How many people?</h3><span className="text-sm text-muted">{value / 25} {value === 25 ? "credit" : "credits"}</span></div><div className="grid grid-cols-5 gap-2">{quantities.map(n => <button type="button" key={n} onClick={() => onChange(n)} className={`rounded-lg border p-2 text-center transition ${value === n ? "border-white bg-white/10 ring-1 ring-white" : "border-line hover:bg-white/5"}`}><div className="text-sm font-semibold">{n}</div><div className="text-[10px] text-muted">{n / 25} cr</div></button>)}</div></div>;
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

export function FindForMe({ profileReady, onSearch, onEditProfile, loading = false }: { profileReady: boolean; onSearch: (request: SearchRequest) => void | Promise<void>; onEditProfile: (action: "resume" | "profile" | "reset") => void; loading?: boolean }) {
  const [quantity, setQuantity] = useState(25);
  const [editing, setEditing] = useState(false);
  return <section className={`${card} space-y-6`}><div><h2 className="text-xl font-semibold tracking-tight">Find for Me</h2><p className="mt-1 text-sm text-muted">We'll find relevant professionals based on your resume, interests, experience, and career goals. No filters needed.</p></div><div className="flex items-center justify-between gap-3 rounded-xl border border-line px-4 py-3"><div className="min-w-0"><p className="text-sm font-medium">Your personal profile</p><p className="text-xs text-muted">{profileReady ? "✓ Ready · used automatically to identify people worth meeting" : "Setup required"}</p></div><button className={`${secondary} shrink-0`} onClick={() => setEditing(!editing)}>Edit Profile</button></div>{editing && <div className="space-y-2 rounded-xl border border-line p-3"><p className="text-sm font-semibold">Update your profile</p>{([ ["resume", "Re-upload resume"], ["profile", "Remake personal profile"], ["reset", "Start over (profile only)"] ] as const).map(([v,t]) => <button key={v} className={`${secondary} w-full justify-start`} onClick={() => { onEditProfile(v); setEditing(false); }}>{t}</button>)}</div>}<Quantity value={quantity} onChange={setQuantity}/><button className={`${primary} w-full py-3`} disabled={!profileReady || loading} onClick={() => onSearch({ mode: "automatic", quantity, credits: quantity / 25 })}>{loading ? "Finding people…" : `Find ${quantity} People · ${quantity / 25} ${quantity === 25 ? "Credit" : "Credits"}`}</button><p className="text-center text-xs text-muted">Up to {quantity} new contacts with verified work emails where available. You're only charged for people found, 1 credit per 25.</p></section>;
}

const suggestions: { category: string; label: string; prompt: string }[] = [
  {category:"School connections",label:"Alumni from my school",prompt:"Find alumni from my college working in industries relevant to my interests."},
  {category:"School connections",label:"People with similar backgrounds",prompt:"Find professionals with educational or professional backgrounds similar to mine."},
  {category:"School connections",label:"Recent graduates in my field",prompt:"Find early-career professionals in my field who graduated recently."},
  {category:"Career opportunities",label:"Recruiters in my target industry",prompt:"Find talent acquisition professionals and recruiters working in my target industry."},
  {category:"Career opportunities",label:"Hiring managers",prompt:"Find managers leading teams relevant to my skills and career goals."},
  {category:"Career opportunities",label:"People who could refer me",prompt:"Find employees at companies I am interested in who may be appropriate contacts for advice or referrals."},
  {category:"Career exploration",label:"People with my dream job",prompt:"Find professionals currently working in roles I want to pursue."},
  {category:"Career exploration",label:"People who changed careers",prompt:"Find professionals who transitioned into the career path I want."},
  {category:"Career exploration",label:"People with similar career paths",prompt:"Find professionals with career progressions similar to my goals."},
  {category:"Companies",label:"People at my dream companies",prompt:"Find relevant professionals at companies matching my interests."},
  {category:"Companies",label:"Founders at growing startups",prompt:"Find founders and operators at growing startups in my industries."},
  {category:"Companies",label:"People at small companies",prompt:"Find professionals at smaller companies in my target industry."},
  {category:"Location",label:"Professionals in a specific city",prompt:"Find professionals in my target industry working in my preferred city."},
  {category:"Location",label:"Professionals near me",prompt:"Find professionals in my preferred geographic area."},
];
export function CustomSearch({ onSearch, loading = false }: { onSearch: (request: SearchRequest) => void | Promise<void>; loading?: boolean }) {
  const [prompt,setPrompt] = useState(""); const [suggestion,setSuggestion] = useState(""); const [quantity,setQuantity] = useState(25); const [advanced,setAdvanced] = useState(false);
  const [filters,setFilters] = useState<Record<string,string>>({ title:"", company:"", industry:"", location:"", school:"", seniority:"any", companySize:"any", previousEmployer:"", experience:"any", graduationYear:"" });
  const [recent,setRecent] = useState(false); const [excludeSaved,setExcludeSaved] = useState(true);
  const update = (key:string) => (v:string) => setFilters(p => ({...p,[key]:v}));
  const hasSearch = prompt.trim() || Object.entries(filters).some(([k,v]) => v && v !== "any" && !["previousEmployer","experience","graduationYear"].includes(k));
  return <section className={`${card} space-y-5`}><div><h2 className="text-xl font-semibold tracking-tight">Custom Search</h2><p className="mt-1 text-sm text-muted">Find exactly the kind of people you want to connect with.</p></div><div><label className={label}>Start with a suggested search</label><select className={field} value={suggestion} onChange={e => { const v=e.target.value; setSuggestion(v); setPrompt(suggestions.find(s=>s.label===v)?.prompt || ""); }}><option value="">Choose a search idea…</option>{[...new Set(suggestions.map(s=>s.category))].map(c=><optgroup key={c} label={c}>{suggestions.filter(s=>s.category===c).map(s=><option key={s.label} value={s.label}>{s.label}</option>)}</optgroup>)}</select></div><TextField title="Describe who you're looking for" multiline value={prompt} onChange={v=>{setPrompt(v);setSuggestion("");}} placeholder="e.g. Marketing managers at outdoor brands in Boston who went to a NESCAC college…"/><button type="button" className="flex w-full items-center justify-between border-t border-line pt-4 text-left text-sm font-medium" onClick={()=>setAdvanced(!advanced)}><span>Refine your search <span className="font-normal text-faint">· Optional</span></span><span className="text-muted">{advanced ? "Hide" : "Show"}</span></button>{advanced && <div className="space-y-4"><div className="grid gap-3 sm:grid-cols-2"><TextField title="Job title / role" value={filters.title} onChange={update("title")} placeholder="Marketing Manager, Product Manager…"/><TextField title="Company" value={filters.company} onChange={update("company")} placeholder="Patagonia, Fender…"/><TextField title="Industry" value={filters.industry} onChange={update("industry")} placeholder="Outdoor apparel, Technology…"/><TextField title="Location" value={filters.location} onChange={update("location")} placeholder="Boston, New York…"/><div><label className={label}>Seniority</label><Select value={filters.seniority} onChange={update("seniority")} options={[["any","Any level"],["entry","Recent graduate / Entry-level"],["associate","Associate"],["manager","Manager"],["director","Director"],["vp","VP / Executive"],["founder","Founder"]]}/></div><div className="sm:col-span-2"><label className={label}>Company size</label><Select value={filters.companySize} onChange={update("companySize")} options={[["any","Any company size"],["1-10","1–10"],["11-50","11–50"],["51-200","51–200"],["201-500","201–500"],["501-1000","501–1,000"],["1001+","1,001+"]]}/></div><TextField title="Previous employer" value={filters.previousEmployer} onChange={update("previousEmployer")} placeholder="Company name"/></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={recent} onChange={e=>setRecent(e.target.checked)}/>Prioritize recent graduates</label><p className="text-xs text-muted">Apollo can't filter people by school or graduation year, so those aren't offered here.</p></div>}<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={excludeSaved} onChange={e=>setExcludeSaved(e.target.checked)}/>Exclude people I've already found</label><div className="border-t border-line pt-5"><Quantity value={quantity} onChange={setQuantity}/></div><button className={`${primary} w-full py-3`} disabled={!hasSearch || loading} onClick={()=>onSearch({mode:"custom",quantity,credits:quantity/25,prompt,filters:{...filters,recent,excludeSaved,suggestion}})}>{loading ? "Finding people…" : `Find ${quantity} People · ${quantity / 25} ${quantity===25?"Credit":"Credits"}`}</button><p className="text-center text-xs text-muted">Up to {quantity} new contacts with verified work emails where available. You're only charged for people found, 1 credit per 25.</p></section>;
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

export type EmailDraft = { subject: string; body: string; attachResume?: boolean; studentFactIds: string[]; detailFactIds: string[]; contactFactIds: string[]; goal: string; tone: string; length: string; notes: string };
export type Highlight = { id: string; label: string; detail: string; category: string; experienceDetails: string | null };
const HIGHLIGHT_GROUPS: [string, string[]][] = [
  ["Experience", ["experience", "leadership"]],
  ["Projects & achievements", ["project", "achievement"]],
  ["Education & skills", ["education", "skill"]],
  ["Interests & goals", ["interest", "goal"]],
];
export function PersonalizedEmailModal({ open, onClose, contact, studentFacts, highlights = [], highlightsLoading = false, highlightsError = "", onRetryHighlights, onGenerate, onSend, onSaveDraft, connectedAccount, resumeFileName, generating = false, sending = false }: {
  open: boolean; onClose: () => void; contact: Contact; studentFacts: { id:string; text:string; verified:boolean }[];
  highlights?: Highlight[]; highlightsLoading?: boolean; highlightsError?: string; onRetryHighlights?: () => void;
  onGenerate: (input: Omit<EmailDraft,"subject"|"body">) => Promise<{subject:string;body:string}>;
  onSend: (draft:EmailDraft,contact:Contact) => void | Promise<void>; onSaveDraft?: (draft:EmailDraft,contact:Contact) => void | Promise<void>;
  connectedAccount?: string; resumeFileName?: string | null; generating?:boolean; sending?:boolean;
}) {
  const [step,setStep] = useState(0); const [myFacts,setMyFacts] = useState<string[]>([]); const [details,setDetails] = useState<string[]>([]); const [theirFacts,setTheirFacts] = useState<string[]>([]);
  const [goal,setGoal] = useState("chat"); const [tone,setTone] = useState("friendly"); const [length,setLength] = useState("short"); const [notes,setNotes] = useState("");
  const [subject,setSubject] = useState(""); const [body,setBody] = useState(""); const [error,setError] = useState(""); const [busy,setBusy] = useState(false); const [attachResume,setAttachResume] = useState(Boolean(resumeFileName));
  const approvedStudent = useMemo(()=>studentFacts.filter(f=>f.verified),[studentFacts]); const approvedContact=useMemo(()=>contact.facts.filter(f=>f.verified),[contact.facts]);
  if(!open)return null;
  const payload=()=>({studentFactIds:myFacts,detailFactIds:details.filter(d=>myFacts.includes(d)),contactFactIds:theirFacts,goal,tone,length,notes});
  const toggleMine=(factId:string)=>setMyFacts(prev=>prev.includes(factId)?prev.filter(x=>x!==factId):[...prev,factId]);
  const selectedJobs=highlights.filter(h=>h.experienceDetails&&myFacts.includes(h.id));
  const aboutYou = highlights.length ? <div className="space-y-4">{HIGHLIGHT_GROUPS.map(([groupName,cats])=>{const items=highlights.filter(h=>cats.includes(h.category));if(!items.length)return null;return <div key={groupName}><p className="mb-2 text-xs font-medium uppercase tracking-[0.12em] text-faint">{groupName}</p><div className="flex flex-wrap gap-2">{items.map(h=><Toggle key={h.id} active={myFacts.includes(h.id)} onClick={()=>toggleMine(h.id)}><span title={h.detail}>{h.label}</span></Toggle>)}</div></div>;})}{selectedJobs.length>0&&<div className="space-y-2 rounded-xl border border-line p-3">{selectedJobs.map(h=><label key={h.id} className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={details.includes(h.id)} onChange={()=>setDetails(prev=>prev.includes(h.id)?prev.filter(x=>x!==h.id):[...prev,h.id])}/><span><span className="font-medium">Include details about {h.label}</span><span className="mt-0.5 block text-xs text-muted">{h.experienceDetails}</span></span></label>)}</div>}</div>
    : highlightsLoading ? <p className="rounded-xl border border-line px-3 py-3 text-sm text-muted">Picking highlights from your profile…</p>
    : <div className="space-y-3">{highlightsError&&<p className="text-sm text-muted">{highlightsError}{onRetryHighlights&&<> <button type="button" className="underline underline-offset-4 hover:text-white" onClick={onRetryHighlights}>Try again</button></>}</p>}<Chips values={approvedStudent.map(f=>f.text)} selected={approvedStudent.filter(f=>myFacts.includes(f.id)).map(f=>f.text)} onChange={texts=>setMyFacts(approvedStudent.filter(f=>texts.includes(f.text)).map(f=>f.id))}/></div>;
  const draft=():EmailDraft=>({...payload(),subject,body,attachResume:attachResume&&Boolean(resumeFileName)});
  async function generate(){setBusy(true);setError("");try{const result=await onGenerate(payload());setSubject(result.subject);setBody(result.body);setStep(2);}catch(e){setError(e instanceof Error?e.message:"Could not generate email.");}finally{setBusy(false);}}
  return <div role="presentation" className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-3 sm:p-6"><div role="dialog" aria-modal="true" aria-label="Personalize your email" className="max-h-[calc(100vh-1.5rem)] w-full max-w-3xl space-y-5 overflow-y-auto rounded-2xl border border-line bg-panel p-5 shadow-2xl sm:p-7"><div className="flex justify-between gap-3"><div><h2 className="text-2xl font-bold">✉ Personalize your email</h2><p className="text-sm text-muted">{contact.name} · {contact.title} · {contact.company}</p></div><button aria-label="Close" className={secondary} onClick={onClose}>✕</button></div><div className="grid grid-cols-3 gap-1">{["Personalize","Your ask","Review & send"].map((s,i)=><div key={s}><div className={`h-1.5 rounded-full ${i<=step?"bg-white":"bg-line"}`}/><div className="mt-1 text-center text-[10px] text-muted">{s}</div></div>)}</div>
  {step===0 && <div className="space-y-4"><h3 className="text-lg font-semibold">What should we mention?</h3><p className="text-sm text-muted">Pick two or three highlights from your profile. Only what you select goes into the email. Hover a highlight to see the full detail.</p><div className="flex justify-between"><strong className="text-sm">About you</strong><span className="text-xs text-muted">{myFacts.length} selected</span></div>{aboutYou}<div className="flex justify-between border-t border-line pt-3"><strong className="text-sm">About {contact.name.split(" ")[0]}</strong><span className="text-xs text-muted">{theirFacts.length} selected</span></div><Chips values={approvedContact.map(f=>f.text)} selected={approvedContact.filter(f=>theirFacts.includes(f.id)).map(f=>f.text)} onChange={texts=>setTheirFacts(approvedContact.filter(f=>texts.includes(f.text)).map(f=>f.id))}/><div className="rounded-lg bg-card p-3 text-xs text-muted">Tip: Two or three relevant details usually work better than listing everything on your resume.</div></div>}
  {step===1 && <div className="space-y-4"><h3 className="text-lg font-semibold">What are you hoping for?</h3><div><label className={label}>What would you like to ask?</label><Select value={goal} onChange={setGoal} options={[["chat","A quick 15-minute conversation"],["advice","Career advice"],["referral","A referral or introduction"],["opportunity","Ask about opportunities"],["mentor","Mentorship"],["other","Something else"]]}/></div><div><label className={label}>Writing style</label><Select value={tone} onChange={setTone} options={[["friendly","Friendly and conversational"],["professional","Professional and polished"],["direct","Short and direct"],["casual","Casual and personable"]]}/></div><div><label className={label}>Email length</label><div className="flex flex-wrap gap-2">{[["very-short","Very short"],["short","Short"],["detailed","Detailed"]].map(([v,t])=><Toggle key={v} active={length===v} onClick={()=>setLength(v)}>{t}</Toggle>)}</div></div><TextField title="Anything else the AI should know?" multiline value={notes} onChange={setNotes} placeholder="e.g. Mention that I'm graduating soon…"/></div>}
  {step===2 && <div className="space-y-4"><h3 className="text-lg font-semibold">Review your email</h3><div className="rounded-lg bg-card p-3 text-sm"><p><strong>To:</strong> {contact.name} {contact.email ? `<${contact.email}>` : "· No verified email yet"}</p><p><strong>From:</strong> {connectedAccount || "Connect Gmail or Outlook in Settings to send"}</p></div><TextField title="Subject" value={subject} onChange={setSubject}/><TextField title="Email body" multiline value={body} onChange={setBody}/>{resumeFileName?<label className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5 text-sm"><input type="checkbox" checked={attachResume} onChange={e=>setAttachResume(e.target.checked)}/><span><span className="font-medium">Attach my resume</span><span className="ml-2 text-xs text-muted">📎 {resumeFileName}</span></span></label>:<p className="rounded-xl border border-line px-3 py-2.5 text-xs text-muted">Upload a resume in Settings to attach it to your emails.</p>}<div className="flex flex-wrap gap-2"><button className={secondary} disabled={busy||generating} onClick={generate}>↻ Regenerate</button>{onSaveDraft&&<button className={secondary} onClick={()=>onSaveDraft(draft(),contact)}>Save draft</button>}</div><p className="text-xs text-muted">Review every claim before sending. No message is sent without your approval.</p></div>}
  {error&&<p role="alert" className="text-sm text-red-400">{error}</p>}<div className="flex justify-between border-t border-line pt-4"><button className={secondary} disabled={step===0} onClick={()=>setStep(s=>Math.max(0,s-1))}>← Back</button>{step===0?<button className={primary} onClick={()=>setStep(1)}>Continue →</button>:step===1?<div className="flex flex-wrap justify-end gap-2"><button className={secondary} onClick={()=>{setSubject("");setBody("");setError("");setStep(2);}}>Write it yourself</button><button className={primary} disabled={busy||generating} onClick={generate}>{busy||generating?"Generating…":"✦ Generate Email"}</button></div>:<button className={primary} disabled={busy||sending||!contact.email||!connectedAccount||!subject.trim()||!body.trim()} onClick={()=>{if(!window.confirm(`Send this email to ${contact.name} from ${connectedAccount}${attachResume&&resumeFileName?` with ${resumeFileName} attached`:""}?`))return;setBusy(true);setError("");Promise.resolve(onSend(draft(),contact)).catch(e=>setError(e instanceof Error?e.message:"Could not send that email.")).finally(()=>setBusy(false));}}>{busy||sending?"Sending…":"Send Email →"}</button>}</div></div></div>;
}
