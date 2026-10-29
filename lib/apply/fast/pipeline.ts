import { serverConfig } from "@/lib/config";
import { id, nowIso, readAnthropicKey, repo } from "@/lib/db/file-store";
import { integrations } from "@/lib/integrations/flags";
import { safeGetJson } from "@/lib/apply/safe-fetch";
import type { ResumeProfile } from "@/lib/apply/resume-profile";
import type { ApplicationProfile, ApplicationQuestion, JobApplication } from "@/lib/apply/types";
import { fitOptions, mapAnswers, type MappedAnswer, type MapperInput } from "@/lib/apply/fast/mapper";
import { parseGreenhouse, schemaKind, type FormSchema, type GreenhouseJobJson, type SchemaField } from "@/lib/apply/fast/schema";

/**
 * The fast pipeline, step by step: schema from the job board (no browser), one mapping per application
 * (no AI during filling), a deterministic fill by each field's id, and timings for every step.
 * It's used for Greenhouse jobs when the flag is on, or when the student turns on fast mode.
 */
export function fastApplyOn(app: Pick<JobApplication, "ats">, profile: Pick<ApplicationProfile, "fastApply">) {
  return app.ats === "greenhouse" && (integrations.fastApply || Boolean(profile.fastApply));
}

/** Where the time went for one application. Logged and kept on the application. */
export type Timings = { pipeline: "fast"; schemaMs?: number; mappingMs?: number; fillMs?: number; submitMs?: number; llmCalls: number; fallback: string[] };

export function logTimings(appId: string, step: string, timings: Timings) {
  console.info(JSON.stringify({ event: "apply_timing", appId, step, ...timings }));
}

export async function greenhouseSchema(jobKey: string) {
  const [, board, jobId] = jobKey.split(":");
  const started = Date.now();
  const job = await safeGetJson<GreenhouseJobJson>(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs/${encodeURIComponent(jobId)}?questions=true`);
  if (!job?.title) throw new Error("Greenhouse didn't return this job. It may have closed.");
  return { schema: parseGreenhouse(job, board, jobId), ms: Date.now() - started };
}

export type KnownContext = {
  answerFor: (label: string, kind: ApplicationQuestion["kind"], options: string[], where?: { section?: string; format?: string | null }) => string | null;
  profile: ApplicationProfile;
  school: string;
  resumeProfile: ResumeProfile | null | undefined;
};

/** Answers that need no AI: the student's own answers, their details, their resume's schools, and defaults. */
export function knownAnswers(context: KnownContext) {
  return (field: SchemaField): { value: string; source: string } | null => {
    const p = context.profile;
    const school = context.resumeProfile?.education[0];
    switch (field.type) {
      case "location": {
        const place = [p.city, p.state].filter((part) => part?.trim()).join(", ");
        return place ? { value: place, source: "profile" } : null;
      }
      case "school": {
        const name = school?.school || context.school;
        return name ? { value: name, source: school?.school ? "resume" : "profile" } : null;
      }
      case "degree":
        return school?.degree ? { value: school.degree, source: "resume" } : null;
      case "phone_country":
        return { value: p.country?.trim() || "United States", source: p.country?.trim() ? "profile" : "default" };
    }
    if (field.id === "discipline--0" && school?.field) return { value: school.field, source: "resume" };
    const kind = schemaKind(field) as ApplicationQuestion["kind"];
    const section = field.sectionLabel ?? (field.section === "eeoc" ? "Voluntary self-identification" : field.section === "education" ? "Education" : "");
    const answer = context.answerFor(field.label, kind, field.options.map((option) => option.label), { section, format: field.format });
    return answer ? { value: answer, source: "profile" } : null;
  };
}

/** One model call, with its cost recorded like every other AI call. */
export function claudeAsk(userId: string, purpose: string) {
  return async (system: string, content: string) => {
    const apiKey = await readAnthropicKey();
    if (!apiKey) throw new Error("AI writing is not configured.");
    const config = serverConfig();
    const model = process.env.ANTHROPIC_MAPPING_MODEL || process.env.ANTHROPIC_FAST_MODEL || "claude-haiku-4-5";
    const started = Date.now();
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({ model, max_tokens: 4000, system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }], messages: [{ role: "user", content }] });
    const inputTokens = response.usage?.input_tokens ?? 0;
    const outputTokens = response.usage?.output_tokens ?? 0;
    const costCents = (inputTokens * config.fastInputCentsPerMillion + outputTokens * config.fastOutputCentsPerMillion) / 1_000_000;
    await repo.insertUsage({ id: id(), userId, provider: "anthropic", operation: purpose, success: true, latencyMs: Date.now() - started, costCents, estimated: true, error: null, createdAt: nowIso() });
    await repo.insertGeneration({ id: id(), userId, purpose, model, inputTokens, outputTokens, costCents, estimated: true, createdAt: nowIso() });
    return response.content.map((block) => (block.type === "text" ? block.text : "")).join("");
  };
}

/** The mapping as review questions: the student sees and edits it on the existing review screen. */
export function questionsFromMapping(schema: FormSchema, answers: Map<string, MappedAnswer>): ApplicationQuestion[] {
  return schema.fields
    // Fields the form may add are shown only when Unnepo has something for them.
    .filter((field) => !field.ifPresent || answers.has(field.id))
    .map((field) => {
      const answer = answers.get(field.id);
      return {
        key: field.id,
        label: field.label,
        kind: schemaKind(field) as ApplicationQuestion["kind"],
        required: field.required && !field.ifPresent,
        options: field.options.map((option) => option.label),
        sensitive: field.sensitive,
        answer: answer?.values.join("\n") || null,
        source: answer?.source ?? null,
        evidence: answer?.why ?? null,
      };
    });
}

/** The approved answers back into a mapping for the fill, keeping the student's edits. */
export function mappingFromQuestions(schema: FormSchema, questions: ApplicationQuestion[]) {
  const map = new Map<string, MappedAnswer>();
  for (const field of schema.fields) {
    const question = questions.find((item) => item.key === field.id);
    const raw = question?.answer?.trim();
    if (!raw) continue;
    const values = field.type === "multiselect" ? raw.split("\n").map((value) => fitOptions(field, value)).filter((value): value is string => Boolean(value)) : [field.options.length ? fitOptions(field, raw) ?? raw : raw];
    if (values.length) map.set(field.id, { id: field.id, values, source: question?.source ?? "student", why: null });
  }
  return map;
}

export async function buildMapping(input: Omit<MapperInput, "ask"> & { userId: string; ai: boolean }) {
  return mapAnswers({ ...input, ask: input.ai ? claudeAsk(input.userId, "application_mapping") : undefined });
}
