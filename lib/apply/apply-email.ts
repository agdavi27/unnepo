import { serverConfig } from "@/lib/config";
import { id, nowIso, readAnthropicKey, repo } from "@/lib/db/file-store";
import { ServiceError } from "@/lib/errors";
import { student } from "@/lib/apply/service";
import { assertSpendAllowed } from "@/lib/providers/contacts/router";

/**
 * A job that's applied to by email ("To apply, send your resume to hi@pennock.co"): the email itself, written from
 * the student's resume for this job, following what the posting asks for (a subject line, a portfolio link, the
 * position in the subject). Short and plain; the resume goes with it as an attachment, so it isn't retold.
 */
const PROMPT = `You write the email a college student sends to apply for a job when the posting says to apply by email.

Return JSON only: {"subject": "...", "body": "..."}.

Rules:
- Follow every instruction the posting gives about the email (what to put in the subject, what to include, what to attach). If it names a subject line, use it.
- Otherwise the subject is "Application: {role}" plus " - {student name}".
- Body: a greeting ("Hi {name}," if the posting names who to send to, else "Hello,"), then 3 short paragraphs at most:
  1. The role they're applying for and one line on who they are (year, school, major when known).
  2. Two or three specifics from the resume that fit this job. Only facts in the resume; never invent.
  3. That their resume is attached (and anything else the posting asked for, if they have it), and a short thank-you.
- Sign off "Best," then the student's name, then their phone and LinkedIn on separate lines when given.
- Under 170 words. Plain, warm, professional. No "I hope this email finds you well", no exclamation marks, no emojis, no job ID numbers.`;

export async function writeApplyEmail(userId: string, raw: unknown) {
  const body = (raw ?? {}) as { to?: unknown; instructions?: unknown; title?: unknown; company?: unknown; description?: unknown };
  const to = String(body.to ?? "").trim().slice(0, 200);
  if (!/^[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}$/i.test(to)) throw new ServiceError("That isn't an email address.", "to", 400);
  const instructions = String(body.instructions ?? "").replace(/\s+/g, " ").trim().slice(0, 600);
  const title = String(body.title ?? "").trim().slice(0, 200);
  const company = String(body.company ?? "").trim().slice(0, 120);
  const description = String(body.description ?? "").trim().slice(0, 4000);
  const apiKey = await readAnthropicKey();
  if (!apiKey) throw new ServiceError("AI writing is not configured.", "ai_missing", 503);
  await assertSpendAllowed(userId, 1);
  const info = await student(userId);
  const name = [info.profile.firstName, info.profile.lastName].filter(Boolean).join(" ") || info.user.name;
  const prompt = [
    `Student: ${name}`,
    [info.context.classYear, info.context.school, info.context.majors.join(" and ")].some(Boolean) ? `School: ${[info.context.classYear, info.context.school].filter(Boolean).join(" at ")}${info.context.majors.length ? `, studying ${info.context.majors.join(" and ")}` : ""}` : "",
    info.profile.phone ? `Phone: ${info.profile.phone}` : "",
    info.profile.linkedin ? `LinkedIn: ${info.profile.linkedin}` : "",
    info.profile.website ? `Portfolio: ${info.profile.website}` : "",
    `Sending to: ${to}`,
    `Role: ${title || "the role in the posting"}${company ? ` at ${company}` : ""}`,
    instructions ? `What the posting says about applying:\n${instructions}` : "",
    description ? `The posting:\n${description}` : "",
    info.resumeText ? `Resume:\n${info.resumeText.slice(0, 5000)}` : "",
  ].filter(Boolean).join("\n\n");
  const config = serverConfig();
  const model = process.env.ANTHROPIC_FAST_MODEL || "claude-haiku-4-5";
  const started = Date.now();
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey });
  try {
    const response = await client.messages.create({ model, max_tokens: 900, system: [{ type: "text", text: PROMPT, cache_control: { type: "ephemeral" } }], messages: [{ role: "user", content: prompt }] });
    const text = response.content.map((block) => (block.type === "text" ? block.text : "")).join("");
    const inputTokens = response.usage?.input_tokens ?? 0;
    const outputTokens = response.usage?.output_tokens ?? 0;
    const costCents = (inputTokens * config.fastInputCentsPerMillion + outputTokens * config.fastOutputCentsPerMillion) / 1_000_000;
    await repo.insertUsage({ id: id(), userId, provider: "anthropic", operation: "apply_email", success: true, latencyMs: Date.now() - started, costCents, estimated: true, error: null, createdAt: nowIso() });
    await repo.insertGeneration({ id: id(), userId, purpose: "apply_email", model, inputTokens, outputTokens, costCents, estimated: true, createdAt: nowIso() });
    const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as { subject?: string; body?: string };
    const subject = String(parsed.subject ?? "").trim().slice(0, 200);
    const email = String(parsed.body ?? "").trim().slice(0, 4000);
    if (!email) throw new Error("empty");
    return { to, subject: subject || `Application: ${title || "Open role"} - ${name}`, body: email };
  } catch (error) {
    await repo.insertUsage({ id: id(), userId, provider: "anthropic", operation: "apply_email", success: false, latencyMs: Date.now() - started, costCents: 0, estimated: true, error: error instanceof Error ? error.message.slice(0, 200) : "failed", createdAt: nowIso() });
    throw new ServiceError("Couldn't write the email just now. Try again.", "ai_failed", 502);
  }
}
