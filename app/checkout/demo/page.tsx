"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

function DemoCheckout() {
  const params = useSearchParams();
  const raw = params.get("kind") || "pro";
  const kind = raw === "grind" || raw === "pack" || raw === "premium" || raw === "pro" ? raw : "pro";
  const title = kind === "premium" ? "Premium · 500 credits" : kind === "pro" ? "Pro · 200 credits" : kind === "grind" ? "Legacy Grind" : "Legacy credit pack";
  const [message, setMessage] = useState("");
  const [code, setCode] = useState("");

  async function confirm() {
    const response = await fetch("/api/billing/demo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind }),
    });
    const data = await response.json();
    if (!response.ok) return setMessage(data.error);
    setMessage(data.granted ? `Demo credits added: ${data.credits}. No card was charged, and this is not revenue.` : "This demo plan was already claimed.");
  }

  return (
    <main className="mx-auto max-w-lg px-5 py-16">
      <p className="text-sm text-cream">Demo checkout</p>
      <h1 className="mt-2 text-3xl font-semibold">{title}</h1>
      <p className="mt-3 text-muted">Stripe is not configured, so this screen does not charge a card. Credits are marked as demo credits and excluded from the profitability dashboard.</p>
      <label className="mt-6 block text-sm text-muted">
        Referral code, if a friend sent you one
        <input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="CODE" className="field mt-1 font-mono uppercase" />
      </label>
      <button
        onClick={async () => {
          if (!code.trim()) return;
          const response = await fetch("/api/billing/referral", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
          const data = await response.json();
          setMessage(response.ok ? data.message : data.error || "Could not apply that code.");
        }}
        className="mt-3 rounded-xl border border-line px-4 py-2 text-sm"
      >
        Apply code
      </button>
      <button onClick={confirm} className="mt-6 rounded-xl bg-white px-4 py-2 font-semibold text-black">Add demo credits</button>
      {message ? <p className="mt-4 text-sm">{message}</p> : null}
      <a href="/settings?tab=billing" className="mt-6 block text-sm text-muted">Back to billing</a>
    </main>
  );
}

export default function Page() {
  return (
    <Suspense>
      <DemoCheckout />
    </Suspense>
  );
}
