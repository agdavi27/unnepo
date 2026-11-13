import { applications } from "@/lib/apply/store";
import { weekUses } from "@/lib/apply/limits";
import { isApplied } from "@/lib/apply/stats";
import { id, nowIso, repo, withLock } from "@/lib/db/file-store";
import type { Friendship } from "@/lib/db/types";
import { appOrigin, sendFriendInviteEmail } from "@/lib/email/transactional";
import { ServiceError } from "@/lib/errors";
import { normalizeEmail } from "@/lib/schools";
import { isAdminEmail } from "@/lib/services/auth";

/**
 * Friends: a student adds a friend by email, and once the friend accepts, each sees what the other did this week:
 * jobs applied to, emails and follow-ups sent, cover letters written, replies and interviews, as counts and points.
 * Never who they emailed or where they applied. A request can go to an email with no account yet; it waits until
 * someone signs up with that email.
 */

export const MAX_FRIENDS = 50;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const involves = (row: Friendship, userId: string, email: string) => row.fromUserId === userId || row.toUserId === userId || (!row.toUserId && row.toEmail === email);
const otherOf = (row: Friendship, userId: string) => (row.fromUserId === userId ? row.toUserId : row.fromUserId);
/** What each thing done this week is worth against a friend: reaching out and hearing back count the most. */
export const POINTS = { applied: 3, emails: 2, followUps: 2, letters: 1, replies: 5, interviews: 10 } as const;
export type WeekStats = Record<keyof typeof POINTS, number>;
export const pointsOf = (stats: WeekStats) => (Object.keys(POINTS) as Array<keyof typeof POINTS>).reduce((sum, key) => sum + stats[key] * POINTS[key], 0);

/** One student's week since `since`. Cover letters count from Monday (Eastern), as Free's limits do. */
async function weekStats(userId: string, since: number): Promise<WeekStats> {
  const [apps, uses] = await Promise.all([applications.list(userId), weekUses(userId)]);
  const after = (at: string | null | undefined) => Boolean(at) && Date.parse(at!) >= since;
  const stats: WeekStats = { applied: 0, emails: 0, followUps: 0, letters: uses.letters ?? 0, replies: 0, interviews: 0 };
  for (const app of apps) {
    const report = app.fillReport;
    if (isApplied(app.status) && !report?.notCounted && after(app.submittedAt ?? app.createdAt)) stats.applied += 1;
    if ((report?.statusHistory ?? []).some((change) => change.status === "interviewing" && after(change.at))) stats.interviews += 1;
    const log = report?.outreachLog ?? [];
    for (const entry of log) {
      if (!after(entry.at)) continue;
      if (entry.kind === "email") stats.emails += 1;
      else if (entry.kind === "follow_up") stats.followUps += 1;
      else stats.replies += 1;
    }
    // Emails marked sent before the log existed still count, once each.
    for (const [contactId, at] of Object.entries(report?.emailedAt ?? {})) {
      if (after(at) && !log.some((entry) => entry.contactId === contactId)) stats.emails += 1;
    }
  }
  return stats;
}

/** A made-up friend admins see, to check what competing with a friend looks like. Never a real account. */
export const DEMO_FRIEND_ID = "demo-brody";
function demoFriend(since: number) {
  // Climbs through the week: a couple of applications by Monday night, about 2 a day after that.
  const days = Math.max(0, (Date.now() - since) / 86_400_000);
  const stats: WeekStats = { applied: 2 + Math.floor(days * 1.8), emails: 1 + Math.floor(days * 1.3), followUps: Math.floor(days * 0.5), letters: 1 + Math.floor(days * 0.8), replies: Math.floor(days / 3), interviews: days >= 4 ? 1 : 0 };
  return { id: DEMO_FRIEND_ID, name: "Brody", applied: stats.applied, stats, points: pointsOf(stats) };
}

