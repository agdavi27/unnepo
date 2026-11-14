import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { CONTACT_EMAIL } from "@/lib/config";

/**
 * A sponsored article about Unnepo and the Colby student building it, for career centers, campus newsletters and
 * clubs to repost. Linked only from the footer. It says plainly that Unnepo paid for it and wrote it, and that Colby
 * doesn't endorse it, so a repost never reads as independent news.
 */

export const metadata: Metadata = {
  title: "The Colby student who got tired of applying into the void · Unnepo",
  description: "Drew Davis is a student at Colby College. He's building Unnepo, a free tool that fills out job applications and finds the people to follow up with.",
  openGraph: {
    title: "The Colby student who got tired of applying into the void",
    description: "Drew Davis is building Unnepo between classes at Colby College. Sponsored by Unnepo.",
    images: ["/founders/drew.jpg"],
  },
};

const SERIF = "font-[family-name:Georgia,'Times_New_Roman',serif]";
const PUBLISHED = "November 13, 2026";

/** The worries students raise before trying it, each with a straight answer. */
const OBJECTIONS: Array<[string, string]> = [
  ["\"Isn't this just mass-applying?\"", "No. Unnepo fills in the application you're already looking at, from your own resume and profile, then stops at Submit so you read it first. You choose every job. It doesn't spray your name across the internet."],
  ["\"Will recruiters know a tool filled it out?\"", "What they get is your information, in the boxes they asked for. The written answers are drafted from your real experience, and you can edit every word before it goes. It never invents jobs, numbers or skills you don't have."],
  ["\"What happens to my data?\"", "Your resume and profile are used to fill your applications and write your drafts. Nothing is sent to anyone unless you press send, and you can ask to have your account and everything in it deleted at any time."],
  ["\"Cold-emailing strangers is awkward.\"", "That's the part Unnepo is built for. It finds a recruiter or someone on the team, writes a short, specific note from your resume, and reminds you to follow up five business days later. You decide whether it goes."],
  ["\"I can't afford another subscription.\"", "You don't need one. Free covers unlimited job tracking, three full autofills, three cover letters, three answers and three emails written for you every day, plus a person to email at every job. Pro is there if you want more."],
  ["\"Why trust something a student built?\"", "Because he's using it on the same job market you are. If something breaks, you can write to him directly, and he'll answer."],
];

