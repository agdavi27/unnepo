import { classifyQuestion } from "@/lib/apply/questions";
import type { BeginResult, ComplexQuestion, FileData, JobDetails, PageField } from "../shared/types";
import { H, spiderRects, storedSpiderColors, W } from "../shared/sprite";
import { typeInto } from "./dom";
import { uploadResumeNow } from "./generic";
import { findMarked, isEmpty, openedJob, scanFields, scanPage, structuredJobs } from "./scan";

/**
 * The job box and "Begin applying" in the panel. Three things happen on the page:
 * - jobDetails(): everything Unnepo can read about the job on the tab, for the box above "Write a cover letter".
 * - beginApplying(): the resume goes into the upload boxes at once, and every complex question (the ones that
 *   need a written answer, not a name or a dropdown) gets a little spider beside it. As the form moves on to
 *   its next step, new upload boxes and questions get the same, without pressing anything again.
 * - putAnswer(): an answer written in the panel is typed into its box, and that box's spider leaves.
 * Nothing here presses a button or submits anything.
 */


const clean = (text: unknown) => String(text ?? "").replace(/\s+/g, " ").trim();

/** The extra facts posting data carries (place, pay, kind of job, date posted), for the job that's open. */
function postingFacts(title: string) {
  const raw: Array<Record<string, unknown>> = [];
  const collect = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === "object") {
      const item = value as Record<string, unknown>;
      const type = item["@type"];
      if (type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"))) raw.push(item);
      if (item["@graph"]) collect(item["@graph"]);
    }
  };
  for (const script of Array.from(document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]'))) {
    try { collect(JSON.parse(script.textContent || "")); } catch { /* not JSON */ }
  }
  const job = raw.find((item) => clean(item.title).toLowerCase() === title.toLowerCase()) ?? (raw.length === 1 ? raw[0] : null);
  if (!job) return { location: "", pay: "", type: "", posted: "", remote: "" };
  const places = (Array.isArray(job.jobLocation) ? job.jobLocation : [job.jobLocation]).map((place) => {
    const address = ((place as Record<string, unknown> | undefined)?.address ?? {}) as Record<string, unknown>;
    return [address.addressLocality, address.addressRegion].map(clean).filter(Boolean).join(", ");
  }).filter(Boolean);
  const salary = (job.baseSalary ?? {}) as Record<string, unknown>;
  const value = (salary.value ?? {}) as Record<string, unknown>;
  const money = (amount: unknown) => (Number(amount) ? `$${Number(amount).toLocaleString("en-US")}` : "");
  const low = money(value.minValue ?? value.value);
  const high = money(value.maxValue);
  const unit = clean(value.unitText).toLowerCase();
  const per: Record<string, string> = { hour: "/hr", year: "/yr", month: "/mo", week: "/wk", day: "/day" };
  const pay = low ? `${low}${high && high !== low ? `–${high}` : ""}${per[unit] ?? ""}` : "";
  const type = (Array.isArray(job.employmentType) ? job.employmentType : [job.employmentType]).map((kind) => clean(kind).replace(/_/g, " ").toLowerCase()).filter(Boolean).join(", ");
  // "2026-11-01" is that day where the job is, not midnight in London.
  const day = clean(job.datePosted);
  const posted = day ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(day) ? `${day}T12:00:00` : day).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
  return { location: [...new Set(places)].slice(0, 3).join(" · "), pay, type, posted: posted === "Invalid Date" ? "" : posted, remote: job.jobLocationType === "TELECOMMUTE" ? "Remote" : "" };
}

/** Pay and place from the posting's own words, when there's no posting data. */
function factsFromText(text: string) {
  const pay = text.match(/\$\s?\d[\d,.]*\s?[kK]?(?:\s?(?:-|–|to)\s?\$?\s?\d[\d,.]*\s?[kK]?)?\s?(?:\/|per |an |a )?\s?(?:hour|hr|year|yr|annually|month)\b/i)?.[0] ?? "";
  const remote = /\b(fully remote|remote[- ]first|100% remote)\b/i.test(text) ? "Remote" : /\bhybrid\b/i.test(text) ? "Hybrid" : "";
  const type = text.match(/\b(full[- ]time|part[- ]time|internship|co-?op|contract|temporary|seasonal)\b/i)?.[0].toLowerCase() ?? "";
  return { pay: clean(pay), remote, type };
}

