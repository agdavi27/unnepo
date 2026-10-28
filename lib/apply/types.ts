export type Ats = "greenhouse" | "lever" | "ashby" | "other";

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

export type FillReport = {
  filled: string[];
  failed: Array<{ label: string; reason: string }>;
  liveViewUrl: string | null;
  screenshotAt: string | null;
};

export type Confirmation = { url: string; text: string; detectedAt: string };

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
  /** Answers the student saved from earlier forms, keyed by a normalized question label. */
  saved: Record<string, { label: string; answer: string; updatedAt: string }>;
};
