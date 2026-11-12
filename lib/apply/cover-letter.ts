import { serverConfig } from "@/lib/config";
import { id, nowIso, readAnthropicKey, repo } from "@/lib/db/file-store";
import type { JobApplication } from "@/lib/apply/types";

/**
 * How a letter should read, shared by the web app and the extension. Accurate first (only what the student's own
 * resume and profile say, matched to what the posting asks for), then human: specific, plain and polite, like a
 * thoughtful student writing to a professional they respect, never stiff and never casual.
 */
export const LETTER_VOICE = `Accuracy comes first:
- Use only facts from the student's resume, profile, chosen highlights and notes, and the job posting. Never invent or round up experience, employers, titles, dates, numbers, tools, coursework, awards, or reasons for liking the company.
- Before writing, pick the two or three requirements the posting stresses most, and for each find the student's strongest real evidence. Build the letter on those matches. If the student has no evidence for a requirement, leave it out rather than claim it.
- Get the facts right: a role that has ended is past tense, one still going (no end date, or "Present") is present tense. Use the student's real school, class year and major only as given.
- Name the company and role exactly as the posting does. Say something specific about the team or work only when the posting says it.

What makes a letter work (from hiring research; see docs/cover-letter-formats.md):
- Tailoring is the one thing measured to raise callbacks (a field test of about 7,300 applications: 16.4% for a letter tailored to the posting, 12.5% for a generic one). Every paragraph should be about this job: its stated duties, requirements and team, met with the student's real evidence. A letter that could be sent to any employer has failed.
- Readers skim in seconds. The first two sentences must carry the role's exact name and the student's single strongest, most relevant match. The first sentence of every paragraph states that paragraph's point, so a skimmer gets the whole case from those sentences alone.
- Evidence beats enthusiasm. Interest is shown by specifics (a named project, a tool the posting asks for and the student has used, a result with a number when the resume gives one), not by saying they are excited. For each claim, ask "how does the resume prove this?" and say that instead.
- Write about what the student would do for the employer, not what the job would do for the student. Don't say the role would help them grow, learn or launch their career.
- Hiring managers flag letters as AI-written by impersonal, polished-but-empty phrasing and by not engaging with the actual posting. Use the student's concrete nouns (course names, project names, organizations, tools, numbers) and the posting's own key terms where they truly apply, in plain words, without copying its sentences.
- For students, classes, projects, clubs, research, part-time jobs and volunteering all count as experience. Describe them as real work: what the student was responsible for, what they did, and what came of it. Never apologize for little experience or point out what's missing.
- If the student or posting names a referral, a person, or a connection to the company, use it early, in one sentence, only as given.
- Close with one confident, specific sentence on what they'd bring to this team, and a plain request to talk. No begging, no "thank you for your time and consideration" filler, no restating the whole letter.

How it should sound:
- Like a capable student wrote it themselves: clear, specific and warm, but professional. No slang, no exclamation marks, contractions only now and then.
- Show, don't claim: describe what the student actually did and what came of it ("built the intake form 40 volunteers now use") instead of adjectives about themselves ("hardworking", "detail-oriented", "passionate").
- Vary sentence length. Short paragraphs. Each paragraph makes one point.
- Never use these: "I am writing to express my interest", "I am excited to apply", "I believe I would be a great fit", "passion"/"passionate", "leverage", "synergy", "dynamic", "fast-paced environment", "hit the ground running", "unique opportunity", "honed", "delve", "testament", "tapestry", "I am confident that", "thrilled", em dashes.
- Don't restate the resume line by line or list every skill. Depth on two experiences beats a tour of five.
- Don't copy sentences from the job posting.`;

export const COVER_LETTER_PROMPT = `You write a cover letter for a college student applying to a job.
${LETTER_VOICE}

Shape: "Dear Hiring Team," then three short paragraphs. First: the role, who the student is (school, year, major when known) and, in one sentence, the clearest reason they fit, drawn from their real experience. Second: one or two real experiences that answer the posting's main requirements, with what the student did and what came of it. Third: a brief, confident close that says what they'd bring and that they'd welcome a conversation. Then "Sincerely," and the student's full name on the next line.
Under 250 words. Plain text, paragraphs separated by a blank line. No addresses, no date, no placeholders in brackets, no markdown.
Return only the letter.`;

