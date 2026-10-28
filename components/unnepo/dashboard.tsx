"use client";

import { useState } from "react";
import { PEOPLE_PER_CREDIT, PUBLIC_PLANS } from "@/lib/config";

type DashboardContact = { id: string; name: string; company: string; status?: string; foundAt?: string; photoUrl?: string };
type DashboardSearch = { id: string; mode: string; quantity: number; status: string; resultCount: number; creditsCharged: number; prompt: string; createdAt: string };

export type DashboardProps = {
  firstName: string;
  contacts: DashboardContact[];
  searches: DashboardSearch[];
  drafts: number;
  emailsSent: number;
  credits: number;
  plan: string;
  onFind: () => void;
  onContacts: () => void;
};

const DAY = 86400000;
const CONTACTED = new Set(["contacted", "follow_up_needed", "replied", "interested", "interview_scheduled", "closed"]);
const REPLIED = new Set(["replied", "interested", "interview_scheduled", "closed"]);

/** Spreads bubbles across the hero without randomness, so the layout is the same on every render. */
function bubbleSpot(index: number) {
  const x = (index * 37 + 11) % 92;
  const y = (index * 53 + 17) % 78;
  const size = 34 + ((index * 13) % 4) * 8;
  return { left: `${x + 2}%`, top: `${y + 6}%`, size, duration: 9 + (index % 5) * 2, delay: -((index * 1.7) % 9) };
}

function Initials({ name }: { name: string }) {
  return <>{name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?"}</>;
}

function Bubble({ contact, index }: { contact: DashboardContact; index: number }) {
  const [failed, setFailed] = useState(false);
  const spot = bubbleSpot(index);
  return (
    <span
      className="bubble-float absolute flex items-center justify-center overflow-hidden rounded-full border border-line bg-card text-[11px] font-semibold text-zinc-400 shadow-lg shadow-black/40"
      style={{ left: spot.left, top: spot.top, width: spot.size, height: spot.size, animationDuration: `${spot.duration}s`, animationDelay: `${spot.delay}s` }}
      title={`${contact.name}${contact.company ? ` · ${contact.company}` : ""}`}
    >
      {contact.photoUrl && !failed ? (
        <img src={contact.photoUrl} alt="" className="h-full w-full object-cover opacity-80" onError={() => setFailed(true)} referrerPolicy="no-referrer" />
      ) : (
        <Initials name={contact.name} />
      )}
    </span>
  );
}

function Tile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-panel/80 p-4 backdrop-blur">
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted">{label}</p>
      {hint && <p className="mt-0.5 text-[11px] text-faint">{hint}</p>}
    </div>
  );
}

