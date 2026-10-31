import { z } from "zod";
import { acceptFixes, type EmptyField } from "@/lib/apply/fast/fields";
import { bestOption } from "@/lib/apply/options";
import { WRITING_STYLE, answerChoices, askedLength, fitsLength, lengthGap, plainWriting, wordCount } from "@/lib/apply/questions";
import type { FormSchema, SchemaField } from "@/lib/apply/fast/schema";

/**
 * One mapping per application: every field gets its value before a browser opens. Answers from the
 * student's own details, saved answers, and resume come first with no AI; whatever is left, including
 * essays, goes to a single model call whose answers are validated and kept only with a real source.
 */
export type MappedAnswer = { id: string; values: string[]; source: string; why: string | null };

export const MAP_PROMPT = `You fill a job application for a college student in one pass. You get the fields nothing on file answers yet (id, question, type, options, required), the job posting, the student's details and saved answers, and their resume.
Answer a field only when one of these supports it, and name it in "source":
- "resume": facts in the resume or profile. Put the exact supporting words in "evidence", copied character for character.
- "profile" or "student_answer": a line under Student details. Put that line in "evidence", copied exactly.
- "default", only for: how-did-you-hear or source questions (the company website or careers site option, or the closest one); voluntary self-identification of gender, race, ethnicity, veteran, or disability (the option that declines to answer, only if one exists); acknowledging a privacy notice or candidate terms (agree), only when Student details says Unnepo may accept them.
Rules:
- Never invent employers, titles, dates, schools, degrees, GPAs, numbers, skills, or licenses.
- Work authorization, sponsorship, age, background, criminal history, salary, arbitration, non-competes, and anything the student must certify: only from the student's own answers. Otherwise skip.
- select: the value must be exactly one of the options. multiselect: an array of options, each exactly as written.
- Essay questions (type textarea, or any question asking why, what, how or to describe or tell, such as "Why do you want to work here?"): always answer them. Connect one or two real experiences from the resume to specific things this posting says about the company and role. Use only resume and profile facts plus the posting. Quote the main resume fact you used in "evidence".
- Short open questions you can't support from the resume or details (start date, deadlines, preferences): skip.
- Skip any other field you can't support. Skipping is better than guessing.
${WRITING_STYLE}
Return only JSON: {"answers":[{"id":"...","value":"..." or ["..."],"source":"resume","evidence":"..."}]}`;

/** A second try for written answers that missed the length their question asks for. */
export const LENGTH_PROMPT = `You rewrite a college student's answers on a job application so each one is the length its question asks for. Keep the facts in the draft; add only facts from the resume, profile, or job posting given. Never invent anything.
${WRITING_STYLE}
Return only JSON: {"answers":[{"id":"...","value":"..."}]}`;

const Rewrites = z.object({ answers: z.array(z.object({ id: z.string(), value: z.string() })).default([]) });

/** What a question's asked length means for the writer: "at least 100 words (aim for about 115)". */
function lengthNote(label: string) {
  const asked = askedLength(label);
  const parts = [
    asked.minWords ? `at least ${asked.minWords} words (aim for about ${Math.round(asked.minWords * 1.15) + 5})` : "",
    asked.maxWords ? `at most ${asked.maxWords} words` : "",
    asked.minChars ? `at least ${asked.minChars} characters` : "",
    asked.maxChars ? `at most ${asked.maxChars} characters, spaces included` : "",
  ].filter(Boolean);
  return parts.join(", ");
}

const Reply = z.object({
  answers: z.array(z.object({
    id: z.string(),
    value: z.union([z.string(), z.array(z.string())]),
    source: z.string(),
    evidence: z.string().optional().default(""),
  })).default([]),
});

export type MapperInput = {
  schema: FormSchema;
  /** The deterministic answer for a field (saved answers, eligibility, profile, resume entries, defaults). */
  known: (field: SchemaField) => { value: string; source: string } | null;
  facts: string;
  sources: string;
  consent: boolean;
  resumeFileName: string | null;
  /** One model call; returns the model's text. Absent when AI isn't set up. */
  ask?: (system: string, content: string) => Promise<string>;
};

function asEmptyField(field: SchemaField): EmptyField {
  const control = field.type === "textarea" ? "textarea" : field.type === "multiselect" ? "checkbox" : field.options.length ? "select" : "text";
  return { selector: field.id, label: field.label, section: field.section === "eeoc" ? "Voluntary self-identification" : "", control, options: field.options.map((option) => option.label), format: null };
}

/** An answer matched to the field's options, exactly as the form words them. Null when it doesn't fit. */
export function fitOptions(field: SchemaField, value: string) {
  if (!field.options.length) return value.trim() || null;
  const labels = field.options.map((option) => option.label);
  for (const choice of answerChoices(value)) {
    const match = bestOption(choice, labels);
    if (match) return match;
  }
  return null;
}

