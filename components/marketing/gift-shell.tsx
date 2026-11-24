import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/brand/logo";
import { CONTACT_EMAIL } from "@/lib/config";

/** The frame the gift pages share: logo, one column, and the footer. */
export function GiftShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-bg px-4 text-ink sm:px-[clamp(16px,5vw,72px)]">
      <div className="mx-auto flex w-full max-w-[720px] flex-col">
        <header className="flex items-center justify-between py-5">
          <Logo href="/" className="text-xl font-bold tracking-[-0.6px]" />
        </header>
        <main className="flex flex-col gap-6 pb-16 pt-4">{children}</main>
        <footer className="border-t border-[#17171B] py-6 text-[13px] text-[#9A9AA3]">
          Unnepo · Built for students · <Link href="/terms" className="underline-offset-4 hover:text-white hover:underline">Terms</Link> · <a href={`mailto:${CONTACT_EMAIL}`} className="underline-offset-4 hover:text-white hover:underline">{CONTACT_EMAIL}</a>
        </footer>
      </div>
    </div>
  );
}
