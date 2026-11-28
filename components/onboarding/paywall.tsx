"use client";

import { useEffect } from "react";
import { PLAN_CENTS, PUBLIC_PLANS, REFUND_DAYS } from "@/lib/config";

export type PaywallChoice = "semester" | "monthly" | "outreach";

/**
 * The reply-rate line under the headline. Swap in a measured number (e.g. "6x") only once Unnepo's own data backs
 * it: a figure shown at checkout has to be true.
 */
export const REPLY_LIFT = { big: "Several times", rest: "more replies when you email a real person, not just apply" };

const dollars = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;

/**
 * The last screen of onboarding for a student on Free: Pro, with Outreach Season as the step up. Prices and features
 * come from PUBLIC_PLANS / PLAN_CENTS, the same ones checkout charges. The X (or Escape) closes it and they carry on
 * with Free.
 */
export function OnboardingPaywall({ busy, admin, onChoose, onClose }: { busy: boolean; admin: boolean; onChoose: (choice: PaywallChoice) => void; onClose: () => void }) {
  const pro = PUBLIC_PLANS.find((plan) => plan.id === "pro")!;
  const outreach = PUBLIC_PLANS.find((plan) => plan.id === "outreach")!;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = overflow; };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/80 backdrop-blur-sm">
      <div className="flex min-h-full items-center justify-center p-4">
        <div role="dialog" aria-modal="true" aria-labelledby="paywall-title" className="relative w-full max-w-2xl rounded-2xl border border-line bg-panel p-6 sm:p-8">
          <button type="button" onClick={onClose} aria-label="Close and continue with Free" title="Continue with Free" className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-faint hover:bg-white/5 hover:text-white">
            <span aria-hidden className="text-base leading-none">✕</span>
          </button>

          <p className="font-mono text-xs uppercase tracking-[0.16em] text-faint">One last thing</p>
          <h2 id="paywall-title" className="mt-2 pr-8 text-2xl font-bold tracking-tight sm:text-3xl">Get replies, not just applications</h2>
          <div className="mt-4 flex items-center gap-3 rounded-xl border border-[#3D8BFF]/40 bg-[#3D8BFF]/[0.08] px-4 py-3">
            <span aria-hidden className="text-2xl font-bold text-[#7FB2FF]">↑</span>
            <p className="m-0 text-sm"><strong className="font-semibold text-white">{REPLY_LIFT.big}</strong> <span className="text-muted">{REPLY_LIFT.rest}. Pro finds the right people at each company and writes the email to each one.</span></p>
          </div>

          <div className="mt-6 rounded-2xl border border-[#3D8BFF] p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="m-0 font-semibold">{pro.name}</p>
              <p className="m-0 text-3xl font-bold tabular-nums">{pro.priceLabel}<span className="text-sm font-normal text-muted"> / {pro.per}</span></p>
            </div>
            <ul className="m-0 mt-4 flex list-none flex-col gap-2 p-0 text-sm">
              {pro.features.map((feature) => (
                <li key={feature} className="grid grid-cols-[18px_1fr] gap-2"><span aria-hidden className="font-bold text-[#3D8BFF]">✓</span><span>{feature}</span></li>
              ))}
            </ul>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <button type="button" disabled={busy} onClick={() => onChoose("semester")} className="flex-1 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-black hover:bg-zinc-200 disabled:opacity-50">{admin ? "Switch to Pro (admin, free)" : `Get Pro, ${pro.priceLabel} a semester`}</button>
              {!admin && <button type="button" disabled={busy} onClick={() => onChoose("monthly")} className="flex-1 rounded-xl border border-line px-4 py-2.5 text-sm hover:bg-white/5 disabled:opacity-50">Or {dollars(PLAN_CENTS.pro)} a month</button>}
            </div>
          </div>

          {!admin && (
            <div className="mt-4 rounded-2xl border border-line p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="m-0 font-semibold">{outreach.name} <span className="ml-1 rounded-full border border-line px-2 py-0.5 align-middle text-[11px] font-normal text-muted">Upgrade</span></p>
                <p className="m-0 text-xl font-bold tabular-nums">{outreach.priceLabel}<span className="text-sm font-normal text-muted"> once</span></p>
              </div>
              <p className="mt-1 text-sm text-muted">{outreach.blurb}. {outreach.altLabel}.</p>
              <ul className="m-0 mt-3 flex list-none flex-col gap-1.5 p-0 text-sm">
                {outreach.features.map((feature) => (
                  <li key={feature} className="grid grid-cols-[18px_1fr] gap-2"><span aria-hidden className="text-muted">+</span><span>{feature}</span></li>
                ))}
              </ul>
              <button type="button" disabled={busy} onClick={() => onChoose("outreach")} className="mt-4 w-full rounded-xl border border-line px-4 py-2.5 text-sm font-semibold hover:bg-white/5 disabled:opacity-50">Get {outreach.name}, {outreach.priceLabel} once</button>
            </div>
          )}

          <p className="mt-4 text-center text-xs text-faint">Cancel in two clicks. Full refund within {REFUND_DAYS} days, no questions. <button type="button" onClick={onClose} className="underline underline-offset-4 hover:text-white">Keep using Free</button></p>
        </div>
      </div>
    </div>
  );
}
