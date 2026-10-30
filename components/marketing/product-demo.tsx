"use client";

import { useEffect, useState } from "react";
import { heroSpiderSvg } from "@/extension/src/shared/hero-spider";
import { H as SPRITE_H, W as SPRITE_W, spiderRects } from "@/extension/src/shared/sprite";

/**
 * An animated look at Unnepo on a job application, laid out like the real thing: the job site on the
 * left with spiders crawling over it while it fills, and the extension's side panel on the right (the
 * talking spider, the "On this page" card, the pixel Fill button, the cover letter writer, the profile).
 * A made-up applicant and company. With reduced motion it shows the finished state and doesn't move.
 */

type Field = { label: string; value: string; kind: "text" | "file" | "select"; at: number };

const FIELDS: Field[] = [
  { label: "First name", value: "Jordan", kind: "text", at: 1600 },
  { label: "Last name", value: "Lee", kind: "text", at: 2100 },
  { label: "Email", value: "jordan.lee@school.edu", kind: "text", at: 2500 },
  { label: "Resume / CV", value: "Jordan Lee Resume.pdf", kind: "file", at: 3500 },
  { label: "Are you authorized to work in the US?", value: "Yes", kind: "select", at: 4100 },
  { label: "Will you need sponsorship?", value: "No", kind: "select", at: 4600 },
  { label: "Why do you want to work here?", value: "I built a line-following robot for my engineering club…", kind: "text", at: 5100 },
];
const TYPE_MS = 28;
const PRESS_AT = 900;
const SUBMIT_AT = 7300;
const DONE_AT = 8100;
const LOOP_AT = 13500;

// What the spider says, in the panel's speech bubble.
const LINES: Array<[number, string]> = [
  [0, "Found a job on Greenhouse. Robotics Engineering Intern."],
  [PRESS_AT, "Filling the form…"],
  [3500, "Attaching your resume…"],
  [5100, "Answering from your own experience…"],
  [SUBMIT_AT, "Submitting…"],
  [DONE_AT, "Submitted. The site accepted your application."],
];

const PEOPLE = [["Sam Patel", "Recruiter"], ["Ava Chen", "Hiring manager"], ["Marcus Reid", "Engineer on the team"]];

const HERO = heroSpiderSvg();
const CRAWLER = `<svg viewBox="0 0 ${SPRITE_W} ${SPRITE_H}" width="100%" height="100%" shape-rendering="crispEdges">${spiderRects(0)}</svg>`;

function shown(field: Field, t: number) {
  if (t < field.at) return "";
  if (field.kind !== "text") return field.value;
  return field.value.slice(0, Math.floor((t - field.at) / TYPE_MS));
}

