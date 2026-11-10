/** Messages and shapes shared by the background worker, the page scripts, and the side panel. */

import type { FillAttempt, FillProblem } from "@/lib/apply/types";
import type { SpiderLook } from "@/lib/spiders";

export type { FillAttempt, FillProblem };

/** Ways to choose from a custom dropdown: pointer clicks, or the keyboard (arrows, typing, Enter). */
export type DropdownMethod = "click" | "keyboard";

export type FieldType = "text" | "email" | "tel" | "textarea" | "file" | "select" | "combobox" | "radio" | "checkbox" | "multiselect" | "date" | "url" | "number";

/** A form field the page script found. `id` is the page script's own reference (a data attribute it set). */
export type PageField = { id: string; label: string; type: FieldType; options: string[]; required: boolean; section: string; format: string | null };

export type Scan = {
  url: string;
  /** On a job board, the open job's own address (Indeed's search becomes /viewjob?jk=…). */
  jobUrl?: string;
  title: string;
  company: string;
  /** The posting's text, when the page shows it and Unnepo can't read it on its own (Handshake, signed in). */
  description?: string;
  /** The person LinkedIn shows under "Meet the hiring team", when the page has one. */
  poster?: { name: string; title: string; profileUrl: string };
  /** "greenhouse" when this is Greenhouse's own hosted form; otherwise a best guess or "other". */
  ats: "greenhouse" | "lever" | "ashby" | "workday" | "other";
  /** Greenhouse forms are read from Greenhouse's API on the server, so the page fields aren't needed. */
  useServerSchema: boolean;
  fields: PageField[];
  /** Set when the form is in a frame from another site (a company page embedding Greenhouse). */
  embeddedForm: string | null;
  /** A CAPTCHA is on the page. Unnepo never solves these. */
  captcha: boolean;
  /** Visible password boxes (sign-in, create account). They aren't in `fields`: the extension fills them itself. */
  passwordBoxes: number;
  /** The application asks for a CV, so the panel offers to make one. */
  mentionsCv: boolean;
};

export type Answer = { id: string; label: string; type: string; required: boolean; values: string[]; source: string | null; why: string | null };

export type FileData = { name: string; mime: string; base64: string };

/** `password` is the student's job-site password, for account and sign-in fields. It never leaves the browser. */
/** `dropdownFirst`: the way of choosing from dropdowns that worked on this site before, tried first. */
export type FillPlan = { ats: Scan["ats"]; useServerSchema: boolean; answers: Answer[]; resume: FileData | null; coverLetter: FileData | null; autoSubmit: boolean; password: string | null; dropdownFirst?: DropdownMethod };

/** A question that didn't fill. `options`: the choices a dropdown showed when none matched, for the AI to pick from. */
export type FillFailure = { label: string; reason: string; id?: string; options?: string[] };

export type FillReport = {
  filled: string[];
  failed: FillFailure[];
  /** Every question tried, with how and whether it stuck. */
  attempts?: FillAttempt[];
  /** Required fields still empty after filling: the student's turn. */
  needsYou: string[];
  /** Filled answers worth a second look (written by AI, or a default like "Decline to answer"), with why. */
  check?: Array<{ label: string; why: string }>;
  captcha: boolean;
  submitted: boolean;
  ms: number;
};

/**
 * One problem on the running issues list in Profile: a question that didn't fill, an error a site showed, a
 * run that stopped, or a note the student wrote. Kept only on this computer; never a password or a typed answer.
 */
export type Issue = { id: string; at: string; kind: "fill" | "site" | "stopped" | "note"; site: string; page: string; question?: string; what: string };

/** Sites Unnepo never reads or fills, whatever is open in the panel: LinkedIn. */
export const NEVER_READ = /(^|\.)linkedin\.com$/i;

/** The quick questions asked once before the first fill. Null or "": not answered yet. */
export type Setup = { salaryExpectation: string; earliestStart: string; willingToRelocate: boolean | null; inPerson: boolean | null; authorizedUS: boolean | null; needsSponsorship: boolean | null; classYear: string; hasSchool: boolean };

/**
 * Autofill (pressing Apply, filling every field, pressing Next and Submit) is switched off: the panel no longer
 * offers it and the worker refuses a fill. The code stays; set this to true to bring it back.
 */
export const AUTOFILL_ENABLED = false;

/** Everything the page says about the job on the tab, for the job box above "Write a cover letter". */
export type JobDetails = {
  title: string; company: string; location: string; pay: string; type: string; posted: string; remote: string;
  description: string; url: string; site: string; from: string;
  /** Questions on the form, upload boxes, and whether one of them takes a resume. */
  questions: number; uploads: number; resumeBox: boolean;
};

/** A question that needs a written answer, which gets a spider beside it after "Begin applying". */
export type ComplexQuestion = { id: string; label: string; required: boolean; answered: boolean };

/** What "Begin applying" did on the page: the upload boxes it put the resume in, and the complex questions. */
export type BeginResult = { uploaded: string[]; questions: ComplexQuestion[]; resumeBox: boolean };

/** "Begin applying" on a tab: what it found, and answers written for the complex questions. */
export type Applying = BeginResult & { url: string; resumeError?: string | null; answers?: Record<string, { text: string; put: boolean; error?: string }> };

