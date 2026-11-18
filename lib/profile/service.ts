import { CHROME_STORE_URL } from "@/lib/config";
import { nowIso, repo } from "@/lib/db/file-store";
import { ServiceError } from "@/lib/errors";
import { applicationProfiles } from "@/lib/apply/store";
import { resumeHash, type ResumeProfile } from "@/lib/apply/resume-profile";
import { normalizeLabel } from "@/lib/apply/questions";
import type { ApplicationProfile } from "@/lib/apply/types";
import { storeResume } from "@/lib/services/resume";
import { extractProfileFromResume, mergeResume } from "@/lib/profile/extract";
import { cleanStudentProfile, completeness, emptyStudentProfile, missingGaps, withMonthYears, type StudentProfile } from "@/lib/profile/student";

/**
 * The resume-first profile: read it, update it from a resume, save the student's edits, and keep the
 * flat application fields (what autofill reads today) in step with it.
 */

const yes = (value: boolean | null | undefined) => (value === true ? "Yes" : value === false ? "No" : "");
const fromYes = (value: string | undefined) => (value === "Yes" ? true : value === "No" ? false : null);

/** Someone who finished the old onboarding gets a profile built from what they already gave. */
function fromLegacy(stored: ApplicationProfile | null, user: { email: string; name: string }, school: { school: string; major: string; graduationYear: string } | null): StudentProfile {
  const base = emptyStudentProfile(stored?.email || user.email, user.name);
  if (!stored) {
    if (school?.school) base.education = [{ school: school.school, degree: "", major: school.major, gradDate: school.graduationYear }];
    return base;
  }
  const resume = stored.resumeProfile;
  base.contact = {
    ...base.contact,
    firstName: stored.firstName || base.contact.firstName,
    middleName: stored.middleName || undefined,
    suffix: stored.suffix || undefined,
    phoneExtension: stored.phoneExtension || undefined,
    salutation: stored.salutation || undefined,
    lastName: stored.lastName || base.contact.lastName,
    phone: stored.phone || undefined, city: stored.city || undefined, state: stored.state || undefined, zip: stored.postalCode || undefined, country: stored.country || undefined,
  };
  base.links = { linkedin: stored.linkedin || undefined, github: stored.github || undefined, portfolio: stored.website || undefined };
  base.education = resume?.education.length
    ? resume.education.map((item) => ({ school: item.school, degree: item.degree, major: item.field, gpa: item.gpa || undefined, startDate: item.start || undefined, gradDate: item.end }))
    : school?.school ? [{ school: school.school, degree: "", major: school.major, gradDate: school.graduationYear }] : [];
  base.experience = (resume?.experience ?? []).map((item) => ({ company: item.company, title: item.title, location: item.location || undefined, startDate: item.start, endDate: item.end || undefined, current: item.current, bullets: item.summary ? [item.summary] : [] }));
  base.skills = { technical: resume?.skills ?? [] };
  base.workAuth = { authorizedUS: fromYes(stored.eligibility?.workAuthorized), needsSponsorship: fromYes(stored.eligibility?.needsSponsorship), over18: fromYes(stored.eligibility?.over18) };
  return base;
}

async function load(userId: string) {
  const [user, stored, document, resumes] = await Promise.all([repo.getUserById(userId), applicationProfiles.get(userId), repo.getProfileDocument(userId), repo.listResumes(userId)]);
  if (!user) throw new ServiceError("Sign in to continue.", "auth", 401);
  const form = document?.form;
  // Dates read as MM/YYYY, the way forms ask for them, however they were typed or read off the resume.
  const student = withMonthYears(stored?.student ?? fromLegacy(stored, user, form ? { school: form.school, major: form.major, graduationYear: form.graduationYear } : null));
  // Students who finished the old onboarding don't have to do it again.
  const ready = Boolean(student.confirmedAt) || Boolean(document?.ready);
  // The resume the student picked to apply with; the newest one when they haven't picked.
  const resume = resumes.find((item) => item.id === student.resumeFileId) ?? resumes[0] ?? null;
  return { user, stored, student, ready, resume, resumes };
}

/**
 * The resume the student applies with: the one picked in their profile, else the newest. With `resumeId`,
 * that one instead (the extension's resume picker).
 */
export async function activeResume(userId: string, resumeId?: string | null) {
  if (resumeId) return repo.getResumeById(userId, resumeId);
  return (await load(userId)).resume;
}

