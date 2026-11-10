import { htmlToText } from "@/lib/apply/extract";
import { id, nowIso, persistenceMode, repo, withLock } from "@/lib/db/file-store";
import { supabaseTables } from "@/lib/db/remote";
import { ServiceError } from "@/lib/errors";
import { gmailFilterQuery, type InboundEmail } from "@/lib/email/filter";
import { processEmail } from "@/lib/email/process";
import type { GmailConnection } from "@/lib/email/types";
import { decryptSecret, encryptSecret, randomToken } from "@/lib/security";
import { envValue } from "@/lib/services/oauth";
import { integrations } from "@/lib/integrations/flags";

/**
 * Connected Gmail: the student says yes once on Google's screen, and Unnepo reads their job emails on its own,
 * with no forwarding to set up. Only emails that match the job search (gmailFilterQuery) are fetched; each goes
 * through processEmail like a forwarded one. Access is read-only (gmail.readonly), and the refresh token is kept
 * encrypted. Runs when the student opens the Email tracking page and on a schedule (/api/cron/gmail).
 *
 * Gmail's own OAuth client can be set apart from sign-in (GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET), so sign-in can
 * be on a published Google app while Gmail stays on one in testing. Without them, the Google sign-in client is used.
 */

const SCOPE = "openid email https://www.googleapis.com/auth/gmail.readonly";
/** How far back the first check looks, and how many emails one check reads at most (each may be an AI call). */
const FIRST_DAYS = 30;
const PER_SYNC = 25;
/** The Email tracking page checks Gmail when it's been this long; the schedule covers the rest. */
const STALE_MS = 3 * 60_000;

function client() {
  const id = envValue("GMAIL_CLIENT_ID") || envValue("GOOGLE_CLIENT_ID");
  const secret = envValue("GMAIL_CLIENT_SECRET") || envValue("GOOGLE_CLIENT_SECRET");
  return { id, secret };
}

export const gmailReady = () => {
  if (!integrations.gmailConnect) return false;
  const { id, secret } = client();
  return Boolean(id && secret);
};

/**
 * Until Google verifies Unnepo for Gmail, only its test users can connect. GMAIL_BETA_EMAILS lists them
 * (comma-separated); everyone else uses forwarding and never sees the button. "*" opens it to everyone.
 */
export function gmailAllowed(email: string | null | undefined) {
  const list = envValue("GMAIL_BETA_EMAILS").split(/[\s,]+/).map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (list.includes("*")) return true;
  return Boolean(email && list.includes(email.trim().toLowerCase()));
}

async function allowedFor(userId: string) {
  const user = await repo.getUserById(userId).catch(() => null);
  return gmailAllowed(user?.email);
}

const redirectUri = (origin: string) => `${origin.replace(/\/$/, "")}/api/oauth/gmail/callback`;

// ---------- storage: the gmail_connections table (0008) in production, the local data file otherwise ----------

const onTables = () => persistenceMode() === "supabase";
const HINT = "The Gmail table is missing. Run supabase/migrations/0008_gmail_connections.sql in the Supabase SQL editor.";
function tableError(error: { code?: string; message?: string } | null) {
  if (error && (error.code === "42P01" || error.code === "PGRST205" || /does not exist|schema cache/i.test(error.message || ""))) return new ServiceError(HINT, "database", 500);
  return new ServiceError(error?.message || "Could not reach the database.", "database", 500);
}
type Row = { user_id: string; email: string; refresh_token: string; status: string; last_synced_at: string | null; last_error: string | null; created_at: string };
const fromRow = (row: Row): GmailConnection => ({
  userId: row.user_id, email: row.email, refreshToken: row.refresh_token, status: row.status === "expired" ? "expired" : "active",
  lastSyncedAt: row.last_synced_at, lastError: row.last_error, createdAt: row.created_at,
});
const toRow = (item: GmailConnection): Row => ({
  user_id: item.userId, email: item.email, refresh_token: item.refreshToken, status: item.status,
  last_synced_at: item.lastSyncedAt, last_error: item.lastError, created_at: item.createdAt,
});

