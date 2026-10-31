/** Messages and shapes shared by the background worker, the page scripts, and the side panel. */

import type { FillAttempt, FillProblem } from "@/lib/apply/types";

export type { FillAttempt, FillProblem };

/** Ways to choose from a custom dropdown: pointer clicks, or the keyboard (arrows, typing, Enter). */
export type DropdownMethod = "click" | "keyboard";

export type FieldType = "text" | "email" | "tel" | "textarea" | "file" | "select" | "combobox" | "radio" | "checkbox" | "multiselect" | "date" | "url" | "number";

/** A form field the page script found. `id` is the page script's own reference (a data attribute it set). */
export type PageField = { id: string; label: string; type: FieldType; options: string[]; required: boolean; section: string; format: string | null };

export type Scan = {
  url: string;
  title: string;
  company: string;
  /** The posting's text, when the page shows it and Unnepo can't read it on its own (Handshake, signed in). */
  description?: string;
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

export type PanelState = {
  connected: boolean;
  me: { user: { name: string; email: string }; credits: number; profileReady: boolean; completeness: number; missing?: string[]; cv?: { usesLeft: number; perCredit: number }; resume?: { fileName: string; uploadedAt: string; file: boolean } | null } | null;
  /** What's on the tab before Fill is pressed: the job, how many fields, and whether there's an account to make. */
  page: { site: string; title: string; company: string; fields: number; posting: boolean; account: "new" | "sign_in" | null; mentionsCv: boolean } | null;
  tab: { id: number; url: string; title: string } | null;
  job: { tabId: number; applicationId: string; title: string; company: string; step: string; report: FillReport | null; submission: "confirmed" | "likely" | null; error: string | null; llmCalls: number; running?: boolean; cv?: boolean } | null;
  autoSubmit: boolean;
  apiBase: string;
};

/** The confirmation language a site shows after an application goes through. */
export const CONFIRM_TEXT = /(thank(s| you) for (applying|your application|your interest|submitting)|application (has been |was )?(successfully )?(submitted|received|sent)|we(?:'|’)?ve received your application|successfully (submitted|applied)|your application is (in|complete))/i;
