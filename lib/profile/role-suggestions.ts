import { serverConfig } from "@/lib/config";
import { id, nowIso, readAnthropicKey, repo } from "@/lib/db/file-store";
import { suggestRoles } from "@/lib/roles";
import type { StudentProfile } from "@/lib/profile/student";

/**
 * "Roles you want" bubbles in onboarding: a few roles that fit the student's resume and past experience. Claude
 * picks them when a key is set; otherwise (or if it fails) they come from the job titles and skills on the resume.
 */

const MAX = 8;

function profileText(profile: StudentProfile) {
  const school = profile.education[0];
  return [
    school ? `School: ${school.school}. ${school.degree} ${school.major}${school.minor ? `, minor ${school.minor}` : ""}. Graduates ${school.gradDate}.` : "",
    ...profile.experience.map((job) => `Experience: ${job.title} at ${job.company}. ${job.bullets.slice(0, 3).join(" ")}`),
    ...profile.projects.map((project) => `Project: ${project.name}. ${project.bullets.slice(0, 2).join(" ")} ${(project.tech ?? []).join(", ")}`),
    profile.skills.technical.length ? `Skills: ${profile.skills.technical.join(", ")}` : "",
    profile.essays.whyField ? `Interest: ${profile.essays.whyField}` : "",
  ].filter(Boolean).join("\n").slice(0, 4000);
}

function fromResume(profile: StudentProfile) {
  const blob = profileText(profile);
  const { similar } = suggestRoles([], blob);
  const titles = profile.experience.map((job) => job.title.trim()).filter((title) => title && title.length < 50);
  return [...titles, ...similar];
}

const clean = (roles: string[], taken: string[]) => {
  const seen = new Set(taken.map((role) => role.toLowerCase()));
  return roles.map((role) => role.replace(/^[-*•\d.\s]+/, "").replace(/["']/g, "").trim()).filter((role) => {
    const key = role.toLowerCase();
    if (!role || role.length > 50 || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, MAX);
};

async function fromModel(userId: string, profile: StudentProfile): Promise<string[] | null> {
  const apiKey = await readAnthropicKey();
  const text = profileText(profile);
  if (!apiKey || !text) return null;
  const model = process.env.ANTHROPIC_FAST_MODEL || "claude-haiku-4-5";
  const started = Date.now();
  let success = false;
  let costCents = 0;
  let error: string | null = null;
  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model,
      max_tokens: 300,
      system: "You suggest job roles for a college student's job search. Given their resume details, reply with 6 to 8 specific role titles they'd be a good fit for (internships or entry-level), one per line, nothing else. Mix roles that match their past experience with nearby roles they could stretch into. Keep each title under 6 words.",
      messages: [{ role: "user", content: text }],
    });
    const raw = response.content.map((block) => (block.type === "text" ? block.text : "")).join("\n");
    const config = serverConfig();
    costCents = ((response.usage?.input_tokens ?? 0) * config.fastInputCentsPerMillion + (response.usage?.output_tokens ?? 0) * config.fastOutputCentsPerMillion) / 1_000_000;
    const roles = raw.split("\n").map((line) => line.trim()).filter(Boolean);
    success = roles.length > 0;
    return success ? roles : null;
  } catch (reason) {
    error = reason instanceof Error ? reason.message : "anthropic_failed";
    return null;
  } finally {
    await repo.insertUsage({ id: id(), userId, provider: "anthropic", operation: "role_suggestions", success, latencyMs: Date.now() - started, costCents, estimated: true, error: success ? null : error ?? "no_roles", createdAt: nowIso() }).catch(() => undefined);
  }
}

export async function roleSuggestions(userId: string, profile: StudentProfile) {
  const taken = profile.preferences.roles ?? [];
  const model = await fromModel(userId, profile);
  const roles = clean(model ?? fromResume(profile), taken);
  return { roles, ai: Boolean(model) };
}
