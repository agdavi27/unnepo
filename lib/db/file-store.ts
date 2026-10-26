import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { ServiceError } from "@/lib/errors";
import { loadRemote, remoteKind, saveRemote, VersionConflict } from "./remote";
import { emptyDatabase, type CreditAccount, type Database, type LedgerEntry, type Reservation, type SavedContact } from "./types";

type GlobalStore = {
  memory: Database | null;
  queue: Promise<unknown>;
  dir: string | null;
};

const globalStore = globalThis as typeof globalThis & { __unnepoStore?: GlobalStore };

function state(): GlobalStore {
  if (!globalStore.__unnepoStore) {
    globalStore.__unnepoStore = { memory: null, queue: Promise.resolve(), dir: null };
  }
  return globalStore.__unnepoStore;
}

export function dataDir() {
  return state().dir || process.env.UNNEPO_DATA_DIR || path.join(process.cwd(), ".data");
}

export function setDataDir(dir: string) {
  state().dir = dir;
  state().memory = null;
}

export function resetMemory() {
  state().memory = null;
}

function dbFile() {
  return path.join(dataDir(), "db.json");
}

function load(): Database {
  const current = state();
  if (current.memory) return current.memory;
  const file = dbFile();
  if (!existsSync(file)) {
    current.memory = emptyDatabase();
    return current.memory;
  }
  const parsed = JSON.parse(readFileSync(file, "utf8")) as Database;
  current.memory = { ...emptyDatabase(), ...parsed };
  return current.memory;
}

function remoteActive() {
  // Tests pin a directory with setDataDir. Production leaves it unset and uses Postgres when configured.
  if (state().dir) return false;
  return remoteKind() !== null;
}

export function persistenceMode(): "postgres" | "supabase" | "local-file" {
  if (!remoteActive()) return "local-file";
  return remoteKind() === "supabase" ? "supabase" : "postgres";
}

function persist(db: Database) {
  const dir = dataDir();
  try {
    mkdirSync(dir, { recursive: true });
    const file = dbFile();
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(db));
    renameSync(tmp, file);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EROFS" || code === "EPERM" || code === "EACCES" || code === "ENOENT") {
      throw new ServiceError(
        "This host cannot save accounts to a local file. Add DATABASE_URL, or SUPABASE_URL plus SUPABASE_SERVICE_ROLE_KEY, in the Vercel project settings and redeploy.",
        "database",
        500,
      );
    }
    throw error;
  }
  state().memory = db;
}

function enqueue<T>(fn: () => T | Promise<T>): Promise<T> {
  const current = state();
  const run = current.queue.then(() => fn());
  current.queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function withLock<T>(fn: (db: Database) => T): Promise<T> {
  return enqueue(() => (remoteActive() ? withRemoteLock(fn) : withFileLock(fn)));
}

function withFileLock<T>(fn: (db: Database) => T): T {
  const db = load();
  const snapshot = structuredClone(db);
  try {
    const result = fn(db);
    persist(db);
    return structuredClone(result) as T;
  } catch (error) {
    try {
      persist(snapshot);
    } catch {
      // Keep the original failure. A second write error would hide it.
    }
    throw error;
  }
}

async function withRemoteLock<T>(fn: (db: Database) => T): Promise<T> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const loaded = await loadRemote();
    const db = loaded.db;
    try {
      const result = fn(db);
      await saveRemote(db, loaded.version);
      return structuredClone(result) as T;
    } catch (error) {
      if (error instanceof VersionConflict) continue;
      throw error;
    }
  }
  throw new ServiceError("Could not save. Try again.", "conflict", 503);
}

export function nowIso() {
  return new Date().toISOString();
}

export function id() {
  return crypto.randomUUID();
}

function ensureAccount(db: Database, userId: string): CreditAccount {
  let account = db.accounts.find((item) => item.userId === userId);
  if (!account) {
    account = {
      userId,
      balance: 0,
      reserved: 0,
      purchasedBalance: 0,
      allowanceBalance: 0,
      includedAllowance: 25,
      plan: "free",
      updatedAt: nowIso(),
    };
    db.accounts.push(account);
  }
  return account;
}

