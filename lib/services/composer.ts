import { serverConfig } from "@/lib/config";
import { id, nowIso, repo } from "@/lib/db/file-store";
import type { Contact, ResumeFact } from "@/lib/db/types";
import { generateGroundedEmail, type ComposerFact, type EmailPurpose, type EmailTone } from "@/lib/email/grounded";
import { ServiceError } from "@/lib/errors";
import { assertAiAllowed } from "@/lib/services/entitlements";

const PURPOSES = new Set(["internship", "full_time", "informational", "mentorship", "networking"]);
const TONES = new Set(["professional", "friendly", "casual", "direct"]);

export async function composerContext(userId: string, contactId: string) {
  const saved = await repo.getSavedByUserAndContact(userId, contactId);
  if (!saved) throw new ServiceError("This person is not in your saved contacts yet.", "locked", 403);
  const contact = await repo.getContact(contactId);
  if (!contact) throw new ServiceError("Contact not found.", "not_found", 404);
  const profile = await repo.getProfile(userId);
  const goals = await repo.getGoals(userId);
  const facts = await repo.getFacts(userId);
  const jobs = await repo.listJobs();
  const you = studentFacts(profile, goals, facts);
  const lead = leadFacts(contact, jobs.filter((job) => job.company.toLowerCase() === contact.company.toLowerCase()));
  const marked = markShared(you, lead);
  return { saved, contact, you: marked.you, lead: marked.lead, email: saved.creditCharged ? contact.email : null };
}

function studentFacts(
  profile: { school: string; major: string; bio: string; name: string } | null,
  goals: { roles: string[]; industries: string[]; locations: string[] } | null,
  facts: ResumeFact[],
): ComposerFact[] {
  const bubbles: ComposerFact[] = [];
  if (!facts.some((item) => item.category === "education") && profile?.school) {
    addBubble(bubbles, "you", "education", profile.school, [profile.school, profile.major].filter(Boolean).join(", "), "Profile");
  }
  for (const item of facts) {
    const pieces = item.category === "skill" || item.category === "interest" ? splitPieces(item.detail || item.label) : [shortLabel(item)];
    for (const piece of pieces) {
      addBubble(bubbles, "you", item.category, piece, factLine(item), "Resume");
    }
  }
  for (const role of goals?.roles ?? []) addBubble(bubbles, "you", "goal", role, role, "Career preferences");
  bubbles.push({
    id: "you:resume",
    group: "you",
    key: "resume",
    label: "Attach resume",
    detail: "Attach the uploaded resume",
    source: "Private resume file",
    available: facts.length > 0,
  });
  return bubbles;
}

function leadFacts(contact: Contact, jobs: { title: string }[]): ComposerFact[] {
  const source = contact.dataSource === "sample" ? "Sample directory" : "Provider profile";
  const bubbles: ComposerFact[] = [];
  addBubble(bubbles, "lead", "current_role", contact.title, `${contact.title} at ${contact.company}`, source);
  addBubble(bubbles, "lead", "company", contact.company, contact.company, source);
  if (contact.school) addBubble(bubbles, "lead", "school", contact.school, contact.school, source);
  for (const role of contact.previousRoles) addBubble(bubbles, "lead", "previous_role", role, role, source);
  for (const interest of contact.interests) addBubble(bubbles, "lead", "interest", interest, interest, source);
  for (const achievement of contact.achievements) addBubble(bubbles, "lead", "achievement", achievement, achievement, source);
  if (jobs[0]) addBubble(bubbles, "lead", "company_update", jobs[0].title, `${contact.company} listing: ${jobs[0].title}`, "Job listings on file");
  return bubbles;
}

const SHARED_STOP = new Set(["intern", "internship", "manager", "student", "college", "university", "experience", "role", "work", "team", "with", "from", "that", "this", "your", "about", "have", "been"]);

function markShared(you: ComposerFact[], lead: ComposerFact[]) {
  const youTokens = you.map((item) => new Set(tokens(`${item.label} ${item.detail}`)));
  const leadTokens = lead.map((item) => new Set(tokens(`${item.label} ${item.detail}`)));
  return {
    you: you.map((item, index) => ({ ...item, shared: item.key !== "resume" && shares(youTokens[index], leadTokens) })),
    lead: lead.map((item, index) => ({ ...item, shared: shares(leadTokens[index], youTokens) })),
  };
}

function shares(own: Set<string>, others: Array<Set<string>>) {
  for (const token of own) {
    if (others.some((set) => set.has(token))) return true;
  }
  return false;
}

function tokens(value: string) {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 3 && !SHARED_STOP.has(word));
}

function splitPieces(value: string) {
  const parts = value.split(/[,;•|/]|(?:\s+·\s+)/).map((part) => part.trim()).filter((part) => part.length > 1);
  return parts.length ? parts : [value.trim()].filter(Boolean);
}

function shortLabel(item: ResumeFact) {
  const label = item.label.trim();
  if (label && label.length <= 42 && label.toLowerCase() !== item.detail.trim().toLowerCase()) return label.replace(/\s+[|–-]\s+.*$/, "");
  return (item.detail || label).split(/[—,]/)[0]?.trim().slice(0, 42) || label;
}

function addBubble(out: ComposerFact[], group: "you" | "lead", key: string, label: string, detail: string, source: string) {
  const text = label.trim();
  if (!text || out.some((item) => item.group === group && item.label.toLowerCase() === text.toLowerCase())) return;
  const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  out.push(fact(group, `${key}:${slug || out.length}`, text.slice(0, 48), detail.trim() || text, source));
}

function factLine(item: ResumeFact) {
  if (!item.label || item.label === item.detail) return item.detail;
  return `${item.label} — ${item.detail}`;
}

