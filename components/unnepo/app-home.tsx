"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Highlight, Profile } from "@/components/unnepo/UnnepoForms";
import { ResumeFirst } from "@/components/onboarding/resume-first";
import { CoverLetterModal, JobsPage, type Job } from "@/components/unnepo/jobs";
import { APPLICATIONS_PER_CREDIT, ENTERPRISE_PLAN, PUBLIC_PLANS, creditMath } from "@/lib/config";
import { Logo } from "@/components/brand/logo";
import { ApplicationSettings, ApplyArea } from "@/components/unnepo/apply";

type StudentFact = { id: string; text: string; verified: boolean };
type Workspace = {
  user: { name: string; email: string };
  credits: { balance: number; plan: string; includedAllowance: number };
  profile: { ready: boolean; form: Profile; organizedProfile: unknown | null } | null;
  /** The resume-first profile is confirmed (or the student finished the old onboarding). */
  ready: boolean;
  completeness: number;
  studentFacts: StudentFact[];
  highlights: Highlight[];
  resume: { id: string; fileName: string; byteSize: number } | null;
  integrations: { apollo: boolean; anthropic: boolean };
};

// Applications are added by the Chrome extension. Recommended Jobs stays in the code but is hidden from the menu.
type View = "applied" | "stats" | "jobs" | "settings";
const VIEWS: { id: View; label: string }[] = [
  { id: "applied", label: "Applied" },
  { id: "stats", label: "Stats" },
];
const LEGACY_PLANS: Record<string, string> = { grind: "Grind (legacy)", pack: "Credit pack (legacy)" };

export function AppHome() {
  const router = useRouter();
  const [data, setData] = useState<Workspace | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [resumeBusy, setResumeBusy] = useState(false);
  const [resumeVersion, setResumeVersion] = useState(0);
  const [view, setView] = useState<View>("applied");
  const [editing, setEditing] = useState(false);
  // The extension's "Edit my info" opens /home?edit=profile.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("edit") !== "profile") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- opening from a link, once
    setEditing(true);
    window.history.replaceState(null, "", "/home");
  }, []);
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
    return String(payload.body ?? "");
  }

  const showOnboarding = !data?.ready || editing;

  const sectionTitle = "text-xs font-semibold uppercase tracking-[0.16em] text-faint";

  const currentPlan = data?.credits.plan ?? "free";
  const hadResume = Boolean(data?.resume);
  /** Attach or replace the resume from anywhere in the app. Shown in the top row on wider screens, beside the tabs on phones. */
  const resumeButton = (placement: string) => data && !showOnboarding && (
    <label title={data.resume ? `Your resume: ${data.resume.fileName}. Choose a file to replace it.` : "Attach your resume"} className={`${placement} max-w-[14rem] shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 sm:px-3 ${data.resume ? "border-line text-muted hover:text-white" : "border-white/60 text-white hover:bg-white/10"} ${resumeBusy ? "pointer-events-none opacity-60" : ""}`}>
      <span aria-hidden>⇧</span>
      {resumeBusy ? "Uploading…" : data.resume ? (
        <><span className="hidden truncate text-ink md:inline">{data.resume.fileName}</span><span className="md:hidden">Resume</span><span className="hidden text-faint sm:inline">· Replace</span></>
      ) : "Attach resume"}
      <input
        type="file"
        className="sr-only"
        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        disabled={resumeBusy}
        onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void replaceResume(file); }}
      />
    </label>
  );

  return (
    <div className="min-h-screen bg-bg text-ink [color-scheme:dark]">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 pt-4 sm:px-6 lg:px-8">
          <Logo />
          <div className="flex items-center gap-3 whitespace-nowrap text-sm sm:gap-4">
            {resumeButton("hidden sm:flex")}
            {data && <span className="rounded-full border border-line px-2.5 py-1 text-muted sm:px-3"><span className="text-ink">{data.credits.balance}</span> credits</span>}
            {data && !showOnboarding && <button type="button" onClick={() => setView("settings")} aria-current={view === "settings" ? "page" : undefined} className={view === "settings" ? "text-white" : "text-muted hover:text-white"}>Settings</button>}
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
            <div className="ml-auto pb-2">{resumeButton("flex sm:hidden")}</div>
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
          <ResumeFirst
            key={editing ? "edit" : "onboarding"}
            mode={data.ready ? "edit" : "onboarding"}
            onDone={() => { setEditing(false); setResumeVersion((value) => value + 1); void load(); }}
          />
        )}
        {data && !showOnboarding && (view === "applied" || view === "stats") && data.completeness < 100 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-panel px-4 py-3 text-sm">
            <p className="text-muted">Your profile is <span className="font-medium text-ink">{data.completeness}%</span> ready. A fuller profile means fewer fields to fill by hand.</p>
            <button type="button" onClick={() => { setEditing(true); window.scrollTo({ top: 0 }); }} className="rounded-lg border border-line px-3 py-1 text-ink hover:bg-white/5">Finish profile</button>
          </div>
        )}
        {data && !showOnboarding && (view === "applied" || view === "stats") && <ApplyArea view={view} refreshKey={resumeVersion} />}
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
                <h2 className={sectionTitle}>Profile</h2>
                <p className="mt-3 text-sm text-muted">Your profile is {data.completeness}% ready. It&apos;s what every application is filled from: contact details, schools, jobs, projects, skills, and your answers to common questions.</p>
                <button type="button" onClick={() => { setEditing(true); window.scrollTo({ top: 0 }); }} className="mt-4 rounded-xl bg-white px-3 py-1.5 text-sm font-semibold text-black hover:bg-zinc-200">Edit profile</button>
              </div>
              <div className="rounded-2xl border border-line bg-panel p-5">
                <h2 className={sectionTitle}>Chrome extension</h2>
                <p className="mt-3 text-sm text-muted">The extension fills applications from your profile in your own browser and logs each one you submit. Your job-site passwords stay in the extension.</p>
                <a href="/extension/connect" className="mt-4 inline-flex rounded-xl border border-line px-3 py-1.5 text-sm hover:bg-white/5">Connect the extension</a>
              </div>
              <ApplicationSettings />
            </section>
            <section className="space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold tracking-tight">Plans</h2>
                  <p className="mt-1 text-sm text-muted">
                    You&apos;re on {LEGACY_PLANS[currentPlan] ?? PUBLIC_PLANS.find((plan) => plan.id === currentPlan)?.name ?? "Free"} with {data.credits.balance} {data.credits.balance === 1 ? "credit" : "credits"} left.
                  </p>
                </div>
                <p className="text-xs text-faint">1 credit = {APPLICATIONS_PER_CREDIT} applications, each with up to 5 contacts</p>
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
    </div>
  );
}
