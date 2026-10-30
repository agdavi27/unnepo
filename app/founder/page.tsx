import type { Metadata } from "next";
import { Logo } from "@/components/brand/logo";
import { FounderCard } from "@/components/marketing/founder-note";

export const metadata: Metadata = {
  title: "A note from the founder · Unnepo",
  description: "Drew Davis on why he built Unnepo.",
};

export default function FounderPage() {
  return (
    <div className="min-h-screen bg-bg text-ink">
      <header className="flex items-center justify-between px-6 py-6 sm:px-10">
        <Logo href="/" className="text-xl font-bold tracking-[-0.6px]" />
      </header>
      <main className="mx-auto w-full max-w-[1100px] px-4 pb-16">
        <FounderCard />
      </main>
    </div>
  );
}
