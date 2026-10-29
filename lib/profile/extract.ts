import { z } from "zod";
import { serverConfig } from "@/lib/config";
import { id, nowIso, readAnthropicKey, repo } from "@/lib/db/file-store";
import { supportedBy } from "@/lib/apply/questions";
import type { StudentProfile } from "@/lib/profile/student";

/**
 * Step 1 of onboarding: one cheap model call reads the resume into the student profile's shape.
 * Every value is kept only if the resume actually contains it, so nothing is invented.
 */
export const EXTRACT_PROMPT = `Read a college student's resume into JSON for job applications. Copy every value exactly as the resume writes it (same spelling, same date wording). Use "" or [] when the resume doesn't say. Never infer, expand, or invent anything.
{"contact":{"firstName":"","lastName":"","email":"","phone":"","city":"","state":"","country":"","zip":""},
"links":{"linkedin":"","github":"","portfolio":""},
"education":[{"school":"","degree":"","major":"","minor":"","gpa":"","startDate":"","gradDate":"","coursework":[]}],
"experience":[{"company":"","title":"","location":"","startDate":"","endDate":"","current":false,"bullets":[]}],
"projects":[{"name":"","role":"","url":"","bullets":[],"tech":[]}],
"skills":{"technical":[],"languages":[],"certifications":[]}}
- education, experience, projects: every entry, most recent first.
- degree as written ("B.A.", "Bachelor of Science"); major as written.
- gradDate: the graduation date as written, including "Expected May 2027".
- endDate: as written, or "Present" (then current is true).
- bullets: copied exactly, up to 6 per entry.
- skills.technical: tools, programming languages, and methods as listed. skills.languages: spoken languages only.
Return only the JSON.`;

const str = z.string().catch("");
const strs = z.array(z.string()).catch([]);
const Reply = z.object({
  contact: z.object({ firstName: str, lastName: str, email: str, phone: str, city: str, state: str, country: str, zip: str }).partial().catch({}),
  links: z.object({ linkedin: str, github: str, portfolio: str }).partial().catch({}),
  education: z.array(z.object({ school: str, degree: str, major: str, minor: str, gpa: str, startDate: str, gradDate: str, coursework: strs }).partial()).catch([]),
  experience: z.array(z.object({ company: str, title: str, location: str, startDate: str, endDate: str, current: z.boolean().catch(false), bullets: strs }).partial()).catch([]),
  projects: z.array(z.object({ name: str, role: str, url: str, bullets: strs, tech: strs }).partial()).catch([]),
  skills: z.object({ technical: strs, languages: strs, certifications: strs }).partial().catch({}),
});
type Extracted = z.infer<typeof Reply>;

/** The parts of the profile a resume can fill. */
export type ResumeFields = Pick<StudentProfile, "contact" | "links" | "education" | "experience" | "projects" | "skills">;

