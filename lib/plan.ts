/**
 * The Pro trial: every new account has Pro for its first TRIAL_DAYS days, with no card, counted from signup.
 * After that a Free account is Free again. Paid plans are never touched. Nothing is stored for it: the account
 * stays "free" and the trial is worked out from when the student signed up, so it ends on its own.
 *
 * No server imports, so the web app and the extension's types can use it too.
 */

export type StoredPlan = "free" | "grind" | "pack" | "pro" | "premium";

/** Where "Get Pro" goes in the web app: the Upgrade to Pro page, beside Settings (Settings and plans once on Pro). */
export const UPGRADE_URL = "/home?tab=pro";

/** Days of Pro a new account gets. TRIAL_DAYS=0 turns the trial off. */
export const trialDays = () => {
  const set = typeof process !== "undefined" ? process.env.TRIAL_DAYS?.trim() : "";
  const raw = set ? Number(set) : NaN;
  return Number.isFinite(raw) && raw >= 0 ? raw : 7;
};

/**
 * Accounts made before the trial began never had one: no Pro, and no "your trial ended". TRIAL_STARTS_AT moves it.
 */
const trialStartsAt = () => {
  const set = typeof process !== "undefined" ? Date.parse(process.env.TRIAL_STARTS_AT ?? "") : NaN;
  return Number.isNaN(set) ? Date.parse("2026-11-07T00:00:00Z") : set;
};

/** When an account's trial starts: its signup, if that's after the trial began. */
function trialStart(signedUpAt: string | undefined) {
  const start = Date.parse(signedUpAt ?? "");
  return Number.isNaN(start) || start < trialStartsAt() ? null : start;
}

export type Trial = { endsAt: string; daysLeft: number; hoursLeft: number };

/** The trial, while it runs: when it ends and how long is left. Null for paid plans and once it's over. */
export function trialFor(plan: StoredPlan | undefined, signedUpAt: string | undefined, now = Date.now()): Trial | null {
  const start = (plan ?? "free") === "free" ? trialStart(signedUpAt) : null;
  if (start === null) return null;
  const ends = start + trialDays() * 86_400_000;
  if (ends <= now) return null;
  const hoursLeft = Math.ceil((ends - now) / 3_600_000);
  return { endsAt: new Date(ends).toISOString(), daysLeft: Math.ceil(hoursLeft / 24), hoursLeft };
}

/** When a Free account's trial ended, if it had one and it's over. */
export function trialEndedAt(plan: StoredPlan | undefined, signedUpAt: string | undefined, now = Date.now()) {
  const start = (plan ?? "free") === "free" && trialDays() ? trialStart(signedUpAt) : null;
  if (start === null) return null;
  const ends = start + trialDays() * 86_400_000;
  return ends > now ? null : new Date(ends).toISOString();
}

/** The plan the account works as: Pro during the trial, otherwise what it's on. */
export function effectivePlan(plan: StoredPlan | undefined, signedUpAt: string | undefined, now = Date.now()): StoredPlan {
  return trialFor(plan, signedUpAt, now) ? "pro" : plan ?? "free";
}

/** "6 days left", "1 day left", "5 hours left". */
export function trialLeftLabel(trial: Pick<Trial, "daysLeft" | "hoursLeft">) {
  if (trial.hoursLeft < 24) return `${trial.hoursLeft} ${trial.hoursLeft === 1 ? "hour" : "hours"} left`;
  return `${trial.daysLeft} ${trial.daysLeft === 1 ? "day" : "days"} left`;
}