export async function mapAnswers(input: MapperInput) {
  const started = Date.now();
  const answers = new Map<string, MappedAnswer>();
  const pending: SchemaField[] = [];
  for (const field of input.schema.fields) {
    if (field.type === "file") {
      if (field.id === "resume" && input.resumeFileName) answers.set(field.id, { id: field.id, values: [input.resumeFileName], source: "resume_file", why: null });
      // Cover letters are written for this job when the form is filled.
      if (field.id === "cover_letter") answers.set(field.id, { id: field.id, values: ["Cover letter written from your resume"], source: "cover_letter", why: null });
      continue;
    }
    const known = input.known(field);
    if (known) {
      const values = field.type === "multiselect" ? known.value.split("\n").map((value) => fitOptions(field, value)).filter((value): value is string => Boolean(value)) : [fitOptions(field, known.value)].filter((value): value is string => Boolean(value));
      // Education and phone-country options are only known on the page; their value is matched there.
      if (values.length || ["school", "degree", "phone_country", "location"].includes(field.type) || (field.ifPresent && !field.options.length)) {
        answers.set(field.id, { id: field.id, values: values.length ? values : [known.value], source: known.source, why: null });
        continue;
      }
    }
    if (!field.ifPresent) pending.push(field);
  }

  let llmCalls = 0;
  if (pending.length && input.ask) {
    llmCalls = 1;
    const listed = pending.map((field) => ({ id: field.id, question: field.label, type: field.type, required: field.required, options: field.options.length ? field.options.map((option) => option.label) : undefined, length: lengthNote(field.label) || undefined }));
    const content = [
      `Job: ${input.schema.title} at ${input.schema.company}\n${input.schema.description.slice(0, 3500)}`,
      `Fields:\n${JSON.stringify(listed)}`,
      `Student details:\n${input.facts.slice(0, 6000)}`,
      `Resume and profile:\n${input.sources.slice(0, 12000)}`,
    ].join("\n\n");
    try {
      const text = await input.ask(MAP_PROMPT, content);
      const reply = Reply.parse(JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)));
      const byId = new Map(pending.map((field, index) => [field.id, index]));
      const fields = pending.map(asEmptyField);
      // An essay about this company may quote the posting as well as the resume.
      const withPosting = `${input.sources}\n${input.schema.description}`;
      for (const proposal of reply.answers) {
        const index = byId.get(proposal.id);
        if (index === undefined || answers.has(proposal.id)) continue;
        const field = pending[index];
        const written = !field.options.length && (field.type === "textarea" || wordCount(String(proposal.value)) > 25);
        // Each chosen value passes the same source and option checks; a multi-select keeps the ones that pass.
        const values = (Array.isArray(proposal.value) ? proposal.value : [proposal.value]).slice(0, 30).map((value) => written ? plainWriting(value) : value);
        const kept = values.flatMap((value) => acceptFixes(fields, [{ index, value, source: proposal.source, evidence: proposal.evidence }], { facts: input.facts, sources: written ? withPosting : input.sources, consent: input.consent }));
        if (!kept.length) continue;
        answers.set(field.id, { id: field.id, values: [...new Set(kept.map((item) => item.value))], source: proposal.source === "resume" ? "ai" : proposal.source === "default" ? "default" : "student", why: kept[0].why });
      }
    } catch {
      // A bad reply leaves those fields for the student; nothing is guessed.
    }
    // Written answers that came out shorter or longer than their question asks get one rewrite.
    const off = pending.filter((field) => {
      const answer = answers.get(field.id);
      return answer?.source === "ai" && !field.options.length && !fitsLength(field.label, answer.values[0]);
    });
    if (off.length) {
      llmCalls += 1;
      const drafts = off.map((field) => ({ id: field.id, question: field.label, length: lengthNote(field.label), now: `${wordCount(answers.get(field.id)!.values[0])} words, ${answers.get(field.id)!.values[0].length} characters`, draft: answers.get(field.id)!.values[0] }));
      try {
        const text = await input.ask(LENGTH_PROMPT, [
          `Job: ${input.schema.title} at ${input.schema.company}\n${input.schema.description.slice(0, 3500)}`,
          `Answers to fix:\n${JSON.stringify(drafts)}`,
          `Resume and profile:\n${input.sources.slice(0, 12000)}`,
        ].join("\n\n"));
        const reply = Rewrites.parse(JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)));
        for (const rewrite of reply.answers) {
          const field = off.find((item) => item.id === rewrite.id);
          const value = plainWriting(rewrite.value).slice(0, 4000);
          // A rewrite is kept only when it's closer to the asked length than the draft was.
          if (field && value && lengthGap(field.label, value) < lengthGap(field.label, answers.get(field.id)!.values[0])) {
            answers.set(field.id, { ...answers.get(field.id)!, values: [value] });
          }
        }
      } catch {
        // The first draft stays.
      }
    }
  }
  return { answers, llmCalls, ms: Date.now() - started };
}
