import type { Metadata } from "next";
import Link from "next/link";
import { ENTERPRISE_PLAN } from "@/lib/config";
import { Logo } from "@/components/brand/logo";

export const metadata: Metadata = {
  title: "Terms of Service · Unnepo",
  description: "The rules for using Unnepo: accounts, plans and payments, connected email, and what we're responsible for.",
};

const UPDATED = "November 10, 2026";

const SECTIONS: Array<{ title: string; body: React.ReactNode }> = [
  {
    title: "Agreeing to these terms",
    body: (
      <p>
        These terms are an agreement between you and Unnepo (&quot;Unnepo,&quot; &quot;we,&quot; &quot;us&quot;) about your use of the Unnepo website at
        unneponew.vercel.app, the Unnepo Chrome extension, and any related services (together, the &quot;Service&quot;). By creating an account or using the
        Service, you agree to these terms and to our <Link href="/privacy">Privacy Policy</Link>. If you don&apos;t agree, please don&apos;t use Unnepo.
      </p>
    ),
  },
  {
    title: "Who can use Unnepo",
    body: (
      <ul>
        <li>Unnepo is for college and university students. You need a school email address to sign up.</li>
        <li>You must be at least 16 years old, and old enough to agree to these terms where you live.</li>
        <li>One account per person. Give accurate information and keep it up to date.</li>
      </ul>
    ),
  },
  {
    title: "Your account",
    body: (
      <p>
        You&apos;re responsible for what happens in your account. Keep your password private, and if you sign in with Google, keep that account secure too.
        Tell us right away at the address below if you think someone else has used your account.
      </p>
    ),
  },
  {
    title: "What Unnepo does, and what it doesn't",
    body: (
      <>
        <p>
          Unnepo helps you apply to jobs and follow up: it prepares answers and cover letters, helps fill in application forms, keeps track of your
          applications and reminds you to follow up, and finds people at companies you applied to.
        </p>
        <p>
          You stay in charge. You review and submit every application, and you decide whether to contact anyone. Unnepo doesn&apos;t send email on your behalf.
          We can&apos;t promise any interview, job offer, or reply, and we aren&apos;t a recruiter, employer, or career counselor.
        </p>
      </>
    ),
  },
  {
    title: "AI-written content",
    body: (
      <p>
        Unnepo uses AI to write drafts, answers, cover letters, and summaries. AI can be wrong or incomplete. Check everything before you
        use it. You&apos;re responsible for what you submit to employers, and it must be truthful: don&apos;t use Unnepo to claim experience, degrees, or
        qualifications you don&apos;t have.
      </p>
    ),
  },
  {
    title: "Contact information for professionals",
    body: (
      <>
        <p>Unnepo shows names, job titles, and work emails of people at companies you&apos;re interested in. You may use them only for your own, individual, professional outreach about jobs. You may not:</p>
        <ul>
          <li>send bulk, automated, or unwanted messages, or anything that breaks anti-spam laws;</li>
          <li>copy, export, sell, or share contact information with anyone else, or build a list or database from it;</li>
          <li>harass anyone, or keep contacting someone who has asked you to stop.</li>
        </ul>
      </>
    ),
  },
  {
    title: "Using Unnepo fairly",
    body: (
      <>
        <p>Don&apos;t use Unnepo to:</p>
        <ul>
          <li>break the law, or break the rules of the job sites and employers you apply to;</li>
          <li>upload anything you don&apos;t have the right to use, or other people&apos;s personal information without permission;</li>
          <li>share your account, resell the Service, or get around plan limits, credits, or rate limits;</li>
          <li>scrape, copy, reverse engineer, or overload the Service, or try to get into accounts or systems that aren&apos;t yours.</li>
        </ul>
      </>
    ),
  },
  {
    title: "Plans, credits, and payments",
    body: (
      <ul>
        <li>Unnepo has a free plan and paid plans. The price and what&apos;s included are shown before you pay. Payments are processed by Stripe.</li>
        <li>A monthly plan renews each month until you cancel. A semester plan is paid up front for the semester. If you cancel, you keep your paid features until the end of the period you already paid for.</li>
        <li>Credits have no cash value, can&apos;t be transferred, and are used and refreshed as described in the app.</li>
        <li>Except where the law requires otherwise, payments aren&apos;t refundable. If something went wrong with a charge, email us and we&apos;ll make it right.</li>
        <li>We may change prices or plans. Changes to a paid plan you already have start at your next renewal, and we&apos;ll tell you before they do.</li>
      </ul>
    ),
  },
  {
    title: "Your content",
    body: (
      <p>
        Your resume, profile, answers, and other things you add stay yours. You give Unnepo permission to store, process, and use them only to run the
        Service for you, including sending them to the service providers listed in our Privacy Policy. If you send us feedback or ideas, we may use them
        without owing you anything.
      </p>
    ),
  },
  {
    title: "Our service",
    body: (
      <p>
        Unnepo, its software, design, spiders, and name belong to us. You may use the Service as these terms allow, but you don&apos;t get any other rights to
        it. We may add, change, or remove features at any time.
      </p>
    ),
  },
  {
    title: "Other companies' services",
    body: (
      <p>
        Unnepo works with sites and services we don&apos;t control, such as job sites, applicant tracking systems, Google, and the data providers named in our
        Privacy Policy. Their own terms apply to your use of them, and we aren&apos;t responsible for what they do or for job postings they host.
      </p>
    ),
  },
  {
    title: "Ending your account",
    body: (
      <p>
        You can stop using Unnepo and delete your account at any time in Settings. We may suspend or close an account that breaks these terms or puts other
        people or the Service at risk; when we can, we&apos;ll tell you why first. The sections on payments, your content, disclaimers, liability, and the law
        that applies keep applying after an account is closed.
      </p>
    ),
  },
  {
    title: "Disclaimers",
    body: (
      <p>
        Unnepo is provided &quot;as is&quot; and &quot;as available.&quot; To the extent the law allows, we make no promises that the Service will be uninterrupted,
        error-free, or right for your purposes, and we disclaim implied warranties such as merchantability, fitness for a particular purpose, and
        non-infringement.
      </p>
    ),
  },
  {
    title: "Limits on our liability",
    body: (
      <p>
        To the extent the law allows, Unnepo isn&apos;t liable for indirect, incidental, special, or consequential damages, or for lost opportunities, jobs, or
        data. Our total liability for any claim about the Service is limited to the greater of what you paid Unnepo in the 12 months before the claim or $50.
        Some places don&apos;t allow these limits, so they may not all apply to you.
      </p>
    ),
  },
  {
    title: "The law that applies",
    body: (
      <p>
        These terms are governed by the laws of the State of Maine, USA, without regard to its conflict-of-law rules. If a dispute comes up, please email us
        first: most problems can be solved quickly that way.
      </p>
    ),
  },
  {
    title: "Changes to these terms",
    body: (
      <p>
        We may update these terms. If we make material changes, we&apos;ll update the date at the top of this page and let signed-in users know in the app.
        Using Unnepo after a change means you accept the new terms.
      </p>
    ),
  },
];

