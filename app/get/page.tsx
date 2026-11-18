import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { InstallLinkForm } from "@/components/marketing/install-link-form";
import { CHROME_STORE_URL, CONTACT_EMAIL } from "@/lib/config";
import { DEMO_MEDIA } from "@/lib/install-link";
import { installView } from "@/lib/install-view";

/**
 * The landing page for Instagram ads. Ad traffic is mostly phones, where the extension can't be installed, so a phone
 * (or Safari/Firefox on a computer) gets an email field that sends the install link; Chrome on a computer gets one
 * Add to Chrome button. Which one is decided on the server from the User-Agent, so nothing swaps after load.
 * `?view=email` or `?view=chrome` forces one, for checking both. Kept out of search: it's for ads, not discovery.
 */
export const metadata: Metadata = {
  title: "Apply to jobs in 1 minute, not 25 · Unnepo",
  description: "Unnepo is a free Chrome extension that fills job applications from your resume, writes the cover letter and finds who to follow up with.",
  robots: { index: false, follow: false },
};

const PIXEL = "font-[family-name:var(--font-pixel)]";
const POINTS = [
  "Fills applications from your resume on Workday, Greenhouse, Lever and more",
  "Writes a cover letter for each job",
  "Finds people at the company to follow up with",
];

/** The demo clip, or (until it's recorded; see DEMO_MEDIA) a still stand-in of the extension finishing a form. */
function Demo() {
  if (DEMO_MEDIA.ready) {
    return (
      // An animated WebP (no video player, no script). People who turn off motion get the still; on a phone it's
      // below the form, so it loads lazily.
      <picture>
        <source srcSet={DEMO_MEDIA.still} media="(prefers-reduced-motion: reduce)" />
        <img
          src={DEMO_MEDIA.webp}
          width={DEMO_MEDIA.width}
          height={DEMO_MEDIA.height}
          loading="lazy"
          decoding="async"
          alt="Unnepo's spider drops onto a job application, fills every field, writes a cover letter and lists people at the company to email"
          className="block h-auto w-full border-4 border-[#F7F7F8] bg-[#0C0C0E] shadow-[8px_8px_0_#3D8BFF]"
        />
      </picture>
    );
  }
  return (
    <div
      data-placeholder="demo-video"
      style={{ aspectRatio: `${DEMO_MEDIA.width} / ${DEMO_MEDIA.height}` }}
      className="relative flex w-full flex-col justify-center gap-3 border-4 border-[#F7F7F8] bg-[#0C0C0E] p-[clamp(14px,4vw,26px)] shadow-[8px_8px_0_#3D8BFF]"
    >
      {process.env.NODE_ENV !== "production" && (
        <span className="absolute right-2 top-2 rounded bg-[#F5A524] px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-black">Placeholder: demo video</span>
      )}
      <p className={`m-0 ${PIXEL} text-[10px] leading-relaxed text-[#3D8BFF]`}>PRESS FILL</p>
      <ol className="m-0 flex list-none flex-col gap-[clamp(6px,1.6vw,11px)] border-2 border-[#26262C] bg-bg p-3 font-mono text-[clamp(12px,3.2vw,13px)] text-[#B4B4BC]">
        <li className="flex justify-between gap-4"><span>Filled your details</span><span className="text-[#4ADE80]">Done</span></li>
        <li className="flex justify-between gap-4"><span>Attached resume and letter</span><span className="text-[#4ADE80]">Done</span></li>
        <li className="flex justify-between gap-4"><span>Answered 6 questions</span><span className="text-[#4ADE80]">Done</span></li>
        <li className="flex justify-between gap-4 text-[#F7F7F8]"><span>Ready to submit</span><span className="text-[#3D8BFF]">1 min</span></li>
      </ol>
    </div>
  );
}

export default async function GetPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const one = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : undefined);
  const view = installView((await headers()).get("user-agent"), one("view"));
  const source = one("utm_campaign") || one("utm_source") || "get";
  const unsubscribed = one("unsubscribed");

  return (
    <div className="min-h-screen bg-bg px-4 text-ink sm:px-[clamp(16px,5vw,72px)]">
      <div className="mx-auto flex w-full max-w-[1120px] flex-col">
        <header className="flex items-center justify-between py-5">
          <Logo href="/" className="text-xl font-bold tracking-[-0.6px]" />
          <Link href="/demo" className="py-3 text-sm text-[#9A9AA3] hover:text-white">See how it works</Link>
        </header>

        {unsubscribed && (
          <p role="status" className="m-0 mb-4 rounded-xl border border-[#26262C] bg-[#111114] p-4 text-sm text-[#B4B4BC]">
            {unsubscribed === "1" ? "You're unsubscribed. We won't email you about the install link again." : "That unsubscribe link didn't match anything, so there's nothing to stop."}
          </p>
        )}

        <main className="flex flex-wrap items-center gap-x-12 gap-y-8 pb-16 pt-2 sm:pt-8">
          <div className="flex min-w-0 flex-[1_1_420px] flex-col items-start gap-5">
            <h1 className="m-0 text-balance text-[clamp(36px,6vw,72px)] font-bold leading-[0.98] tracking-[-0.045em]">
              Apply to jobs in 1&nbsp;minute, not&nbsp;25.
            </h1>
            <p className="m-0 max-w-[520px] text-[clamp(16px,2vw,19px)] leading-normal text-[#B4B4BC]">
              Unnepo is a free Chrome extension for students. Open any application, press Fill, and it&apos;s done from your resume.
            </p>

            {view === "chrome" ? (
              <div className="flex w-full flex-col items-start gap-3">
                <a
                  href={CHROME_STORE_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-[64px] w-full items-center justify-center rounded-[12px] bg-[#3D8BFF] px-8 text-lg font-semibold text-bg transition-colors hover:bg-[#5A9DFF] sm:w-auto"
                >
                  Add to Chrome — it&apos;s free
                </a>
                <p className="m-0 text-[13px] text-[#9A9AA3]">Free for students, no card. Takes 10 seconds.</p>
              </div>
            ) : (
              <div className="flex w-full max-w-[460px] flex-col gap-3">
                <p className="m-0 text-[15px] leading-relaxed text-[#F7F7F8]">
                  <span className="font-semibold">It runs in Chrome on your laptop.</span> <span className="text-[#B4B4BC]">We&apos;ll email you the link so it&apos;s waiting there.</span>
                </p>
                <InstallLinkForm source={source} />
              </div>
            )}
          </div>

          <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-6">
            <Demo />
            <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[15px] leading-snug text-[#B4B4BC]">
              {POINTS.map((point) => (
                <li key={point} className="flex gap-2.5"><span aria-hidden className="text-[#4ADE80]">✓</span>{point}</li>
              ))}
            </ul>
          </div>
        </main>

        <footer className="border-t border-[#17171B] py-6 text-[13px] text-[#9A9AA3]">
          Unnepo · Built for students · <Link href="/privacy" className="underline-offset-4 hover:text-white hover:underline">Privacy</Link> · <Link href="/terms" className="underline-offset-4 hover:text-white hover:underline">Terms</Link> · <a href={`mailto:${CONTACT_EMAIL}`} className="underline-offset-4 hover:text-white hover:underline">{CONTACT_EMAIL}</a>
        </footer>
      </div>
    </div>
  );
}
