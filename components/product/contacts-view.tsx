"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { Filter, Mail, MapPin, RefreshCw, Search, Send, X } from "lucide-react";
import { Avatar, Notice, PageLoading } from "@/components/product/bits";
import { COMPANIES, COMPANY_SIZES, DEPARTMENTS, INDUSTRIES, JOB_TITLES, LOCATIONS, SENIORITIES } from "@/lib/catalog";
import { SCHOOLS } from "@/lib/schools";
import type { ComposerFact } from "@/lib/email/grounded";

type Person = {
  id: string;
  fullName: string;
  title: string;
  company: string;
  location: string;
  school: string | null;
  email: string | null;
  phone: string | null;
  emailAvailable: boolean;
  phoneAvailable: boolean;
  tags: string[];
  unlocked: boolean;
  emailed?: boolean;
  savedId: string | null;
  dataSource: "sample" | "provider";
};

type Filters = {
  titles: string[];
  industries: string[];
  locations: string[];
  schools: string[];
  includeSimilarSchools: boolean;
  companies: string[];
  seniorities: string[];
  departments: string[];
  companySizes: string[];
};

const EMPTY: Filters = { titles: [], industries: [], locations: [], schools: [], includeSimilarSchools: true, companies: [], seniorities: [], departments: [], companySizes: [] };
const PAGE_SIZE = 20;
const SAMPLE_NOTICE = "Sample directory. These profiles are illustrative and are not live Apollo results. A search saves the list to your contacts.";

