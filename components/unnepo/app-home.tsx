"use client";

import { SpiderLoader } from "@/components/unnepo/spider-loader";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Highlight, Profile } from "@/components/unnepo/UnnepoForms";
import { ResumeFirst } from "@/components/onboarding/resume-first";
import { CREDIT_COST, ENTERPRISE_PLAN, PUBLIC_PLANS } from "@/lib/config";
import type { planUsage } from "@/lib/apply/limits";
import { Logo } from "@/components/brand/logo";
import { SpiderSettings } from "@/components/unnepo/spider-settings";
import { JobsView } from "@/components/unnepo/jobs-view";
import { extensionHere } from "@/lib/extension-bridge";
import { trialLeftLabel } from "@/lib/plan";

type PlanUsage = Awaited<ReturnType<typeof planUsage>>;

type StudentFact = { id: string; text: string; verified: boolean };
type Workspace = {
  user: { name: string; email: string };
  admin?: boolean;
  credits: { balance: number; plan: string; includedAllowance: number; unlimited?: boolean; coverLetters?: { used: number; left: number | null }; usage?: PlanUsage };
  profile: { ready: boolean; form: Profile; organizedProfile: unknown | null } | null;
  /** The resume-first profile is confirmed (or the student finished the old onboarding). */
  ready: boolean;
  completeness: number;
  studentFacts: StudentFact[];
  highlights: Highlight[];
  resume: { id: string; fileName: string; byteSize: number } | null;
  integrations: { apollo: boolean; anthropic: boolean };
};

// The tracker, reminders, people and follow-ups live in the Chrome extension. The site keeps the profile and the
// plans, and shows the jobs applied to.
type View = "home" | "jobs" | "settings" | "pro";
const VIEWS: { id: View; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "jobs", label: "Jobs" },
  { id: "settings", label: "Settings and plans" },
  // Only on Free: why Pro, and the button to get it.
  { id: "pro", label: "Upgrade to Pro" },
];

/** What Pro does that Free doesn't, on the Upgrade to Pro page. */
const PRO_REASONS: Array<[string, string]> = [
  ["See who to email at every company", "Names, titles and checked emails for recruiters, hiring managers and the team, not just how many there are."],
  ["Show person on every job", "Reveal the people on a job's list, with their LinkedIn and email."],
  ["Cover letters written for each job", "Tailored to the posting and your resume."],
  ["The hard questions answered for you", "\"Why do you want to work here?\" and every other written question, drafted from your profile."],
  ["Follow-up emails written for you", "A short note to each person, ready to send from Gmail or Outlook."],
  ["People at 25 companies a month, or 100 a semester", "Plus 50 more companies for $15 whenever you need them."],
];
const LEGACY_PLANS: Record<string, string> = { grind: "Grind (legacy)", pack: "Credit pack (legacy)", premium: "Premium (no longer offered)" };

