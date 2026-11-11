import { applications } from "@/lib/apply/store";
import { isApplied } from "@/lib/apply/stats";
import { id, nowIso, repo, withLock } from "@/lib/db/file-store";
import type { Friendship } from "@/lib/db/types";
import { appOrigin, sendFriendInviteEmail } from "@/lib/email/transactional";
import { ServiceError } from "@/lib/errors";
import { normalizeEmail } from "@/lib/schools";

/**
 * Friends: a student adds a friend by email, and once the friend accepts, each sees how many jobs the other
 * applied to this week on their Week tab. Only that count is shared. A request can go to an email with no
 * account yet; it waits until someone signs up with that email.
 */

export const MAX_FRIENDS = 50;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const involves = (row: Friendship, userId: string, email: string) => row.fromUserId === userId || row.toUserId === userId || (!row.toUserId && row.toEmail === email);
const otherOf = (row: Friendship, userId: string) => (row.fromUserId === userId ? row.toUserId : row.fromUserId);
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
    const [other, applied] = await Promise.all([repo.getUserById(otherId), appliedSince(otherId, since).catch(() => 0)]);
    return other && !other.deletedAt ? { id: row.id, name: shownName(other), applied } : null;
  }));
  const incoming = await Promise.all(rows.filter((row) => row.status === "pending" && row.toUserId === userId).map(async (row) => {
    const from = await repo.getUserById(row.fromUserId);
    return from && !from.deletedAt ? { id: row.id, name: shownName(from), email: from.email } : null;
  }));
  const outgoing = rows.filter((row) => row.status === "pending" && row.fromUserId === userId).map((row) => ({ id: row.id, email: row.toEmail }));
  return {
    friends: friends.filter((friend) => friend !== null).sort((a, b) => b.applied - a.applied || a.name.localeCompare(b.name)),
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
  let emailed = false;
  if (result.status === "sent") emailed = await sendFriendInviteEmail(typed, shownName(user), `${appOrigin()}/signup`).catch(() => false);
  return { ok: true, status: result.status, emailed };
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