export function ContactsView() {
  const params = useSearchParams();
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [people, setPeople] = useState<Person[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState<string | null>(null);
  const [source, setSource] = useState<string>("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [composerId, setComposerId] = useState<string | null>(params.get("compose"));
  const [extraOpen, setExtraOpen] = useState(false);
  const [searched, setSearched] = useState(false);
  const [idleNotice, setIdleNotice] = useState(SAMPLE_NOTICE);

  useEffect(() => {
    const company = params.get("company");
    if (company) setFilters((current) => ({ ...current, companies: [company] }));
  }, [params]);

  useEffect(() => {
    fetch("/api/health")
      .then((response) => response.json())
      .then((data) => {
        if (data.providers?.apollo) setIdleNotice("");
        else if (data.sampleDirectory === false) setIdleNotice("Add an Apollo API key to search live professionals.");
        else setIdleNotice(SAMPLE_NOTICE);
      })
      .catch(() => undefined);
  }, []);

  async function run(next = filters, nextPage = page) {
    setLoading(true);
    setError("");
    const response = await fetch("/api/contacts/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...next, page: nextPage, pageSize: PAGE_SIZE, idempotencyKey: nextPage === 1 ? crypto.randomUUID() : undefined }),
    });
    const data = await response.json();
    setLoading(false);
    if (!response.ok) {
      setError(data.error || "Search failed.");
      setPeople([]);
      return;
    }
    setPeople(data.people);
    setTotal(data.total);
    setNotice(data.notice);
    setSource(data.source);
    setPage(nextPage);
    setSearched(true);
    if (typeof data.balance === "number") window.dispatchEvent(new CustomEvent("unnepo-credits", { detail: data.balance }));
  }

  function markEmailed(contactId: string) {
    setPeople((current) => current.map((item) => (item.id === contactId ? { ...item, emailed: true } : item)));
  }

  const chips = useMemo(() => {
    const items: Array<{ key: keyof Filters; label: string }> = [];
    filters.titles.forEach((label) => items.push({ key: "titles", label }));
    filters.industries.forEach((label) => items.push({ key: "industries", label }));
    filters.locations.forEach((label) => items.push({ key: "locations", label }));
    filters.schools.forEach((school) => items.push({ key: "schools", label: filters.includeSimilarSchools ? `${school} (and similar)` : school }));
    filters.companies.forEach((label) => items.push({ key: "companies", label }));
    return items;
  }, [filters]);

  function removeChip(key: keyof Filters, label: string) {
    const clean = label.replace(" (and similar)", "");
    setFilters({ ...filters, [key]: (filters[key] as string[]).filter((item) => item !== clean) });
  }

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const banner = searched ? notice : idleNotice;

  return (
    <div className="px-4 py-5 lg:px-6">
      <p className="text-[11px] font-semibold tracking-[0.18em] text-faint">FIND NEW CONTACTS</p>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight md:text-5xl">Find the right people.</h1>
      <p className="mt-2 max-w-3xl text-muted">Search by job title, industry, location, school (or similar schools), and company to find relevant professionals and get their emails and phone numbers.</p>
      {banner ? <div className="mt-4"><Notice>{banner}</Notice></div> : null}
      {error ? <p className="mt-3 text-sm text-red-300">{error}</p> : null}
      <div className="mt-5 grid gap-3 xl:grid-cols-5">
        <FilterBox label="JOB TITLE" icon={<Search className="h-3.5 w-3.5" />} options={JOB_TITLES} selected={filters.titles} onChange={(titles) => setFilters({ ...filters, titles })} />
        <FilterBox label="INDUSTRY" options={INDUSTRIES} selected={filters.industries} onChange={(industries) => setFilters({ ...filters, industries })} />
        <FilterBox label="LOCATION" icon={<MapPin className="h-3.5 w-3.5" />} options={LOCATIONS} selected={filters.locations} onChange={(locations) => setFilters({ ...filters, locations })} />
        <FilterBox label="SCHOOL / SIMILAR SCHOOLS" options={[...SCHOOLS]} selected={filters.schools} onChange={(schools) => setFilters({ ...filters, schools })} />
        <FilterBox label="COMPANY (OPTIONAL)" options={COMPANIES} selected={filters.companies} onChange={(companies) => setFilters({ ...filters, companies })} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {chips.map((chip) => (
          <button key={`${chip.key}-${chip.label}`} onClick={() => removeChip(chip.key, chip.label)} className="inline-flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1 text-xs">
            {chip.label} <X className="h-3 w-3" />
          </button>
        ))}
        <button className="ml-auto text-sm text-muted" onClick={() => { setFilters(EMPTY); setSearched(false); setPeople([]); setTotal(0); setNotice(null); setError(""); }}>Clear all</button>
        <button onClick={() => run(filters, 1)} disabled={loading} className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black disabled:opacity-60">{loading ? "Searching…" : "Show me 20 people (1 credit)"}</button>
      </div>
      {searched ? (
      <>
      {loading && people.length === 0 ? <PageLoading label="Finding people…" /> : null}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{loading ? "Searching…" : `${total} professional${total === 1 ? "" : "s"} found`}</h2>
        <div className="flex items-center gap-2">
          <button onClick={() => setExtraOpen((value) => !value)} className="inline-flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm"><Filter className="h-4 w-4" /> Filters</button>
          <span className="rounded-xl border border-line px-3 py-2 text-sm text-muted">Sort by: Relevance</span>
        </div>
      </div>
      {extraOpen ? (
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <FilterBox label="SENIORITY" options={SENIORITIES} selected={filters.seniorities} onChange={(seniorities) => setFilters({ ...filters, seniorities })} />
          <FilterBox label="DEPARTMENT" options={DEPARTMENTS} selected={filters.departments} onChange={(departments) => setFilters({ ...filters, departments })} />
          <FilterBox label="COMPANY SIZE" options={COMPANY_SIZES} selected={filters.companySizes} onChange={(companySizes) => setFilters({ ...filters, companySizes })} />
        </div>
      ) : null}
      <div className="app-scroll mt-4 overflow-x-auto rounded-2xl border border-line">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="text-[11px] tracking-wide text-faint">
            <tr>
              <th className="px-3 py-3"><input type="checkbox" checked={selected.length === people.length && people.length > 0} onChange={(event) => setSelected(event.target.checked ? people.map((person) => person.id) : [])} /></th>
              <th>NAME / TITLE</th><th>COMPANY</th><th>LOCATION</th><th>SCHOOL</th><th>CONTACT</th><th>TAGS</th><th />
            </tr>
          </thead>
          <tbody>
            {people.map((person) => (
              <tr key={person.id} className="border-t border-line">
                <td className="px-3 py-3"><input type="checkbox" checked={selected.includes(person.id)} onChange={(event) => setSelected(event.target.checked ? [...selected, person.id] : selected.filter((id) => id !== person.id))} /></td>
                <td className="py-3">
                  <div className="flex items-center gap-3">
                    <Avatar name={person.fullName} />
                    <div>
                      <p className="font-medium">{person.fullName}</p>
                      <p className="text-xs text-faint">{person.title}</p>
                    </div>
                  </div>
                </td>
                <td>{person.company}</td>
                <td className="text-muted">{person.location}</td>
                <td className="text-muted">{person.school || "—"}</td>
                <td>
                  <p className="flex items-center gap-1 text-xs"><Mail className="h-3 w-3" /> {person.unlocked ? person.email || "No email on file" : person.emailAvailable ? "Work email on file" : "Email unavailable"}</p>
                  <p className="mt-1 text-xs text-faint">{person.unlocked ? person.phone || "No phone on file" : person.phoneAvailable ? "Business phone on file" : "Phone unavailable"}</p>
                </td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    {person.tags.map((tag) => <span key={tag} className="rounded-md bg-card-2 px-2 py-0.5 text-[11px] text-muted">{tag}</span>)}
                    {person.dataSource === "sample" ? <span className="rounded-md border border-gold/40 px-2 py-0.5 text-[11px] text-cream">Sample</span> : null}
                  </div>
                </td>
                <td className="pr-3 text-right">
                  {person.emailed ? (
                    <span className="inline-flex rounded-lg border border-line px-3 py-2 text-xs font-semibold text-muted">Email sent</span>
                  ) : (
                    <button onClick={() => setComposerId(person.id)} className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-black">Send personalized email</button>
                  )}
                </td>
              </tr>
            ))}
            {people.length === 0 && !loading ? <tr><td colSpan={8} className="px-4 py-10 text-muted">{notice || "No professionals matched those filters. Try a shorter title or another city."}</td></tr> : null}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center justify-between text-sm text-muted">
        <span>{source === "sample" ? "Sample directory" : source === "apollo" ? "Apollo" : ""}</span>
        <div className="flex items-center gap-2">
          <button disabled={page <= 1} onClick={() => run(filters, page - 1)} className="rounded-lg border border-line px-3 py-1 disabled:opacity-40">Previous</button>
          <span>{page} / {pages}</span>
          <button disabled={page >= pages} onClick={() => run(filters, page + 1)} className="rounded-lg border border-line px-3 py-1 disabled:opacity-40">Next</button>
        </div>
      </div>
      </>
      ) : null}
      {composerId ? <Composer contactId={composerId} onClose={() => setComposerId(null)} onSent={() => markEmailed(composerId)} /> : null}
    </div>
  );
}

function FilterBox({ label, icon, options, selected, onChange }: { label: string; icon?: React.ReactNode; options: string[]; selected: string[]; onChange: (values: string[]) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const needle = query.trim().toLowerCase();
  const matches = options.filter((option) => option.toLowerCase().includes(needle) && !selected.includes(option)).slice(0, 8);
  const canAdd = needle.length > 1 && !options.some((option) => option.toLowerCase() === needle) && !selected.some((option) => option.toLowerCase() === needle);

  function add(value: string) {
    const next = value.trim();
    if (!next || selected.includes(next)) return;
    onChange([...selected, next]);
    setQuery("");
    setOpen(true);
  }

  return (
    <div className="relative rounded-xl border border-line bg-card px-3 py-2">
      <p className="text-[10px] font-semibold tracking-[0.14em] text-faint">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        {icon}
        <input
          value={query}
          placeholder={selected.length ? selected.join(", ") : "Type to search"}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add(matches[0] || query);
            }
          }}
          className="w-full bg-transparent text-sm outline-none placeholder:text-muted"
        />
      </div>
      {open && (needle || matches.length) ? (
        <div className="absolute left-0 right-0 z-20 mt-2 max-h-56 overflow-auto rounded-xl border border-line bg-panel p-1 shadow-xl">
          {matches.map((option) => (
            <button key={option} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => add(option)} className="block w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-white/5">
              {option}
            </button>
          ))}
          {canAdd ? (
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => add(query.trim())} className="block w-full rounded-lg px-2 py-1.5 text-left text-sm text-muted hover:bg-white/5">
              Add “{query.trim()}”
            </button>
          ) : null}
          {needle && matches.length === 0 && !canAdd ? <p className="px-2 py-1.5 text-sm text-faint">Already added</p> : null}
        </div>
      ) : null}
    </div>
  );
}

