import { serverConfig } from "@/lib/config";
import { repo } from "@/lib/db/file-store";
import type { CreditAccount } from "@/lib/db/types";
import { ServiceError } from "@/lib/errors";
import { effectivePlan } from "@/lib/plan";

const PAID = new Set(["pro", "premium", "grind", "pack"]);

export function aiMonthlyLimit(plan: CreditAccount["plan"] | string | undefined) {
  const config = serverConfig();
  if (plan === "premium") return config.premiumAiLimit;
  if (plan && PAID.has(plan)) return config.proAiLimit;
  return 0;
}

export async function assertAiAllowed(userId: string, purpose: string) {
  const [account, user] = await Promise.all([repo.getAccount(userId), repo.getUserById(userId)]);
  // The Pro trial counts as Pro.
  const plan = effectivePlan(account?.plan, user?.createdAt);
  const limit = aiMonthlyLimit(plan);
  if (limit <= 0) {
    throw new ServiceError("AI writing is included with Pro. You can still write and send the email yourself.", "plan", 402);
  }
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const used = (await repo.listGenerations(userId, start.toISOString())).filter((item) => item.purpose === "email" || item.purpose === "cover_letter" || item.purpose === "follow_up");
  if (used.length >= limit) {
    throw new ServiceError(`You've used ${limit} AI drafts this month. The counter resets next month.`, "ai_limit", 429);
  }
  return { plan, purpose, remaining: limit - used.length };
}
