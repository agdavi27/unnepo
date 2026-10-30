import { APPLICATIONS_PER_CREDIT } from "@/lib/config";

/**
 * Numbers on the home page. Each is either measured by us, a plain fact about the product, or a published
 * figure with its source named underneath. None is made up.
 */

const STATS: Array<{ value: string; label: string; source: string; href?: string }> = [
  { value: "3.4 sec", label: "to fill a 14-question application", source: "Timed in our own test on a live Greenhouse form" },
  { value: "Up to 5", label: "people at the company for every job you apply to, each with an email drafted", source: "What Unnepo finds for each application" },
  { value: `${APPLICATIONS_PER_CREDIT}`, label: "applications for every credit", source: "Unnepo pricing" },
  { value: "4.5×", label: "more likely to be hired when someone at the company refers you", source: "Paradigm, from 2M+ candidates (via The Times, 2024)", href: "https://www.pressreader.com/usa/the-times-shreveport/20240505/281522231168846" },
];

export function Stats() {
  return (
    <section aria-labelledby="stats-title" className="mx-auto w-full max-w-5xl px-6 py-20">
      <p className="m-0 font-mono text-xs uppercase tracking-[1.2px] text-[#8B8B94]">Why it works</p>
      <h2 id="stats-title" className="m-0 mt-3 max-w-3xl text-[clamp(30px,4.5vw,44px)] font-bold leading-[1.05] tracking-[-1.4px]">
        Finish applications in seconds. Then talk to the people who decide.
      </h2>
      <p className="m-0 mt-4 max-w-2xl text-[15px] leading-relaxed text-[#9A9AA3]">
        Most applications sit in a pile. Reaching the recruiter or someone on the team is how a referral starts, and referrals are how a lot of people actually get hired.
      </p>
      <dl className="m-0 mt-10 grid gap-px overflow-hidden rounded-2xl border border-[#17171B] bg-[#17171B] sm:grid-cols-2 lg:grid-cols-4">
        {STATS.map((stat) => (
          <div key={stat.value} className="flex flex-col gap-2 bg-[#070708] p-6">
            <dt className="sr-only">{stat.label}</dt>
            <dd className="m-0 font-[family-name:var(--font-pixel)] text-[26px] leading-tight text-[#F7F7F8]">{stat.value}</dd>
            <dd className="m-0 text-sm leading-snug text-[#B4B4BC]">{stat.label}</dd>
            <dd className="m-0 mt-auto pt-2 text-[11px] leading-snug text-[#6B6B74]">
              {stat.href ? <a href={stat.href} target="_blank" rel="noreferrer" className="underline decoration-[#26262C] underline-offset-2 hover:text-[#B4B4BC]">{stat.source}</a> : stat.source}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
