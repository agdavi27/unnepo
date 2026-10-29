import { classifyQuestion } from "@/lib/apply/questions";

/**
 * The fast pipeline learns a form from the job board's own data, not from a browser: one normalized
 * FormSchema per posting, with every field's stable page id, type, allowed options, and whether the
 * student must answer it themselves.
 */
export type SchemaFieldType = "text" | "email" | "tel" | "textarea" | "file" | "select" | "multiselect" | "location" | "school" | "degree" | "phone_country";

export type SchemaField = {
  /** The control's id on the page (Greenhouse uses the API field name). */
  id: string;
  label: string;
  type: SchemaFieldType;
  required: boolean;
  options: Array<{ label: string; value: string }>;
  section: "core" | "question" | "eeoc" | "location" | "education";
  /** Demographic, eligibility, legal, or pay questions: never answered by AI. */
  sensitive: boolean;
  /** Fields the form usually has but the board's data doesn't list; filled only if they're on the page. */
  ifPresent?: boolean;
};

export type FormSchema = {
  ats: "greenhouse";
  board: string;
  jobId: string;
  /** Greenhouse's own hosted form, which works even when the company embeds it on its own site. */
  formUrl: string;
  title: string;
  company: string;
  description: string;
  fields: SchemaField[];
};

type GreenhouseField = { name: string; type: string; values?: Array<{ label: string; value: string | number }> };
type GreenhouseQuestion = { label: string; required: boolean; fields: GreenhouseField[]; description?: string | null };
export type GreenhouseJobJson = {
  title: string;
  content?: string;
  company_name?: string;
  questions?: GreenhouseQuestion[];
  location_questions?: GreenhouseQuestion[];
  compliance?: Array<{ type: string; questions?: GreenhouseQuestion[] }>;
  demographic_questions?: { questions?: Array<{ id: number; label: string; required: boolean; type?: string; answer_options?: Array<{ id: number; label: string }> }> } | null;
};

const CORE = new Set(["first_name", "last_name", "email", "phone", "resume", "cover_letter"]);
const CERTIFY = /\b(certify|attest|arbitrat|non-?compete|background check|agree(ment)? to)\b/i;

function clean(text: string) {
  return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
}

function typeOf(field: GreenhouseField): SchemaFieldType | null {
  switch (field.type) {
    case "input_text": return field.name === "email" ? "email" : field.name === "phone" ? "tel" : "text";
    case "textarea": return "textarea";
    case "input_file": return "file";
    case "multi_value_single_select": return "select";
    case "multi_value_multi_select": return "multiselect";
    default: return null;
  }
}

/** Greenhouse's public Job Board API (questions=true) into a FormSchema. */
export function parseGreenhouse(job: GreenhouseJobJson, board: string, jobId: string): FormSchema {
  const fields: SchemaField[] = [];
  const add = (question: GreenhouseQuestion, section: SchemaField["section"]) => {
    const label = clean(question.label);
    // Greenhouse offers "attach" or "paste" for the resume and cover letter; the file is kept.
    const hasFile = question.fields.some((field) => field.type === "input_file");
    for (const field of question.fields) {
      const type = typeOf(field);
      if (!type || (hasFile && field.type === "textarea")) continue;
      const sensitive = section === "eeoc" || classifyQuestion(label).sensitive || CERTIFY.test(label);
      fields.push({
        id: field.name,
        label: section === "eeoc" ? label.replace(/([a-z])([A-Z])/g, "$1 $2") : label,
        type,
        required: Boolean(question.required),
        options: (field.values ?? []).map((value) => ({ label: clean(value.label), value: String(value.value) })),
        section: section === "question" && CORE.has(field.name) ? "core" : section,
        sensitive: sensitive && !CORE.has(field.name),
      });
    }
  };
  for (const question of job.questions ?? []) add(question, "question");
  // Location: Greenhouse shows one type-ahead box and keeps latitude and longitude itself.
  const location = (job.location_questions ?? []).find((question) => question.fields.some((field) => field.name === "location"));
  if (location) fields.push({ id: "candidate-location", label: "Location (City)", type: "location", required: Boolean(location.required), options: [], section: "location", sensitive: false });
  for (const block of job.compliance ?? []) for (const question of block.questions ?? []) add(question, "eeoc");
  // Fields Greenhouse's form adds on its own: the phone country and the education block.
  fields.push(
    { id: "country", label: "Phone country", type: "phone_country", required: true, options: [], section: "core", sensitive: false, ifPresent: true },
    { id: "school--0", label: "School", type: "school", required: true, options: [], section: "education", sensitive: false, ifPresent: true },
    { id: "degree--0", label: "Degree", type: "degree", required: true, options: [], section: "education", sensitive: false, ifPresent: true },
    { id: "discipline--0", label: "Discipline", type: "select", required: false, options: [], section: "education", sensitive: false, ifPresent: true },
  );
  return {
    ats: "greenhouse",
    board,
    jobId,
    formUrl: `https://job-boards.greenhouse.io/embed/job_app?for=${encodeURIComponent(board)}&token=${encodeURIComponent(jobId)}`,
    title: clean(job.title),
    company: clean(job.company_name ?? board),
    description: clean(job.content ?? "").slice(0, 6000),
    fields,
  };
}

/** The schema as review questions, so the existing review screen shows and edits the mapping. */
export function schemaKind(field: SchemaField) {
  return field.type === "textarea" ? "textarea" : field.type === "file" ? "file" : field.type === "multiselect" ? "multiselect" : field.type === "select" || field.options.length ? "select" : "text";
}
