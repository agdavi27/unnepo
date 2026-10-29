import { createHash } from "node:crypto";
import { serverConfig } from "@/lib/config";
import { id, nowIso, readAnthropicKey, repo } from "@/lib/db/file-store";
import { bestOption } from "@/lib/apply/options";
import { supportedBy } from "@/lib/apply/questions";

/**
 * The resume read once into fields an application asks for: contact details, every school and job in
 * order, and skills. Each value is kept only if it appears in the resume text, so nothing is invented.
 * Forms then fill from these fields directly, without an AI call per question.
 */
export type ResumeProfile = {
  sourceHash: string;
  contact: { phone: string; email: string; addressLine1: string; city: string; state: string; postalCode: string; country: string; linkedin: string; github: string; website: string };
  education: Array<{ school: string; degree: string; field: string; gpa: string; start: string; end: string; location: string }>;
  experience: Array<{ title: string; company: string; location: string; start: string; end: string; current: boolean; summary: string }>;
  skills: string[];
};

export function resumeHash(text: string) {
  return createHash("sha256").update(text).digest("hex").slice(0, 32);
}

export const RESUME_PROMPT = `Read a college student's resume into JSON for job application forms. Copy every value exactly as the resume writes it (same spelling, same date wording). Leave a value as "" when the resume doesn't state it. Never infer, expand, or invent anything.
Schema:
{"contact":{"phone":"","email":"","addressLine1":"","city":"","state":"","postalCode":"","country":"","linkedin":"","github":"","website":""},
"education":[{"school":"","degree":"","field":"","gpa":"","start":"","end":"","location":""}],
"experience":[{"title":"","company":"","location":"","start":"","end":"","current":false,"summary":""}],
"skills":[""]}
- education and experience: every entry, most recent first. degree is the degree as written ("B.A.", "Bachelor of Science"); field is the major as written.
- end: the end date as written, or "Present" if the resume says so (then current is true). An expected graduation ("Expected May 2027") goes in end as written.
- summary: the entry's first bullet, copied exactly, or "".
- skills: up to 25, as written.
Return only the JSON.`;

const blankContact = (): ResumeProfile["contact"] => ({ phone: "", email: "", addressLine1: "", city: "", state: "", postalCode: "", country: "", linkedin: "", github: "", website: "" });

/** Drops any value the resume doesn't actually contain. Exported for tests. */
export function keepStated(raw: unknown, resumeText: string, sourceHash: string): ResumeProfile {
  const stated = (value: unknown, max = 200) => {
    const clean = String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
    return clean && supportedBy(clean, resumeText) ? clean : "";
  };
  const data = (raw ?? {}) as Partial<Record<keyof ResumeProfile, unknown>>;
  const contactIn = (data.contact ?? {}) as Record<string, unknown>;
  const contact = blankContact();
  for (const key of Object.keys(contact) as Array<keyof ResumeProfile["contact"]>) contact[key] = stated(contactIn[key]);
  const list = (value: unknown) => (Array.isArray(value) ? value.slice(0, 12) as Array<Record<string, unknown>> : []);
  const education = list(data.education)
    .map((item) => ({ school: stated(item.school), degree: stated(item.degree, 120), field: stated(item.field, 120), gpa: stated(item.gpa, 10), start: stated(item.start, 40), end: stated(item.end, 40), location: stated(item.location, 80) }))
    .filter((item) => item.school);
  const experience = list(data.experience)
    .map((item) => {
      const end = stated(item.end, 40);
      return { title: stated(item.title, 120), company: stated(item.company, 120), location: stated(item.location, 80), start: stated(item.start, 40), end, current: /present|current|now/i.test(end), summary: stated(item.summary, 600) };
    })
    .filter((item) => item.title || item.company);
  const skills = (Array.isArray(data.skills) ? data.skills : []).map((skill) => stated(skill, 60)).filter(Boolean).slice(0, 25);
  return { sourceHash, contact, education, experience, skills };
}

