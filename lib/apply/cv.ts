import { repo } from "@/lib/db/file-store";
import { ServiceError } from "@/lib/errors";
import { claudeAsk } from "@/lib/apply/fast/pipeline";
import { requireApp, student } from "@/lib/apply/service";
import { applicationProfiles } from "@/lib/apply/store";

/**
 * The CV generator: a one-page CV written from the student's own profile and resume, put in the order
 * that fits the job they're applying to. One AI call; nothing the student didn't say. 1 credit covers
 * CVS_PER_CREDIT CVs, charged on the 1st, 6th, 11th… like applications.
 */

export const CVS_PER_CREDIT = 5;

export const CV_PROMPT = `You write a one-page CV for a college student, as plain text.

Use ONLY facts from the student's profile and resume below. Never add an employer, school, title, date,
number, tool, award, or skill that isn't there. You may reword, reorder, and choose what to include so the
CV fits the job, and you may leave things out.

Format exactly like this, with these section names in capitals, each on its own line, and only the sections
the student has something for:

EDUCATION
School: Degree, Major (Month Year)
• one line, optional (GPA if given, honors, relevant courses)

EXPERIENCE
Title, Organization (Month Year – Month Year)
• what they did and the result, in their own facts, starting with a verb

PROJECTS
Project name
• what it is and what they did

SKILLS
Comma-separated skills

Two to four bullets per role. No summary or objective line, no name or contact details (those are added
separately), no markdown, no commentary before or after the CV.`;

/** Uses the student has left: what remains of the credit already spent, plus CVS_PER_CREDIT per credit. */
export function cvUsesLeft(cvCount: number, credits: number) {
  const remainder = cvCount % CVS_PER_CREDIT;
  return (remainder === 0 ? 0 : CVS_PER_CREDIT - remainder) + Math.max(0, credits) * CVS_PER_CREDIT;
}

/**
 * Drops any line with a number the student never wrote (a made-up percentage, count, or year), so the CV
 * can't claim what the profile and resume don't.
 */
