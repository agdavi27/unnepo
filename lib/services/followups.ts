import { repo } from "@/lib/db/file-store";
import { runIdempotent } from "@/lib/services/idempotency";
import { sendOutreach } from "@/lib/services/outreach";

export async function processDueFollowUps() {
  const followups = await repo.listFollowUps();
  const due = followups.filter((item) => item.status === "open" && item.autoSend && item.dueAt <= new Date().toISOString());
  const results = [];
  for (const item of due) {
    const result = await runIdempotent(`followup:${item.id}`, async () => {
      const saved = await repo.getSavedById(item.userId, item.savedContactId);
      if (!saved || saved.optOut || !saved.autoFollowUpAuthorized) {
        await repo.updateFollowUp(item.userId, item.id, { status: "cancelled" });
        return { skipped: true };
      }
      const messages = await repo.listMessages(item.userId);
      if (messages.some((message) => message.savedContactId === saved.id && message.direction === "inbound")) {
        await repo.updateFollowUp(item.userId, item.id, { status: "cancelled" });
        return { skipped: true };
      }
      const sent = await sendOutreach(item.userId, {
        savedContactId: saved.id,
        subject: "Following up",
        body: "I wanted to follow up once, as you allowed. If now is not a good time, no need to reply.",
        idempotencyKey: `followup-message:${item.id}`,
        delivery: "provider",
      });
      if (sent.message.deliveryConfirmed) await repo.updateFollowUp(item.userId, item.id, { status: "done" });
      return { delivered: sent.message.deliveryConfirmed };
    }).catch((error: Error) => ({ error: error.message }));
    results.push(result);
  }
  return { processed: results.length };
}
