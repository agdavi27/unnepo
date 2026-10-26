import { repo } from "@/lib/db/file-store";

/** Reminders stay on the dashboard. Nothing is sent from this job. */
export async function processDueFollowUps() {
  const followups = await repo.listFollowUps();
  const due = followups.filter((item) => item.status === "open" && item.dueAt <= new Date().toISOString());
  for (const item of due) {
    if (!item.autoSend) continue;
    await repo.updateFollowUp(item.userId, item.id, { autoSend: false, note: "Reminder only. Unnepo does not send follow-ups for you." });
  }
  return { processed: 0, reminders: due.length };
}
