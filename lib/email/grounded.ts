import { wordCount } from "@/lib/format";

export type ComposerFact = {
  id: string;
  group: "you" | "lead";
  key: string;
  label: string;
  detail: string;
  source: string;
  available: boolean;
};

export type EmailPurpose = "internship" | "full_time" | "informational" | "mentorship" | "networking";
export type EmailTone = "professional" | "friendly" | "casual" | "direct";

const ASKS: Record<EmailPurpose, string> = {
  internship: "I am looking for an internship and would value 15 minutes to ask how you would approach breaking in.",
  full_time: "I am preparing for full-time roles and would value a short conversation about your team.",
  informational: "Would you be open to a 15-minute informational conversation about your path?",
  mentorship: "If you have a few minutes, I would be grateful for any advice you would give a student in my position.",
  networking: "I would be glad to introduce myself and hear how you think about the work.",
};

const OPENS: Record<EmailTone, (first: string) => string> = {
  professional: (first) => `Hi ${first},`,
  friendly: (first) => `Hi ${first},`,
  casual: (first) => `Hey ${first},`,
  direct: (first) => `Hi ${first},`,
};

export function generateGroundedEmail(input: {
  studentName: string;
  leadFirstName: string;
  leadTitle: string;
  leadCompany: string;
  purpose: EmailPurpose;
  tone: EmailTone;
  facts: ComposerFact[];
  attachResume: boolean;
}) {
  const selected = input.facts.filter((fact) => fact.available && fact.detail.trim());
  const you = selected.filter((fact) => fact.group === "you");
  const lead = selected.filter((fact) => fact.group === "lead");
  const education = you.find((fact) => fact.key === "education");
  const experience = you.find((fact) => fact.key === "experience" || fact.key === "internship");
  const projects = you.find((fact) => fact.key === "project");
  const skills = you.find((fact) => fact.key === "skill");
  const interests = you.find((fact) => fact.key === "interest");
  const goals = you.find((fact) => fact.key === "goal");
  const shared = lead.find((fact) => fact.key === "shared_interests");
  const companyUpdate = lead.find((fact) => fact.key === "company_updates");
  const leadEducation = lead.find((fact) => fact.key === "education");
  const currentRole = lead.find((fact) => fact.key === "current_role");

  const sentences: string[] = [OPENS[input.tone](input.leadFirstName), ""];
  const intro: string[] = [];
  if (education) intro.push(`I'm a student — ${education.detail}`);
  if (goals) intro.push(goals.detail);
  if (intro.length === 0) intro.push(`I am a student reaching out about ${input.leadTitle} work at ${input.leadCompany}`);
  const role = currentRole?.detail || `${input.leadTitle} at ${input.leadCompany}`;
  sentences.push(`${intro.join(". ").replace(/\.$/, "")}. I am writing because of your role as ${role}.`);
  if (experience) sentences.push(`From my own background: ${experience.detail}.`);
  if (projects) sentences.push(`A related project: ${projects.detail}.`);
  if (skills) sentences.push(`Skills I can speak to: ${skills.detail}.`);
  if (interests) sentences.push(`Interests I listed on my profile: ${interests.detail}.`);
  if (shared) sentences.push(`Overlap I can actually point to: ${shared.detail}.`);
  if (companyUpdate) sentences.push(`From listings we have on file: ${companyUpdate.detail}.`);
  if (leadEducation) sentences.push(`Your education on file: ${leadEducation.detail}.`);
  sentences.push(ASKS[input.purpose]);
  if (input.attachResume) sentences.push("I have attached my resume for context.");
  const signOff = input.tone === "casual" ? "Thanks," : "Best,";
  sentences.push("", signOff, input.studentName);

  const body = sentences.join("\n").replace(/\n{3,}/g, "\n\n");
  const subjectBits = [education ? "student" : "hello", input.leadTitle.split(" ")[0]?.toLowerCase(), input.leadCompany].filter(Boolean);
  const subject = `${input.studentName.split(" ")[0]} — ${subjectBits.slice(1).join(" at ") || input.leadCompany}`;
  return {
    subject: subject.slice(0, 120),
    body,
    wordCount: wordCount(body),
    usedFactIds: selected.map((fact) => fact.id),
    model: "grounded-template",
  };
}

export function bodyUsesOnlyFacts(body: string, facts: ComposerFact[], allowedPhrases: string[]) {
  const lowered = body.toLowerCase();
  const banned = ["goldman sachs", "mckinsey", "i saw your post", "mutual connection", "we both went", "forbes"];
  if (banned.some((phrase) => lowered.includes(phrase) && !facts.some((fact) => fact.detail.toLowerCase().includes(phrase)))) {
    return false;
  }
  for (const phrase of allowedPhrases) {
    if (!lowered.includes(phrase.toLowerCase())) return false;
  }
  return true;
}
