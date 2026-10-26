import { wordCount } from "@/lib/format";

export type ComposerFact = {
  id: string;
  group: "you" | "lead";
  key: string;
  label: string;
  detail: string;
  source: string;
  available: boolean;
  shared?: boolean;
};

export type EmailPurpose = "internship" | "full_time" | "informational" | "mentorship" | "networking";
export type EmailTone = "professional" | "friendly" | "casual" | "direct";

const ASKS: Record<EmailPurpose, string> = {
  internship: "Would you have 15 minutes to talk about internships?",
  full_time: "Would you have 15 minutes to talk about full-time roles?",
  informational: "Would you have 15 minutes for a quick chat?",
  mentorship: "Would you have a few minutes to share any advice?",
  networking: "Would you be open to a short intro?",
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
  const selected = input.facts.filter((fact) => fact.available && fact.detail.trim() && fact.key !== "resume");
  const you = selected.filter((fact) => fact.group === "you").slice(0, 2);
  const lead = selected.filter((fact) => fact.group === "lead" && !fact.shared).slice(0, 2);
  const shared = unique(selected.filter((fact) => fact.shared).map(mention)).slice(0, 2);
  const student = input.studentName.split(" ")[0] || "there";
  const hello = OPENS[input.tone](input.leadFirstName).replace(/,$/, "");
  const aboutYou = you.length ? `I'm ${student} — ${you.map(mention).join(", ")}.` : `I'm ${student}, a student.`;
  const aboutLead = lead.length
    ? ` I'm reaching out because of ${lead.map(mention).join(" and ")}.`
    : ` I'm reaching out about your role as ${input.leadTitle} at ${input.leadCompany}.`;
  const both = shared.length ? ` We both share ${shared.join(" and ")}.` : "";
  const resume = input.attachResume ? " My resume is attached." : "";
  const paragraph = `${hello}, ${aboutYou}${aboutLead}${both} ${ASKS[input.purpose]}${resume}`;
  const signOff = input.tone === "casual" ? "Thanks," : "Best,";
  const body = `${paragraph}\n\n${signOff}\n${input.studentName}`;
  const subject = `${student} — ${input.leadCompany}`;
  return {
    subject: subject.slice(0, 120),
    body,
    wordCount: wordCount(body),
    usedFactIds: selected.map((fact) => fact.id),
    model: "grounded-template",
  };
}

function mention(fact: ComposerFact) {
  const detail = fact.detail.trim();
  return detail.length <= 80 ? detail : fact.label;
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
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
