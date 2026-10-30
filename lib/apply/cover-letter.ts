import { serverConfig } from "@/lib/config";
import { id, nowIso, readAnthropicKey, repo } from "@/lib/db/file-store";
import type { JobApplication } from "@/lib/apply/types";

export const COVER_LETTER_PROMPT = `You write a short cover letter for a college student applying to a job.
Use only facts from the student's resume and profile and the job posting. Never invent experience, employers, dates, numbers, skills, awards, or reasons the student likes the company beyond what the posting says.
Shape: "Dear Hiring Team," then three short paragraphs: the role and who the student is (school, year, major when known); one or two real experiences that match the job's requirements, with what the student did; a brief, confident close. Then "Sincerely," and the student's full name on the next line.
Under 250 words. Plain text, paragraphs separated by a blank line. No addresses, no date, no placeholders in brackets, no markdown.
Return only the letter.`;

export type CoverLetterStudent = { name: string; resumeText: string; profile: string };

/** What the student asked for in the extension's quick questions, or the changes they asked for after reading it. */
export type CoverLetterStyle = {
  length?: "short" | "standard" | "detailed";
  tone?: "professional" | "warm" | "confident" | "enthusiastic";
  /** Something the student wants mentioned, in their own words. */
  mention?: string;
  /** The letter they're revising, and what they want changed. */
  previous?: string;
  edit?: string;
};

const LENGTHS: Record<NonNullable<CoverLetterStyle["length"]>, string> = {
  short: "Under 150 words: two short paragraphs plus the close.",
  standard: "About 200 to 250 words.",
  detailed: "About 300 to 350 words, still fitting on one page.",
};

/** The student's choices as instructions for the model. Their own words count as facts they gave. */
function styleNotes(style: CoverLetterStyle) {
  const notes: string[] = [];
  if (style.length) notes.push(`Length for this letter (this replaces the usual length): ${LENGTHS[style.length]}`);
  if (style.tone) notes.push(`Tone: ${style.tone}.`);
  if (style.mention?.trim()) notes.push(`The student asked you to mention this, in their own words (it counts as something they told you): "${style.mention.trim()}"`);
  if (style.previous?.trim() && style.edit?.trim()) {
    notes.push(`This is a revision. The current letter:\n${style.previous.trim()}\n\nThe student wants these changes: "${style.edit.trim()}"\nKeep what they didn't ask to change. Return the whole revised letter.`);
  }
  return notes.join("\n");
}

/** One model call writes the letter from the student's resume and the posting. Null when AI isn't set up or there's no resume. */
export async function writeCoverLetter(userId: string, app: Pick<JobApplication, "title" | "company" | "department" | "description" | "requirements">, student: CoverLetterStudent, style: CoverLetterStyle = {}) {
  if (!student.resumeText.trim() && !student.profile.trim()) return null;
  const apiKey = await readAnthropicKey();
  if (!apiKey) return null;
  const config = serverConfig();
  const prompt = [
    `Student: ${student.name}`,
    app.title && app.company ? `Role: ${app.title} at ${app.company}${app.department ? ` (${app.department})` : ""}` : "Role and company: as the job description below names them. If it doesn't name the company, don't make one up; write around it.",
    app.requirements.length ? `Requirements from the posting:\n${app.requirements.slice(0, 12).map((item) => `- ${item}`).join("\n")}` : "",
    `Job description:\n${app.description.slice(0, 3500)}`,
    student.resumeText ? `Resume:\n${student.resumeText.slice(0, 6000)}` : "",
    student.profile ? `Profile:\n${student.profile.slice(0, 3000)}` : "",
    styleNotes(style),
  ].filter(Boolean).join("\n\n");
  const model = process.env.ANTHROPIC_FAST_MODEL || "claude-haiku-4-5";
  const started = Date.now();
  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model,
      max_tokens: 1200,
      system: [{ type: "text", text: COVER_LETTER_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: prompt }],
    });
    const text = response.content.map((block) => (block.type === "text" ? block.text : "")).join("").trim();
    const inputTokens = response.usage?.input_tokens ?? 0;
    const outputTokens = response.usage?.output_tokens ?? 0;
    const costCents = (inputTokens * config.fastInputCentsPerMillion + outputTokens * config.fastOutputCentsPerMillion) / 1_000_000;
    await repo.insertUsage({ id: id(), userId, provider: "anthropic", operation: "cover_letter", success: true, latencyMs: Date.now() - started, costCents, estimated: true, error: null, createdAt: nowIso() });
    await repo.insertGeneration({ id: id(), userId, purpose: "cover_letter", model, inputTokens, outputTokens, costCents, estimated: true, createdAt: nowIso() });
    if (response.stop_reason === "refusal" || text.length < 200 || /\[[^\]]*\]/.test(text)) return null;
    return text.slice(0, 4000);
  } catch (error) {
    await repo.insertUsage({ id: id(), userId, provider: "anthropic", operation: "cover_letter", success: false, latencyMs: Date.now() - started, costCents: 0, estimated: true, error: error instanceof Error ? error.message : "anthropic_failed", createdAt: nowIso() });
    return null;
  }
}

/** The standard PDF fonts only cover Latin-1, so typographic characters are swapped for plain ones. */
function latin1(text: string) {
  return text
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/…/g, "...")
    .replace(/[•·]/g, "-")
    .replace(/[^\n\x20-\x7E\xA0-\xFF]/g, "");
}

/** A one- or two-page letter PDF: the student's name and contact line, then the letter. */
export async function coverLetterPdf(text: string, header: { name: string; contact: string[] }) {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  doc.setTitle(`${header.name} Cover Letter`);
  doc.setAuthor(header.name);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const [width, height, margin, size, leading] = [612, 792, 72, 11, 15.5];
  let page = doc.addPage([width, height]);
  let y = height - margin;
  const line = (words: string, font = regular, fontSize = size, color = rgb(0.1, 0.1, 0.1)) => {
    if (y < margin) {
      page = doc.addPage([width, height]);
      y = height - margin;
    }
    page.drawText(words, { x: margin, y, size: fontSize, font, color });
    y -= fontSize === size ? leading : fontSize + 6;
  };
  line(latin1(header.name), bold, 16);
  const contact = latin1(header.contact.filter(Boolean).join("  |  "));
  if (contact) line(contact, regular, 9.5, rgb(0.35, 0.35, 0.35));
  y -= 14;
  for (const paragraph of latin1(text).split(/\n\s*\n/)) {
    for (const row of paragraph.split("\n")) {
      let current = "";
      for (const word of row.split(/\s+/).filter(Boolean)) {
        const next = current ? `${current} ${word}` : word;
        if (regular.widthOfTextAtSize(next, size) > width - margin * 2 && current) {
          line(current);
          current = word;
        } else current = next;
      }
      line(current);
    }
    y -= leading * 0.6;
  }
  return Buffer.from(await doc.save());
}