const shownName = (user: { name: string; email: string } | null) => user?.name?.trim() || user?.email.split("@")[0] || "A friend";

async function me(userId: string) {
  const user = await repo.getUserById(userId);
  if (!user || user.deletedAt) throw new ServiceError("Sign in again.", "unauthorized", 401);
  return user;
}

/** Applications that count toward goals since `since`. */
async function appliedSince(userId: string, since: number) {
  const times = await applications.appliedTimes(userId);
  return times.filter((app) => isApplied(app.status) && !app.notCounted && Date.parse(app.submittedAt ?? app.createdAt) >= since).length;
}

/**
 * Friends with how many they applied to since `since` (the start of the student's week, from their own clock),
 * requests waiting on the student, and the ones they sent. Requests sent to their email before they had an
 * account are claimed here.
 */
export async function listFriends(userId: string, sinceRaw: unknown) {
  const user = await me(userId);
  const email = user.emailNormalized;
  const parsed = Date.parse(String(sinceRaw ?? ""));
  // Up to eight days back: a week, from any time zone.
  const since = Number.isFinite(parsed) && parsed > Date.now() - 8 * 86_400_000 ? parsed : Date.now() - 7 * 86_400_000;
  const rows = await withLock((db) => {
    const mine = (db.friendships ?? []).filter((row) => involves(row, userId, email));
    for (const row of mine) if (!row.toUserId && row.toEmail === email) row.toUserId = userId;
    return mine;
  });
  const accepted = rows.filter((row) => row.status === "accepted");
  const friends = await Promise.all(accepted.map(async (row) => {
    const otherId = otherOf(row, userId)!;
    const [other, stats] = await Promise.all([repo.getUserById(otherId), weekStats(otherId, since).catch(() => null)]);
    const week = stats ?? { applied: await appliedSince(otherId, since).catch(() => 0), emails: 0, followUps: 0, letters: 0, replies: 0, interviews: 0 };
    return other && !other.deletedAt ? { id: row.id, name: shownName(other), applied: week.applied, stats: week, points: pointsOf(week) } : null;
  }));
  const incoming = await Promise.all(rows.filter((row) => row.status === "pending" && row.toUserId === userId).map(async (row) => {
    const from = await repo.getUserById(row.fromUserId);
    return from && !from.deletedAt ? { id: row.id, name: shownName(from), email: from.email } : null;
  }));
  const outgoing = rows.filter((row) => row.status === "pending" && row.fromUserId === userId).map((row) => ({ id: row.id, email: row.toEmail }));
  const demo = (await isAdminEmail(user)) ? [demoFriend(since)] : [];
  const mine = await weekStats(userId, since).catch((): WeekStats => ({ applied: 0, emails: 0, followUps: 0, letters: 0, replies: 0, interviews: 0 }));
  return {
    me: { stats: mine, points: pointsOf(mine) },
    points: POINTS,
    friends: [...friends.filter((friend) => friend !== null), ...demo].sort((a, b) => b.applied - a.applied || a.name.localeCompare(b.name)),
    incoming: incoming.filter((item) => item !== null),
    outgoing,
  };
}

