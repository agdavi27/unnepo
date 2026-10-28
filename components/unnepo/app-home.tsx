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
import { Dashboard } from "@/components/unnepo/dashboard";
import { CoverLetterModal, JobsPage, type Job } from "@/components/unnepo/jobs";
import { ENTERPRISE_PLAN, PEOPLE_PER_CREDIT, PUBLIC_PLANS, creditMath } from "@/lib/config";
import { splitProfileList } from "@/lib/profile/lists";

type StudentFact = { id: string; text: string; verified: boolean };
type Workspace = {
  user: { name: string; email: string };
  credits: { balance: number; plan: string; includedAllowance: number };
  profile: { ready: boolean; form: Profile; organizedProfile: unknown | null } | null;
  studentFacts: StudentFact[];
  highlights: Highlight[];
  resume: { id: string; fileName: string; byteSize: number } | null;
  contacts: Contact[];
  searches: { id: string; mode: string; quantity: number; creditsQuoted: number; status: string; resultCount: number; creditsCharged: number; prompt: string; createdAt: string; contactIds?: string[] }[];
  drafts: { id: string; contactId: string; subject: string; createdAt: string }[];
  integrations: { apollo: boolean; anthropic: boolean; gmail: boolean; outlook: boolean };
  mailboxes: { provider: "gmail" | "outlook"; email: string; connectedAt: string }[];
  mailboxSetup: { gmail: boolean; outlook: boolean };
  emailsSent: number;
};

type View = "home" | "contacts" | "find" | "jobs" | "settings";
const VIEWS: { id: View; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "contacts", label: "My Contacts" },
  { id: "find", label: "Find New Contacts" },
  { id: "jobs", label: "Recommended Jobs" },
  { id: "settings", label: "Settings" },
];
const PROFILE_SECTIONS: { step: number; label: string; summary: (profile: Profile) => string }[] = [
  { step: 0, label: "School and majors", summary: (profile) => [profile.school, splitProfileList(profile.major).join(", ")].filter(Boolean).join(" · ") },
  { step: 1, label: "Interests", summary: (profile) => profile.interests.join(", ") },
  { step: 2, label: "Roles, dream companies, locations", summary: (profile) => [splitProfileList(profile.targetRoles).join(", "), splitProfileList(profile.dreamCompanies).join(", ")].filter(Boolean).join(" · ") },
  { step: 3, label: "Networking goals", summary: (profile) => [...profile.goals, ...profile.contactTypes].join(", ") },
  { step: 4, label: "Your story", summary: (profile) => profile.bio },
];
const CONTACT_STATUS_OPTIONS: [string, string][] = [
  ["not_contacted", "Not contacted"],
  ["contacted", "Contacted"],
  ["follow_up_needed", "Follow up"],
  ["replied", "Replied"],
  ["interested", "Interested"],
  ["interview_scheduled", "Interview"],
  ["closed", "Closed"],
];
type FoundFilter = "any" | "last_search" | "today" | "week" | "month";
const FOUND_FILTERS: [FoundFilter, string][] = [["any", "Any time"], ["last_search", "Last search"], ["today", "Today"], ["week", "Last 7 days"], ["month", "Last 30 days"]];
type StatusFilter = "all" | "not_contacted" | "contacted";
const STATUS_FILTERS: [StatusFilter, string][] = [["all", "All"], ["not_contacted", "Not contacted"], ["contacted", "Contacted"]];

/** Earliest "found" time a date filter keeps, worked out when the filter is picked. */
function foundCutoff(filter: FoundFilter) {
  if (filter === "today") return new Date().setHours(0, 0, 0, 0);
  if (filter === "week") return Date.now() - 7 * 86400000;
  if (filter === "month") return Date.now() - 30 * 86400000;
  return 0;
}

const SOCIAL_LABEL = { linkedin: "LinkedIn", x: "X", github: "GitHub", facebook: "Facebook" } as const;

function SocialIcon({ kind }: { kind: keyof typeof SOCIAL_LABEL }) {
  const paths = {
    linkedin: "M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM3 9.75h4v11H3v-11Zm6.5 0h3.8v1.6h.06c.53-1 1.83-2.05 3.77-2.05 4.03 0 4.77 2.6 4.77 6v5.45h-4v-4.83c0-1.15-.02-2.63-1.6-2.63-1.6 0-1.85 1.25-1.85 2.55v4.91h-4V9.75Z",
    x: "M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.33l4.37 5.78L17.75 3Zm-1.08 16.18h1.7L7.4 4.73H5.58l11.09 14.45Z",
    github: "M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.08.63-1.33-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.56 9.56 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2Z",
    facebook: "M13.5 21v-7.5h2.53l.38-2.94H13.5V8.69c0-.85.24-1.43 1.46-1.43h1.56V4.63a20.9 20.9 0 0 0-2.27-.12c-2.25 0-3.79 1.37-3.79 3.9v2.15H7.92v2.94h2.54V21h3.04Z",
  };
  return <svg viewBox="0 0 24 24" aria-hidden className="h-3.5 w-3.5 fill-current"><path d={paths[kind]} /></svg>;
}

