"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bell, Search } from "lucide-react";
import { Avatar, CompanyLogo, CompanyMark, PageLoading, StatusPill } from "@/components/product/bits";
import { GoalChecklist } from "@/components/product/goal-checklist";
import { greeting, timeAgo } from "@/lib/format";

type Dashboard = {
  user: { name: string; email: string; onboardingStep?: string } | null;
  resume: { fileName: string; byteSize: number; createdAt: string } | null;
  credits: { balance: number; plan: string } | null;
  summary: { unlocked: number; confirmedSends: number; demoOutbox: number; replies: number; replyRate?: number; interviews?: number };
  deltas: { contactsToday: number; sendsToday: number; repliesToday: number };
  contactsThisWeek: number;
  steps: { resume: boolean; goals: boolean; contacts: boolean; outreach: boolean };
  completedSteps: number;
  goals: { roles: string[]; locations: string[]; industries: string[]; companies: string[]; tracks?: string[]; timing?: string } | null;
  roleSuggestions: { fromResume: string[]; similar: string[] };
  recent: Array<{ saved: { id: string; status: string; updatedAt: string }; contact: { fullName: string; title: string; company: string; location: string } | null }>;
  jobs: Array<{ id: string; title: string; company: string; location: string; postedAt: string }>;
  milestones?: Array<{ goal: number; current: number }>;
  metrics?: { contacts: number; sends: number; replies: number; followUpsDue: number; interviews: number; offers: number };
};

