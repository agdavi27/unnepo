import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { ActivityToasts } from "@/components/marketing/activity-toasts";
import { FounderLink } from "@/components/marketing/founder-note";
import { GetExtension } from "@/components/marketing/get-extension";
import { Pricing } from "@/components/marketing/pricing";
import { ProductDemo } from "@/components/marketing/product-demo";
import { Stats } from "@/components/marketing/stats";
import { Schools } from "@/components/marketing/schools";
import { SpiderDialogue } from "@/components/marketing/spider-dialogue";

/** The Chrome Web Store listing, once the extension is published. Until then the button starts sign-up. */
const EXTENSION_URL = process.env.NEXT_PUBLIC_CHROME_EXTENSION_URL || "";

export function Landing() {
  const cta = EXTENSION_URL || "/signup";
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-bg text-ink">
      <header className="relative z-[2] flex flex-wrap items-center justify-between gap-4 px-6 py-6 sm:px-10">
        <Logo href="/" className="text-xl font-bold tracking-[-0.6px]" />
        <nav aria-label="Main" className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <Link href="/demo" className="py-3 text-[#9A9AA3] hover:text-white">See how it works</Link>
          <a href="#pricing" className="py-3 text-[#9A9AA3] hover:text-white">Pricing</a>
          <FounderLink />
          <Link href="/login" className="py-3 text-[#9A9AA3] hover:text-white">Log in</Link>
        </nav>
      </header>

      <main className="relative flex flex-col items-center gap-9 px-6 pb-12 pt-2">
        <div className="relative z-[1] flex max-w-3xl flex-col items-center gap-5 pt-4 text-center">
          <h1 className="m-0 text-[clamp(42px,7.4vw,84px)] font-bold leading-[0.96] tracking-[-0.045em]">Less applying.<br />More interviewing.</h1>
          <p className="m-0 max-w-xl text-[clamp(16px,2vw,19px)] leading-relaxed text-[#B4B4BC]">Find jobs, complete applications faster, and connect with people who work there. All in one place.</p>
          {/* Right under the headline, so it's on screen without scrolling. */}
          <div className="mt-3 flex flex-col items-center gap-3">
            <GetExtension href={cta} external={Boolean(EXTENSION_URL)} />
            <p className="m-0 max-w-md text-center text-[13px] text-[#8B8B94]">Free to start. Some schools cover Pro; see if yours does.</p>
          </div>
        </div>
        <div className="relative flex w-full flex-col items-center gap-9">
          <ActivityToasts />
          <SpiderDialogue />
        </div>
      </main>

      <Schools />

      <section className="flex flex-col items-center gap-3 px-6 pb-8 text-center">
        <p className="m-0 font-mono text-xs uppercase tracking-[1.2px] text-[#8B8B94]">See how it works</p>
        <h2 className="m-0 max-w-2xl text-[clamp(28px,4vw,40px)] font-bold leading-[1.05] tracking-[-1.2px]">Press Fill. Watch the spiders do the rest.</h2>
      </section>
      <ProductDemo id="demo" />
      <Stats />
      <Pricing />

      <footer className="border-t border-[#17171B] px-6 py-8 text-center text-[13px] text-[#8B8B94]">
        Unnepo · Built for students · <Link href="/privacy" className="underline-offset-4 hover:text-white hover:underline">Privacy Policy</Link>
      </footer>
    </div>
  );
}