/** The student's resumes for a picker, the active one marked. */
export async function resumeList(userId: string) {
  const { resume, resumes } = await load(userId);
  return resumes.map((item) => ({ id: item.id, fileName: item.fileName, uploadedAt: item.createdAt, active: item.id === resume?.id, file: Boolean(item.storagePath) && item.byteSize > 0 }));
}

/** What the page shows: the profile, how complete it is, the gap cards left, and the resume on file. */
export async function profileState(userId: string) {
  const { student, ready, resume, resumes, stored } = await load(userId);
  // Answers learned on forms live with the application profile; shown here read-only.
  const savedAnswers = Object.values(stored?.saved ?? {}).map((item) => ({ question: item.label, answer: item.answer, updatedAt: item.updatedAt }));
  return {
    profile: { ...student, savedAnswers, completeness: completeness(student) },
    missing: missingGaps(student),
    ready,
    resume: resume ? { id: resume.id, fileName: resume.fileName } : null,
    resumes: resumes.map((item) => ({ id: item.id, fileName: item.fileName, uploadedAt: item.createdAt })),
    extensionUrl: CHROME_STORE_URL,
  };
}

/** Every leaf value by path ("contact.phone", "education.0.school"), to see what the student changed. */
function leaves(value: unknown, prefix = "", out: Record<string, string> = {}) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, item] of Object.entries(value)) leaves(item, prefix ? `${prefix}.${key}` : key, out);
  } else if (Array.isArray(value) && value.some((item) => item && typeof item === "object")) {
    value.forEach((item, index) => leaves(item, `${prefix}.${index}`, out));
  } else out[prefix] = JSON.stringify(value ?? null);
  return out;
}

const NOT_FIELDS = /^(sources|done|savedAnswers|updatedAt|completeness|confirmedAt|resumeFileId)(\.|$)/;

/** The flat fields autofill reads, plus resume entries and common answers, kept in step with the profile. */
function syncLegacy(stored: ApplicationProfile | null, student: StudentProfile, resumeText: string): ApplicationProfile {
  const c = student.contact;
  const school = student.education[0];
  const resumeProfile: ResumeProfile = {
    sourceHash: resumeHash(resumeText),
    contact: { phone: c.phone ?? "", email: c.email, addressLine1: stored?.addressLine1 ?? "", city: c.city ?? "", state: c.state ?? "", postalCode: c.zip ?? "", country: c.country ?? "", linkedin: student.links.linkedin ?? "", github: student.links.github ?? "", website: student.links.portfolio ?? "" },
    education: student.education.map((item) => ({ school: item.school, degree: item.degree, field: item.major, gpa: item.gpa ?? "", start: item.startDate ?? "", end: item.gradDate, location: "" })),
    experience: student.experience.map((item) => ({ title: item.title, company: item.company, location: item.location ?? "", start: item.startDate, end: item.endDate ?? "", current: item.current, summary: item.bullets.join("\n") })),
    skills: student.skills.technical,
  };
  const saved = { ...(stored?.saved ?? {}) };
  const keepAnswer = (label: string, answer: string | undefined) => {
    if (answer?.trim()) saved[normalizeLabel(label)] = { label, answer: answer.trim(), updatedAt: nowIso() };
  };
  keepAnswer("How did you hear about us?", student.standardAnswers.heardAbout);
  keepAnswer("When is the earliest you can start?", student.standardAnswers.earliestStart);
  keepAnswer("What are your salary expectations?", student.standardAnswers.salaryExpectation);
  keepAnswer("Are you willing to relocate?", yes(student.contact.willingToRelocate));
  keepAnswer("Are you open to working in person?", yes(student.standardAnswers.inPerson));
  keepAnswer("Preferred name", c.preferredName);
  keepAnswer("GPA", school?.gpa);
  return {
    ...(stored ?? { website: "", saved: {} }),
    firstName: c.firstName,
    middleName: c.middleName ?? "",
    suffix: c.suffix ?? "",
    salutation: c.salutation ?? "",
    lastName: c.lastName,
    email: c.email,
    phone: c.phone ?? "",
    phoneExtension: c.phoneExtension ?? "",
    linkedin: student.links.linkedin ?? "",
    website: student.links.portfolio ?? "",
    github: student.links.github ?? "",
    city: c.city ?? "",
    state: c.state ?? "",
    postalCode: c.zip ?? "",
    country: c.country ?? "",
    eligibility: { workAuthorized: yes(student.workAuth.authorizedUS), needsSponsorship: yes(student.workAuth.needsSponsorship), over18: yes(student.workAuth.over18) },
    saved,
    resumeProfile,
    student,
  } as ApplicationProfile;
}

