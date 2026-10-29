import { bestOption } from "@/lib/apply/options";
import type { ApplicationProfile, ApplicationQuestion } from "@/lib/apply/types";

/**
 * Questions AI must never answer: identity, demographics, legal status, and pay. These come only
 * from answers the student typed and saved, or the student answers them on the form.
 */
const SENSITIVE = /\b(gender|sex|pronouns?|race|racial|ethnic|ethnicity|hispanic|latin[oax]|veteran|military|disabilit|sexual orientation|transgender|lgbt|age|date of birth|birth ?date|criminal|convict|felony|arrest|salary|compensation|pay expectations?|desired pay|visa|sponsor|sponsorship|authori[sz]ed to work|work authori[sz]ation|right to work|citizen|citizenship|social security|ssn|religio|marital|national origin|background check|drug test|entitled to work|eligible to work|legally|attest|attestation|acknowledge?|acknowledgement|privacy (?:policy|notice)|consent|certify|non-compete|non-solicitation|agree)\b/i;

type StandardField = keyof Pick<ApplicationProfile, "firstName" | "lastName" | "email" | "phone" | "linkedin" | "website" | "github" | "city" | "addressLine1" | "state" | "postalCode" | "country"> | "fullName" | "school" | "major" | "graduationYear" | "resume" | "coverLetter" | "phoneType" | "phoneExtension" | "hearAbout" | "currentStudent";

const STANDARD: Array<[RegExp, StandardField]> = [
  [/^(legal )?first name\b|^given name/i, "firstName"],
  [/^(legal )?last name\b|^surname|^family name/i, "lastName"],
  [/^preferred (first )?name\b|^nickname/i, "firstName"],
  [/^(full |legal )?name\b(?!.*(company|school|employer|reference|university))/i, "fullName"],
  [/currently (a )?(student|enrolled)|are you (a )?(current|currently enrolled) (student|undergraduate)|currently attending/i, "currentStudent"],
  [/\be-?mail\b/i, "email"],
  [/^(address line 1|street address|address 1|address|street)$/i, "addressLine1"],
  [/^(state|province|state\/province|state or province|region)$/i, "state"],
  [/^(postal code|zip|zip code|zip\/postal code|postcode)$/i, "postalCode"],
  [/^(country|country\/territory|country\/region|country phone code|phone country code)$/i, "country"],
  // Workday asks what kind of phone the number is before the number itself.
  [/\b(phone|device) (device )?type\b|type of (phone|device)|phone number type/i, "phoneType"],
  [/\b(phone )?extension\b|^ext\.?$/i, "phoneExtension"],
  [/\b(phone|mobile|cell)\b/i, "phone"],
  [/how did you (hear|find out|learn) (about|of)|where did you (hear|find|see)|(referral|application|candidate|lead) source|^source$/i, "hearAbout"],
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
    // Unnepo opened the company's own posting, so its careers site is where the student found it.
    case "hearAbout": return { answer: "Company website", source: "default" };
    case "currentStudent": return Number(context.graduationYear) >= new Date().getFullYear() ? { answer: "Yes", source: "profile" } : null;
  }
}

export const DEMOGRAPHIC = /\b(gender|sex|race|racial|ethnic|ethnicity|hispanic|latin[oax]|veteran|disabilit|sexual orientation|transgender|lgbt)/i;
export const DECLINE = /(decline|prefer not|don['’]?t wish|do not wish|not to (say|answer|disclose|self-identify)|choose not|rather not|i don['’]?t want to answer)/i;

/** The words forms use for each self-identification choice in the student profile. */
const EEO_WORDS: Record<string, string[]> = {
  woman: ["Woman", "Female"], man: ["Man", "Male"], non_binary: ["Non-binary", "Nonbinary"], other: ["Another gender", "Other"],
  american_indian: ["American Indian or Alaska Native"], asian: ["Asian"], black: ["Black or African American", "Black"], pacific_islander: ["Native Hawaiian or Other Pacific Islander"],
  white: ["White"], two_or_more: ["Two or More Races", "Two or more races"],
  yes: ["Yes"], no: ["No"], not_protected: ["I am not a protected veteran", "Not a protected veteran"], protected: ["I identify as one or more of the classifications of a protected veteran", "Protected veteran"],
};

