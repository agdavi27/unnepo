"use client";

import { useState } from "react";

/** Who the gift is for and a note, then off to Stripe. The buyer's email is asked for on Stripe's own page. */
export function GiftForm({ price }: { price: string }) {
  const [recipientName, setRecipientName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function buy() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/gift/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipientName, message }) });
      const payload = await response.json().catch(() => ({}));
      if (payload.url) {
        window.location.assign(payload.url);
        return;
      }
      setError(payload.error || "Checkout isn't available right now. Try again in a bit.");
    } catch {
      setError("Checkout isn't available right now. Try again in a bit.");
    }
    setBusy(false);
  }
  const field = "w-full rounded-[10px] border-2 border-[#26262C] bg-[#0C0C0E] px-3.5 py-3 text-base text-[#F7F7F8] outline-none focus:border-[#3D8BFF]";
  return (
    <form onSubmit={(event) => { event.preventDefault(); void buy(); }} className="flex flex-col gap-4 border-4 border-[#F7F7F8] bg-[#0C0C0E] p-6 shadow-[8px_8px_0_#3D8BFF]">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-semibold">Their first name</span>
        <input value={recipientName} onChange={(event) => setRecipientName(event.target.value)} maxLength={80} placeholder="Maya" className={field} />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-semibold">A note for them <span className="font-normal text-[#9A9AA3]">(optional)</span></span>
        <textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength={300} rows={3} placeholder="Proud of you. Go get that internship." className={field} />
      </label>
      <button type="submit" disabled={busy} className="min-h-[52px] rounded-[10px] bg-[#3D8BFF] px-6 text-base font-semibold text-bg transition-colors hover:bg-[#5A9DFF] disabled:opacity-60">
        {busy ? "Opening checkout…" : `Give Outreach Season, ${price}`}
      </button>
      {error && <p role="alert" className="m-0 text-sm text-[#F87171]">{error}</p>}
      <p className="m-0 text-[13px] text-[#9A9AA3]">You pay once on Stripe. We email you a gift code and a link to send them.</p>
    </form>
  );
}
