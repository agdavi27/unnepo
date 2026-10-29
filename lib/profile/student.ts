/**
 * The student profile: everything a job application asks for, collected resume-first. It's what the
 * autofill mapping sends to the model, what the extension fills forms from, and what job recommendations
 * score against. Stored inside application_profiles.data (the `student` key).
 */
export type Education = { school: string; degree: string; major: string; minor?: string; gpa?: string; startDate?: string; gradDate: string; coursework?: string[] };
export type Experience = { company: string; title: string; location?: string; startDate: string; endDate?: string; current: boolean; bullets: string[] };
export type Project = { name: string; role?: string; url?: string; bullets: string[]; tech?: string[] };
export type YesNo = boolean | null;

export type StudentProfile = {
  contact: { firstName: string; lastName: string; preferredName?: string; email: string; phone?: string; city?: string; state?: string; country?: string; zip?: string; willingToRelocate?: YesNo };
  links: { linkedin?: string; github?: string; portfolio?: string; other?: string[] };
  education: Education[];
  experience: Experience[];
  projects: Project[];
  skills: { technical: string[]; languages?: string[]; certifications?: string[] };
  workAuth: { authorizedUS: YesNo; needsSponsorship: YesNo; over18: YesNo; citizenship?: string };
  /** Each defaults to "decline". */
  eeo: { gender: string; race: string; hispanicLatino: string; veteran: string; disability: string };
  preferences: { roles: string[]; industries: string[]; locations: string[]; remote: "yes" | "no" | "either"; startTerm?: string; jobType: "internship" | "full_time" | "either" };
  standardAnswers: { heardAbout?: string; earliestStart?: string; salaryExpectation?: string; inPerson?: YesNo };
  essays: { aboutMe?: string; whyField?: string };
  /** Answers the student gave to new questions in applications; matched later by question text, no AI. */
  savedAnswers: Array<{ question: string; answer: string; updatedAt: string }>;
  /** Field path -> where its value came from. */
  sources: Record<string, "resume" | "student" | "ai">;
  /** The email the extension uses for job-site accounts. Passwords never reach the server. */
  accountEmail?: string;
  /** Gap cards the student answered or skipped, so they aren't asked again. */
  done: string[];
  resumeFileId?: string;
  /** Set when the student confirms what Unnepo read from their resume. */
  confirmedAt?: string | null;
  completeness: number;
  updatedAt: string;
};

export const DECLINE = "decline";

export const EEO_OPTIONS: Record<keyof StudentProfile["eeo"], Array<[string, string]>> = {
  gender: [[DECLINE, "Decline to answer"], ["woman", "Woman"], ["man", "Man"], ["non_binary", "Non-binary"], ["other", "Another gender"]],
  race: [[DECLINE, "Decline to answer"], ["american_indian", "American Indian or Alaska Native"], ["asian", "Asian"], ["black", "Black or African American"], ["pacific_islander", "Native Hawaiian or Other Pacific Islander"], ["white", "White"], ["two_or_more", "Two or more races"]],
  hispanicLatino: [[DECLINE, "Decline to answer"], ["yes", "Yes"], ["no", "No"]],
  veteran: [[DECLINE, "Decline to answer"], ["not_protected", "I am not a protected veteran"], ["protected", "I identify as a protected veteran"]],
  disability: [[DECLINE, "Decline to answer"], ["yes", "Yes, I have a disability"], ["no", "No, I don't have a disability"]],
};

export function emptyStudentProfile(email = "", name = ""): StudentProfile {
  const [firstName = "", ...rest] = name.trim().split(/\s+/);
  return {
    contact: { firstName, lastName: rest.join(" "), email },
    links: {},
    education: [],
    experience: [],
    projects: [],
    skills: { technical: [] },
    workAuth: { authorizedUS: null, needsSponsorship: null, over18: null },
    eeo: { gender: DECLINE, race: DECLINE, hispanicLatino: DECLINE, veteran: DECLINE, disability: DECLINE },
    preferences: { roles: [], industries: [], locations: [], remote: "either", jobType: "either" },
    standardAnswers: {},
    essays: {},
    savedAnswers: [],
    sources: {},
    accountEmail: email,
    done: [],
    confirmedAt: null,
    completeness: 0,
    updatedAt: new Date().toISOString(),
  };
}

const has = (value: unknown) => (Array.isArray(value) ? value.length > 0 : typeof value === "boolean" ? true : Boolean(String(value ?? "").trim()));

