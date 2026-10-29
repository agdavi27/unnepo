import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { mapAnswers } from "@/lib/apply/fast/mapper";
import { knownAnswers, mappingFromQuestions, questionsFromMapping } from "@/lib/apply/fast/pipeline";
import { parseGreenhouse, type GreenhouseJobJson } from "@/lib/apply/fast/schema";
import { planAnswers } from "@/lib/apply/questions";
import { degreeAnswer, keepStated, resumeFieldAnswer } from "@/lib/apply/resume-profile";
import type { ApplicationProfile } from "@/lib/apply/types";

/** Saved copies of real public Greenhouse postings (Job Board API, questions=true). */
const fixture = (name: string) => JSON.parse(readFileSync(path.join(__dirname, "fixtures", name), "utf8")) as GreenhouseJobJson;
const anthropic = parseGreenhouse(fixture("greenhouse-anthropic.json"), "anthropic", "5456619008");
const stripe = parseGreenhouse(fixture("greenhouse-stripe.json"), "stripe", "8172487");

describe("Greenhouse schema", () => {
  it("reads every question with its type, options, and the form's own extras", () => {
    const by = (id: string) => anthropic.fields.find((field) => field.id === id);
    expect(anthropic.formUrl).toBe("https://job-boards.greenhouse.io/embed/job_app?for=anthropic&token=5456619008");
    expect(by("first_name")).toMatchObject({ type: "text", required: true, section: "core" });
    expect(by("email")?.type).toBe("email");
    expect(by("phone")?.type).toBe("tel");
    expect(by("resume")).toMatchObject({ type: "file", required: true });
    // The paste-instead box duplicates the file field and is dropped.
    expect(by("resume_text")).toBeUndefined();
    expect(by("question_19018739008")).toMatchObject({ type: "select", required: true, options: [{ label: "Yes", value: expect.any(String) }, { label: "No", value: expect.any(String) }] });
    expect(by("question_19018743008")).toMatchObject({ label: "Why Anthropic?", type: "textarea" });
    // Legal agreements, sponsorship, and EEOC questions are never AI's to answer.
    expect(by("question_19018752008")?.sensitive).toBe(true);
    expect(by("question_19018745008")?.sensitive).toBe(true);
    expect(by("gender")).toMatchObject({ section: "eeoc", sensitive: true, type: "select" });
    expect(by("veteran_status")?.label).toBe("Veteran Status");
    expect(by("country")).toMatchObject({ type: "phone_country", ifPresent: true });
    expect(by("school--0")?.type).toBe("school");
    expect(anthropic.description).not.toMatch(/&lt;|<p>/);
  });

  it("handles multi-selects, cover letters, and location questions", () => {
    const by = (id: string) => stripe.fields.find((field) => field.id === id);
    expect(by("question_68935297[]")).toMatchObject({ type: "multiselect", required: true });
    expect(by("question_68935297[]")!.options.length).toBe(30);
    expect(by("question_68935296")!.options.length).toBe(31);
    expect(by("cover_letter")).toMatchObject({ type: "file", required: false });
    expect(by("cover_letter_text")).toBeUndefined();
    expect(by("candidate-location")).toMatchObject({ type: "location", required: true });
    expect(by("latitude")).toBeUndefined();
  });
});

const profile: ApplicationProfile = {
  firstName: "Pat", lastName: "Doe", email: "pat@colby.edu", phone: "207-555-0100", linkedin: "https://linkedin.com/in/patdoe", website: "", github: "",
  city: "Waterville", state: "Maine", country: "United States", saved: {}, accountConsentAt: "2026-10-01T00:00:00Z",
  eligibility: { workAuthorized: "Yes", needsSponsorship: "No", over18: "Yes" },
};
const resumeText = "Pat Doe. Colby College, B.A. Economics, Expected May 2027. Data Analyst Intern, Maine Credit Union, May 2024 - August 2024. Built loan dashboards in Tableau used by the lending team.";
const resumeProfile = keepStated({ education: [{ school: "Colby College", degree: "B.A.", field: "Economics", end: "Expected May 2027" }], experience: [{ title: "Data Analyst Intern", company: "Maine Credit Union", start: "May 2024", end: "August 2024" }] }, resumeText, "h");
const context = { profile: { ...profile, resumeProfile }, school: "Colby College", majors: ["Economics"], graduationYear: "2027", resumeFileName: "Pat Doe Resume.pdf" };
const answerFor = (label: string, kind: Parameters<typeof planAnswers>[0][number]["kind"], options: string[], where?: { section?: string; format?: string | null }) => {
  const [planned] = planAnswers([{ key: label, label, kind, required: false, options, sensitive: false, answer: null, source: null, evidence: null }], context);
  if (planned.source === "saved" || planned.source === "student") return planned.answer;
  return resumeFieldAnswer(resumeProfile, { label, section: where?.section, kind, options, format: where?.format }) ?? (planned.source !== "resume_file" ? planned.answer : null);
};
const known = knownAnswers({ answerFor, profile: context.profile, school: "Colby College", resumeProfile });

