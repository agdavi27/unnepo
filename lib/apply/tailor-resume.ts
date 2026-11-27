import { claudeAsk } from "@/lib/apply/fast/pipeline";
import { id, nowIso, repo } from "@/lib/db/file-store";
import { cvPdf } from "@/lib/apply/cv";
import type { JobApplication } from "@/lib/apply/types";
import { applyDocxPlan, docxPdf, readDocxLayout } from "@/lib/resume/docx-tailor";
import { readPdfLayout, renderPdf } from "@/lib/resume/pdf-tailor";
import { EDITABLE, linesFromText, planAsCvText, type ResumeLine, type TailorPlan } from "@/lib/resume/tailor-lines";

/**
 * "Tailor my resume to this job": the student's own resume, in its own layout, with some lines reworded toward one
 * posting. The model sees the resume as numbered lines and may only change bullets, the summary and skills lines, and
 * the order of bullets under one entry. Names, schools, employers, titles, dates and section names can't change at all.
 * Each change is then checked against the resume (`checkPlan`): one that names a tool, name or number the resume
 * doesn't have is dropped. The file keeps the original's look: a Word resume is edited in place (lib/resume/docx-tailor.ts),
 * a PDF is redrawn to match (lib/resume/pdf-tailor.ts). Only when neither can be read is it laid out like Unnepo's CV.
 */

export const TAILOR_PROMPT = `You tailor a college student's resume to one job posting by changing some of its lines.

The resume is given as numbered lines, each marked with its kind. Only lines marked bullet, summary or skills may
change. The resume is the only source of facts. Never add an employer, school, club, project, title, degree, date,
number, metric, tool, technology, certification, award or skill. Every number you write must already be in that line.
If the posting asks for something the resume doesn't show, leave it out; never imply it.

- bullet: reword it toward the posting's own terms, only where the bullet already shows that thing. Keep its facts
  (what, where, how much) and start with a strong verb. Keep it about the same length (at most a few words longer),
  so the resume keeps its length. No bullet character.
- summary: rewrite from facts in the resume, aimed at this kind of role. It may use the role's title; don't name the
  company, and no "seeking" or "passionate". About the same length as now.
- skills: put the skills the posting asks for first. Only skills already in the resume. Keep any label before a colon.
- order: bullets with the same group number may be put in a new order, most relevant to the posting first.

Change only what makes the resume fit this job better. Return JSON only:
{"edits": {"<line number>": "<new text>"}, "order": {"<group number>": [<line numbers in the new order>]}}`;

/** What a tailored resume is for. */
export type TailorJob = Pick<JobApplication, "title" | "company" | "description" | "requirements">;

/** Words that carry no fact, so a reworded line may add them freely. */
const FILLER = new Set("a an and the of for to in on at by with from into via as or & per using use used across within over under through who which that this these those its their our my your more most new key core strong".split(" "));
const STEM = (word: string) => word.replace(/(ing|ed|es|s)$/, "");