export function jobDetails(): JobDetails {
  const opened = openedJob();
  const scan = scanPage();
  const title = opened.title || scan.title;
  const company = opened.company || scan.company;
  const description = (opened.description || scan.description || structuredJobs()[0]?.description || "").slice(0, 8000);
  const facts = postingFacts(title);
  const fromText = factsFromText(description || (document.body.innerText || "").slice(0, 20000));
  const fields = scanFields();
  const host = location.hostname.replace(/^www\./, "");
  return {
    title, company, description, url: opened.url || location.href, from: opened.from,
    location: facts.location, pay: facts.pay || fromText.pay, type: facts.type || fromText.type, posted: facts.posted, remote: facts.remote || fromText.remote,
    site: host, questions: fields.filter((field) => field.type !== "file").length,
    uploads: fields.filter((field) => field.type === "file").length,
    resumeBox: fields.some((field) => field.type === "file" && !/cover ?letter|transcript|portfolio|writing sample/i.test(`${field.label} ${field.section}`)),
  };
}

/** Questions a profile can't answer: written answers, not name, email, dates, links or yes/no. */
const QUESTION_WORDS = /\b(why|how|what|describe|tell us|explain|share|walk us|give an example|example of|talk about|discuss|elaborate|in your own words|motivat|interest(s|ed)? you|excit|challenge|proud|accomplish|strength|weakness|goal|hope to|would you|have you ever|a time when|cover letter|additional information|anything else)\b/i;
const BASIC = /\b(first|last|full|preferred|legal|middle) ?name\b|^name\b|e-?mail|phone|mobile|address|city|state|zip|postal|country|linked ?in|github|portfolio|website|\burl\b|salary|compensation|pay\b|start date|date|gpa|school|university|college|degree|major|minor|graduat|year|pronoun|referr(ed|al)|how did you hear|source|sponsor|authori[sz]ed|visa|relocat|citizen|clearance|age\b|18\b/i;

export function complexQuestions(fields: PageField[] = scanFields()): PageField[] {
  return fields.filter((field) => {
    if (field.type !== "textarea" && field.type !== "text") return false;
    const label = field.label.trim();
    if (label.length < 8 || classifyQuestion(label).sensitive || classifyQuestion(label).field) return false;
    if (field.type === "textarea") return !BASIC.test(label) || QUESTION_WORDS.test(label);
    // A one-line box counts when it plainly asks for a written answer.
    return label.length >= 30 && QUESTION_WORDS.test(label) && !BASIC.test(label);
  });
}

/* ---------- The little spiders beside each complex question ---------- */

let layer: HTMLDivElement | null = null;
let layerRoot: ShadowRoot | null = null;
const markers = new Map<string, HTMLDivElement>();
let frames = [spiderRects(0), spiderRects(1)];
void storedSpiderColors().then((colors) => { frames = [spiderRects(0, colors), spiderRects(1, colors)]; });
let placing = 0;

