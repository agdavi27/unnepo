import { beforeEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { coverLetterPdf } from "@/lib/apply/cover-letter";
import { checkPlan, readResumeLayout, tailoredFile } from "@/lib/apply/tailor-resume";
import { planUsage } from "@/lib/apply/limits";
import { addJobByHand } from "@/lib/apply/service";
import { applications } from "@/lib/apply/store";
import { acceptsOnlyPdf, extensionTailoredResume } from "@/lib/extension/service";
import { uploadProfileResume } from "@/lib/profile/service";
import { applyDocxPlan, readDocxLayout } from "@/lib/resume/docx-tailor";
import { stripText } from "@/lib/resume/pdf-tailor";
import { classify, linesFromText } from "@/lib/resume/tailor-lines";
import { login, signUp, verifyEmail } from "@/lib/services/auth";
import { useTempDb } from "./helpers";

const model = vi.hoisted(() => ({ replies: [] as string[], prompts: [] as string[] }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: async (input: { messages: Array<{ content: string }> }) => {
        model.prompts.push(input.messages[0].content);
        return { content: [{ type: "text", text: model.replies.shift() ?? "{}" }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10 } };
      },
    };
  },
}));

const RESUME = [
  "Pat Doe",
  "pat.doe@colby.edu | 207-555-0100 | Waterville, ME",
  "SUMMARY",
  "Economics student at Colby College who builds dashboards in Tableau and cleans data in Python and SQL.",
  "EDUCATION",
  "Colby College, B.A. Economics, Expected May 2027",
  "EXPERIENCE",
  "Data Analyst Intern, Maine Credit Union, May 2024 - August 2024",
  "• Built loan dashboards in Tableau used by the lending team",
  "• Cleaned member data in Python and SQL each week",
  "• Answered member questions at the front desk",
  "Barista, Colby Dining, September 2023 - Present",
  "• Trained 6 new baristas on the espresso machines",
  "SKILLS",
  "Tools: Python, SQL, Tableau, Excel",
].join("\n");

describe("the resume as lines", () => {
  it("knows bullets, the summary and skills lines from the fixed ones, and groups bullets by entry", () => {
    const lines = linesFromText(RESUME);
    expect(lines.map((line) => line.kind)).toEqual(["fixed", "fixed", "section", "summary", "section", "fixed", "section", "fixed", "bullet", "bullet", "bullet", "fixed", "bullet", "section", "skills"]);
    expect(lines[8].group).toBe(lines[10].group);
    expect(lines[12].group).not.toBe(lines[8].group);
    expect(classify([{ text: "Relevant Experience", bullet: false }])[0].kind).toBe("section");
  });
});

describe("checking the changes against the resume", () => {
  const lines = linesFromText(RESUME);
  it("keeps rewording that uses only the resume's facts, and a new order of one entry's bullets", () => {
    const plan = checkPlan(lines, { edits: { 9: "Cleaned and prepared member data each week using Python and SQL" }, order: { 1: [9, 8, 10] } });
    expect(plan.edits).toEqual({ 9: "Cleaned and prepared member data each week using Python and SQL" });
    expect(plan.order).toEqual({ 1: [9, 8, 10] });
  });

  it("drops a change to a fixed line, a new tool or number, a moved number, and a bullet grown too long", () => {
    const plan = checkPlan(lines, { edits: {
      7: "Senior Data Analyst, Maine Credit Union, May 2024 - August 2024",
      8: "Built loan dashboards in Tableau and Power BI for the lending team",
      9: "Cleaned member data in Python and SQL for 6 teams",
      12: "Trained 12 new baristas on the espresso machines",
      10: "Answered member questions at the front desk, helping members with their accounts, loans, cards and every other kind of question they had",
    } });
    expect(plan.edits).toEqual({});
  });

  it("keeps a skills line's label and only skills the resume names; the summary may use the job's title", () => {
    const plan = checkPlan(lines, { edits: {
      14: "Tools: SQL, Snowflake, Tableau, Python, Excel",
      3: "Economics student at Colby College ready for a Business Intelligence role, who cleans data in Python and SQL.",
    } }, { title: "Business Intelligence Intern" });
    expect(plan.edits[14]).toBe("Tools: SQL, Tableau, Python, Excel");
    expect(plan.edits[3]).toContain("Business Intelligence");
    expect(checkPlan(lines, { edits: { 3: "Economics student drawn to Acme, who cleans data in Python and SQL." } }).edits).toEqual({});
  });

  it("refuses an order that isn't the same bullets of one group", () => {
    expect(checkPlan(lines, { order: { 1: [9, 8] } }).order).toEqual({});
    expect(checkPlan(lines, { order: { 1: [9, 8, 12] } }).order).toEqual({});
  });
});

