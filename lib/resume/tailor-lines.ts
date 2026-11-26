/**
 * A resume as the lines a reader sees, for "Tailor my resume to this job". Each format (PDF, Word, plain text) reads
 * its file into these lines and keeps how each one is drawn, so the tailored version can be put back in the student's
 * own layout. Only bullets, the summary and the skills lines may ever change; names, schools, employers, titles, dates
 * and section names are fixed by construction.
 */

export type LineKind = "section" | "bullet" | "summary" | "skills" | "fixed";
/** One line (a bullet with its wrapped lines, a heading, a skills line). `group`: bullets under the same entry. */
export type ResumeLine = { id: number; text: string; kind: LineKind; group: number | null };
/** What the tailoring changes: new text for some lines (by id), and a new order for some bullet groups. */
export type TailorPlan = { edits: Record<string, string>; order: Record<string, number[]> };

export const EDITABLE = new Set<LineKind>(["bullet", "summary", "skills"]);

/** A bullet drawn as its own character (•, ▪, a dash), and a line that starts with one. */
export const BULLET_GLYPH = /^[•●▪■◦‣∙·○◆♦➢➤►▶✓✔\-–—*]$/;
export const BULLET_START = /^\s*[•●▪■◦‣∙·○◆♦➢➤►▶✓✔\-–—*]\s+/;

const SECTION_WORDS = /^(professional |career |technical |relevant |work |research |additional |related |leadership (and|&) )?(summary|profile|objective|about me|education|experience|employment( history)?|work history|projects?|skills?|technical skills|skills (and|&) [a-z]+|leadership|activities|involvement|honors( (and|&) awards)?|awards|certifications?|publications|interests|volunteer(ing| work)?|coursework|languages|tools|technologies|information|qualifications)( experience)?$/i;

/** A section name: one of the usual ones, or a short line in capitals with no numbers or commas. */
export function isSection(text: string) {
  const line = text.trim().replace(/:$/, "");
  if (line.length < 3 || line.length > 40 || /[\d,|@]/.test(line)) return false;
  return SECTION_WORDS.test(line) || (line === line.toUpperCase() && /[A-Z]{3}/.test(line) && line.split(/\s+/).length <= 4);
}

const SUMMARY = /summary|profile|objective|about/i;
const SKILLS = /skill|technolog|tools|competenc/i;

/**
 * Sorts read lines into kinds. Bullets in a row under one entry share a group (their order may change). Lines under a
 * summary or profile section are the summary; lines under a skills section are skills lines. Everything else is fixed.
 */
export function classify(raw: Array<{ text: string; bullet: boolean }>): ResumeLine[] {
  let section = "";
  let group = 0;
  let inGroup = false;
  return raw.map((line, id): ResumeLine => {
    const text = line.text.replace(/\s+/g, " ").trim();
    if (!line.bullet && isSection(text)) {
      section = text;
      inGroup = false;
      return { id, text, kind: "section", group: null };
    }
    if (SKILLS.test(section)) {
      inGroup = false;
      return { id, text, kind: "skills", group: null };
    }
    if (SUMMARY.test(section)) {
      inGroup = false;
      return { id, text, kind: "summary", group: null };
    }
    if (line.bullet) {
      if (!inGroup) group += 1;
      inGroup = true;
      return { id, text, kind: "bullet", group };
    }
    inGroup = false;
    return { id, text, kind: "fixed", group: null };
  });
}

/** Lines from plain resume text, for a resume whose file can't be read for its layout. */
export function linesFromText(text: string) {
  return classify(text.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => ({ text: line.replace(BULLET_START, ""), bullet: BULLET_START.test(line) })));
}

/** The lines in their new order with their new text: a bullet group's lines are put in the plan's order. */
export function planned(lines: ResumeLine[], plan: TailorPlan) {
  const byId = new Map(lines.map((line) => [line.id, line]));
  const out: ResumeLine[] = [];
  const done = new Set<number>();
  for (const line of lines) {
    if (done.has(line.id)) continue;
    const order = line.group !== null ? plan.order[String(line.group)] : undefined;
    const run = order ? order.map((id) => byId.get(id)!) : [line];
    for (const item of run) {
      done.add(item.id);
      out.push({ ...item, text: plan.edits[String(item.id)] ?? item.text });
    }
  }
  return out;
}

/** The tailored resume as plain text in Unnepo's CV format, for when the original layout can't be read. */
export function planAsCvText(lines: ResumeLine[], plan: TailorPlan) {
  // The name and contact lines above the first section are drawn by the CV's own header.
  const all = planned(lines, plan);
  const first = Math.max(0, all.findIndex((line) => line.kind === "section"));
  return all.slice(first).map((line) => (line.kind === "section" ? `\n${line.text.toUpperCase().replace(/[^A-Z &/]/g, "").trim()}` : line.kind === "bullet" ? `• ${line.text}` : line.text)).join("\n").trim();
}
