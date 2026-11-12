import { CREDIT_COST, FREE_LIMITS, FREE_PEOPLE, PUBLIC_PLANS, serverConfig } from "@/lib/config";
import { repo } from "@/lib/db/file-store";
import { ServiceError } from "@/lib/errors";
import { applicationProfiles } from "@/lib/apply/store";
import { effectivePlan, trialEndedAt, trialFor, type StoredPlan } from "@/lib/plan";
import { isAdminEmail } from "@/lib/services/auth";

/**
 * Plan limits beyond people searches. Free has a one-time allowance of each; paid plans have a monthly fair-use cap.
 * Accounts listed in UNLIMITED_CREDIT_EMAILS (comma-separated, set in Vercel) never run out of credits and
 * aren't charged them, but keep their plan, so a Free account still sees every Free limit.
 */

export type UsageKind = keyof typeof FREE_LIMITS;

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

const thisMonth = () => new Date().toISOString().slice(0, 7);

const NAMES: Record<UsageKind | "people", [string, string]> = {
  letters: ["cover letter", "cover letters"],
  answers: ["chat answer", "chat answers"],
  autofills: ["autofill", "autofills"],
  people: ["people search", "people searches"],
};

/** "Only 2 autofills left": empty until the number is worth a mention. Free's low point is a few uses; a paid cap's is 20. */
function usesNote(kind: UsageKind | "people", left: number, free: boolean, cap: number) {
  const [one, many] = NAMES[kind];
  if (left <= 0) {
    if (kind === "people") return free ? `Free shows who works there. Pro shows their names and emails, ${PUBLIC_PLANS[1].credits} companies a month.` : `No ${many} left until your plan renews.`;
    return free ? `No ${many} left. Pro has no limit.` : `You've used this month's ${cap} ${many}. More next month.`;
  }
  const low = kind === "people" ? (free ? 2 : 5) : free ? (kind === "letters" ? 2 : 3) : 20;
  return left <= low ? `Only ${left} ${left === 1 ? one : many} left` : "";
}

/** What the student has left on their plan, in uses and in credits, and the line to show for anything running low. */
export async function planUsage(userId: string) {
  const [state, stored, unlimited] = await Promise.all([planState(userId), applicationProfiles.get(userId), hasUnlimitedCredits(userId)]);
  const { account, free } = state;
  // Previewing Free shows Free's notes; credits still aren't charged (reveals read the real setting).
  const shownUnlimited = unlimited && state.preview !== "free";
  const config = serverConfig();
  const fairUse = state.plan === "premium" ? config.premiumAiLimit : config.proAiLimit;
  const uses = stored?.uses;
  const count = (kind: UsageKind) => (free ? uses?.total?.[kind] : uses?.month === thisMonth() ? uses.monthly?.[kind] : 0) ?? 0;
  const one = (kind: UsageKind) => {
    const limit = free ? FREE_LIMITS[kind] : fairUse;
    const left = Math.max(0, limit - count(kind));
    return { used: count(kind), limit, left, note: usesNote(kind, left, free, limit) };
  };
  const [letters, answers] = [one("letters"), one("answers")];
  // Free fills the basic fields (no AI), with no limit; the AI answers to a form's questions are for Pro.
  const autofills = free ? { used: count("autofills"), limit: 0, left: 0, note: "", basic: true } : { ...one("autofills"), basic: false };
  const peopleLeft = account?.balance ?? (free ? FREE_PEOPLE : 0);
  const people = { left: peopleLeft, note: shownUnlimited ? "" : usesNote("people", peopleLeft, free, 0) };
  const writing = free ? letters.left * CREDIT_COST.letters + answers.left * CREDIT_COST.answers : 0;
  return { free, plan: state.plan, preview: state.preview, trial: state.trial, trialEnded: state.trialEnded, unlimited: shownUnlimited, credits: shownUnlimited ? null : writing + peopleLeft * CREDIT_COST.people, letters, answers, autofills, people };
}

/** Before an AI use: stops at the plan's number. */
export async function assertUseAllowed(userId: string, kind: UsageKind) {
  const usage = await planUsage(userId);
  // Free's autofill is the basic fields, which has no limit.
  if (kind === "autofills" && usage.autofills.basic) return;
  if (usage[kind].left === 0) throw new ServiceError(usage[kind].note, kind, usage.free ? 402 : 429);
}

/** After a use that worked: one more. Edits the student types themselves don't count. */
export async function countUse(userId: string, kind: UsageKind) {
  const stored = await applicationProfiles.get(userId);
  if (!stored) return;
  const month = thisMonth();
  const uses = stored.uses;
  const monthly = uses?.month === month ? uses.monthly : {};
  await applicationProfiles.put(userId, { ...stored, uses: {
    total: { ...uses?.total, [kind]: (uses?.total?.[kind] ?? 0) + 1 },
    month,
    monthly: { ...monthly, [kind]: (monthly[kind] ?? 0) + 1 },
  } });
}

/** Cover letters used, and how many Free has left (null: a paid plan, nothing to count down). */
export async function coverLettersLeft(userId: string) {
  const usage = await planUsage(userId);
  return { used: usage.letters.used, left: usage.free ? usage.letters.left : (null as number | null) };
}

export const assertCoverLetterAllowed = (userId: string) => assertUseAllowed(userId, "letters");
export const countCoverLetter = (userId: string) => countUse(userId, "letters");