/** A line's words, lowercased, punctuation (other than + and #, as in C++ and C#) dropped. */
const words = (line: string) => line.toLowerCase().replace(/[‘’']/g, "").replace(/[^a-z0-9+#.]+/g, " ").replace(/(^|\s)\.+|\.+(\s|$)/g, " ").split(/\s+/).filter(Boolean);

/** Terms that state a fact: a name, tool or acronym (a capital not starting a sentence), or anything with a digit, + or #. */
function factTerms(line: string) {
  const raw = line.split(/[\s,;:()/]+/).filter(Boolean);
  return raw.flatMap((token, index) => {
    const clean = token.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9+#]+$/g, "");
    if (!clean) return [];
    const starts = index === 0 || /[.!?;:]$/.test(raw[index - 1]);
    const named = (!starts && /[A-Z]/.test(clean)) || /[A-Z].*[A-Z]/.test(clean) || /[\d+#]/.test(clean);
    return named ? [clean.toLowerCase().replace(/[‘’']/g, "")] : [];
  });
}

const numbers = (text: string) => (text.match(/\d[\d,.]*/g) ?? []).map((number) => number.replace(/[,.]$/, "").replace(/,/g, ""));

/**
 * Keeps only the changes that hold up: on a line that may change, about the same length, naming only what the resume
 * names, with only the numbers that line already had (the summary may also use the job's title). A skills line keeps
 * its label and only skills from the resume. A new order must be the same bullets of one group.
 */
export function checkPlan(lines: ResumeLine[], raw: unknown, job: { title: string } = { title: "" }): TailorPlan {
  const given = (raw ?? {}) as { edits?: Record<string, unknown>; order?: Record<string, unknown> };
  const resume = lines.map((line) => line.text).join("\n");
  const source = new Set(words(resume).flatMap((word) => [word, STEM(word)]));
  const plain = ` ${words(resume).join(" ")} `;
  const titleWords = new Set(words(job.title));
  const known = (term: string, extra?: Set<string>) => {
    const parts = words(term);
    return parts.every((part) => FILLER.has(part) || source.has(part) || source.has(STEM(part)) || extra?.has(part)) || plain.includes(` ${parts.join(" ")} `);
  };
  const edits: Record<string, string> = {};
  for (const [id, value] of Object.entries(given.edits ?? {})) {
    const line = lines[Number(id)];
    if (!line || line.id !== Number(id) || !EDITABLE.has(line.kind) || typeof value !== "string") continue;
    let text = value.replace(/^\s*[•●▪■◦‣∙·\-–—*]\s+/, "").replace(/\s+/g, " ").replace(/^["“]|["”]$/g, "").trim();
    if (!text || text === line.text || text.length > line.text.length * 1.25 + 12) continue;
    if (line.kind === "skills") {
      const label = line.text.match(/^([^:,]{1,40}):/)?.[1];
      const list = label ? text.replace(new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*`), "") : text;
      const kept = list.split(/[,;|•]/).map((item) => item.trim()).filter((item) => item && known(item));
      if (!kept.length) continue;
      text = `${label ? `${label}: ` : ""}${kept.join(", ")}`;
      if (text === line.text) continue;
    } else {
      // A bullet keeps its own numbers (none moved from another bullet); the summary may use any the resume gives.
      const had = new Set(numbers(line.kind === "summary" ? resume : line.text));
      if (!numbers(text).every((number) => had.has(number))) continue;
      if (!factTerms(text).every((term) => known(term, line.kind === "summary" ? titleWords : undefined))) continue;
    }
    edits[id] = text.slice(0, 600);
  }
  const order: Record<string, number[]> = {};
  for (const [group, value] of Object.entries(given.order ?? {})) {
    const members = lines.filter((line) => line.group === Number(group) && line.kind === "bullet").map((line) => line.id);
    const ids = Array.isArray(value) ? value.map(Number) : [];
    const same = ids.length === members.length && new Set(ids).size === ids.length && ids.every((id) => members.includes(id));
    if (same && ids.some((id, index) => id !== members[index])) order[group] = ids;
  }
  return { edits, order };
}

/** The resume as the model reads it: numbered lines, each with its kind, bullets with their group. */
export function linesForModel(lines: ResumeLine[]) {
  return lines.map((line) => `${line.id} (${line.kind === "bullet" ? `bullet, group ${line.group}` : line.kind === "section" ? "section" : line.kind === "fixed" ? "fixed" : line.kind}): ${line.text}`).join("\n");
}

/** Asks for the changes and keeps the ones that hold up. Null when AI isn't set up or nothing useful came back. */
export async function writeTailorPlan(userId: string, job: TailorJob, lines: ResumeLine[]) {
  if (lines.filter((line) => EDITABLE.has(line.kind)).length < 2) return tailorFailed(userId, `The resume read into ${lines.length} lines with fewer than 2 that can be edited.`);
  const posting = [
    `Role: ${job.title || "(not named)"}${job.company ? ` at ${job.company}` : ""}`,
    job.requirements.length ? `Requirements from the posting:\n${job.requirements.slice(0, 12).map((item) => `- ${item}`).join("\n")}` : "",
    job.description.trim() ? `Job description:\n${job.description.slice(0, 3500)}` : "",
  ].filter(Boolean).join("\n\n");
  let written: string;
  try {
    written = await claudeAsk(userId, "tailored_resume")(TAILOR_PROMPT, `${posting}\n\nThe student's resume:\n${linesForModel(lines).slice(0, 12000)}`);
  } catch {
    return null;
  }
  const json = written.slice(written.indexOf("{"), written.lastIndexOf("}") + 1);
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return tailorFailed(userId, `The model's answer wasn't JSON: ${written.slice(0, 200)}`); }
  const plan = checkPlan(lines, parsed, job);
  if (Object.keys(plan.edits).length || Object.keys(plan.order).length) return plan;
  return tailorFailed(userId, `None of the model's changes passed the checks: ${json.slice(0, 300)}`);
}

/** No plan, with the reason kept for the admin page (a failed model call is already kept by claudeAsk). */
async function tailorFailed(userId: string, reason: string) {
  console.error(`[ai] tailored_resume unusable: ${reason}`);
  await repo.insertUsage({ id: id(), userId, provider: "anthropic", operation: "tailored_resume", success: false, latencyMs: 0, costCents: 0, estimated: true, error: reason.slice(0, 500), createdAt: nowIso() }).catch(() => undefined);
  return null;
}

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** How the tailored file looks: the original edited in place, rebuilt to match it, or (unreadable) Unnepo's CV layout. */
export type TailoredLook = "original" | "matched" | "unnepo";

/** The student's resume read into lines, from its file when it can be read for its layout, else from its text. */
export async function readResumeLayout(file: { bytes: Uint8Array | null; fileName: string; text: string }) {
  const lower = file.fileName.toLowerCase();
  if (file.bytes?.byteLength) {
    if (lower.endsWith(".docx")) {
      const docx = await readDocxLayout(file.bytes).catch(() => null);
      if (docx) return docx;
    }
    if (lower.endsWith(".pdf")) {
      const pdf = await readPdfLayout(file.bytes).catch(() => null);
      if (pdf) return pdf;
    }
  }
  return { kind: "text" as const, lines: linesFromText(file.text) };
}

/**
 * The tailored file. A Word resume stays a Word file, edited in place, unless the form only takes PDFs (then it's
 * drawn as a PDF that follows its formatting). A PDF is redrawn to match. Anything that can't be read that way, or
 * fails while drawing, comes out in Unnepo's CV layout, and `look` says so.
 */
export async function tailoredFile(layout: Awaited<ReturnType<typeof readResumeLayout>>, original: Uint8Array | null, plan: TailorPlan, header: { name: string; contact: string[]; title: string }, options: { pdfOnly?: boolean } = {}) {
  try {
    if (layout.kind === "docx" && original) {
      const edited = await applyDocxPlan(original, plan);
      if (!options.pdfOnly) return { bytes: edited, mime: DOCX_MIME, ext: "docx", look: "original" as TailoredLook };
      return { bytes: await docxPdf(edited, header.title), mime: "application/pdf", ext: "pdf", look: "matched" as TailoredLook };
    }
    if (layout.kind === "pdf" && original) return { bytes: await renderPdf(original, layout, plan), mime: "application/pdf", ext: "pdf", look: "matched" as TailoredLook };
  } catch {
    // Drawn in Unnepo's layout below.
  }
  const pdf = await cvPdf(planAsCvText(layout.lines, plan), { name: header.name, contact: header.contact });
  return { bytes: new Uint8Array(pdf), mime: "application/pdf", ext: "pdf", look: "unnepo" as TailoredLook };
}
