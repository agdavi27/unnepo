import type { ResumeProfile } from "@/lib/apply/resume-profile";
import type { StudentProfile } from "@/lib/profile/student";

export type Ats = "greenhouse" | "lever" | "ashby" | "workday" | "other";

export type ApplicationStatus =
  | "extracted" // job read; answers not reviewed yet
  | "filling" // the browser is filling the form
  | "review" // filled; waiting for the student to check and approve
  | "submitting"
  | "submitted" // the site showed a confirmation we captured
  | "unconfirmed" // submit was clicked but no confirmation appeared
  | "applied_manual" // the student says they applied themselves; not verified by Unnepo
  | "failed";

export type ContactsStatus = "idle" | "finding" | "writing" | "done" | "failed";

export type QuestionKind = "text" | "textarea" | "select" | "multiselect" | "checkbox" | "file" | "unknown";

/** One question on the application form, with the answer Unnepo proposes and where it came from. */
export type ApplicationQuestion = {
  key: string;
  label: string;
  kind: QuestionKind;
  required: boolean;
  options: string[];
  sensitive: boolean;
  answer: string | null;
  /** profile | resume | saved | student | ai | resume_file */
  source: string | null;
  /** The exact text from the profile or resume that supports an AI answer. */
  evidence: string | null;
};

export type PostedRecruiter = { name: string; title: string | null; email: string | null };

export type JobDetails = {
  ats: Ats;
  jobKey: string;
  jobUrl: string;
  title: string;
  company: string;
  department: string | null;
  location: string | null;
  description: string;
  requirements: string[];
  applicationUrl: string | null;
  postedRecruiter: PostedRecruiter | null;
  /** Questions the job board publishes ahead of time. Others are read from the live form. */
  questions: ApplicationQuestion[];
};

/** Where autofill stopped. Only "review" means the form is ready for the student to approve. */
export type FillStop = "review" | "needs_input" | "email_verification" | "needs_account" | "signin_failed";

export type FillReport = {
  filled: string[];
  failed: Array<{ label: string; reason: string }>;
  liveViewUrl: string | null;
  screenshotAt: string | null;
  stoppedAt?: FillStop;
  pages?: number;
  /** "created" when Unnepo made a job-site account on this run, "signed_in" when it used an existing one. */
  account?: "created" | "signed_in" | null;
  host?: string;
  /** The cover letter autofill wrote for this job and put on the form, for the student to read or copy. */
  coverLetter?: string;
  /** Required fields Unnepo worked out after the normal fill, with the answer and why. */
  decided?: Array<{ label: string; answer: string; why: string }>;
  /** Fast pipeline: where the time went (schema, mapping, fill, submit), AI calls, and fallback fields. */
  timings?: { pipeline: "fast"; schemaMs?: number; mappingMs?: number; fillMs?: number; submitMs?: number; llmCalls: number; fallback: string[] };
  /** What happened after applying, set by the student. Kept here (jsonb) so no new column is needed. */
  outcome?: ApplicationOutcome | null;
  /** Questions answered from the student's resume by AI during autofill, for the student to check. */
  fromResume?: string[];
  /** Required questions on the page where autofill stopped that the student can answer in Unnepo. */
  pending?: Array<{ label: string; kind: QuestionKind; options: string[] }>;
};

export type ApplicationOutcome = "interviewing" | "offer" | "rejected";

export type Confirmation = {
  url: string;
  text: string;
  detectedAt: string;
  /** A screenshot of the confirmation page, kept as a receipt. */
  receiptPath?: string;
  /** How sure the extension is: the site's own submit call succeeded, or only the page text says so. */
  confidence?: "confirmed" | "likely";
};

export type JobApplication = {
  id: string;
  userId: string;
  jobKey: string;
  jobUrl: string;
  ats: Ats;
  title: string;
  company: string;
  companyDomain: string | null;
  department: string | null;
  location: string | null;
  description: string;
  requirements: string[];
  applicationUrl: string | null;
  postedRecruiter: PostedRecruiter | null;
  status: ApplicationStatus;
  statusMessage: string;
  questions: ApplicationQuestion[];
  browserSessionId: string | null;
  fillReport: FillReport | null;
  confirmation: Confirmation | null;
  submittedAt: string | null;
  contactsStatus: ContactsStatus;
  contactsMessage: string;
  charged: boolean;
  attempts: number;
  createdAt: string;
  updatedAt: string;
};

export type ContactRole = "job_poster" | "recruiter" | "hiring_manager" | "team_member";
export type OutreachState = "not_contacted" | "emailed" | "replied" | "no_response";

export type ApplicationContact = {
  id: string;
  applicationId: string;
  userId: string;
  rank: number;
  role: ContactRole;
  name: string;
  title: string;
  email: string | null;
  emailSource: "apollo" | "hunter" | "job_posting" | null;
  relevance: string;
  linkedinUrl: string | null;
  photoUrl: string | null;
  outreachStatus: OutreachState;
  emailSubject: string | null;
  emailBody: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Reusable answers for application forms. Only what the student typed or what appears in their resume. */
export type ApplicationProfile = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  linkedin: string;
  website: string;
  github: string;
  city: string;
  addressLine1?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  /** Answers the student saved from earlier forms, keyed by a normalized question label. */
  saved: Record<string, { label: string; answer: string; updatedAt: string }>;
  /** The resume read into contact details, schools, and jobs; refreshed when the resume changes. */
  resumeProfile?: ResumeProfile | null;
  /** Applications per week the student is aiming for. */
  weeklyGoal?: number;
  /** Answers the AI wrote for questions, by question and options, so the same question costs nothing next time. */
  aiCache?: Record<string, { values: string[]; why: string; at: string }>;
  /** The resume-first profile from onboarding. The flat fields above are kept in step with it for autofill. */
  student?: StudentProfile;
  /** The student turned on the fast Greenhouse pipeline (beta). */
  fastApply?: boolean;
  /** Eligibility answers the student gave once, used on every form that asks: "Yes", "No", or unset. */
  eligibility?: { workAuthorized?: string; needsSponsorship?: string; over18?: string };
  /** The student's one job-site password, encrypted. Never sent to the browser page. */
  jobSitePasswordEncrypted?: string | null;
  /** When the student allowed Unnepo to create job-site accounts and accept their candidate terms. */
  accountConsentAt?: string | null;
  /** Job sites where Unnepo created an account for the student. */
  jobAccounts?: Array<{ host: string; email: string; createdAt: string }>;
};
