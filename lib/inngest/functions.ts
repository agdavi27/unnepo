import { Inngest } from "inngest";
import { repo } from "@/lib/db/file-store";
import { runIdempotent } from "@/lib/services/idempotency";
import { syncReplies } from "@/lib/services/outreach";
import { processDueFollowUps } from "@/lib/services/followups";
import { rewardReferralIfEligible } from "@/lib/services/referrals";

export const inngest = new Inngest({ id: "unnepo" });

export const processResume = inngest.createFunction(
  { id: "process-resume", retries: 2, idempotency: "event.data.resumeId", triggers: [{ event: "resume/uploaded" }] },
  async ({ event }) => runIdempotent(`resume-job:${String(event.data.resumeId)}`, async () => ({ resumeId: event.data.resumeId, ok: true })),
);

export const syncMailboxReplies = inngest.createFunction(
  { id: "sync-replies", retries: 2, triggers: [{ cron: "15 * * * *" }] },
  async () => {
    const users = await repo.listUsers();
    let imported = 0;
    for (const user of users) imported += (await syncReplies(user.id)).imported;
    return { imported };
  },
);

export const dispatchFollowUps = inngest.createFunction(
  { id: "dispatch-followups", retries: 2, triggers: [{ cron: "0 15 * * *" }] },
  async () => processDueFollowUps(),
);

export const verifyReferral = inngest.createFunction(
  { id: "verify-referral", retries: 3, idempotency: "event.data.userId", triggers: [{ event: "referral/check" }] },
  async ({ event }) => rewardReferralIfEligible(String(event.data.userId)),
);

export const functions = [processResume, syncMailboxReplies, dispatchFollowUps, verifyReferral];
