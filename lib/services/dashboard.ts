import { repo } from "@/lib/db/file-store";
import { outreachSummary } from "@/lib/services/outreach";

export async function dashboard(userId: string) {
  const user = await repo.getUserById(userId);
  const profile = await repo.getProfile(userId);
  const goals = await repo.getGoals(userId);
  const resume = await repo.getLatestResume(userId);
  const account = await repo.getAccount(userId);
  const detailed = await repo.listSavedDetailed(userId);
  const messages = await repo.listMessages(userId);
  const followups = (await repo.listFollowUps(userId)).filter((item) => item.status === "open");
  const summary = outreachSummary(
    messages,
    detailed.length,
    detailed.map((item) => item.saved.status),
  );
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const dayIso = startOfDay.toISOString();
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const steps = {
    resume: Boolean(resume),
    goals: Boolean(goals && (goals.roles.length || goals.industries.length || goals.locations.length)),
    contacts: detailed.length > 0,
    outreach: summary.confirmedSends + summary.demoOutbox > 0,
  };
  const completed = Object.values(steps).filter(Boolean).length;
  return {
    user: user ? { id: user.id, name: user.name, email: user.email, referralCode: user.referralCode, onboardingStep: user.onboardingStep } : null,
    profile,
    goals,
    resume: resume ? { id: resume.id, fileName: resume.fileName, byteSize: resume.byteSize, createdAt: resume.createdAt } : null,
    credits: account,
    summary,
    deltas: {
      contactsToday: detailed.filter((item) => item.saved.unlockedAt >= dayIso).length,
      sendsToday: messages.filter((message) => message.deliveryConfirmed && (message.sentAt ?? "") >= dayIso).length,
      repliesToday: detailed.filter((item) => ["replied", "interested", "interview_scheduled"].includes(item.saved.status) && item.saved.updatedAt >= dayIso).length,
    },
    contactsThisWeek: detailed.filter((item) => item.saved.unlockedAt >= weekAgo).length,
    steps,
    completedSteps: completed,
    recent: detailed
      .sort((a, b) => b.saved.updatedAt.localeCompare(a.saved.updatedAt))
      .slice(0, 5)
      .map((item) => ({ saved: item.saved, contact: item.contact })),
    followups,
  };
}
