import { ServiceError } from "@/lib/errors";
import { safeGet, safeGetJson } from "@/lib/apply/safe-fetch";
import { classifyQuestion } from "@/lib/apply/questions";
import type { ApplicationQuestion, Ats, JobDetails, PostedRecruiter, QuestionKind } from "@/lib/apply/types";

/** Sites whose terms don't allow automated reading or applying. The student applies there themselves. */
const BLOCKED_HOSTS: Array<[RegExp, string]> = [
  [/(^|\.)linkedin\.com$/, "LinkedIn"],
  [/(^|\.)indeed\.com$/, "Indeed"],
  [/(^|\.)glassdoor\.com$/, "Glassdoor"],
  [/(^|\.)joinhandshake\.com$/, "Handshake"],
  [/(^|\.)ziprecruiter\.com$/, "ZipRecruiter"],
];

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", mdash: "—", ndash: "–", hellip: "…", bull: "•" };

export function decodeEntities(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (match, code: string) => {
    if (code[0] === "#") {
      const value = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(value) ? String.fromCodePoint(value) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

/** Readable text from HTML: block tags become line breaks and list items become bullets. */
export function htmlToText(html: string) {
  return decodeEntities(
    decodeEntities(html)
      .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<li[^>]*>/gi, "\n• ")
      .replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/ul|\/ol|\/section|\/tr)[^>]*>/gi, "\n")
      .replace(/<h[1-6][^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const REQUIREMENT_HEADINGS = /^(?:•\s*)?(?:basic |minimum |preferred |required |key )?(?:requirements|qualifications|what you(?:'|’)?ll (?:need|bring)|what you bring|what we(?:'|’)?re looking for|who you are|you (?:have|might be a fit|are)|about you|skills(?: and| &) experience|must[- ]haves?|nice[- ]to[- ]haves?|your (?:expertise|experience|background|skills)|(?:the )?ideal candidate|you(?:'|’)?ll bring|you bring|what we need to see|ways to stand out(?: from the crowd)?|basic qualifications|preferred qualifications|minimum qualifications)\b.{0,40}$/i;
const SECTION_HEADING = /^[A-Z][^.!?•]{2,60}:?$/;

/** Bullet lines under requirement-style headings. Only text that is in the posting. */
export function extractRequirements(text: string) {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const out: string[] = [];
  let inside = false;
  for (const line of lines) {
    if (REQUIREMENT_HEADINGS.test(line.replace(/:$/, ""))) {
      inside = true;
      continue;
    }
    if (inside && !line.startsWith("•") && SECTION_HEADING.test(line)) {
      inside = false;
      continue;
    }
    if (inside && line.startsWith("•")) {
      const item = line.replace(/^•\s*/, "").trim();
      if (item.length >= 2 && item.length < 400) out.push(item);
    }
  }
  return [...new Set(out)].slice(0, 25);
}

const GENERIC_MAILBOX = /^(jobs|careers|recruiting|talent|hr|hiring|apply|applications|people|info|hello|contact|team|no-?reply)@/i;
const NAME = "([A-Z][a-zA-Z'’-]+(?: [A-Z][a-zA-Z'’.-]+){1,2})";

/** A recruiter or hiring contact only when the posting names one outright. */
export function findPostedRecruiter(text: string): PostedRecruiter | null {
  const patterns = [
    new RegExp(`(?:recruiter|talent (?:partner|acquisition(?: partner| lead)?)|hiring manager|point of contact)\\s*(?:is|:|-|–)\\s*${NAME}`, "i"),
    new RegExp(`(?:reach out to|contact|questions\\?? (?:email|contact))\\s+${NAME}\\s*(?:,|\\(|at|-|–)\\s*(?:our |the )?(recruiter|talent[a-z ]*|hiring manager)`, "i"),
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const name = match[1].trim();
    if (name.split(" ").length < 2) continue;
    const near = text.slice(Math.max(0, (match.index ?? 0) - 200), (match.index ?? 0) + match[0].length + 200);
    const email = near.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? null;
    return { name, title: match[2] ? match[2].replace(/\b\w/g, (c) => c.toUpperCase()) : /hiring manager/i.test(match[0]) ? "Hiring Manager" : "Recruiter", email: email && !GENERIC_MAILBOX.test(email) ? email : null };
  }
  return null;
}

function humanize(slug: string) {
  return slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

function question(key: string, label: string, kind: QuestionKind, required: boolean, options: string[] = []): ApplicationQuestion {
  return { key, label: label.trim(), kind, required, options, sensitive: classifyQuestion(label).sensitive, answer: null, source: null, evidence: null };
}

type ParsedUrl = { ats: Ats; board: string; jobId: string; url: URL };

export function parseJobUrl(raw: string): ParsedUrl {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ServiceError("That doesn't look like a link. Paste the full job posting URL, starting with https://", "job_url", 400);
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const blocked = BLOCKED_HOSTS.find(([pattern]) => pattern.test(host));
  if (blocked) {
    throw new ServiceError(`${blocked[1]} doesn't allow automated applications. Open the posting, click Apply, and paste the company's own application link here instead.`, "job_url_blocked", 400);
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (/(^|\.)greenhouse\.io$/.test(host)) {
    const ghFor = url.searchParams.get("for");
    const ghToken = url.searchParams.get("token");
    if (ghFor && ghToken) return { ats: "greenhouse", board: ghFor, jobId: ghToken, url };
    const jobsIndex = parts.indexOf("jobs");
    if (jobsIndex > 0 && parts[jobsIndex + 1]) return { ats: "greenhouse", board: parts[jobsIndex - 1], jobId: parts[jobsIndex + 1].replace(/\D.*$/, ""), url };
  }
  if (/(^|\.)lever\.co$/.test(host) && parts.length >= 2) return { ats: "lever", board: parts[0], jobId: parts[1], url };
  if (host === "jobs.ashbyhq.com" && parts.length >= 2) return { ats: "ashby", board: parts[0], jobId: parts[1], url };
  const workday = parseWorkday(url);
  if (workday) return workday;
  return { ats: "other", board: host, jobId: "", url };
}

/**
 * Workday links: {tenant}.wd5.myworkdayjobs.com/{locale}/{site}/job/{location}/{title}_{req}
 * or wd5.myworkdaysite.com/{locale}/recruiting/{tenant}/{site}/job/... The board is "host|tenant|site".
 */
function parseWorkday(url: URL): ParsedUrl | null {
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean).filter((part) => !/^[a-z]{2}-[A-Z]{2}$/.test(part));
  let tenant = "";
  let site = "";
  let rest: string[] = [];
  if (host.endsWith(".myworkdayjobs.com")) {
    tenant = host.split(".")[0];
    site = parts[0] ?? "";
    rest = parts.slice(1);
  } else if (host.endsWith("myworkdaysite.com") && parts[0] === "recruiting") {
    tenant = parts[1] ?? "";
    site = parts[2] ?? "";
    rest = parts.slice(3);
  } else {
    return null;
  }
  const jobIndex = rest.findIndex((part) => part === "job" || part === "details");
  if (!tenant || !site || jobIndex < 0) return null;
  const path = rest.slice(jobIndex + 1).filter((part) => !["apply", "applyManually", "autofillWithResume", "useMyLastApplication"].includes(part));
  if (!path.length) return null;
  return { ats: "workday", board: `${host}|${tenant}|${site}`, jobId: path.join("/"), url };
}

// Names that belong to the job site, not the company: what a Workday or Greenhouse page calls itself.
const JOB_SITE_NAME = /^(workday|myworkday(jobs|site)?|greenhouse|lever|ashby|ashbyhq|icims|smartrecruiters|jobvite|taleo|successfactors|workable|bamboohr|recruitee|teamtailor|rippling|paycom(online)?|paylocity|ultipro|ukg|dayforce(hcm)?|oracle ?cloud|eightfold|avature|phenom|breezy|applytojob|wd\d+|careers?|jobs?|apply|boards?|job application|candidate home|sign in)$/i;

/** Whether a page's name for the company is really the job site's own name ("Workday"). */
export function isJobSiteName(name: string) {
  const plainName = name.replace(/\s+/g, " ").trim();
  return !plainName || JOB_SITE_NAME.test(plainName);
}

/** The company a job link names: Workday's tenant, or the board's slug on Greenhouse, Lever and Ashby. */
export function companyFromUrl(raw: string) {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    const parts = url.pathname.split("/").filter(Boolean).filter((part) => !/^[a-z]{2}-[A-Z]{2}$/.test(part));
    let slug = "";
    if (host.endsWith(".myworkdayjobs.com")) slug = host.split(".")[0];
    else if (host.endsWith("myworkdaysite.com") && parts[0] === "recruiting") slug = parts[1] ?? "";
    else if (/(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com)$/.test(host)) slug = parts[0] === "embed" ? url.searchParams.get("for") ?? "" : parts[0] ?? "";
    return slug && !isJobSiteName(slug) ? humanize(slug) : "";
  } catch {
    return "";
  }
}

/** One key per job, so pasting the same posting twice finds the first application. */
export function jobKeyFor(parsed: ParsedUrl) {
  if (parsed.ats === "workday") {
    // The requisition id at the end of the slug identifies the job, whatever the location path.
    const req = parsed.jobId.split("/").pop()!.split("_").pop()!;
    return `workday:${parsed.board.split("|")[1]}:${req.toLowerCase()}`;
  }
  if (parsed.ats !== "other") return `${parsed.ats}:${parsed.board.toLowerCase()}:${parsed.jobId.toLowerCase()}`;
  const url = new URL(parsed.url.toString());
  url.hash = "";
  const keep = ["gh_jid", "jobId", "jobid", "job_id", "id", "lever-source"];
  for (const key of [...url.searchParams.keys()]) if (!keep.includes(key)) url.searchParams.delete(key);
  const ghJid = url.searchParams.get("gh_jid");
  if (ghJid) return `gh_jid:${url.hostname.replace(/^www\./, "")}:${ghJid}`;
  return `url:${url.hostname.replace(/^www\./, "").toLowerCase()}${url.pathname.replace(/\/+$/, "")}${url.search}`;
}

type GreenhouseField = { name: string; type: string; values?: Array<{ label: string; value: string | number }> };
type GreenhouseQuestion = { label: string; required: boolean; fields: GreenhouseField[] };
type GreenhouseJob = {
  title?: string;
  content?: string;
  absolute_url?: string;
  location?: { name?: string };
  departments?: Array<{ name?: string }>;
  questions?: GreenhouseQuestion[];
  location_questions?: GreenhouseQuestion[];
  compliance?: Array<{ questions?: GreenhouseQuestion[] }>;
  demographic_questions?: { questions?: Array<{ label: string; required: boolean; answer_options?: Array<{ label: string }> }> };
};

function greenhouseKind(type: string): QuestionKind {
  if (type === "input_file") return "file";
  if (type === "textarea") return "textarea";
  if (type === "multi_value_single_select") return "select";
  if (type === "multi_value_multi_select") return "multiselect";
  if (type === "input_text") return "text";
  return "unknown";
}

async function readGreenhouse(parsed: ParsedUrl): Promise<Omit<JobDetails, "jobKey" | "jobUrl">> {
  const base = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(parsed.board)}`;
  const [job, board] = await Promise.all([
    safeGetJson<GreenhouseJob>(`${base}/jobs/${encodeURIComponent(parsed.jobId)}?questions=true`),
    safeGetJson<{ name?: string }>(base),
  ]);
  if (!job?.title) throw new ServiceError("Greenhouse didn't return this job. It may have closed. Check the link and try again.", "job_not_found", 404);
  const description = htmlToText(job.content ?? "");
  const questions: ApplicationQuestion[] = [];
  const add = (items: GreenhouseQuestion[] | undefined, sensitive = false) => {
    for (const item of items ?? []) {
      for (const field of item.fields ?? []) {
        if (field.type === "input_hidden") continue;
        const q = question(field.name, item.label, greenhouseKind(field.type), Boolean(item.required), (field.values ?? []).map((value) => value.label));
        if (sensitive) q.sensitive = true;
        questions.push(q);
      }
    }
  };
  add(job.questions);
  // Greenhouse offers "attach a file" and "paste text" for the same resume or cover letter. Keep the file.
  const fileLabels = new Set(questions.filter((q) => q.kind === "file").map((q) => q.label));
  for (let index = questions.length - 1; index >= 0; index -= 1) {
    if (questions[index].kind === "textarea" && fileLabels.has(questions[index].label)) questions.splice(index, 1);
  }
  add(job.location_questions);
  for (const block of job.compliance ?? []) add(block.questions, true);
  for (const item of job.demographic_questions?.questions ?? []) {
    questions.push({ ...question(`demographic:${item.label}`, item.label, "select", Boolean(item.required), (item.answer_options ?? []).map((option) => option.label)), sensitive: true });
  }
  return {
    ats: "greenhouse",
    title: job.title.trim(),
    company: board?.name?.trim() || humanize(parsed.board),
    department: job.departments?.map((dept) => dept.name).filter(Boolean).join(", ") || null,
    location: job.location?.name?.trim() || null,
    description,
    requirements: extractRequirements(description),
    applicationUrl: job.absolute_url || `https://job-boards.greenhouse.io/${parsed.board}/jobs/${parsed.jobId}`,
    postedRecruiter: findPostedRecruiter(description),
    questions,
  };
}

type LeverPosting = {
  text?: string;
  categories?: { team?: string; department?: string; location?: string; commitment?: string };
  descriptionPlain?: string;
  description?: string;
  lists?: Array<{ text?: string; content?: string }>;
  additionalPlain?: string;
  hostedUrl?: string;
  applyUrl?: string;
};

/** Lever's standard form. Custom questions only appear on the live form. */
const LEVER_STANDARD: ApplicationQuestion[] = [
  question("resume", "Resume/CV", "file", true),
  question("name", "Full name", "text", true),
  question("email", "Email", "text", true),
  question("phone", "Phone", "text", false),
  question("org", "Current company", "text", false),
  question("urls[LinkedIn]", "LinkedIn URL", "text", false),
  question("urls[GitHub]", "GitHub URL", "text", false),
  question("urls[Portfolio]", "Portfolio URL", "text", false),
];

function titleCompany(html: string) {
  const title = decodeEntities(html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ?? "").trim();
  return title;
}

async function readLever(parsed: ParsedUrl): Promise<Omit<JobDetails, "jobKey" | "jobUrl">> {
  const region = parsed.url.hostname.includes(".eu.") ? "api.eu.lever.co" : "api.lever.co";
  const posting = await safeGetJson<LeverPosting>(`https://${region}/v0/postings/${encodeURIComponent(parsed.board)}/${encodeURIComponent(parsed.jobId)}`);
  if (!posting?.text) throw new ServiceError("Lever didn't return this job. It may have closed. Check the link and try again.", "job_not_found", 404);
  const lists = (posting.lists ?? []).map((list) => `${list.text ?? ""}\n${htmlToText(list.content ?? "")}`).join("\n\n");
  const description = [posting.descriptionPlain || htmlToText(posting.description ?? ""), lists, posting.additionalPlain ?? ""].filter(Boolean).join("\n\n").trim();
  let company = humanize(parsed.board);
  if (posting.hostedUrl) {
    const page = await safeGet(posting.hostedUrl).catch(() => null);
    const title = page?.ok ? titleCompany(page.text) : "";
    const named = title.split(/\s+[-–|]\s+/)[0]?.trim();
    if (named && named.toLowerCase() !== posting.text.toLowerCase() && named.length < 80) company = named;
  }
  return {
    ats: "lever",
    title: posting.text.trim(),
    company,
    department: posting.categories?.department || posting.categories?.team || null,
    location: posting.categories?.location || null,
    description,
    requirements: extractRequirements(description),
    applicationUrl: posting.applyUrl || (posting.hostedUrl ? `${posting.hostedUrl.replace(/\/$/, "")}/apply` : null),
    postedRecruiter: findPostedRecruiter(description),
    questions: LEVER_STANDARD.map((item) => ({ ...item })),
  };
}

type AshbyBoard = { jobs?: Array<{ id: string; title?: string; department?: string; team?: string; location?: string; descriptionPlain?: string; descriptionHtml?: string; jobUrl?: string; applyUrl?: string }> };

async function readAshby(parsed: ParsedUrl): Promise<Omit<JobDetails, "jobKey" | "jobUrl">> {
  const board = await safeGetJson<AshbyBoard>(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(parsed.board)}`);
  const job = board?.jobs?.find((item) => item.id === parsed.jobId);
  if (!job?.title) throw new ServiceError("Ashby didn't return this job. It may have closed. Check the link and try again.", "job_not_found", 404);
  const description = (job.descriptionPlain || htmlToText(job.descriptionHtml ?? "")).trim();
  let company = humanize(parsed.board);
  const page = await safeGet(job.jobUrl || parsed.url.toString()).catch(() => null);
  const title = page?.ok ? titleCompany(page.text) : "";
  const named = title.match(/@\s*(.+)$/)?.[1]?.trim() || title.split(/\s+[-–|]\s+/).pop()?.trim();
  if (named && named.toLowerCase() !== job.title.toLowerCase() && named.length < 80 && !/ashby/i.test(named)) company = named;
  return {
    ats: "ashby",
    title: job.title.trim(),
    company,
    department: job.department || job.team || null,
    location: job.location || null,
    description,
    requirements: extractRequirements(description),
    applicationUrl: job.applyUrl || `https://jobs.ashbyhq.com/${parsed.board}/${parsed.jobId}/application`,
    postedRecruiter: findPostedRecruiter(description),
    questions: [],
  };
}

type WorkdayJob = {
  jobPostingInfo?: {
    title?: string;
    jobDescription?: string;
    location?: string;
    additionalLocations?: string[];
    externalUrl?: string;
    canApply?: boolean;
    jobReqId?: string;
  };
  hiringOrganization?: { name?: string };
};

/** Workday's public job API, the same one its career sites load. */
async function readWorkday(parsed: ParsedUrl): Promise<Omit<JobDetails, "jobKey" | "jobUrl">> {
  const [host, tenant, site] = parsed.board.split("|");
  const job = await safeGetJson<WorkdayJob>(`https://${host}/wday/cxs/${encodeURIComponent(tenant)}/${encodeURIComponent(site)}/job/${parsed.jobId.split("/").map(encodeURIComponent).join("/")}`);
  const info = job?.jobPostingInfo;
  if (!info?.title) throw new ServiceError("Workday didn't return this job. It may have closed. Check the link and try again.", "job_not_found", 404);
  if (info.canApply === false) throw new ServiceError("This Workday job isn't accepting applications right now.", "job_closed", 409);
  const description = htmlToText(info.jobDescription ?? "");
  // Workday's organization is often a legal entity like "2100 NVIDIA USA"; prefer the tenant's name inside it.
  const org = (job?.hiringOrganization?.name ?? "").replace(/^\d+\s+/, "").trim();
  const inOrg = org.match(new RegExp(tenant.replace(/[^a-z0-9]/gi, ""), "i"))?.[0];
  const externalUrl = info.externalUrl || `https://${host}/${site}/job/${parsed.jobId}`;
  return {
    ats: "workday",
    title: info.title.trim(),
    company: inOrg || org || humanize(tenant),
    department: null,
    location: [info.location, ...(info.additionalLocations ?? [])].filter(Boolean).join(" · ") || null,
    description,
    requirements: extractRequirements(description),
    applicationUrl: `${externalUrl.replace(/\/$/, "")}/apply`,
    postedRecruiter: findPostedRecruiter(description),
    questions: [],
  };
}

type JsonLdJob = {
  "@type"?: string | string[];
  title?: string;
  description?: string;
  hiringOrganization?: { name?: string } | string;
  jobLocation?: Array<{ address?: { addressLocality?: string; addressRegion?: string } }> | { address?: { addressLocality?: string; addressRegion?: string } };
  occupationalCategory?: string;
  url?: string;
};

function findJobPosting(value: unknown): JsonLdJob | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findJobPosting(item);
      if (found) return found;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  const type = record["@type"];
  if (type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"))) return record as JsonLdJob;
  return findJobPosting(record["@graph"]);
}

async function readOther(parsed: ParsedUrl): Promise<Omit<JobDetails, "jobKey" | "jobUrl">> {
  const page = await safeGet(parsed.url.toString());
  if (!page.ok) throw new ServiceError(`That page returned an error (${page.status}). Check the link and try again.`, "job_not_found", 404);
  // Company career pages often embed a Greenhouse job; read it from Greenhouse when the board is named.
  const ghJid = parsed.url.searchParams.get("gh_jid");
  const ghBoard = page.text.match(/greenhouse\.io\/(?:embed\/job_board(?:\/js)?\?for=|embed\/job_app\?for=)([A-Za-z0-9_-]+)/)?.[1];
  if (ghJid && ghBoard) {
    return readGreenhouse({ ats: "greenhouse", board: ghBoard, jobId: ghJid, url: parsed.url });
  }
  const blocks = [...page.text.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const block of blocks) {
    let parsedJson: unknown = null;
    try {
      parsedJson = JSON.parse(block[1].trim());
    } catch {
      continue;
    }
    const job = findJobPosting(parsedJson);
    if (!job?.title) continue;
    const description = htmlToText(job.description ?? "");
    const org = typeof job.hiringOrganization === "string" ? job.hiringOrganization : job.hiringOrganization?.name;
    const places = (Array.isArray(job.jobLocation) ? job.jobLocation : job.jobLocation ? [job.jobLocation] : [])
      .map((place) => [place.address?.addressLocality, place.address?.addressRegion].filter(Boolean).join(", "))
      .filter(Boolean);
    return {
      ats: "other",
      title: decodeEntities(job.title).trim(),
      company: decodeEntities(org ?? "").trim() || parsed.board,
      department: job.occupationalCategory || null,
      location: places.join(" · ") || null,
      description,
      requirements: extractRequirements(description),
      applicationUrl: page.url,
      postedRecruiter: findPostedRecruiter(description),
      questions: [],
    };
  }
  const text = htmlToText(page.text);
  if (text.length < 200) {
    throw new ServiceError("This page loads its job details in a way Unnepo can't read yet. Try the company's Greenhouse, Lever, or Ashby link for the job if it has one.", "job_unreadable", 422);
  }
  return extractWithModel(parsed, page.url, text);
}

type ModelJob = { title?: string; company?: string; department?: string | null; location?: string | null };

/** Last resort for pages without structured data. The model may only copy values that appear in the page text. */
async function extractWithModel(parsed: ParsedUrl, pageUrl: string, text: string): Promise<Omit<JobDetails, "jobKey" | "jobUrl">> {
  const { readAnthropicKey } = await import("@/lib/db/file-store");
  const apiKey = await readAnthropicKey();
  if (!apiKey) throw new ServiceError("This page has no structured job data, and AI reading is not configured.", "job_unreadable", 422);
  const clipped = text.slice(0, 15000);
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: process.env.ANTHROPIC_FAST_MODEL || "claude-haiku-4-5",
    max_tokens: 400,
    system: "You read job posting pages. Copy the job title, company name, department, and location exactly as they appear in the page text. Use null for anything the text does not state. Never guess. Return only JSON with the keys title, company, department, location.",
    messages: [{ role: "user", content: `Page URL: ${pageUrl}\n\nPage text:\n${clipped}` }],
  });
  const raw = response.content.map((block) => (block.type === "text" ? block.text : "")).join("");
  let job: ModelJob = {};
  try {
    job = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as ModelJob;
  } catch {
    job = {};
  }
  const lower = clipped.toLowerCase();
  const grounded = (value: string | null | undefined) => (value && lower.includes(value.toLowerCase()) ? value.trim() : null);
  const title = grounded(job.title);
  if (!title) throw new ServiceError("Couldn't find a job title on that page. Make sure the link opens a single job posting.", "job_unreadable", 422);
  return {
    ats: "other",
    title,
    company: grounded(job.company) || parsed.board,
    department: grounded(job.department),
    location: grounded(job.location),
    description: clipped,
    requirements: extractRequirements(clipped),
    applicationUrl: pageUrl,
    postedRecruiter: findPostedRecruiter(clipped),
    questions: [],
  };
}

/** Reads a job posting link into structured details. Never fills in a field the posting doesn't state. */
export async function extractJob(rawUrl: string): Promise<JobDetails> {
  const parsed = parseJobUrl(rawUrl);
  const details =
    parsed.ats === "greenhouse" ? await readGreenhouse(parsed)
    : parsed.ats === "lever" ? await readLever(parsed)
    : parsed.ats === "ashby" ? await readAshby(parsed)
    : parsed.ats === "workday" ? await readWorkday(parsed)
    : await readOther(parsed);
  return { ...details, jobKey: jobKeyFor(parsed), jobUrl: parsed.url.toString(), description: details.description.slice(0, 20000) };
}
