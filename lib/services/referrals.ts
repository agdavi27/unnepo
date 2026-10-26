import { serverConfig } from "@/lib/config";
import { id, nowIso, repo } from "@/lib/db/file-store";
import { ServiceError } from "@/lib/errors";

export async function applyReferralCode(userId: string, rawCode: string) {
  const code = rawCode.trim().toUpperCase();
  if (!code) throw new ServiceError("Enter a referral code.", "referral");
  const user = await repo.getUserById(userId);
  if (!user) throw new ServiceError("Sign in again.", "auth", 401);
  if (user.referredByUserId) return { applied: false, message: "A referral code is already on this account." };
  const referrer = await repo.getUserByReferralCode(code);
  if (!referrer) throw new ServiceError("That referral code was not found.", "referral", 404);
  if (referrer.id === user.id || referrer.emailNormalized === user.emailNormalized) {
    throw new ServiceError("You cannot use your own referral code.", "self_referral");
  }
  await repo.updateUser(user.id, { referredByUserId: referrer.id });
  const reward = await rewardReferralIfEligible(user.id);
  const credits = serverConfig().referralCredits;
  return {
    applied: true,
    message: reward.rewarded ? `Code applied. Your friend receives ${credits} credits.` : "Code saved on your account.",
  };
}

export async function rewardReferralIfEligible(referredUserId: string) {
  const user = await repo.getUserById(referredUserId);
  if (!user?.schoolEmailVerifiedAt) return { rewarded: false, reason: "unverified" };
  if (!user.referredByUserId) return { rewarded: false, reason: "none" };
  if (user.referredByUserId === user.id) return { rewarded: false, reason: "self" };
  const referrer = await repo.getUserById(user.referredByUserId);
  if (!referrer) return { rewarded: false, reason: "missing" };
  if (referrer.emailNormalized === user.emailNormalized) return { rewarded: false, reason: "self" };

  const existing = await repo.getReferralByReferred(user.id);
  if (existing?.status === "rewarded") return { rewarded: false, reason: "duplicate" };
  if (existing?.status === "rejected") return { rewarded: false, reason: existing.reason ?? "rejected" };
  if (!existing) {
    await repo.insertReferral({
      id: id(),
      referrerId: referrer.id,
      referredUserId: user.id,
      code: referrer.referralCode,
      status: "pending",
      reason: null,
      createdAt: nowIso(),
      rewardedAt: null,
    });
  }

  const config = serverConfig();
  const rewards = await repo.listReferralsByReferrer(referrer.id);
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const today = rewards.filter((item) => item.status === "rewarded" && item.rewardedAt && item.rewardedAt >= start.toISOString());
  if (today.length >= config.referralDailyCap) {
    await repo.updateReferral(user.id, { status: "rejected", reason: "daily_cap" });
    await repo.insertAudit({ userId: referrer.id, action: "referral_rejected", metadata: { reason: "daily_cap" } });
    return { rewarded: false, reason: "daily_cap" };
  }

  const grant = await repo.grantCreditsOnce({
    userId: referrer.id,
    entryType: "referral_reward",
    amount: config.referralCredits,
    bucket: "allowance",
    idempotencyKey: `referral:${user.id}`,
    referenceType: "referral",
    referenceId: user.id,
    note: "Qualified referral",
  });
  await repo.updateReferral(user.id, { status: "rewarded", rewardedAt: nowIso(), reason: null });
  await repo.insertAudit({ userId: referrer.id, action: "referral_rewarded", metadata: { referredUserId: user.id, granted: grant.granted } });
  return { rewarded: grant.granted, amount: grant.granted ? config.referralCredits : 0 };
}
