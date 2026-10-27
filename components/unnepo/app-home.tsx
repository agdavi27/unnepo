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
  if (value === null || value === undefined) return <span className="text-zinc-400">null</span>;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return <span>{String(value)}</span>;
  }
  if (Array.isArray(value)) {
    if (!value.length) return <span className="text-zinc-400">[]</span>;
    return (
      <ul className="mt-1 space-y-2 border-l border-zinc-200 pl-3">
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
    if (!entries.length) return <span className="text-zinc-400">{"{}"}</span>;
    return (
      <dl className="space-y-3">
        {entries.map(([key, item]) => (
          <div key={key}>
            <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{key}</dt>
            <dd className="mt-0.5 text-sm text-zinc-800">
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
    <div className="min-h-screen bg-zinc-100 text-zinc-900">
      <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <span className="text-xl font-semibold tracking-tight">unnepo.</span>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-zinc-600">{data ? `${data.credits.balance} credits` : ""}</span>
            <button type="button" onClick={logout} className="rounded-lg border border-zinc-200 px-3 py-1.5 hover:bg-zinc-50">Log out</button>
          </div>
        </div>
      </header>
      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6">
        {error && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
        {!data && !error && <p className="text-sm text-zinc-500">Loading your workspace…</p>}
        {notice && <p className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-700">{notice}</p>}
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
            <div className="flex gap-2">
              <button type="button" onClick={() => setTab("find")} className={`rounded-lg px-3 py-2 text-sm font-medium ${tab === "find" ? "bg-zinc-950 text-white" : "border border-zinc-200 bg-white"}`}>Find for Me</button>
              <button type="button" onClick={() => setTab("custom")} className={`rounded-lg px-3 py-2 text-sm font-medium ${tab === "custom" ? "bg-zinc-950 text-white" : "border border-zinc-200 bg-white"}`}>Custom Search</button>
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
            <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold">Results</h2>
              {data.searches[0] ? (
                <p className="mt-2 text-sm text-zinc-600">
                  Not connected yet. Your last request for up to {data.searches[0].quantity} people ({data.searches[0].creditsQuoted} {data.searches[0].creditsQuoted === 1 ? "credit" : "credits"}) was saved and did not charge anything.
                  {data.searches[0].prompt ? ` “${data.searches[0].prompt}”` : ""}
                </p>
              ) : (
                <p className="mt-2 text-sm text-zinc-600">People search is not connected yet. A search saves your request and does not return people or spend credits.</p>
              )}
            </section>
            <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold">Saved contacts</h2>
              {data.contacts.length === 0 ? (
                <p className="mt-2 text-sm text-zinc-600">No saved contacts yet. People will show up here after a connected search.</p>
              ) : (
                <ul className="mt-3 divide-y divide-zinc-100">
                  {data.contacts.map((contact) => (
                    <li key={contact.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <div>
                        <p className="font-medium">{contact.name}</p>
                        <p className="text-sm text-zinc-500">{contact.title}{contact.company ? ` · ${contact.company}` : ""}</p>
                      </div>
                      <button type="button" onClick={() => setEmailContact(contact)} className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm hover:bg-zinc-50">Write email</button>
                    </li>
                  ))}
                </ul>
              )}
              {data.drafts.length > 0 && (
                <div className="mt-4 border-t border-zinc-100 pt-3">
                  <h3 className="text-sm font-semibold">Saved drafts</h3>
                  <ul className="mt-2 space-y-1 text-sm text-zinc-600">
                    {data.drafts.map((draft) => (
                      <li key={draft.id}>{draft.subject || "Untitled draft"} · not sent</li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
            <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">Profile facts</h2>
                {data.resume && <p className="text-xs text-zinc-500">Resume file: {data.resume.fileName}</p>}
              </div>
              <div className="mt-3">
                {data.profile?.organizedProfile ? <ModelValue value={data.profile.organizedProfile} /> : <p className="text-sm text-zinc-600">Save your profile to create this section.</p>}
              </div>
            </section>
          </>
        )}
      </main>
      {saving && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-xl">
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