/** One model call per resume. Null when there's no resume text or AI isn't set up. */
export async function readResumeProfile(userId: string, resumeText: string): Promise<ResumeProfile | null> {
  if (resumeText.trim().length < 80) return null;
  const apiKey = await readAnthropicKey();
  if (!apiKey) return null;
  const config = serverConfig();
  const model = process.env.ANTHROPIC_FAST_MODEL || "claude-haiku-4-5";
  const started = Date.now();
  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model,
      max_tokens: 3000,
      system: [{ type: "text", text: RESUME_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: resumeText.slice(0, 15000) }],
    });
    const text = response.content.map((block) => (block.type === "text" ? block.text : "")).join("");
    const inputTokens = response.usage?.input_tokens ?? 0;
    const outputTokens = response.usage?.output_tokens ?? 0;
    const costCents = (inputTokens * config.fastInputCentsPerMillion + outputTokens * config.fastOutputCentsPerMillion) / 1_000_000;
    await repo.insertUsage({ id: id(), userId, provider: "anthropic", operation: "resume_profile", success: true, latencyMs: Date.now() - started, costCents, estimated: true, error: null, createdAt: nowIso() });
    await repo.insertGeneration({ id: id(), userId, purpose: "resume_profile", model, inputTokens, outputTokens, costCents, estimated: true, createdAt: nowIso() });
    return keepStated(JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)), resumeText, resumeHash(resumeText));
  } catch (error) {
    await repo.insertUsage({ id: id(), userId, provider: "anthropic", operation: "resume_profile", success: false, latencyMs: Date.now() - started, costCents: 0, estimated: true, error: error instanceof Error ? error.message : "anthropic_failed", createdAt: nowIso() });
    return null;
  }
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const SEASONS: Record<string, number> = { spring: 3, summer: 6, fall: 9, autumn: 9, winter: 12 };

/** Reads a resume date ("May 2024", "05/2024", "2024", "Summer 2023") into a month and year. */
export function parseResumeDate(raw: string): { month: number | null; year: number } | null {
  const text = raw.toLowerCase();
  const year = text.match(/\b(19|20)\d{2}\b/)?.[0];
  if (!year) return null;
  const numeric = text.match(/\b(0?[1-9]|1[0-2])\s*[/.-]\s*(19|20)\d{2}\b/);
  if (numeric) return { month: Number(numeric[1]), year: Number(year) };
  const name = MONTHS.findIndex((month) => new RegExp(`\\b${month.slice(0, 3)}`).test(text));
  if (name >= 0) return { month: name + 1, year: Number(year) };
  const season = Object.keys(SEASONS).find((key) => text.includes(key));
  return { month: season ? SEASONS[season] : null, year: Number(year) };
}

/** Writes a date the way the form asks for it. Null when the form needs a month the resume doesn't give. */
export function formatDate(raw: string, format: string | null, options: string[] = []) {
  const date = parseResumeDate(raw);
  if (!date) return null;
  const mm = date.month ? String(date.month).padStart(2, "0") : null;
  const want = (format ?? "").toUpperCase();
  if (options.length) {
    // A year or month dropdown.
    return bestOption(String(date.year), options) ?? (date.month ? bestOption(MONTHS[date.month - 1], options) ?? bestOption(MONTHS[date.month - 1].slice(0, 3), options) ?? bestOption(mm!, options) : null);
  }
  if (/^YYYY$/.test(want)) return String(date.year);
  if (!mm) return null;
  if (/YYYY-MM/.test(want)) return `${date.year}-${mm}${/DD/.test(want) ? "-01" : ""}`;
  if (/MM.?DD.?YYYY/.test(want)) return `${mm}/01/${date.year}`;
  return `${mm}/${date.year}`;
}

