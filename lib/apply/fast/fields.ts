import { bestOption } from "@/lib/apply/options";
import { answerChoices, classifyQuestion, supportedBy } from "@/lib/apply/questions";

/**
 * A form field as the mapping sees it, and the rules every AI-proposed answer must pass: a real source
 * (the resume, the student's details, or an allowed default), an exact option, and never a sensitive
 * question answered from the resume.
 */

/** A field to answer: its question, section, kind of control, and options. */
export type EmptyField = { selector: string; label: string; section: string; control: "text" | "textarea" | "select" | "listbox" | "prompt" | "checkbox" | "radio" | "date" | "file"; options: string[]; format: string | null };

const DEMOGRAPHIC = /\b(gender|sex|race|racial|ethnic|ethnicity|hispanic|latin[oax]|veteran|disabilit|sexual orientation|transgender|pronouns?)\b/i;
const DECLINE = /(decline|prefer not|don['’]?t wish|do not wish|not to (say|answer|disclose|self-identify)|choose not|rather not|not specified)/i;
const HEAR = /how did you (hear|find out|learn)|where did you (hear|find|see)|(referral|application|candidate|lead) source|\bsource\b/i;
const PHONE_TYPE = /\b(phone|device) (device )?type\b|type of (phone|device)/i;
const PRIVACY = /(privacy (notice|policy|statement)|applicant (privacy|notice|terms)|candidate (privacy|terms)|terms (and|&) conditions|terms of (use|service))/i;
const CERTIFY = /\b(certify|attest|true and (complete|accurate)|background|non-?compete|arbitration)\b/i;

export type FixContext = { facts: string; sources: string; consent: boolean };
type Proposal = { index?: unknown; value?: unknown; source?: unknown; evidence?: unknown };

/** Keeps only answers the rules allow, matched to the field's options. Exported for tests. */
export function acceptFixes(fields: EmptyField[], proposals: Proposal[], context: FixContext) {
  const out: Array<{ index: number; value: string; why: string }> = [];
  for (const proposal of proposals) {
    const index = Number(proposal.index);
    const field = fields[index];
    let value = String(proposal.value ?? "").trim().slice(0, 2000);
    const source = String(proposal.source ?? "");
    const evidence = String(proposal.evidence ?? "").trim();
    if (!field || !value || out.some((item) => item.index === index)) continue;
    if (field.options.length) {
      const match = answerChoices(value).map((choice) => bestOption(choice, field.options)).find(Boolean);
      if (!match) continue;
      value = match;
    }
    const label = `${field.section} ${field.label}`;
    const sensitive = classifyQuestion(field.label).sensitive || CERTIFY.test(field.label);
    let why = "";
    if (source === "default") {
      if (DEMOGRAPHIC.test(label) && DECLINE.test(value)) why = "Chose not to self-identify. Change it in the live view if you'd like to answer.";
      else if (HEAR.test(field.label) && !sensitive) why = "Unnepo opened the company's own posting.";
      else if (PHONE_TYPE.test(field.label)) why = "Your application phone is treated as your cell.";
      else if (context.consent && PRIVACY.test(field.label) && !CERTIFY.test(field.label)) why = "You allowed Unnepo to accept privacy notices and candidate terms.";
      else continue;
    } else if (source === "profile" || source === "student_answer") {
      if (evidence.length < 3 || !supportedBy(evidence, context.facts)) continue;
      why = source === "profile" ? "From your application details." : `From your answer: "${evidence.slice(0, 120)}"`;
    } else if (source === "resume") {
      if (sensitive || DEMOGRAPHIC.test(label) || evidence.length < 4 || !supportedBy(evidence, context.sources)) continue;
      why = `From your resume: "${evidence.slice(0, 160)}"`;
    } else continue;
    out.push({ index, value, why });
  }
  return out;
}
