import { id, nowIso, persistenceMode, withLock } from "@/lib/db/file-store";
import { supabaseTables } from "@/lib/db/remote";
import { ServiceError } from "@/lib/errors";
import type { ApplicationContact, ApplicationProfile, FillAttempt, JobApplication } from "@/lib/apply/types";

/**
 * Storage for V1 applications. Production uses the Supabase tables from
 * supabase/migrations/0004_applications.sql so applications never grow the single app_state record.
 * Local runs and tests keep the same rows in the local data file.
 */

const MIGRATION_HINT = "The applications tables are missing. Run supabase/migrations/0004_applications.sql in the Supabase SQL editor.";

function onTables() {
  return persistenceMode() === "supabase";
}

function tableError(error: { code?: string; message?: string } | null) {
  if (!error) return null;
  if (error.code === "42P01" || error.code === "PGRST205" || /does not exist|schema cache/i.test(error.message || "")) {
    return new ServiceError(MIGRATION_HINT, "database", 500);
  }
  return new ServiceError(error.message || "Could not reach the database.", "database", 500);
}

const APP_COLUMNS: Record<keyof JobApplication, string> = {
  id: "id", userId: "user_id", jobKey: "job_key", jobUrl: "job_url", ats: "ats", title: "title", company: "company",
  companyDomain: "company_domain", department: "department", location: "location", description: "description",
  requirements: "requirements", applicationUrl: "application_url", postedRecruiter: "posted_recruiter", status: "status",
  statusMessage: "status_message", questions: "questions", browserSessionId: "browser_session_id", fillReport: "fill_report",
  confirmation: "confirmation", submittedAt: "submitted_at", contactsStatus: "contacts_status", contactsMessage: "contacts_message",
  charged: "charged", attempts: "attempts", createdAt: "created_at", updatedAt: "updated_at",
};

const CONTACT_COLUMNS: Record<keyof ApplicationContact, string> = {
  id: "id", applicationId: "application_id", userId: "user_id", rank: "rank", role: "role", name: "name", title: "title",
  email: "email", emailSource: "email_source", relevance: "relevance", linkedinUrl: "linkedin_url", photoUrl: "photo_url",
  outreachStatus: "outreach_status", emailSubject: "email_subject", emailBody: "email_body", createdAt: "created_at", updatedAt: "updated_at",
};

function toRow<T extends object>(value: Partial<T>, columns: Record<keyof T, string>) {
  const row: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(columns) as Array<[keyof T, string]>) {
    if (value[key] !== undefined) row[column] = value[key];
  }
  return row;
}

function fromRow<T extends object>(row: Record<string, unknown>, columns: Record<keyof T, string>) {
  const value: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(columns) as Array<[string, string]>) value[key] = row[column] ?? null;
  return value as T;
}

function appFromRow(row: Record<string, unknown>) {
  const app = fromRow<JobApplication>(row, APP_COLUMNS);
  return { ...app, requirements: app.requirements ?? [], questions: app.questions ?? [], attempts: Number(app.attempts ?? 0), charged: Boolean(app.charged) };
}

