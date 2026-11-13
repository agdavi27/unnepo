import { CREDIT_COST, FREE_LIMITS, serverConfig } from "@/lib/config";
import { repo } from "@/lib/db/file-store";
import { ServiceError } from "@/lib/errors";
import type { UsageCounts } from "@/lib/apply/types";
import { applicationProfiles } from "@/lib/apply/store";
import { effectivePlan, trialEndedAt, trialFor, type StoredPlan } from "@/lib/plan";
import { isAdminEmail } from "@/lib/services/auth";

/**
 * Plan limits. Free has a few cover letters, answers, written emails and full autofills each day, and one person at
 * each job, with an email that isn't checked, whatever credits it has (the trial spends its credits on whole lists); Pro has no limits, only hidden monthly guards (PRO_AI_LIMIT, PRO_PEOPLE_LIMIT)
 * against scripts. Days, weeks (from Monday) and months are counted in Eastern time, so they turn over at midnight
 * for most students.
 * Accounts listed in UNLIMITED_CREDIT_EMAILS (comma-separated, set in Vercel) never run out of credits and
 * aren't charged them, but keep their plan, so a Free account still sees every Free limit.
 */

/** Writing and autofill, which Free counts by the day. */
export type UsageKind = keyof typeof FREE_LIMITS;
/** Everything counted: people too, which only paid plans and credits count. */
export type CountedKind = UsageKind | "people";

