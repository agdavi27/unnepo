import { createHash } from "node:crypto";
import { id, nowIso, persistenceMode, withLock } from "@/lib/db/file-store";
import { supabaseTables } from "@/lib/db/remote";
import { ServiceError } from "@/lib/errors";
import { newToken } from "@/lib/email/address";
import { decryptSecret, encryptSecret } from "@/lib/security";
import type { EmailEvent, EmailInbox, EmailText } from "@/lib/email/types";

/**
 * Storage for email tracking: the Supabase tables from supabase/migrations/0006_email_tracking.sql in
 * production, the local data file in local runs and tests.
 */

const HINT = "The email tracking tables are missing. Run supabase/migrations/0006_email_tracking.sql in the Supabase SQL editor.";
const onTables = () => persistenceMode() === "supabase";
function tableError(error: { code?: string; message?: string } | null) {
  if (!error) return new ServiceError("Could not reach the database.", "database", 500);
  if (error.code === "42P01" || error.code === "PGRST205" || /does not exist|schema cache/i.test(error.message || "")) return new ServiceError(HINT, "database", 500);
  return new ServiceError(error.message || "Could not reach the database.", "database", 500);
}

/** A Message-ID, hashed: enough to know an email was seen before, nothing about what it said. */
export const messageKey = (messageId: string) => createHash("sha256").update(messageId.trim().toLowerCase()).digest("hex");

export const emailInboxes = {
  /** The student's active address, made on first use. */
  async forUser(userId: string): Promise<EmailInbox> {
    if (onTables()) {
      const { data, error } = await supabaseTables().from("email_inboxes").select("*").eq("user_id", userId).eq("active", true).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw tableError(error);
      if (data) return { token: data.token, userId: data.user_id, active: data.active, createdAt: data.created_at };
      return this.create(userId);
    }
    const found = await withLock((db) => (db.emailInboxes ?? []).find((row) => row.userId === userId && row.active) ?? null);
    return found ?? this.create(userId);
  },

  async create(userId: string): Promise<EmailInbox> {
    const inbox: EmailInbox = { token: newToken(), userId, active: true, createdAt: nowIso() };
    if (onTables()) {
      const { error } = await supabaseTables().from("email_inboxes").insert({ token: inbox.token, user_id: userId, active: true, created_at: inbox.createdAt });
      if (error) throw tableError(error);
      return inbox;
    }
    return withLock((db) => {
      db.emailInboxes = [...(db.emailInboxes ?? []), inbox];
      return inbox;
    });
  },

  /** A new address; the old one stops working at once. */
  async regenerate(userId: string): Promise<EmailInbox> {
    if (onTables()) {
      const { error } = await supabaseTables().from("email_inboxes").update({ active: false }).eq("user_id", userId);
      if (error) throw tableError(error);
    } else {
      await withLock((db) => {
        for (const row of db.emailInboxes ?? []) if (row.userId === userId) row.active = false;
      });
    }
    return this.create(userId);
  },

  /** The student an address belongs to, if it's active. */
  async byToken(token: string): Promise<EmailInbox | null> {
    if (onTables()) {
      const { data, error } = await supabaseTables().from("email_inboxes").select("*").eq("token", token).eq("active", true).maybeSingle();
      if (error) throw tableError(error);
      return data ? { token: data.token, userId: data.user_id, active: data.active, createdAt: data.created_at } : null;
    }
    return withLock((db) => (db.emailInboxes ?? []).find((row) => row.token === token && row.active) ?? null);
  },
};

type NewEvent = Omit<EmailEvent, "id" | "createdAt">;

export const emailEvents = {
  async seen(userId: string, key: string): Promise<boolean> {
    if (onTables()) {
      const { data, error } = await supabaseTables().from("email_events").select("id").eq("user_id", userId).eq("message_key", key).maybeSingle();
      if (error) throw tableError(error);
      return Boolean(data);
    }
    return withLock((db) => (db.emailEvents ?? []).some((row) => row.userId === userId && row.messageKey === key));
  },

  /** Saves one email's result. False when that email was already saved (the same Message-ID). */
  async add(event: NewEvent): Promise<EmailEvent | null> {
    const full: EmailEvent = { ...event, id: id(), createdAt: nowIso() };
    if (onTables()) {
      const { error } = await supabaseTables().from("email_events").insert({ id: full.id, user_id: full.userId, message_key: full.messageKey, data: full, created_at: full.createdAt });
      if (error?.code === "23505") return null;
      if (error) throw tableError(error);
      return full;
    }
    return withLock((db) => {
      if ((db.emailEvents ?? []).some((row) => row.userId === full.userId && row.messageKey === full.messageKey)) return null;
      db.emailEvents = [...(db.emailEvents ?? []), full];
      return full;
    });
  },

  /** One saved email by its key, however old it is. */
  async byKey(userId: string, key: string): Promise<EmailEvent | null> {
    if (onTables()) {
      const { data, error } = await supabaseTables().from("email_events").select("data").eq("user_id", userId).eq("message_key", key).maybeSingle();
      if (error) throw tableError(error);
      return (data?.data as EmailEvent | undefined) ?? null;
    }
    return withLock((db) => (db.emailEvents ?? []).find((row) => row.userId === userId && row.messageKey === key) ?? null);
  },

  async list(userId: string, limit = 100): Promise<EmailEvent[]> {
    if (onTables()) {
      const { data, error } = await supabaseTables().from("email_events").select("data").eq("user_id", userId).order("created_at", { ascending: false }).limit(limit);
      if (error) throw tableError(error);
      return (data ?? []).map((row) => row.data as EmailEvent);
    }
    return withLock((db) => (db.emailEvents ?? []).filter((row) => row.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit));
  },

  /** Every email saved on one job, newest first. */
  async forApplication(userId: string, applicationId: string): Promise<EmailEvent[]> {
    if (onTables()) {
      const { data, error } = await supabaseTables().from("email_events").select("data").eq("user_id", userId).eq("data->>applicationId", applicationId).order("created_at", { ascending: false }).limit(100);
      if (error) throw tableError(error);
      return (data ?? []).map((row) => row.data as EmailEvent);
    }
    return withLock((db) => (db.emailEvents ?? []).filter((row) => row.userId === userId && row.applicationId === applicationId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100));
  },

  async get(userId: string, eventId: string): Promise<EmailEvent | null> {
    if (onTables()) {
      const { data, error } = await supabaseTables().from("email_events").select("data").eq("user_id", userId).eq("id", eventId).maybeSingle();
      if (error) throw tableError(error);
      return (data?.data as EmailEvent | undefined) ?? null;
    }
    return withLock((db) => (db.emailEvents ?? []).find((row) => row.userId === userId && row.id === eventId) ?? null);
  },

  async update(userId: string, eventId: string, patch: Partial<EmailEvent>): Promise<EmailEvent | null> {
    const current = await this.get(userId, eventId);
    if (!current) return null;
    const next = { ...current, ...patch, id: current.id, userId: current.userId };
    if (onTables()) {
      const { error } = await supabaseTables().from("email_events").update({ data: next }).eq("user_id", userId).eq("id", eventId);
      if (error) throw tableError(error);
      return next;
    }
    return withLock((db) => {
      const list = db.emailEvents ?? [];
      const index = list.findIndex((row) => row.userId === userId && row.id === eventId);
      if (index >= 0) list[index] = next;
      return next;
    });
  },
};

