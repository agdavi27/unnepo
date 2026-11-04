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

/** Someone the posting names, or LinkedIn shows under "Meet the hiring team" (then with their profile). */
export type PostedRecruiter = { name: string; title: string | null; email: string | null; linkedinUrl?: string | null };

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

/** Why one question didn't fill, in a few fixed kinds so they can be counted across sites. */
export type FillProblem = "not_on_page" | "list_didnt_open" | "no_option" | "more_choices" | "didnt_stick" | "no_file" | "error";

/**
 * One question the extension tried to fill: the site, the question, the kind of field, the answer (only
 * for choices, cut short), the way it filled it, and whether it stuck. Never a password.
 */
export type FillAttempt = { site: string; label: string; type: string; answer: string; method: string; ok: boolean; problem?: FillProblem; reason?: string; at?: string };

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
  /** The last search for people to email: every step and what it found. */
  peopleSearch?: PeopleSearch;
  /** Social links for each listed person, by name: the contacts table keeps only LinkedIn. */
  peopleLinks?: Record<string, Array<{ label: string; url: string }>>;
  /** When the student marked each person (by contact id) as emailed, for follow-up reminders. */
  emailedAt?: Record<string, string>;
  /** The credit for this job's person was spent, so searching again is free. */
  personCharged?: boolean;
  /** Every question the extension tried to fill, newest last, so autofill failures can be counted and fixed. */
  attempts?: FillAttempt[];
  /** Every status change, oldest first. */
  statusHistory?: StatusChange[];
  /** The last email about this job, for "No response" (none in 28 days). */
  lastEmailAt?: string;
  /** Saved from a forwarded email ("added"), or its status changed by one ("updated"): the badge on the Applied list. */
  fromEmail?: "added" | "updated";
  /** The student's own notes on this job, typed on the Applied page. */
  notes?: string;
  /** When the job's details were last read from its link (to fill in a missing company). */
  infoReadAt?: string;
  /** The job board posting the student applied from, when they applied on another page (the company's site). */
  postingUrl?: string;
  /** What happened with this job, oldest first: opened, filled, applied (and how that was caught). */
  activity?: ActivityEvent[];
};

/** How Unnepo knew an application went through. */
export type AppliedHow = "site_confirmed" | "page_said" | "button_changed" | "board_saved" | "linkedin_easy_apply" | "you_marked" | "added_by_hand";
/** One thing that happened with a job. `site`: where ("ZipRecruiter", "Workday"). `ms`: time it took, for fills. */
export type ActivityEvent = { at: string; kind: "opened" | "filled" | "applied" | "not_confirmed"; site: string; how?: AppliedHow; fields?: number; needs?: number; ms?: number };

export type MaybeApplied = { id: string; url: string; title: string; company: string; site: string; description?: string; applicationId?: string; at: string };

export type ApplicationOutcome = "assessment" | "interviewing" | "offer" | "rejected";

/** One change in an application's status, and where it came from: a forwarded email, or the student. */
export type StatusChange = { at: string; status: ApplicationOutcome | "applied" | "incomplete"; source: "email" | "you"; summary: string };

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

export type ContactRole = "alumni" | "job_poster" | "recruiter" | "hiring_manager" | "team_member";

/** One search Unnepo ran to find someone to email, and how many people it turned up. */
export type PeopleStep = { step: string; domain: string; found: number; error?: string };

/** What the last people search tried, kept so "no one found" can be explained and fixed. */
export type PeopleSearch = { at: string; company: string; domains: string[]; domain: string | null; school: string; steps: PeopleStep[]; chosen: { name: string; role: ContactRole; email: boolean } | null };
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
  /** "pattern": built from the company's email format and verified; "website": found on its site and verified; "likely": built from the format but couldn't be checked. */
  emailSource: "apollo" | "hunter" | "job_posting" | "pattern" | "website" | "likely" | "guess" | null;
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
  /** Cover letters written this month ("2026-11"), for Free's monthly limit. */
  letters?: { month: string; count: number };
  /** "Did you apply to these?": jobs Apply was pressed on or filled that nothing confirmed. Shared by the panel and the web app. */
  maybeApplied?: MaybeApplied[];
  /** An applying session: when it started, and the last thing that happened in it (it ends after 15 idle minutes). */
  session?: { startedAt: string; lastAt: string } | null;
  /** Look for people as soon as a job is saved as applied. On by default for paid plans; Free turns it on. */
  autoFindPeople?: boolean;
  /** The Jobs for you list: when each job was first shown, jobs the student hid, and how many refreshes. */
  jobFeed?: { seen: Record<string, string>; dismissed: string[]; round: number };
  /** The spider the student picked on the Stats page (lib/spiders.ts); worn once it's unlocked. */
  spiderSkin?: string;
  /** CVs Unnepo has written for the student; 1 credit covers CVS_PER_CREDIT of them. */
  cvCount?: number;
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