export const gmailConnections = {
  async get(userId: string): Promise<GmailConnection | null> {
    if (onTables()) {
      const { data, error } = await supabaseTables().from("gmail_connections").select("*").eq("user_id", userId).maybeSingle();
      if (error) throw tableError(error);
      return data ? fromRow(data as Row) : null;
    }
    return withLock((db) => (db.gmailConnections ?? []).find((row) => row.userId === userId) ?? null);
  },

  async active(): Promise<GmailConnection[]> {
    if (onTables()) {
      const { data, error } = await supabaseTables().from("gmail_connections").select("*").eq("status", "active").order("last_synced_at", { ascending: true, nullsFirst: true }).limit(500);
      if (error) throw tableError(error);
      return (data ?? []).map((row) => fromRow(row as Row));
    }
    return withLock((db) => (db.gmailConnections ?? []).filter((row) => row.status === "active"));
  },

  async save(item: GmailConnection) {
    if (onTables()) {
      const { error } = await supabaseTables().from("gmail_connections").upsert(toRow(item));
      if (error) throw tableError(error);
      return;
    }
    await withLock((db) => {
      db.gmailConnections = [...(db.gmailConnections ?? []).filter((row) => row.userId !== item.userId), item];
    });
  },

  async update(userId: string, patch: Partial<GmailConnection>) {
    const current = await this.get(userId);
    if (current) await this.save({ ...current, ...patch, userId });
  },

  async remove(userId: string) {
    if (onTables()) {
      const { error } = await supabaseTables().from("gmail_connections").delete().eq("user_id", userId);
      if (error && !/does not exist|schema cache/i.test(error.message || "") && error.code !== "42P01" && error.code !== "PGRST205") throw tableError(error);
      return;
    }
    await withLock((db) => {
      db.gmailConnections = (db.gmailConnections ?? []).filter((row) => row.userId !== userId);
    });
  },
};

// ---------- connecting ----------

/** Google's consent screen, asking for read-only Gmail. Offline access, so Unnepo can check without the student. */
export async function beginGmailConnect(userId: string, origin: string) {
  const { id: clientId } = client();
  if (!gmailReady()) throw new ServiceError("Gmail isn't set up for Unnepo yet.", "oauth_unconfigured", 400);
  if (!(await allowedFor(userId))) throw new ServiceError("Connecting Gmail is in a small beta for now. Forwarding works for everyone.", "gmail_beta", 403);
  const state = randomToken();
  await repo.createOAuthState({
    id: id(), state, provider: "gmail", userId, purpose: "mailbox", redirectOrigin: origin.replace(/\/$/, ""),
    createdAt: nowIso(), expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri(origin));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("state", state);
  url.searchParams.set("access_type", "offline");
  // "consent" every time, so Google always hands back a refresh token.
  url.searchParams.set("prompt", "consent select_account");
  return url.toString();
}

/** Back from Google: keeps the refresh token, encrypted. Only for the student who started it. */
export async function finishGmailConnect(userId: string, code: string, state: string, origin: string) {
  const saved = await repo.consumeOAuthState(state);
  if (!saved || saved.provider !== "gmail" || saved.purpose !== "mailbox" || saved.userId !== userId || Date.parse(saved.expiresAt) < Date.now()) {
    throw new ServiceError("This Gmail connection attempt expired. Try again.", "oauth_state");
  }
  const { id: clientId, secret } = client();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: secret, code, redirect_uri: redirectUri(saved.redirectOrigin || origin), grant_type: "authorization_code" }),
  });
  if (!response.ok) throw new ServiceError("Google didn't accept the connection. Try again.", "oauth_token", 502);
  const tokens = (await response.json()) as { access_token?: string; refresh_token?: string; scope?: string };
  if (!tokens.refresh_token || !tokens.access_token) throw new ServiceError("Google didn't give Unnepo access. Try again.", "oauth_token", 502);
  if (!tokens.scope?.includes("gmail.readonly")) {
    throw new ServiceError("Unnepo needs the box for reading your email ticked on Google's screen. Try again and tick it.", "oauth_scope");
  }
  const profile = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: { Authorization: `Bearer ${tokens.access_token}` } });
  const email = profile.ok ? ((await profile.json()) as { emailAddress?: string }).emailAddress ?? "" : "";
  await gmailConnections.save({ userId, email, refreshToken: encryptSecret(tokens.refresh_token), status: "active", lastSyncedAt: null, lastError: null, createdAt: nowIso() });
  return { email };
}

/** Disconnect: Google is told to forget the access too, and Unnepo forgets the token. */
export async function disconnectGmail(userId: string) {
  const current = await gmailConnections.get(userId).catch(() => null);
  if (current) {
    try {
      await fetch("https://oauth2.googleapis.com/revoke", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: decryptSecret(current.refreshToken) }) });
    } catch {
      // Already gone on Google's side, or the secret changed: forgetting it here is what matters.
    }
  }
  await gmailConnections.remove(userId);
  return { ok: true };
}

// ---------- reading ----------

class Expired extends Error {}

async function accessToken(connection: GmailConnection) {
  const { id: clientId, secret } = client();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: secret, refresh_token: decryptSecret(connection.refreshToken), grant_type: "refresh_token" }),
  });
  if (response.status === 400 || response.status === 401) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    if (body.error === "invalid_grant" || response.status === 401) throw new Expired();
  }
  if (!response.ok) throw new Error(`Google token refresh failed (${response.status}).`);
  return ((await response.json()) as { access_token: string }).access_token;
}

type Part = { mimeType?: string; body?: { data?: string }; parts?: Part[]; headers?: Array<{ name: string; value: string }> };
type Message = { id: string; internalDate?: string; payload?: Part };