export default function TermsPage() {
  const email = ENTERPRISE_PLAN.contactEmail;
  return (
    <div className="min-h-screen bg-bg text-ink">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Logo href="/" />
        <Link href="/signup" className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-black">Get started</Link>
      </header>

      <main className="mx-auto max-w-3xl px-5 pb-20 pt-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-faint">Legal</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">Terms of Service</h1>
        <p className="mt-3 text-sm text-faint">Last updated {UPDATED}</p>

        <div className="mt-10 space-y-10">
          {SECTIONS.map((section) => (
            <section key={section.title}>
              <h2 className="text-lg font-semibold tracking-tight">{section.title}</h2>
              <div className="mt-3 space-y-3 text-[15px] leading-7 text-muted [&_a]:text-ink [&_a]:underline [&_a]:underline-offset-4 [&_li]:mt-1.5 [&_strong]:text-ink [&_ul]:list-disc [&_ul]:pl-5">
                {section.body}
              </div>
            </section>
          ))}
          <section>
            <h2 className="text-lg font-semibold tracking-tight">Contact us</h2>
            <p className="mt-3 text-[15px] leading-7 text-muted">
              Questions about these terms: <a className="text-ink underline underline-offset-4" href={`mailto:${email}`}>{email}</a>
            </p>
          </section>
        </div>
      </main>

      <footer className="border-t border-line px-5 py-8 text-center text-sm text-faint">
        <Link href="/" className="hover:text-white">Unnepo</Link> · <Link href="/privacy" className="hover:text-white">Privacy Policy</Link> · <a href={`mailto:${email}`} className="hover:text-white">{email}</a>
      </footer>
    </div>
  );
}