/** A small Word resume: bold headings, a right tab for dates, bullets from Word's list numbering, a bold skills label. */
async function docx() {
  const run = (text: string, props = "") => `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${text}</w:t></w:r>`;
  const p = (inner: string, pPr = "") => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}${inner}</w:p>`;
  const bullet = (text: string) => p(run(text, "<w:sz w:val=\"21\"/>"), `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>`);
  const body = [
    p(run("Pat Doe", "<w:b/><w:sz w:val=\"36\"/>"), `<w:jc w:val="center"/>`),
    p(run("pat.doe@colby.edu | 207-555-0100")),
    p(run("EXPERIENCE", "<w:b/>"), `<w:pBdr><w:bottom w:val="single" w:sz="6"/></w:pBdr>`),
    p(`${run("Data Analyst Intern, Maine Credit Union", "<w:b/>")}<w:r><w:tab/></w:r>${run("May 2024 - August 2024")}`, `<w:tabs><w:tab w:val="right" w:pos="10080"/></w:tabs>`),
    bullet("Built loan dashboards in Tableau used by the lending team"),
    bullet("Cleaned member data in Python and SQL each week"),
    p(run("SKILLS", "<w:b/>")),
    p(`${run("Tools:", "<w:b/>")}${run(" Python, SQL, Tableau, Excel")}`),
  ].join("");
  const zip = new JSZip();
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1008" w:right="1080" w:bottom="1008" w:left="1080"/></w:sectPr></w:body></w:document>`);
  zip.file("[Content_Types].xml", "<Types/>");
  return zip.generateAsync({ type: "uint8array" });
}

describe("a Word resume", () => {
  it("is edited in place: new words in the same runs, bullets reordered, everything else as it was", async () => {
    const original = await docx();
    const layout = (await readDocxLayout(original))!;
    expect(layout.lines.map((line) => line.kind)).toEqual(["fixed", "fixed", "section", "fixed", "bullet", "bullet", "section", "skills"]);
    const edited = await applyDocxPlan(original, { edits: { 4: "Built Tableau dashboards for the lending team's loan reporting", 7: "Tools: SQL, Python, Tableau, Excel" }, order: { 1: [5, 4] } });
    const xml = await (await JSZip.loadAsync(edited)).file("word/document.xml")!.async("string");
    const before = await (await JSZip.loadAsync(original)).file("word/document.xml")!.async("string");
    // The bullet keeps its run's size and list numbering; the order changed; the label stays bold and the list follows.
    expect(xml).toContain("<w:sz w:val=\"21\"/></w:rPr><w:t xml:space=\"preserve\">Built Tableau dashboards for the lending team's loan reporting</w:t>");
    expect(xml.indexOf("Cleaned member data")).toBeLessThan(xml.indexOf("Built Tableau dashboards"));
    expect(xml).toContain("<w:b/></w:rPr><w:t xml:space=\"preserve\">Tools:</w:t>");
    expect(xml).toContain("> SQL, Python, Tableau, Excel</w:t>");
    expect(xml.match(/<w:numPr>/g)?.length).toBe(2);
    // The heading with its tab and date, and the name, are byte for byte the same.
    for (const fixed of ["<w:tabs><w:tab w:val=\"right\" w:pos=\"10080\"/></w:tabs>", "May 2024 - August 2024", "Pat Doe"]) expect(xml.includes(fixed)).toBe(before.includes(fixed));
  });

  it("comes out as a Word file, or as a PDF when the form only takes PDFs", async () => {
    const original = await docx();
    const layout = await readResumeLayout({ bytes: original, fileName: "Pat.docx", text: "" });
    const plan = { edits: { 4: "Built Tableau dashboards for the lending team's loan reporting" }, order: {} };
    const word = await tailoredFile(layout, original, plan, { name: "Pat Doe", contact: [], title: "Pat Doe Resume" });
    expect(word).toMatchObject({ ext: "docx", look: "original" });
    const pdf = await tailoredFile(layout, original, plan, { name: "Pat Doe", contact: [], title: "Pat Doe Resume" }, { pdfOnly: true });
    expect(pdf).toMatchObject({ ext: "pdf", look: "matched" });
    expect(Buffer.from(pdf.bytes).subarray(0, 5).toString()).toBe("%PDF-");
    expect(acceptsOnlyPdf(".pdf,application/pdf")).toBe(true);
    expect(acceptsOnlyPdf(".pdf,.doc,.docx")).toBe(false);
    expect(acceptsOnlyPdf("")).toBe(false);
  });
});

