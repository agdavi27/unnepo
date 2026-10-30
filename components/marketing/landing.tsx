import Link from "next/link";
import { APPLICATIONS_PER_CREDIT, ENTERPRISE_PLAN, PUBLIC_PLANS, creditMath } from "@/lib/config";
import { Logo } from "@/components/brand/logo";
import { ActivityToasts } from "@/components/marketing/activity-toasts";
import { FounderLink } from "@/components/marketing/founder-note";
import { GetExtension } from "@/components/marketing/get-extension";
import { ProductDemo } from "@/components/marketing/product-demo";
import { Stats } from "@/components/marketing/stats";
import { Schools } from "@/components/marketing/schools";
import { SpiderDialogue } from "@/components/marketing/spider-dialogue";

/** The Chrome Web Store listing, once the extension is published. Until then the button starts sign-up. */
const EXTENSION_URL = process.env.NEXT_PUBLIC_CHROME_EXTENSION_URL || "";

export function Landing() {
  const cta = EXTENSION_URL || "/signup";
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-bg text-ink">
      <header className="relative z-[2] flex flex-wrap items-center justify-between gap-4 px-6 py-6 sm:px-10">
        <Logo href="/" className="text-xl font-bold tracking-[-0.6px]" />
        <nav aria-label="Main" className="flex gap-7 text-sm">
          <a href="#pricing" className="py-3 text-[#9A9AA3] hover:text-white">Pricing</a>
          <FounderLink />
          <Link href="/login" className="py-3 text-[#9A9AA3] hover:text-white">Log in</Link>
        </nav>
      </header>

      <main className="relative flex flex-1 flex-col items-center gap-9 px-6 pb-16 pt-2">
        <div className="relative z-[1] flex max-w-3xl flex-col items-center gap-5 pt-4 text-center">
          <h1 className="m-0 text-[clamp(42px,7.4vw,84px)] font-bold leading-[0.96] tracking-[-0.045em]">Less applying.<br />More interviewing.</h1>
          <p className="m-0 max-w-xl text-[clamp(16px,2vw,19px)] leading-relaxed text-[#B4B4BC]">Find jobs, complete applications faster, and connect with people who work there. All in one place.</p>
        </div>
        <div className="relative flex w-full flex-col items-center gap-9">
          <ActivityToasts />
          <SpiderDialogue />
        </div>
        <div className="flex flex-col items-center gap-4">
          <GetExtension href={cta} external={Boolean(EXTENSION_URL)} />
          <p className="m-0 max-w-md text-center text-[13px] text-[#8B8B94]">
            Free to start. Some schools cover Pro for their students; see if yours does.
          </p>
        </div>
      </main>

      <ProductDemo />
      <Stats />

      <Schools />

      <section id="pricing" className="relative mx-auto w-full max-w-5xl border-t border-[#17171B] px-6 py-20">
        <p className="font-mono text-xs uppercase tracking-[1.2px] text-[#8B8B94]">Pricing</p>
        <h2 className="mt-3 text-[40px] font-bold leading-tight tracking-[-1.4px]">Free to start. Pay when you&apos;re applying a lot.</h2>
        <p className="mt-3 max-w-2xl text-sm text-[#8B8B94]">1 credit = {APPLICATIONS_PER_CREDIT} applications, each with up to five people to reach and an email drafted for each.</p>
        <ul className="mt-10 divide-y divide-[#17171B] border-y border-[#17171B]">
          {PUBLIC_PLANS.map((plan) => (
            <li key={plan.id} className="grid gap-3 py-6 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-center">
              <div>
                <p className="font-semibold">{plan.name}</p>
                <p className="font-mono text-sm text-[#B4B4BC]">{plan.priceLabel}{plan.monthly ? " / month" : ""}</p>
              </div>
              <p className="text-sm text-[#8B8B94]">{plan.blurb} · {creditMath(plan.credits)}{plan.monthly ? " each month" : ""}</p>
              <Link href={plan.id === "free" ? "/signup" : `/signup?plan=${plan.id}`} className="inline-flex min-h-11 items-center justify-center rounded-[10px] border border-[#26262C] px-4 text-sm font-medium hover:bg-white/5">
                {plan.cta}
              </Link>
            </li>
          ))}
          <li className="grid gap-3 py-6 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-center">
            <div>
              <p className="font-semibold">{ENTERPRISE_PLAN.name}</p>
              <p className="font-mono text-sm text-[#B4B4BC]">{ENTERPRISE_PLAN.priceLabel}</p>
            </div>
            <p className="text-sm text-[#8B8B94]">{ENTERPRISE_PLAN.blurb}</p>
            <a
              href={ENTERPRISE_PLAN.contactEmail ? `mailto:${ENTERPRISE_PLAN.contactEmail}?subject=${encodeURIComponent("Unnepo for our school")}` : "#pricing"}
              className="inline-flex min-h-11 items-center justify-center rounded-[10px] border border-[#26262C] px-4 text-sm font-medium hover:bg-white/5"
            >
              Contact us
            </a>
          </li>
        </ul>
      </section>

      <footer className="border-t border-[#17171B] px-6 py-8 text-center text-[13px] text-[#8B8B94]">
        Unnepo · Built for students · <Link href="/privacy" className="underline-offset-4 hover:text-white hover:underline">Privacy Policy</Link>
      </footer>
    </div>
  );
}