/** How ready the profile is for applications, 0–100. Weighted toward what forms require. */
export function completeness(p: StudentProfile) {
  const school = p.education[0];
  const checks: Array<[number, boolean]> = [
    [3, has(p.contact.firstName) && has(p.contact.lastName)],
    [3, has(p.contact.email)],
    [3, has(p.contact.phone)],
    [2, has(p.contact.city) && has(p.contact.state)],
    [3, has(school?.school)],
    [2, has(school?.degree)],
    [2, has(school?.major)],
    [2, has(school?.gradDate)],
    [3, p.experience.length + p.projects.length > 0],
    [1, p.skills.technical.length > 0],
    [3, p.workAuth.authorizedUS !== null],
    [3, p.workAuth.needsSponsorship !== null],
    [1, p.workAuth.over18 !== null],
    [1, has(p.links.linkedin)],
    [1, p.done.includes("eeo")],
    [2, p.preferences.roles.length > 0],
    [1, has(p.standardAnswers.heardAbout) || p.done.includes("standard")],
  ];
  const total = checks.reduce((sum, [weight]) => sum + weight, 0);
  return Math.round((checks.reduce((sum, [weight, ok]) => sum + (ok ? weight : 0), 0) / total) * 100);
}

/** The "fill the gaps" cards, in order. Each asks only what the resume couldn't answer. */
export type GapId = "work_auth" | "education" | "contact" | "links" | "eeo" | "preferences" | "standard" | "essays" | "account";
export type Gap = { id: GapId; title: string; why: string; optional: boolean };

const GAPS: Array<Gap & { missing: (p: StudentProfile) => boolean }> = [
  { id: "work_auth", title: "Work authorization", why: "Almost every application asks. Unnepo only ever uses your own answer.", optional: false, missing: (p) => p.workAuth.authorizedUS === null || p.workAuth.needsSponsorship === null || p.workAuth.over18 === null },
  { id: "education", title: "Graduation", why: "Forms ask for your graduation month and year, and often your GPA.", optional: false, missing: (p) => !p.education[0]?.gradDate?.trim() || !p.education[0]?.school?.trim() },
  { id: "contact", title: "Phone and location", why: "For the contact section of every application.", optional: false, missing: (p) => !p.contact.phone?.trim() || !p.contact.city?.trim() || !p.contact.state?.trim() || p.contact.willingToRelocate === undefined },
  { id: "links", title: "Links", why: "LinkedIn, GitHub, or a portfolio, if you have them.", optional: true, missing: (p) => !p.links.linkedin?.trim() || (!p.links.github?.trim() && !p.links.portfolio?.trim()) },
  { id: "eeo", title: "Voluntary self-identification", why: "Many forms ask these. \"Decline to answer\" is the default and is always fine.", optional: true, missing: () => true },
  { id: "preferences", title: "What you're looking for", why: "Used to recommend jobs that fit.", optional: true, missing: (p) => p.preferences.roles.length === 0 },
  { id: "standard", title: "Common questions", why: "Saved once, filled on every form that asks.", optional: true, missing: (p) => !p.standardAnswers.heardAbout?.trim() || !p.standardAnswers.earliestStart?.trim() || p.standardAnswers.inPerson === undefined },
  { id: "essays", title: "A little about you", why: "Two short answers Unnepo builds on for essay questions and emails. Optional.", optional: true, missing: (p) => !p.essays.aboutMe?.trim() && !p.essays.whyField?.trim() },
  { id: "account", title: "Job-site accounts", why: "Workday and similar sites need an account. The extension creates them with this email. Your passwords stay on your computer.", optional: false, missing: (p) => !p.accountEmail?.trim() },
];

/** Gap cards still to show: missing something and not answered or skipped yet. */
export function missingGaps(p: StudentProfile): Gap[] {
  return GAPS.filter((gap) => !p.done.includes(gap.id) && gap.missing(p)).map(({ id, title, why, optional }) => ({ id, title, why, optional }));
}

const text = (value: unknown, max = 300) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const list = (value: unknown, max = 30, length = 120) => (Array.isArray(value) ? value : String(value ?? "").split(/[,;\n]/)).map((item) => text(item, length)).filter(Boolean).slice(0, max);
const yesNo = (value: unknown): YesNo => (value === true || value === "yes" ? true : value === false || value === "no" ? false : null);
const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);

