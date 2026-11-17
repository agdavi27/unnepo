import { CREDIT_COST, FREE_LIMITS, FREE_UNLOCKS_PER_DAY, serverConfig } from "@/lib/config";
import { repo } from "@/lib/db/file-store";
import { ServiceError } from "@/lib/errors";
import type { UsageCounts } from "@/lib/apply/types";
import { applicationProfiles } from "@/lib/apply/store";
import { effectivePlan, trialEndedAt, trialFor, type StoredPlan } from "@/lib/plan";
import { isAdminEmail } from "@/lib/services/auth";

/**
 * Plan limits. Free has a few cover letters, answers, written emails and full autofills each day, and
 * FREE_UNLOCKS_PER_DAY unlocks: the best person at a company, each at a different company, whatever credits it has
 * (the trial spends its credits on whole lists); Pro's writing has no limit, only a hidden monthly guard (PRO_AI_LIMIT)
 * against scripts, and its people are PRO_PEOPLE_LIMIT companies a month, which the student sees. Days, weeks (from Monday) and months are counted in Eastern time, so they turn over at midnight
 * for most students.
 * Accounts listed in UNLIMITED_CREDIT_EMAILS (comma-separated, set in Vercel) never run out of credits and
 * aren't charged them, but keep their plan, so a Free account still sees every Free limit.
 */

/** Writing and autofill, which Free counts by the day. */
export type UsageKind = keyof typeof FREE_LIMITS;
/** Everything counted: people too, which Free counts by the day and paid plans by the month. */
export type CountedKind = UsageKind | "people" | "companies";

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

/** Admins only, on their own account: today's Free counts start over (letters, answers, fills, emails, unlocks), for testing Free. */
export async function resetTodayUses(userId: string) {
  const user = await repo.getUserById(userId);
  if (!user || !(await isAdminEmail(user))) throw new ServiceError("Only admins can reset counts.", "forbidden", 403);
  const stored = await applicationProfiles.get(userId);
  if (!stored?.uses) return { reset: true };
  await applicationProfiles.put(userId, { ...stored, uses: { ...stored.uses, day: undefined, daily: undefined, week: undefined, weekly: undefined } });
  return { reset: true };
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
  companies: ["company", "companies"],
};

/** The line for a tool that's run out (or is down to its last one). The count itself is the badge in each box's corner. */
function usesNote(kind: CountedKind, left: number, free: boolean, cap: number) {
  const [one, many] = NAMES[kind];
  if (kind === "people" && free) return left > 0 ? "" : `You've used today's ${FREE_UNLOCKS_PER_DAY} unlocks. Free unlocks ${FREE_UNLOCKS_PER_DAY} people a day, each at a different company. More tomorrow, or Pro finds verified contacts.`;
  if (left > 0) return free && left === 1 && kind !== "people" ? `Only 1 ${one} left today` : "";
  if (!free && kind === "people") return `You've used this month's ${cap} companies. Pro finds people at ${cap} companies a month; more on the 1st.`;
  if (!free) return `That's a lot of ${many} this month (${cap}). More on the 1st, or write to us if you need more sooner.`;
  if (kind === "autofills") return `Today's ${FREE_LIMITS.autofills} full autofills are used. Autofill still fills your basic details; Pro answers the questions too, with no limit.`;
  return `No ${many} left today. More tomorrow, or Pro has no limit.`;
}

/** Free's corner badge for people: "2 of 2 unlocks left today". */
export const unlocksBadge = (left: number) => `${left} of ${FREE_UNLOCKS_PER_DAY} unlocks left today`;

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
    if (shownUnlimited) return { used: 0, left: 999, allowance: 999, credits, paid: true, note: "", badge: "Unlimited", limit: null as number | null, per: null as "today" | "this month" | null };
    if (paid) {
      // Counted apart from "people", so the Free unlocks used earlier in the month don't come out of Pro's.
      const left = Math.max(0, config.proPeopleLimit - monthly("companies"));
      return { used: monthly("companies"), left, allowance: left, credits, paid: true, note: usesNote("people", left, false, config.proPeopleLimit), badge: `${left} of ${config.proPeopleLimit} companies left this month`, limit: config.proPeopleLimit as number | null, per: "this month" as const };
    }
    // Free unlocks FREE_UNLOCKS_PER_DAY people a day, credits or not. The trial spends its credits on whole lists.
    if (free) {
      const left = Math.max(0, FREE_UNLOCKS_PER_DAY - daily("people"));
      return { used: daily("people"), left, allowance: FREE_UNLOCKS_PER_DAY, credits, paid: false, note: usesNote("people", left, true, FREE_UNLOCKS_PER_DAY), badge: unlocksBadge(left), limit: FREE_UNLOCKS_PER_DAY as number | null, per: "today" as const };
    }
    return { used: weekly("people"), left: credits, allowance: 0, credits, paid: false, note: "", badge: credits ? `${credits} left` : "1 person per job", limit: null, per: null };
  })();
  const writing = free ? letters.left * CREDIT_COST.letters + answers.left * CREDIT_COST.answers + emails.left * CREDIT_COST.emails : 0;
  return {
    free, plan: state.plan, preview: state.preview, trial: state.trial, trialEnded: state.trialEnded,
    unlimited: shownUnlimited || paid,
    credits: shownUnlimited || paid ? null : writing + people.left * CREDIT_COST.people,
    letters, answers, autofills, emails, people,
  };
}

/** How people are paid for: Pro's plan (or one of Free's daily unlocks), or a credit from the trial or a pack. Null: none left. */
export type PeopleWay = "unlimited" | "plan" | "credit";

export async function peopleAccess(userId: string): Promise<PeopleWay | null> {
  if (await hasUnlimitedCredits(userId)) return "unlimited";
  const { people } = await planUsage(userId);
  if (people.paid) return people.left > 0 ? "plan" : null;
  // Free: one of today's unlocks (one person, never a whole list), even with credits left over from the trial.
  if ((await planState(userId)).free) return people.left > 0 ? "plan" : null;
  return people.credits > 0 ? "credit" : null;
}

/** A company's people were found with an email: counts it, or spends the credit. False when the credit was gone. */
export async function spendPeople(userId: string, way: PeopleWay, key: string, note: string) {
  if (way === "unlimited") return true;
  if (way === "credit") return !(await repo.spendCredits({ userId, amount: 1, idempotencyKey: key, note, entryType: "unlock_debit" })).insufficient;
  await countUse(userId, "people");
  if (!(await planState(userId)).free) await countUse(userId, "companies");
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

/** This week's counts (from Monday, Eastern time): cover letters written, and the rest. */
export async function weekUses(userId: string): Promise<UsageCounts> {
  const uses = (await applicationProfiles.get(userId))?.uses;
  return uses?.week === weekKey() ? uses.weekly ?? {} : {};
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