export type CoverLetterStudent = { name: string; resumeText: string; profile: string; /** Topics the student asked never to bring up. */ excluded?: string };

/** What the student asked for in the extension's quick questions, or the changes they asked for after reading it. */
export type CoverLetterStyle = {
  length?: "short" | "standard" | "detailed";
  tone?: "professional" | "warm" | "confident" | "enthusiastic";
  /** How the letter is built: one of the research-backed structures in LETTER_FORMATS. */
  format?: LetterFormat;
  /** Something the student wants mentioned, in their own words. */
  mention?: string;
  /** The letter they're revising, and what they want changed. */
  previous?: string;
  edit?: string;
};

/**
 * The cover letter structures recruiters and career offices recommend most. The only controlled test (ResumeGo,
 * about 7,300 applications) found the lift comes from tailoring to the posting: 16.4% callbacks for a tailored
 * letter, 12.5% for a generic one, 10.7% for none. So every format is built on the posting's own requirements;
 * they differ in what leads. See docs/cover-letter-formats.md.
 */
export const LETTER_FORMATS = ["match", "problem", "achievement", "story"] as const;
export type LetterFormat = (typeof LETTER_FORMATS)[number];
const FORMATS: Record<LetterFormat, string> = {
  match: "Format: requirements match. Open with the role and the one-sentence reason the student fits. In the body, take the two or three requirements the posting stresses most and answer each with the student's real evidence, one short paragraph (or one tight sentence each) per requirement, in the order the posting lists them. Close by asking for a conversation.",
  problem: "Format: problem-solution. Open by naming, in the posting's terms, the need or challenge this role exists to handle (only what the posting says). Then show how the student has already handled something like it, with what they did and what came of it. Then one more piece of evidence. Close with what they'd take on first and a request to talk.",
  achievement: "Format: achievement first. Open with the student's single most relevant, concrete result (a number or a visible outcome, only if the resume gives it), then tie it to the role in the next sentence. The body gives one or two more results that match the posting's requirements. Close briefly.",
  story: "Format: short story hook. Open with two or three sentences of a real, specific moment from the student's experience that shows the skill this role needs most (only what the resume, profile or notes support). Then connect it to the role and the company in plain words, add one more piece of evidence for the posting's main requirement, and close briefly.",
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
  if (style.format) notes.push(`${FORMATS[style.format]} (This replaces the usual shape, but keep the greeting, sign-off and length.)`);
  if (style.tone) notes.push(`Tone: ${style.tone}.`);
  if (style.mention?.trim()) notes.push(`The student asked you to mention this, in their own words (it counts as something they told you): "${style.mention.trim()}"`);
  if (style.previous?.trim() && style.edit?.trim()) {
    notes.push(`This is a revision. The current letter:\n${style.previous.trim()}\n\nThe student wants these changes: "${style.edit.trim()}"\nKeep what they didn't ask to change. Return the whole revised letter.`);
  }
  return notes.join("\n");
}

/** The model letters are written with: ANTHROPIC_LETTER_MODEL when set (a stronger model writes better letters), else the fast one. */
export const letterModel = () => process.env.ANTHROPIC_LETTER_MODEL || process.env.ANTHROPIC_FAST_MODEL || "claude-haiku-4-5";