const decode = (data?: string) => (data ? Buffer.from(data, "base64url").toString("utf8") : "");

function bodies(part: Part | undefined, found: { text: string; html: string } = { text: "", html: "" }) {
  if (!part) return found;
  if (part.mimeType === "text/plain" && !found.text) found.text = decode(part.body?.data);
  else if (part.mimeType === "text/html" && !found.html) found.html = decode(part.body?.data);
  for (const child of part.parts ?? []) bodies(child, found);
  return found;
}

/** A Gmail message as the email Unnepo reads, the same shape a forwarded one has. */
export function toInbound(message: Message): InboundEmail {
  const header = (name: string) => message.payload?.headers?.find((item) => item.name.toLowerCase() === name)?.value ?? "";
  const { text: plain, html } = bodies(message.payload);
  const fromHtml = html ? htmlToText(html) : "";
  const text = plain.trim().length >= 200 || plain.trim().length >= fromHtml.length ? plain : fromHtml;
  const date = header("date") || (message.internalDate ? new Date(Number(message.internalDate)).toUTCString() : undefined);
  return { from: header("from"), subject: header("subject"), date, text, messageId: header("message-id") || `gmail:${message.id}`, html: html || undefined };
}

const running = new Set<string>();

/** Reads new job emails from one student's Gmail. Each goes through processEmail, which skips any seen before. */
export async function syncGmail(userId: string): Promise<{ read: number; status: GmailConnection["status"] | "none" }> {
  const connection = await gmailConnections.get(userId);
  if (!connection) return { read: 0, status: "none" };
  if (connection.status !== "active" || running.has(userId)) return { read: 0, status: connection.status };
  running.add(userId);
  const started = nowIso();
  try {
    let token: string;
    try {
      token = await accessToken(connection);
    } catch (error) {
      if (error instanceof Expired) {
        await gmailConnections.update(userId, { status: "expired", lastError: "Google stopped Unnepo's access. Connect Gmail again." });
        return { read: 0, status: "expired" };
      }
      throw error;
    }
    // A day of overlap, so an email that arrived late into Gmail is still caught; processEmail skips repeats.
    const since = connection.lastSyncedAt ? Date.parse(connection.lastSyncedAt) - 86_400_000 : Date.now() - FIRST_DAYS * 86_400_000;
    const q = `(${gmailFilterQuery()}) after:${Math.floor(since / 1000)} -in:sent -in:drafts -in:chats`;
    const list = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${new URLSearchParams({ q, maxResults: String(PER_SYNC) })}`, { headers: { Authorization: `Bearer ${token}` } });
    if (list.status === 401 || list.status === 403) {
      await gmailConnections.update(userId, { status: "expired", lastError: "Unnepo can't read this Gmail any more. Connect it again." });
      return { read: 0, status: "expired" };
    }
    if (!list.ok) throw new Error(`Gmail search failed (${list.status}).`);
    const ids = (((await list.json()) as { messages?: Array<{ id: string }> }).messages ?? []).map((item) => item.id);
    let read = 0;
    // Oldest first, so a job's emails land in the order they came.
    for (const messageId of ids.reverse()) {
      const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) continue;
      const outcome = await processEmail(userId, toInbound((await response.json()) as Message), "gmail");
      if (outcome.outcome !== "duplicate") read += 1;
    }
    await gmailConnections.update(userId, { lastSyncedAt: started, lastError: null });
    return { read, status: "active" };
  } catch (error) {
    await gmailConnections.update(userId, { lastError: "Unnepo couldn't check Gmail just now. It'll try again." }).catch(() => undefined);
    console.error("gmail sync failed", error instanceof Error ? error.message : "");
    return { read: 0, status: "active" };
  } finally {
    running.delete(userId);
  }
}

/** Whether the Email tracking page should check Gmail now. */
export const gmailStale = (connection: GmailConnection | null) =>
  Boolean(connection && connection.status === "active" && (!connection.lastSyncedAt || Date.now() - Date.parse(connection.lastSyncedAt) > STALE_MS));

/** The schedule: every connected Gmail, the longest-unchecked first, until the time runs low. */
export async function syncAllGmail(budgetMs = 50_000) {
  const end = Date.now() + budgetMs;
  let checked = 0;
  for (const connection of await gmailConnections.active()) {
    if (Date.now() > end) break;
    await syncGmail(connection.userId);
    checked += 1;
  }
  return { checked };
}

/** What the Email tracking page shows about Gmail. */
export async function gmailState(userId: string) {
  const connection = await gmailConnections.get(userId).catch(() => null);
  return {
    available: gmailReady() && (Boolean(connection) || (await allowedFor(userId))),
    connected: Boolean(connection),
    email: connection?.email ?? null,
    status: connection?.status ?? null,
    lastSyncedAt: connection?.lastSyncedAt ?? null,
    lastError: connection?.lastError ?? null,
  };
}
