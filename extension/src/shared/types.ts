/** Messages and shapes shared by the background worker, the page scripts, and the side panel. */

export type FieldType = "text" | "email" | "tel" | "textarea" | "file" | "select" | "combobox" | "radio" | "checkbox" | "multiselect" | "date" | "url" | "number";

/** A form field the page script found. `id` is the page script's own reference (a data attribute it set). */
export type PageField = { id: string; label: string; type: FieldType; options: string[]; required: boolean; section: string; format: string | null };

export type Scan = {
  url: string;
  title: string;
  company: string;
  /** "greenhouse" when this is Greenhouse's own hosted form; otherwise a best guess or "other". */
  ats: "greenhouse" | "lever" | "ashby" | "workday" | "other";
  /** Greenhouse forms are read from Greenhouse's API on the server, so the page fields aren't needed. */
  useServerSchema: boolean;
  fields: PageField[];
  /** Set when the form is in a frame from another site (a company page embedding Greenhouse). */
  embeddedForm: string | null;
  /** A CAPTCHA is on the page. Unnepo never solves these. */
  captcha: boolean;
};

export type Answer = { id: string; label: string; type: string; required: boolean; values: string[]; source: string | null; why: string | null };

export type FileData = { name: string; mime: string; base64: string };

export type FillPlan = { ats: Scan["ats"]; useServerSchema: boolean; answers: Answer[]; resume: FileData | null; coverLetter: FileData | null; autoSubmit: boolean };

export type FillReport = {
  filled: string[];
  failed: Array<{ label: string; reason: string }>;
  /** Required fields still empty after filling: the student's turn. */
  needsYou: string[];
  captcha: boolean;
  submitted: boolean;
  ms: number;
};

export type PanelState = {
  connected: boolean;
  me: { user: { name: string; email: string }; credits: number; profileReady: boolean; completeness: number } | null;
  tab: { id: number; url: string; title: string } | null;
  job: { tabId: number; applicationId: string; title: string; company: string; step: string; report: FillReport | null; submission: "confirmed" | "likely" | null; error: string | null; llmCalls: number } | null;
  autoSubmit: boolean;
  apiBase: string;
};

/** The confirmation language a site shows after an application goes through. */
export const CONFIRM_TEXT = /(thank(s| you) for (applying|your application|your interest|submitting)|application (has been |was )?(successfully )?(submitted|received|sent)|we(?:'|’)?ve received your application|successfully (submitted|applied)|your application is (in|complete))/i;