export type SavedEmail = { from: string; subject: string; text: string };
const MAX_TEXT = 30_000;

/**
 * The text of emails about a job, encrypted. If its table is missing (0007_email_texts.sql hasn't been run), or a
 * row can't be read, the job still works: it shows the one-line summary instead of the email.
 */
export const emailTexts = {
  async save(userId: string, eventId: string, email: SavedEmail) {
    const row: EmailText = { eventId, userId, data: encryptSecret(JSON.stringify({ from: email.from.slice(0, 300), subject: email.subject.slice(0, 500), text: email.text.slice(0, MAX_TEXT) })), createdAt: nowIso() };
    if (onTables()) {
      const { error } = await supabaseTables().from("email_texts").upsert({ event_id: row.eventId, user_id: row.userId, data: row.data, created_at: row.createdAt });
      if (error) console.error("email text not saved", error.code ?? "");
      return;
    }
    await withLock((db) => {
      db.emailTexts = [...(db.emailTexts ?? []).filter((item) => item.eventId !== eventId), row];
    });
  },

  async read(userId: string, eventIds: string[]): Promise<Map<string, SavedEmail>> {
    const found = new Map<string, SavedEmail>();
    if (!eventIds.length) return found;
    let rows: Array<{ eventId: string; data: string }> = [];
    if (onTables()) {
      const { data, error } = await supabaseTables().from("email_texts").select("event_id, data").eq("user_id", userId).in("event_id", eventIds);
      if (error) return found;
      rows = (data ?? []).map((row) => ({ eventId: row.event_id as string, data: row.data as string }));
    } else {
      rows = await withLock((db) => (db.emailTexts ?? []).filter((row) => row.userId === userId && eventIds.includes(row.eventId)));
    }
    for (const row of rows) {
      try {
        found.set(row.eventId, JSON.parse(decryptSecret(row.data)) as SavedEmail);
      } catch {
        // Can't be read any more (the server's secret changed): the summary stands in.
      }
    }
    return found;
  },

  async remove(userId: string, eventIds: string[]) {
    if (!eventIds.length) return;
    if (onTables()) {
      const { error } = await supabaseTables().from("email_texts").delete().eq("user_id", userId).in("event_id", eventIds);
      if (error) console.error("email text not removed", error.code ?? "");
      return;
    }
    await withLock((db) => {
      db.emailTexts = (db.emailTexts ?? []).filter((row) => !(row.userId === userId && eventIds.includes(row.eventId)));
    });
  },
};

/** A job is deleted: the emails saved on it go too. */
export async function removeEmailTextsFor(userId: string, applicationId: string) {
  const events = await emailEvents.forApplication(userId, applicationId).catch(() => []);
  await emailTexts.remove(userId, events.map((event) => event.id));
}

/** An account is deleted: its forwarding addresses stop working, and everything kept from its emails goes. */
export async function removeEmailData(userId: string) {
  if (onTables()) {
    const client = supabaseTables();
    const results = await Promise.all([
      client.from("email_inboxes").delete().eq("user_id", userId),
      client.from("email_events").delete().eq("user_id", userId),
      client.from("email_texts").delete().eq("user_id", userId),
    ]);
    for (const { error } of results) if (error) console.error("email data not removed", error.code ?? "");
    return;
  }
  await withLock((db) => {
    db.emailInboxes = (db.emailInboxes ?? []).filter((row) => row.userId !== userId);
    db.emailEvents = (db.emailEvents ?? []).filter((row) => row.userId !== userId);
    db.emailTexts = (db.emailTexts ?? []).filter((row) => row.userId !== userId);
  });
}
