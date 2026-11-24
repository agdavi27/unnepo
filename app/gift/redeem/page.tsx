import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { GiftShell } from "@/components/marketing/gift-shell";
import { RememberGift } from "@/components/marketing/remember-gift";
import { readSession } from "@/lib/http";

export const metadata: Metadata = { title: "Your Unnepo gift", robots: { index: false, follow: false } };

/** The link in the gift email. Signed in: straight to the plans with the code filled in. Otherwise: sign up first. */
export default async function GiftRedeemPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = (await searchParams).code;
  const code = typeof raw === "string" ? raw.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 20) : "";
  const home = `/home?tab=settings&gift=${encodeURIComponent(code)}#plans`;
  if (await readSession()) redirect(home);
  const next = encodeURIComponent(home);
  return (
    <GiftShell>
      <RememberGift code={code} />
      <h1 className="m-0 text-[clamp(32px,5vw,52px)] font-bold leading-[1] tracking-[-0.04em]">Someone gave you Outreach Season.</h1>
      <p className="m-0 text-base leading-relaxed text-[#B4B4BC]">A recruiting season of Unnepo: the right people at each company you apply to, and a short email to each one. Sign up free (or log in), and the code is filled in for you.</p>
      {code && <p className="m-0 border-4 border-[#26262C] bg-[#0C0C0E] p-4 text-center font-mono text-2xl font-bold tracking-[0.12em]">{code}</p>}
      <div className="flex flex-wrap gap-3">
        <Link href={`/signup?next=${next}`} className="inline-flex min-h-[52px] items-center justify-center rounded-[10px] bg-[#3D8BFF] px-6 text-base font-semibold text-bg hover:bg-[#5A9DFF]">Sign up free</Link>
        <Link href={`/login?next=${next}`} className="inline-flex min-h-[52px] items-center justify-center rounded-[10px] border border-[#3A3A42] px-6 text-base font-semibold text-[#F7F7F8] hover:bg-white/5">Log in</Link>
      </div>
    </GiftShell>
  );
}