export default function StoryPage() {
  return (
    <div className="min-h-screen bg-[#F6F3EE] text-[#1B1B1F]">
      <div className="border-b border-[#E2DDD4] bg-[#EFEAE1] px-4 py-2 text-center text-[11px] uppercase tracking-[0.18em] text-[#6B665E]">
        Sponsored content · Paid for and written by Unnepo
      </div>

      <header className="mx-auto flex max-w-[760px] items-center justify-between px-5 py-5">
        <Link href="/" className="text-lg font-bold tracking-[-0.5px] text-[#1B1B1F]">unnepo<span className="text-[#3D8BFF]">.</span></Link>
        <span className="text-[11px] uppercase tracking-[0.18em] text-[#8A847A]">Campus · Careers</span>
      </header>

      <main className="mx-auto max-w-[760px] px-5 pb-20">
        <article>
          <p className="m-0 text-[12px] font-semibold uppercase tracking-[0.2em] text-[#3D6FD1]">Student founders</p>
          <h1 className={`mb-0 mt-3 ${SERIF} text-[clamp(34px,5.4vw,56px)] font-normal leading-[1.05] tracking-[-1px]`}>
            The Colby student who got tired of applying into the void
          </h1>
          <p className={`mb-0 mt-4 ${SERIF} text-[clamp(18px,2.2vw,22px)] italic leading-[1.45] text-[#4A463F]`}>
            Like most students, Drew Davis was sending applications and hearing nothing back. So, between classes in Waterville, Maine, he started building the tool he wished he had.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1 border-y border-[#E2DDD4] py-3 text-[13px] text-[#6B665E]">
            <span>By the Unnepo team</span><span aria-hidden>·</span><time dateTime="2026-11-13">{PUBLISHED}</time><span aria-hidden>·</span><span>5 min read</span>
          </div>

          <figure className="m-0 mt-7">
            <div className="relative aspect-[16/10] w-full overflow-hidden rounded-[4px] bg-[#E2DDD4]">
              <Image src="/founders/drew.jpg" alt="Drew Davis, a Colby College student and the founder of Unnepo, in a suit in front of the White House" fill sizes="(min-width: 800px) 760px, 100vw" className="object-cover object-[50%_58%]" priority />
            </div>
            <figcaption className="mt-2 text-[12px] leading-snug text-[#8A847A]">Drew Davis, a student at Colby College, is the founder of Unnepo.</figcaption>
          </figure>

          <div className={`mt-8 flex flex-col gap-5 ${SERIF} text-[19px] leading-[1.7] text-[#2A2824]`}>
            <p className="m-0 first-letter:float-left first-letter:mr-2 first-letter:mt-1 first-letter:text-[64px] first-letter:leading-[0.8] first-letter:text-[#1B1B1F]">
              Every college student knows the routine. You find a job you actually want. You open the application. You type your name, your email, your school and your GPA into boxes you have already filled out forty times this month. You paste in your resume, and then you retype your resume anyway. You click Submit, and you never hear about it again.
            </p>
            <p className="m-0">
              Drew Davis knows the routine too. He is a student at Colby College, the liberal arts school in Waterville, Maine, and he is going through the same internship and job search as his classmates. Somewhere between problem sets and applications, he decided the process itself was the problem.
            </p>
            <blockquote className={`m-0 border-l-[3px] border-[#3D8BFF] py-1 pl-5 ${SERIF} text-[26px] italic leading-[1.35] text-[#1B1B1F]`}>
              &ldquo;Nobody should have to apply to 200 jobs and pray.&rdquo;
            </blockquote>
            <p className="m-0">
              That line is how he describes why he built Unnepo. In his words, the job market is broken, networking is awkward, and the plan everyone hands students is the same resume, retyped into 200 forms.
            </p>

            <h2 className="m-0 mt-4 font-sans text-[22px] font-bold tracking-[-0.3px] text-[#1B1B1F]">Built at Colby, for students like him</h2>
            <p className="m-0">
              Unnepo started as a fix for Drew&apos;s own search. He wrote it while carrying a full course load, and he still answers students&apos; emails himself. That shapes what it does and what it doesn&apos;t: it is built for students who don&apos;t have a family friend at the company or an alumni network on speed dial, which is to say, most students.
            </p>
            <p className="m-0">
              The idea is simple. The forms are the boring part, so a tool should do them. The person who reads your application is the part that matters, so a tool should help you reach them. Drew built Unnepo to do both.
            </p>

            <h2 className="m-0 mt-4 font-sans text-[22px] font-bold tracking-[-0.3px] text-[#1B1B1F]">What it actually does</h2>
            <p className="m-0">
              Unnepo is a Chrome extension with a website behind it. Open an application on almost any job board or company site and it fills in the form from your resume and profile, drafts the written questions, and attaches your resume and cover letter. Then it stops at Submit, so you look it over before anything is sent.
            </p>
            <p className="m-0">
              Every job you apply to lands in one tracker, wherever you applied. For each one, Unnepo finds someone at the company to follow up with, like a recruiter or someone on the team, writes a short email in your voice, and reminds you when it&apos;s time to follow up. You can even add friends and race them through the week, with points for every application, email, follow-up and interview.
            </p>
          </div>

          <aside className="my-10 rounded-[6px] border border-[#E2DDD4] bg-white px-6 py-5">
            <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8A847A]">Unnepo at a glance</p>
            <dl className="m-0 mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[15px] leading-snug">
              <dt className="font-semibold">Founder</dt><dd className="m-0 text-[#4A463F]">Drew Davis, a student at Colby College</dd>
              <dt className="font-semibold">What it is</dt><dd className="m-0 text-[#4A463F]">A Chrome extension and website for job and internship applications</dd>
              <dt className="font-semibold">Fills out</dt><dd className="m-0 text-[#4A463F]">Applications on job boards and company career sites, stopping at Submit</dd>
              <dt className="font-semibold">Finds</dt><dd className="m-0 text-[#4A463F]">A person to email at each company, with a draft written for you</dd>
              <dt className="font-semibold">Cost</dt><dd className="m-0 text-[#4A463F]">Free for students. Pro is $29.99 a month or $100 a semester, through May.</dd>
            </dl>
          </aside>

          <div className={`flex flex-col gap-5 ${SERIF} text-[19px] leading-[1.7] text-[#2A2824]`}>
            <h2 className="m-0 font-sans text-[22px] font-bold tracking-[-0.3px] text-[#1B1B1F]">The fair questions</h2>
            <p className="m-0">Students are right to be skeptical of anything that promises to make the job search easier. Here are the questions that come up most, answered straight.</p>
          </div>
          <div className="mt-5 flex flex-col">
            {OBJECTIONS.map(([question, answer]) => (
              <div key={question} className="border-t border-[#E2DDD4] py-5">
                <h3 className="m-0 text-[17px] font-bold leading-snug text-[#1B1B1F]">{question}</h3>
                <p className={`mb-0 mt-2 ${SERIF} text-[18px] leading-[1.65] text-[#2A2824]`}>{answer}</p>
              </div>
            ))}
          </div>

          <div className={`mt-6 flex flex-col gap-5 ${SERIF} text-[19px] leading-[1.7] text-[#2A2824]`}>
            <h2 className="m-0 mt-4 font-sans text-[22px] font-bold tracking-[-0.3px] text-[#1B1B1F]">&ldquo;If it helps, or if it breaks, tell me&rdquo;</h2>
            <p className="m-0">
              That&apos;s how Drew signs off his note to new users, and he means it. Unnepo is free to start, and the founder&apos;s inbox is open. For a student building something between classes, the most useful thing another student can do is try it on a real application and say what went wrong.
            </p>
            <p className="m-0">
              The pitch is the same one he makes to his classmates at Colby: spend less time on forms and more time talking to the people who hire.
            </p>
          </div>

          <div className="mt-10 rounded-[6px] bg-[#1B1B1F] px-6 py-7 text-[#F6F3EE]">
            <p className={`m-0 ${SERIF} text-[26px] leading-[1.25]`}>Try it on your next application.</p>
            <p className="m-0 mt-2 text-[15px] text-[#C9C4BA]">Free for students, no card needed.</p>
            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
              <Link href="/signup" className="inline-flex min-h-[46px] items-center rounded-[8px] bg-[#3D8BFF] px-5 text-[15px] font-semibold text-white hover:bg-[#5A9DFF]">Start free</Link>
              <a href="mailto:agdavi27@colby.edu" className="text-[15px] text-[#F6F3EE] underline underline-offset-4">Write to Drew</a>
            </div>
          </div>
        </article>

        <p className="mt-10 text-[15px] text-[#4A463F]">
          More from Unnepo: <Link href="/guides" className="font-semibold text-[#1B1B1F] underline underline-offset-4">free job and internship guides for students</Link>.
        </p>

        <section aria-label="Reposting this article" className="mt-12 border-t border-[#E2DDD4] pt-6 text-[14px] leading-relaxed text-[#6B665E]">
          <p className="m-0 font-semibold text-[#1B1B1F]">For career centers, newsletters and student groups</p>
          <p className="m-0 mt-1">
            You&apos;re welcome to repost or link this article. Please keep the &ldquo;Sponsored content&rdquo; label and the note below. Questions or a different length: <a href={`mailto:${CONTACT_EMAIL}`} className="text-[#1B1B1F] underline underline-offset-4">{CONTACT_EMAIL}</a>.
          </p>
          <p className="m-0 mt-4 text-[12px] text-[#8A847A]">
            Sponsored content, paid for and written by Unnepo. Unnepo isn&apos;t affiliated with, sponsored by or endorsed by Colby College. Drew Davis is a Colby student building Unnepo on his own.
          </p>
        </section>
      </main>
    </div>
  );
}