function sweep(db: Database) {
  const cutoff = Date.now() - 15 * 60 * 1000;
  for (const reservation of db.reservations) {
    if (reservation.status === "reserved" && new Date(reservation.createdAt).getTime() < cutoff) {
      restore(db, reservation);
      reservation.status = "released";
      reservation.updatedAt = nowIso();
    }
  }
}

function restore(db: Database, reservation: Reservation) {
  const account = ensureAccount(db, reservation.userId);
  account.balance += reservation.amount;
  account.reserved = Math.max(0, account.reserved - reservation.amount);
  account.allowanceBalance += reservation.allowancePart;
  account.purchasedBalance += reservation.purchasedPart;
  account.updatedAt = nowIso();
}

export async function snapshot() {
  return withLock((db) => db);
}

export async function wipeDataDir() {
  const dir = dataDir();
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  resetMemory();
}

export const repo = {
  snapshot,
  async createUser(user: Database["users"][number]) {
    return withLock((db) => {
      if (db.users.some((item) => item.emailNormalized === user.emailNormalized && !item.deletedAt)) {
        throw new Error("duplicate_email");
      }
      db.users.push(user);
      ensureAccount(db, user.id);
      return user;
    });
  },
  async getUserById(id: string) {
    return withLock((db) => db.users.find((user) => user.id === id && !user.deletedAt) ?? null);
  },
  async getUserByEmail(emailNormalized: string) {
    return withLock((db) => db.users.find((user) => user.emailNormalized === emailNormalized && !user.deletedAt) ?? null);
  },
  async getUserByReferralCode(code: string) {
    return withLock((db) => db.users.find((user) => user.referralCode === code && !user.deletedAt) ?? null);
  },
  async updateUser(id: string, patch: Partial<Database["users"][number]>) {
    return withLock((db) => {
      const user = db.users.find((item) => item.id === id);
      if (!user) return null;
      Object.assign(user, patch);
      return user;
    });
  },
  async listUsers() {
    return withLock((db) => db.users.filter((user) => !user.deletedAt));
  },
  async createSession(session: Database["sessions"][number]) {
    return withLock((db) => {
      db.sessions.push(session);
      return session;
    });
  },
  async getSessionByTokenHash(tokenHash: string) {
    return withLock((db) => db.sessions.find((session) => session.tokenHash === tokenHash) ?? null);
  },
  async deleteSession(sessionId: string) {
    return withLock((db) => {
      db.sessions = db.sessions.filter((session) => session.id !== sessionId);
    });
  },
  async deleteUserSessions(userId: string) {
    return withLock((db) => {
      db.sessions = db.sessions.filter((session) => session.userId !== userId);
    });
  },
  async createToken(token: Database["tokens"][number]) {
    return withLock((db) => {
      db.tokens.push(token);
      return token;
    });
  },
  async getTokenByHash(tokenHash: string) {
    return withLock((db) => db.tokens.find((token) => token.tokenHash === tokenHash) ?? null);
  },
  async consumeToken(tokenHash: string, purpose: Database["tokens"][number]["purpose"]) {
    return withLock((db) => {
      const token = db.tokens.find((item) => item.tokenHash === tokenHash && item.purpose === purpose);
      if (!token || token.usedAt || new Date(token.expiresAt).getTime() < Date.now()) return null;
      token.usedAt = nowIso();
      return token;
    });
  },
  async upsertProfile(profile: Database["profiles"][number]) {
    return withLock((db) => {
      const index = db.profiles.findIndex((item) => item.userId === profile.userId);
      if (index === -1) db.profiles.push(profile);
      else db.profiles[index] = profile;
      return profile;
    });
  },
  async getProfile(userId: string) {
    return withLock((db) => db.profiles.find((profile) => profile.userId === userId) ?? null);
  },
  async upsertGoals(goals: Database["goals"][number]) {
    return withLock((db) => {
      const index = db.goals.findIndex((item) => item.userId === goals.userId);
      if (index === -1) db.goals.push(goals);
      else db.goals[index] = goals;
      return goals;
    });
  },
  async getGoals(userId: string) {
    return withLock((db) => db.goals.find((goals) => goals.userId === userId) ?? null);
  },
  async insertResume(resume: Database["resumes"][number]) {
    return withLock((db) => {
      db.resumes.push(resume);
      return resume;
    });
  },
  async getLatestResume(userId: string) {
    return withLock((db) => {
      const rows = db.resumes.filter((resume) => resume.userId === userId);
      return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
    });
  },
  async getResumeByHash(userId: string, sha256: string) {
    return withLock((db) => db.resumes.find((resume) => resume.userId === userId && resume.sha256 === sha256) ?? null);
  },
  async getResumeById(userId: string, resumeId: string) {
    return withLock((db) => db.resumes.find((resume) => resume.userId === userId && resume.id === resumeId) ?? null);
  },
  async replaceFacts(userId: string, resumeId: string, facts: Database["facts"]) {
    return withLock((db) => {
      db.facts = db.facts.filter((fact) => !(fact.userId === userId && fact.resumeId === resumeId && !fact.edited));
      const edited = db.facts.filter((fact) => fact.userId === userId && fact.resumeId === resumeId && fact.edited);
      const editedCategories = new Set(edited.map((fact) => `${fact.category}:${fact.label}`));
      for (const fact of facts) {
        if (!editedCategories.has(`${fact.category}:${fact.label}`)) db.facts.push(fact);
      }
      return db.facts.filter((fact) => fact.userId === userId);
    });
  },
  async getFacts(userId: string) {
    return withLock((db) => db.facts.filter((fact) => fact.userId === userId));
  },
  async updateFact(userId: string, factId: string, patch: Partial<Database["facts"][number]>) {
    return withLock((db) => {
      const fact = db.facts.find((item) => item.id === factId && item.userId === userId);
      if (!fact) return null;
      Object.assign(fact, patch, { edited: true });
      return fact;
    });
  },
  async getAccount(userId: string) {
    return withLock((db) => {
      const account = db.accounts.find((item) => item.userId === userId);
      return account ? structuredClone(account) : null;
    });
  },
  async grantCreditsOnce(input: {
    userId: string;
    entryType: LedgerEntry["entryType"];
    amount: number;
    bucket: LedgerEntry["bucket"];
    idempotencyKey: string;
    demo?: boolean;
    referenceType?: string | null;
    referenceId?: string | null;
    note?: string | null;
    includedAllowance?: number;
    plan?: CreditAccount["plan"];
  }) {
    return withLock((db) => {
      const account = ensureAccount(db, input.userId);
      const duplicate = db.ledger.some((entry) => entry.idempotencyKey === input.idempotencyKey);
      const signupExists =
        input.entryType === "signup_grant" &&
        db.ledger.some((entry) => entry.userId === input.userId && entry.entryType === "signup_grant");
      if (duplicate || signupExists) return { granted: false, account: structuredClone(account) };
      db.ledger.push({
        id: id(),
        userId: input.userId,
        entryType: input.entryType,
        amount: input.amount,
        bucket: input.bucket,
        idempotencyKey: input.idempotencyKey,
        referenceType: input.referenceType ?? null,
        referenceId: input.referenceId ?? null,
        demo: Boolean(input.demo),
        note: input.note ?? null,
        createdAt: nowIso(),
      });
      if (input.bucket === "allowance") account.allowanceBalance += input.amount;
      else account.purchasedBalance += input.amount;
      account.balance += input.amount;
      if (input.includedAllowance) account.includedAllowance = input.includedAllowance;
      if (input.plan) account.plan = input.plan;
      account.updatedAt = nowIso();
      return { granted: true, account: structuredClone(account) };
    });
  },
  async reserveCredit(input: { userId: string; contactId: string; idempotencyKey: string; amount: number }) {
    return withLock((db) => {
      sweep(db);
      const saved = db.saved.find((item) => item.userId === input.userId && item.contactId === input.contactId);
      if (saved) return { kind: "already" as const, saved };
      const existing = db.reservations.find((item) => item.idempotencyKey === input.idempotencyKey);
      if (existing?.status === "finalized") return { kind: "replay" as const, reservation: existing };
      if (existing?.status === "reserved") return { kind: "in_progress" as const, reservation: existing };
      const account = ensureAccount(db, input.userId);
      if (account.balance < input.amount) return { kind: "insufficient" as const, balance: account.balance };
      const allowancePart = Math.min(account.allowanceBalance, input.amount);
      const purchasedPart = input.amount - allowancePart;
      account.allowanceBalance -= allowancePart;
      account.purchasedBalance -= purchasedPart;
      account.balance -= input.amount;
      account.reserved += input.amount;
      account.updatedAt = nowIso();
      if (existing && existing.status === "released") {
        existing.status = "reserved";
        existing.allowancePart = allowancePart;
        existing.purchasedPart = purchasedPart;
        existing.amount = input.amount;
        existing.contactId = input.contactId;
        existing.result = null;
        existing.createdAt = nowIso();
        existing.updatedAt = nowIso();
        return { kind: "reserved" as const, reservation: existing };
      }
      const reservation: Reservation = {
        id: id(),
        userId: input.userId,
        contactId: input.contactId,
        amount: input.amount,
        allowancePart,
        purchasedPart,
        status: "reserved",
        idempotencyKey: input.idempotencyKey,
        result: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      db.reservations.push(reservation);
      return { kind: "reserved" as const, reservation };
    });
  },
  async finalizeReservation(input: {
    reservationId: string;
    saved: Omit<SavedContact, "id" | "unlockedAt" | "updatedAt" | "creditCharged">;
    contactPatch?: Partial<Database["contacts"][number]>;
  }) {
    return withLock((db) => {
      const reservation = db.reservations.find((item) => item.id === input.reservationId);
      if (!reservation) return { kind: "missing" as const };
      if (reservation.status === "finalized") return { kind: "replay" as const, reservation };
      if (reservation.status !== "reserved") return { kind: "released" as const };
      const already = db.saved.find((item) => item.userId === reservation.userId && item.contactId === reservation.contactId);
      if (already) {
        restore(db, reservation);
        reservation.status = "released";
        reservation.updatedAt = nowIso();
        return { kind: "already" as const, saved: already };
      }
      const account = ensureAccount(db, reservation.userId);
      account.reserved = Math.max(0, account.reserved - reservation.amount);
      account.updatedAt = nowIso();
      const stamp = nowIso();
      if (reservation.allowancePart) {
        db.ledger.push({
          id: id(),
          userId: reservation.userId,
          entryType: "unlock_debit",
          amount: -reservation.allowancePart,
          bucket: "allowance",
          idempotencyKey: `unlock:${reservation.id}:allowance`,
          referenceType: "saved_contact",
          referenceId: reservation.contactId,
          demo: false,
          note: null,
          createdAt: stamp,
        });
      }
      if (reservation.purchasedPart) {
        db.ledger.push({
          id: id(),
          userId: reservation.userId,
          entryType: "unlock_debit",
          amount: -reservation.purchasedPart,
          bucket: "purchased",
          idempotencyKey: `unlock:${reservation.id}:purchased`,
          referenceType: "saved_contact",
          referenceId: reservation.contactId,
          demo: false,
          note: null,
          createdAt: stamp,
        });
      }
      const saved: SavedContact = {
        ...input.saved,
        id: id(),
        creditCharged: true,
        unlockedAt: stamp,
        updatedAt: stamp,
      };
      db.saved.push(saved);
      if (input.contactPatch) {
        const contact = db.contacts.find((item) => item.id === reservation.contactId);
        if (contact) Object.assign(contact, input.contactPatch);
      }
      reservation.status = "finalized";
      reservation.result = { savedId: saved.id, charged: reservation.amount };
      reservation.updatedAt = stamp;
      return { kind: "finalized" as const, saved, charged: reservation.amount };
    });
  },
  async releaseReservation(reservationId: string, reason: string) {
    return withLock((db) => {
      const reservation = db.reservations.find((item) => item.id === reservationId);
      if (!reservation || reservation.status !== "reserved") return { released: false };
      restore(db, reservation);
      reservation.status = "released";
      reservation.updatedAt = nowIso();
      db.audits.push({
        id: id(),
        userId: reservation.userId,
        action: "reservation_released",
        metadata: { reason, reservationId },
        createdAt: nowIso(),
      });
      return { released: true };
    });
  },
  async spendCredits(input: { userId: string; amount: number; idempotencyKey: string; note: string; entryType: "search_debit" | "unlock_debit" }) {
    return withLock((db) => {
      const account = ensureAccount(db, input.userId);
      const prior = db.ledger.find((entry) => entry.idempotencyKey === input.idempotencyKey || entry.idempotencyKey.startsWith(`${input.idempotencyKey}:`));
      if (prior) return { charged: 0, balance: account.balance, duplicate: true, insufficient: false };
      if (account.balance < input.amount) return { charged: 0, balance: account.balance, duplicate: false, insufficient: true };
      const allowancePart = Math.min(account.allowanceBalance, input.amount);
      const purchasedPart = input.amount - allowancePart;
      account.allowanceBalance -= allowancePart;
      account.purchasedBalance -= purchasedPart;
      account.balance -= input.amount;
      account.updatedAt = nowIso();
      const stamp = nowIso();
      const push = (amount: number, bucket: "allowance" | "purchased") => {
        db.ledger.push({
          id: id(),
          userId: input.userId,
          entryType: input.entryType,
          amount: -amount,
          bucket,
          idempotencyKey: `${input.idempotencyKey}:${bucket}`,
          referenceType: "search",
          referenceId: null,
          demo: false,
          note: input.note,
          createdAt: stamp,
        });
      };
      if (allowancePart) push(allowancePart, "allowance");
      if (purchasedPart) push(purchasedPart, "purchased");
      return { charged: input.amount, balance: account.balance, duplicate: false, insufficient: false };
    });
  },
  async clawbackPurchased(input: { userId: string; amount: number; idempotencyKey: string; note: string }) {
    return withLock((db) => {
      if (db.ledger.some((entry) => entry.idempotencyKey === input.idempotencyKey)) {
        return { applied: false, taken: 0, shortfall: 0 };
      }
      const account = ensureAccount(db, input.userId);
      const taken = Math.min(account.purchasedBalance, input.amount);
      account.purchasedBalance -= taken;
      account.balance -= taken;
      account.updatedAt = nowIso();
      db.ledger.push({
        id: id(),
        userId: input.userId,
        entryType: "refund_clawback",
        amount: -taken,
        bucket: "purchased",
        idempotencyKey: input.idempotencyKey,
        referenceType: "refund",
        referenceId: null,
        demo: false,
        note: input.note,
        createdAt: nowIso(),
      });
      return { applied: true, taken, shortfall: input.amount - taken };
    });
  },
  async listLedger(userId?: string) {
    return withLock((db) => (userId ? db.ledger.filter((entry) => entry.userId === userId) : db.ledger));
  },
  async setAccountForTests(userId: string, patch: Partial<CreditAccount>) {
    return withLock((db) => {
      const account = ensureAccount(db, userId);
      Object.assign(account, patch, { updatedAt: nowIso() });
      return account;
    });
  },
  async upsertContacts(contacts: Database["contacts"]) {
    return withLock((db) => {
      for (const contact of contacts) {
        const index = db.contacts.findIndex(
          (item) => item.id === contact.id || (item.provider === contact.provider && item.externalId === contact.externalId),
        );
        if (index === -1) db.contacts.push(contact);
        else {
          const previous = db.contacts[index];
          db.contacts[index] = {
            ...contact,
            id: previous.id,
            email: contact.email ?? previous.email,
            phone: contact.phone ?? previous.phone,
          };
        }
      }
      return contacts.length;
    });
  },
  async getContact(contactId: string) {
    return withLock((db) => db.contacts.find((contact) => contact.id === contactId) ?? null);
  },
  async insertSearch(search: Database["searches"][number]) {
    return withLock((db) => {
      db.searches.push(search);
      return search;
    });
  },
  async listSearches(userId: string) {
    return withLock((db) => db.searches.filter((search) => search.userId === userId));
  },
  async getSavedByUserAndContact(userId: string, contactId: string) {
    return withLock((db) => db.saved.find((item) => item.userId === userId && item.contactId === contactId) ?? null);
  },
  async getSavedById(userId: string, savedId: string) {
    return withLock((db) => db.saved.find((item) => item.userId === userId && item.id === savedId) ?? null);
  },
  async listSaved(userId: string) {
    return withLock((db) => db.saved.filter((item) => item.userId === userId));
  },
  async listSavedDetailed(userId: string) {
    return withLock((db) =>
      db.saved
        .filter((item) => item.userId === userId)
        .map((saved) => ({ saved, contact: db.contacts.find((contact) => contact.id === saved.contactId) ?? null })),
    );
  },
  async updateSaved(userId: string, savedId: string, patch: Partial<SavedContact>) {
    return withLock((db) => {
      const saved = db.saved.find((item) => item.userId === userId && item.id === savedId);
      if (!saved) return null;
      Object.assign(saved, patch, { updatedAt: nowIso() });
      return saved;
    });
  },
  async upsertMailbox(mailbox: Database["mailboxes"][number]) {
    return withLock((db) => {
      const index = db.mailboxes.findIndex((item) => item.userId === mailbox.userId && item.provider === mailbox.provider);
      if (index === -1) db.mailboxes.push(mailbox);
      else db.mailboxes[index] = { ...mailbox, id: db.mailboxes[index].id };
      return db.mailboxes.find((item) => item.userId === mailbox.userId && item.provider === mailbox.provider)!;
    });
  },
  async listMailboxes(userId: string) {
    return withLock((db) =>
      db.mailboxes
        .filter((item) => item.userId === userId)
        .map((item) => ({ ...item, accessTokenEncrypted: null, refreshTokenEncrypted: null, connected: true })),
    );
  },
  async getMailboxSecrets(userId: string, provider: Database["mailboxes"][number]["provider"]) {
    return withLock((db) => db.mailboxes.find((item) => item.userId === userId && item.provider === provider) ?? null);
  },
  async insertDraft(draft: Database["drafts"][number]) {
    return withLock((db) => {
      db.drafts.push(draft);
      return draft;
    });
  },
  async updateDraft(userId: string, draftId: string, patch: Partial<Database["drafts"][number]>) {
    return withLock((db) => {
      const draft = db.drafts.find((item) => item.userId === userId && item.id === draftId);
      if (!draft) return null;
      Object.assign(draft, patch, { updatedAt: nowIso() });
      return draft;
    });
  },
  async listDrafts(userId: string) {
    return withLock((db) => db.drafts.filter((draft) => draft.userId === userId));
  },
  async insertMessage(message: Database["messages"][number]) {
    return withLock((db) => {
      const existing = db.messages.find((item) => item.idempotencyKey === message.idempotencyKey);
      if (existing) return { message: existing, created: false };
      db.messages.push(message);
      return { message, created: true };
    });
  },
  async listMessages(userId: string) {
    return withLock((db) => db.messages.filter((message) => message.userId === userId));
  },
  async getMessageByProviderId(providerMessageId: string) {
    return withLock((db) => db.messages.find((message) => message.providerMessageId === providerMessageId) ?? null);
  },
  async insertFollowUp(followup: Database["followups"][number]) {
    return withLock((db) => {
      db.followups.push(followup);
      return followup;
    });
  },
  async listFollowUps(userId?: string) {
    return withLock((db) => (userId ? db.followups.filter((item) => item.userId === userId) : db.followups));
  },
  async updateFollowUp(userId: string, followupId: string, patch: Partial<Database["followups"][number]>) {
    return withLock((db) => {
      const followup = db.followups.find((item) => item.userId === userId && item.id === followupId);
      if (!followup) return null;
      Object.assign(followup, patch);
      return followup;
    });
  },
  async insertGeneration(generation: Database["generations"][number]) {
    return withLock((db) => {
      db.generations.push(generation);
      return generation;
    });
  },
  async listGenerations(userId: string, sinceIso?: string) {
    return withLock((db) =>
      db.generations.filter((item) => item.userId === userId && (!sinceIso || item.createdAt >= sinceIso)),
    );
  },
  async insertUsage(usage: Database["usage"][number]) {
    return withLock((db) => {
      db.usage.push(usage);
      return usage;
    });
  },
  async listUsage(sinceIso?: string) {
    return withLock((db) => db.usage.filter((item) => !sinceIso || item.createdAt >= sinceIso));
  },
  async insertPayment(payment: Database["payments"][number]) {
    return withLock((db) => {
      if (payment.stripeEventId && db.payments.some((item) => item.stripeEventId === payment.stripeEventId)) {
        return { payment: db.payments.find((item) => item.stripeEventId === payment.stripeEventId)!, created: false };
      }
      db.payments.push(payment);
      return { payment, created: true };
    });
  },
  async listPayments(userId?: string) {
    return withLock((db) => (userId ? db.payments.filter((item) => item.userId === userId) : db.payments));
  },
  async upsertSubscription(subscription: Database["subscriptions"][number]) {
    return withLock((db) => {
      const index = db.subscriptions.findIndex((item) => item.stripeSubscriptionId === subscription.stripeSubscriptionId);
      if (index === -1) db.subscriptions.push(subscription);
      else db.subscriptions[index] = { ...subscription, id: db.subscriptions[index].id };
      return subscription;
    });
  },
  async listSubscriptions() {
    return withLock((db) => db.subscriptions);
  },
  async insertReferral(referral: Database["referrals"][number]) {
    return withLock((db) => {
      const existing = db.referrals.find((item) => item.referredUserId === referral.referredUserId);
      if (existing) return { referral: existing, created: false };
      db.referrals.push(referral);
      return { referral, created: true };
    });
  },
  async getReferralByReferred(referredUserId: string) {
    return withLock((db) => db.referrals.find((item) => item.referredUserId === referredUserId) ?? null);
  },
  async listReferralsByReferrer(referrerId: string) {
    return withLock((db) => db.referrals.filter((item) => item.referrerId === referrerId));
  },
  async updateReferral(referredUserId: string, patch: Partial<Database["referrals"][number]>) {
    return withLock((db) => {
      const referral = db.referrals.find((item) => item.referredUserId === referredUserId);
      if (!referral) return null;
      Object.assign(referral, patch);
      return referral;
    });
  },
  async upsertJobs(jobs: Database["jobs"]) {
    return withLock((db) => {
      for (const job of jobs) {
        const index = db.jobs.findIndex((item) => item.provider === job.provider && item.externalId === job.externalId);
        if (index === -1) db.jobs.push(job);
        else db.jobs[index] = { ...job, id: db.jobs[index].id };
      }
      return db.jobs;
    });
  },
  async listJobs() {
    return withLock((db) => db.jobs);
  },
  async saveJob(userId: string, jobId: string) {
    return withLock((db) => {
      const existing = db.savedJobs.find((item) => item.userId === userId && item.jobId === jobId);
      if (existing) return existing;
      const saved = { id: id(), userId, jobId, createdAt: nowIso() };
      db.savedJobs.push(saved);
      return saved;
    });
  },
  async unsaveJob(userId: string, jobId: string) {
    return withLock((db) => {
      db.savedJobs = db.savedJobs.filter((item) => !(item.userId === userId && item.jobId === jobId));
    });
  },
  async listSavedJobs(userId: string) {
    return withLock((db) => {
      const ids = new Set(db.savedJobs.filter((item) => item.userId === userId).map((item) => item.jobId));
      return db.jobs.filter((job) => ids.has(job.id));
    });
  },
  async insertAudit(audit: Omit<Database["audits"][number], "id" | "createdAt">) {
    return withLock((db) => {
      const row = { ...audit, id: id(), createdAt: nowIso() };
      db.audits.push(row);
      return row;
    });
  },
  async listAudits() {
    return withLock((db) => db.audits);
  },
  async insertAnalytics(event: Omit<Database["analytics"][number], "id" | "createdAt">) {
    return withLock((db) => {
      const row = { ...event, id: id(), createdAt: nowIso() };
      db.analytics.push(row);
      return row;
    });
  },
  async recordWebhook(provider: string, eventId: string) {
    return withLock((db) => {
      if (db.webhooks.some((item) => item.provider === provider && item.eventId === eventId)) return false;
      db.webhooks.push({ id: id(), provider, eventId, createdAt: nowIso() });
      return true;
    });
  },
  async claimIdempotency(key: string) {
    return withLock((db) => {
      const existing = db.idempotency.find((item) => item.key === key);
      if (existing?.status === "done") return { state: "done" as const, result: existing.result };
      if (existing?.status === "pending") return { state: "pending" as const };
      db.idempotency.push({ key, status: "pending", result: null, createdAt: nowIso() });
      return { state: "claimed" as const };
    });
  },
  async finishIdempotency(key: string, result: unknown) {
    return withLock((db) => {
      const existing = db.idempotency.find((item) => item.key === key);
      if (!existing) return;
      existing.status = "done";
      existing.result = result;
    });
  },
  async releaseIdempotency(key: string) {
    return withLock((db) => {
      db.idempotency = db.idempotency.filter((item) => item.key !== key);
    });
  },
  async createOAuthState(row: Database["oauthStates"][number]) {
    return withLock((db) => {
      db.oauthStates.push(row);
      return row;
    });
  },
  async consumeOAuthState(state: string) {
    return withLock((db) => {
      const row = db.oauthStates.find((item) => item.state === state);
      db.oauthStates = db.oauthStates.filter((item) => item.state !== state);
      if (!row || new Date(row.expiresAt).getTime() < Date.now()) return null;
      return row;
    });
  },
  async exportUser(userId: string) {
    return withLock((db) => ({
      user: db.users.find((user) => user.id === userId) ?? null,
      profile: db.profiles.find((profile) => profile.userId === userId) ?? null,
      goals: db.goals.find((goals) => goals.userId === userId) ?? null,
      resumes: db.resumes.filter((resume) => resume.userId === userId).map((resume) => ({ ...resume, text: resume.text.slice(0, 2000) })),
      facts: db.facts.filter((fact) => fact.userId === userId),
      account: db.accounts.find((account) => account.userId === userId) ?? null,
      ledger: db.ledger.filter((entry) => entry.userId === userId),
      saved: db.saved.filter((item) => item.userId === userId),
      messages: db.messages.filter((item) => item.userId === userId),
      drafts: db.drafts.filter((item) => item.userId === userId),
      payments: db.payments.filter((item) => item.userId === userId),
    }));
  },
  async deleteUser(userId: string) {
    return withLock((db) => {
      const user = db.users.find((item) => item.id === userId);
      if (!user) return false;
      user.deletedAt = nowIso();
      user.name = "Deleted student";
      user.email = `deleted+${user.id}@deleted.unnepo`;
      user.emailNormalized = user.email;
      user.passwordHash = null;
      db.sessions = db.sessions.filter((session) => session.userId !== userId);
      db.tokens = db.tokens.filter((token) => token.userId !== userId);
      db.profiles = db.profiles.filter((profile) => profile.userId !== userId);
      db.goals = db.goals.filter((goals) => goals.userId !== userId);
      db.resumes = db.resumes.filter((resume) => resume.userId !== userId);
      db.facts = db.facts.filter((fact) => fact.userId !== userId);
      db.mailboxes = db.mailboxes.filter((mailbox) => mailbox.userId !== userId);
      db.drafts = db.drafts.filter((draft) => draft.userId !== userId);
      db.messages = db.messages.filter((message) => message.userId !== userId);
      db.saved = db.saved.filter((item) => item.userId !== userId);
      db.followups = db.followups.filter((item) => item.userId !== userId);
      return true;
    });
  },
};

export type Repo = typeof repo;