export async function hasUnlimitedCredits(userId: string) {
  const list = (process.env.UNLIMITED_CREDIT_EMAILS || "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (!list.length) return false;
  const user = await repo.getUserById(userId);
  return Boolean(user && list.includes(user.email.trim().toLowerCase()));
}

/**
 * The plan an account works as right now. `stored` is what it's on (billing reads that); `plan` is Pro during
 * the trial; `free` is true only on Free with the trial over. `trial` while it runs, `trialEnded` for a month after.
 */
export async function planState(userId: string) {
  const [account, user, profile] = await Promise.all([repo.getAccount(userId), repo.getUserById(userId), applicationProfiles.get(userId)]);
  const stored = account?.plan ?? "free";
  // An admin looking at the product as Free or Pro: every limit and screen works as that plan. Billing still reads `stored`.
  const preview = profile?.planPreview && user && (await isAdminEmail(user)) ? profile.planPreview : null;
  if (preview) return { stored, plan: preview as StoredPlan, free: preview === "free", trial: null, trialEnded: null, account, preview };
  const plan = effectivePlan(stored, user?.createdAt);
  // "Your Pro trial ended" is said for a month after it ends, then dropped.
  const ended = trialEndedAt(stored, user?.createdAt);
  const trialEnded = ended && Date.now() - Date.parse(ended) < 30 * 86_400_000 ? ended : null;
  return { stored, plan, free: plan === "free", trial: trialFor(stored, user?.createdAt), trialEnded, account, preview: null as "free" | "pro" | null };
}

/** Admins only: work as Free or Pro to see what students on it see, or null to go back to the real plan. */
export async function setPlanPreview(userId: string, raw: unknown) {
  const user = await repo.getUserById(userId);
  if (!user || !(await isAdminEmail(user))) throw new ServiceError("Only admins can switch plans.", "forbidden", 403);
  const wanted = (raw as { plan?: unknown } | null)?.plan;
  const plan = wanted === "free" || wanted === "pro" ? wanted : undefined;
  const stored = await applicationProfiles.get(userId);
  if (!stored) throw new ServiceError("Finish setting up your profile first.", "profile", 409);
  await applicationProfiles.put(userId, { ...stored, planPreview: plan });
  return { planPreview: plan ?? null };
}

/** True when the account works as Free (the trial over, no paid plan). */
export const isFree = async (userId: string) => (await planState(userId)).free;

const ZONE = "America/New_York";
/** "2026-11-12", in Eastern time. */
const dayKey = (at = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
/** The Monday the week started on, as "2026-11-09". */
const weekKey = () => {
  const [year, month, day] = dayKey().split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
};
const monthKey = () => dayKey().slice(0, 7);

const NAMES: Record<CountedKind, [string, string]> = {
  letters: ["cover letter", "cover letters"],
  answers: ["question answer", "question answers"],
  autofills: ["autofill", "autofills"],
  emails: ["written email", "written emails"],
  people: ["company", "companies"],
};

/** The line for a tool that's run out (or is down to its last one). The count itself is the badge in each box's corner. */
function usesNote(kind: CountedKind, left: number, free: boolean, cap: number) {
  const [one, many] = NAMES[kind];
  if (left > 0) return free && left === 1 && kind !== "people" ? `Only 1 ${one} left today` : "";
  if (!free) return `That's a lot of ${many} this month (${cap}). More on the 1st, or write to us if you need more sooner.`;
  if (kind === "autofills") return `Today's ${FREE_LIMITS.autofills} full autofills are used. Autofill still fills your basic details; Pro answers the questions too, with no limit.`;
  return `No ${many} left today. More tomorrow, or Pro has no limit.`;
}

/** What the student has left on their plan: each tool's count, the badge for its box, and a line once it runs out. */
export async function planUsage(userId: string) {
  const [state, stored, unlimited] = await Promise.all([planState(userId), applicationProfiles.get(userId), hasUnlimitedCredits(userId)]);
  const { account, free } = state;
  // Previewing Free shows Free's limits; credits still aren't charged (reveals read the real setting).
  const shownUnlimited = unlimited && state.preview !== "free";
  // Paying (or an admin previewing Pro): unlimited. The trial works as Pro for writing, but its full lists come from
  // the trial's credits, since each costs real money; after them it gets Free's one person at each job.
  const paid = !free && (state.stored !== "free" || state.preview === "pro");
  const config = serverConfig();
  const fairUse = state.plan === "premium" ? config.premiumAiLimit : config.proAiLimit;
  const uses = stored?.uses;
  const [today, week, month] = [dayKey(), weekKey(), monthKey()];
  const daily = (kind: CountedKind) => (uses?.day === today ? uses.daily?.[kind] : 0) ?? 0;
  const weekly = (kind: CountedKind) => (uses?.week === week ? uses.weekly?.[kind] : 0) ?? 0;
  const monthly = (kind: CountedKind) => (uses?.month === month ? uses.monthly?.[kind] : 0) ?? 0;
  const one = (kind: UsageKind) => {
    const used = free ? daily(kind) : monthly(kind);
    const limit = free ? FREE_LIMITS[kind] : fairUse;
    const left = Math.max(0, limit - used);
    return { used, limit, left, note: usesNote(kind, left, free, limit), badge: free ? `${left} left today` : "Unlimited" };
  };
  const [letters, answers, emails] = [one("letters"), one("answers"), one("emails")];
  // Free's full autofills (the questions answered too) are counted; after them it fills the basic details, with no limit.
  const fills = one("autofills");
  const autofills = { ...fills, basic: free && fills.left === 0, badge: free && fills.left === 0 ? "Basic only today" : fills.badge };
  const credits = account?.balance ?? 0;
  const people = (() => {
    if (shownUnlimited) return { used: 0, left: 999, allowance: 999, credits, paid: true, note: "", badge: "Unlimited" };
    if (paid) {
      const left = Math.max(0, config.proPeopleLimit - monthly("people"));
      return { used: monthly("people"), left, allowance: left, credits, paid: true, note: usesNote("people", left, false, config.proPeopleLimit), badge: "Unlimited" };
    }
    // Free sees one person at each job, which isn't counted, credits or not. The trial spends its credits on whole lists.
    if (free) return { used: 0, left: 0, allowance: 0, credits, paid: false, note: "", badge: "1 person per job" };
    return { used: weekly("people"), left: credits, allowance: 0, credits, paid: false, note: "", badge: credits ? `${credits} left` : "1 person per job" };
  })();
  const writing = free ? letters.left * CREDIT_COST.letters + answers.left * CREDIT_COST.answers + emails.left * CREDIT_COST.emails : 0;
  return {
    free, plan: state.plan, preview: state.preview, trial: state.trial, trialEnded: state.trialEnded,
    unlimited: shownUnlimited || paid,
    credits: shownUnlimited || paid ? null : writing + people.left * CREDIT_COST.people,
    letters, answers, autofills, emails, people,
  };
}

/** How a whole list of people would be paid for: Pro's plan, or a credit from the trial or a pack. Null: Free's one person. */
export type PeopleWay = "unlimited" | "plan" | "credit";

export async function peopleAccess(userId: string): Promise<PeopleWay | null> {
  if (await hasUnlimitedCredits(userId)) return "unlimited";
  const { people } = await planUsage(userId);
  if (people.paid) return people.left > 0 ? "plan" : null;
  // Free: one person at each job, never a whole list, even with credits left over from the trial.
  if ((await planState(userId)).free) return null;
  return people.credits > 0 ? "credit" : null;
}

/** A company's people were found with an email: counts it, or spends the credit. False when the credit was gone. */
export async function spendPeople(userId: string, way: PeopleWay, key: string, note: string) {
  if (way === "unlimited") return true;
  if (way === "credit") return !(await repo.spendCredits({ userId, amount: 1, idempotencyKey: key, note, entryType: "unlock_debit" })).insufficient;
  await countUse(userId, "people");
  return true;
}

/** What to say when there's no way to pay for a people search. */
export async function peopleNote(userId: string) {
  return (await planUsage(userId)).people.note || "No more companies right now.";
}

/** Before an AI use: stops at the plan's number. */
export async function assertUseAllowed(userId: string, kind: UsageKind) {
  const usage = await planUsage(userId);
  // Free out of full autofills still fills the basic details, which has no limit.
  if (kind === "autofills" && usage.autofills.basic) return;
  if (usage[kind].left === 0) throw new ServiceError(usage[kind].note, kind, usage.free ? 402 : 429);
}

/** After a use that worked: one more, in the day's, week's and month's counts. Edits the student types themselves don't count. */
export async function countUse(userId: string, kind: CountedKind) {
  // An account with no saved profile yet still counts, or it would never run out: its profile is built from the
  // account, as everywhere else (imported here, since the service imports this file).
  const stored = (await applicationProfiles.get(userId)) ?? (await (await import("@/lib/apply/service")).student(userId)).profile;
  const [day, week, month] = [dayKey(), weekKey(), monthKey()];
  const uses = stored.uses;
  const bump = (counts: UsageCounts | undefined) => ({ ...counts, [kind]: (counts?.[kind] ?? 0) + 1 });
  await applicationProfiles.put(userId, { ...stored, uses: {
    total: bump(uses?.total),
    month, monthly: bump(uses?.month === month ? uses.monthly : {}),
    day, daily: bump(uses?.day === day ? uses.daily : {}),
    week, weekly: bump(uses?.week === week ? uses.weekly : {}),
  } });
}

/** Cover letters used, and how many Free has left (null: a paid plan, nothing to count down). */
export async function coverLettersLeft(userId: string) {
  const usage = await planUsage(userId);
  return { used: usage.letters.used, left: usage.free ? usage.letters.left : (null as number | null) };
}

export const assertCoverLetterAllowed = (userId: string) => assertUseAllowed(userId, "letters");
export const countCoverLetter = (userId: string) => countUse(userId, "letters");