export function ProductDemo({ id }: { id?: string }) {
  const [t, setT] = useState(0);

  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- a still frame for reduced motion
      setT(DONE_AT);
      return;
    }
    const started = performance.now();
    const timer = setInterval(() => setT((performance.now() - started) % LOOP_AT), 50);
    return () => clearInterval(timer);
  }, []);

  const line = [...LINES].reverse().find(([at]) => t >= at)?.[1] ?? LINES[0][1];
  const typedLine = line.slice(0, Math.max(0, Math.floor((t - ([...LINES].reverse().find(([at]) => t >= at)?.[0] ?? 0)) / 35)));
  const talking = typedLine.length < line.length;
  const filled = FIELDS.filter((field) => shown(field, t) === field.value).length;
  const running = t >= PRESS_AT && t < DONE_AT;
  const done = t >= DONE_AT;
  const pressing = t >= PRESS_AT - 200 && t < PRESS_AT;

  return (
    <section id={id} aria-label="Unnepo filling in an application" className="mx-auto w-full max-w-6xl scroll-mt-8 px-4 sm:px-6">
      <style>{`
        @keyframes demo-crawl-a { 0% { left: 6%; top: 18%; transform: rotate(120deg) } 30% { left: 52%; top: 46%; transform: rotate(160deg) } 60% { left: 28%; top: 74%; transform: rotate(250deg) } 100% { left: 80%; top: 14%; transform: rotate(30deg) } }
        @keyframes demo-crawl-b { 0% { left: 84%; top: 70%; transform: rotate(-60deg) } 40% { left: 40%; top: 30%; transform: rotate(-20deg) } 70% { left: 66%; top: 52%; transform: rotate(80deg) } 100% { left: 12%; top: 58%; transform: rotate(200deg) } }
        @keyframes demo-crawl-c { 0% { left: 44%; top: 8%; transform: rotate(180deg) } 50% { left: 18%; top: 42%; transform: rotate(220deg) } 100% { left: 76%; top: 84%; transform: rotate(140deg) } }
        @keyframes demo-legs { 50% { transform: scaleX(.92) } }
        .demo-crawler { position: absolute; left: 0; top: 0; width: 34px; height: ${Math.round((34 * SPRITE_H) / SPRITE_W)}px; animation-duration: 6.5s; animation-timing-function: linear; animation-iteration-count: infinite; animation-direction: alternate; filter: drop-shadow(2px 3px 0 rgba(0,0,0,.18)); }
        .demo-crawler svg { animation: demo-legs .22s steps(2) infinite; }
        .demo-bob { animation: demo-bob 2.8s steps(3) infinite; }
        @keyframes demo-bob { 50% { transform: translateY(5px) } }
        .demo-talking .mouth-open { display: inline } .demo-talking .mouth-shut { display: none }
        .demo-spider .mouth-open { display: none }
        .demo-talking.demo-spider .mouth-open { display: inline }
        @media (prefers-reduced-motion: reduce) { .demo-crawler, .demo-bob, .demo-crawler svg { animation: none } }
      `}</style>
      <p className="sr-only">A short animation: on a job application, the Unnepo panel says what it&apos;s doing while the form fills in from the student&apos;s profile, the resume attaches, the questions get answered, and it&apos;s submitted. Then three people at the company to email appear.</p>
      <div aria-hidden className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* The job site */}
        <div className="relative overflow-hidden rounded-2xl border border-[#26262C] bg-[#F7F7F8] text-[#16161A] shadow-[12px_12px_0_#17171B]">
          <div className="flex items-center gap-2 border-b border-[#E3E3E8] bg-[#ECECF0] px-4 py-2.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[#FF5F57]" /><span className="h-2.5 w-2.5 rounded-full bg-[#FEBC2E]" /><span className="h-2.5 w-2.5 rounded-full bg-[#28C840]" />
            <span className="ml-3 flex-1 truncate rounded-md bg-white px-3 py-1 font-mono text-[11px] text-[#6B6B74]">job-boards.greenhouse.io/northwind/jobs/4021</span>
          </div>
          {done ? (
            <div className="flex min-h-[470px] flex-col items-center justify-center gap-3 px-6 py-10 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#DCFCE7] text-2xl text-[#15803D]">✓</span>
              <p className="m-0 text-xl font-bold">Application submitted</p>
              <p className="m-0 text-sm text-[#6B6B74]">Thanks for applying to Northwind Robotics, Jordan.</p>
            </div>
          ) : (
            <div className="flex min-h-[470px] flex-col gap-3 px-5 py-5 sm:px-7">
              <div>
                <p className="m-0 text-lg font-bold">Robotics Engineering Intern</p>
                <p className="m-0 text-xs text-[#6B6B74]">Northwind Robotics · Boston, MA</p>
              </div>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {FIELDS.map((field) => {
                  const value = shown(field, t);
                  const active = value && value !== field.value;
                  const wide = field.kind !== "text" || field.label.startsWith("Why");
                  return (
                    <div key={field.label} className={wide ? "sm:col-span-2" : ""}>
                      <p className="m-0 mb-1 text-[11px] font-medium text-[#4A4A52]">{field.label}<span className="text-[#C2410C]">*</span></p>
                      <div className={`flex min-h-9 items-center rounded-md border bg-white px-2.5 text-[13px] transition-colors ${active ? "border-[#3D8BFF] ring-2 ring-[#3D8BFF]/25" : value ? "border-[#CFCFD6]" : "border-[#DCDCE2]"}`}>
                        {field.kind === "file" && value ? <span className="rounded bg-[#EEF4FF] px-2 py-0.5 text-[12px] text-[#1D4ED8]">📄 {value}</span>
                          : field.kind === "select" ? <span className={value ? "" : "text-[#9A9AA3]"}>{value || "Select…"}</span>
                            : <span className="truncate">{value}{active && <span className="ml-px inline-block h-3.5 w-px animate-pulse bg-[#16161A] align-middle" />}</span>}
                        {field.kind === "select" && <span className="ml-auto text-[10px] text-[#9A9AA3]">▼</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
              <span className={`mt-auto self-start rounded-md px-4 py-2 text-sm font-semibold text-white transition-transform ${t >= SUBMIT_AT ? "scale-95 bg-[#1E40AF]" : "bg-[#2563EB]"}`}>Submit application</span>
            </div>
          )}
          {/* While Unnepo works, spiders crawl the page, like the real extension. */}
          {running && (
            <div className="pointer-events-none absolute inset-0 top-10">
              {["demo-crawl-a", "demo-crawl-b", "demo-crawl-c"].map((name, index) => (
                <span key={name} className="demo-crawler" style={{ animationName: name, animationDelay: `${-index * 1.7}s` }} dangerouslySetInnerHTML={{ __html: CRAWLER }} />
              ))}
            </div>
          )}
        </div>

        {/* The Unnepo side panel, as it looks in Chrome */}
        <div className="flex flex-col overflow-hidden rounded-2xl border border-[#1F1F24] bg-[#070708] text-[#F7F7F8]">
          <div className="flex items-center justify-between border-b border-[#17171B] px-4 py-3">
            <span className="text-[17px] font-bold tracking-[-0.5px]">unnepo<span className="text-[#3D8BFF]">.</span></span>
            <span className="font-mono text-[10px] text-[#8B8B94]">jordan.lee@school.edu</span>
          </div>
          <div className="flex items-end gap-3 px-4 pb-4">
            <div className={`demo-bob demo-spider relative mt-8 h-[45px] w-[60px] flex-none ${talking ? "demo-talking" : ""}`}>
              <div className="absolute bottom-[calc(100%-4px)] left-[29px] h-8 w-[2px] bg-[#3A3A44]" />
              <div className="relative [&_svg]:h-[45px] [&_svg]:w-[60px]" dangerouslySetInnerHTML={{ __html: HERO }} />
            </div>
            <div className="mt-4 flex min-w-0 flex-1 flex-col">
              <span className="relative z-[1] mb-[-5px] ml-2 self-start border-[3px] border-[#070708] bg-[#3D8BFF] px-1.5 pb-1 pt-1.5 font-[family-name:var(--font-pixel)] text-[7px] text-white shadow-[0_0_0_3px_#F7F7F8]">UNNEPO</span>
              <div className="min-h-[78px] border-[3px] border-[#070708] bg-[#F7F7F8] px-3 pb-3 pt-3.5 font-[family-name:var(--font-pixel)] text-[8px] leading-[1.9] text-[#070708] shadow-[0_0_0_3px_#F7F7F8,6px_6px_0_3px_#1E1E26]">{typedLine}</div>
            </div>
          </div>
          <div className="mx-4 flex flex-col gap-3 rounded-[14px] border border-[#1F1F24] bg-[#0C0C0E] p-4">
            <span className="font-mono text-[10px] tracking-[1.4px] text-[#8B8B94]">ON THIS PAGE · GREENHOUSE</span>
            <div>
              <p className="m-0 text-[15px] font-semibold leading-tight">Robotics Engineering Intern</p>
              <p className="m-0 text-xs text-[#8B8B94]">Northwind Robotics</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <span className="rounded-md border border-[#26262C] px-1.5 py-0.5 font-mono text-[10px] text-[#B4B4BC]">{t < PRESS_AT ? `${FIELDS.length} FIELDS` : `${filled} FILLED`}</span>
              {done && <span className="rounded-md border border-[#26262C] px-1.5 py-0.5 font-mono text-[10px] text-[#B4B4BC]">SUBMITTED</span>}
            </div>
            <span className={`flex h-11 items-center justify-center border-[3px] border-[#070708] bg-[#F7F7F8] font-[family-name:var(--font-pixel)] text-[9px] text-[#070708] transition-transform ${running ? "shadow-[4px_4px_0_#F87171]" : "shadow-[4px_4px_0_#3D8BFF]"} ${pressing ? "translate-x-1 translate-y-1 shadow-none" : ""}`}>
              {running ? "STOP" : done ? "FILL AGAIN" : "FILL THIS APPLICATION"}
            </span>
            <span className="flex h-10 items-center gap-2 rounded-[10px] border border-[#2B3B5C] bg-[#3D8BFF]/10 px-3 text-[13px] font-medium">
              <span className="text-[#3D8BFF]">✦</span>Write cover letter
            </span>
          </div>
          {done ? (
            <div className="flex flex-col gap-2 px-4 py-4">
              <span className="font-mono text-[10px] tracking-[1.4px] text-[#8B8B94]">PEOPLE TO EMAIL</span>
              {PEOPLE.map(([name, role]) => (
                <div key={name} className="flex items-center gap-2.5 rounded-lg border border-[#1F1F24] bg-[#0C0C0E] px-2.5 py-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#1F1F24] text-[11px] font-semibold text-[#B4B4BC]">{name.split(" ").map((part) => part[0]).join("")}</span>
                  <span className="min-w-0"><span className="block truncate text-[13px] font-medium">{name}</span><span className="block text-[11px] text-[#8B8B94]">{role} · email drafted</span></span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-2 px-4 py-4">
              <div className="flex items-baseline justify-between"><span className="text-[13px] font-semibold">Your profile</span><span className="font-mono text-[10px] text-[#8B8B94]">92% READY</span></div>
              <div className="grid grid-cols-[repeat(20,minmax(0,1fr))] gap-[2px]">{Array.from({ length: 20 }, (_, index) => <span key={index} className={`h-1.5 ${index < 18 ? "bg-[#3D8BFF]" : "bg-[#1F1F24]"}`} />)}</div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