/** Sends a friend request to an email. If that person already asked, it's accepted instead. */
export async function inviteFriend(userId: string, emailRaw: unknown) {
  const user = await me(userId);
  const typed = String(emailRaw ?? "").trim().slice(0, 200);
  if (!EMAIL.test(typed)) throw new ServiceError("That doesn't look like an email.", "invalid_email", 400);
  const toEmail = normalizeEmail(typed);
  if (toEmail === user.emailNormalized) throw new ServiceError("That's your own email.", "self", 400);
  const target = await repo.getUserByEmail(toEmail);
  const toUserId = target && !target.deletedAt ? target.id : null;
  const result = await withLock((db) => {
    db.friendships ??= [];
    const mine = db.friendships.filter((row) => involves(row, userId, user.emailNormalized));
    const existing = mine.find((row) => row.toEmail === toEmail || (toUserId && (row.fromUserId === toUserId || row.toUserId === toUserId)));
    if (existing) {
      // They asked first: saying yes back is accepting.
      if (existing.status === "pending" && existing.fromUserId !== userId) {
        existing.status = "accepted";
        existing.acceptedAt = nowIso();
        existing.toUserId = userId;
        return { status: "accepted" as const, row: existing };
      }
      return { status: existing.status === "accepted" ? ("already" as const) : ("waiting" as const), row: existing };
    }
    if (mine.filter((row) => row.status === "accepted").length >= MAX_FRIENDS) throw new ServiceError(`You can have up to ${MAX_FRIENDS} friends.`, "too_many", 400);
    const row: Friendship = { id: id(), fromUserId: userId, toEmail, toUserId, status: "pending", createdAt: nowIso(), acceptedAt: null };
    db.friendships.push(row);
    return { status: "sent" as const, row };
  });
  // A new request is emailed. So is one still waiting whose email never went out (email wasn't set up yet, or it
  // failed): adding them again tries once more.
  let emailed = false;
  const ours = result.row.fromUserId === userId;
  if (result.status === "sent" || (result.status === "waiting" && ours && !result.row.emailedAt)) {
    const appliedThisWeek = await appliedSince(userId, Date.now() - 7 * 86_400_000).catch(() => 0);
    emailed = await sendFriendInviteEmail({ to: typed, fromName: shownName(user), appliedThisWeek, hasAccount: Boolean(toUserId), origin: appOrigin() }).catch((error) => {
      console.error("friend_invite_email_failed", error);
      return false;
    });
    if (emailed) {
      await withLock((db) => {
        const row = (db.friendships ?? []).find((item) => item.id === result.row.id);
        if (row) row.emailedAt = nowIso();
      });
    } else console.error("friend_invite_email_not_sent", { resend: Boolean(process.env.RESEND_API_KEY) });
  }
  return { ok: true, status: result.status, emailed: emailed || Boolean(result.row.emailedAt) };
}

/** Accepts or declines a request sent to the student. Declining deletes it; the sender isn't told. */
export async function respondToFriend(userId: string, friendshipId: unknown, accept: unknown) {
  const user = await me(userId);
  return withLock((db) => {
    const row = (db.friendships ?? []).find((item) => item.id === friendshipId && item.status === "pending" && (item.toUserId === userId || (!item.toUserId && item.toEmail === user.emailNormalized)));
    if (!row) throw new ServiceError("That request is gone.", "not_found", 404);
    if (accept === true) {
      row.status = "accepted";
      row.acceptedAt = nowIso();
      row.toUserId = userId;
    } else db.friendships = db.friendships!.filter((item) => item.id !== row.id);
    return { ok: true };
  });
}

/** Removes a friend, or cancels a request the student sent. */
export async function removeFriend(userId: string, friendshipId: unknown) {
  if (friendshipId === DEMO_FRIEND_ID) return { ok: true };
  await me(userId);
  return withLock((db) => {
    const before = (db.friendships ?? []).length;
    db.friendships = (db.friendships ?? []).filter((item) => !(item.id === friendshipId && (item.fromUserId === userId || item.toUserId === userId)));
    if (db.friendships.length === before) throw new ServiceError("That friend is already gone.", "not_found", 404);
    return { ok: true };
  });
}

/** One entry point for the extension's POST: invite, respond or remove. */
export async function friendAction(userId: string, raw: unknown) {
  const body = (raw ?? {}) as { action?: unknown; email?: unknown; id?: unknown; accept?: unknown };
  if (body.action === "invite") return inviteFriend(userId, body.email);
  if (body.action === "respond") return respondToFriend(userId, body.id, body.accept);
  if (body.action === "remove") return removeFriend(userId, body.id);
  throw new ServiceError("Unknown friend action.", "bad_request", 400);
}
