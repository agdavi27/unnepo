import type { Metadata } from "next";
import { GiftShell } from "@/components/marketing/gift-shell";
import { GiftThanks } from "@/components/marketing/gift-thanks";

export const metadata: Metadata = { title: "Thank you · Unnepo", robots: { index: false, follow: false } };

export default async function GiftThanksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = (await searchParams).session;
  return (
    <GiftShell>
      <h1 className="m-0 text-[clamp(32px,5vw,52px)] font-bold leading-[1] tracking-[-0.04em]">Thank you.</h1>
      <GiftThanks session={typeof session === "string" ? session : ""} />
    </GiftShell>
  );
}