const DEGREE_NAMES: Array<[RegExp, string[]]> = [
  [/\b(b\.?\s?a\.?|b\.?\s?s\.?|b\.?\s?sc|bachelor)/i, ["Bachelor's Degree", "Bachelor's", "Bachelors", "Bachelor", "Bachelor of Arts", "Bachelor of Science", "BA", "BS", "Undergraduate"]],
  [/\b(m\.?\s?a\.?|m\.?\s?s\.?|m\.?\s?sc|master|mba)/i, ["Master's Degree", "Master's", "Masters", "Master", "MBA"]],
  [/\b(ph\.?\s?d|doctor)/i, ["Doctorate", "PhD", "Doctoral Degree"]],
  [/\bassociate/i, ["Associate's Degree", "Associate Degree", "Associates"]],
  [/high school|diploma|ged/i, ["High School Diploma", "High School", "GED"]],
];

/** The degree as the form's options word it. */
export function degreeAnswer(degree: string, options: string[]) {
  if (!options.length) return degree || null;
  const direct = bestOption(degree, options);
  if (direct) return direct;
  const names = DEGREE_NAMES.find(([pattern]) => pattern.test(degree))?.[1] ?? [];
  for (const name of names) {
    const match = bestOption(name, options);
    if (match) return match;
  }
  return null;
}

/** Which resume entry a field belongs to: "Work Experience 2" or "education[1]" is the second one. */
function entryIndex(section: string, label: string) {
  const fromSection = section.match(/\b(\d{1,2})\b/)?.[1];
  if (fromSection) return Math.max(0, Number(fromSection) - 1);
  const fromLabel = label.match(/\[(\d{1,2})\]|\b(\d{1,2})\b/);
  return fromLabel ? Number(fromLabel[1] ?? fromLabel[2]) : 0;
}

const EXPERIENCE = /experience|employment|work history|employer|job history|professional/i;
const EDUCATION = /education|school|university|college|academic|degree/i;

/**
 * Answers education and work history fields from the resume: the school, degree, field, dates, job title,
 * company, and so on, for the entry the section points to. Null when the resume doesn't say.
 */
export function resumeFieldAnswer(resume: ResumeProfile | null | undefined, field: { label: string; section?: string; kind: string; options: string[]; format?: string | null }) {
  if (!resume) return null;
  const label = field.label.toLowerCase();
  const section = field.section ?? "";
  const context = `${section} ${label}`;
  const isDate = /\b(start|from|begin|end|to|until|graduat|completion|date|month|year)\b|mm\/|yyyy/i.test(label);
  const start = /\b(start|from|begin)\b/i.test(label);
  const index = entryIndex(section, field.label);
  if (EDUCATION.test(context) && !EXPERIENCE.test(section)) {
    const entry = resume.education[index];
    if (!entry) return null;
    if (/\b(school|university|college|institution)\b/i.test(label) && !isDate) return field.options.length ? bestOption(entry.school, field.options) : entry.school;
    if (/field of study|major|discipline|concentration|area of study/i.test(label)) return entry.field ? (field.options.length ? bestOption(entry.field, field.options) : entry.field) : null;
    if (/\bdegree\b|qualification/i.test(label) && !isDate) return degreeAnswer(entry.degree, field.options);
    if (/\bgpa\b|grade point|overall result/i.test(label)) return entry.gpa || null;
    if (isDate) return formatDate(start ? entry.start : entry.end, field.format ?? null, field.options);
    return null;
  }
  if (EXPERIENCE.test(context)) {
    const entry = resume.experience[index];
    if (!entry) return null;
    if (/currently work|current(ly)? (employed|here|role|job|position)|i currently/i.test(label)) return entry.current ? "Yes" : field.kind === "checkbox" ? null : "No";
    if (/\b(job )?title\b|position|\brole\b/i.test(label) && !isDate) return entry.title || null;
    if (/company|employer|organi[sz]ation/i.test(label) && !isDate) return entry.company || null;
    if (/location|city/i.test(label)) return entry.location || null;
    if (/description|responsibilit|duties|summary|accomplish/i.test(label)) return entry.summary || null;
    if (isDate) {
      if (!start && entry.current) return null;
      return formatDate(start ? entry.start : entry.end, field.format ?? null, field.options);
    }
  }
  return null;
}
