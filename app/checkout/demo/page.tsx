"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

function DemoCheckout() {
  const params = useSearchParams();
  const kind = params.get("kind") === "grind" ? "grind" : "pack";
  const [message, setMessage] = useState("");

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
      <h1 className="mt-2 text-3xl font-semibold">{kind === "grind" ? "The Grind" : "500 credit pack"}</h1>
      <p className="mt-3 text-muted">Stripe is not configured, so this screen does not charge a card. Credits are marked as demo credits and excluded from the profitability dashboard.</p>
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
