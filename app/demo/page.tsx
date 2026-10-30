import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { GetExtension } from "@/components/marketing/get-extension";
import { ProductDemo } from "@/components/marketing/product-demo";

export const metadata: Metadata = {
  title: "See how it works · Unnepo",
  description: "Watch Unnepo fill a job application from your profile, then find people at the company to email.",
};

const EXTENSION_URL = process.env.NEXT_PUBLIC_CHROME_EXTENSION_URL || "";

const STEPS = [
  ["Open any job", "On Greenhouse, Lever, Workday, Ashby, iCIMS and more, a spider drops in. Click it to open Unnepo."],
  ["Press Fill", "Unnepo presses Apply, makes your account or signs in, and fills every page from your profile and resume."],
  ["Check and submit", "Anything only you can answer is listed, and clicking it takes you to that question. You press Submit, or let Unnepo."],
  ["Reach the team", "It finds up to five people at the company and drafts an email to each, so you're not just a resume in a pile."],
];

/** The demo on its own page, linked as "See how it works" from the home page and the web app. */
export default function DemoPage() {
  return (
    <div className="min-h-screen bg-bg text-ink">
      <header className="flex flex-wrap items-center justify-between gap-4 px-6 py-6 sm:px-10">
        <Logo href="/" className="text-xl font-bold tracking-[-0.6px]" />
        <nav aria-label="Main" className="flex gap-6 text-sm">
          <Link href="/#pricing" className="py-3 text-[#9A9AA3] hover:text-white">Pricing</Link>
          <Link href="/login" className="py-3 text-[#9A9AA3] hover:text-white">Log in</Link>
        </nav>
      </header>
      <main className="flex flex-col items-center gap-10 pb-20">
        <div className="flex max-w-2xl flex-col items-center gap-4 px-6 text-center">
          <p className="m-0 font-mono text-xs uppercase tracking-[1.2px] text-[#8B8B94]">See how it works</p>
          <h1 className="m-0 text-[clamp(34px,5.4vw,58px)] font-bold leading-[1] tracking-[-1.8px]">One click fills the application.</h1>
          <p className="m-0 text-[16px] leading-relaxed text-[#B4B4BC]">This is the Unnepo extension on a real-looking job application: the job site on the left, Unnepo&apos;s side panel on the right.</p>
        </div>
        <ProductDemo />
        <ol className="m-0 grid w-full max-w-6xl list-none gap-4 px-6 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(([title, body], index) => (
            <li key={title} className="flex flex-col gap-2 rounded-2xl border border-[#1F1F24] bg-[#0C0C0E] p-5">
              <span className="font-[family-name:var(--font-pixel)] text-xs text-[#3D8BFF]">{index + 1}</span>
              <span className="text-[15px] font-semibold">{title}</span>
              <span className="text-sm leading-relaxed text-[#9A9AA3]">{body}</span>
            </li>
          ))}
        </ol>
        <GetExtension href={EXTENSION_URL || "/signup"} external={Boolean(EXTENSION_URL)} />
      </main>
    </div>
  );
}