describe("a PDF resume", () => {
  it("has its text taken out of the page, keeping the drawing and the colors after it", () => {
    const stream = "q 0.2 0.3 0.5 rg BT /F1 12 Tf 72 700 Td (Hello) Tj 1 0 0 rg ET 72 690 200 1 re f Q";
    const { bytes, shown } = stripText(new TextEncoder().encode(stream));
    const out = new TextDecoder().decode(bytes);
    expect(out).not.toMatch(/Tj|Tf|BT|ET|Hello/);
    expect(out).toMatch(/1 0 0 rg/);
    expect(out).toMatch(/re\s+f/);
    expect(shown[0]).toMatchObject({ x: 72, y: 700, color: [0.2, 0.3, 0.5] });
  });

  it("is redrawn to match, with the changed bullet in place and the same page count", async () => {
    const original = await coverLetterPdf(RESUME, { name: "Pat Doe", contact: [] });
    const layout = await readResumeLayout({ bytes: new Uint8Array(original), fileName: "Pat.pdf", text: "" });
    expect(layout.kind).toBe("pdf");
    const bullet = layout.lines.find((line) => line.text.startsWith("Cleaned member data"))!;
    expect(bullet.kind).toBe("bullet");
    const file = await tailoredFile(layout, new Uint8Array(original), { edits: { [bullet.id]: "Prepared member data each week in Python and SQL" }, order: {} }, { name: "Pat Doe", contact: [], title: "Pat Doe Resume" });
    expect(file).toMatchObject({ ext: "pdf", look: "matched" });
    const { extractText } = await import("unpdf");
    const text = (await extractText(new Uint8Array(file.bytes), { mergePages: true })).text;
    expect(text).toContain("Prepared member data each week in Python and SQL");
    expect(text).not.toContain("Cleaned member data");
    expect(text).toContain("Data Analyst Intern, Maine Credit Union");
  });
});