export function AppHome({ start = "home" }: { start?: View } = {}) {
  const router = useRouter();
  const [data, setData] = useState<Workspace | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [billingBusy, setBillingBusy] = useState(false);
  const [view, setView] = useState<View>(start);
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [extension, setExtension] = useState<boolean | null>(null);
  const menu = useRef<HTMLDivElement>(null);
  // The extension's "Edit my info" opens /home?edit=profile; /home?tab=settings opens Settings and plans, ?tab=jobs the Jobs tab.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    if (params.get("edit") === "profile") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- opening from a link, once
      setEditing(true);
      window.history.replaceState(null, "", window.location.pathname);
    } else if (tab === "settings" || tab === "jobs" || tab === "pro") {
      setView(tab);
      window.history.replaceState(null, "", "/home" + window.location.hash);
    } else if (params.get("billing")) {
      // Coming back from Stripe. The plan changes when Stripe's webhook arrives, usually within seconds.
      setView("settings");
      setNotice(params.get("billing") === "success" ? "Payment received, thank you. Your plan updates in a few seconds, so refresh if you don't see it yet." : "Checkout cancelled. You weren't charged.");
      window.history.replaceState(null, "", "/home");
    }
    void extensionHere().then(setExtension);
  }, []);
  // /settings#plans (the upgrade links): the plans, once the page has them.
  const loaded = Boolean(data);
  useEffect(() => {
    if (loaded && view === "settings" && window.location.hash === "#plans") requestAnimationFrame(() => document.getElementById("plans")?.scrollIntoView({ block: "start" }));
  }, [loaded, view]);
  // The account menu closes on Escape or a click outside it.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setMenuOpen(false); };
    const onClick = (event: MouseEvent) => { if (!menu.current?.contains(event.target as Node)) setMenuOpen(false); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [menuOpen]);

  /** Loads the workspace, giving up after 30 seconds so the page never waits forever. */
  const fetchState = useCallback(async (): Promise<Workspace | null> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch("/api/app/state", { signal: controller.signal });
      if (response.status === 401) {
        // A full page load: the router may have remembered /login redirecting here while the old cookie was alive.
        window.location.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
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
  }, []);

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

  /** Off to Stripe. The buttons stay disabled until the page leaves, so a double click can't start two checkouts. */
  async function goToBilling(path: "checkout" | "portal", body: Record<string, string> = {}) {
    setBillingBusy(true);
    try {
      const response = await fetch(`/api/billing/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (payload.url) {
        window.location.assign(payload.url);
        return;
      }
      setNotice(payload.error || "Billing isn't available right now. Try again in a bit.");
    } catch {
      setNotice("Billing isn't available right now. Try again in a bit.");
    }
    setBillingBusy(false);
  }

  /** Admins: work as Free or Pro (null: the real plan) without going to Stripe. */
  async function switchPlanView(plan: "free" | "pro" | null) {
    setBillingBusy(true);
    try {
      const response = await fetch("/api/me/plan-preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) setNotice(payload.error || "Couldn't switch plans.");
      else {
        setNotice(plan ? `Viewing Unnepo as ${plan === "pro" ? "Pro" : "Free"}. Nothing was charged.` : "Back to your real plan.");
        await load();
      }
    } catch {
      setNotice("Couldn't switch plans.");
    }
    setBillingBusy(false);
  }

  const showOnboarding = !data?.ready || editing;

  const sectionTitle = "text-xs font-semibold uppercase tracking-[0.16em] text-faint";

  const admin = Boolean(data?.admin);
  // Free with the trial over: the Upgrade to Pro page shows in the menu.
  const onFree = Boolean(data?.credits.usage?.free);
  const planView = data?.credits.usage?.preview ?? null;
  // An admin viewing as Free or Pro sees that plan as theirs.
  const currentPlan = planView ?? data?.credits.plan ?? "free";
  const subscribed = currentPlan === "pro" || currentPlan === "premium" || currentPlan === "grind";
  const usage = data?.credits.usage;
  const creditsLeft = usage?.credits ?? (data?.credits.balance ?? 0) * CREDIT_COST.people;
  const creditsLabel = data?.credits.unlimited ? "Unlimited credits" : `${creditsLeft} ${creditsLeft === 1 ? "credit" : "credits"} left`;
  const usesLeft = usage ? [
    ...(usage.free ? [`${usage.letters.left} ${usage.letters.left === 1 ? "cover letter" : "cover letters"}`, `${usage.answers.left} ${usage.answers.left === 1 ? "chat answer" : "chat answers"}`] : []),
    ...(usage.unlimited ? [] : [`${usage.people.left} ${usage.people.left === 1 ? "people search" : "people searches"}`]),
  ] : [];
  const initials = (data?.user.name || data?.user.email || "").split(/\s+/).map((part) => part[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
  return (
    <div className="min-h-screen bg-bg text-ink [color-scheme:dark]">
      <header className="z-20 border-b sm:sticky sm:top-0 border-[#17171B] bg-bg/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1920px] flex-wrap items-center justify-between gap-x-4 gap-y-3 px-3 py-[14px] sm:px-5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-9 gap-y-2">
            <Logo />
            {data && !showOnboarding && (
              <nav aria-label="App" className="flex gap-1">
                {VIEWS.filter((item) => item.id !== "pro" || onFree).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setView(item.id)}
                    aria-current={view === item.id ? "page" : undefined}
                    className={`h-9 whitespace-nowrap rounded-full px-3.5 text-sm font-medium ${view === item.id ? "bg-[#F7F7F8] text-[#070708]" : "text-[#9A9AA3] hover:text-white"}`}
                  >
                    {item.label}
                  </button>
                ))}
              </nav>
            )}
          </div>
          <div className="flex items-center gap-3.5 whitespace-nowrap">
            {data && !showOnboarding && extension !== null && (
              extension
                ? <span className="hidden items-center gap-2 text-[13px] text-[#9A9AA3] md:inline-flex"><span aria-hidden className="h-[7px] w-[7px] rounded-full bg-[#4ADE80]" />Extension installed</span>
                : <a href="/extension/connect" className="hidden items-center gap-2 text-[13px] text-[#9A9AA3] hover:text-white md:inline-flex"><span aria-hidden className="h-[7px] w-[7px] rounded-full bg-[#8B8B94]" />Get the extension</a>
            )}
            {data && <span className="font-mono text-xs uppercase text-[#8B8B94]">{creditsLabel}</span>}
            {data ? (
              <div className="relative" ref={menu}>
                <button type="button" aria-label="Account and settings" aria-expanded={menuOpen} onClick={() => setMenuOpen((on) => !on)} className="h-9 w-9 rounded-full border border-[#26262C] bg-[#111114] text-[13px] font-semibold text-[#F7F7F8] hover:border-[#3D8BFF]">{initials || "?"}</button>
                {menuOpen && (
                  <div className="absolute right-0 top-11 z-30 flex w-64 flex-col rounded-xl border border-[#26262C] bg-[#0C0C0E] p-2 text-sm shadow-2xl">
                    <p className="m-0 truncate px-2.5 pt-1 font-medium">{data.user.name || "Student"}</p>
                    <p className="m-0 truncate px-2.5 text-xs text-[#8B8B94]">{data.user.email}</p>
                    {usesLeft.length > 0 && <p className="m-0 px-2.5 pb-1 pt-1 text-xs text-[#8B8B94]">{usesLeft.join(" · ")} left</p>}
                    <div className="my-1.5 h-px bg-[#1F1F24]" />
                    {!showOnboarding && <button type="button" onClick={() => { setView("settings"); setMenuOpen(false); }} className="rounded-lg px-2.5 py-2 text-left hover:bg-white/5">Settings and plans</button>}
                    {!showOnboarding && <button type="button" onClick={() => { setEditing(true); setMenuOpen(false); window.scrollTo({ top: 0 }); }} className="rounded-lg px-2.5 py-2 text-left hover:bg-white/5">Edit my info</button>}
                    <a href="/demo" className="rounded-lg px-2.5 py-2 text-[#F7F7F8] hover:bg-white/5">See how it works</a>
                    <button type="button" onClick={logout} className="rounded-lg px-2.5 py-2 text-left hover:bg-white/5">Log out</button>
                  </div>
                )}
              </div>
            ) : <button type="button" onClick={logout} className="text-sm text-muted hover:text-white">Log out</button>}
          </div>
        </div>
      </header>
      <main className="mx-auto flex max-w-[1920px] flex-col gap-8 overflow-x-clip px-3 pb-16 pt-6 sm:px-5">
        {error && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
            <p>{error}</p>
            <button type="button" onClick={() => { setError(""); void load(); }} className="rounded-lg border border-red-900/70 px-3 py-1 text-red-200 hover:bg-red-950/60">Try again</button>
          </div>
        )}
        {!data && !error && <SpiderLoader label="Loading your workspace…" />}
        {data && !showOnboarding && usage && !usage.unlimited && view !== "settings" && view !== "pro" && <TrialBanner usage={usage} onPlans={() => { setView("settings"); requestAnimationFrame(() => document.getElementById("plans")?.scrollIntoView({ block: "start" })); }} />}
        {notice && (
          <div className="flex items-start justify-between gap-3 rounded-xl border border-line bg-card px-4 py-3 text-sm text-zinc-300">
            <p>{notice}</p>
            <button type="button" onClick={() => setNotice("")} aria-label="Dismiss" className="text-faint hover:text-white">✕</button>
          </div>
        )}
        {data && showOnboarding && (
          <ResumeFirst
            key={editing ? "edit" : "onboarding"}
            mode={data.ready ? "edit" : "onboarding"}
            onDone={() => { setEditing(false); void load(); }}
          />
        )}
        {data && !showOnboarding && view === "jobs" && <JobsView />}
        {data && !showOnboarding && view === "pro" && (
          onFree ? <UpgradePage busy={billingBusy} admin={admin} onUpgrade={(billing) => (admin ? void switchPlanView("pro") : void goToBilling("checkout", { plan: "pro", billing }))} onPlans={() => { setView("settings"); requestAnimationFrame(() => document.getElementById("plans")?.scrollIntoView({ block: "start" })); }} />
            : <p className="text-sm text-muted">You&apos;re on Pro. Your plan is under <button type="button" onClick={() => setView("settings")} className="underline underline-offset-4 hover:text-white">Settings and plans</button>.</p>
        )}
        {data && !showOnboarding && view === "home" && <ExtensionHome installed={extension} completeness={data.completeness} onEdit={() => { setEditing(true); window.scrollTo({ top: 0 }); }} />}
        {data && !showOnboarding && view === "settings" && (
          <>
            <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Settings</h1>
            <section className="grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-line bg-panel p-5">
                <h2 className={sectionTitle}>Account</h2>
                <p className="mt-3 font-medium">{data.user.name || "Student"}</p>
                <p className="text-sm text-muted">{data.user.email}</p>
                <button type="button" onClick={logout} className="mt-4 rounded-xl border border-line px-3 py-1.5 text-sm hover:bg-white/5">Log out</button>
                <p className="mt-4 text-xs text-faint">Questions or problems? <a href={`mailto:${ENTERPRISE_PLAN.contactEmail}`} className="text-muted underline underline-offset-4 hover:text-white">{ENTERPRISE_PLAN.contactEmail}</a></p>
              </div>
              <div className="rounded-2xl border border-line bg-panel p-5">
                <h2 className={sectionTitle}>Profile</h2>
                <p className="mt-3 text-sm text-muted">Your profile is {data.completeness}% ready. It&apos;s what every application is filled from: contact details, schools, jobs, projects, skills, and your answers to common questions.</p>
                <button type="button" onClick={() => { setEditing(true); window.scrollTo({ top: 0 }); }} className="mt-4 rounded-xl bg-white px-3 py-1.5 text-sm font-semibold text-black hover:bg-zinc-200">Edit profile</button>
              </div>
              <div className="rounded-2xl border border-line bg-panel p-5">
                <h2 className={sectionTitle}>Chrome extension</h2>
                <p className="mt-3 text-sm text-muted">The extension fills applications from your profile in your own browser and logs each one you submit. Your job-site passwords stay in the extension.</p>
                <a href="/extension/connect" className="mt-4 inline-flex rounded-xl border border-line px-3 py-1.5 text-sm hover:bg-white/5">Connect the extension</a>
              </div>
            </section>
            <SpiderSettings />
            <section id="plans" className="scroll-mt-24 space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold tracking-tight">Plans</h2>
                  <p className="mt-1 text-sm text-muted">
                    {usage?.trial ? <>You&apos;re on your free Pro trial, {trialLeftLabel(usage.trial)}. Then you&apos;ll be on Free unless you choose a plan. </> : null}
                    You&apos;re on {LEGACY_PLANS[currentPlan] ?? PUBLIC_PLANS.find((plan) => plan.id === currentPlan)?.name ?? "Free"} with {creditsLabel.toLowerCase()}{usesLeft.length ? `: ${usesLeft.join(", ")}` : ""}.
                  </p>
                </div>
                <p className="text-xs text-faint">{CREDIT_COST.people} credits = up to 5 people at one company</p>
              </div>
              {admin && (
                <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[#3D8BFF] bg-panel p-4 text-sm">
                  <span className="mr-auto text-muted">Admin: {planView ? <>viewing as <strong className="text-white">{planView === "pro" ? "Pro" : "Free"}</strong>. Billing isn&apos;t touched.</> : <>the plan buttons switch your view, no Stripe.</>}</span>
                  {(["free", "pro"] as const).map((plan) => (
                    <button key={plan} type="button" disabled={billingBusy || planView === plan} onClick={() => void switchPlanView(plan)} className="rounded-xl border border-line px-3 py-1.5 hover:bg-white/5 disabled:opacity-50">View as {plan === "pro" ? "Pro" : "Free"}</button>
                  ))}
                  {planView && <button type="button" disabled={billingBusy} onClick={() => void switchPlanView(null)} className="rounded-xl border border-line px-3 py-1.5 hover:bg-white/5 disabled:opacity-50">My real plan</button>}
                </div>
              )}
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {PUBLIC_PLANS.map((plan) => {
                  const current = plan.id === currentPlan;
                  return (
                    <div key={plan.id} className={`flex flex-col rounded-2xl border p-5 ${current ? "border-white bg-card" : "border-line bg-panel"}`}>
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-lg font-semibold">{plan.name}</h3>
                        {usage?.trial && plan.id === "pro" ? (
                          <span className="rounded-full bg-[#3D8BFF] px-2.5 py-0.5 text-xs font-semibold text-black">On trial</span>
                        ) : current ? (
                          <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-black">{usage?.trial ? "After your trial" : "Current plan"}</span>
                        ) : plan.popular ? (
                          <span className="rounded-full border border-line px-2.5 py-0.5 text-xs text-muted">Popular</span>
                        ) : null}
                      </div>
                      <p className="mt-3 text-3xl font-bold tabular-nums">{plan.priceLabel}<span className="text-sm font-normal text-muted">{plan.monthly ? " / month" : ""}</span></p>
                      {plan.semesterLabel && <p className="mt-1 text-xs text-faint">{plan.semesterLabel}</p>}
                      <p className="mt-1 text-sm text-muted">{plan.blurb}</p>
                      <p className="mt-4 text-sm font-medium">{plan.applicationsLabel}</p>
                      <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0 text-sm text-muted">{plan.features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
                      <div className="mt-auto pt-5">
                        {admin && (plan.id === "free" || plan.id === "pro") ? (
                          current ? <p className="text-center text-sm text-muted">Viewing as {plan.name}</p> : (
                            <button type="button" disabled={billingBusy} onClick={() => void switchPlanView(plan.id === "free" || plan.id === "pro" ? plan.id : null)} className="w-full rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200 disabled:opacity-50">Switch to {plan.name} (admin, free)</button>
                          )
                        ) : current ? (
                          plan.monthly ? (
                            <button type="button" disabled={billingBusy} onClick={() => void goToBilling("portal")} className="w-full rounded-xl border border-line px-4 py-2 text-sm font-semibold hover:bg-white/5 disabled:opacity-50">Manage subscription</button>
                          ) : (
                            <p className="text-center text-sm text-muted">Your plan</p>
                          )
                        ) : plan.monthly ? (
                          <>
                            <button type="button" disabled={billingBusy} onClick={() => void goToBilling("checkout", { plan: plan.id, billing: "monthly" })} className="w-full rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200 disabled:opacity-50">{subscribed ? "Switch" : "Upgrade"} to {plan.name}</button>
                            <button type="button" disabled={billingBusy} onClick={() => void goToBilling("checkout", { plan: plan.id, billing: "semester" })} className="mt-2 w-full rounded-xl border border-line px-4 py-2 text-sm hover:bg-white/5 disabled:opacity-50">Pay by the semester</button>
                          </>
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
              {currentPlan !== "free" && (
                <div className="flex flex-wrap gap-3">
                  <button type="button" disabled={billingBusy} onClick={() => void goToBilling("checkout", { plan: "pack" })} className="rounded-xl border border-line px-3 py-1.5 text-sm hover:bg-white/5 disabled:opacity-50">Add 50 more companies for $15</button>
                  {(currentPlan === "grind" || currentPlan === "premium") && <button type="button" disabled={billingBusy} onClick={() => void goToBilling("portal")} className="rounded-xl border border-line px-3 py-1.5 text-sm hover:bg-white/5 disabled:opacity-50">Manage subscription</button>}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

/**
 * The Pro trial, while it runs (how long is left, and what goes when it ends), and once it's over (what Free
 * doesn't do). Shown above every page but Settings, where the plans are.
 */
/** Upgrade to Pro: the price, every reason, and the button to Stripe (an admin just switches their view). */
function UpgradePage({ busy, admin, onUpgrade, onPlans }: { busy: boolean; admin: boolean; onUpgrade: (billing: "monthly" | "semester") => void; onPlans: () => void }) {
  const pro = PUBLIC_PLANS.find((plan) => plan.id === "pro")!;
  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div>
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-faint">Unnepo Pro</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight md:text-4xl">Get replies, not just applications</h1>
        <p className="mt-3 text-muted">You&apos;re on Free. Pro is everything Free does, plus finding the right person at each company and writing to them for you.</p>
      </div>
      <div className="rounded-2xl border border-[#3D8BFF] bg-panel p-6">
        <p className="text-4xl font-bold tabular-nums">{pro.priceLabel}<span className="text-base font-normal text-muted"> / month</span></p>
        {pro.semesterLabel && <p className="mt-1 text-sm text-faint">{pro.semesterLabel}</p>}
        <ul className="m-0 mt-6 flex list-none flex-col gap-4 p-0">
          {PRO_REASONS.map(([title, why]) => (
            <li key={title} className="grid grid-cols-[20px_1fr] gap-3">
              <span aria-hidden className="font-bold text-[#3D8BFF]">✓</span>
              <span><span className="block font-semibold">{title}</span><span className="text-sm text-muted">{why}</span></span>
            </li>
          ))}
        </ul>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <button type="button" disabled={busy} onClick={() => onUpgrade("monthly")} className="flex-1 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-black hover:bg-zinc-200 disabled:opacity-50">{admin ? "Switch to Pro (admin, free)" : `Upgrade to Pro, ${pro.priceLabel} a month`}</button>
          {!admin && <button type="button" disabled={busy} onClick={() => onUpgrade("semester")} className="flex-1 rounded-xl border border-line px-4 py-2.5 text-sm hover:bg-white/5 disabled:opacity-50">Pay by the semester</button>}
        </div>
        <p className="mt-3 text-xs text-faint">Cancel any time. <button type="button" onClick={onPlans} className="underline underline-offset-4 hover:text-white">Compare every plan</button></p>
      </div>
    </section>
  );
}

function TrialBanner({ usage, onPlans }: { usage: PlanUsage; onPlans: () => void }) {
  if (!usage.trial && !(usage.trialEnded && usage.free)) return null;
  const urgent = usage.trial ? usage.trial.hoursLeft <= 48 : true;
  return (
    <div role="status" className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${urgent ? "border-[#F5A524]/60 bg-[#F5A524]/[0.07]" : "border-[#3D8BFF]/50 bg-[#3D8BFF]/[0.07]"}`}>
      <p className="m-0 min-w-0 flex-1 basis-72">
        {usage.trial ? (
          <><strong className="font-semibold">Pro trial: {trialLeftLabel(usage.trial)}.</strong> <span className="text-muted">After that, autofill skips the questions, cover letters aren&apos;t tailored, people stay hidden, and follow-ups aren&apos;t written for you.</span></>
        ) : (
          <><strong className="font-semibold">Your Pro trial ended.</strong> <span className="text-muted">You&apos;re on Free: autofill fills your basic details, and people and follow-up drafts are hidden. Pro brings them back.</span></>
        )}
      </p>
      <button type="button" onClick={onPlans} className="shrink-0 rounded-xl bg-white px-3.5 py-1.5 text-sm font-semibold text-black hover:bg-zinc-200">{usage.trial ? "Keep Pro" : "Get Pro back"}</button>
    </div>
  );
}

