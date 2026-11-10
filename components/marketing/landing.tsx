import Link from "next/link";
import type { CSSProperties } from "react";
import { Logo } from "@/components/brand/logo";
import { FounderLink } from "@/components/marketing/founder-note";
import { GetExtension } from "@/components/marketing/get-extension";
import { Schools } from "@/components/marketing/schools";
import { SpiderDialogue } from "@/components/marketing/spider-dialogue";
import { CONTACT_EMAIL, ENTERPRISE_PLAN, PUBLIC_PLANS } from "@/lib/config";

/** The Chrome Web Store listing, once the extension is published. Until then the button starts sign-up. */
const EXTENSION_URL = process.env.NEXT_PUBLIC_CHROME_EXTENSION_URL || "";

/**
 * --pad is the page's left edge, --gutter keeps the right side clear for the spider's web line, and --inset is how
 * far that line sits from the screen's edge. SpiderDialogue works out the same sizes to place the line.
 */
const PAGE_SIZES = {
  "--pad": "clamp(16px, 5vw, 72px)",
  "--gutter": "clamp(52px, 13vw, 176px)",
  "--inset": "clamp(24px, 6vw, 84px)",
} as CSSProperties;

/** A knot on the web line, level with a section's heading. */
function Knot({ className = "bg-[#3D8BFF]", top }: { className?: string; top: number }) {
  return <span aria-hidden className={`absolute right-[calc(var(--inset)-var(--gutter)-6px)] h-3.5 w-3.5 ${className}`} style={{ top }} />;
}

const PIXEL = "font-[family-name:var(--font-pixel)]";
const CARD = "flex flex-col gap-[18px] border-4 border-[#F7F7F8] bg-[#0C0C0E] p-[26px] shadow-[8px_8px_0_#17171B]";
const ROW = "flex items-center justify-between gap-3 border-2 border-[#26262C] bg-bg px-3 py-[11px] text-sm";

const TRACKER = [
  { stage: "SAVED", color: "text-[#9A9AA3]", company: "Ramp", title: "Finance Intern" },
  { stage: "APPLIED", color: "text-[#F7F7F8]", company: "Patagonia", title: "Marketing Intern" },
  { stage: "INTERVIEW", color: "text-[#3D8BFF]", company: "Stripe", title: "Data Analyst Intern" },
  { stage: "OFFER", color: "text-[#4ADE80]", company: "Duolingo", title: "Product Intern" },
];

const STEPS = [
  ["Add the extension", "Sign up free with your school email and add your resume."],
  ["Apply anywhere", "Use your letter and answers on a job board, or press Fill on the company's site."],
  ["Track and follow up", "The job goes in your tracker, with people to email and a draft for each."],
];