function selfIdentified(label: string, options: string[], profile: ApplicationProfile) {
  const eeo = profile.student?.eeo;
  if (!eeo) return null;
  const key = /veteran/i.test(label) ? "veteran" : /disabilit/i.test(label) ? "disability" : /hispanic|latin/i.test(label) ? "hispanicLatino" : /race|ethnic/i.test(label) ? "race" : /gender|\bsex\b/i.test(label) ? "gender" : null;
  const value = key ? eeo[key as keyof typeof eeo] : "";
  if (!value || value === "decline") return null;
  if (key === "disability") return options.find((option) => (value === "yes" ? /^yes/i : /^no/i).test(option)) ?? null;
  for (const word of EEO_WORDS[value] ?? []) {
    const match = bestOption(word, options);
    if (match) return match;
  }
  return null;
}

/** Eligibility questions answered from what the student set once in their details. Nothing here is guessed. */
const ELIGIBILITY: Array<[RegExp, keyof NonNullable<ApplicationProfile["eligibility"]>]> = [
  [/sponsor/i, "needsSponsorship"],
  [/(authori[sz]ed|eligible|permitted|legally (able|allowed)) to work|right to work|work authori[sz]ation|employment eligibility/i, "workAuthorized"],
  [/\b(at least|over|older than) (the age of )?18\b|\b18 (years )?(of age )?or older\b|\b18\+|legal (working )?age/i, "over18"],
];

export function eligibilityAnswer(label: string, profile: ApplicationProfile) {
  const key = ELIGIBILITY.find(([pattern]) => pattern.test(label))?.[1];
  const value = key ? profile.eligibility?.[key]?.trim() : "";
  return value || null;
}

/** Other names sites use for the same answer. */
const SAME_ANSWER: Record<string, string[]> = {
  mobile: ["Cell", "Cell Phone", "Mobile Phone", "Cellular", "Personal Mobile"],
  "company website": ["Company Careers Site", "Company Career Site", "Careers Site", "Career Site", "Careers Page", "Career Website", "Corporate Website", "Website", "Company Web Site", "Job Board", "Online Job Board", "Internet", "Online", "Other"],
};

/** The answer and the other ways sites word it, in order of preference. */
export function answerChoices(answer: string) {
  return [answer, ...(SAME_ANSWER[answer.toLowerCase()] ?? [])];
}

function matchOption(answer: string, options: string[]) {
  if (!options.length) return answer;
  for (const candidate of [answer, ...(SAME_ANSWER[answer.toLowerCase()] ?? [])]) {
    const match = bestOption(candidate, options);
    if (match) return match;
  }
  return null;
}

