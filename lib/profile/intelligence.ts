import { createHash } from "node:crypto";
import type { ResumeFact } from "@/lib/db/types";
import { integrations } from "@/lib/integrations/flags";

/** Form fields from the supplied onboarding component. */
export type FormProfile = {
  school: string;
  major: string;
  graduationYear: string;
  interests: string[];
  otherInterests: string;
  targetRoles: string;
  dreamCompanies: string;
  locations: string;
  workPreference: string;
  goals: string[];
  contactTypes: string[];
  seniority: string;
  bio: string;
  accomplishments: string;
  excludedTopics: string;
  emailTone: string;
};

export type ProfileSection =
  | "personal_education"
  | "employment"
  | "skills"
  | "projects"
  | "interests"
  | "career_goals"
  | "industries_locations"
  | "networking"
  | "story"
  | "email_preferences"
  | "excluded_topics";

export type FactSource = {
  kind: "onboarding_field" | "onboarding_model" | "resume_file";
  field?: string;
  resumeId?: string;
  excerpt?: string;
};

export type StructuredFact = {
  id: string;
  section: ProfileSection;
  label: string;
  text: string;
  source: FactSource;
  corroboration: FactSource | null;
  verificationStatus: "user_entered" | "file_extracted";
  approvalStatus: "approved" | "pending_review";
  uncertain: boolean;
  inconsistencyNote: string | null;
};

const WORK: Record<string, string> = {
  either: "Open to remote, hybrid, or in-person work",
  remote: "Prefers remote work",
  hybrid: "Prefers hybrid work",
  onsite: "Prefers in-person work",
};

const SENIORITY: Record<string, string> = {
  balanced: "Open to a mix of experience levels",
  early: "Prefers early-career professionals",
  manager: "Prefers managers and directors",
  executive: "Prefers founders and executives",
};

const TONE: Record<string, string> = {
  friendly: "Friendly and conversational",
  professional: "Professional and polished",
  direct: "Short and direct",
  casual: "Casual and personable",
};

const RESUME_SECTION: Record<string, ProfileSection> = {
  education: "personal_education",
  experience: "employment",
  internship: "employment",
  skill: "skills",
  project: "projects",
  leadership: "projects",
  achievement: "projects",
  interest: "interests",
  goal: "career_goals",
};

function clean(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function factId(section: string, text: string) {
  const norm = clean(text).toLowerCase();
  return `fact_${createHash("sha256").update(`${section}:${norm}`).digest("hex").slice(0, 16)}`;
}

function yearsIn(text: string) {
  return [...text.matchAll(/\b(20\d{2})\b/g)].map((match) => match[1]);
}

export class ProfileIntelligenceService {
  /**
   * Organizes onboarding answers and heading-level resume lines.
   * This path is deterministic. It does not call a model.
   */
  organize(input: { profile: FormProfile; resumeFacts?: ResumeFact[] }): { facts: StructuredFact[]; inconsistencies: string[] } {
    const facts: StructuredFact[] = [];
    const add = (section: ProfileSection, label: string, text: string, field: string) => {
      const value = clean(text);
      if (!value) return;
      const id = factId(section, value);
      if (facts.some((fact) => fact.id === id)) return;
      facts.push({
        id,
        section,
        label,
        text: value,
        source: { kind: "onboarding_field", field },
        corroboration: null,
        verificationStatus: "user_entered",
        approvalStatus: "approved",
        uncertain: false,
        inconsistencyNote: null,
      });
    };

    const profile = input.profile;
    add("personal_education", "School", profile.school, "school");
    add("personal_education", "Major", profile.major, "major");
    add("personal_education", "Graduation year", profile.graduationYear, "graduationYear");
    for (const interest of profile.interests) add("interests", "Interest", interest, "interests");
    for (const extra of profile.otherInterests.split(/[,;\n]/)) add("interests", "Interest", extra, "otherInterests");
    add("career_goals", "Target roles", profile.targetRoles, "targetRoles");
    add("career_goals", "Target companies", profile.dreamCompanies, "dreamCompanies");
    add("industries_locations", "Preferred locations", profile.locations, "locations");
    add("industries_locations", "Work preference", WORK[profile.workPreference] || profile.workPreference, "workPreference");
    for (const goal of profile.goals) add("networking", "Networking goal", goal, "goals");
    for (const contact of profile.contactTypes) add("networking", "Preferred contact", contact, "contactTypes");
    add("networking", "Seniority preference", SENIORITY[profile.seniority] || profile.seniority, "seniority");
    add("story", "Personal story", profile.bio, "bio");
    add("projects", "Accomplishment", profile.accomplishments, "accomplishments");
    add("excluded_topics", "Do not mention", profile.excludedTopics, "excludedTopics");
    add("email_preferences", "Email tone", TONE[profile.emailTone] || profile.emailTone, "emailTone");

    const inconsistencies: string[] = [];
    const school = clean(profile.school).toLowerCase();
    const gradYear = clean(profile.graduationYear);

    for (const resumeFact of input.resumeFacts ?? []) {
      const section = RESUME_SECTION[resumeFact.category];
      if (!section) continue;
      const text = clean(resumeFact.detail || resumeFact.label);
      if (!text) continue;
      const id = factId(section, text);
      const existing = facts.find((fact) => fact.id === id);
      const source: FactSource = {
        kind: "resume_file",
        resumeId: resumeFact.resumeId,
        excerpt: clean(resumeFact.sourceExcerpt || text).slice(0, 240),
        field: resumeFact.category,
      };
      if (existing) {
        existing.corroboration = source;
        continue;
      }
      let uncertain = false;
      let inconsistencyNote: string | null = null;
      if (section === "personal_education" && school && !text.toLowerCase().includes(school)) {
        uncertain = true;
        inconsistencyNote = "This resume line does not mention the school entered in onboarding.";
      }
      const lineYears = yearsIn(text);
      if (section === "personal_education" && gradYear && lineYears.length && !lineYears.includes(gradYear)) {
        uncertain = true;
        inconsistencyNote = `This resume line mentions ${lineYears.join(", ")}, which differs from graduation year ${gradYear}.`;
      }
      if (inconsistencyNote) inconsistencies.push(inconsistencyNote);
      facts.push({
        id,
        section,
        label: resumeFact.label || resumeFact.category,
        text,
        source,
        corroboration: null,
        verificationStatus: "file_extracted",
        approvalStatus: "pending_review",
        uncertain,
        inconsistencyNote,
      });
    }

    return { facts, inconsistencies: [...new Set(inconsistencies)] };
  }

  approvedForOutreach(facts: StructuredFact[], excludedTopics: string) {
    const blocked = excludedTopics
      .split(/[,;\n]/)
      .map((part) => clean(part).toLowerCase())
      .filter((part) => part.length > 2);
    return facts
      .filter((fact) => fact.approvalStatus === "approved" && fact.section !== "excluded_topics")
      .filter((fact) => !blocked.some((phrase) => fact.text.toLowerCase().includes(phrase)))
      .map((fact) => ({ id: fact.id, text: fact.text, verified: true as const }));
  }

  /** Reserved for a later Anthropic pass. It does not call the network. */
  async interpretWithModel(): Promise<never> {
    if (!integrations.anthropic) {
      throw new Error("Anthropic profile interpretation is not connected.");
    }
    throw new Error("Anthropic profile interpretation is not implemented.");
  }
}

export const profileIntelligence = new ProfileIntelligenceService();
