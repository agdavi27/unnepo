import Link from "next/link";
import { APPLICATIONS_PER_CREDIT, ENTERPRISE_PLAN, PUBLIC_PLANS, applicationsFromCredits } from "@/lib/config";

/** The home page's plans, as cards: what each costs, what it covers, and one clear button. */

const check = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="mt-0.5 flex-none text-[#3D8BFF]"><path d="M20 6 9 17l-5-5" /></svg>
);

export function Pricing() {
  return (
    <section id="pricing" aria-labelledby="pricing-title" className="mx-auto w-full max-w-6xl scroll-mt-8 px-6 py-20">
      <div className="flex flex-col items-center text-center">
        <p className="m-0 font-mono text-xs uppercase tracking-[1.2px] text-[#8B8B94]">Pricing</p>
        <h2 id="pricing-title" className="m-0 mt-3 max-w-2xl text-[clamp(32px,4.6vw,46px)] font-bold leading-[1.05] tracking-[-1.4px]">Free to start. Upgrade when you&apos;re applying a lot.</h2>
        <p className="m-0 mt-4 max-w-xl text-[15px] leading-relaxed text-[#9A9AA3]">
          1 credit covers {APPLICATIONS_PER_CREDIT} applications, each with up to five people to reach and an email drafted for each. Some schools cover Pro for their students.
        </p>
      </div>

      <ul className="m-0 mt-12 grid list-none gap-4 p-0 sm:grid-cols-2 lg:grid-cols-4">
        {PUBLIC_PLANS.map((plan) => {
          const featured = plan.popular;
          return (
            <li key={plan.id} className={`relative flex flex-col rounded-2xl border p-6 ${featured ? "border-[#3D8BFF] bg-[#0C1424] shadow-[0_0_0_1px_#3D8BFF,0_20px_60px_-20px_rgba(61,139,255,.45)]" : "border-[#1F1F24] bg-[#0C0C0E]"}`}>
              {featured && <span className="absolute -top-3 left-6 rounded-full bg-[#3D8BFF] px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-[1.2px] text-white">Most popular</span>}
              <p className="m-0 text-lg font-semibold">{plan.name}</p>
              <p className="m-0 mt-1 text-sm text-[#8B8B94]">{plan.blurb}</p>
              <p className="m-0 mt-6 flex items-baseline gap-1.5">
                <span className="text-[44px] font-bold leading-none tracking-[-1.5px]">{plan.priceLabel}</span>
                <span className="text-sm text-[#8B8B94]">{plan.monthly ? "/ month" : "to start"}</span>
              </p>
              <p className="m-0 mt-3 text-sm font-medium text-[#F7F7F8]">
                {applicationsFromCredits(plan.credits).toLocaleString("en-US")} applications{plan.monthly ? " every month" : " to start"}
              </p>
              <p className="m-0 text-xs text-[#6B6B74]">{plan.credits} credits</p>
              <ul className="m-0 mt-6 flex flex-1 list-none flex-col gap-2.5 p-0 text-sm text-[#B4B4BC]">
                {plan.features.map((feature) => <li key={feature} className="flex gap-2.5">{check}<span>{feature}</span></li>)}
              </ul>
              <Link
                href={plan.id === "free" ? "/signup" : `/signup?plan=${plan.id}`}
                className={`mt-8 inline-flex min-h-11 items-center justify-center rounded-[10px] px-4 text-sm font-semibold transition-colors ${featured ? "bg-[#3D8BFF] text-white hover:bg-[#5A9DFF]" : "border border-[#26262C] text-[#F7F7F8] hover:bg-white/5"}`}
              >
                {plan.cta}
              </Link>
            </li>
          );
        })}
        <li className="flex flex-col rounded-2xl border border-dashed border-[#26262C] bg-transparent p-6">
          <p className="m-0 text-lg font-semibold">For schools</p>
          <p className="m-0 mt-1 text-sm text-[#8B8B94]">{ENTERPRISE_PLAN.blurb}</p>
          <p className="m-0 mt-6 text-[44px] font-bold leading-none tracking-[-1.5px]">{ENTERPRISE_PLAN.priceLabel}</p>
          <p className="m-0 mt-3 text-sm font-medium text-[#F7F7F8]">Pro for every student</p>
          <p className="m-0 text-xs text-[#6B6B74]">Priced with your career center</p>
          <ul className="m-0 mt-6 flex flex-1 list-none flex-col gap-2.5 p-0 text-sm text-[#B4B4BC]">
            {ENTERPRISE_PLAN.features.map((feature) => <li key={feature} className="flex gap-2.5">{check}<span>{feature}</span></li>)}
          </ul>
          <a
            href={`mailto:${ENTERPRISE_PLAN.contactEmail}?subject=${encodeURIComponent("Unnepo for our school")}`}
            className="mt-8 inline-flex min-h-11 items-center justify-center rounded-[10px] border border-[#26262C] px-4 text-sm font-semibold text-[#F7F7F8] hover:bg-white/5"
          >
            Contact us
          </a>
        </li>
      </ul>
    </section>
  );
}
