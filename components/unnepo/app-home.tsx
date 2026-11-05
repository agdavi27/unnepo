"use client";

import { SpiderLoader } from "@/components/unnepo/spider-loader";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Highlight, Profile } from "@/components/unnepo/UnnepoForms";
import { ResumeFirst } from "@/components/onboarding/resume-first";
import { CoverLetterModal, JobsPage, type Job } from "@/components/unnepo/jobs";
import { CREDIT_COST, ENTERPRISE_PLAN, PUBLIC_PLANS } from "@/lib/config";
import type { PlanUsage } from "@/components/unnepo/apply";
import { Logo } from "@/components/brand/logo";
import { ApplyArea, SpiderSettings } from "@/components/unnepo/apply";
import { SetupPage } from "@/components/unnepo/setup";
import { extensionHere } from "@/lib/extension-bridge";

type StudentFact = { id: string; text: string; verified: boolean };
type Workspace = {
  user: { name: string; email: string };
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

// Applications are added by the Chrome extension. "Jobs for you" suggests postings that fit the resume.
type View = "home" | "applications" | "jobs" | "setup" | "settings";
const VIEWS: { id: View; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "applications", label: "Applications" },
  { id: "jobs", label: "Jobs for you" },
  { id: "setup", label: "Setup" },
];
const LEGACY_PLANS: Record<string, string> = { grind: "Grind (legacy)", pack: "Credit pack (legacy)" };