export function Composer({ contactId, onClose, onSent }: { contactId: string; onClose: () => void; onSent?: () => void }) {
  const [context, setContext] = useState<{ contact: Person; saved: { id: string }; you: ComposerFact[]; lead: ComposerFact[]; email: string | null } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [tone, setTone] = useState("professional");
  const [purpose, setPurpose] = useState("networking");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/email/context", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contactId }) })
      .then((response) => response.json())
      .then((data) => {
        if (data.error) {
          setMessage(data.error);
          return;
        }
        setContext(data);
        const defaults = [...data.you, ...data.lead]
          .filter((fact: ComposerFact) => fact.available && (fact.shared || /^(education|experience|internship|interest|current_role|school)/.test(fact.key)))
          .slice(0, 6)
          .map((fact: ComposerFact) => fact.id);
        setSelected(defaults);
      });
  }, [contactId]);

  function toggle(id: string, available: boolean) {
    if (!available) return;
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  async function generate() {
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/email/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactId, factIds: selected, tone, purpose, attachResume: selected.includes("you:resume") }),
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setMessage(data.error || "Could not generate an email.");
      return;
    }
    setSubject(data.subject);
    setBody(data.body);
  }

  async function send(delivery: "provider" | "demo_outbox") {
    const savedId = context?.saved.id;
    if (!savedId) return;
    setBusy(true);
    const response = await fetch("/api/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ savedContactId: savedId, subject, body, delivery, idempotencyKey: crypto.randomUUID() }),
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setMessage(data.error || "Send failed.");
      return;
    }
    if (data.message?.deliveryConfirmed) onSent?.();
    setMessage(data.message?.deliveryConfirmed ? "Sent from your connected mailbox." : "Saved to the demo outbox. Connect Gmail or Outlook to deliver it. No credit was used.");
  }

  async function saveDraft() {
    const savedId = context?.saved.id;
    if (!savedId) return;
    await fetch("/api/email/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "draft", savedContactId: savedId, subject, body, tone, purpose }) });
    setMessage("Draft saved. Drafts are free.");
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/70" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(980px,calc(100%-1.5rem))] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-2xl border border-line bg-[#121214] p-5 shadow-2xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-2xl font-semibold">Write your email</Dialog.Title>
              <Dialog.Description className="text-sm text-muted">Use AI to generate a personalized outreach email. It&apos;s free to send.</Dialog.Description>
            </div>
            <Dialog.Close className="rounded-lg p-1 text-muted hover:bg-white/5" aria-label="Close"><X /></Dialog.Close>
          </div>
          {!context ? <PageLoading label={message || "Loading facts from your profile…"} /> : (
            <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr]">
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <Avatar name={context.contact.fullName} className="h-12 w-12" />
                  <div>
                    <p className="font-semibold">{context.contact.fullName}</p>
                    <p className="text-sm text-muted">{context.contact.title}</p>
                    <p className="text-sm text-faint">{context.contact.company}</p>
                  </div>
                </div>
                <FactGroup title="1. Things about you" copy="Select what to include from your background." facts={context.you} selected={selected} onToggle={toggle} />
                <FactGroup title="2. Things about the target lead" copy="We'll only use facts that are actually on file." facts={context.lead} selected={selected} onToggle={toggle} />
              </div>
              <div className="rounded-2xl border border-line bg-card p-4">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="rounded-lg bg-white px-2 py-1 text-xs font-semibold text-black">AI generated</span>
                  <select value={purpose} onChange={(event) => setPurpose(event.target.value)} className="rounded-lg border border-line bg-transparent px-2 py-1">
                    <option value="networking">Networking</option>
                    <option value="internship">Internship</option>
                    <option value="full_time">Full-time</option>
                    <option value="informational">Informational</option>
                    <option value="mentorship">Mentorship</option>
                  </select>
                  <select value={tone} onChange={(event) => setTone(event.target.value)} className="rounded-lg border border-line bg-transparent px-2 py-1">
                    <option value="professional">Tone: Professional</option>
                    <option value="friendly">Tone: Friendly</option>
                    <option value="casual">Tone: Casual</option>
                    <option value="direct">Tone: Direct</option>
                  </select>
                </div>
                <p className="mt-3 text-xs text-faint">To {context.email || "No email on file yet"}</p>
                <input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Subject" className="mt-2 w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm outline-none" />
                <textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder="Generate a short paragraph from the bubbles you selected." className="mt-2 h-40 w-full resize-none rounded-lg border border-line bg-transparent px-3 py-2 text-sm outline-none" />
                {message ? <p className="mt-2 text-sm text-cream">{message}</p> : null}
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  <button onClick={generate} disabled={busy} className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm"><RefreshCw className="h-4 w-4" /> {body ? "Regenerate" : "Generate"}</button>
                  <button onClick={() => navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`)} className="rounded-lg border border-line px-3 py-2 text-sm">Copy</button>
                  <button onClick={saveDraft} className="rounded-lg border border-line px-3 py-2 text-sm">Save draft</button>
                  <button onClick={() => send("provider")} className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-black"><Send className="h-4 w-4" /> Send</button>
                  <button onClick={() => send("demo_outbox")} className="rounded-lg border border-line px-3 py-2 text-sm">Demo outbox</button>
                </div>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function FactGroup({ title, copy, facts, selected, onToggle }: { title: string; copy: string; facts: ComposerFact[]; selected: string[]; onToggle: (id: string, available: boolean) => void }) {
  return (
    <section className="rounded-2xl border border-line p-3">
      <h3 className="font-semibold">{title}</h3>
      <p className="text-xs text-faint">{copy}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {facts.map((fact) => {
          const on = selected.includes(fact.id);
          const shared = Boolean(fact.shared && fact.available);
          return (
            <button
              key={fact.id}
              type="button"
              disabled={!fact.available}
              onClick={() => onToggle(fact.id, fact.available)}
              title={fact.available ? fact.detail : "Not on file"}
              className={`max-w-full rounded-full border px-3 py-1.5 text-left text-sm ${
                !fact.available
                  ? "cursor-not-allowed border-line text-faint opacity-50"
                  : shared
                    ? on
                      ? "border-[#e6c15a] bg-[#e6c15a]/20 text-cream"
                      : "border-[#e6c15a] text-cream"
                    : on
                      ? "border-white bg-white text-black"
                      : "border-line text-muted hover:border-zinc-500"
              }`}
            >
              <span className="block">{fact.available ? fact.label : `${fact.label} · not on file`}</span>
              {shared ? <span className="block text-[10px] leading-tight text-[#e6c15a]">You both share this</span> : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}
