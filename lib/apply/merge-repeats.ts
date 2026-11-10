import { isApplied } from "@/lib/apply/stats";
import { applicationContacts, applications } from "@/lib/apply/store";
import type { ApplicationOutcome, FillReport, JobApplication } from "@/lib/apply/types";

/**
 * One job saved twice on the Applied list (from a job board and from the company's own site, say) becomes one job,
 * with everything both knew. The earliest saved is the one kept. Jobs that only look alike stay apart: another
 * location, another posting number, two postings in one job system, or applications months apart.
 */

const plain = (text: string | null | undefined) => (text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const company = (text: string) => plain(text).replace(/\b(incorporated|inc|llc|ltd|limited|corp|corporation|co|company|plc)\b/g, " ").replace(/\s+/g, " ").trim();
const NO_NAME = new Set(["", "unknown role", "unknown company", "unknown"]);
const MONTHS_APART = 180 * 86_400_000;

type Job = Pick<JobApplication, "title" | "company" | "location" | "ats" | "jobKey" | "submittedAt" | "fillReport">;

export function sameJob(a: Job, b: Job) {
  const title = plain(a.title);
  const employer = company(a.company);
  if (NO_NAME.has(title) || NO_NAME.has(employer) || title !== plain(b.title) || employer !== company(b.company)) return false;
  const [placeA, placeB] = [plain(a.location), plain(b.location)];
  if (placeA && placeB && placeA !== placeB) return false;
  const [numberA, numberB] = [a.fillReport?.jobNumber, b.fillReport?.jobNumber];
  if (numberA && numberB && plain(numberA) !== plain(numberB)) return false;
  if (a.ats === b.ats && a.ats !== "other" && a.jobKey !== b.jobKey) return false;
  if (a.submittedAt && b.submittedAt && Math.abs(Date.parse(a.submittedAt) - Date.parse(b.submittedAt)) > MONTHS_APART) return false;
  return true;
}

/** Each group of repeats, earliest saved first. A group needs at least one job that was applied to. */
export function repeatGroups<T extends Job & Pick<JobApplication, "status" | "createdAt">>(apps: T[]) {
  const groups: T[][] = [];
  for (const app of [...apps].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const group = groups.find((list) => sameJob(list[0], app));
    if (group) group.push(app);
    else groups.push([app]);
  }
  return groups.filter((group) => group.length > 1 && group.some((app) => isApplied(app.status)));
}

const OUTCOME_ORDER: ApplicationOutcome[] = ["follow_up", "assessment", "interviewing", "rejected", "offer"];
const unique = <T,>(list: T[]) => [...new Set(list)];
const longer = (a: string, b: string) => (b.trim().length > a.trim().length ? b : a);
const manualLink = (url: string | null | undefined) => !url || url.startsWith("https://unnepo.local/");

function mergeReports(keep: FillReport | null, other: FillReport | null): FillReport | null {
  if (!keep || !other) return keep ?? other;
  const byTime = <T extends { at: string }>(list: T[]) => list.sort((a, b) => a.at.localeCompare(b.at));
  const defined = Object.fromEntries(Object.entries(keep).filter(([, value]) => value !== undefined && value !== null && value !== ""));
  const outcome = OUTCOME_ORDER[Math.max(OUTCOME_ORDER.indexOf(keep.outcome as ApplicationOutcome), OUTCOME_ORDER.indexOf(other.outcome as ApplicationOutcome))] ?? null;
  const notes = unique([keep.notes, other.notes].map((note) => note?.trim()).filter(Boolean)).join("\n\n");
  const lastEmailAt = [keep.lastEmailAt, other.lastEmailAt].filter(Boolean).sort().at(-1);
  // One applied event: the first time it was caught.
  const activity = byTime([...(keep.activity ?? []), ...(other.activity ?? [])]).filter((event, index, list) => event.kind !== "applied" || list.findIndex((item) => item.kind === "applied") === index);
  return {
    ...other,
    ...defined,
    filled: unique([...keep.filled, ...other.filled]),
    failed: [...keep.failed, ...other.failed.filter((item) => !keep.failed.some((known) => known.label === item.label))],
    outcome,
    ...(notes ? { notes } : {}),
    ...(lastEmailAt ? { lastEmailAt } : {}),
    statusHistory: byTime([...(keep.statusHistory ?? []), ...(other.statusHistory ?? [])]),
    activity,
    attempts: [...(other.attempts ?? []), ...(keep.attempts ?? [])].slice(-300),
    emailedAt: { ...other.emailedAt, ...keep.emailedAt },
    peopleLinks: { ...other.peopleLinks, ...keep.peopleLinks },
    peopleHidden: { ...other.peopleHidden, ...keep.peopleHidden },
    peopleReveals: Math.max(keep.peopleReveals ?? 0, other.peopleReveals ?? 0),
    personCharged: Boolean(keep.personCharged || other.personCharged),
    autofillCounted: Boolean(keep.autofillCounted || other.autofillCounted),
  };
}

/** What the kept job becomes once a repeat is folded into it. */
export function mergedJob(keep: JobApplication, other: JobApplication): Partial<JobApplication> {
  const applied = isApplied(keep.status) ? keep : isApplied(other.status) ? other : keep;
  const days = [keep.submittedAt, other.submittedAt].filter((day): day is string => Boolean(day)).sort();
  const linkFromOther = manualLink(keep.jobUrl) && !manualLink(other.jobUrl);
  return {
    status: keep.status === "submitted" || other.status === "submitted" ? "submitted" : applied.status,
    statusMessage: applied.statusMessage,
    submittedAt: days[0] ?? null,
    confirmation: keep.confirmation ?? other.confirmation,
    jobUrl: linkFromOther ? other.jobUrl : keep.jobUrl,
    applicationUrl: manualLink(keep.applicationUrl) ? (manualLink(other.applicationUrl) ? keep.applicationUrl : other.applicationUrl) : keep.applicationUrl,
    companyDomain: keep.companyDomain ?? other.companyDomain,
    department: keep.department ?? other.department,
    location: keep.location ?? other.location,
    description: longer(keep.description, other.description),
    requirements: keep.requirements.length >= other.requirements.length ? keep.requirements : other.requirements,
    postedRecruiter: keep.postedRecruiter ?? other.postedRecruiter,
    questions: keep.questions.length >= other.questions.length ? keep.questions : other.questions,
    contactsStatus: keep.contactsStatus === "idle" ? other.contactsStatus : keep.contactsStatus,
    contactsMessage: keep.contactsMessage || other.contactsMessage,
    charged: keep.charged || other.charged,
    attempts: keep.attempts + other.attempts,
    fillReport: mergeReports(keep.fillReport, other.fillReport),
  };
}

/** Folds any repeats together and returns the list as it now stands. A problem here leaves the list as it was. */
export async function mergeRepeats(userId: string, apps: JobApplication[]) {
  const groups = repeatGroups(apps);
  if (!groups.length) return apps;
  const gone = new Set<string>();
  const kept = new Map<string, JobApplication>();
  for (const [first, ...repeats] of groups) {
    let keep = first;
    try {
      for (const other of repeats) {
        const merged = await applications.update(userId, keep.id, mergedJob(keep, other));
        if (!merged) break;
        keep = merged;
        // The repeat's people move over before it goes.
        const [people, known] = await Promise.all([applicationContacts.list(userId, [other.id]), applicationContacts.list(userId, [keep.id])]);
        const same = (a: { email: string | null; name: string }, b: { email: string | null; name: string }) => (a.email && b.email ? a.email.toLowerCase() === b.email.toLowerCase() : plain(a.name) === plain(b.name));
        await applicationContacts.move(userId, people.filter((person) => !known.some((row) => same(row, person))).map((person) => person.id), keep.id, known.length);
        await applications.remove(userId, other.id);
        gone.add(other.id);
      }
      kept.set(first.id, keep);
    } catch (error) {
      console.error("merge_repeats_failed", error instanceof Error ? error.message : error);
    }
  }
  return apps.filter((app) => !gone.has(app.id)).map((app) => kept.get(app.id) ?? app);
}