export function AppHome({ start = "home" }: { start?: View }) {
  const router = useRouter();
  const [data, setData] = useState<Workspace | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [resumeBusy, setResumeBusy] = useState(false);
  const [resumeVersion, setResumeVersion] = useState(0);
  const [view, setView] = useState<View>(start);
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [extension, setExtension] = useState<boolean | null>(null);
  const menu = useRef<HTMLDivElement>(null);
  // The extension's "Edit my info" opens /home?edit=profile; /home?tab=setup opens that tab; /home?job=<id> opens that job in Applications.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    if (params.get("edit") === "profile") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- opening from a link, once
      setEditing(true);
      window.history.replaceState(null, "", window.location.pathname);
    } else if (tab === "setup" || tab === "jobs") {
      setView(tab);
      window.history.replaceState(null, "", "/home");
    } else if (params.get("job")) {
      setView("applications");
    }
    void extensionHere().then(setExtension);
  }, []);
  // Applications has its own address, so a refresh or a saved link stays on it.
  useEffect(() => {
    const path = view === "applications" ? "/applications" : "/home";
    if (window.location.pathname !== path) window.history.replaceState(null, "", path + window.location.search);
  }, [view]);
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
  const [highlightsLoading, setHighlightsLoading] = useState(false);
  const [letter, setLetter] = useState<{ job: Job | null; jobs: Job[] } | null>(null);

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

  /** The header's resume button: the newest upload becomes the resume autofill uses. */
  async function replaceResume(file: File) {
    setResumeBusy(true);
    try {
      const body = new FormData();
      body.set("file", file);
      // The profile endpoint also reads the new resume into the profile, keeping anything the student typed.
      const response = await fetch("/api/profile/resume", { method: "POST", body });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setNotice(payload.error || "Couldn't save that resume. Try a PDF or DOCX under 10 MB.");
        return;
      }
      setNotice(`${hadResume ? "Replaced your resume with" : "Attached"} ${payload.resume?.fileName ?? file.name}.${payload.read ? " New details from it were added to your profile; anything you typed yourself was kept." : ""}`);
      await load();
      setResumeVersion((value) => value + 1);
    } finally {
      setResumeBusy(false);
    }
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
    try {
      const response = await fetch("/api/app/highlights", { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setNotice(payload.error || "Highlights could not be built right now.");
        return;
      }
      await load();
    } catch {
      setNotice("Highlights could not be built right now.");
    } finally {
      setHighlightsLoading(false);
    }
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
    void load();
    if (payload.addedToApplied) setNotice(`Added ${input.job.title} at ${input.job.company} to your applied jobs.`);
    return String(payload.body ?? "");
  }

  // The Applications page reloads what's left after every action, so the header keeps up.
  const onUsage = useCallback((next: PlanUsage) => setData((previous) => (previous ? { ...previous, credits: { ...previous.credits, balance: next.people.left, usage: next } } : previous)), []);

  const showOnboarding = !data?.ready || editing;

  const sectionTitle = "text-xs font-semibold uppercase tracking-[0.16em] text-faint";

  const currentPlan = data?.credits.plan ?? "free";
  const usage = data?.credits.usage;
  const creditsLeft = usage?.credits ?? (data?.credits.balance ?? 0) * CREDIT_COST.people;
  const creditsLabel = data?.credits.unlimited ? "Unlimited credits" : `${creditsLeft} ${creditsLeft === 1 ? "credit" : "credits"} left`;
  const usesLeft = usage ? [
    ...(usage.free ? [`${usage.letters.left} ${usage.letters.left === 1 ? "cover letter" : "cover letters"}`, `${usage.answers.left} ${usage.answers.left === 1 ? "chat answer" : "chat answers"}`, `${usage.autofills.left} ${usage.autofills.left === 1 ? "autofill" : "autofills"}`] : []),
    ...(usage.unlimited ? [] : [`${usage.people.left} ${usage.people.left === 1 ? "people search" : "people searches"}`]),
  ] : [];
  const hadResume = Boolean(data?.resume);
  const initials = (data?.user.name || data?.user.email || "").split(/\s+/).map((part) => part[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
  const openJob = (appId: string) => {
    window.history.replaceState(null, "", `/applications?job=${encodeURIComponent(appId)}`);
    setView("applications");
    window.scrollTo({ top: 0 });
  };

  return (
    <div className="min-h-screen bg-bg text-ink [color-scheme:dark]">
      <header className="z-20 border-b sm:sticky sm:top-0 border-[#17171B] bg-bg/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1920px] flex-wrap items-center justify-between gap-x-4 gap-y-3 px-3 py-[14px] sm:px-5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-9 gap-y-2">
            <Logo />
            {data && !showOnboarding && (
              <nav aria-label="App" className="flex gap-1">
                {VIEWS.map((item) => (
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
            onDone={() => { setEditing(false); setResumeVersion((value) => value + 1); void load(); }}
          />
        )}
        {data && !showOnboarding && (view === "home" || view === "applications") && <ApplyArea page={view} onPage={setView} refreshKey={resumeVersion} userName={data.user.name} onUsage={onUsage} onSetup={() => { setView("setup"); window.scrollTo({ top: 0 }); }} onJobs={() => { setView("jobs"); window.scrollTo({ top: 0 }); }} onSpiders={() => { setView("settings"); window.scrollTo({ top: 0 }); }} />}
        {data && !showOnboarding && view === "jobs" && <JobsPage onCoverLetter={openCoverLetter} />}
        {data && !showOnboarding && view === "setup" && (
          <SetupPage
            resume={data.resume}
            completeness={data.completeness}
            resumeBusy={resumeBusy}
            onReplaceResume={(file) => void replaceResume(file)}
            onEditProfile={() => { setEditing(true); window.scrollTo({ top: 0 }); }}
            onOpenJob={openJob}
            refreshKey={resumeVersion}
          />
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
            <section className="space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold tracking-tight">Plans</h2>
                  <p className="mt-1 text-sm text-muted">
                    You&apos;re on {LEGACY_PLANS[currentPlan] ?? PUBLIC_PLANS.find((plan) => plan.id === currentPlan)?.name ?? "Free"} with {creditsLabel.toLowerCase()}{usesLeft.length ? `: ${usesLeft.join(", ")}` : ""}.
                  </p>
                </div>
                <p className="text-xs text-faint">{CREDIT_COST.people} credits = up to 5 people at one company</p>
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
                      {plan.semesterLabel && <p className="mt-1 text-xs text-faint">{plan.semesterLabel}</p>}
                      <p className="mt-1 text-sm text-muted">{plan.blurb}</p>
                      <p className="mt-4 text-sm font-medium">{plan.applicationsLabel}</p>
                      <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0 text-sm text-muted">{plan.features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
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
      {letter && (
        <CoverLetterModal
          key={letter.job?.id ?? "new"}
          jobs={letter.jobs}
          initialJob={letter.job}
          highlights={data?.highlights ?? []}
          highlightsLoading={highlightsLoading}
          onClose={() => setLetter(null)}
          onGenerate={writeCoverLetter}
          usesNote={usage?.letters.note ?? ""}
        />
      )}
    </div>
  );
}