/** Cleans a profile coming from the page: lengths capped, unknown keys dropped, options checked. */
export function cleanStudentProfile(raw: unknown, base: StudentProfile): StudentProfile {
  const r = (raw ?? {}) as Partial<Record<keyof StudentProfile, unknown>>;
  const c = { ...base.contact, ...((r.contact ?? {}) as Record<string, unknown>) } as Record<string, unknown>;
  const l = { ...base.links, ...((r.links ?? {}) as Record<string, unknown>) } as Record<string, unknown>;
  const w = { ...base.workAuth, ...((r.workAuth ?? {}) as Record<string, unknown>) } as Record<string, unknown>;
  const e = { ...base.eeo, ...((r.eeo ?? {}) as Record<string, unknown>) } as Record<string, unknown>;
  const pr = { ...base.preferences, ...((r.preferences ?? {}) as Record<string, unknown>) } as Record<string, unknown>;
  const st = { ...base.standardAnswers, ...((r.standardAnswers ?? {}) as Record<string, unknown>) } as Record<string, unknown>;
  const es = { ...base.essays, ...((r.essays ?? {}) as Record<string, unknown>) } as Record<string, unknown>;
  const sk = { ...base.skills, ...((r.skills ?? {}) as Record<string, unknown>) } as Record<string, unknown>;
  const entries = <T,>(value: unknown, fallback: T[], map: (item: Record<string, unknown>) => T, keep: (item: T) => boolean) =>
    (Array.isArray(value) ? value.slice(0, 12).map((item) => map((item ?? {}) as Record<string, unknown>)).filter(keep) : fallback);
  const eeoKey = (key: keyof StudentProfile["eeo"]) => pick(e[key], EEO_OPTIONS[key].map(([value]) => value), DECLINE);
  const relocate = c.willingToRelocate === undefined ? undefined : yesNo(c.willingToRelocate);
  const inPerson = st.inPerson === undefined ? undefined : yesNo(st.inPerson);
  return {
    ...base,
    contact: {
      firstName: text(c.firstName, 80), lastName: text(c.lastName, 80), preferredName: text(c.preferredName, 80) || undefined, email: text(c.email, 200),
      phone: text(c.phone, 40) || undefined, city: text(c.city, 80) || undefined, state: text(c.state, 80) || undefined, country: text(c.country, 80) || undefined, zip: text(c.zip, 20) || undefined,
      willingToRelocate: relocate,
    },
    links: { linkedin: text(l.linkedin, 300) || undefined, github: text(l.github, 300) || undefined, portfolio: text(l.portfolio, 300) || undefined, other: list(l.other, 5, 300) },
    education: entries(r.education, base.education, (item) => ({
      school: text(item.school, 160), degree: text(item.degree, 120), major: text(item.major, 120), minor: text(item.minor, 120) || undefined, gpa: text(item.gpa, 10) || undefined,
      startDate: text(item.startDate, 40) || undefined, gradDate: text(item.gradDate, 40), coursework: list(item.coursework, 20),
    }), (item) => Boolean(item.school || item.degree || item.major)),
    experience: entries(r.experience, base.experience, (item) => ({
      company: text(item.company, 160), title: text(item.title, 160), location: text(item.location, 120) || undefined, startDate: text(item.startDate, 40), endDate: text(item.endDate, 40) || undefined,
      current: Boolean(item.current), bullets: list(item.bullets, 8, 400),
    }), (item) => Boolean(item.company || item.title)),
    projects: entries(r.projects, base.projects, (item) => ({
      name: text(item.name, 160), role: text(item.role, 120) || undefined, url: text(item.url, 300) || undefined, bullets: list(item.bullets, 6, 400), tech: list(item.tech, 15, 60),
    }), (item) => Boolean(item.name)),
    skills: { technical: list(sk.technical, 40, 60), languages: list(sk.languages, 10, 60), certifications: list(sk.certifications, 10, 120) },
    workAuth: { authorizedUS: yesNo(w.authorizedUS), needsSponsorship: yesNo(w.needsSponsorship), over18: yesNo(w.over18), citizenship: text(w.citizenship, 80) || undefined },
    eeo: { gender: eeoKey("gender"), race: eeoKey("race"), hispanicLatino: eeoKey("hispanicLatino"), veteran: eeoKey("veteran"), disability: eeoKey("disability") },
    preferences: {
      roles: list(pr.roles, 10), industries: list(pr.industries, 10), locations: list(pr.locations, 10),
      remote: pick(pr.remote, ["yes", "no", "either"] as const, "either"), startTerm: text(pr.startTerm, 40) || undefined, jobType: pick(pr.jobType, ["internship", "full_time", "either"] as const, "either"),
    },
    standardAnswers: { heardAbout: text(st.heardAbout, 120) || undefined, earliestStart: text(st.earliestStart, 80) || undefined, salaryExpectation: text(st.salaryExpectation, 80) || undefined, inPerson },
    essays: { aboutMe: text(es.aboutMe, 800) || undefined, whyField: text(es.whyField, 800) || undefined },
    accountEmail: text(r.accountEmail ?? base.accountEmail, 200) || undefined,
    done: [...new Set([...(base.done ?? []), ...list(r.done, 20, 30)])],
  };
}
