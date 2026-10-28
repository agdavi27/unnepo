"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Check, Mail, MessageSquare, Send, Target } from "lucide-react";
import { APPLICATIONS_PER_CREDIT, ENTERPRISE_PLAN, PUBLIC_PLANS, applicationsFromCredits, creditMath } from "@/lib/config";
import { isSchoolEmail } from "@/lib/schools";
import { SchoolLogos } from "@/components/marketing/school-logos";
import { Logo } from "@/components/brand/logo";

const HEADSHOTS = [
  { src: "/students/student-1.jpg", alt: "Student in a suit" },
  { src: "/students/student-2.jpg", alt: "Student in a red shirt" },
  { src: "/students/student-3.jpg", alt: "Student in a beige shirt" },
  { src: "/students/student-4.jpg", alt: "Student at a desk" },
];

export function Landing() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const emailRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const input = emailRef.current;
    if (!input) return;
    const handler = () => setEmail(input.value);
    input.addEventListener("input", handler);
    return () => input.removeEventListener("input", handler);
  }, []);

  function start(event: React.FormEvent) {
    event.preventDefault();
    const params = new URLSearchParams();
    if (email) params.set("email", email);
    router.push(`/signup?${params.toString()}`);
  }

  return (
    <div className="min-h-screen bg-bg text-ink">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Logo href="/" />
        <nav className="hidden items-center gap-8 text-sm text-muted md:flex">
          <a href="#how" className="hover:text-white">How it works</a>
          <a href="#pricing" className="hover:text-white">Pricing</a>
          <Link href="/for-students" className="hover:text-white">For Students</Link>
        </nav>
        <Link href="/signup" className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-black">Get started</Link>
      </header>

      <section className="mx-auto max-w-4xl px-5 pb-16 pt-10 text-center">
        <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1 text-[11px] font-semibold tracking-[0.16em] text-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-white" />
          BUILT BY STUDENTS FOR STUDENTS
        </div>
        <h1 className="text-5xl font-bold uppercase leading-[0.95] tracking-tight md:text-7xl">
          Less applying.
          <br />
          <span className="text-[#3D8BFF]">More getting hired.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-base text-muted md:text-lg">
          Paste a job link and Unnepo fills out the application from your profile. After you apply, it finds the people behind the role and writes the email for you.
        </p>
        <form onSubmit={start} className="mx-auto mt-8 flex max-w-xl flex-col gap-3 sm:flex-row">
          <label className="flex flex-1 items-center gap-2 rounded-xl border border-line bg-card px-3">
            <Mail className="h-4 w-4 text-faint" />
            <input ref={emailRef} value={email} onChange={(event) => setEmail(event.target.value)} type="email" required placeholder="Enter your school email" className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-faint" suppressHydrationWarning />
            {isSchoolEmail(email) ? <Check className="h-5 w-5 shrink-0 text-emerald-400" aria-hidden={false} aria-label="School email looks right" /> : null}
          </label>
          <button className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-white px-5 text-sm font-semibold text-black">
            Get started <ArrowRight className="h-4 w-4" />
          </button>
        </form>
        {params.get("error") ? <p className="mt-3 text-sm text-red-300">{params.get("error")}</p> : null}
        <p className="mt-3 text-sm text-faint">Start with {PUBLIC_PLANS[0].credits} free credits ({applicationsFromCredits(PUBLIC_PLANS[0].credits)} applications). No subscription. Built for students.</p>
        <div className="mt-6 flex items-center justify-center gap-3 text-sm text-muted">
          <div className="flex -space-x-2">
            {HEADSHOTS.map((photo) => (
              <img key={photo.src} src={photo.src} alt={photo.alt} className="h-11 w-11 rounded-full border-2 border-black object-cover object-top" />
            ))}
          </div>
          2500+ students are applying faster with Unnepo.
        </div>
      </section>

      <SchoolLogos />

      <section id="how" className="mx-auto max-w-6xl px-5 py-20">
        <p className="text-center text-xs font-semibold tracking-[0.22em] text-faint">HOW IT WORKS</p>
        <h2 className="mx-auto mt-3 max-w-3xl text-center text-4xl font-semibold tracking-tight md:text-5xl">Paste the job. We handle the busywork.</h2>
        <p className="mx-auto mt-4 max-w-3xl text-center text-muted">
          Stop retyping your resume into every form. Unnepo fills the application, waits for your approval, then lines up the right people to email about the role.
        </p>
        <div className="mt-10 grid gap-4 md:grid-cols-4">
          {[
            ["01", "Paste a job link", "Drop in any posting. We pull out the role, company, team, and requirements."],
            ["02", "Apply in minutes", "Unnepo fills the form from your profile and resume. You fill any gaps and approve before anything is submitted."],
            ["03", "Find the right people", "After you apply, we find up to five people tied to the role: recruiters, the hiring manager, and the team."],
            ["04", "Send and track", "Copy a personalized email for each person and track every application in one list."],
          ].map(([n, title, copy]) => (
            <article key={n} className="rounded-2xl border border-line bg-card p-5">
              <p className="text-sm font-semibold text-faint">{n}</p>
              <h3 className="mt-3 font-semibold">{title}</h3>
              <p className="mt-2 text-sm text-muted">{copy}</p>
            </article>
          ))}
        </div>
        <Calculator />
      </section>

      <section id="pricing" className="mx-auto max-w-6xl px-5 pb-24">
        <p className="text-center text-xs font-semibold tracking-[0.22em] text-faint">PRICING</p>
        <h2 className="mt-3 text-center text-4xl font-semibold tracking-tight md:text-5xl">Apply more. Stress less.</h2>
        <p className="mx-auto mt-4 max-w-2xl text-center text-muted">
          1 credit = {APPLICATIONS_PER_CREDIT} applications. Every application includes up to five contacts and a personalized email for each.
        </p>
        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {PUBLIC_PLANS.map((plan) => (
            <article key={plan.id} className={`rounded-2xl border bg-card p-6 ${plan.popular ? "border-gold" : "border-line"}`}>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted">{plan.blurb}</span>
                {plan.popular ? <span className="rounded-full bg-gold px-2 py-0.5 text-xs font-semibold text-black">Most popular</span> : null}
              </div>
              <h3 className="mt-4 text-2xl font-semibold">{plan.name}</h3>
              <p className="mt-2 text-4xl font-semibold">{plan.priceLabel}{plan.monthly ? <span className="text-lg text-muted"> / month</span> : null}</p>
              <p className="mt-2 text-lg font-semibold text-[#3D8BFF]">{plan.peopleLabel}</p>
              <p className="mt-1 text-sm text-faint">{plan.cadence} · {creditMath(plan.credits)}</p>
              <ul className="mt-6 space-y-2 text-sm text-muted">
                {plan.features.map((feature) => <li key={feature}>✓ {feature}</li>)}
              </ul>
              <Link href={plan.id === "free" ? "/signup" : `/signup?plan=${plan.id}`} className={`mt-6 flex h-11 items-center justify-center rounded-xl text-sm font-semibold ${plan.popular ? "bg-cream text-black" : "bg-white text-black"}`}>
                {plan.cta} →
              </Link>
            </article>
          ))}
          <article className="flex flex-col rounded-2xl border border-line bg-card p-6">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted">{ENTERPRISE_PLAN.blurb}</span>
            </div>
            <h3 className="mt-4 text-2xl font-semibold">{ENTERPRISE_PLAN.name}</h3>
            <p className="mt-2 text-4xl font-semibold">{ENTERPRISE_PLAN.priceLabel}</p>
            <p className="mt-2 text-lg font-semibold text-[#3D8BFF]">Contact us for pricing</p>
            <p className="mt-1 text-sm text-faint">1 credit = {APPLICATIONS_PER_CREDIT} applications</p>
            <ul className="mt-6 space-y-2 text-sm text-muted">
              {ENTERPRISE_PLAN.features.map((feature) => <li key={feature}>✓ {feature}</li>)}
            </ul>
            <a
              href={ENTERPRISE_PLAN.contactEmail ? `mailto:${ENTERPRISE_PLAN.contactEmail}?subject=${encodeURIComponent("Unnepo for our school")}` : "#pricing"}
              className="mt-auto flex h-11 items-center justify-center rounded-xl border border-line text-sm font-semibold text-ink hover:bg-white/5"
            >
              Contact us →
            </a>
          </article>
        </div>
      </section>
      <footer className="border-t border-line px-5 py-8 text-center text-sm text-faint">Unnepo · Built for students · One credit = {APPLICATIONS_PER_CREDIT} applications. · <Link href="/privacy" className="underline-offset-4 hover:text-white hover:underline">Privacy Policy</Link></footer>
    </div>
  );
}

