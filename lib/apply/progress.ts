import { followUpsDue } from "@/lib/apply/follow-ups";
import { stageOf } from "@/lib/apply/stats";

/**
 * Where a job applied to is: Applied → Reach out → Waiting → Follow up → Interview. Shared by the extension's
 * job pages and the website's Jobs tab, from the tracker's copy of a job.
 */

export const STEPS = ["Applied", "Reach out", "Waiting", "Follow up", "Interview"] as const;
/** The step's name in a list, by how many are done (4: followed up, waiting again). */
export const STEP_LABEL = ["Not applied", "Reach out", "Waiting", "Follow up", "Waiting", "Interview"] as const;

export type Progress = {
  /** How many steps are behind it. */
  done: number;
  /** The step it's on is waiting on the student (a follow-up due). */
  due: boolean;
  /** Where it ended, when it did. */
  ended: "Rejected" | "Offer" | null;
  /** What to do next, in a few words. */
  next: string;
};

type Job = {
  id: string; company: string; title: string; status: string; companyMissing: boolean; createdAt: string; submittedAt: string | null;
  fillReport: { outcome?: string | null; lastEmailAt?: string; emailedAt?: Record<string, string>; reachedOut?: { count: number } } | null;
  contacts: Array<{ id: string; name: string; outreachStatus: string }>;
};

const applied = (job: Job) => job.status === "submitted" || job.status === "applied_manual";
/** People emailed about a job: the student's own count, or the people marked emailed. */
export const emailedCount = (job: Job) => Math.max(job.fillReport?.reachedOut?.count ?? 0, job.contacts.filter((person) => person.outreachStatus !== "not_contacted").length);

/** `followedUp`: a person on it was sent a follow-up (the extension keeps that count). */
export function progressOf(job: Job, followedUp = false, now = new Date()): Progress {
  const stage = stageOf(job as never);
  const company = job.companyMissing ? "the company" : job.company;
  if (!applied(job)) return { done: 0, due: false, ended: null, next: "Apply, then it moves along here." };
  if (stage === "offer") return { done: 5, due: false, ended: "Offer", next: "You got an offer." };
  if (stage === "interviewing" || stage === "assessment") return { done: 5, due: false, ended: null, next: stage === "assessment" ? "You have an assessment." : "You're interviewing." };
  const emailed = emailedCount(job);
  const replied = job.contacts.some((person) => person.outreachStatus === "replied");
  const progress: Progress = !emailed
    ? { done: 1, due: false, ended: null, next: `Email someone at ${company}.` }
    : followUpsDue([job] as never, now).length
      ? { done: 3, due: true, ended: null, next: "A follow-up is due." }
      : replied || followedUp
        ? { done: 4, due: false, ended: null, next: replied ? "Someone replied. Waiting on an interview." : "Followed up. Waiting on an interview." }
        : { done: 2, due: false, ended: null, next: `Emailed ${emailed} ${emailed === 1 ? "person" : "people"}. Waiting on a reply.` };
  return stage === "rejected" ? { ...progress, due: false, ended: "Rejected", next: "This one said no." } : progress;
}
