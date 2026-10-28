import { bestOption } from "@/lib/apply/options";
import type { ApplicationProfile, ApplicationQuestion } from "@/lib/apply/types";

/**
 * Questions AI must never answer: identity, demographics, legal status, and pay. These come only
 * from answers the student typed and saved, or the student answers them on the form.
 */
const SENSITIVE = /\b(gender|sex|pronouns?|race|racial|ethnic|ethnicity|hispanic|latin[oax]|veteran|military|disabilit|sexual orientation|transgender|lgbt|age|date of birth|birth ?date|criminal|convict|felony|arrest|salary|compensation|pay expectations?|desired pay|visa|sponsor|sponsorship|authori[sz]ed to work|work authori[sz]ation|right to work|citizen|citizenship|social security|ssn|religio|marital|national origin|background check|drug test|entitled to work|eligible to work|legally|attest|attestation|acknowledge?|acknowledgement|privacy (?:policy|notice)|consent|certify|non-compete|non-solicitation|agree)\b/i;

type StandardField = keyof Pick<ApplicationProfile, "firstName" | "lastName" | "email" | "phone" | "linkedin" | "website" | "github" | "city" | "addressLine1" | "state" | "postalCode" | "country"> | "fullName" | "school" | "major" | "graduationYear" | "resume" | "coverLetter" | "phoneType" | "phoneExtension";

const STANDARD: Array<[RegExp, StandardField]> = [
  [/^(legal )?first name\b|^given name/i, "firstName"],
  [/^(legal )?last name\b|^surname|^family name/i, "lastName"],
  [/^(full |legal )?name\b(?!.*(company|school|employer|reference|university))/i, "fullName"],
  [/\be-?mail\b/i, "email"],
  [/^(address line 1|street address|address 1|address|street)$/i, "addressLine1"],
  [/^(state|province|state\/province|state or province|region)$/i, "state"],
  [/^(postal code|zip|zip code|zip\/postal code|postcode)$/i, "postalCode"],
  [/^(country|country\/territory|country\/region|country phone code|phone country code)$/i, "country"],
  // Workday asks what kind of phone the number is before the number itself.
  [/\b(phone|device) (device )?type\b|type of (phone|device)|phone number type/i, "phoneType"],
  [/\b(phone )?extension\b|^ext\.?$/i, "phoneExtension"],
  [/\b(phone|mobile|cell)\b/i, "phone"],
  [/linkedin/i, "linkedin"],
  [/github/i, "github"],
  [/\b(website|portfolio|personal site|blog)\b/i, "website"],
  [/^(current )?(city|location)\b|where are you (currently )?(based|located)/i, "city"],
  [/\b(school|university|college|institution)\b(?!.*(year|date|gpa))/i, "school"],
  [/\b(major|discipline|field of study|area of study|concentration)\b/i, "major"],
  [/\b(graduation|grad) (year|date)\b|expected graduation|when do you graduate/i, "graduationYear"],
  [/\b(resume|cv)\b/i, "resume"],
  [/cover letter/i, "coverLetter"],
];

export function classifyQuestion(label: string): { sensitive: boolean; field: StandardField | null } {
  const text = label.trim();
  const field = STANDARD.find(([pattern]) => pattern.test(text))?.[1] ?? null;
  // A plain contact field is never sensitive, even when the label mentions "legal".
  const sensitive = field && field !== "city" ? false : SENSITIVE.test(text);
  return { sensitive, field: sensitive ? null : field };
}

