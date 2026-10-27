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
  type Profile,
  type SearchRequest,
} from "@/components/unnepo/UnnepoForms";

type StudentFact = { id: string; text: string; verified: boolean };
type Workspace = {
  credits: { balance: number };
  profile: { ready: boolean; form: Profile; organizedProfile: unknown | null } | null;
  studentFacts: StudentFact[];
  resume: { id: string; fileName: string; byteSize: number } | null;
  contacts: Contact[];
  searches: { id: string; mode: string; quantity: number; creditsQuoted: number; status: string; creditsCharged: number; prompt: string; createdAt: string }[];
  drafts: { id: string; contactId: string; subject: string; createdAt: string }[];
};

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
  const [tab, setTab] = useState<"find" | "custom">("find");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searching, setSearching] = useState(false);
  const [emailContact, setEmailContact] = useState<Contact | null>(null);

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
    try {
      const response = await fetch("/api/app/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      const payload = await response.json();
      if (!response.ok) {
        setNotice(payload.error || "Search could not be saved.");
        return;
      }
      setNotice(payload.message || "People search is not connected yet. No credits were used.");
      await load();
    } finally {
      setSearching(false);
    }
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

  return (
    <div className="min-h-screen bg-bg text-ink [color-scheme:dark]">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/80 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-4">
          <span className="text-2xl font-semibold tracking-tight">unnepo.</span>
          <div className="flex items-center gap-4 text-sm">
            {data && <span className="rounded-full border border-line px-3 py-1 text-muted"><span className="text-ink">{data.credits.balance}</span> credits</span>}
            <button type="button" onClick={logout} className="text-muted hover:text-white">Log out</button>
          </div>
        </div>
      </header>
      <main className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-10">
        {error && <p className="rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">{error}</p>}
        {!data && !error && <p className="text-sm text-muted">Loading your workspace…</p>}
        {notice && (
          <div className="flex items-start justify-between gap-3 rounded-xl border border-line bg-card px-4 py-3 text-sm text-zinc-300">
            <p>{notice}</p>
            <button type="button" onClick={() => setNotice("")} aria-label="Dismiss" className="text-faint hover:text-white">✕</button>
          </div>
        )}
        {data && showOnboarding && (
          <ProfileOnboarding
            initialProfile={profile}
            saving={saving}
            onResumeUpload={uploadResume}
            onSave={saveProfile}
          />
        )}
        {data && !showOnboarding && (
          <>
            <div className="space-y-5">
              <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Who do you want to meet?</h1>
              <div className="inline-flex rounded-full border border-line bg-panel p-1">
                <button type="button" onClick={() => setTab("find")} className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${tab === "find" ? "bg-white text-black" : "text-muted hover:text-white"}`}>Find for Me</button>
                <button type="button" onClick={() => setTab("custom")} className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${tab === "custom" ? "bg-white text-black" : "text-muted hover:text-white"}`}>Custom Search</button>
              </div>
            </div>
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
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-faint">Results</h2>
              {data.searches[0] ? (
                <p className="mt-3 text-sm text-muted">
                  Not connected yet. Your last request for up to {data.searches[0].quantity} people ({data.searches[0].creditsQuoted} {data.searches[0].creditsQuoted === 1 ? "credit" : "credits"}) was saved and did not charge anything.
                  {data.searches[0].prompt ? ` “${data.searches[0].prompt}”` : ""}
                </p>
              ) : (
                <p className="mt-3 text-sm text-muted">People search is not connected yet. A search saves your request and does not return people or spend credits.</p>
              )}
            </section>
            <section className="border-t border-line pt-8">
              <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-faint">Saved contacts</h2>
              {data.contacts.length === 0 ? (
                <p className="mt-3 text-sm text-muted">No saved contacts yet. People will show up here after a connected search.</p>
              ) : (
                <ul className="mt-3 divide-y divide-line">
                  {data.contacts.map((contact) => (
                    <li key={contact.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <div>
                        <p className="font-medium">{contact.name}</p>
                        <p className="text-sm text-muted">{contact.title}{contact.company ? ` · ${contact.company}` : ""}</p>
                      </div>
                      <button type="button" onClick={() => setEmailContact(contact)} className="rounded-xl border border-line px-3 py-1.5 text-sm hover:bg-white/5">Write email</button>
                    </li>
                  ))}
                </ul>
              )}
              {data.drafts.length > 0 && (
                <div className="mt-4 border-t border-line pt-3">
                  <h3 className="text-sm font-medium">Saved drafts</h3>
                  <ul className="mt-2 space-y-1 text-sm text-muted">
                    {data.drafts.map((draft) => (
                      <li key={draft.id}>{draft.subject || "Untitled draft"} · not sent</li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
            <details className="group border-t border-line pt-8">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-faint">Profile facts</h2>
                <span className="text-xs text-muted group-open:hidden">Show</span>
                <span className="hidden text-xs text-muted group-open:inline">Hide</span>
              </summary>
              {data.resume && <p className="mt-3 text-xs text-faint">Resume file: {data.resume.fileName}</p>}
              <div className="mt-4 rounded-2xl border border-line bg-panel p-5">
                {data.profile?.organizedProfile ? <ModelValue value={data.profile.organizedProfile} /> : <p className="text-sm text-muted">Save your profile to create this section.</p>}
              </div>
            </details>
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
          onClose={() => setEmailContact(null)}
          onGenerate={async () => {
            throw new Error("AI email generation is not connected yet. Use Write it yourself, then save the draft.");
          }}
          onSaveDraft={saveDraft}
          onSend={async () => {
            throw new Error("Email sending is not connected yet. Nothing was sent.");
          }}
        />
      )}
    </div>
  );
}