function fact(group: "you" | "lead", key: string, label: string, detail: string, source: string): ComposerFact {
  return {
    id: `${group}:${key}`,
    group,
    key,
    label,
    detail,
    source,
    available: Boolean(detail.trim()) && !(key === "mutuals" && detail.trim() === ""),
  };
}

export async function generateEmail(userId: string, input: { contactId: string; factIds: string[]; tone: string; purpose: string; attachResume: boolean }) {
  if (!TONES.has(input.tone)) throw new ServiceError("Choose a tone.", "tone");
  if (!PURPOSES.has(input.purpose)) throw new ServiceError("Choose an email purpose.", "purpose");
  await assertAiAllowed(userId, "email");
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const recent = await repo.listGenerations(userId, hourAgo);
  const daily = await repo.listGenerations(userId, dayAgo);
  const config = serverConfig();
  if (recent.length >= config.aiHourlyLimit || daily.length >= config.aiDailyLimit) {
    throw new ServiceError("AI email limit reached for now. You can still edit and send a draft.", "ai_limit", 429);
  }
  const context = await composerContext(userId, input.contactId);
  const selected = [...context.you, ...context.lead].filter((item) => input.factIds.includes(item.id) && item.available && item.key !== "resume");
  const user = await repo.getUserById(userId);
  const grounded = generateGroundedEmail({
    studentName: user?.name || "Student",
    leadFirstName: context.contact.firstName,
    leadTitle: context.contact.title,
    leadCompany: context.contact.company,
    purpose: input.purpose as EmailPurpose,
    tone: input.tone as EmailTone,
    facts: selected,
    attachResume: input.attachResume,
  });
  const ai = await maybeAnthropic(userId, grounded, selected, input.tone, input.purpose);
  const draft = await repo.insertDraft({
    id: id(),
    userId,
    savedContactId: context.saved.id,
    subject: ai.subject,
    body: ai.body,
    tone: input.tone,
    purpose: input.purpose,
    selectedFactIds: input.factIds,
    attachResume: input.attachResume,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
  await repo.insertGeneration({
    id: id(),
    userId,
    purpose: "email",
    model: ai.model,
    inputTokens: ai.inputTokens,
    outputTokens: ai.outputTokens,
    costCents: ai.costCents,
    estimated: ai.estimated,
    createdAt: nowIso(),
  });
  await repo.insertAnalytics({ userId, name: "generate_email", properties: { model: ai.model } });
  return { draft, subject: ai.subject, body: ai.body, model: ai.model, wordCount: ai.wordCount, creditsCharged: 0 };
}

async function maybeAnthropic(
  userId: string,
  grounded: ReturnType<typeof generateGroundedEmail>,
  facts: ComposerFact[],
  tone: string,
  purpose: string,
) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { ...grounded, inputTokens: 0, outputTokens: 0, costCents: 0, estimated: true };
  }
  const model = process.env.ANTHROPIC_FAST_MODEL || "claude-haiku-4-5";
  const config = serverConfig();
  const factBlock = facts.map((fact) => `- ${fact.group === "you" ? "Student" : "Lead"} — ${fact.label}: ${fact.detail}`).join("\n");
  const started = Date.now();
  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model,
      max_tokens: 220,
      system: [
        {
          type: "text",
          text: "You write student outreach emails. Use only the facts provided. Facts labeled as the student describe the sender. Facts labeled as the lead describe the recipient. Never give the recipient the student's school, jobs, or interests. If a fact is absent, do not invent posts, mutual connections, employers, or interests. The body is one short paragraph under 60 words, then a sign-off with the student's name. Return JSON with subject and body.",
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: `Tone: ${tone}\nPurpose: ${purpose}\nFacts:\n${factBlock}\nFallback if you cannot comply:\n${grounded.body}`,
        },
      ],
    });
    const text = response.content.map((block) => (block.type === "text" ? block.text : "")).join("\n");
    const parsed = parseModelJson(text);
    const inputTokens = response.usage?.input_tokens ?? 0;
    const outputTokens = response.usage?.output_tokens ?? 0;
    const costCents =
      (inputTokens * config.fastInputCentsPerMillion + outputTokens * config.fastOutputCentsPerMillion) / 1_000_000;
    await repo.insertUsage({
      id: id(),
      userId,
      provider: "anthropic",
      operation: "email",
      success: true,
      latencyMs: Date.now() - started,
      costCents,
      estimated: true,
      error: null,
      createdAt: nowIso(),
    });
    const body = oneShortEmail(parsed.body, grounded.body);
    return {
      subject: parsed.subject || grounded.subject,
      body,
      wordCount: body.trim().split(/\s+/).length,
      model,
      inputTokens,
      outputTokens,
      costCents,
      estimated: true,
    };
  } catch (error) {
    await repo.insertUsage({
      id: id(),
      userId,
      provider: "anthropic",
      operation: "email",
      success: false,
      latencyMs: Date.now() - started,
      costCents: 0,
      estimated: true,
      error: error instanceof Error ? error.message : "anthropic_failed",
      createdAt: nowIso(),
    });
    return { ...grounded, inputTokens: 0, outputTokens: 0, costCents: 0, estimated: true };
  }
}

function oneShortEmail(candidate: string, fallback: string) {
  const body = candidate.trim();
  if (!body) return fallback;
  const prose = body.split(/\n\s*\n/).map((part) => part.trim()).filter((part) => part.split(/\s+/).length > 8);
  if (prose.length > 1 || body.split(/\s+/).length > 90) return fallback;
  return body;
}

function parseModelJson(text: string) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { subject: "", body: "" };
  try {
    const value = JSON.parse(match[0]) as { subject?: string; body?: string };
    return { subject: value.subject ?? "", body: value.body ?? "" };
  } catch {
    return { subject: "", body: "" };
  }
}
