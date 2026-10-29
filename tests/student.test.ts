import { beforeEach, describe, expect, it, vi } from "vitest";
import { applicationProfiles } from "@/lib/apply/store";
import { planAnswers } from "@/lib/apply/questions";
import { coverLetterPdf } from "@/lib/apply/cover-letter";
import { groundExtracted, mergeResume } from "@/lib/profile/extract";
import { profileReady, profileState, saveStudentProfile, uploadProfileResume } from "@/lib/profile/service";
import { completeness, emptyStudentProfile, missingGaps } from "@/lib/profile/student";
import { login, signUp, verifyEmail } from "@/lib/services/auth";
import { workspaceState } from "@/lib/services/workspace";
import type { ApplicationProfile } from "@/lib/apply/types";
import { useTempDb } from "./helpers";

const model = vi.hoisted(() => ({ replies: [] as string[], calls: 0 }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: async () => {
        model.calls += 1;
        return { content: [{ type: "text", text: model.replies.shift() ?? "{}" }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10 } };
      },
    };
  },
}));

const RESUME = [
  "Pat Doe",
  "pat.doe@colby.edu | 207-555-0100 | Waterville, ME 04901 | linkedin.com/in/patdoe",
  "Education",
  "Colby College, B.A. Economics, Expected May 2027, GPA 3.7",
  "Experience",
  "Data Analyst Intern, Maine Credit Union, May 2024 - August 2024",
  "Built loan dashboards in Tableau used by the lending team",
  "Projects",
  "Campus Rideshare - built a React app that matched 200 students for rides home",
  "Skills: Python, SQL, Tableau",
].join("\n");

const EXTRACTED = {
  contact: { firstName: "Pat", lastName: "Doe", email: "pat.doe@colby.edu", phone: "207-555-0100", city: "Waterville", state: "ME", zip: "04901" },
  links: { linkedin: "linkedin.com/in/patdoe", github: "github.com/patdoe" },
  education: [{ school: "Colby College", degree: "B.A.", major: "Economics", gpa: "3.7", gradDate: "Expected May 2027" }, { school: "Harvard University", degree: "M.S." }],
  experience: [
    { company: "Maine Credit Union", title: "Data Analyst Intern", startDate: "May 2024", endDate: "August 2024", bullets: ["Built loan dashboards in Tableau used by the lending team", "Managed a team of 40"] },
    { company: "Google", title: "Software Engineer", startDate: "2022" },
  ],
  projects: [{ name: "Campus Rideshare", bullets: ["built a React app that matched 200 students for rides home"], tech: ["React", "Kubernetes"] }],
  skills: { technical: ["Python", "SQL", "Tableau", "Rust"] },
};

beforeEach(() => {
  useTempDb();
  model.replies = [];
  model.calls = 0;
});

async function student(email = "pat.doe@colby.edu") {
  const signed = await signUp({ email, password: "password123", name: "Pat Doe" });
  await verifyEmail(signed.verifyToken!);
  return (await login(email, "password123")).user.id;
}

describe("reading a resume into the profile", () => {
  it("keeps only what the resume says", () => {
    const { fields, paths } = groundExtracted(EXTRACTED, RESUME);
    expect(fields.contact).toMatchObject({ firstName: "Pat", phone: "207-555-0100", state: "ME" });
    expect(fields.links).toEqual({ linkedin: "linkedin.com/in/patdoe" });
    expect(fields.education?.map((item) => item.school)).toEqual(["Colby College"]);
    expect(fields.experience?.map((item) => item.company)).toEqual(["Maine Credit Union"]);
    expect(fields.experience?.[0].bullets).toEqual(["Built loan dashboards in Tableau used by the lending team"]);
    expect(fields.projects?.[0].tech).toEqual(["React"]);
    expect(fields.skills?.technical).toEqual(["Python", "SQL", "Tableau"]);
    expect(paths).toContain("education.0.gradDate");
  });

  it("never overwrites what the student typed", () => {
    const profile = emptyStudentProfile("pat.doe@colby.edu", "Pat Doe");
    profile.contact.phone = "207-555-9999";
    profile.sources["contact.phone"] = "student";
    profile.experience = [{ company: "Bookstore", title: "Clerk", startDate: "2023", current: false, bullets: [] }];
    profile.sources["experience.0"] = "student";
    const merged = mergeResume(profile, groundExtracted(EXTRACTED, RESUME));
    expect(merged.contact.phone).toBe("207-555-9999");
    expect(merged.experience.map((item) => item.company)).toEqual(["Bookstore"]);
    expect(merged.education[0].school).toBe("Colby College");
    expect(merged.sources["education.0.school"]).toBe("resume");
    expect(merged.sources["contact.phone"]).toBe("student");
  });
});