/** Apollo's photo when it has one; initials when it doesn't or the image fails to load. */
function ContactPhoto({ name, url }: { name: string; url?: string }) {
  const [failed, setFailed] = useState(false);
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
  if (url && !failed) {
    return <img src={url} alt="" className="h-9 w-9 shrink-0 rounded-full border border-line object-cover" onError={() => setFailed(true)} referrerPolicy="no-referrer" />;
  }
  return <span aria-hidden className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line bg-card text-xs font-semibold text-zinc-300">{initials || "?"}</span>;
}

function foundLabel(iso?: string) {
  if (!iso) return "";
  const date = new Date(iso);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(date.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
}

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
  const [view, setView] = useState<View>("home");
  const [tab, setTab] = useState<"find" | "custom">("find");
  const [editing, setEditing] = useState(false);
  const [editStep, setEditStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [emailContact, setEmailContact] = useState<Contact | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [foundFilter, setFoundFilter] = useState<FoundFilter>("any");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [foundSince, setFoundSince] = useState(0);
  const [highlightsLoading, setHighlightsLoading] = useState(false);
  const [letter, setLetter] = useState<{ job: Job | null; jobs: Job[] } | null>(null);
  const [highlightsError, setHighlightsError] = useState("");

  /** Loads the workspace, giving up after 30 seconds so the page never waits forever. */
  const fetchState = useCallback(async (): Promise<Workspace | null> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch("/api/app/state", { signal: controller.signal });
      if (response.status === 401) {
        router.push("/login");
        return null;
      }
      const body = await response.json().catch(() => ({ error: `The server returned an error (${response.status}).` }));
      if (!response.ok) throw new Error(body.error || "Could not load your workspace.");
      return body as Workspace;
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") throw new Error("Your workspace is taking too long to load.");
      throw reason instanceof Error ? reason : new Error("Could not load your workspace.");
    } finally {
      clearTimeout(timer);
    }
  }, [router]);

  const load = useCallback(async () => {
    try {
      const body = await fetchState();
      if (body) {
        setData(body);
        setError("");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load your workspace.");
    }
  }, [fetchState]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("mailbox");
    const failed = params.get("mailbox_error");
    if (!connected && !failed) return;
    const message = failed ? `Couldn't connect your mailbox: ${failed}` : `${connected === "outlook" ? "Outlook" : "Gmail"} connected. You can now send emails from the email popup.`;
    window.history.replaceState(null, "", window.location.pathname);
    queueMicrotask(() => {
      setNotice(message);
      setView("settings");
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchState()
      .then((body) => {
        if (!cancelled && body) setData(body);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load your workspace.");
      });
    return () => {
      cancelled = true;
    };
  }, [fetchState]);

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

  async function setContactStatus(contact: Contact, status: string) {
    setData((current) => (current ? { ...current, contacts: current.contacts.map((item) => (item.id === contact.id ? { ...item, status } : item)) } : current));
    const response = await fetch("/api/app/contacts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactId: contact.id, status }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setNotice(payload.error || "Could not update that status.");
      await load();
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

  function editProfile(step: number) {
    setEditStep(step);
    setEditing(true);
    window.scrollTo({ top: 0 });
  }

  async function sendEmail(draft: EmailDraft, contact: Contact) {
    const response = await fetch("/api/app/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactId: contact.id, subject: draft.subject, body: draft.body }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Could not send that email. Nothing was marked as sent.");
    setEmailContact(null);
    setNotice(`${payload.message || "Email sent."} ${contact.name} is now marked Contacted.`);
    await load();
  }

  async function disconnectMailbox(provider: "gmail" | "outlook") {
    if (!window.confirm(`Disconnect ${provider === "gmail" ? "Gmail" : "Outlook"}? You can reconnect it any time.`)) return;
    const response = await fetch("/api/app/mailbox", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider }),
    });
    const payload = await response.json().catch(() => ({}));
    setNotice(payload.message || payload.error || "Could not disconnect that mailbox.");
    await load();
  }

  function openCoverLetter(job: Job | null, jobs: Job[]) {
    setLetter({ job, jobs });
    if (data?.profile?.ready && !data.highlights.length && !highlightsLoading) void buildHighlights();
  }

  async function writeCoverLetter(input: { job: { title: string; company: string; description: string }; studentFactIds: string[]; detailFactIds: string[]; tone: string; length: string; notes: string }) {
    const response = await fetch("/api/app/cover-letter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Could not write that letter.");
    return String(payload.body ?? "");
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

  const contacts = data?.contacts ?? [];
  const lastSearch = data?.searches.find((item) => item.status === "completed");
  const lastSearchIds = new Set(lastSearch?.contactIds ?? []);
  const lastSearchPeople = (lastSearch?.contactIds ?? []).flatMap((contactId) => contacts.filter((contact) => contact.id === contactId));
  const filteredContacts = contacts.filter((contact) => {
    const found = contact.foundAt ? new Date(contact.foundAt).getTime() : 0;
    if (foundFilter === "last_search" && !lastSearchIds.has(contact.id)) return false;
    if ((foundFilter === "today" || foundFilter === "week" || foundFilter === "month") && found < foundSince) return false;
    const contacted = (contact.status ?? "not_contacted") !== "not_contacted";
    if (statusFilter === "contacted" && !contacted) return false;
    if (statusFilter === "not_contacted" && contacted) return false;
    return true;
  });
  const filtersOn = foundFilter !== "any" || statusFilter !== "all";
  const allSelected = filteredContacts.length > 0 && filteredContacts.every((contact) => selected.has(contact.id));
  const tableColumns = "lg:grid-cols-[2rem_minmax(0,1.3fr)_minmax(0,1.3fr)_minmax(0,1.3fr)_9.5rem_4.5rem_12.5rem]";

  const renderContactTable = (list: Contact[], selectable: boolean) => (
    <section className="overflow-hidden rounded-2xl border border-line">
      <div className={`hidden items-center gap-4 border-b border-line bg-panel px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-faint lg:grid ${tableColumns}`}>
        {selectable ? (
          <input type="checkbox" aria-label="Select all shown contacts" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(list.map((contact) => contact.id)))} />
        ) : (
          <span />
        )}
        <span>Name</span>
        <span>Role</span>
        <span>Email</span>
        <span>Status</span>
        <span>Found</span>
        <span className="sr-only">Actions</span>
      </div>
      <ul className="divide-y divide-line">
        {list.map((contact) => (
          <li key={contact.id} className={`grid grid-cols-[2rem_minmax(0,1fr)] items-center gap-x-4 gap-y-2 px-4 py-3 ${tableColumns}`}>
            {selectable ? (
              <input type="checkbox" aria-label={`Select ${contact.name}`} checked={selected.has(contact.id)} onChange={() => toggleSelected(contact.id)} />
            ) : (
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-zinc-600" />
            )}
            <div className="flex min-w-0 items-center gap-3">
              <ContactPhoto name={contact.name} url={contact.photoUrl} />
              <div className="min-w-0">
                <p className="truncate font-medium">{contact.name}</p>
                {contact.links?.length ? (
                  <div className="mt-0.5 flex items-center gap-2 text-faint">
                    {contact.links.map((link) => (
                      <a key={link.kind} href={link.url} target="_blank" rel="noopener noreferrer" aria-label={`${contact.name} on ${SOCIAL_LABEL[link.kind]}`} title={SOCIAL_LABEL[link.kind]} className="hover:text-white">
                        <SocialIcon kind={link.kind} />
                      </a>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
            <div className="col-start-2 min-w-0 lg:col-start-auto">
              <p className="truncate text-sm text-muted">{contact.title}{contact.company ? ` · ${contact.company}` : ""}</p>
              {contact.location && <p className="truncate text-xs text-faint">{contact.location}</p>}
            </div>
            <div className="col-start-2 min-w-0 text-sm lg:col-start-auto">
              <a href={`mailto:${contact.email}`} className="block truncate text-zinc-300 hover:text-white">{contact.email}</a>
            </div>
            <select
              aria-label={`Status for ${contact.name}`}
              value={contact.status ?? "not_contacted"}
              onChange={(event) => void setContactStatus(contact, event.target.value)}
              className={`col-start-2 w-full rounded-lg border border-line bg-card px-2 py-1 text-xs outline-none lg:col-start-auto ${(contact.status ?? "not_contacted") === "not_contacted" ? "text-muted" : "text-white"}`}
            >
              {CONTACT_STATUS_OPTIONS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
            </select>
            <p className="col-start-2 text-xs text-faint lg:col-start-auto">{foundLabel(contact.foundAt)}</p>
            <div className="col-start-2 flex gap-2 lg:col-start-auto lg:justify-end">
              <button type="button" onClick={() => openComposer(contact)} className="whitespace-nowrap rounded-xl border border-line px-3 py-1.5 text-sm hover:bg-white/5">Write email</button>
              <button type="button" disabled={deleting} onClick={() => void deleteContacts([contact.id])} aria-label={`Delete ${contact.name}`} className="rounded-xl border border-line px-3 py-1.5 text-sm text-muted hover:border-red-900/70 hover:text-red-300 disabled:opacity-50">Delete</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
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
        {error && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
            <p>{error}</p>
            <button type="button" onClick={() => { setError(""); void load(); }} className="rounded-lg border border-red-900/70 px-3 py-1 text-red-200 hover:bg-red-950/60">Try again</button>
          </div>
        )}
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
              key={`${editing}-${editStep}`}
              initialProfile={profile}
              saving={saving}
              editing={Boolean(data.profile?.ready)}
              initialStep={data.profile?.ready ? editStep : 0}
              onCancel={() => setEditing(false)}
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
                <p className="mt-1 text-sm text-muted">{contacts.length} saved, each with a verified work email · {contacts.filter((contact) => (contact.status ?? "not_contacted") !== "not_contacted").length} contacted</p>
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
              <>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-[0.12em] text-faint">Found</span>
                    {FOUND_FILTERS.map(([value, text]) => (
                      <button key={value} type="button" onClick={() => { setFoundFilter(value); setFoundSince(foundCutoff(value)); setSelected(new Set()); }} disabled={value === "last_search" && !lastSearch} className={`rounded-full border px-3 py-1 text-xs disabled:opacity-40 ${foundFilter === value ? "border-white bg-white text-black" : "border-line text-zinc-300 hover:border-zinc-500"}`}>{text}</button>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-[0.12em] text-faint">Status</span>
                    {STATUS_FILTERS.map(([value, text]) => (
                      <button key={value} type="button" onClick={() => { setStatusFilter(value); setSelected(new Set()); }} className={`rounded-full border px-3 py-1 text-xs ${statusFilter === value ? "border-white bg-white text-black" : "border-line text-zinc-300 hover:border-zinc-500"}`}>{text}</button>
                    ))}
                  </div>
                  {filtersOn && (
                    <button type="button" onClick={() => { setFoundFilter("any"); setStatusFilter("all"); }} className="text-xs text-muted underline-offset-4 hover:text-white hover:underline">
                      Clear filters · showing {filteredContacts.length} of {contacts.length}
                    </button>
                  )}
                </div>
                {filteredContacts.length === 0 ? (
                  <div className="rounded-2xl border border-line bg-panel p-8 text-center text-sm text-muted">No contacts match these filters.</div>
                ) : (
                  renderContactTable(filteredContacts, true)
                )}
              </>
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
                    else editProfile(0);
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
                        <button type="button" onClick={() => { setFoundFilter("last_search"); setStatusFilter("all"); setView("contacts"); }} className="w-full rounded-xl border border-line px-3 py-2 text-sm hover:bg-white/5">Open in My Contacts</button>
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
            {!searching && !searchError && lastSearch && (
              <section className="space-y-3">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <h2 className="text-xl font-semibold tracking-tight">People found · {lastSearchPeople.length}</h2>
                  <p className="text-xs text-faint">From your search on {foundLabel(lastSearch.createdAt)}{lastSearchPeople.length < lastSearch.resultCount ? ` · ${lastSearch.resultCount - lastSearchPeople.length} deleted since` : ""}</p>
                </div>
                {lastSearchPeople.length ? (
                  renderContactTable(lastSearchPeople, false)
                ) : (
                  <div className="rounded-2xl border border-line bg-panel p-6 text-sm text-muted">
                    {lastSearch.resultCount ? "These people are no longer in My Contacts." : "Apollo found no new people for that search. Try different roles, companies, or locations."}
                  </div>
                )}
              </section>
            )}
          </>
        )}
        {data && !showOnboarding && view === "home" && (
          <Dashboard
            firstName={data.user.name.split(/\s+/)[0] ?? ""}
            contacts={contacts}
            searches={data.searches}
            drafts={data.drafts.length}
            emailsSent={data.emailsSent}
            credits={data.credits.balance}
            plan={currentPlan}
            onFind={() => setView("find")}
            onContacts={() => setView("contacts")}
          />
        )}
        {data && !showOnboarding && view === "jobs" && <JobsPage onCoverLetter={openCoverLetter} />}
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
                <div className="flex items-center justify-between gap-3">
                  <h2 className={sectionTitle}>Profile</h2>
                  <button type="button" onClick={() => void resetProfile()} className="text-xs text-muted hover:text-white">Start over</button>
                </div>
                <p className="mt-3 text-sm text-muted">Change one section at a time. Saving updates your highlights and Find for Me.</p>
                <ul className="mt-3 divide-y divide-line">
                  {PROFILE_SECTIONS.map((section) => (
                    <li key={section.step} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{section.label}</p>
                        <p className="truncate text-xs text-muted">{section.summary(profile) || "Not filled in yet"}</p>
                      </div>
                      <button type="button" onClick={() => editProfile(section.step)} className="shrink-0 rounded-xl border border-line px-3 py-1 text-sm hover:bg-white/5">Edit</button>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
            <section className="rounded-2xl border border-line bg-panel p-5">
              <h2 className={sectionTitle}>Connected email</h2>
              <p className="mt-3 text-sm text-muted">Send emails from your own inbox. Unnepo can only send, never read your mail, and nothing goes out until you click Send and confirm.</p>
              <ul className="mt-3 divide-y divide-line">
                {(["gmail", "outlook"] as const).map((provider) => {
                  const mailbox = data.mailboxes.find((item) => item.provider === provider);
                  const name = provider === "gmail" ? "Gmail" : "Outlook";
                  return (
                    <li key={provider} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{name}</p>
                        <p className="truncate text-xs text-muted">
                          {mailbox ? `Connected as ${mailbox.email}` : data.mailboxSetup[provider] ? "Not connected" : `Not available yet. ${provider === "gmail" ? "Google" : "Microsoft"} sign-in hasn't been set up for Unnepo.`}
                        </p>
                      </div>
                      {mailbox ? (
                        <button type="button" onClick={() => void disconnectMailbox(provider)} className="rounded-xl border border-line px-3 py-1.5 text-sm text-muted hover:bg-white/5">Disconnect</button>
                      ) : data.mailboxSetup[provider] ? (
                        <a href={`/api/oauth/${provider}`} className="rounded-xl bg-white px-3 py-1.5 text-sm font-semibold text-black hover:bg-zinc-200">Connect {name}</a>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
            <section className="space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold tracking-tight">Plans</h2>
                  <p className="mt-1 text-sm text-muted">
                    You&apos;re on {LEGACY_PLANS[currentPlan] ?? PUBLIC_PLANS.find((plan) => plan.id === currentPlan)?.name ?? "Free"} with {data.credits.balance} {data.credits.balance === 1 ? "credit" : "credits"} left.
                  </p>
                </div>
                <p className="text-xs text-faint">1 credit = {PEOPLE_PER_CREDIT} contacts, each with a verified work email</p>
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
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
                      <p className="mt-4 text-sm font-medium">{creditMath(plan.credits)}{plan.monthly ? " each month" : " to start"}</p>
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
                <div className="flex flex-col rounded-2xl border border-line bg-panel p-5">
                  <h3 className="text-lg font-semibold">{ENTERPRISE_PLAN.name}</h3>
                  <p className="mt-3 text-3xl font-bold">{ENTERPRISE_PLAN.priceLabel}</p>
                  <p className="mt-1 text-sm text-muted">{ENTERPRISE_PLAN.blurb}</p>
                  <p className="mt-4 text-sm font-medium">Contact us for pricing</p>
                  <div className="mt-auto pt-5">
                    {ENTERPRISE_PLAN.contactEmail ? (
                      <a href={`mailto:${ENTERPRISE_PLAN.contactEmail}?subject=${encodeURIComponent("Unnepo for our school")}`} className="block w-full rounded-xl border border-line px-4 py-2 text-center text-sm font-semibold hover:bg-white/5">Contact us</a>
                    ) : null}
                  </div>
                </div>
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
      {letter && (
        <CoverLetterModal
          key={letter.job?.id ?? "new"}
          jobs={letter.jobs}
          initialJob={letter.job}
          highlights={data?.highlights ?? []}
          highlightsLoading={highlightsLoading}
          onClose={() => setLetter(null)}
          onGenerate={writeCoverLetter}
        />
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
          connectedAccount={data?.mailboxes[0]?.email}
          onSend={sendEmail}
        />
      )}
    </div>
  );
}
