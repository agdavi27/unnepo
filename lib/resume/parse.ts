import type { ResumeFact, ResumeFactCategory } from "@/lib/db/types";

const HEADINGS: Array<{ category: ResumeFactCategory; pattern: RegExp }> = [
  { category: "education", pattern: /^(education|academics)$/i },
  { category: "experience", pattern: /^(experience|work experience|employment|professional experience)$/i },
  { category: "internship", pattern: /^(internships?|internship experience)$/i },
  { category: "project", pattern: /^(projects?|selected projects)$/i },
  { category: "skill", pattern: /^(skills|technical skills|tools)$/i },
  { category: "leadership", pattern: /^(leadership|activities|involvement|organizations)$/i },
  { category: "achievement", pattern: /^(achievements|awards|honors)$/i },
  { category: "interest", pattern: /^(interests|hobbies)$/i },
];

export type ParsedFact = Pick<ResumeFact, "category" | "label" | "detail" | "sourceExcerpt">;

/**
 * Pulls only lines that appear under recognized resume headings.
 * It does not infer degrees, employers, or skills that are not written down.
 */
export function parseResumeText(text: string): ParsedFact[] {
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  let category: ResumeFactCategory | null = null;
  const facts: ParsedFact[] = [];
  for (const line of lines) {
    const heading = HEADINGS.find((item) => item.pattern.test(line.replace(/:$/, "")));
    if (heading) {
      category = heading.category;
      continue;
    }
    if (!category) continue;
    if (line.length < 2 || line.length > 240) continue;
    const [label, ...rest] = line.split(" — ");
    const detail = rest.join(" — ") || line;
    facts.push({
      category,
      label: label.slice(0, 120),
      detail: detail.slice(0, 240),
      sourceExcerpt: line.slice(0, 240),
    });
  }
  return facts;
}

export async function extractResumeText(fileName: string, bytes: Uint8Array) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".docx")) {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return result.value ?? "";
  }
  if (lower.endsWith(".pdf")) {
    const { extractTextItems } = await import("unpdf");
    const extracted = await extractTextItems(bytes);
    const lines: string[] = [];
    for (const page of extracted.items) {
      let current = "";
      let lastY: number | null = null;
      let lastEnd = 0;
      for (const item of page) {
        const wrapped = lastY !== null && (Math.abs(item.y - lastY) > 2 || item.x < lastEnd - 1);
        if (wrapped && current.trim()) {
          lines.push(current.trim());
          current = "";
        }
        current = current ? `${current} ${item.str}` : item.str;
        if (item.hasEOL) {
          if (current.trim()) lines.push(current.trim());
          current = "";
          lastY = null;
          lastEnd = 0;
          continue;
        }
        lastY = item.y;
        lastEnd = item.x + item.width;
      }
      if (current.trim()) lines.push(current.trim());
    }
    return lines.join("\n");
  }
  throw new Error("Upload a PDF or DOCX resume.");
}
