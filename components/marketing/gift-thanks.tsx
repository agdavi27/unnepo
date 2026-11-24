"use client";

import { useEffect, useState } from "react";

type Gift = { code: string; recipientName: string; redeemUrl: string; days: number };

/** The code, once Stripe has told us about the payment (usually a few seconds), with the link to send the student. */
export function GiftThanks({ session }: { session: string }) {
  const [gift, setGift] = useState<Gift | null>(null);
  const [tries, setTries] = useState(0);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (gift || !session || tries > 20) return;
    const timer = setTimeout(async () => {
      const payload = await fetch(`/api/gift/thanks?session=${encodeURIComponent(session)}`).then((response) => response.json()).catch(() => ({}));
      if (payload.gift) setGift(payload.gift);
      else setTries((count) => count + 1);
    }, tries ? 2000 : 0);
    return () => clearTimeout(timer);
  }, [gift, session, tries]);

  if (!gift) {
    return (
      <p role="status" className="m-0 text-base text-[#B4B4BC]">
        {tries > 20 ? "Your payment went through. The gift code is on its way to your email; if it doesn't arrive in a few minutes, write to us and we'll send it." : "Making the gift code…"}
      </p>
    );
  }
  const who = gift.recipientName || "your student";
  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-base text-[#B4B4BC]">Here&apos;s the code for {who}. We emailed it to you too. Their {Math.round(gift.days / 30)} months start when they use it.</p>
      <p className="m-0 border-4 border-[#F7F7F8] bg-[#0C0C0E] p-5 text-center font-mono text-3xl font-bold tracking-[0.12em] shadow-[8px_8px_0_#3D8BFF]">{gift.code}</p>
      <div className="flex flex-col gap-2">
        <p className="m-0 text-sm font-semibold">Send them this link</p>
        <div className="flex flex-wrap gap-2">
          <input readOnly value={gift.redeemUrl} onFocus={(event) => event.target.select()} className="min-w-0 flex-1 rounded-[10px] border-2 border-[#26262C] bg-[#0C0C0E] px-3 py-2.5 font-mono text-sm text-[#F7F7F8]" />
          <button type="button" onClick={() => void navigator.clipboard.writeText(gift.redeemUrl).then(() => setCopied(true))} className="rounded-[10px] bg-[#3D8BFF] px-5 py-2.5 text-sm font-semibold text-bg hover:bg-[#5A9DFF]">{copied ? "Copied" : "Copy"}</button>
        </div>
      </div>
    </div>
  );
}
