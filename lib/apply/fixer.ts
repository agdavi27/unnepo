import { serverConfig } from "@/lib/config";
import { id, nowIso, readAnthropicKey, repo } from "@/lib/db/file-store";
import type { EmptyField } from "@/lib/apply/browser";
import { bestOption } from "@/lib/apply/options";
import { answerChoices, classifyQuestion, supportedBy } from "@/lib/apply/questions";

/**
 * The fix-up pass: when required fields are still empty after the normal fill, one model call decides
 * an answer for each from the student's own details, saved answers, and resume. Every answer must name
 * its source and quote it; anything unsupported is dropped and goes back to the student.
 */
export const FIX_PROMPT = `You finish a job application for a college student. You get the required fields the form still has empty: each with its question, the form section it's in, the kind of control, its options, and the input format if one is shown. You also get the student's details, their saved answers, and their resume.
Answer a field only when one of these supports it, and name it in "source":
- "resume": facts in the resume or profile text. Put the exact supporting words in "evidence", copied character for character.
- "profile": the student's details under Student details. Put the line you used in "evidence", copied exactly.
- "student_answer": an eligibility answer or saved answer under Student details. Put the line you used in "evidence", copied exactly.
- "default", only for these: how-did-you-hear or source questions (the company website or careers site option, or the closest one); phone or device type (Mobile or Cell); voluntary self-identification of gender, race, ethnicity, veteran, or disability status (the option that declines to answer, only if one exists); acknowledging a privacy notice or candidate terms (agree), only when Student details says Unnepo may accept them.
Rules:
- Never invent employers, job titles, dates, schools, degrees, GPAs, numbers, skills, or licenses.
- Work authorization, sponsorship, age, background, criminal history, salary, non-competes, and any statement the student must certify: only from the student's own answers. Otherwise skip.
- Questions that name other fields (section "Work Experience 2", "Education 1") use the resume's entries in that order, most recent first.
- For fields with options, the value must be exactly one of the options.
- Dates: use the format shown (MM/YYYY, MM/DD/YYYY). Convert only the format of a date the resume states; if the resume says "Present" for an end date, skip the end date.
- Degree questions: the resume's degree as worded in the options (for example "Bachelor's Degree" for a B.A. or B.S.).
- Skip any field you can't support. Skipping is better than guessing.
Return only JSON: {"answers":[{"index":0,"value":"...","source":"resume","evidence":"..."}]}`;

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

export async function decideFixes(userId: string, fields: EmptyField[], siteErrors: string[], context: FixContext) {
  if (!fields.length) return [];
  const apiKey = await readAnthropicKey();
  if (!apiKey) return [];
  const config = serverConfig();
  const listed = fields.map((field, index) => ({ index, question: field.label, section: field.section || undefined, control: field.control, options: field.options.length ? field.options : undefined, format: field.format || undefined }));
  const content = [
    `Empty required fields:\n${JSON.stringify(listed)}`,
    siteErrors.length ? `Errors the site shows:\n${siteErrors.map((error) => `- ${error}`).join("\n")}` : "",
    `Student details:\n${context.facts.slice(0, 6000)}`,
    `Resume and profile:\n${context.sources.slice(0, 12000)}`,
  ].filter(Boolean).join("\n\n");
  const model = process.env.ANTHROPIC_FAST_MODEL || "claude-haiku-4-5";
  const started = Date.now();
  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model,
      max_tokens: 2500,
      system: [{ type: "text", text: FIX_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content }],
    });
    const text = response.content.map((block) => (block.type === "text" ? block.text : "")).join("");
    const inputTokens = response.usage?.input_tokens ?? 0;
    const outputTokens = response.usage?.output_tokens ?? 0;
    const costCents = (inputTokens * config.fastInputCentsPerMillion + outputTokens * config.fastOutputCentsPerMillion) / 1_000_000;
    await repo.insertUsage({ id: id(), userId, provider: "anthropic", operation: "application_fixup", success: true, latencyMs: Date.now() - started, costCents, estimated: true, error: null, createdAt: nowIso() });
    await repo.insertGeneration({ id: id(), userId, purpose: "application_fixup", model, inputTokens, outputTokens, costCents, estimated: true, createdAt: nowIso() });
    const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as { answers?: Proposal[] };
    return acceptFixes(fields, parsed.answers ?? [], context);
  } catch (error) {
    await repo.insertUsage({ id: id(), userId, provider: "anthropic", operation: "application_fixup", success: false, latencyMs: Date.now() - started, costCents: 0, estimated: true, error: error instanceof Error ? error.message : "anthropic_failed", createdAt: nowIso() });
    return [];
  }
}
