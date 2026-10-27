import { createHash } from "node:crypto";
import { serverConfig } from "@/lib/config";
import { id, nowIso, repo } from "@/lib/db/file-store";
import { integrations } from "@/lib/integrations/flags";
import { type FormProfile, type ProfileSection, type StructuredFact } from "@/lib/profile/intelligence";

const SECTIONS = new Set<ProfileSection>([
  "personal_education",
  "employment",
  "skills",
  "projects",
  "interests",
  "career_goals",
  "industries_locations",
  "networking",
  "story",
  "email_preferences",
  "excluded_topics",
]);

const FIELDS = new Set<keyof FormProfile>([
  "school",
  "major",
  "graduationYear",
  "interests",
  "otherInterests",
  "targetRoles",
  "dreamCompanies",
  "locations",
  "workPreference",
  "goals",
  "contactTypes",
  "seniority",
  "bio",
  "accomplishments",
  "excludedTopics",
  "emailTone",
]);

/** Free-text answers the model may split into shorter facts. */
const FREE_TEXT = new Set<keyof FormProfile>(["otherInterests", "targetRoles", "dreamCompanies", "locations", "bio", "accomplishments"]);

const STOP = new Set(["the", "and", "with", "from", "that", "this", "your", "have", "has", "for", "into", "about", "prefers", "interested", "works", "work", "open", "also", "who", "what"]);

function clean(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function corpus(profile: FormProfile) {
  return Object.values(profile)
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .join(" \n ")
    .toLowerCase();
}

function contentWords(text: string) {
  return clean(text)
    .toLowerCase()
    .split(/[^a-z0-9+]+/)
    .filter((word) => word.length > 2 && !STOP.has(word));
}

export function factIsGrounded(text: string, profile: FormProfile) {
  const words = contentWords(text);
  if (!words.length) return false;
  const haystack = corpus(profile);
  const hits = words.filter((word) => haystack.includes(word));
  return hits.length / words.length >= 0.6;
}

function factId(section: string, text: string) {
  const norm = clean(text).toLowerCase();
  return `fact_${createHash("sha256").update(`${section}:${norm}`).digest("hex").slice(0, 16)}`;
}

export function acceptModelFacts(profile: FormProfile, raw: unknown): StructuredFact[] {
  const rows = Array.isArray(raw) ? raw : [];
  const facts: StructuredFact[] = [];
  for (const row of rows.slice(0, 40)) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const section = String(item.section || "") as ProfileSection;
    const field = String(item.sourceField || "") as keyof FormProfile;
    const text = clean(String(item.text || "")).slice(0, 180);
    const label = clean(String(item.label || "Detail")).slice(0, 80) || "Detail";
    if (!SECTIONS.has(section) || !FIELDS.has(field) || text.length < 2) continue;
    if (section === "excluded_topics" && field !== "excludedTopics") continue;
    if (!factIsGrounded(text, profile)) continue;
    const id = factId(section, text);
    if (facts.some((fact) => fact.id === id)) continue;
    facts.push({
      id,
      section,
      label,
      text,
      source: { kind: "onboarding_model", field, excerpt: text },
      corroboration: null,
      verificationStatus: "user_entered",
      approvalStatus: "approved",
      uncertain: Boolean(item.uncertain),
      inconsistencyNote: item.inconsistencyNote ? clean(String(item.inconsistencyNote)).slice(0, 240) : null,
    });
  }
  return facts;
}

/** Keeps direct answers. A free-text blob is replaced only when the model facts still contain every important word. */
export function mergeQuizFacts(base: StructuredFact[], modelFacts: StructuredFact[]) {
  const byField = new Map<string, string[]>();
  for (const fact of modelFacts) {
    const field = fact.source.field;
    if (!field || !FREE_TEXT.has(field as keyof FormProfile)) continue;
    const list = byField.get(field) ?? [];
    list.push(fact.text);
    byField.set(field, list);
  }
  const replaced = new Set<string>();
  for (const [field, texts] of byField) {
    const original = base.find((fact) => fact.source.field === field);
    const words = contentWords(original?.text || "");
    const haystack = texts.join(" ").toLowerCase();
    if (!words.length || words.every((word) => haystack.includes(word))) replaced.add(field);
  }
  const kept = base.filter((fact) => !(fact.source.field && replaced.has(fact.source.field)));
  for (const fact of modelFacts) {
    if (kept.some((item) => item.id === fact.id)) continue;
    kept.push(fact);
  }
  return kept;
}

export async function organizeQuizWithModel(userId: string, profile: FormProfile, apiKey: string) {
  if (!integrations.profileOrganization || !apiKey) return null;
  const model = process.env.ANTHROPIC_FAST_MODEL || "claude-haiku-4-5";
  const started = Date.now();
  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model,
      max_tokens: 1200,
      system: [
        {
          type: "text",
          text: "You organize a student's onboarding answers into short profile facts. Use only details written in the answers. Do not invent schools, employers, skills, dates, or interests. Split lists and sentences into separate facts. Hobbies and personal interests go in interests. Skills are only work abilities. Topics they do not want mentioned belong only in excluded_topics. Return JSON {\"facts\":[{\"section\":\"personal_education|employment|skills|projects|interests|career_goals|industries_locations|networking|story|email_preferences|excluded_topics\",\"label\":\"short label\",\"text\":\"one short fact\",\"sourceField\":\"the answer field name\",\"uncertain\":false}]}.",
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: JSON.stringify(profile) }],
    });
    const text = response.content.map((block) => (block.type === "text" ? block.text : "")).join("\n");
    const match = text.match(/\{[\s\S]*\}/);
    const parsed = match ? (JSON.parse(match[0]) as { facts?: unknown }) : { facts: [] };
    const facts = acceptModelFacts(profile, parsed.facts);
    const inputTokens = response.usage?.input_tokens ?? 0;
    const outputTokens = response.usage?.output_tokens ?? 0;
    const config = serverConfig();
    const costCents = (inputTokens * config.fastInputCentsPerMillion + outputTokens * config.fastOutputCentsPerMillion) / 1_000_000;
    await repo.insertUsage({
      id: id(),
      userId,
      provider: "anthropic",
      operation: "profile_organize",
      success: true,
      latencyMs: Date.now() - started,
      costCents,
      estimated: true,
      error: null,
      createdAt: nowIso(),
    });
    return facts;
  } catch (error) {
    await repo.insertUsage({
      id: id(),
      userId,
      provider: "anthropic",
      operation: "profile_organize",
      success: false,
      latencyMs: Date.now() - started,
      costCents: 0,
      estimated: true,
      error: error instanceof Error ? error.message : "anthropic_failed",
      createdAt: nowIso(),
    });
    return null;
  }
}