export function groundNumbers(cv: string, source: string) {
  const known = new Set(source.match(/\d[\d,.]*/g)?.map((number) => number.replace(/[,.]$/, "").replace(/,/g, "")) ?? []);
  return cv
    .split("\n")
    .filter((line) => (line.match(/\d[\d,.]*/g) ?? []).every((number) => known.has(number.replace(/[,.]$/, "").replace(/,/g, ""))))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function generateCv(userId: string, raw: unknown) {
  const body = (raw ?? {}) as { applicationId?: unknown };
  const info = await student(userId);
  const count = info.profile.cvCount ?? 0;
  const account = await repo.getAccount(userId);
  const needsCredit = count % CVS_PER_CREDIT === 0;
  if (needsCredit && (account?.balance ?? 0) < 1) throw new ServiceError(`You're out of credits. 1 credit covers ${CVS_PER_CREDIT} CVs.`, "credits", 402);

  const app = typeof body.applicationId === "string" && body.applicationId ? await requireApp(userId, body.applicationId) : null;
  const facts = JSON.stringify({
    education: info.profile.student?.education ?? [],
    experience: info.profile.student?.experience ?? [],
    projects: info.profile.student?.projects ?? [],
    skills: info.profile.student?.skills ?? {},
    inTheirWords: info.profile.student?.essays ?? {},
  });
  const resume = info.resumeText.slice(0, 7000);
  if (!resume.trim() && facts.length < 80) throw new ServiceError("Add your resume or your schools and jobs to your profile first.", "profile", 400);
  const job = app ? `The job: ${app.title} at ${app.company}.\n${app.requirements.slice(0, 10).map((item) => `- ${item}`).join("\n")}\n${app.description.slice(0, 2500)}` : "No specific job: write a general CV.";

  const written = await claudeAsk(userId, "cv")(CV_PROMPT, `${job}\n\nStudent profile (JSON):\n${facts}\n\nResume:\n${resume}`).catch((error) => {
    throw new ServiceError(error instanceof Error && /not configured/i.test(error.message) ? "CV writing isn't set up yet." : "Couldn't write the CV right now. Try again in a minute.", "ai", 503);
  });
  const text = groundNumbers(written.replace(/```[a-z]*\n?|```/g, "").trim(), `${facts}\n${resume}`);
  if (text.length < 80) throw new ServiceError("Couldn't write the CV from your profile. Try again.", "ai", 503);

  // Charged only once a CV was written.
  if (needsCredit) {
    const block = Math.floor(count / CVS_PER_CREDIT);
    const spent = await repo.spendCredits({ userId, amount: 1, idempotencyKey: `cv-block:${userId}:${block}`, note: `CVs ${block * CVS_PER_CREDIT + 1}–${(block + 1) * CVS_PER_CREDIT}`, entryType: "cv_debit" });
    if (spent.insufficient) throw new ServiceError(`You're out of credits. 1 credit covers ${CVS_PER_CREDIT} CVs.`, "credits", 402);
  }
  const stored = (await applicationProfiles.get(userId)) ?? info.profile;
  await applicationProfiles.put(userId, { ...stored, cvCount: count + 1 });

  const name = [info.profile.firstName, info.profile.lastName].filter(Boolean).join(" ") || "Your Name";
  const contact = [info.profile.email, info.profile.phone, info.profile.city, info.profile.linkedin].filter((part): part is string => Boolean(part?.trim()));
  const pdf = await cvPdf(text, { name, contact });
  const credits = (await repo.getAccount(userId))?.balance ?? 0;
  return {
    text: `${name}\n${contact.join(" | ")}\n\n${text}`,
    fileName: `${name} CV${app ? ` - ${app.company}` : ""}.pdf`.replace(/[\\/:*?"<>|]+/g, ""),
    pdfBase64: pdf.toString("base64"),
    usesLeft: cvUsesLeft(count + 1, credits),
  };
}

/** Standard PDF fonts only cover Latin-1; swap the usual suspects so nothing turns into "?". */
const latin1 = (text: string) => text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF•]/g, "");

/** The CV as a one-page PDF: name and contact on top, section names in bold with a rule under them. */
export async function cvPdf(text: string, header: { name: string; contact: string[] }) {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  doc.setTitle(`${header.name} CV`);
  doc.setAuthor(header.name);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const [width, height, margin, size, leading] = [612, 792, 54, 10.5, 14];
  let page = doc.addPage([width, height]);
  let y = height - margin;
  const ensure = (space: number) => {
    if (y - space < margin) {
      page = doc.addPage([width, height]);
      y = height - margin;
    }
  };
  // Helvetica has no "•" glyph in WinAnsi under that code, so bullets are drawn as a small dash.
  const safe = (words: string) => latin1(words).replace(/•/g, "-");
  const wrap = (words: string, font: typeof regular, fontSize: number, indent: number) => {
    const rows: string[] = [];
    let current = "";
    for (const word of safe(words).split(/\s+/).filter(Boolean)) {
      const next = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(next, fontSize) > width - margin * 2 - indent && current) {
        rows.push(current);
        current = word;
      } else current = next;
    }
    if (current) rows.push(current);
    return rows;
  };
  page.drawText(safe(header.name), { x: margin, y, size: 18, font: bold, color: rgb(0.05, 0.05, 0.05) });
  y -= 18;
  const contact = safe(header.contact.join("  |  "));
  if (contact) {
    page.drawText(contact, { x: margin, y, size: 9, font: regular, color: rgb(0.35, 0.35, 0.35) });
    y -= 12;
  }
  let section = "";
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) { y -= 4; continue; }
    if (/^[A-Z][A-Z &/]{2,}$/.test(line)) {
      section = line;
      ensure(30);
      y -= 10;
      page.drawText(safe(line), { x: margin, y, size: 10.5, font: bold, color: rgb(0.05, 0.05, 0.05) });
      y -= 4;
      page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.6, color: rgb(0.7, 0.7, 0.7) });
      y -= leading;
      continue;
    }
    // Bullets and the skills list are regular; school and role lines are bold.
    const bullet = /^[•\-*]\s*/.test(line);
    const plain = bullet || /SKILL/.test(section);
    const indent = bullet ? 12 : 0;
    const rows = wrap(bullet ? line.replace(/^[•\-*]\s*/, "") : line, plain ? regular : bold, size, indent);
    rows.forEach((row, index) => {
      ensure(leading);
      if (bullet && index === 0) page.drawText("-", { x: margin + 2, y, size, font: regular, color: rgb(0.2, 0.2, 0.2) });
      page.drawText(row, { x: margin + indent, y, size, font: plain ? regular : bold, color: rgb(0.1, 0.1, 0.1) });
      y -= leading;
    });
  }
  return Buffer.from(await doc.save());
}