/** Keeps only what the resume really says. Exported for tests. */
export function groundExtracted(raw: Extracted, resumeText: string): { fields: Partial<ResumeFields>; paths: string[] } {
  const paths: string[] = [];
  const keep = (value: string | undefined, path: string, max = 200) => {
    const clean = String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
    if (!clean || !supportedBy(clean, resumeText)) return undefined;
    paths.push(path);
    return clean;
  };
  const keepList = (values: string[] | undefined, path: string, max = 30, length = 400) => {
    const kept = (values ?? []).map((value) => String(value).replace(/\s+/g, " ").trim().slice(0, length)).filter((value) => value && supportedBy(value, resumeText)).slice(0, max);
    if (kept.length) paths.push(path);
    return kept;
  };
  const c = raw.contact ?? {};
  const contact = Object.fromEntries((["firstName", "lastName", "email", "phone", "city", "state", "country", "zip"] as const).map((key) => [key, keep(c[key], `contact.${key}`, 120)]).filter(([, value]) => value)) as Partial<ResumeFields["contact"]>;
  const l = raw.links ?? {};
  const links = Object.fromEntries((["linkedin", "github", "portfolio"] as const).map((key) => [key, keep(l[key], `links.${key}`, 300)]).filter(([, value]) => value)) as ResumeFields["links"];
  const education = (raw.education ?? []).slice(0, 6).map((item, i) => ({
    school: keep(item.school, `education.${i}.school`) ?? "",
    degree: keep(item.degree, `education.${i}.degree`, 120) ?? "",
    major: keep(item.major, `education.${i}.major`, 120) ?? "",
    minor: keep(item.minor, `education.${i}.minor`, 120),
    gpa: keep(item.gpa, `education.${i}.gpa`, 10),
    startDate: keep(item.startDate, `education.${i}.startDate`, 40),
    gradDate: keep(item.gradDate, `education.${i}.gradDate`, 40) ?? "",
    coursework: keepList(item.coursework, `education.${i}.coursework`, 20, 120),
  })).filter((item) => item.school);
  const experience = (raw.experience ?? []).slice(0, 10).map((item, i) => {
    const endDate = keep(item.endDate, `experience.${i}.endDate`, 40);
    return {
      company: keep(item.company, `experience.${i}.company`, 160) ?? "",
      title: keep(item.title, `experience.${i}.title`, 160) ?? "",
      location: keep(item.location, `experience.${i}.location`, 120),
      startDate: keep(item.startDate, `experience.${i}.startDate`, 40) ?? "",
      endDate,
      current: /present|current|now/i.test(endDate ?? ""),
      bullets: keepList(item.bullets, `experience.${i}.bullets`, 6),
    };
  }).filter((item) => item.company || item.title);
  const projects = (raw.projects ?? []).slice(0, 8).map((item, i) => ({
    name: keep(item.name, `projects.${i}.name`, 160) ?? "",
    role: keep(item.role, `projects.${i}.role`, 120),
    url: keep(item.url, `projects.${i}.url`, 300),
    bullets: keepList(item.bullets, `projects.${i}.bullets`, 6),
    tech: keepList(item.tech, `projects.${i}.tech`, 15, 60),
  })).filter((item) => item.name);
  const s = raw.skills ?? {};
  const skills = { technical: keepList(s.technical, "skills.technical", 40, 60), languages: keepList(s.languages, "skills.languages", 10, 60), certifications: keepList(s.certifications, "skills.certifications", 10, 120) };
  return { fields: { contact: contact as ResumeFields["contact"], links, education, experience, projects, skills }, paths };
}

/** Reads the resume into profile fields. Null when there's no text or AI isn't set up. */
export async function extractProfileFromResume(userId: string, resumeText: string) {
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
      max_tokens: 4000,
      system: [{ type: "text", text: EXTRACT_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: resumeText.slice(0, 15000) }],
    });
    const text = response.content.map((block) => (block.type === "text" ? block.text : "")).join("");
    const inputTokens = response.usage?.input_tokens ?? 0;
    const outputTokens = response.usage?.output_tokens ?? 0;
    const costCents = (inputTokens * config.fastInputCentsPerMillion + outputTokens * config.fastOutputCentsPerMillion) / 1_000_000;
    await repo.insertUsage({ id: id(), userId, provider: "anthropic", operation: "profile_extract", success: true, latencyMs: Date.now() - started, costCents, estimated: true, error: null, createdAt: nowIso() });
    await repo.insertGeneration({ id: id(), userId, purpose: "profile_extract", model, inputTokens, outputTokens, costCents, estimated: true, createdAt: nowIso() });
    return groundExtracted(Reply.parse(JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1))), resumeText);
  } catch (error) {
    await repo.insertUsage({ id: id(), userId, provider: "anthropic", operation: "profile_extract", success: false, latencyMs: Date.now() - started, costCents: 0, estimated: true, error: error instanceof Error ? error.message : "anthropic_failed", createdAt: nowIso() });
    return null;
  }
}

/**
 * Puts resume values into the profile without touching anything the student typed themselves.
 * A list (education, experience, projects) is replaced only if the student hasn't edited any of it.
 */
export function mergeResume(profile: StudentProfile, extracted: { fields: Partial<ResumeFields>; paths: string[] }): StudentProfile {
  const next: StudentProfile = structuredClone(profile);
  const byStudent = (path: string) => Object.entries(profile.sources).some(([key, source]) => source === "student" && (key === path || key.startsWith(`${path}.`)));
  const f = extracted.fields;
  for (const [key, value] of Object.entries(f.contact ?? {})) if (value && !byStudent(`contact.${key}`)) (next.contact as Record<string, unknown>)[key] = value;
  for (const [key, value] of Object.entries(f.links ?? {})) if (value && !byStudent(`links.${key}`)) (next.links as Record<string, unknown>)[key] = value;
  for (const section of ["education", "experience", "projects"] as const) {
    const incoming = f[section];
    if (incoming?.length && !byStudent(section)) (next as Record<string, unknown>)[section] = incoming;
  }
  if (f.skills && !byStudent("skills")) next.skills = { ...next.skills, ...Object.fromEntries(Object.entries(f.skills).filter(([, value]) => (value as string[]).length)) };
  for (const path of extracted.paths) if (!byStudent(path)) next.sources[path] = "resume";
  return next;
}
