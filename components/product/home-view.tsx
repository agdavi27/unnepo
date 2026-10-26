"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bell, Briefcase, CloudUpload, Search, Send } from "lucide-react";
import { Avatar, CompanyLogo, CompanyMark, StatusPill } from "@/components/product/bits";
import { GoalChecklist } from "@/components/product/goal-checklist";
import { greeting, timeAgo } from "@/lib/format";

type Dashboard = {
  user: { name: string; email: string } | null;
  resume: { fileName: string; byteSize: number; createdAt: string } | null;
  credits: { balance: number; plan: string } | null;
  summary: { unlocked: number; confirmedSends: number; demoOutbox: number; replies: number };
  deltas: { contactsToday: number; sendsToday: number; repliesToday: number };
  contactsThisWeek: number;
  steps: { resume: boolean; goals: boolean; contacts: boolean; outreach: boolean };
  completedSteps: number;
  goals: { roles: string[]; locations: string[]; industries: string[]; companies: string[]; tracks?: string[]; timing?: string } | null;
  roleSuggestions: { fromResume: string[]; similar: string[] };
  recent: Array<{ saved: { id: string; status: string; updatedAt: string }; contact: { fullName: string; title: string; company: string; location: string } | null }>;
  jobs: Array<{ id: string; title: string; company: string; location: string; postedAt: string }>;
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

  if (!data) return <div className="p-8 text-muted">{error || "Loading your workspace…"}</div>;

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
          <GoalChecklist resumeName={data.resume?.fileName ?? null} suggestions={data.roleSuggestions} goals={data.goals} onUpdated={load} />
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat value={String(data.credits?.balance ?? 0)} label="Total Credits" hint={data.credits?.plan === "grind" ? "Pro plan" : "Free plan"} />
            <Stat value={String(data.summary.unlocked)} label="Contacts Found" hint={`+${data.deltas.contactsToday} today`} />
            <Stat value={String(data.summary.confirmedSends)} label="Emails Sent" hint={data.summary.demoOutbox ? `${data.summary.demoOutbox} in demo outbox` : `+${data.deltas.sendsToday} today`} />
            <Stat value={String(data.summary.replies)} label="Replies" hint={`+${data.deltas.repliesToday} today`} />
          </section>
          <section className="rounded-2xl border border-line bg-card">
            <div className="flex items-center justify-between px-4 py-3">
              <h2 className="text-lg font-semibold">Recent Contacts</h2>
              <Link href="/saved" className="text-sm text-muted">View all →</Link>
            </div>
            {data.recent.length === 0 ? (
              <p className="px-4 pb-6 text-sm text-muted">No unlocked contacts yet. Showing a list costs 1 credit. Revealing an email costs 1 more credit, and only when the lookup succeeds.</p>
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
          <section>
            <h2 className="mb-3 text-lg font-semibold">Quick Actions</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Action href="/contacts" icon={<Search className="h-4 w-4" />} title="Find New Contact" copy="Search by role, company, or location." />
              <Action href="/outreach" icon={<Send className="h-4 w-4" />} title="Send Outreach" copy="Create personalized emails with AI." />
              <Action href="/jobs" icon={<Briefcase className="h-4 w-4" />} title="View Job Postings" copy="Discover new opportunities." />
              <Action href="/settings" icon={<CloudUpload className="h-4 w-4" />} title="Upload Resume" copy="Update your profile and skills." />
            </div>
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
          <p className="hand hidden px-2 text-right text-2xl text-zinc-300 xl:block">Progress creates opportunity.</p>
        </aside>
      </div>
      <p className="hand mt-6 max-w-xs text-2xl text-zinc-400">Better opportunities are a click away.</p>
    </div>
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

function Action({ href, icon, title, copy }: { href: string; icon: React.ReactNode; title: string; copy: string }) {
  return (
    <Link href={href} className="rounded-2xl border border-line bg-card p-4 hover:border-zinc-500">
      <span className="text-muted">{icon}</span>
      <p className="mt-3 font-medium">{title}</p>
      <p className="text-sm text-faint">{copy}</p>
    </Link>
  );
}
