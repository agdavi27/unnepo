import { applicationProfiles } from "@/lib/apply/store";
import { todayUses } from "@/lib/apply/limits";
import { weekStats } from "@/lib/social/friends";
import { ServiceError } from "@/lib/errors";
import { DIFFICULTIES, normalizeGame, type Difficulty, type GameCounts, type GameSettings } from "@/lib/game/boss";

/**
 * Game mode on the server: what the student did today, for the daily boss's XP, and their game settings.
 * Applications, emails and follow-ups count from `since` (the start of the student's day, from their own clock);
 * tailored resumes count by the Eastern day, as the plan's daily counts do.
 */
export async function gameToday(userId: string, sinceRaw: unknown): Promise<{ counts: GameCounts; settings: GameSettings }> {
  const parsed = Date.parse(String(sinceRaw ?? ""));
  // Up to two days back, for any time zone; otherwise the last 24 hours.
  const since = Number.isFinite(parsed) && parsed > Date.now() - 2 * 86_400_000 ? parsed : Date.now() - 86_400_000;
  const [stats, uses, stored] = await Promise.all([weekStats(userId, since), todayUses(userId), applicationProfiles.get(userId)]);
  return {
    counts: { apply: stats.applied, tailor: uses.resumes ?? 0, email: stats.emails, follow: stats.followUps },
    settings: normalizeGame(stored?.game),
  };
}

/** Changes any of the game settings: on, home, panel (true or false) and target (chill, normal or grind). */
export async function saveGame(userId: string, raw: unknown): Promise<{ settings: GameSettings }> {
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const change: Partial<GameSettings> = {};
  for (const key of ["on", "home", "panel"] as const) {
    if (body[key] === undefined) continue;
    if (typeof body[key] !== "boolean") throw new ServiceError("Turn it on or off.", "game", 400);
    change[key] = body[key];
  }
  if (body.target !== undefined) {
    if (!DIFFICULTIES.includes(body.target as Difficulty)) throw new ServiceError("Pick Chill, Normal or Grind.", "game", 400);
    change.target = body.target as Difficulty;
  }
  let settings = normalizeGame(null);
  await applicationProfiles.change(userId, (fresh) => {
    settings = { ...normalizeGame(fresh.game), ...change };
    return { game: settings };
  }, async () => (await (await import("@/lib/apply/service")).student(userId)).profile);
  return { settings };
}