describe("Tailor my resume to this job", () => {
  beforeEach(() => {
    useTempDb();
    model.replies.length = 0;
    model.prompts.length = 0;
  });

  async function studentWithResume() {
    const signed = await signUp({ email: "pat.doe@colby.edu", password: "password123", name: "Pat Doe" });
    await verifyEmail(signed.verifyToken!);
    const userId = (await login("pat.doe@colby.edu", "password123")).user.id;
    const pdf = await coverLetterPdf(RESUME, { name: "Pat Doe", contact: [] });
    await uploadProfileResume(userId, { name: "Pat Doe Resume.pdf", type: "application/pdf", bytes: new Uint8Array(pdf) });
    process.env.ANTHROPIC_API_KEY = "anthropic";
    return userId;
  }
  const job = { title: "Data Analyst Intern", company: "Acme", description: "We want SQL and Tableau dashboards for our lending team." };
  const reply = (lines: Array<{ id: number; text: string }>) => JSON.stringify({ edits: { [lines.find((line) => line.text.startsWith("Cleaned member"))!.id]: "Prepared member data each week in Python and SQL" } });

  it("tailors to the whole posting on Free, in the resume's layout, and counts one of Free's 3 tailored resumes (not a cover letter)", async () => {
    const userId = await studentWithResume();
    const before = await planUsage(userId);
    expect(before.free).toBe(true);
    expect(before.resumes).toMatchObject({ limit: 3, left: 3 });
    const layout = await readResumeLayout({ bytes: new Uint8Array(await coverLetterPdf(RESUME, { name: "Pat Doe", contact: [] })), fileName: "x.pdf", text: "" });
    model.replies.push(reply(layout.lines));
    const made = await extensionTailoredResume(userId, { job });
    expect(made).toMatchObject({ fileName: "Pat Doe Resume - Acme.pdf", mime: "application/pdf", look: "matched" });
    expect(model.prompts.at(-1)).toContain("lending team.");
    const after = await planUsage(userId);
    expect(after.resumes.left).toBe(2);
    expect(after.letters.left).toBe(before.letters.left);
  });

  it("says plainly when Free's tailored resumes are used up, in its own words", async () => {
    const userId = await studentWithResume();
    const { applicationProfiles } = await import("@/lib/apply/store");
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    await applicationProfiles.change(userId, (fresh) => ({ uses: { ...(fresh.uses ?? { total: {}, month: "", monthly: {} }), day, daily: { resumes: 3 } } }));
    await expect(extensionTailoredResume(userId, { job })).rejects.toThrow("No tailored resumes left today. More tomorrow, or Pro has no limit.");
    expect((await planUsage(userId)).letters.left).toBe(3);
  });

  it("keeps the changes with a tracked job: asking again, or an outreach email, draws it at no cost", async () => {
    const userId = await studentWithResume();
    const { application } = await addJobByHand(userId, { title: "Data Analyst Intern", company: "Acme" });
    expect(await extensionTailoredResume(userId, { applicationId: application.id, cachedOnly: true })).toEqual({ none: true });
    const layout = await readResumeLayout({ bytes: new Uint8Array(await coverLetterPdf(RESUME, { name: "Pat Doe", contact: [] })), fileName: "x.pdf", text: "" });
    model.replies.push(reply(layout.lines));
    await extensionTailoredResume(userId, { applicationId: application.id });
    expect((await applications.get(userId, application.id))?.fillReport?.tailoredResume?.plan.edits).toBeTruthy();
    const calls = model.prompts.length;
    const again = await extensionTailoredResume(userId, { applicationId: application.id });
    const outreach = await extensionTailoredResume(userId, { applicationId: application.id, cachedOnly: true });
    expect(model.prompts.length).toBe(calls);
    expect(outreach).toMatchObject({ fileName: "Pat Doe Resume - Acme.pdf" });
    expect("base64" in again && again.base64).toBeTruthy();
    expect((await planUsage(userId)).resumes.left).toBe(2);
  });

  it("fails plainly, without counting, when nothing holds up, so the saved resume is offered", async () => {
    const userId = await studentWithResume();
    model.replies.push(JSON.stringify({ edits: { 0: "Patricia Doe, PhD" } }));
    await expect(extensionTailoredResume(userId, { job })).rejects.toThrow(/saved resume/);
    expect((await planUsage(userId)).resumes.left).toBe(3);
    await expect(extensionTailoredResume(userId, {})).rejects.toThrow(/job posting/);
  });
});
