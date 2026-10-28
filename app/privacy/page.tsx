import type { Metadata } from "next";
import Link from "next/link";
import { ENTERPRISE_PLAN } from "@/lib/config";

export const metadata: Metadata = {
  title: "Privacy Policy · Unnepo",
  description: "What Unnepo collects, how it is used, and the choices you have.",
};

const UPDATED = "October 27, 2026";

const SECTIONS: Array<{ title: string; body: React.ReactNode }> = [
  {
    title: "Who we are",
    body: (
      <p>
        Unnepo helps college students find professionals at companies they care about and reach out to them. This policy explains what we collect when
        you use unnepo (the website at unneponew.vercel.app and any related services), how we use it, and the choices you have.
      </p>
    ),
  },
  {
    title: "Information you give us",
    body: (
      <ul>
        <li><strong>Account details:</strong> your name, school email address, and a password (stored only as a secure hash).</li>
        <li><strong>Profile:</strong> your school, majors, graduation year, roles, companies, locations, interests, and anything else you enter during onboarding or in Settings.</li>
        <li><strong>Resume:</strong> the file you upload and the text we read from it, used to build your profile, write emails and cover letters, and attach to emails when you choose.</li>
        <li><strong>Emails and cover letters:</strong> drafts you write or generate, and the subject and body of emails you send through Unnepo.</li>
      </ul>
    ),
  },
  {
    title: "Information about the people you find",
    body: (
      <p>
        When you run a search, we get professional details about people from our data provider, Apollo.io: name, job title, company, work location, work
        email, profile photo, and public profile links such as LinkedIn. We keep the contacts you find so they show up in your list. If you are one of those
        professionals and want your details removed from Unnepo, email us at the address below and we will delete them.
      </p>
    ),
  },
  {
    title: "Gmail and Outlook",
    body: (
      <>
        <p>
          If you connect Gmail or Outlook, we ask only for permission to see your email address and to <strong>send email on your behalf</strong>. We do
          not read, search, or store your inbox. We use this access only to send messages you write or approve in Unnepo, to the contacts you choose,
          and only after you press Send.
        </p>
        <p>
          Access tokens are encrypted before they are stored. You can disconnect at any time in Settings, which deletes the stored tokens, and you can also
          remove access from your Google or Microsoft account settings.
        </p>
        <p>
          Unnepo&apos;s use and transfer to any other app of information received from Google APIs will adhere to the{" "}
          <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">Google API Services User Data Policy</a>,
          including the Limited Use requirements. We do not use Google user data to serve ads, we do not sell it, we do not use it to train AI models, and
          no person at Unnepo reads it unless you ask us to for support, it is needed for security, or the law requires it.
        </p>
      </>
    ),
  },
  {
    title: "How we use information",
    body: (
      <ul>
        <li>To run your account, sign you in, and keep it secure.</li>
        <li>To find people who match your profile and searches, and to show their verified work emails.</li>
        <li>To write email drafts, highlights, and cover letters from your profile and resume.</li>
        <li>To recommend job postings from public job boards that fit your interests.</li>
        <li>To track your credits and, if you buy a plan, your payments.</li>
        <li>To send you account emails such as verification and password reset links.</li>
      </ul>
    ),
  },
  {
    title: "Services we share information with",
    body: (
      <>
        <p>We share only what each service needs to do its job:</p>
        <ul>
          <li><strong>Vercel</strong> hosts the website.</li>
          <li><strong>Supabase</strong> stores the database and resume files.</li>
          <li><strong>Apollo.io</strong> receives search filters built from your profile (such as roles, companies, industries, and locations) to find people and verify their emails.</li>
          <li><strong>Anthropic</strong> receives your profile, resume text, and the details you select so its AI can write drafts, highlights, and cover letters. Anthropic does not use this data to train its models.</li>
          <li><strong>Google or Microsoft</strong> deliver the emails you send when you connect Gmail or Outlook.</li>
          <li><strong>Resend</strong> delivers account emails such as verification links.</li>
          <li><strong>Stripe</strong> processes payments if you buy a plan. We never see or store your full card number.</li>
        </ul>
        <p>We do not sell your personal information, and we do not share it for advertising.</p>
      </>
    ),
  },
  {
    title: "Cookies",
    body: (
      <p>
        We use one essential cookie to keep you signed in. It lasts up to 30 days. We do not use advertising or third-party tracking cookies.
      </p>
    ),
  },
  {
    title: "How long we keep information",
    body: (
      <p>
        We keep your account, profile, resume, and contacts while your account is open. When you delete contacts or disconnect a mailbox, that data is
        removed from your account. If you ask us to delete your account, we delete your personal information, except records we must keep for legal,
        tax, or fraud-prevention reasons, such as payment records.
      </p>
    ),
  },
  {
    title: "Your choices",
    body: (
      <ul>
        <li>Edit your profile or upload a new resume at any time in Settings.</li>
        <li>Delete contacts from My Contacts.</li>
        <li>Disconnect Gmail or Outlook in Settings.</li>
        <li>Ask us for a copy of your data, to correct it, or to delete your account by emailing us.</li>
      </ul>
    ),
  },
  {
    title: "Security",
    body: (
      <p>
        We use encryption in transit, encrypt mailbox tokens at rest, hash passwords, and limit access to production data. No system is perfectly
        secure, so please use a strong, unique password.
      </p>
    ),
  },
  {
    title: "Students and age",
    body: <p>Unnepo is for college students and is not intended for anyone under 16. We do not knowingly collect information from children.</p>,
  },
  {
    title: "Changes to this policy",
    body: <p>If we make material changes, we will update the date at the top of this page and let signed-in users know in the app.</p>,
  },
];

export default function PrivacyPage() {
  const email = ENTERPRISE_PLAN.contactEmail;
  return (
    <div className="min-h-screen bg-bg text-ink">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Link href="/" className="text-2xl font-semibold tracking-tight">unnepo.</Link>
        <Link href="/signup" className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-black">Get started</Link>
      </header>

      <main className="mx-auto max-w-3xl px-5 pb-20 pt-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-faint">Legal</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">Privacy Policy</h1>
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
              Questions, data requests, or removal requests: <a className="text-ink underline underline-offset-4" href={`mailto:${email}`}>{email}</a>
            </p>
          </section>
        </div>
      </main>

      <footer className="border-t border-line px-5 py-8 text-center text-sm text-faint">
        <Link href="/" className="hover:text-white">Unnepo</Link> · Built for students
      </footer>
    </div>
  );
}
