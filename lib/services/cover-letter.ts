import { id, nowIso, repo } from "@/lib/db/file-store";
import { textPdf } from "@/lib/pdf/text";
import { ServiceError } from "@/lib/errors";
import { assertAiAllowed } from "@/lib/services/entitlements";

export async function generateCoverLetter(userId: string, input: { jobId?: string | null; company: string; role: string; description: string; factIds: string[]; tone: string }) {
  if (!input.company.trim() || !input.role.trim()) throw new ServiceError("Add the company and role.", "job");
  await assertAiAllowed(userId, "cover_letter");
  const user = await repo.getUserById(userId);
  const facts = await repo.getFacts(userId);
  const selected = facts.filter((fact) => input.factIds.includes(fact.id));
  const usable = (selected.length ? selected : facts).slice(0, 6);
  if (!usable.length) throw new ServiceError("Upload a resume before generating a cover letter.", "resume");
  const grounded = groundedLetter({
    name: user?.name || "Student",
    company: input.company.trim(),
    role: input.role.trim(),
    description: input.description.trim(),
    tone: input.tone || "professional",
    facts: usable.map((fact) => fact.detail || fact.label),
  });
  const body = await maybeAnthropic(userId, grounded, usable.map((fact) => `${fact.label}: ${fact.detail}`), input);
  const letter = await repo.insertCoverLetter({
    id: id(),
    userId,
    jobId: input.jobId || null,
    company: input.company.trim(),
    role: input.role.trim(),
    body,
    createdAt: nowIso(),
  });
  await repo.insertGeneration({
    id: id(),
    userId,
    purpose: "cover_letter",
    model: process.env.ANTHROPIC_API_KEY ? process.env.ANTHROPIC_FAST_MODEL || "claude-haiku-4-5" : "grounded-template",
    inputTokens: 0,
    outputTokens: 0,
    costCents: 0,
    estimated: true,
    createdAt: nowIso(),
  });
  return { letter };
}

export function pdfForEditedLetter(input: { name: string; email: string; company: string; role: string; body: string }) {
  return textPdf([
    input.name,
    input.email,
    "",
    new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
    "",
    input.company,
    `Role: ${input.role}`,
    "",
    ...input.body.split("\n"),
  ]);
}

export async function coverLetterPdf(userId: string, letterId: string) {
  const letter = await repo.getCoverLetter(userId, letterId);
  if (!letter) throw new ServiceError("That cover letter is not on your account.", "not_found", 404);
  const user = await repo.getUserById(userId);
  const bytes = textPdf([
    user?.name || "Student",
    user?.email || "",
    "",
    new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
    "",
    letter.company,
    `Role: ${letter.role}`,
    "",
    ...letter.body.split("\n"),
  ]);
  return { filename: `${slug(letter.company)}-${slug(letter.role)}-cover-letter.pdf`, bytes };
}

function groundedLetter(input: { name: string; company: string; role: string; description: string; tone: string; facts: string[] }) {
  const proof = input.facts.slice(0, 3).join("; ");
  const why = input.description ? ` The posting mentions work I want to learn: ${input.description.slice(0, 180)}.` : "";
  return `Dear ${input.company} team,\n\nI'm ${input.name.split(" ")[0]}, and I'm applying for the ${input.role} role.${why} What I can point to from my own record: ${proof}.\n\nI'd like to be considered. Thank you for your time.\n\n${input.name}`;
}

async function maybeAnthropic(userId: string, fallback: string, facts: string[], input: { company: string; role: string; description: string; tone: string }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return fallback;
  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: process.env.ANTHROPIC_FAST_MODEL || "claude-haiku-4-5",
      max_tokens: 500,
      system: "Write a student cover letter from the facts given. One page. Do not invent employers, metrics, or skills. Return only the letter.",
      messages: [{ role: "user", content: `Tone: ${input.tone}\nCompany: ${input.company}\nRole: ${input.role}\nPosting:\n${input.description.slice(0, 1500)}\nFacts:\n${facts.join("\n")}\nFallback:\n${fallback}` }],
    });
    const text = response.content.map((block) => (block.type === "text" ? block.text : "")).join("\n").trim();
    if (!text || text.split(/\s+/).length > 450) return fallback;
    await repo.insertUsage({
      id: id(),
      userId,
      provider: "anthropic",
      operation: "cover_letter",
      success: true,
      latencyMs: 0,
      costCents: 0,
      estimated: true,
      error: null,
      createdAt: nowIso(),
    });
    return text;
  } catch {
    return fallback;
  }
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "letter";
}