async function persist(userId: string, stored: ApplicationProfile | null, student: StudentProfile) {
  const resume = (await repo.listResumes(userId)).find((item) => item.id === student.resumeFileId) ?? await repo.getLatestResume(userId);
  const next = { ...student, completeness: completeness(student), updatedAt: nowIso() };
  // Read again: a resume upload waits on the AI, and something else may have saved meanwhile.
  await applicationProfiles.put(userId, syncLegacy((await applicationProfiles.get(userId)) ?? stored, next, resume?.text ?? ""));
  return next;
}

/** Saves the student's edits. Changed fields are marked as theirs, so a new resume won't overwrite them. */
export async function saveStudentProfile(userId: string, raw: unknown) {
  const body = (raw ?? {}) as { profile?: unknown; confirm?: unknown };
  const { stored, student } = await load(userId);
  const next = cleanStudentProfile(body.profile ?? {}, student);
  const before = leaves(student);
  for (const [path, value] of Object.entries(leaves(next))) {
    if (NOT_FIELDS.test(path) || before[path] === value) continue;
    // A changed entry in a list is the student's edit for that whole entry.
    next.sources[path.replace(/^(education|experience|projects)\.(\d+)\..*$/, "$1.$2")] = "student";
    next.sources[path] = "student";
  }
  if (body.confirm === true) next.confirmedAt = student.confirmedAt || nowIso();
  if (next.accountEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.accountEmail)) throw new ServiceError("Enter a valid email for job-site accounts.", "email", 400);
  await persist(userId, stored, next);
  return profileState(userId);
}

/** Uploads a resume and fills the profile from it. Nothing the student typed is overwritten. */
export async function uploadProfileResume(userId: string, file: { name: string; type: string; bytes: Uint8Array }) {
  const result = await storeResume(userId, file.name, file.type || "application/octet-stream", file.bytes);
  const { stored, student } = await load(userId);
  const extracted = await extractProfileFromResume(userId, result.resume.text);
  const merged = extracted ? mergeResume(student, extracted) : student;
  merged.resumeFileId = result.resume.id;
  if (extracted?.fields.experience) await repo.updateResume(userId, result.resume.id, { experience: extracted.fields.experience });
  await persist(userId, stored, merged);
  return { ...(await profileState(userId)), found: extracted?.paths.length ?? 0, read: Boolean(extracted) };
}

/**
 * Picks which resume Unnepo applies with. Only the work experience changes to that resume's: contact, school,
 * projects and skills stay as they are. The experience is read once per resume and kept.
 */
export async function selectResume(userId: string, resumeId: string) {
  const { stored, student } = await load(userId);
  const resume = await repo.getResumeById(userId, resumeId);
  if (!resume) throw new ServiceError("That resume isn't in your profile anymore.", "not_found", 404);
  let experience = resume.experience;
  if (!experience) {
    experience = (await extractProfileFromResume(userId, resume.text))?.fields.experience;
    if (experience) await repo.updateResume(userId, resume.id, { experience });
  }
  const next: StudentProfile = structuredClone(student);
  next.resumeFileId = resume.id;
  if (experience?.length) {
    next.experience = withMonthYears({ ...next, experience }).experience;
    // The experience is this resume's now, not the student's earlier edits.
    for (const key of Object.keys(next.sources)) if (key === "experience" || key.startsWith("experience.")) delete next.sources[key];
    next.experience.forEach((_, index) => { next.sources[`experience.${index}`] = "resume"; });
  }
  await persist(userId, stored, next);
  return { ...(await profileState(userId)), switched: Boolean(experience?.length) };
}

/** Removes a resume from the profile. The one in use can't be removed while it's the only one left. */
export async function removeResume(userId: string, resumeId: string) {
  const { stored, student, resumes } = await load(userId);
  if (!resumes.some((item) => item.id === resumeId)) throw new ServiceError("That resume isn't in your profile anymore.", "not_found", 404);
  if (resumes.length < 2) throw new ServiceError("Upload another resume before removing your only one.", "last_resume", 400);
  await repo.deleteResume(userId, resumeId);
  if (student.resumeFileId === resumeId) {
    const next = (await repo.listResumes(userId))[0];
    if (next) return selectResume(userId, next.id);
    await persist(userId, stored, { ...student, resumeFileId: undefined });
  }
  return profileState(userId);
}

/** Whether the student has a profile Unnepo can apply with. */
export async function profileReady(userId: string) {
  return (await load(userId)).ready;
}