export function HomeView() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const [hour, setHour] = useState(9);

  function load() {
    Promise.all([fetch("/api/dashboard").then((response) => response.json()), fetch("/api/jobs").then((response) => response.json())])
      .then(([dashboard, jobs]) => {
        if (dashboard.error) setError(dashboard.error);
        else setData({ ...dashboard, jobs: jobs.jobs ?? [], roleSuggestions: dashboard.roleSuggestions ?? { fromResume: [], similar: [] } });
      })
      .catch(() => setError("The dashboard could not load."));
  }

  useEffect(() => {
    setHour(new Date().getHours());
    load();
  }, []);

  if (!data) return error ? <div className="p-8 text-red-300">{error}</div> : <PageLoading label="Loading your workspace…" />;

  return (
    <div className="px-4 py-5 lg:px-6">
      <div className="mb-5 hidden items-center justify-end gap-3 md:flex">
        <div className="flex h-10 w-72 items-center gap-2 rounded-full border border-line bg-card px-3 text-sm text-faint">
          <Search className="h-4 w-4" /> Search contacts, companies, or roles...
        </div>
        <Bell className="h-4 w-4 text-muted" />
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-4">
          <div>
            <h1 className="text-4xl font-semibold tracking-tight">{greeting(data.user?.name || "there", hour)}</h1>
            <p className="mt-1 text-muted">Let&apos;s turn your resume into real opportunities.</p>
          </div>
          {data.user?.onboardingStep && data.user.onboardingStep !== "done" && data.user.onboardingStep !== "mailbox" ? (
            <Link href="/onboarding" className="block rounded-2xl border border-gold/40 bg-gold/10 px-4 py-3 text-sm text-cream">Finish setup so search and jobs can use your resume and preferences.</Link>
          ) : null}
          <EmailMilestone sends={data.summary.confirmedSends} />
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <Stat value={String(data.metrics?.contacts ?? data.summary.unlocked)} label="Contacts Found" hint={`+${data.deltas.contactsToday} today`} />
            <Stat value={String(data.metrics?.sends ?? data.summary.confirmedSends)} label="Emails Sent" hint={data.summary.demoOutbox ? `${data.summary.demoOutbox} in demo outbox` : `+${data.deltas.sendsToday} today`} />
            <Stat value={String(data.metrics?.replies ?? data.summary.replies)} label="Replies Received" hint={data.summary.confirmedSends ? `${Math.round((data.summary.replyRate ?? 0) * 100)}% reply rate` : "No sent mail yet"} />
            <Stat value={String(data.metrics?.followUpsDue ?? 0)} label="Follow-Ups Due" hint="Reminders only" />
            <Stat value={String(data.metrics?.interviews ?? data.summary.interviews ?? 0)} label="Interviews" hint="From replies you recorded" />
            <Stat value={String(data.metrics?.offers ?? 0)} label="Offers" hint={(data.metrics?.offers ?? 0) ? "Noted on a saved contact" : "None recorded"} />
          </section>
          <nav className="flex flex-wrap gap-2 text-sm">
            {[
              ["/contacts", "Find Contacts"],
              ["/saved", "Saved Contacts"],
              ["/jobs", "Find Jobs"],
              ["/outreach", "Analytics"],
              ["/settings", "Profile & Preferences"],
            ].map(([href, label]) => (
              <Link key={href} href={href} className="rounded-full border border-line px-3 py-1.5 text-muted hover:text-white">{label}</Link>
            ))}
          </nav>
          <GoalChecklist resumeName={data.resume?.fileName ?? null} suggestions={data.roleSuggestions} goals={data.goals} onUpdated={load} />
          <section className="rounded-2xl border border-line bg-card">
            <div className="flex items-center justify-between px-4 py-3">
              <h2 className="text-lg font-semibold">Recent Contacts</h2>
              <Link href="/saved" className="text-sm text-muted">View all →</Link>
            </div>
            {data.recent.length === 0 ? (
              <p className="px-4 pb-6 text-sm text-muted">No saved contacts yet. A search adds up to 20 people for 1 credit, and they show up here.</p>
            ) : (
              <div className="app-scroll overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="text-[11px] tracking-wide text-faint">
                    <tr><th className="px-4 py-2 font-medium">NAME / TITLE</th><th>COMPANY</th><th>LOCATION</th><th>STATUS</th><th>LAST ACTIVITY</th></tr>
                  </thead>
                  <tbody>
                    {data.recent.map((row) => (
                      <tr key={row.saved.id} className="border-t border-line">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <Avatar name={row.contact?.fullName || "Contact"} />
                            <div>
                              <p className="font-medium">{row.contact?.fullName}</p>
                              <p className="text-xs text-faint">{row.contact?.title}</p>
                            </div>
                          </div>
                        </td>
                        <td><span className="inline-flex items-center gap-2"><CompanyMark company={row.contact?.company || ""} />{row.contact?.company}</span></td>
                        <td className="text-muted">{row.contact?.location}</td>
                        <td><StatusPill status={row.saved.status} /></td>
                        <td className="text-muted">{timeAgo(row.saved.updatedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
        <aside className="space-y-4">
          <section className="rounded-2xl border border-line bg-card p-4">
            <div className="flex items-center justify-between"><h2 className="font-semibold">Job Postings</h2><Link href="/jobs" className="text-xs text-muted">View all →</Link></div>
            <div className="mt-3 space-y-3">
              {data.jobs.slice(0, 5).map((job) => (
                <Link key={job.id} href={`/contacts?company=${encodeURIComponent(job.company)}`} className="flex items-start justify-between gap-3 text-sm">
                  <span className="flex gap-2">
                    <CompanyLogo company={job.company} className="h-8 w-8" />
                    <span>
                      <span className="block font-medium">{job.title}</span>
                      <span className="text-xs text-faint">{job.company} · {job.location}</span>
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-faint">{timeAgo(job.postedAt)}</span>
                </Link>
              ))}
            </div>
          </section>
          <section className="rounded-2xl border border-line bg-card p-4">
            <div className="flex items-center justify-between"><h2 className="font-semibold">Your Goal</h2><Link href="/onboarding" className="text-xs text-muted">Edit</Link></div>
            <p className="mt-3 text-lg font-semibold">{data.goals?.roles[0] || "Set a target role"}</p>
            <p className="text-sm text-faint">{data.goals?.locations[0] || "Add a location"}</p>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-zinc-800"><div className="h-full bg-white" style={{ width: `${(data.completedSteps / 4) * 100}%` }} /></div>
            <p className="mt-2 text-xs text-faint">{data.completedSteps} / 4 steps completed</p>
            <p className="mt-4 text-3xl font-semibold">{data.contactsThisWeek}</p>
            <p className="text-sm text-muted">Contacts this week</p>
          </section>
        </aside>
      </div>
    </div>
  );
}

function EmailMilestone({ sends }: { sends: number }) {
  const goal = sends < 10 ? 10 : sends < 20 ? 20 : 50;
  const current = Math.min(sends, goal);
  return (
    <article className="rounded-2xl border border-line bg-card p-4">
      <p className="text-sm text-muted">First {goal} emails</p>
      <p className="mt-1 text-2xl font-semibold">{current} / {goal}</p>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-800"><div className="h-full bg-white" style={{ width: `${Math.min(100, (current / goal) * 100)}%` }} /></div>
    </article>
  );
}

function Stat({ value, label, hint }: { value: string; label: string; hint: string }) {
  return (
    <article className="rounded-2xl border border-line bg-card p-4">
      <p className="text-4xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-sm text-muted">{label}</p>
      <p className="mt-2 text-xs text-faint">{hint}</p>
    </article>
  );
}