/** One model call writes the letter from the student's resume and the posting. Null when AI isn't set up or there's no resume. */
export async function writeCoverLetter(userId: string, app: Pick<JobApplication, "title" | "company" | "department" | "description" | "requirements">, student: CoverLetterStudent, style: CoverLetterStyle = {}) {
  if (!student.resumeText.trim() && !student.profile.trim()) return null;
  const apiKey = await readAnthropicKey();
  if (!apiKey) return null;
  const config = serverConfig();
  // A generic letter, for no job in particular.
  const generic = !app.title && !app.description.trim();
  const prompt = [
    `Student: ${student.name}`,
    generic ? "Role and company: none. This is a general letter the student can send to any employer. Don't name a company or a job title, and don't claim to match any requirements: lead with the student's strongest real experience and what they'd bring to a team. It must read as finished as it is, with no blanks to fill in." : app.title && app.company ? `Role: ${app.title} at ${app.company}${app.department ? ` (${app.department})` : ""}` : "Role and company: as the job description below names them. If it doesn't name the company, don't make one up; write around it.",
    app.requirements.length ? `Requirements from the posting:\n${app.requirements.slice(0, 12).map((item) => `- ${item}`).join("\n")}` : "",
    generic ? "" : app.description.trim() ? `Job description:\n${app.description.slice(0, 3500)}` : "No job description: write a general letter for this role and company. Don't claim to match any requirements or say anything about the team or work beyond the role's name. Lead with the student's strongest real experience for this kind of role.",
    student.resumeText ? `Resume:\n${student.resumeText.slice(0, 6000)}` : "",
    student.profile ? `Profile:\n${student.profile.slice(0, 3000)}` : "",
    student.excluded?.trim() ? `Topics the student asked you never to mention: ${student.excluded.trim().slice(0, 500)}` : "",
    `Today is ${new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}, for telling past roles from current ones.`,
    styleNotes(style),
  ].filter(Boolean).join("\n\n");
  const model = letterModel();
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

export const PART_PROMPT = `You rewrite one part of a college student's cover letter, as they ask, and nothing else.
${LETTER_VOICE}
Keep it fitting the sentences around it: same tone, same person, plain text. If it was one sentence, return one or two.
Return only the new text for that part: no quotes, no explanation.`;

/** The quick asks for a selected part of the letter. */
export const PART_ASKS: Record<string, string> = {
  shorter: "Make it shorter and tighter, keeping its point.",
  specific: "Make it more specific, using a concrete detail from the resume that fits the job.",
  rewrite: "Say it a different way.",
  confident: "Make it sound more confident, without bragging.",
};

/**
 * Rewrites just the part of the letter the student selected, and puts it back in place. `ask` is one of
 * PART_ASKS or the student's own words. Null when AI isn't set up or the part isn't in the letter.
 */
export async function rewriteLetterPart(userId: string, letter: string, part: string, ask: string, context: { job: string; student: CoverLetterStudent }) {
  const at = letter.indexOf(part);
  if (!part.trim() || at < 0) return null;
  const apiKey = await readAnthropicKey();
  if (!apiKey) return null;
  const config = serverConfig();
  const model = process.env.ANTHROPIC_FAST_MODEL || "claude-haiku-4-5";
  const started = Date.now();
  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const response = await new Anthropic({ apiKey }).messages.create({
      model,
      max_tokens: 600,
      system: [{ type: "text", text: PART_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: [
        `The letter:\n${letter.slice(0, 5000)}`,
        `The part to rewrite:\n${part}`,
        `What the student wants: ${PART_ASKS[ask] ?? `"${ask.slice(0, 300)}"`}`,
        `The job:\n${context.job.slice(0, 2500)}`,
        context.student.resumeText ? `Resume:\n${context.student.resumeText.slice(0, 5000)}` : "",
        context.student.profile ? `Profile:\n${context.student.profile.slice(0, 2000)}` : "",
      ].filter(Boolean).join("\n\n") }],
    });
    const text = response.content.map((block) => (block.type === "text" ? block.text : "")).join("").trim().replace(/^["“]|["”]$/g, "");
    const inputTokens = response.usage?.input_tokens ?? 0;
    const outputTokens = response.usage?.output_tokens ?? 0;
    const costCents = (inputTokens * config.fastInputCentsPerMillion + outputTokens * config.fastOutputCentsPerMillion) / 1_000_000;
    await repo.insertUsage({ id: id(), userId, provider: "anthropic", operation: "cover_letter_part", success: true, latencyMs: Date.now() - started, costCents, estimated: true, error: null, createdAt: nowIso() });
    if (!text || response.stop_reason === "refusal" || /\[[^\]]*\]/.test(text)) return null;
    // A sentence keeps its spacing: the part's own leading and trailing whitespace stays.
    const lead = part.match(/^\s*/)![0];
    const trail = part.match(/\s*$/)![0];
    return `${letter.slice(0, at)}${lead}${text.slice(0, 1500)}${trail}${letter.slice(at + part.length)}`;
  } catch (error) {
    await repo.insertUsage({ id: id(), userId, provider: "anthropic", operation: "cover_letter_part", success: false, latencyMs: Date.now() - started, costCents: 0, estimated: true, error: error instanceof Error ? error.message : "anthropic_failed", createdAt: nowIso() });
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
