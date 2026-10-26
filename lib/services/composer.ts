import { serverConfig } from "@/lib/config";
import { id, nowIso, repo } from "@/lib/db/file-store";
import type { Contact, ResumeFact } from "@/lib/db/types";
import { generateGroundedEmail, type ComposerFact, type EmailPurpose, type EmailTone } from "@/lib/email/grounded";
import { ServiceError } from "@/lib/errors";

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
  const user = await repo.getUserById(userId);
  const you = studentFacts(profile, goals, facts, user?.name ?? "Student");
  const lead = leadFacts(contact, you, jobs.filter((job) => job.company.toLowerCase() === contact.company.toLowerCase()));
  return { saved, contact, you, lead, email: contact.email };
}

function studentFacts(
  profile: { school: string; major: string; bio: string; name: string } | null,
  goals: { roles: string[]; industries: string[]; locations: string[] } | null,
  facts: ResumeFact[],
  name: string,
): ComposerFact[] {
  const educationFact = facts.find((fact) => fact.category === "education");
  const educationDetail = educationFact
    ? factLine(educationFact)
    : [profile?.school, profile?.major].filter(Boolean).join(" · ");
  const experience = facts.filter((fact) => fact.category === "experience" || fact.category === "internship");
  const projects = facts.filter((fact) => fact.category === "project");
  const skills = facts.filter((fact) => fact.category === "skill");
  const interests = facts.filter((fact) => fact.category === "interest");
  const goalsText = goals ? [...goals.roles, ...goals.industries, ...goals.locations].filter(Boolean).join(", ") : "";
  return [
    fact("you", "education", "Current role / education", educationDetail, educationFact ? "Resume" : "Profile"),
    fact("you", "experience", "Past experience", experience.map(factLine).join("; "), "Resume"),
    fact("you", "project", "Projects", projects.map(factLine).join("; "), "Resume"),
    fact("you", "skill", "Skills", skills.map(factLine).join(", "), "Resume"),
    fact("you", "interest", "Interests", interests.map(factLine).join(", "), "Resume"),
    fact("you", "goal", "Career goals", goalsText, "Career preferences"),
    {
      id: "you:resume",
      group: "you",
      key: "resume",
      label: "Resume",
      detail: "Attach the uploaded resume",
      source: "Private resume file",
      available: facts.length > 0,
    },
  ];
}

function leadFacts(contact: Contact, you: ComposerFact[], jobs: { title: string }[]): ComposerFact[] {
  const studentTokens = new Set(
    (you.find((item) => item.key === "interest")?.detail.toLowerCase() ?? "").split(/[^a-z0-9]+/).filter((token) => token.length > 3),
  );
  const overlap = contact.interests.filter((interest) =>
    interest
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .some((token) => token.length > 3 && studentTokens.has(token)),
  );
  const companyUpdate = jobs[0] ? `${contact.company} has a listing on file: ${jobs[0].title}.` : "";
  return [
    fact("lead", "current_role", "Current role", `${contact.title} at ${contact.company}`, contact.dataSource === "sample" ? "Sample directory" : "Provider profile"),
    fact("lead", "previous_roles", "Previous roles", contact.previousRoles.join("; "), contact.dataSource === "sample" ? "Sample directory" : "Provider profile"),
    fact("lead", "education", "Education background", contact.school ?? "", contact.dataSource === "sample" ? "Sample directory" : "Provider profile"),
    fact("lead", "public_posts", "Recent posts / activity", contact.publicPosts.map((item) => item.detail).join("; "), contact.publicPosts[0]?.source ?? "No public posts on file"),
    fact("lead", "company_updates", "Company updates", companyUpdate, jobs[0] ? "Job listings on file" : "No company update on file"),
    fact("lead", "achievements", "Relevant achievements", contact.achievements.join("; "), "Provider profile"),
    fact("lead", "shared_interests", "Shared interests", overlap.length ? overlap.join(", ") : "", "Overlap between your interests and this profile"),
    fact("lead", "mutuals", "Verified mutual connections", contact.verifiedMutuals.join(", "), "Verified connections"),
  ];
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
  const factBlock = facts.map((fact) => `- ${fact.label}: ${fact.detail} (source: ${fact.source})`).join("\n");
  const started = Date.now();
  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model,
      max_tokens: 700,
      system: [
        {
          type: "text",
          text: "You write short student outreach emails. Use only the facts provided. If a fact is absent, do not invent posts, mutual connections, employers, or interests. 80 to 150 words. Return JSON with subject and body.",
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
    return {
      subject: parsed.subject || grounded.subject,
      body: parsed.body || grounded.body,
      wordCount: (parsed.body || grounded.body).trim().split(/\s+/).length,
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
