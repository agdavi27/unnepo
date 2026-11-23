import type { Metadata } from "next";
import { GiftForm } from "@/components/marketing/gift-form";
import { GiftShell } from "@/components/marketing/gift-shell";
import { OUTREACH_SEASON_DAYS, PUBLIC_PLANS, REFUND_DAYS } from "@/lib/config";

export const metadata: Metadata = {
  title: "Give Outreach Season · Unnepo",
  description: "Give a student a recruiting season of Unnepo: the right people at each company, and a short email to each one. Paid once, never renews.",
};

/** For parents (or anyone) buying Outreach Season for a student. No account needed. */
export default function GiftPage() {
  const plan = PUBLIC_PLANS.find((item) => item.id === "outreach")!;
  const months = Math.round(OUTREACH_SEASON_DAYS / 30);
  return (
    <GiftShell>
      <h1 className="m-0 text-balance text-[clamp(34px,5.4vw,60px)] font-bold leading-[1] tracking-[-0.04em]">Give a season of getting replies.</h1>
      <p className="m-0 max-w-[600px] text-[clamp(16px,2vw,18px)] leading-normal text-[#B4B4BC]">
        Most internship applications go unanswered. Outreach Season finds the 2 or 3 people at each company who decide, alumni from their school first, and writes your student a short, personal email to each one, with follow-ups timed for them. They still write and send everything as themselves.
      </p>
      <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[15px] leading-snug text-[#B4B4BC]">
        {plan.features.filter((feature) => !/gift/i.test(feature)).map((feature) => (
          <li key={feature} className="flex gap-2.5"><span aria-hidden className="text-[#4ADE80]">✓</span>{feature}</li>
        ))}
      </ul>
      <p className="m-0 text-[15px] text-[#F7F7F8]">
        <strong className="text-2xl">{plan.priceLabel}</strong> once for {months} months, starting when they use the code. Career coaching often costs $2,000 or more.
      </p>
      <GiftForm price={plan.priceLabel} />
      <p className="m-0 text-[13px] text-[#9A9AA3]">Full refund within {REFUND_DAYS} days if it isn&apos;t right, no questions. It never renews.</p>
    </GiftShell>
  );
}