export const applications = {
  async list(userId: string): Promise<JobApplication[]> {
    if (onTables()) {
      const { data, error } = await supabaseTables().from("job_applications").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(200);
      if (error) throw tableError(error);
      return (data ?? []).map(appFromRow);
    }
    return withLock((db) => (db.jobApplications ?? []).filter((app) => app.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  },

  /** Every student's fill records from their most recently updated applications, for the admin's failure report. */
  async recentAttempts(limit = 1000): Promise<FillAttempt[][]> {
    if (onTables()) {
      const { data, error } = await supabaseTables().from("job_applications").select("attempts:fill_report->attempts").not("fill_report->attempts", "is", null).order("updated_at", { ascending: false }).limit(limit);
      if (error) throw tableError(error);
      return (data ?? []).map((row) => ((row as { attempts?: unknown }).attempts as FillAttempt[] | null) ?? []);
    }
    return withLock((db) => (db.jobApplications ?? []).filter((app) => app.fillReport?.attempts?.length).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit).map((app) => app.fillReport!.attempts!));
  },

  async get(userId: string, applicationId: string): Promise<JobApplication | null> {
    if (onTables()) {
      const { data, error } = await supabaseTables().from("job_applications").select("*").eq("user_id", userId).eq("id", applicationId).maybeSingle();
      if (error) throw tableError(error);
      return data ? appFromRow(data) : null;
    }
    return withLock((db) => (db.jobApplications ?? []).find((app) => app.userId === userId && app.id === applicationId) ?? null);
  },

  async findByKey(userId: string, jobKey: string): Promise<JobApplication | null> {
    if (onTables()) {
      const { data, error } = await supabaseTables().from("job_applications").select("*").eq("user_id", userId).eq("job_key", jobKey).maybeSingle();
      if (error) throw tableError(error);
      return data ? appFromRow(data) : null;
    }
    return withLock((db) => (db.jobApplications ?? []).find((app) => app.userId === userId && app.jobKey === jobKey) ?? null);
  },

  /** Inserts once per student and job. A second paste of the same job returns the first record. */
  async insert(app: Omit<JobApplication, "id" | "createdAt" | "updatedAt">): Promise<{ app: JobApplication; created: boolean }> {
    const existing = await this.findByKey(app.userId, app.jobKey);
    if (existing) return { app: existing, created: false };
    const full: JobApplication = { ...app, id: id(), createdAt: nowIso(), updatedAt: nowIso() };
    if (onTables()) {
      const { error } = await supabaseTables().from("job_applications").insert(toRow(full, APP_COLUMNS));
      if (error?.code === "23505") {
        const raced = await this.findByKey(app.userId, app.jobKey);
        if (raced) return { app: raced, created: false };
      }
      if (error) throw tableError(error);
      return { app: full, created: true };
    }
    return withLock((db) => {
      db.jobApplications ??= [];
      const raced = db.jobApplications.find((row) => row.userId === app.userId && row.jobKey === app.jobKey);
      if (raced) return { app: raced, created: false };
      db.jobApplications.push(full);
      return { app: full, created: true };
    });
  },

  async update(userId: string, applicationId: string, patch: Partial<JobApplication>): Promise<JobApplication | null> {
    const next = { ...patch, updatedAt: nowIso() };
    delete next.id;
    delete next.userId;
    if (onTables()) {
      const { data, error } = await supabaseTables().from("job_applications").update(toRow(next, APP_COLUMNS)).eq("user_id", userId).eq("id", applicationId).select("*").maybeSingle();
      if (error) throw tableError(error);
      return data ? appFromRow(data) : null;
    }
    return withLock((db) => {
      const app = (db.jobApplications ?? []).find((row) => row.userId === userId && row.id === applicationId);
      if (!app) return null;
      Object.assign(app, next);
      return app;
    });
  },

  /** Moves an application from one status to another only if nobody else moved it first. */
  async transition(userId: string, applicationId: string, from: JobApplication["status"][], patch: Partial<JobApplication>) {
    if (onTables()) {
      const { data, error } = await supabaseTables()
        .from("job_applications")
        .update(toRow({ ...patch, updatedAt: nowIso() }, APP_COLUMNS))
        .eq("user_id", userId)
        .eq("id", applicationId)
        .in("status", from)
        .select("*")
        .maybeSingle();
      if (error) throw tableError(error);
      return data ? appFromRow(data) : null;
    }
    return withLock((db) => {
      const app = (db.jobApplications ?? []).find((row) => row.userId === userId && row.id === applicationId);
      if (!app || !from.includes(app.status)) return null;
      Object.assign(app, patch, { updatedAt: nowIso() });
      return app;
    });
  },

  async countCharged(userId: string) {
    if (onTables()) {
      const { count, error } = await supabaseTables().from("job_applications").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("charged", true);
      if (error) throw tableError(error);
      return count ?? 0;
    }
    return withLock((db) => (db.jobApplications ?? []).filter((app) => app.userId === userId && app.charged).length);
  },

  async remove(userId: string, applicationId: string) {
    if (onTables()) {
      const { error } = await supabaseTables().from("job_applications").delete().eq("user_id", userId).eq("id", applicationId);
      if (error) throw tableError(error);
      return;
    }
    await withLock((db) => {
      db.jobApplications = (db.jobApplications ?? []).filter((app) => !(app.userId === userId && app.id === applicationId));
      db.applicationContacts = (db.applicationContacts ?? []).filter((contact) => !(contact.userId === userId && contact.applicationId === applicationId));
    });
  },
};

export const applicationContacts = {
  async list(userId: string, applicationIds: string[]): Promise<ApplicationContact[]> {
    if (!applicationIds.length) return [];
    if (onTables()) {
      const { data, error } = await supabaseTables().from("application_contacts").select("*").eq("user_id", userId).in("application_id", applicationIds).order("rank");
      if (error) throw tableError(error);
      return (data ?? []).map((row) => fromRow<ApplicationContact>(row, CONTACT_COLUMNS));
    }
    const wanted = new Set(applicationIds);
    return withLock((db) => (db.applicationContacts ?? []).filter((row) => row.userId === userId && wanted.has(row.applicationId)).sort((a, b) => a.rank - b.rank));
  },

  /** Replaces the people for one application, keeping outreach status for anyone already there. */
  async replace(userId: string, applicationId: string, contacts: Array<Omit<ApplicationContact, "id" | "createdAt" | "updatedAt" | "outreachStatus"> & { outreachStatus?: ApplicationContact["outreachStatus"] }>) {
    const previous = await this.list(userId, [applicationId]);
    const statusByName = new Map(previous.map((row) => [row.name.toLowerCase(), row.outreachStatus]));
    const rows: ApplicationContact[] = contacts.map((contact) => ({
      ...contact,
      outreachStatus: statusByName.get(contact.name.toLowerCase()) ?? contact.outreachStatus ?? "not_contacted",
      id: id(),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }));
    if (onTables()) {
      const client = supabaseTables();
      const removed = await client.from("application_contacts").delete().eq("user_id", userId).eq("application_id", applicationId);
      if (removed.error) throw tableError(removed.error);
      if (rows.length) {
        const { error } = await client.from("application_contacts").insert(rows.map((row) => toRow(row, CONTACT_COLUMNS)));
        if (error) throw tableError(error);
      }
      return rows;
    }
    return withLock((db) => {
      db.applicationContacts = (db.applicationContacts ?? []).filter((row) => !(row.userId === userId && row.applicationId === applicationId));
      db.applicationContacts.push(...rows);
      return rows;
    });
  },

  async update(userId: string, contactId: string, patch: Partial<Pick<ApplicationContact, "outreachStatus" | "emailSubject" | "emailBody">>) {
    const next = { ...patch, updatedAt: nowIso() };
    if (onTables()) {
      const { data, error } = await supabaseTables().from("application_contacts").update(toRow(next, CONTACT_COLUMNS)).eq("user_id", userId).eq("id", contactId).select("*").maybeSingle();
      if (error) throw tableError(error);
      return data ? fromRow<ApplicationContact>(data, CONTACT_COLUMNS) : null;
    }
    return withLock((db) => {
      const row = (db.applicationContacts ?? []).find((contact) => contact.userId === userId && contact.id === contactId);
      if (!row) return null;
      Object.assign(row, next);
      return row;
    });
  },
};

export const applicationProfiles = {
  async get(userId: string): Promise<ApplicationProfile | null> {
    if (onTables()) {
      const { data, error } = await supabaseTables().from("application_profiles").select("data").eq("user_id", userId).maybeSingle();
      if (error) throw tableError(error);
      return (data?.data as ApplicationProfile | undefined) ?? null;
    }
    return withLock((db) => (db.applicationProfiles ?? []).find((row) => row.userId === userId)?.data ?? null);
  },

  async put(userId: string, profile: ApplicationProfile) {
    if (onTables()) {
      const { error } = await supabaseTables().from("application_profiles").upsert({ user_id: userId, data: profile, updated_at: nowIso() });
      if (error) throw tableError(error);
      return profile;
    }
    return withLock((db) => {
      db.applicationProfiles ??= [];
      const row = db.applicationProfiles.find((item) => item.userId === userId);
      if (row) Object.assign(row, { data: profile, updatedAt: nowIso() });
      else db.applicationProfiles.push({ userId, data: profile, updatedAt: nowIso() });
      return profile;
    });
  },
};