function Calculator() {
  const [target, setTarget] = useState(2);
  const [response, setResponse] = useState(8);
  const [close, setClose] = useState(20);
  const numbers = useMemo(() => {
    const applications = Math.max(1, Math.round(target / ((response / 100) * (close / 100))));
    const interviews = Math.round(applications * (response / 100));
    return { applications, contacts: applications * 5, interviews, offers: target };
  }, [target, response, close]);

  return (
    <div className="mt-8 grid gap-4 rounded-3xl border border-line bg-card p-5 md:grid-cols-[1.1fr_0.9fr]">
      <div>
        <p className="text-xs font-semibold tracking-[0.16em] text-faint">SEE YOUR RESULTS</p>
        <h3 className="mt-2 text-3xl font-semibold tracking-tight">How many applications do you need?</h3>
        <p className="mt-2 text-sm text-muted">Adjust the numbers to your goals to see how many applications it will take, and how many people you can reach along the way.</p>
        <Slider label="Target offers" value={target} min={1} max={10} onChange={setTarget} display={String(target)} />
        <Slider label="Expected interview rate" value={response} min={2} max={40} onChange={setResponse} display={`${response}%`} />
        <Slider label="Expected offer rate after interviews" value={close} min={5} max={60} onChange={setClose} display={`${close}%`} accent />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Metric icon={<Send className="h-4 w-4" />} value={numbers.applications.toLocaleString()} label="Applications to send" />
        <Metric icon={<Mail className="h-4 w-4" />} value={numbers.contacts.toLocaleString()} label="People you can email" />
        <Metric icon={<MessageSquare className="h-4 w-4" />} value={numbers.interviews.toLocaleString()} label="Expected interviews" />
        <Metric icon={<Target className="h-4 w-4" />} value={String(numbers.offers)} label="Expected offers" />
      </div>
    </div>
  );
}

function Slider({ label, value, min, max, onChange, display, accent = false }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void; display: string; accent?: boolean }) {
  return (
    <label className="mt-5 block text-sm">
      <span className="flex items-center justify-between text-muted"><span>{label}</span><span className="text-ink">{display}</span></span>
      <input type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} className={accent ? "mt-2 w-full accent-lime-400" : "mt-2 w-full accent-sky-400"} suppressHydrationWarning />
    </label>
  );
}

function Metric({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <div className="rounded-2xl border border-line bg-panel p-4">
      <div className="text-muted">{icon}</div>
      <p className="mt-3 text-3xl font-semibold">{value}</p>
      <p className="text-sm text-faint">{label}</p>
    </div>
  );
}