/**
 * Home on the site: everything day to day happens in the extension (the tracker, reminders, the people at each
 * company, follow-ups), so this says where to find it, with the profile it all runs on.
 */
function ExtensionHome({ installed, completeness, onEdit }: { installed: boolean | null; completeness: number; onEdit: () => void }) {
  const card = "rounded-2xl border border-line bg-panel p-5 sm:p-6";
  return (
    <section className="flex max-w-3xl flex-col gap-5">
      <h1 className="m-0 text-3xl font-bold tracking-tight md:text-4xl">Unnepo lives in Chrome now</h1>
      <p className="m-0 text-[15px] leading-[1.6] text-muted">Your applications, reminders, the people to email at each company, and follow-ups are all in the Unnepo extension&apos;s side panel. Click the Unnepo icon in Chrome&apos;s toolbar to open it.</p>
      <div className={card}>
        <ul className="m-0 flex list-none flex-col gap-3 p-0 text-sm text-[#B4B4BC]">
          <li><strong className="text-ink">Home</strong>: what to do today, jobs the extension caught you applying to, and follow-ups that are due.</li>
          <li><strong className="text-ink">People</strong>: on any applied job, find who to email. Their address opens a ready-to-send email.</li>
          <li><strong className="text-ink">Dashboard</strong>: every job in one table, opened from the panel.</li>
        </ul>
        <div className="mt-5 flex flex-wrap gap-3">
          <a href="/extension/connect" className="inline-flex items-center rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200">{installed ? "Connect the extension" : "Get the extension"}</a>
          <button type="button" onClick={onEdit} className="rounded-xl border border-line px-4 py-2 text-sm hover:bg-white/5">Edit my info</button>
        </div>
      </div>
      <p className="m-0 text-xs text-faint">Your profile is {completeness}% ready. The extension applies with it.</p>
    </section>
  );
}