export type UsageLine = { used: number; limit: number; left: number; note: string };

export type PanelState = {
  connected: boolean;
  me: { user: { name: string; email: string }; credits: number; unlimitedCredits?: boolean; plan?: string; effectivePlan?: string; trial?: { endsAt: string; daysLeft: number; hoursLeft: number } | null; trialEnded?: string | null; highlights?: string[]; creditCost?: { letters: number; answers: number }; coverLetters?: { used: number; left: number | null }; usage?: { free: boolean; unlimited: boolean; credits: number | null; letters: UsageLine; answers: UsageLine; autofills: UsageLine; people: { left: number; note: string } }; setup?: Setup; maybe?: Array<{ id: string; title: string; company: string; site: string; at: string }>; session?: { startedAt: string; lastAt: string; active: boolean } | null; profileReady: boolean; completeness: number; missing?: string[]; goal?: { weekly: number | null; appliedAt: string[] }; resume?: { fileName: string; uploadedAt: string; file: boolean } | null; spider?: SpiderLook } | null;
  /** What's on the tab before Fill is pressed: the job, how many fields, and whether there's an account to make. */
  page: { site: string; title: string; company: string; fields: number; posting: boolean; account: "new" | "sign_in" | null; mentionsCv: boolean } | null;
  tab: { id: number; url: string; title: string } | null;
  job: { tabId: number; applicationId: string; title: string; company: string; step: string; report: FillReport | null; submission: "confirmed" | "likely" | null; error: string | null; llmCalls: number; running?: boolean; cv?: boolean; /** Free: questions left on the form that Pro would answer. */ locked?: number } | null;
  autoSubmit: boolean;
  apiBase: string;
  /** "Begin applying" was pressed on this tab. */
  applying?: Applying | null;
  /** "Did you apply to these?": jobs pressed Apply on or filled that nothing confirmed. */
  maybe?: Array<{ id: string; title: string; company: string; site: string; at: string }>;
};

/** The confirmation language a site shows after an application goes through. */
export const CONFIRM_TEXT = /(thank(s| you) for (applying|your application|your interest|submitting)|application (has been |was )?(successfully )?(submitted|received|sent)|we(?:'|’)?ve received your application|successfully (submitted|applied)|your application is (in|complete))/i;

/** What a cover letter and an answer cost, for a server that doesn't say. lib/config.ts can't be bundled here: it reads the server's environment. */
export const CREDIT_COST_FALLBACK = { letters: 2, answers: 1 };

/** A person at a job's company, as the tracker sends it. */
export type TrackerContact = {
  id: string; name: string; title: string; role: "alumni" | "recruiter" | "department" | "poster" | string; email: string | null;
  emailSource: "apollo" | "hunter" | "job_posting" | "pattern" | "website" | "likely" | "cant_check" | "guess" | null;
  relevance: string; linkedinUrl: string | null; outreachStatus: "not_contacted" | "emailed" | "replied" | "no_response";
  emailSubject: string | null; emailBody: string | null;
};

/** One job in the tracker (lib/extension/service.ts, trackerJob). */
export type TrackerJob = {
  id: string; title: string; company: string; status: string; location: string | null; department: string | null;
  createdAt: string; submittedAt: string | null; updatedAt: string; url: string;
  companyMissing: boolean; titleMissing: boolean;
  contactsStatus: "idle" | "finding" | "writing" | "done" | "failed"; contactsMessage: string;
  confirmation: { confidence: "confirmed" | "likely" } | null;
  postedRecruiter: { name: string; title: string; email: string | null; linkedinUrl: string | null } | null;
  fillReport: {
    outcome: "follow_up" | "assessment" | "interviewing" | "offer" | "rejected" | null;
    statusHistory?: Array<{ at: string; status: string; source: string; summary: string }>;
    lastEmailAt?: string; emailedAt?: Record<string, string>; reachedOut?: { count: number; at: string }; notCounted?: boolean; peopleReveals: number;
    peopleLinks?: Record<string, Array<{ label: string; url: string }>>;
    peoplePreview?: { rows: Array<{ role: string; title: string }> };
  } | null;
  hidden: string[];
  contacts: TrackerContact[];
};

export type Tracker = { jobs: TrackerJob[]; weeklyGoal: number | null; free: boolean; peopleNote: string };

/**
 * A job the extension caught being applied to, for Home's "Detected jobs" menu (the last 5, newest first).
 * `sure`: how it knew. `state`: saved by itself, waiting for the student, or answered.
 */
export type Detected = {
  id: string; url: string; title: string; company: string; site: string; at: number;
  description?: string; poster?: { name: string; title: string; profileUrl: string };
  sure: "confirmed" | "likely" | "pressed";
  state: "saved" | "ask" | "yes" | "no" | "undone";
  applicationId?: string; error?: string;
};

/** Where an email link opens: Gmail, Outlook on the web, or the computer's own mail app. */
export type Mailer = "gmail" | "outlook" | "mailto";

/** What the student did with a reminder: snoozed until a time, or done. Kept on this computer. */
export type ReminderMarks = Record<string, { until?: number; done?: boolean }>;
/** Email links the student opened and when, so Home can ask whether they sent it. */
export type OpenedEmails = Record<string, { at: number; applicationId: string; name: string; company: string; followUp: boolean }>;
