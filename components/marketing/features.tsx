"use client";

import { useEffect, useState } from "react";

/**
 * The four things Unnepo does, each beside a small moving picture of it: the tracker with the person to
 * follow up with, the cover letter writing itself from the posting, the time autofill saves, and the
 * password and resume kept a click away. A made-up student and companies. Reduced motion shows each
 * one finished.
 */

const card = "rounded-2xl border border-[#1F1F24] bg-[#0C0C0E]";

function useClock(loopMs: number) {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- a still, finished frame for reduced motion
      setT(loopMs);
      return;
    }
    const start = performance.now();
    const id = setInterval(() => setT((performance.now() - start) % (loopMs + 2500)), 50);
    return () => clearInterval(id);
  }, [loopMs]);
  return t;
}

const JOBS: Array<[string, string, string, string]> = [
  ["Stripe", "Data Analyst Intern", "Interviewing", "#3D8BFF"],
  ["Patagonia", "Marketing Intern", "Submitted", "#9A9AA3"],
  ["Duolingo", "Product Intern", "Offer", "#4ADE80"],
];

function TrackerPicture() {
  const t = useClock(3000);
  return (
    <div className={`${card} flex flex-col gap-3 p-4`}>
      <ul className="m-0 flex list-none flex-col divide-y divide-[#17171B] p-0">
        {JOBS.map(([company, title, stage, color], index) => (
          <li key={company} className={`flex items-center justify-between gap-3 py-2.5 transition-opacity duration-500 ${t > index * 400 ? "opacity-100" : "opacity-0"}`}>
            <span className="flex min-w-0 items-center gap-3">
              <span aria-hidden className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-[#17171B] text-sm font-bold">{company[0]}</span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{company}</span>
                <span className="block truncate text-xs text-[#8B8B94]">{title}</span>
              </span>
            </span>
            <span className="flex flex-none items-center gap-1.5 text-xs text-[#B4B4BC]"><span aria-hidden className="h-2 w-2 rounded-full" style={{ background: color }} />{stage}</span>
          </li>
        ))}
      </ul>
      <div className={`rounded-xl border border-[#26262C] bg-[#070708] p-3 transition-all duration-500 ${t > 1500 ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"}`}>
        <p className="m-0 text-sm font-medium">Sam Patel <span className="ml-1 rounded-full border border-[#26262C] px-2 py-0.5 align-middle text-[10px] text-[#9A9AA3]">From your school</span></p>
        <p className="m-0 mt-0.5 text-xs text-[#8B8B94]">Analytics Lead at Stripe · sam.patel@stripe.com</p>
        <p className="m-0 mt-2 text-xs leading-relaxed text-[#B4B4BC]">Hi Sam, I just applied to the Data Analyst Intern role and saw you&apos;re a Colby alum too…</p>
      </div>
    </div>
  );
}

const LETTER = "Dear Hiring Team, I'm applying for the Product Intern role at Duolingo. Last spring I ran user interviews for my school's course app and cut sign-up drop-off by a third, which is the kind of work your posting describes…";

function LetterPicture() {
  const t = useClock(5200);
  const typed = LETTER.slice(0, Math.max(0, Math.floor((t - 900) / 22)));
  return (
    <div className={`${card} grid gap-3 p-4 sm:grid-cols-[0.8fr_1.2fr]`}>
      <div className="flex flex-col gap-2 rounded-xl bg-[#070708] p-3 text-xs text-[#8B8B94]">
        <p className="m-0 font-mono text-[10px] uppercase tracking-[1px]">Job description</p>
        <p className="m-0 leading-relaxed">Run user research, turn findings into product changes, work with design…</p>
        <p className="m-0 mt-1 font-mono text-[10px] uppercase tracking-[1px]">Your resume</p>
        <p className="m-0 leading-relaxed">Course app, user interviews, sign-up drop-off down 33%…</p>
      </div>
      <div className="min-h-[150px] rounded-xl border border-[#26262C] bg-[#F7F7F8] p-3 text-[13px] leading-relaxed text-[#121214]">
        {typed}
        <span aria-hidden className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse bg-[#3D8BFF]" />
      </div>
    </div>
  );
}

function TimePicture() {
  const t = useClock(2400);
  const grow = Math.min(1, t / 2000);
  return (
    <div className={`${card} flex flex-col gap-5 p-5`}>
      <div>
        <div className="flex justify-between text-sm"><span className="text-[#B4B4BC]">Typing it yourself</span><span className="font-mono text-[#8B8B94]">~25 min</span></div>
        <div className="mt-2 h-3 rounded-full bg-[#17171B]"><div className="h-3 rounded-full bg-[#3A3A42]" style={{ width: `${grow * 100}%` }} /></div>
      </div>
      <div>
        <div className="flex justify-between text-sm"><span className="font-medium">With Unnepo</span><span className="font-mono text-[#3D8BFF]">~1 min</span></div>
        <div className="mt-2 h-3 rounded-full bg-[#17171B]"><div className="h-3 rounded-full bg-[#3D8BFF]" style={{ width: `${grow * 5}%`, minWidth: grow ? 10 : 0 }} /></div>
      </div>
      <p className="m-0 text-[13px] text-[#8B8B94]">Every field, dropdown, upload and Next button, from your profile and resume.</p>
    </div>
  );
}

function VaultPicture() {
  const t = useClock(2600);
  const copied = t > 1300;
  return (
    <div className={`${card} flex flex-col gap-3 p-4`}>
      <div className="flex items-center justify-between gap-3 rounded-xl border border-[#26262C] bg-[#070708] p-3">
        <span className="min-w-0">
          <span className="block text-xs text-[#8B8B94]">Job-site password</span>
          <span className="block font-mono text-sm tracking-[2px]">••••••••••••</span>
        </span>
        <span className={`flex-none rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${copied ? "bg-[#4ADE80] text-black" : "bg-[#3D8BFF] text-white"}`}>{copied ? "Copied ✓" : "Copy"}</span>
      </div>
      <div className="flex items-center justify-between gap-3 rounded-xl border border-[#26262C] bg-[#070708] p-3">
        <span className="flex min-w-0 items-center gap-3">
          <span aria-hidden className="flex h-9 w-8 flex-none items-center justify-center rounded-md bg-[#F87171] text-[10px] font-bold text-white">PDF</span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">Jordan Lee Resume.pdf</span>
            <span className="block text-xs text-[#8B8B94]">Attached to every application</span>
          </span>
        </span>
        <span className="flex-none text-xs text-[#4ADE80]">Ready</span>
      </div>
    </div>
  );
}

const FEATURES = [
  {
    kicker: "Tracker",
    title: "Every job you applied to, in one place.",
    body: "Unnepo logs each application the moment it's submitted. Then it lists 5 real people there (from your school, recruiters, and the team) with their emails and links, and drafts the follow-up.",
    picture: <TrackerPicture />,
  },
  {
    kicker: "Cover letters",
    title: "A cover letter written for this job.",
    body: "It reads the job description and your resume and writes a letter about what you've actually done that fits the role. Edit it, or download the PDF and attach it.",
    picture: <LetterPicture />,
  },
  {
    kicker: "Autofill",
    title: "Applications in about a minute, not 25.",
    body: "Press Fill and Unnepo does the typing on Workday, Greenhouse, Lever, Ashby and more. It cuts the time per application by up to 95%, and anything only you can answer gets flagged.",
    picture: <TimePicture />,
  },
  {
    kicker: "Always at hand",
    title: "Your passwords and resume, one click away.",
    body: "Every job site wants a new account. Unnepo keeps your job-site password in the extension and your resume ready to attach, so you never dig for either.",
    picture: <VaultPicture />,
  },
];

export function Features() {
  return (
    <section aria-labelledby="features-title" className="mx-auto flex w-full max-w-6xl flex-col gap-16 px-6 py-20">
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="m-0 font-mono text-xs uppercase tracking-[1.2px] text-[#8B8B94]">What it does</p>
        <h2 id="features-title" className="m-0 max-w-2xl text-[clamp(28px,4vw,40px)] font-bold leading-[1.05] tracking-[-1.2px]">Apply faster. Then actually hear back.</h2>
      </div>
      {FEATURES.map((feature, index) => (
        <article key={feature.kicker} className="grid items-center gap-8 md:grid-cols-2 md:gap-12">
          <div className={`flex flex-col gap-3 ${index % 2 ? "md:order-2" : ""}`}>
            <p className="m-0 font-mono text-xs uppercase tracking-[1.2px] text-[#3D8BFF]">{feature.kicker}</p>
            <h3 className="m-0 text-[clamp(24px,3vw,32px)] font-bold leading-[1.1] tracking-[-0.8px]">{feature.title}</h3>
            <p className="m-0 max-w-md text-[15px] leading-relaxed text-[#9A9AA3]">{feature.body}</p>
          </div>
          <div className={index % 2 ? "md:order-1" : ""}>{feature.picture}</div>
        </article>
      ))}
    </section>
  );
}
