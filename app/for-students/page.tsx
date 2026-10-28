import Link from "next/link";
import { PUBLIC_PLANS, peopleFromCredits } from "@/lib/config";

export default function ForStudentsPage() {
  return (
    <div className="min-h-screen bg-bg text-ink">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Link href="/" className="text-2xl font-semibold tracking-tight">unnepo.</Link>
        <nav className="hidden items-center gap-8 text-sm text-muted md:flex">
          <Link href="/#how" className="hover:text-white">How it works</Link>
          <Link href="/#pricing" className="hover:text-white">Pricing</Link>
          <Link href="/for-students" className="text-white">For Students</Link>
        </nav>
        <Link href="/signup" className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-black">Get started</Link>
      </header>

      <main className="mx-auto max-w-3xl px-5 pb-20 pt-8">
        <div className="flex items-start gap-5">
          <img
            src="/founders/andrew.jpg"
            alt="Andrew Davis, co-founder of Unnepo"
            width={160}
            height={121}
            className="mt-1 h-24 w-32 shrink-0 rounded-xl object-cover object-top md:h-28 md:w-36"
          />
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-faint">A note from the founder</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">We didn&apos;t know anyone either.</h1>
          </div>
        </div>

        <div className="mt-8 space-y-5 text-base leading-7 text-muted">
          <p>We started Unnepo in college after realizing that half the battle of getting a job is just getting in front of the right person.</p>
          <p>Some people have family connections. Some have alumni networks. Most of us are just sending applications into the void and hoping someone reads them.</p>
          <p>We figured there should be an easier way.</p>
          <p>So we built Unnepo to help students find people at companies they actually want to work for, get their contact information, and reach out directly.</p>
          <p>It&apos;s basically networking without having to know anyone beforehand. Pretty simple concept. Not sure why we had to build it ourselves.</p>
        </div>

        <p className="mt-10 text-2xl font-semibold tracking-tight md:text-3xl">
          They knew someone.
          <br />
          <span className="text-[#3D8BFF]">Now you do too.</span>
        </p>

        <Link href="/signup" className="mt-8 inline-flex rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black">
          Start with {PUBLIC_PLANS[0].credits} free credits ({peopleFromCredits(PUBLIC_PLANS[0].credits)} contacts)
        </Link>
      </main>
    </div>
  );
}