function ensureLayer() {
  if (layer?.isConnected && layerRoot) return layerRoot;
  layer = document.createElement("div");
  layer.setAttribute("data-unnepo-question-spiders", "");
  layer.setAttribute("aria-hidden", "true");
  layerRoot = layer.attachShadow({ mode: "open" });
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  layerRoot.innerHTML = `<style>
    :host { all: initial; position: absolute; left: 0; top: 0; width: 0; height: 0; z-index: 2147483645; pointer-events: none; }
    .q { position: absolute; width: 26px; height: ${Math.round((26 * H) / W)}px; filter: drop-shadow(1px 2px 0 rgba(0,0,0,.2)); transition: opacity .3s; }
    .q svg { display: block; width: 100%; height: 100%; transform: rotate(180deg); }
    .q .thread { position: absolute; left: 12px; bottom: 100%; width: 2px; height: 14px; background: #2B2531; opacity: .55; }
    .q g + g { display: none; }
    ${still ? "" : `
    .q { animation: bob 1.6s ease-in-out infinite; }
    .q svg g { animation: legs .36s steps(1) infinite; }
    .q svg g + g { display: block; animation: legs2 .36s steps(1) infinite; }
    @keyframes bob { 0%, 100% { transform: translate(0, 0); } 25% { transform: translate(-3px, 2px); } 50% { transform: translate(0, 4px); } 75% { transform: translate(3px, 2px); } }
    @keyframes legs { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
    @keyframes legs2 { 0%, 49% { opacity: 0; } 50%, 100% { opacity: 1; } }`}
    .q.done { opacity: 0; }
  </style>`;
  document.documentElement.appendChild(layer);
  window.addEventListener("scroll", schedulePlace, { passive: true, capture: true });
  window.addEventListener("resize", schedulePlace, { passive: true });
  return layerRoot;
}

/** The box a question's spider sits beside: the question's own control. */
function controlFor(id: string) {
  const el = findMarked(id);
  if (!el) return null;
  return el.matches("input, textarea, select") ? el : el.querySelector<HTMLElement>("input, textarea") ?? el;
}

function place() {
  placing = 0;
  for (const [id, marker] of markers) {
    const control = controlFor(id);
    const box = control?.getBoundingClientRect();
    if (!control || !box || box.height === 0) { marker.style.display = "none"; continue; }
    marker.style.display = "";
    // Just above the box's top right corner, hanging on a short thread.
    // Kept inside the window, so a box that runs to its edge still shows its spider.
    marker.style.left = `${Math.round(Math.min(box.right - 30, document.documentElement.clientWidth - 34) + scrollX)}px`;
    marker.style.top = `${Math.round(box.top + scrollY - 20)}px`;
  }
}
function schedulePlace() {
  if (!placing) placing = requestAnimationFrame(place);
}

function markQuestion(field: PageField) {
  if (markers.has(field.id)) return;
  const root = ensureLayer();
  const marker = document.createElement("div");
  marker.className = "q";
  marker.innerHTML = `<div class="thread"></div><svg viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges"><g>${frames[0]}</g><g>${frames[1]}</g></svg>`;
  root.appendChild(marker);
  markers.set(field.id, marker);
}

function unmarkQuestion(id: string) {
  const marker = markers.get(id);
  if (!marker) return;
  markers.delete(id);
  marker.classList.add("done");
  setTimeout(() => marker.remove(), 350);
}

export function clearQuestionSpiders() {
  for (const id of [...markers.keys()]) unmarkQuestion(id);
  observer?.disconnect();
  observer = null;
  applyingResume = null;
}

/* ---------- Begin applying ---------- */

let applyingResume: FileData | null = null;
let observer: MutationObserver | null = null;
let rerun = 0;
let onChange: ((result: BeginResult) => void) | null = null;

function pass(): BeginResult {
  const fields = scanFields();
  const uploaded = applyingResume ? uploadResumeNow(fields, applyingResume) : [];
  const found = complexQuestions(fields);
  const live = new Set(found.map((field) => field.id));
  for (const id of [...markers.keys()]) if (!live.has(id)) unmarkQuestion(id);
  const questions = found.map((field) => {
    const control = controlFor(field.id);
    const answered = Boolean(control && !isEmpty(control));
    // A question the student (or Unnepo) already answered doesn't need a spider.
    if (answered) unmarkQuestion(field.id);
    else markQuestion(field);
    return { id: field.id, label: field.label, required: field.required, answered };
  });
  schedulePlace();
  return { uploaded, questions: questions satisfies ComplexQuestion[], resumeBox: fields.some((field) => field.type === "file") };
}

/**
 * Uploads the resume and marks the complex questions now, then again whenever the form changes (the next
 * step of a multi-page application, or an upload box that shows up late). `changed` hears about later passes.
 */
export function beginApplying(resume: FileData | null, changed: (result: BeginResult) => void): BeginResult {
  applyingResume = resume;
  onChange = changed;
  const first = pass();
  observer?.disconnect();
  observer = new MutationObserver((records) => {
    // Our own spiders moving aren't a change to the form.
    if (records.every((record) => layer && (record.target === layer || layer.contains(record.target as Node)))) return;
    clearTimeout(rerun);
    rerun = window.setTimeout(() => {
      const before = [...markers.keys()].join("|");
      const result = pass();
      if (result.uploaded.length || [...markers.keys()].join("|") !== before) onChange?.(result);
    }, 700);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  // Stops watching after half an hour: an application left open isn't still being filled.
  setTimeout(() => { observer?.disconnect(); observer = null; }, 30 * 60_000);
  return first;
}

/** Types an answer from the panel into its box. Only into an empty box, unless `replace`. */
export function putAnswer(id: string, text: string, replace = false) {
  const control = controlFor(id);
  if (!(control instanceof HTMLTextAreaElement || control instanceof HTMLInputElement)) return { ok: false, reason: "That question isn't on the page any more." };
  if (!replace && control.value.trim()) return { ok: false, reason: "That box already has an answer." };
  typeInto(control, text);
  unmarkQuestion(id);
  return { ok: Boolean(control.value.trim()), reason: "" };
}

/** Scrolls to a complex question so the student can see it. */
export function showQuestion(id: string) {
  const control = controlFor(id);
  if (!control) return false;
  control.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  setTimeout(() => control.focus({ preventScroll: true }), 300);
  return true;
}