export function normalizeLabel(label: string) {
  return label.toLowerCase().replace(/[*?:()]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
}

/** Contact details the resume states outright. Nothing is inferred. */
export function contactFromResume(text: string) {
  const phone = text.match(/(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/)?.[0]?.trim() ?? "";
  const linkedin = text.match(/(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[A-Za-z0-9_%-]+\/?/i)?.[0] ?? "";
  const github = text.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9-]+\/?/i)?.[0] ?? "";
  const withScheme = (value: string) => (value && !/^https?:\/\//i.test(value) ? `https://${value}` : value);
  return { phone, linkedin: withScheme(linkedin), github: withScheme(github) };
}

export type AnswerContext = {
  profile: ApplicationProfile;
  school: string;
  majors: string[];
  graduationYear: string;
  resumeFileName: string | null;
};

function standardAnswer(field: StandardField, context: AnswerContext): { answer: string; source: string } | null {
  const p = context.profile;
  const pick = (value: string, source = "profile") => (value.trim() ? { answer: value.trim(), source } : null);
  switch (field) {
    case "firstName": return pick(p.firstName);
    case "lastName": return pick(p.lastName);
    case "fullName": return pick([p.firstName, p.lastName].filter(Boolean).join(" "));
    case "email": return pick(p.email);
    case "phone": return pick(p.phone);
    case "linkedin": return pick(p.linkedin);
    case "github": return pick(p.github);
    case "website": return pick(p.website);
    case "city": return pick(p.city);
    case "addressLine1": return pick(p.addressLine1 ?? "");
    case "state": return pick(p.state ?? "");
    case "postalCode": return pick(p.postalCode ?? "");
    case "country": return pick(p.country ?? "");
    case "school": return pick(context.school);
    case "major": return pick(context.majors[0] ?? "");
    case "graduationYear": return pick(context.graduationYear);
    case "resume": return context.resumeFileName ? { answer: context.resumeFileName, source: "resume_file" } : null;
    case "coverLetter": return null;
    // A student's application number is their own cell; they can change it in the live view.
    case "phoneType": return { answer: "Mobile", source: "default" };
    case "phoneExtension": return null;
  }
}

/** Other names sites use for the same answer. */
const SAME_ANSWER: Record<string, string[]> = { mobile: ["Cell", "Cell Phone", "Mobile Phone", "Cellular", "Personal Mobile"] };

function matchOption(answer: string, options: string[]) {
  if (!options.length) return answer;
  for (const candidate of [answer, ...(SAME_ANSWER[answer.toLowerCase()] ?? [])]) {
    const match = bestOption(candidate, options);
    if (match) return match;
  }
  return null;
}

/**
 * Fills what can be filled without guessing: contact fields, education, the resume file, and answers
 * the student saved before. Sensitive questions stay empty unless the student saved an answer.
 */
export function planAnswers(questions: ApplicationQuestion[], context: AnswerContext) {
  return questions.map((question) => {
    if (question.answer && question.source === "student") return question;
    const saved = context.profile.saved[normalizeLabel(question.label)];
    if (saved) {
      const answer = question.kind === "select" ? matchOption(saved.answer, question.options) : saved.answer;
      if (answer) return { ...question, answer, source: "saved", evidence: null };
    }
    const { field, sensitive } = classifyQuestion(question.label);
    if (sensitive || question.sensitive) return { ...question, sensitive: true, answer: null, source: null, evidence: null };
    const fileMatches = (field === "resume" || field === "coverLetter") === (question.kind === "file");
    if (field && fileMatches && question.label.length <= 70 && question.kind !== "checkbox" && question.kind !== "multiselect") {
      const found = standardAnswer(field, context);
      if (found) {
        const answer = question.kind === "select" ? matchOption(found.answer, question.options) : found.answer;
        if (answer) return { ...question, answer, source: found.source, evidence: null };
      }
    }
    return question.source === "ai" && question.answer ? question : { ...question, answer: null, source: null, evidence: null };
  });
}

/** Required questions that still have no answer. */
export function missingAnswers(questions: ApplicationQuestion[]) {
  // Autofill writes the cover letter from the resume and the posting, so it doesn't block starting.
  return questions.filter((question) => question.required && !question.answer?.trim() && classifyQuestion(question.label).field !== "coverLetter");
}

function squash(text: string) {
  return text.toLowerCase().replace(/[\s ]+/g, " ").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim();
}

/** An AI answer is kept only if its quoted evidence appears in the student's own profile or resume. */
export function acceptAiAnswer(question: ApplicationQuestion, answer: string, evidence: string, sources: string) {
  if (question.sensitive || classifyQuestion(question.label).sensitive) return null;
  const quote = squash(evidence);
  if (quote.length < 4 || !squash(sources).includes(quote)) return null;
  if (question.kind === "select") return matchOption(answer, question.options);
  if (question.kind === "file" || question.kind === "unknown") return null;
  return answer.trim().slice(0, question.kind === "textarea" ? 2000 : 300) || null;
}

export const AI_ANSWER_PROMPT = `You help a college student fill out a job application. You get the open form questions and the student's own profile and resume.
For each question, answer only if the profile or resume directly supports the answer. Quote the exact supporting words from the profile or resume in "evidence", copied character for character.
Rules:
- Never invent experience, dates, numbers, skills, schools, or employers.
- Never answer questions about gender, race, ethnicity, veteran or disability status, age, citizenship, visa sponsorship, work authorization, salary, or criminal history. Skip them.
- For questions with options, the answer must be exactly one of the options.
- For short essay questions, write two to four plain sentences that use only facts from the profile or resume, and quote the main fact you used as evidence.
- If you can't support an answer, leave that question out.
Return only JSON: {"answers":[{"key":"...","answer":"...","evidence":"..."}]}`;