describe("Greenhouse degree options", () => {
  it("picks the right degree, never turning B.A. into M.B.A.", () => {
    const options = ["Associate's Degree", "Bachelor's Degree", "Doctor of Medicine (M.D.)", "Doctor of Philosophy (Ph.D.)", "Engineer's Degree", "High School", "Juris Doctor (J.D.)", "Master of Business Administration (M.B.A.)", "Master's Degree", "Other"];
    expect(["B.A.", "BA", "B.S.", "Bachelor of Arts", "M.B.A.", "MBA", "M.S.", "Master of Science", "Ph.D.", "BS in Economics"].map((degree) => degreeAnswer(degree, options))).toEqual([
      "Bachelor's Degree", "Bachelor's Degree", "Bachelor's Degree", "Bachelor's Degree",
      "Master of Business Administration (M.B.A.)", "Master of Business Administration (M.B.A.)",
      "Master's Degree", "Master's Degree", "Doctor of Philosophy (Ph.D.)", "Bachelor's Degree",
    ]);
  });
});

describe("field mapping", () => {
  it("answers what's on file without AI, makes one call for the rest, and keeps only grounded answers", async () => {
    const asked: string[] = [];
    const mapped = await mapAnswers({
      schema: stripe,
      known,
      facts: "First name: Pat\nAuthorized to work in the United States: Yes",
      sources: resumeText,
      consent: true,
      resumeFileName: "Pat Doe Resume.pdf",
      ask: async (_system, content) => {
        asked.push(content);
        return JSON.stringify({ answers: [
          { id: "question_68935295", value: "Data Analyst Intern", source: "resume", evidence: "Data Analyst Intern" },
          { id: "question_68935296", value: "Narnia", source: "profile", evidence: "First name: Pat" },
          { id: "question_68935297[]", value: ["US", "Atlantis"], source: "student_answer", evidence: "Authorized to work in the United States: Yes" },
          { id: "question_69457836", value: "Yes", source: "resume", evidence: "invented consent" },
        ] });
      },
    });
    expect(mapped.llmCalls).toBe(1);
    const value = (id: string) => mapped.answers.get(id)?.values;
    // From the student's details and eligibility answers: no AI needed.
    expect(value("first_name")).toEqual(["Pat"]);
    expect(value("question_68935298")).toEqual(["Yes"]);
    expect(value("question_68935299")).toEqual(["No"]);
    expect(value("candidate-location")).toEqual(["Waterville, Maine"]);
    expect(value("school--0")).toEqual(["Colby College"]);
    expect(value("resume")).toEqual(["Pat Doe Resume.pdf"]);
    // Only the fields nothing on file answered went to the model, in one call.
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("question_68935295");
    expect(asked[0]).not.toContain('"id":"first_name"');
    // "Who is your current or previous employer?" comes straight from the resume's latest job.
    expect(asked[0]).not.toContain('"id":"question_68935294"');
    // Grounded answers kept; an option that doesn't exist and an unsupported quote dropped.
    expect(value("question_68935294")).toEqual(["Maine Credit Union"]);
    expect(value("question_68935295")).toEqual(["Data Analyst Intern"]);
    expect(value("question_68935296")).toBeUndefined();
    expect(value("question_68935297[]")).toEqual(["US"]);
    expect(value("question_69457836")).toBeUndefined();
  });

  it("round-trips through the review screen, keeping the student's edits", () => {
    const answers = new Map([["question_68935297[]", { id: "question_68935297[]", values: ["US", "CA"], source: "ai", why: null }]]);
    const questions = questionsFromMapping(stripe, answers);
    const multi = questions.find((question) => question.key === "question_68935297[]")!;
    expect(multi).toMatchObject({ kind: "multiselect", answer: "US\nCA" });
    multi.answer = "US";
    expect(mappingFromQuestions(stripe, questions).get("question_68935297[]")?.values).toEqual(["US"]);
  });
});
