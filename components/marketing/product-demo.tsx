"use client";

import { useEffect, useState } from "react";

/**
 * An animated look at Unnepo on a job application, for the home page: the form fills itself in, the
 * resume attaches, the dropdowns get picked, it's submitted, and three people to email show up. A made-up
 * applicant and company. With reduced motion it shows the finished form and doesn't move.
 */

type Field = { label: string; value: string; kind: "text" | "file" | "select"; at: number };

// When each field starts filling (ms), and how it looks once filled.
const FIELDS: Field[] = [
  { label: "First name", value: "Jordan", kind: "text", at: 900 },
  { label: "Last name", value: "Lee", kind: "text", at: 1500 },
  { label: "Email", value: "jordan.lee@school.edu", kind: "text", at: 2000 },
  { label: "Resume / CV", value: "Jordan Lee Resume.pdf", kind: "file", at: 3100 },
  { label: "Are you authorized to work in the US?", value: "Yes", kind: "select", at: 3700 },
  { label: "Will you need sponsorship?", value: "No", kind: "select", at: 4200 },
  { label: "Why do you want to work here?", value: "I built a line-following robot for my engineering club…", kind: "text", at: 4700 },
];
const TYPE_MS = 28;
const SUBMIT_AT = 6800;
const DONE_AT = 7600;
const LOOP_AT = 12500;

const STEPS: Array<[number, string]> = [
  [0, "Found an application on Greenhouse."],
  [800, "Filling it in from your profile…"],
  [3100, "Attaching your resume…"],
  [4700, "Answering from your own experience…"],
  [SUBMIT_AT, "Submitting…"],
  [DONE_AT, "Submitted! Here's who to email."],
];

const PEOPLE = [
  ["Sam Patel", "Recruiter"],
  ["Ava Chen", "Hiring manager"],
  ["Marcus Reid", "Engineer on the team"],
];

function shown(field: Field, t: number) {
  if (t < field.at) return "";
  if (field.kind !== "text") return field.value;
  return field.value.slice(0, Math.floor((t - field.at) / TYPE_MS));
}

export function ProductDemo() {
  const [t, setT] = useState(0);
  const [still, setStill] = useState(false);

  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- a still frame for reduced motion
      setStill(true);
      setT(DONE_AT);
      return;
    }
    const started = performance.now();
    const timer = setInterval(() => setT((performance.now() - started) % LOOP_AT), 50);
    return () => clearInterval(timer);
  }, []);

  const step = [...STEPS].reverse().find(([at]) => t >= at)?.[1] ?? STEPS[0][1];
  const filled = FIELDS.filter((field) => shown(field, t) === field.value).length;
  const done = t >= DONE_AT;
  const pressing = t >= SUBMIT_AT && t < DONE_AT;

  return (
    <section aria-label="Unnepo filling in an application" className="mx-auto w-full max-w-5xl px-4 sm:px-6">
      <p className="sr-only">A short animation: Unnepo fills in a job application from the student&apos;s profile, attaches their resume, answers the questions, submits it, and lists three people at the company to email.</p>
      <div aria-hidden className="grid gap-4 md:grid-cols-[minmax(0,1fr)_260px]">
        {/* The job site */}
        <div className="overflow-hidden rounded-2xl border border-[#26262C] bg-[#F7F7F8] text-[#16161A] shadow-[12px_12px_0_#17171B]">
          <div className="flex items-center gap-2 border-b border-[#E3E3E8] bg-[#ECECF0] px-4 py-2.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[#FF5F57]" /><span className="h-2.5 w-2.5 rounded-full bg-[#FEBC2E]" /><span className="h-2.5 w-2.5 rounded-full bg-[#28C840]" />
            <span className="ml-3 flex-1 truncate rounded-md bg-white px-3 py-1 font-mono text-[11px] text-[#6B6B74]">job-boards.greenhouse.io/northwind/jobs/4021</span>
          </div>
          {done ? (
            <div className="flex min-h-[420px] flex-col items-center justify-center gap-3 px-6 py-10 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#DCFCE7] text-2xl text-[#15803D]">✓</span>
              <p className="m-0 text-xl font-bold">Application submitted</p>
              <p className="m-0 text-sm text-[#6B6B74]">Thanks for applying to Northwind Robotics, Jordan.</p>
            </div>
          ) : (
            <div className="flex min-h-[420px] flex-col gap-3 px-5 py-5 sm:px-7">
              <div>
                <p className="m-0 text-lg font-bold">Robotics Engineering Intern</p>
                <p className="m-0 text-xs text-[#6B6B74]">Northwind Robotics · Boston, MA</p>
              </div>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {FIELDS.map((field) => {
                  const value = shown(field, t);
                  const active = value && value !== field.value;
                  const wide = field.kind === "select" || field.label.startsWith("Why") || field.kind === "file";
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
              <span className={`mt-auto self-start rounded-md px-4 py-2 text-sm font-semibold text-white transition-transform ${pressing ? "scale-95 bg-[#1E40AF]" : "bg-[#2563EB]"}`}>Submit application</span>
            </div>
          )}
        </div>

        {/* The Unnepo panel */}
        <div className="flex flex-col gap-3 rounded-2xl border border-[#1F1F24] bg-[#0C0C0E] p-4 text-[#F7F7F8]">
          <div className="flex items-center justify-between">
            <span className="text-base font-bold tracking-[-0.4px]">unnepo<span className="text-[#3D8BFF]">.</span></span>
            <span className="font-mono text-[10px] text-[#8B8B94]">{still ? "" : `${Math.min(filled, FIELDS.length)}/${FIELDS.length}`}</span>
          </div>
          <div className="border-[3px] border-[#070708] bg-[#F7F7F8] p-3 font-[family-name:var(--font-pixel)] text-[8px] leading-[1.9] text-[#070708] shadow-[0_0_0_3px_#F7F7F8]">{step}</div>
          <div className="grid grid-cols-[repeat(14,minmax(0,1fr))] gap-[3px]">
            {Array.from({ length: 14 }, (_, index) => <span key={index} className={`h-1.5 ${index < Math.round((filled / FIELDS.length) * 14) ? "bg-[#3D8BFF]" : "bg-[#1F1F24]"}`} />)}
          </div>
          {done && (
            <div className="flex flex-col gap-2">
              <p className="m-0 font-mono text-[10px] uppercase tracking-[1.4px] text-[#8B8B94]">People to email</p>
              {PEOPLE.map(([name, role]) => (
                <div key={name} className="flex items-center gap-2.5 rounded-lg border border-[#1F1F24] bg-[#111114] px-2.5 py-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#1F1F24] text-[11px] font-semibold text-[#B4B4BC]">{name.split(" ").map((part) => part[0]).join("")}</span>
                  <span className="min-w-0"><span className="block truncate text-[13px] font-medium">{name}</span><span className="block text-[11px] text-[#8B8B94]">{role} · email drafted</span></span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
