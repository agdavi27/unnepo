"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CustomSearch,
  FindForMe,
  PersonalizedEmailModal,
  ProfileOnboarding,
  emptyProfile,
  type Contact,
  type EmailDraft,
  type Highlight,
  type Profile,
  type SearchRequest,
} from "@/components/unnepo/UnnepoForms";
import { PUBLIC_PLANS } from "@/lib/config";

type StudentFact = { id: string; text: string; verified: boolean };
type Workspace = {
  user: { name: string; email: string };
  credits: { balance: number; plan: string; includedAllowance: number };
  profile: { ready: boolean; form: Profile; organizedProfile: unknown | null } | null;
  studentFacts: StudentFact[];
  highlights: Highlight[];
  resume: { id: string; fileName: string; byteSize: number } | null;
  contacts: Contact[];
  searches: { id: string; mode: string; quantity: number; creditsQuoted: number; status: string; resultCount: number; creditsCharged: number; prompt: string; createdAt: string }[];
  drafts: { id: string; contactId: string; subject: string; createdAt: string }[];
  integrations: { apollo: boolean; anthropic: boolean };
};

type View = "contacts" | "find" | "analytics" | "settings";
const VIEWS: { id: View; label: string }[] = [
  { id: "contacts", label: "My Contacts" },
  { id: "find", label: "Find New Contacts" },
  { id: "analytics", label: "Analytics" },
  { id: "settings", label: "Settings" },
];
const LEGACY_PLANS: Record<string, string> = { grind: "Grind (legacy)", pack: "Credit pack (legacy)" };

function ModelValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-faint">null</span>;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return <span>{String(value)}</span>;
  }
  if (Array.isArray(value)) {
    if (!value.length) return <span className="text-faint">[]</span>;
    return (
      <ul className="mt-1 space-y-2 border-l border-line pl-3">
        {value.map((item, index) => (
          <li key={index}>
            <ModelValue value={item} />
          </li>
        ))}
      </ul>
    );
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (!entries.length) return <span className="text-faint">{"{}"}</span>;
    return (
      <dl className="space-y-3">
        {entries.map(([key, item]) => (
          <div key={key}>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{key}</dt>
            <dd className="mt-0.5 text-sm text-zinc-200">
              <ModelValue value={item} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  return null;
}

export function AppHome() {
  const router = useRouter();
  const [data, setData] = useState<Workspace | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [view, setView] = useState<View>("find");
  const [tab, setTab] = useState<"find" | "custom">("find");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [emailContact, setEmailContact] = useState<Contact | null>(null);
  const [unlocking, setUnlocking] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [highlightsLoading, setHighlightsLoading] = useState(false);
  const [highlightsError, setHighlightsError] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/app/state");
    if (response.status === 401) {
      router.push("/login");
      return;
    }
    const body = await response.json();
    if (!response.ok) {
      setError(body.error || "Could not load your workspace.");
      return;
    }
    setData(body);
    setError("");
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/app/state")
      .then(async (response) => {
        if (response.status === 401) {
          router.push("/login");
          return null;
        }
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Could not load your workspace.");
        return body as Workspace;
      })
      .then((body) => {
        if (!cancelled && body) setData(body);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load your workspace.");
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
  }

  async function uploadResume(file: File) {
    const body = new FormData();
    body.set("file", file);
    const response = await fetch("/api/resume", { method: "POST", body });
    const payload = await response.json();
    if (!response.ok) {
      setNotice(payload.error || "Could not store that resume.");
      return;
    }
    setNotice(`Stored ${payload.resume.fileName}. The file is saved. AI parsing is not connected. Heading lines are kept for you to review when you save.`);
    await load();
  }

  async function saveProfile(profile: Profile) {
    setSaving(true);
    setNotice("Organizing your answers into profile facts…");
    try {
      const response = await fetch("/api/app/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setNotice(payload.error || "Could not save your profile.");
        return;
      }
      setEditing(false);
      setNotice(payload.organization === "anthropic" ? "Profile saved." : "Profile saved. The organizer did not return a profile.");
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function resetProfile() {
    if (!window.confirm("Clear your personal profile? Saved contacts, credits, and your resume file stay.")) return;
    const response = await fetch("/api/app/profile", { method: "DELETE" });
    if (!response.ok) {
      const payload = await response.json();
      setNotice(payload.error || "Could not reset your profile.");
      return;
    }
    setEditing(true);
    setNotice("Profile cleared. Contacts and credits were kept.");
    await load();
  }

  async function search(request: SearchRequest) {
    setSearching(true);
    setNotice("");
    setSearchError("");
    try {
      const response = await fetch("/api/app/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      const payload = await response.json().catch(() => ({ error: `The search request failed (${response.status}).` }));
      if (!response.ok) {
        setSearchError(payload.error || "The search did not run. No credits were used.");
        await load();
        return;
      }
      setNotice(payload.message || "Search finished.");
      await load();
    } catch {
      setSearchError("The search could not reach the server. No credits were used.");
    } finally {
      setSearching(false);
    }
  }

  async function findEmail(contact: Contact) {
    setUnlocking(contact.id);
    try {
      const response = await fetch("/api/app/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId: contact.id }),
      });
      const payload = await response.json();
      setNotice(payload.message || payload.error || "Could not look up that email.");
      await load();
    } finally {
      setUnlocking(null);
    }
  }

  async function deleteContacts(ids: string[]) {
    if (!ids.length) return;
    const label = ids.length === 1 ? "this contact" : `${ids.length} contacts`;
    if (!window.confirm(`Delete ${label} from My Contacts? Credits already used are not refunded.`)) return;
    setDeleting(true);
    try {
      const response = await fetch("/api/app/contacts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactIds: ids }),
      });
      const payload = await response.json();
      setNotice(payload.message || payload.error || "Could not delete those contacts.");
      if (response.ok) setSelected(new Set());
      await load();
    } finally {
      setDeleting(false);
    }
  }

  function toggleSelected(contactId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(contactId)) next.delete(contactId);
      else next.add(contactId);
      return next;
    });
  }

  async function requestUpgrade(planName: string) {
    const response = await fetch("/api/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan: planName }),
    });
    const payload = await response.json().catch(() => ({}));
    if (payload.url) {
      window.location.assign(payload.url);
      return;
    }
    setNotice(payload.error || "Upgrades are not available right now.");
  }

  async function buildHighlights() {
    setHighlightsLoading(true);
    setHighlightsError("");
    try {
      const response = await fetch("/api/app/highlights", { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setHighlightsError(payload.error || "Highlights could not be built right now.");
        return;
      }
      await load();
    } catch {
      setHighlightsError("Highlights could not be built right now.");
    } finally {
      setHighlightsLoading(false);
    }
  }

  function openComposer(contact: Contact) {
    setEmailContact(contact);
    if (data?.profile?.ready && !data.highlights.length && !highlightsLoading) void buildHighlights();
  }

  async function generateDraft(contact: Contact, input: Omit<EmailDraft, "subject" | "body">) {
    const response = await fetch("/api/app/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, contactId: contact.id }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not write that email.");
    return { subject: String(payload.subject ?? ""), body: String(payload.body ?? "") };
  }

  async function saveDraft(draft: EmailDraft, contact: Contact) {
    const response = await fetch("/api/app/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...draft, contactId: contact.id }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not save that draft.");
    setNotice("Draft saved. Nothing was sent.");
    await load();
  }

  const profile = data?.profile?.form ?? emptyProfile;
  const showOnboarding = !data?.profile?.ready || editing;

  const sectionTitle = "text-xs font-semibold uppercase tracking-[0.16em] text-faint";
  const peopleFound = data?.searches.reduce((sum, item) => sum + (item.resultCount ?? 0), 0) ?? 0;
  const creditsSpent = data?.searches.reduce((sum, item) => sum + item.creditsCharged, 0) ?? 0;

  const contacts = data?.contacts ?? [];
  const lastSearch = data?.searches.find((item) => item.status === "completed");
  const allSelected = contacts.length > 0 && contacts.every((contact) => selected.has(contact.id));
  const currentPlan = data?.credits.plan ?? "free";

  return (
    <div className="min-h-screen bg-bg text-ink [color-scheme:dark]">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 pt-4 sm:px-6 lg:px-8">
          <span className="text-2xl font-semibold tracking-tight">unnepo.</span>
          <div className="flex items-center gap-4 text-sm">
            {data && <span className="rounded-full border border-line px-3 py-1 text-muted"><span className="text-ink">{data.credits.balance}</span> credits</span>}
            <button type="button" onClick={logout} className="text-muted hover:text-white">Log out</button>
          </div>
        </div>
        {data && !showOnboarding ? (
          <nav className="mx-auto flex max-w-6xl gap-5 overflow-x-auto px-4 pt-4 text-sm [scrollbar-width:none] sm:gap-7 sm:px-6 lg:px-8" aria-label="Main">
            {VIEWS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setView(item.id)}
                aria-current={view === item.id ? "page" : undefined}
                className={`shrink-0 border-b-2 pb-3 ${view === item.id ? "border-white text-white" : "border-transparent text-muted hover:text-white"}`}
              >
                {item.label}
              </button>
            ))}
          </nav>
        ) : (
          <div className="pb-4" />
        )}
      </header>
      <main className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 lg:px-8">
        {error && <p className="rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">{error}</p>}
        {!data && !error && <p className="text-sm text-muted">Loading your workspace…</p>}
        {notice && (
          <div className="flex items-start justify-between gap-3 rounded-xl border border-line bg-card px-4 py-3 text-sm text-zinc-300">
            <p>{notice}</p>
            <button type="button" onClick={() => setNotice("")} aria-label="Dismiss" className="text-faint hover:text-white">✕</button>
          </div>
        )}
        {data && showOnboarding && (
          <div className="mx-auto w-full max-w-3xl">
            <ProfileOnboarding
              initialProfile={profile}
              saving={saving}
              onResumeUpload={uploadResume}
              onSave={saveProfile}
            />
          </div>
        )}
        {data && !showOnboarding && view === "contacts" && (
          <>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 className="text-3xl font-bold tracking-tight md:text-4xl">My Contacts</h1>
                <p className="mt-1 text-sm text-muted">{contacts.length} saved · {contacts.filter((contact) => contact.email).length} with a verified email</p>
              </div>
              {contacts.length > 0 && (
                <div className="flex items-center gap-2">
                  {selected.size > 0 && (
                    <button type="button" disabled={deleting} onClick={() => void deleteContacts([...selected])} className="rounded-xl border border-red-900/70 px-3 py-1.5 text-sm text-red-300 hover:bg-red-950/40 disabled:opacity-50">
                      {deleting ? "Deleting…" : `Delete ${selected.size} selected`}
                    </button>
                  )}
                  <button type="button" onClick={() => setView("find")} className="rounded-xl bg-white px-4 py-1.5 text-sm font-semibold text-black hover:bg-zinc-200">Find more</button>
                </div>
              )}
            </div>
            {contacts.length === 0 ? (
              <div className="rounded-2xl border border-line bg-panel p-8 text-center">
                <p className="text-sm text-muted">No saved contacts yet. People you find will show up here.</p>
                <button type="button" onClick={() => setView("find")} className="mt-4 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200">Find new contacts</button>
              </div>
            ) : (
              <section className="overflow-hidden rounded-2xl border border-line">
                <div className="hidden grid-cols-[2rem_minmax(0,1.2fr)_minmax(0,1.4fr)_minmax(0,1.4fr)_12.5rem] items-center gap-4 border-b border-line bg-panel px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-faint md:grid">
                  <input type="checkbox" aria-label="Select all contacts" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(contacts.map((contact) => contact.id)))} />
                  <span>Name</span>
                  <span>Role</span>
                  <span>Email</span>
                  <span className="sr-only">Actions</span>
                </div>
                <ul className="divide-y divide-line">
                  {contacts.map((contact) => (
                    <li key={contact.id} className="grid grid-cols-[2rem_minmax(0,1fr)] items-center gap-x-4 gap-y-2 px-4 py-3 md:grid-cols-[2rem_minmax(0,1.2fr)_minmax(0,1.4fr)_minmax(0,1.4fr)_12.5rem]">
                      <input type="checkbox" aria-label={`Select ${contact.name}`} checked={selected.has(contact.id)} onChange={() => toggleSelected(contact.id)} />
                      <p className="truncate font-medium">{contact.name}</p>
                      <p className="col-start-2 truncate text-sm text-muted md:col-start-auto">{contact.title}{contact.company ? ` · ${contact.company}` : ""}</p>
                      <div className="col-start-2 min-w-0 text-sm md:col-start-auto">
                        {contact.email ? (
                          <a href={`mailto:${contact.email}`} className="truncate text-zinc-300 hover:text-white">{contact.email}</a>
                        ) : data.integrations.apollo ? (
                          <button type="button" disabled={unlocking === contact.id} onClick={() => void findEmail(contact)} className="text-muted underline-offset-4 hover:text-white hover:underline disabled:opacity-50">
                            {unlocking === contact.id ? "Looking up…" : "No verified email · Try again"}
                          </button>
                        ) : (
                          <span className="text-faint">No email yet</span>
                        )}
                      </div>
                      <div className="col-start-2 flex gap-2 md:col-start-auto md:justify-end">
                        <button type="button" onClick={() => openComposer(contact)} className="whitespace-nowrap rounded-xl border border-line px-3 py-1.5 text-sm hover:bg-white/5">Write email</button>
                        <button type="button" disabled={deleting} onClick={() => void deleteContacts([contact.id])} aria-label={`Delete ${contact.name}`} className="rounded-xl border border-line px-3 py-1.5 text-sm text-muted hover:border-red-900/70 hover:text-red-300 disabled:opacity-50">Delete</button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {data.drafts.length > 0 && (
              <section className="border-t border-line pt-8">
                <h2 className={sectionTitle}>Saved drafts · {data.drafts.length}</h2>
                <ul className="mt-3 grid gap-2 text-sm text-muted sm:grid-cols-2 lg:grid-cols-3">
                  {data.drafts.map((draft) => (
                    <li key={draft.id} className="truncate rounded-xl border border-line bg-panel px-4 py-3">{draft.subject || "Untitled draft"} · not sent</li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
        {data && !showOnboarding && view === "find" && (
          <>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Who do you want to meet?</h1>
              <div className="inline-flex rounded-full border border-line bg-panel p-1">
                <button type="button" onClick={() => setTab("find")} className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${tab === "find" ? "bg-white text-black" : "text-muted hover:text-white"}`}>Find for Me</button>
                <button type="button" onClick={() => setTab("custom")} className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${tab === "custom" ? "bg-white text-black" : "text-muted hover:text-white"}`}>Custom Search</button>
              </div>
            </div>
            <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
              {tab === "find" ? (
                <FindForMe
                  profileReady
                  loading={searching}
                  onSearch={search}
                  onEditProfile={(action) => {
                    if (action === "reset") void resetProfile();
                    else setEditing(true);
                  }}
                />
              ) : (
                <CustomSearch loading={searching} onSearch={search} />
              )}
              <aside className="space-y-8">
                <section className="rounded-2xl border border-line bg-panel p-5">
                  <h2 className={sectionTitle}>Results</h2>
                  {searching ? (
                    <p className="mt-3 text-sm text-muted">Searching Apollo and looking up verified emails…</p>
                  ) : searchError ? (
                    <p role="alert" className="mt-3 rounded-xl border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">{searchError}</p>
                  ) : lastSearch ? (
                    <div className="mt-3 space-y-3">
                      <p className="text-sm text-muted">
                        Your last search found {lastSearch.resultCount} {lastSearch.resultCount === 1 ? "person" : "people"} and used {lastSearch.creditsCharged} {lastSearch.creditsCharged === 1 ? "credit" : "credits"}.
                        {lastSearch.prompt ? ` “${lastSearch.prompt}”` : ""}
                      </p>
                      {lastSearch.resultCount > 0 && (
                        <button type="button" onClick={() => setView("contacts")} className="w-full rounded-xl border border-line px-3 py-2 text-sm hover:bg-white/5">View in My Contacts</button>
                      )}
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-muted">Run a search to find people. You&apos;re only charged for people found, 1 credit per 25. Verified work emails are included.</p>
                  )}
                </section>
                <details className="group rounded-2xl border border-line bg-panel p-5">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                    <h2 className={sectionTitle}>Profile facts</h2>
                    <span className="text-xs text-muted group-open:hidden">Show</span>
                    <span className="hidden text-xs text-muted group-open:inline">Hide</span>
                  </summary>
                  {data.resume && <p className="mt-3 text-xs text-faint">Resume file: {data.resume.fileName}</p>}
                  <div className="mt-4">
                    {data.profile?.organizedProfile ? <ModelValue value={data.profile.organizedProfile} /> : <p className="text-sm text-muted">Save your profile to create this section.</p>}
                  </div>
                </details>
              </aside>
            </div>
          </>
        )}
        {data && !showOnboarding && view === "analytics" && (
          <>
            <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Analytics</h1>
            <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {[
                ["Saved contacts", contacts.length],
                ["Verified emails", contacts.filter((contact) => contact.email).length],
                ["Drafts saved", data.drafts.length],
                ["Emails sent", 0],
                ["People found", peopleFound],
                ["Credits left", data.credits.balance],
              ].map(([name, value]) => (
                <div key={name} className="rounded-2xl border border-line bg-panel p-4">
                  <p className="text-2xl font-semibold tabular-nums">{value}</p>
                  <p className="mt-1 text-xs text-muted">{name}</p>
                </div>
              ))}
            </section>
            <p className="text-xs text-faint">
              Email sending is not connected yet, so nothing has been sent. Searches have used {creditsSpent} {creditsSpent === 1 ? "credit" : "credits"}.
            </p>
            <section className="border-t border-line pt-8">
              <h2 className={sectionTitle}>Recent searches</h2>
              {data.searches.length === 0 ? (
                <p className="mt-3 text-sm text-muted">No searches yet.</p>
              ) : (
                <ul className="mt-3 divide-y divide-line">
                  {data.searches.slice(0, 10).map((item) => (
                    <li key={item.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 text-sm">
                      <div className="min-w-0">
                        <p className="font-medium">{item.mode === "automatic" ? "Find for Me" : "Custom Search"} · {item.status === "completed" ? `${item.resultCount} found` : `up to ${item.quantity} people`}</p>
                        {item.prompt && <p className="truncate text-muted">{item.prompt}</p>}
                      </div>
                      <p className="shrink-0 text-xs text-faint">{new Date(item.createdAt).toLocaleDateString()} · {item.creditsCharged} charged</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
        {data && !showOnboarding && view === "settings" && (
          <>
            <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Settings</h1>
            <section className="grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-line bg-panel p-5">
                <h2 className={sectionTitle}>Account</h2>
                <p className="mt-3 font-medium">{data.user.name || "Student"}</p>
                <p className="text-sm text-muted">{data.user.email}</p>
                <button type="button" onClick={logout} className="mt-4 rounded-xl border border-line px-3 py-1.5 text-sm hover:bg-white/5">Log out</button>
              </div>
              <div className="rounded-2xl border border-line bg-panel p-5">
                <h2 className={sectionTitle}>Profile</h2>
                <p className="mt-3 text-sm text-muted">Your profile powers Find for Me and the facts used in your emails.</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" onClick={() => setEditing(true)} className="rounded-xl border border-line px-3 py-1.5 text-sm hover:bg-white/5">Edit profile</button>
                  <button type="button" onClick={() => void resetProfile()} className="rounded-xl border border-line px-3 py-1.5 text-sm text-muted hover:bg-white/5">Start over</button>
                </div>
              </div>
            </section>
            <section className="space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold tracking-tight">Plans</h2>
                  <p className="mt-1 text-sm text-muted">
                    You&apos;re on {LEGACY_PLANS[currentPlan] ?? PUBLIC_PLANS.find((plan) => plan.id === currentPlan)?.name ?? "Free"} with {data.credits.balance} {data.credits.balance === 1 ? "credit" : "credits"} left.
                  </p>
                </div>
                <p className="text-xs text-faint">1 credit = 25 people with verified emails</p>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                {PUBLIC_PLANS.map((plan) => {
                  const current = plan.id === currentPlan;
                  return (
                    <div key={plan.id} className={`flex flex-col rounded-2xl border p-5 ${current ? "border-white bg-card" : "border-line bg-panel"}`}>
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-lg font-semibold">{plan.name}</h3>
                        {current ? (
                          <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-black">Current plan</span>
                        ) : plan.popular ? (
                          <span className="rounded-full border border-line px-2.5 py-0.5 text-xs text-muted">Popular</span>
                        ) : null}
                      </div>
                      <p className="mt-3 text-3xl font-bold tabular-nums">{plan.priceLabel}<span className="text-sm font-normal text-muted">{plan.monthly ? " / month" : ""}</span></p>
                      <p className="mt-1 text-sm text-muted">{plan.blurb}</p>
                      <p className="mt-4 text-sm">{plan.monthly ? `${plan.credits} credits each month` : `${plan.credits} credits to start`}</p>
                      <div className="mt-auto pt-5">
                        {current ? (
                          <p className="text-center text-sm text-muted">Your plan</p>
                        ) : plan.monthly ? (
                          <button type="button" onClick={() => void requestUpgrade(plan.id)} className="w-full rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200">Upgrade to {plan.name}</button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </>
        )}
      </main>
      {saving && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-line bg-panel p-6 text-center shadow-2xl">
            <img src="/creating-profile.gif" alt="A cat typing on a laptop" className="mx-auto h-52 w-full rounded-xl object-cover" />
            <p className="mt-4 text-lg font-semibold">Creating user profile</p>
          </div>
        </div>
      )}
      {emailContact && (
        <PersonalizedEmailModal
          key={emailContact.id}
          open
          contact={emailContact}
          studentFacts={data?.studentFacts ?? []}
          highlights={data?.highlights ?? []}
          highlightsLoading={highlightsLoading}
          highlightsError={highlightsError}
          onRetryHighlights={() => void buildHighlights()}
          onClose={() => setEmailContact(null)}
          onGenerate={(input) => generateDraft(emailContact, input)}
          onSaveDraft={saveDraft}
          onSend={async () => {
            throw new Error("Email sending is not connected yet. Nothing was sent.");
          }}
        />
      )}
    </div>
  );
}