function Card({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-line bg-panel p-5 ${className}`}>
      <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-faint">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** People found per day for the last 14 days. */
function FoundChart({ contacts, today }: { contacts: DashboardContact[]; today: number }) {
  const days = Array.from({ length: 14 }, (_, index) => today - (13 - index) * DAY);
  const counts = days.map((start) => contacts.filter((contact) => {
    const found = contact.foundAt ? new Date(contact.foundAt).getTime() : 0;
    return found >= start && found < start + DAY;
  }).length);
  const max = Math.max(1, ...counts);
  const total = counts.reduce((sum, count) => sum + count, 0);
  return (
    <div>
      <div className="flex h-36 items-end gap-1.5" role="img" aria-label={`${total} people found in the last 14 days`}>
        {counts.map((count, index) => (
          <div key={days[index]} className="group relative flex h-full flex-1 flex-col justify-end">
            <div className={`rounded-t-md ${count ? "bg-white/80 group-hover:bg-white" : "bg-line"}`} style={{ height: `${count ? Math.max(6, (count / max) * 100) : 3}%` }} />
            <span className="pointer-events-none absolute -top-6 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-card px-1.5 py-0.5 text-[10px] text-ink group-hover:block">{count}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-faint">
        <span>{new Date(days[0]).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
        <span>Today</span>
      </div>
    </div>
  );
}

/** Saved → contacted → replied → interview, as bars relative to saved. */
function Pipeline({ contacts }: { contacts: DashboardContact[] }) {
  const status = (contact: DashboardContact) => contact.status ?? "not_contacted";
  const stages = [
    { label: "Saved", count: contacts.length },
    { label: "Contacted", count: contacts.filter((contact) => CONTACTED.has(status(contact))).length },
    { label: "Replied", count: contacts.filter((contact) => REPLIED.has(status(contact))).length },
    { label: "Interview", count: contacts.filter((contact) => status(contact) === "interview_scheduled").length },
  ];
  const base = Math.max(1, stages[0].count);
  return (
    <ul className="space-y-3">
      {stages.map((stage, index) => (
        <li key={stage.label}>
          <div className="flex justify-between text-xs">
            <span className="text-muted">{stage.label}</span>
            <span className="tabular-nums">{stage.count}</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-line">
            <div className="h-full rounded-full bg-white" style={{ width: `${(stage.count / base) * 100}%`, opacity: 1 - index * 0.18 }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Companies sized by how many saved contacts work there. */
function CompanyBubbles({ contacts }: { contacts: DashboardContact[] }) {
  const counts = new Map<string, number>();
  for (const contact of contacts) if (contact.company) counts.set(contact.company, (counts.get(contact.company) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (!top.length) return <p className="text-sm text-muted">Companies show up here after your first search.</p>;
  const max = top[0][1];
  return (
    <div className="flex flex-wrap items-center gap-2">
      {top.map(([company, count]) => {
        const size = 56 + (count / max) * 44;
        return (
          <span key={company} className="flex shrink-0 flex-col items-center justify-center rounded-full border border-line bg-card text-center" style={{ width: size, height: size }} title={`${count} at ${company}`}>
            <span className="max-w-[85%] truncate text-[11px] font-medium">{company}</span>
            <span className="text-[10px] text-faint">{count}</span>
          </span>
        );
      })}
    </div>
  );
}

/** Credits left against the plan's allowance, as a ring. */
function CreditRing({ credits, plan }: { credits: number; plan: string }) {
  const planCredits = PUBLIC_PLANS.find((item) => item.id === plan)?.credits ?? PUBLIC_PLANS[0].credits;
  const share = Math.min(1, credits / Math.max(1, planCredits));
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="flex items-center gap-5">
      <svg viewBox="0 0 100 100" className="h-28 w-28 shrink-0 -rotate-90" role="img" aria-label={`${credits} credits left`}>
        <circle cx="50" cy="50" r={radius} fill="none" stroke="var(--color-line)" strokeWidth="9" />
        <circle cx="50" cy="50" r={radius} fill="none" stroke="#f7f7f8" strokeWidth="9" strokeLinecap="round" strokeDasharray={`${share * circumference} ${circumference}`} />
      </svg>
      <div>
        <p className="text-3xl font-semibold tabular-nums">{credits}</p>
        <p className="text-xs text-muted">credits left</p>
        <p className="mt-2 text-sm">= {(credits * PEOPLE_PER_CREDIT).toLocaleString("en-US")} contacts</p>
        <p className="text-[11px] text-faint">1 credit = {PEOPLE_PER_CREDIT} contacts</p>
      </div>
    </div>
  );
}

export function Dashboard({ firstName, contacts, searches, drafts, emailsSent, credits, plan, onFind, onContacts }: DashboardProps) {
  // Start of today, read once when the dashboard mounts.
  const [today] = useState(() => new Date().setHours(0, 0, 0, 0));
  const contacted = contacts.filter((contact) => CONTACTED.has(contact.status ?? "not_contacted")).length;
  const completed = searches.filter((search) => search.status === "completed");
  const peopleFound = completed.reduce((sum, search) => sum + search.resultCount, 0);
  const bubbles = contacts.slice(0, 18);
  // Word bubbles fill the hero until there are enough contacts to float on their own.
  const placeholders = ["Recruiter", "Founder", "Alumni", "Manager", "Designer", "Analyst", "Engineer", "Marketer", "Mentor", "Director"].slice(0, Math.max(0, 10 - bubbles.length));

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-3xl border border-line bg-panel px-6 py-10 sm:px-10 sm:py-14">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          {bubbles.map((contact, index) => <Bubble key={contact.id} contact={contact} index={index} />)}
          {placeholders.map((word, index) => {
            const spot = bubbleSpot(index + bubbles.length);
            return (
              <span key={word} className="bubble-float absolute rounded-full border border-line bg-card/70 px-3 py-1 text-[11px] text-faint" style={{ left: spot.left, top: spot.top, animationDuration: `${spot.duration}s`, animationDelay: `${spot.delay}s` }}>
                {word}
              </span>
            );
          })}
          <div className="absolute inset-0 bg-gradient-to-r from-panel via-panel/70 to-transparent" />
        </div>
        <div className="relative max-w-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-faint">Home</p>
          <h1 className="mt-2 text-4xl font-bold tracking-tight md:text-5xl">{firstName ? `Hi, ${firstName}.` : "Welcome back."}</h1>
          <p className="mt-3 text-muted">
            {contacts.length
              ? `You have ${contacts.length} ${contacts.length === 1 ? "contact" : "contacts"} with verified emails and you've reached out to ${contacted}.`
              : "Find people worth meeting. Each one comes with a verified work email."}
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <button type="button" onClick={onFind} className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200">Find new contacts</button>
            {contacts.length > 0 && <button type="button" onClick={onContacts} className="rounded-xl border border-line px-4 py-2 text-sm hover:bg-white/5">My contacts</button>}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="Saved contacts" value={contacts.length} />
        <Tile label="Contacted" value={contacted} />
        <Tile label="Emails sent" value={emailsSent} hint="From your mailbox" />
        <Tile label="Drafts saved" value={drafts} />
        <Tile label="People found" value={peopleFound} hint={`${completed.length} ${completed.length === 1 ? "search" : "searches"}`} />
        <Tile label="Credits left" value={credits} hint={`${(credits * PEOPLE_PER_CREDIT).toLocaleString("en-US")} contacts`} />
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="People found · last 14 days" className="lg:col-span-2">
          <FoundChart contacts={contacts} today={today} />
        </Card>
        <Card title="Credits">
          <CreditRing credits={credits} plan={plan} />
        </Card>
        <Card title="Outreach">
          <Pipeline contacts={contacts} />
        </Card>
        <Card title="Top companies" className="lg:col-span-2">
          <CompanyBubbles contacts={contacts} />
        </Card>
      </div>

      <Card title="Recent searches">
        {searches.length === 0 ? (
          <p className="text-sm text-muted">No searches yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {searches.slice(0, 6).map((item) => (
              <li key={item.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 text-sm first:pt-0">
                <div className="min-w-0">
                  <p className="font-medium">{item.mode === "automatic" ? "Find for Me" : "Custom Search"} · {item.status === "completed" ? `${item.resultCount} found` : `up to ${item.quantity} people`}</p>
                  {item.prompt && <p className="truncate text-muted">{item.prompt}</p>}
                </div>
                <p className="shrink-0 text-xs text-faint">{new Date(item.createdAt).toLocaleDateString()} · {item.creditsCharged} {item.creditsCharged === 1 ? "credit" : "credits"}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