export function Landing() {
  const cta = EXTENSION_URL || "/signup";
  return (
    <div style={PAGE_SIZES} className="relative overflow-hidden bg-bg pl-[var(--pad)] pr-[var(--gutter)] text-ink">
      <div data-landing-column className="mx-auto flex w-full max-w-[1192px] flex-col">
        <header className="mr-[calc(var(--pad)-var(--gutter))] flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-6">
          <Logo href="/" className="text-xl font-bold tracking-[-0.6px]" />
          <nav aria-label="Main" className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <a href="#how" className="py-3 text-[#9A9AA3] hover:text-white">How it works</a>
            <a href="#pricing" className="py-3 text-[#9A9AA3] hover:text-white">Plans</a>
            <FounderLink />
            <Link href="/login" className="py-3 text-[#9A9AA3] hover:text-white">Log in</Link>
          </nav>
        </header>

        <main className="contents">
          <section className="mr-[calc(var(--pad)-var(--gutter))] flex flex-wrap items-center gap-x-12 gap-y-10 pb-24 pt-6">
            <div className="flex min-w-0 flex-[1_1_460px] flex-col items-start gap-5">
              <h1 className="m-0 text-[clamp(42px,5.8vw,80px)] font-bold leading-[0.96] tracking-[-0.045em]">Apply faster.<br />Follow up smarter.<br />Get hired.</h1>
              <p className="m-0 max-w-[500px] text-[clamp(16px,2vw,19px)] leading-normal text-[#B4B4BC]">Apply on any job board or company site. Every application lands in one place, with the people to follow up with.</p>
              <GetExtension
                href={cta}
                external={Boolean(EXTENSION_URL)}
                label="Start 7 days of Pro free"
                className="mt-1 inline-flex min-h-[54px] items-center justify-center rounded-[10px] bg-[#3D8BFF] px-[26px] py-3.5 text-base font-semibold text-bg transition-colors hover:bg-[#5A9DFF]"
              />
              <p className="m-0 text-[13px] text-[#9A9AA3]">7 days of Pro free, no card. The tracker is free and unlimited. Some schools cover Pro.</p>
            </div>
            <div className="flex min-w-0 flex-[1_1_480px] flex-col items-center gap-[22px]">
              <SpiderDialogue />
            </div>
          </section>

          <Schools />

          <section className="relative flex flex-col gap-6 pb-20 pt-2">
            <Knot top={24} />
            <div className="flex flex-col gap-3">
              <h2 className="m-0 text-balance text-[clamp(30px,4.2vw,52px)] font-bold leading-[1.03] tracking-[-1.6px]">Apply wherever you find the job.</h2>
              <p className="m-0 max-w-[620px] text-base leading-relaxed text-[#B4B4BC]">On a job board or the company&apos;s own site, the extension comes with you.</p>
            </div>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(360px,100%),1fr))] gap-6">
              <article className={CARD}>
                <p className={`m-0 ${PIXEL} text-[10px] leading-relaxed text-[#3D8BFF]`}>ON A JOB BOARD</p>
                <h3 className="m-0 text-[clamp(22px,2.4vw,28px)] font-bold leading-[1.1] tracking-[-0.7px]">Handshake, LinkedIn, Indeed. Apply like you normally do.</h3>
                <div className="flex flex-col gap-2">
                  <div className={ROW}><span>Cover letter for this job</span><span className="flex-none text-[13px] font-semibold text-[#3D8BFF]">Open</span></div>
                  <div className={ROW}><span>&quot;Why this company?&quot; answered</span><span className="flex-none text-[13px] font-semibold text-[#3D8BFF]">Copy</span></div>
                  <div className={ROW}><span>Job added to your tracker</span><span className="flex-none text-xs text-[#4ADE80]">Saved</span></div>
                </div>
                <p className="m-0 text-sm leading-normal text-[#9A9AA3]">Your letter, answers and password sit beside the page. On LinkedIn, add the job from the panel in one click.</p>
              </article>
              <article className={CARD}>
                <p className={`m-0 ${PIXEL} text-[10px] leading-relaxed text-[#3D8BFF]`}>ON THE COMPANY&apos;S SITE</p>
                <h3 className="m-0 text-[clamp(22px,2.4vw,28px)] font-bold leading-[1.1] tracking-[-0.7px]">Press Fill and let the spider do the form.</h3>
                <ol className="m-0 flex list-none flex-col gap-[11px] border-2 border-[#26262C] bg-bg p-3.5 font-mono text-[13px] text-[#B4B4BC]">
                  <li className="flex justify-between gap-4"><span>Filled your details</span><span className="text-[#4ADE80]">Done</span></li>
                  <li className="flex justify-between gap-4"><span>Attached resume and letter</span><span className="text-[#4ADE80]">Done</span></li>
                  <li className="flex justify-between gap-4"><span>Pressed Next, page 3 of 4</span><span className="text-[#4ADE80]">Done</span></li>
                  <li className="flex justify-between gap-4 text-[#F7F7F8]"><span>1 question for you</span><span className="text-[#3D8BFF]">Your turn</span></li>
                </ol>
                <p className="m-0 text-sm leading-normal text-[#9A9AA3]">About 1 minute instead of 25, on Workday, Greenhouse, Lever, Ashby and more.</p>
              </article>
            </div>
          </section>

          <section className="relative flex flex-col gap-[18px] pb-[72px]">
            <Knot top={14} />
            <h2 className="m-0 text-[clamp(28px,3.6vw,44px)] font-bold leading-[1.04] tracking-[-1.3px]">Every application, in one place.</h2>
            <p className="m-0 max-w-[620px] text-base leading-relaxed text-[#B4B4BC]">Wherever you applied, the job lands here. See where each one stands.</p>
            <div className="overflow-x-auto border-4 border-[#26262C] bg-[#0C0C0E]">
              <div className="grid min-w-[720px] grid-cols-4">
                {TRACKER.map((item) => (
                  <div key={item.stage} className="flex flex-col gap-2.5 border-r-2 border-[#1F1F24] p-4 last:border-r-0">
                    <span className={`${PIXEL} text-[9px] leading-relaxed ${item.color}`}>{item.stage}</span>
                    <div className="flex flex-col gap-[3px] border-2 border-[#26262C] bg-bg p-3">
                      <span className="text-sm font-semibold">{item.company}</span>
                      <span className="text-xs text-[#9A9AA3]">{item.title}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="relative flex flex-wrap gap-x-12 gap-y-6 pb-16">
            <Knot top={12} />
            <div className="flex min-w-0 flex-[1_1_340px] flex-col gap-3">
              <h2 className="m-0 text-[clamp(26px,3vw,36px)] font-bold leading-[1.06] tracking-[-1px]">Find who to follow up with.</h2>
              <p className="m-0 text-base leading-relaxed text-[#B4B4BC]">Hiring managers, recruiters and people who match you at the company, with emails and a draft to send.</p>
            </div>
            <ul className="m-0 flex min-w-0 flex-[1_1_340px] list-none flex-col border-2 border-[#26262C] bg-[#0C0C0E] p-0">
              <li className="border-b-2 border-[#1F1F24] px-3.5 py-3 text-sm"><strong className="font-semibold">Priya Nair</strong> <span className="text-[#9A9AA3]">· Hiring manager</span></li>
              <li className="border-b-2 border-[#1F1F24] px-3.5 py-3 text-sm"><strong className="font-semibold">Maya Chen</strong> <span className="text-[#9A9AA3]">· Recruiter</span></li>
              <li className="px-3.5 py-3 text-sm"><strong className="font-semibold">Sam Patel</strong> <span className="text-[#9A9AA3]">· From your school</span></li>
            </ul>
          </section>

          <section id="how" className="relative flex scroll-mt-8 flex-col gap-6 pb-[72px] pt-4">
            <Knot top={24} className="bg-[#F7F7F8]" />
            <h2 className="m-0 text-[clamp(28px,3.4vw,40px)] font-bold leading-[1.05] tracking-[-1.2px]">How it works</h2>
            <ol className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(240px,100%),1fr))] gap-7 p-0">
              {STEPS.map(([title, body], index) => (
                <li key={title} className="flex flex-col gap-2">
                  <span className={`${PIXEL} text-xs text-[#3D8BFF]`}>{index + 1}</span>
                  <span className="text-[17px] font-semibold">{title}</span>
                  <span className="text-[15px] leading-normal text-[#9A9AA3]">{body}</span>
                </li>
              ))}
            </ol>
          </section>

          <section id="pricing" className="relative flex scroll-mt-8 flex-col gap-7 pb-20 pt-4">
            <Knot top={24} className="bg-[#F7F7F8]" />
            <h2 className="m-0 text-[clamp(28px,3.4vw,40px)] font-bold leading-[1.05] tracking-[-1.2px]">Plans</h2>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(280px,100%),1fr))] gap-6">
              {PUBLIC_PLANS.map((plan) => {
                const free = plan.id === "free";
                const features = free ? ["Unlimited job tracking", ...plan.features.filter((feature) => !feature.startsWith("Tracker"))] : plan.features;
                return (
                  <div key={plan.id} className={`flex flex-col gap-3.5 border-4 bg-[#0C0C0E] p-6 ${free ? "border-[#F7F7F8] shadow-[8px_8px_0_#3D8BFF]" : "border-[#26262C]"}`}>
                    <p className={`m-0 ${PIXEL} text-xs leading-relaxed`}>{free ? "Free for students" : plan.name}</p>
                    <p className="m-0 text-[44px] font-bold leading-none tracking-[-1.5px]">
                      {plan.priceLabel}
                      {plan.monthly && <span className="text-sm font-normal tracking-normal text-[#9A9AA3]"> / month {plan.semesterLabel}</span>}
                    </p>
                    <ul className="m-0 flex flex-1 list-disc flex-col gap-2 pl-[18px] text-sm leading-[1.4] text-[#B4B4BC]">
                      {features.map((feature) => <li key={feature}>{feature}</li>)}
                    </ul>
                    <Link
                      href={free ? "/signup" : `/signup?plan=${plan.id}`}
                      className={`flex min-h-[46px] items-center justify-center rounded-[10px] text-sm font-semibold transition-colors ${free ? "bg-[#3D8BFF] text-bg hover:bg-[#5A9DFF]" : "border border-[#3A3A42] text-[#F7F7F8] hover:bg-white/5"}`}
                    >
                      {free ? "Start free" : plan.cta}
                    </Link>
                  </div>
                );
              })}
            </div>
            <p className="m-0 text-sm text-[#9A9AA3]">
              Buying for your school?{" "}
              <a href={`mailto:${ENTERPRISE_PLAN.contactEmail}?subject=${encodeURIComponent("Unnepo for our school")}`} className="text-[#F7F7F8] underline-offset-4 hover:underline">Contact us</a>
            </p>
          </section>
        </main>

        <footer className="border-t border-[#17171B] py-7 text-[13px] text-[#9A9AA3]">
          Unnepo · Built for students · <Link href="/privacy" className="underline-offset-4 hover:text-white hover:underline">Privacy Policy</Link> · <Link href="/terms" className="underline-offset-4 hover:text-white hover:underline">Terms of Service</Link> · Contact <a href={`mailto:${CONTACT_EMAIL}`} className="underline-offset-4 hover:text-white hover:underline">{CONTACT_EMAIL}</a>
        </footer>
      </div>
    </div>
  );
}
