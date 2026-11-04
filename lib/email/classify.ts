import { z } from "zod";
import type { InboundEmail } from "@/lib/email/filter";
import type { EmailKind } from "@/lib/email/types";

/**
 * Reading a job email with the cheap AI model: what happened (applied, interview, assessment, offer, rejected,
 * or not about a job), the company, the job title if it says, how sure it is, and one line. The reply is checked
 * against a schema; a reply that doesn't fit counts as not sure at all, so it changes nothing.
 */

export const CLASSIFICATION = z.object({
  type: z.enum(["applied", "incomplete", "interview", "assessment", "offer", "rejected", "not_job_related"]),
  company: z.string().max(200),
  job_title: z.string().max(200).nullable(),
  location: z.string().max(200).nullable().optional(),
  job_number: z.string().max(60).nullable().optional(),
  confidence: z.number().min(0).max(1),
  summary: z.string().max(300),
});
export type Classification = z.infer<typeof CLASSIFICATION>;

const UNSURE: Classification = { type: "not_job_related", company: "", job_title: null, confidence: 0, summary: "Unnepo couldn't read this email." };

/** The model's reply as a Classification, or "not sure" when it isn't valid JSON of that shape. */
export function parseClassification(raw: string): Classification {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return UNSURE;
  try {
    const parsed = CLASSIFICATION.safeParse(JSON.parse(raw.slice(start, end + 1)));
    if (!parsed.success) return UNSURE;
    const job = parsed.data;
    const title = job.job_title?.trim() || null;
    const said = (value: string | null | undefined) => {
      const text = value?.trim() ?? "";
      return text && !/^(unknown|n\/a|none|null|not specified)$/i.test(text) ? text : null;
    };
    return { ...job, company: job.company.trim(), job_title: title && !/^(unknown|n\/a|none|null)$/i.test(title) ? title : null, location: said(job.location), job_number: said(job.job_number), summary: job.summary.trim().split("\n")[0].slice(0, 200) };
  } catch {
    return UNSURE;
  }
}

const SYSTEM = `You read emails a student received about job applications. Reply with only JSON:
{"type": "applied" | "incomplete" | "interview" | "assessment" | "offer" | "rejected" | "not_job_related", "company": string, "job_title": string or null, "location": string or null, "job_number": string or null, "confidence": number from 0 to 1, "summary": string}
- applied: the company confirms it received the student's application.
- incomplete: the student started an application but hasn't finished it, like a reminder to complete it.
- interview: an invitation to interview or to schedule a call.
- assessment: a test, coding challenge, case study, or questionnaire to complete.
- offer: a job offer.
- rejected: the company isn't moving forward.
- not_job_related: anything else, including job alerts, newsletters, and recommendations of other jobs.
company: the employer, as the email names it (not the job system, like Workday or Greenhouse).
job_title: the role, wherever the email names it, in the subject line too. Leave out the posting number and the words around it ("Data Analyst Intern", not "your application for Data Analyst Intern (R-10423)"). Null if it never says. Don't guess.
location: the job's city or "Remote", only if the email states it, else null.
job_number: the posting's requisition or reference number, like "R-10423", only if the email states it, else null.
summary: one short line in plain words, like "Greenhouse confirmed your application to Acme's Data Intern role."
confidence: how sure you are of type and company together.`;

type Classifier = (email: InboundEmail) => Promise<string>;
let classifierForTests: Classifier | null = null;
/** Tests replace the model with a function that returns its reply. */
export function setClassifierForTests(classifier: Classifier | null) {
  classifierForTests = classifier;
}

/** Classifies one email. Only the subject, sender, date and the start of the plain text are sent. */
export async function classifyEmail(email: InboundEmail): Promise<Classification> {
  const input = { ...email, text: email.text.replace(/\s+\n/g, "\n").slice(0, 6000) };
  if (classifierForTests) return parseClassification(await classifierForTests(input));
  const { readAnthropicKey } = await import("@/lib/db/file-store");
  const apiKey = await readAnthropicKey();
  if (!apiKey) return UNSURE;
  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const response = await new Anthropic({ apiKey }).messages.create({
      model: process.env.ANTHROPIC_FAST_MODEL || "claude-haiku-4-5",
      max_tokens: 400,
      system: SYSTEM,
      messages: [{ role: "user", content: `From: ${input.from}\nDate: ${input.date ?? ""}\nSubject: ${input.subject}\n\n${input.text}` }],
    });
    return parseClassification(response.content.map((block) => (block.type === "text" ? block.text : "")).join(""));
  } catch {
    return UNSURE;
  }
}

export type { EmailKind };