describe("gaps and completeness", () => {
  it("asks only what's missing, in order, and stops asking once answered or skipped", () => {
    const profile = mergeResume(emptyStudentProfile("pat.doe@colby.edu", "Pat Doe"), groundExtracted(EXTRACTED, RESUME));
    const gaps = missingGaps(profile).map((gap) => gap.id);
    expect(gaps[0]).toBe("work_auth");
    expect(gaps).not.toContain("education");
    profile.workAuth = { authorizedUS: true, needsSponsorship: false, over18: true };
    profile.done.push("eeo", "links");
    expect(missingGaps(profile).map((gap) => gap.id)).not.toEqual(expect.arrayContaining(["work_auth", "eeo", "links"]));
    expect(completeness(profile)).toBeGreaterThan(completeness(emptyStudentProfile()));
  });
});

describe("profile service", () => {
  it("reads an uploaded resume, keeps edits, confirms, and fills the fields autofill uses", async () => {
    const userId = await student();
    expect(await profileReady(userId)).toBe(false);
    expect((await workspaceState(userId)).ready).toBe(false);

    process.env.ANTHROPIC_API_KEY = "anthropic";
    model.replies.push(JSON.stringify(EXTRACTED));
    const pdf = await coverLetterPdf(RESUME, { name: "Pat Doe", contact: [] });
    const uploaded = await uploadProfileResume(userId, { name: "Pat Doe Resume.pdf", type: "application/pdf", bytes: new Uint8Array(pdf) });
    expect(uploaded.read).toBe(true);
    expect(uploaded.profile.education[0]).toMatchObject({ school: "Colby College", degree: "B.A.", gradDate: "Expected May 2027" });
    expect(uploaded.profile.sources["contact.phone"]).toBe("resume");
    expect(uploaded.missing[0].id).toBe("work_auth");

    // The student fixes the phone and answers work authorization, then confirms.
    const edited = { ...uploaded.profile, contact: { ...uploaded.profile.contact, phone: "207-555-1234" }, workAuth: { authorizedUS: true, needsSponsorship: false, over18: true }, done: ["work_auth"] };
    const saved = await saveStudentProfile(userId, { profile: edited, confirm: true });
    expect(saved.ready).toBe(true);
    expect(saved.profile.sources["contact.phone"]).toBe("student");
    expect(saved.missing.map((gap) => gap.id)).not.toContain("work_auth");

    // Autofill's flat fields follow the profile.
    const stored = (await applicationProfiles.get(userId))!;
    expect(stored).toMatchObject({ firstName: "Pat", phone: "207-555-1234", state: "ME", eligibility: { workAuthorized: "Yes", needsSponsorship: "No", over18: "Yes" } });
    expect(stored.resumeProfile?.education[0]).toMatchObject({ school: "Colby College", degree: "B.A." });
    expect(stored.resumeProfile?.experience[0]).toMatchObject({ company: "Maine Credit Union", start: "May 2024" });

    // A second upload doesn't undo the student's phone.
    model.replies.push(JSON.stringify(EXTRACTED));
    const pdf2 = await coverLetterPdf(`${RESUME}\nVolunteer tutor`, { name: "Pat Doe", contact: [] });
    await uploadProfileResume(userId, { name: "Pat Doe Resume v2.pdf", type: "application/pdf", bytes: new Uint8Array(pdf2) });
    expect((await profileState(userId)).profile.contact.phone).toBe("207-555-1234");
    expect((await workspaceState(userId)).ready).toBe(true);
  });

  it("rejects a bad job-site account email and never stores a password", async () => {
    const userId = await student();
    await expect(saveStudentProfile(userId, { profile: { accountEmail: "not-an-email" } })).rejects.toThrow(/valid email/);
    await saveStudentProfile(userId, { profile: { accountEmail: "pat.doe@colby.edu", password: "Secret123!" } });
    expect(JSON.stringify(await applicationProfiles.get(userId))).not.toContain("Secret123!");
  });
});

describe("self-identification on forms", () => {
  it("uses the student's own choice, and declines when they chose decline", () => {
    const base = { firstName: "Pat", lastName: "Doe", email: "", phone: "", linkedin: "", website: "", github: "", city: "", saved: {} };
    const chose = { ...emptyStudentProfile(), eeo: { gender: "woman", race: "decline", hispanicLatino: "no", veteran: "not_protected", disability: "decline" } };
    const context = { profile: { ...base, student: chose } as ApplicationProfile, school: "", majors: [], graduationYear: "", resumeFileName: null };
    const q = (key: string, label: string, options: string[]) => ({ key, label, kind: "select" as const, required: false, options, sensitive: true, answer: null, source: null, evidence: null });
    const answers = planAnswers([
      q("g", "Gender", ["Male", "Female", "Decline to self-identify"]),
      q("r", "Race", ["Asian", "White", "I don't wish to answer"]),
      q("h", "Are you Hispanic/Latino?", ["Yes", "No", "Decline to self-identify"]),
      q("v", "Veteran Status", ["I am not a protected veteran", "I identify as one or more of the classifications of a protected veteran", "I don't wish to answer"]),
    ], context).map((item) => [item.answer, item.source]);
    expect(answers).toEqual([["Female", "student"], ["I don't wish to answer", "default"], ["No", "student"], ["I am not a protected veteran", "student"]]);
  });
});