// Rules for questions nearly every application asks the same way. Checked before the "sensitive" rule, since
// several (consent, agree, acknowledge) use words that would otherwise leave them for the student.
const RELATIVES = /\b(relatives?|family members?|related to|spouse|domestic partner|in-laws?)\b.*\b(work|works|working|employ\w*|company|organi[sz]ation|us|our)\b|\b(know|acquainted with|friends with) (anyone|anybody|someone|somebody|any (current )?employees?)\b|\b(friends?|relatives?|family) (who )?(currently )?(work|works|is employed)\b|referred by (a|an) (current )?employee/i;
const MESSAGE = /message (to|for) (the )?(recruiter|hiring (team|manager)|employer|us)|anything else (you(?:'|’)?d like|you would like|to (share|add|tell)|we should know)|additional (information|comments?|notes?|details)|^(message|comments?|notes?)$|note to (the )?(recruiter|hiring)|^(your )?message( to us)?$/i;
const TEXTS = /\b(texts?|sms|text messages?)\b/i;
const MARKETING = /\b(marketing|promotional|promotions?|newsletters?|offers|advertis)/i;
const TERMS = /\b(acknowledge?|acknowledgement|i agree|agree to|i accept|accept (the|these|our)|terms (and|&) conditions|terms of (use|service)|privacy (policy|notice|statement)|i have read|read and (understand|understood|agree)|i understand|consent to (the )?(processing|collection|use|storage)|certify that (the |all |my )?(information|answers|statements)|true,? (correct|complete|accurate) and)\b/i;
// Signing these away is the student's call, not a standard answer.
const NOT_STANDARD_TERMS = /arbitrat|non-?compete|non-?solicit|background (check|screen)|drug (test|screen)|credit (check|report)|waive/i;

export const RECRUITER_NOTE = "Thank you so much for considering my application. I hope to hear back from you soon!";

/** The yes/no answer in the form's own words: "Yes", "I agree", "I acknowledge", "Accept"… */
function yesNo(yes: boolean, options: string[]) {
  if (!options.length) return yes ? "Yes" : "No";
  const words = yes ? [/^yes\b/i, /\b(i )?(agree|accept|acknowledge|consent|understand|certify)\b/i] : [/^no\b/i, /\b(disagree|decline|do not|don['’]?t)\b/i];
  for (const word of words) {
    const match = options.find((option) => word.test(option));
    if (match) return match;
  }
  return null;
}

/**
 * The standard answers: no relatives or contacts at the company, a short thank-you to the recruiter, yes to
 * texts about the application (never to marketing), and yes to acknowledgements and the site's terms when
 * the student allows Unnepo to accept them (on unless they turn it off in Settings).
 */
export function policyAnswer(label: string, kind: ApplicationQuestion["kind"], options: string[], profile: ApplicationProfile): string | null {
  const text = label.trim();
  if (RELATIVES.test(text) && kind !== "file") return kind === "textarea" ? "No" : yesNo(false, options);
  if (MESSAGE.test(text) && (kind === "textarea" || kind === "text") && !/cover letter/i.test(text)) return RECRUITER_NOTE;
  if (TEXTS.test(text) && /\b(consent|agree|opt[- ]?in|receive|receiving|sign up|subscribe)\b/i.test(text)) return yesNo(!MARKETING.test(text), options);
  if (TERMS.test(text) && !NOT_STANDARD_TERMS.test(text) && profile.accountConsentAt) return yesNo(true, options);
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
    const eligible = eligibilityAnswer(question.label, context.profile);
    if (eligible && question.kind !== "file" && question.kind !== "textarea") {
      const answer = question.kind === "select" || question.options.length ? matchOption(eligible, question.options) : eligible;
      if (answer) return { ...question, answer, source: "student", evidence: null };
    }
    const standard = question.kind === "file" ? null : policyAnswer(question.label, question.kind, question.options, context.profile);
    if (standard) return { ...question, answer: standard, source: "default", evidence: null };
    const { field, sensitive } = classifyQuestion(question.label);
    // Voluntary self-identification: the student's own choice when they made one, otherwise decline when offered.
    if (DEMOGRAPHIC.test(question.label) && question.options.length) {
      const chosen = selfIdentified(question.label, question.options, context.profile);
      if (chosen) return { ...question, answer: chosen, source: "student", evidence: null };
      const decline = question.options.find((option) => DECLINE.test(option));
      if (decline) return { ...question, answer: decline, source: "default", evidence: null };
    }
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

export function squash(text: string) {
  return text.toLowerCase().replace(/[\s ]+/g, " ").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim();
}

function plain(text: string) {
  return squash(text).replace(/[–—]/g, "-").replace(/[^a-z0-9%$+#./@ -]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Whether quoted evidence really comes from the student's text. Exact quotes pass; so do quotes that
 * differ only in punctuation, spacing, or a stray word, which models often produce.
 */
export function supportedBy(evidence: string, text: string) {
  const quote = plain(evidence);
  const source = plain(text);
  if (!quote) return false;
  // Short values ("ME", "BA") must stand as a whole word.
  if (quote.length < 3) return ` ${source} `.includes(` ${quote} `);
  if (source.includes(quote)) return true;
  const words = quote.split(" ").filter((word) => word.length > 1);
  if (words.length < 4) return false;
  const have = new Set(source.split(" "));
  return words.filter((word) => have.has(word)).length / words.length >= 0.85;
}

/** An AI answer is kept only if its quoted evidence appears in the student's own profile or resume. */
export function acceptAiAnswer(question: ApplicationQuestion, answer: string, evidence: string, sources: string) {
  if (question.sensitive || classifyQuestion(question.label).sensitive) return null;
  if (evidence.trim().length < 4 || !supportedBy(evidence, sources)) return null;
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
