import { FREE_COVER_LETTERS } from "@/lib/config";
import { repo } from "@/lib/db/file-store";
import { ServiceError } from "@/lib/errors";
import { applicationProfiles } from "@/lib/apply/store";

/**
 * Plan limits beyond credits. Free writes FREE_COVER_LETTERS cover letters a month; paid plans have no limit.
 * Accounts listed in UNLIMITED_CREDIT_EMAILS (comma-separated, set in Vercel) never run out of credits and
 * aren't charged them, but keep their plan, so a Free account still sees every Free limit.
 */

export { FREE_COVER_LETTERS };

export async function hasUnlimitedCredits(userId: string) {
  const list = (process.env.UNLIMITED_CREDIT_EMAILS || "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (!list.length) return false;
  const user = await repo.getUserById(userId);
  return Boolean(user && list.includes(user.email.trim().toLowerCase()));
}

const thisMonth = () => new Date().toISOString().slice(0, 7);

/** Cover letters written this month, and how many Free has left (null: no limit). */
export async function coverLettersLeft(userId: string) {
  const [account, stored] = await Promise.all([repo.getAccount(userId), applicationProfiles.get(userId)]);
  if (account && account.plan !== "free") return { used: 0, left: null as number | null };
  const used = stored?.letters?.month === thisMonth() ? stored.letters.count : 0;
  return { used, left: Math.max(0, FREE_COVER_LETTERS - used) };
}

/** Before writing a cover letter: Free stops at its monthly number. */
export async function assertCoverLetterAllowed(userId: string) {
  const { left } = await coverLettersLeft(userId);
  if (left === 0) throw new ServiceError(`Free writes ${FREE_COVER_LETTERS} cover letters a month. Pro has no limit.`, "letters", 402);
}

/** After a cover letter is written: one more this month. Edits the student types themselves don't count. */
export async function countCoverLetter(userId: string) {
  const stored = await applicationProfiles.get(userId);
  if (!stored) return;
  const month = thisMonth();
  const count = stored.letters?.month === month ? stored.letters.count + 1 : 1;
  await applicationProfiles.put(userId, { ...stored, letters: { month, count } });
}
