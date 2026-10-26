"use client";

import { useEffect, useState } from "react";
import { Copy, Gift } from "lucide-react";

export function ReferView() {
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/me")
      .then((response) => response.json())
      .then((data) => setCode(data.user?.referralCode || ""));
  }, []);

  function shareLink() {
    if (!code) return "";
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return `${origin}/signup?ref=${code}`;
  }

  async function copy() {
    const link = shareLink();
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="px-4 py-5 lg:px-8">
      <p className="text-xs font-semibold tracking-[0.18em] text-faint">GROW YOUR CREDITS</p>
      <h1 className="mt-2 text-4xl font-semibold">Refer a friend</h1>
      <p className="mt-3 max-w-xl text-muted">Share your code. When a friend verifies a school email, you get 5 credits — enough to reach 50 more people.</p>

      <section className="mt-8 max-w-lg rounded-2xl border border-gold/40 bg-gold/10 p-5">
        <p className="flex items-center gap-2 font-semibold text-cream"><Gift className="h-4 w-4" /> Your code</p>
        <div className="mt-4 flex items-center justify-between rounded-xl border border-line bg-card px-4 py-3 font-mono text-lg">
          <span>{code || "Loading…"}</span>
          <button type="button" onClick={copy} aria-label="Copy referral link" className="text-muted hover:text-white"><Copy className="h-4 w-4" /></button>
        </div>
        <button type="button" onClick={copy} className="mt-4 h-11 w-full rounded-xl bg-white text-sm font-semibold text-black">
          {copied ? "Link copied" : "Copy invite link"}
        </button>
        <p className="mt-3 text-sm text-muted">They still get their own 3 signup credits. You get 5 more after they verify.</p>
      </section>
    </div>
  );
}
