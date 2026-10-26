import { serverConfig } from "@/lib/config";
import { id, nowIso, repo } from "@/lib/db/file-store";
import type { Contact, SavedContact } from "@/lib/db/types";
import { ServiceError } from "@/lib/errors";
import { enrichPerson, findSampleById, searchPeople } from "@/lib/providers/contacts/router";
import type { SearchFilters } from "@/lib/providers/contacts/sample-directory";
import { matchReasons } from "@/lib/search/interpret";

export type PublicContact = {
  id: string;
  fullName: string;
  title: string;
  company: string;
  location: string;
  school: string | null;
  profileUrl: string | null;
  email: string | null;
  phone: string | null;
  emailAvailable: boolean;
  phoneAvailable: boolean;
  tags: string[];
  emailed: boolean;
  seniority: string | null;
  department: string | null;
  industry: string | null;
  unlocked: boolean;
  savedId: string | null;
  status: SavedContact["status"] | null;
  dataSource: Contact["dataSource"];
  reasons?: string[];
};

function present(contact: Contact, saved: SavedContact | null, emailed = false, reasons: string[] = []): PublicContact {
  const unlocked = Boolean(saved?.creditCharged);
  return {
    id: contact.id,
    fullName: contact.fullName,
    title: contact.title,
    company: contact.company,
    location: contact.location,
    school: contact.school,
    profileUrl: contact.profileUrl,
    email: unlocked ? contact.email : null,
    phone: unlocked ? contact.phone : null,
    emailAvailable: contact.emailStatus === "available" || contact.emailStatus === "verified" || contact.emailStatus === "unverified",
    phoneAvailable: contact.phoneStatus === "available" || contact.phoneStatus === "verified",
    tags: contact.tags,
    seniority: contact.seniority,
    department: contact.department,
    industry: contact.industry,
    unlocked,
    savedId: saved?.id ?? null,
    status: saved?.status ?? null,
    emailed,
    dataSource: contact.dataSource,
    reasons,
  };
}

export async function runSearch(userId: string, filters: SearchFilters, page = 1, pageSize = 8) {
  const result = await searchPeople(userId, filters, page, pageSize);
  await repo.saveFoundContacts(userId, result.people.map((person) => person.id));
  const [profile, goals] = await Promise.all([repo.getProfile(userId), repo.getGoals(userId)]);
  await repo.insertSearch({
    id: id(),
    userId,
    filters,
    resultCount: result.total,
    provider: result.source,
    costCents: result.source === "apollo" ? serverConfig().apolloSearchCostCents : 0,
    createdAt: nowIso(),
  });
  const [saved, messages] = await Promise.all([repo.listSaved(userId), repo.listMessages(userId)]);
  const byContact = new Map(saved.map((item) => [item.contactId, item]));
  const emailedSaved = new Set(messages.filter((message) => message.direction === "outbound" && message.deliveryConfirmed).map((message) => message.savedContactId));
  await repo.insertAnalytics({ userId, name: "search", properties: { source: result.source, count: result.total } });
  return {
    people: result.people.map((person) => {
      const row = byContact.get(person.id) ?? null;
      return present(person, row, row ? emailedSaved.has(row.id) : false, matchReasons(person, goals, profile?.school || null));
    }),
    total: result.total,
    page,
    pageSize,
    source: result.source,
    notice: result.notice,
  };
}

export async function unlockContact(userId: string, contactId: string, idempotencyKey: string) {
  const user = await repo.getUserById(userId);
  if (!user?.schoolEmailVerifiedAt) throw new ServiceError("Verify your school email before unlocking contacts.", "unverified", 403);
  let contact = await repo.getContact(contactId);
  if (!contact) {
    const sample = findSampleById(contactId);
    if (sample) {
      await repo.upsertContacts([sample]);
      contact = await repo.getContact(contactId);
    }
  }
  if (!contact) throw new ServiceError("That professional is not in the current search.", "not_found", 404);
  if (contact.expiresAt && contact.dataSource === "provider" && new Date(contact.expiresAt).getTime() < Date.now() && !contact.email) {
    throw new ServiceError("This search result expired. Run the search again.", "expired");
  }

  const amount = serverConfig().unlockCreditCost;
  const gate = await repo.reserveCredit({ userId, contactId, idempotencyKey, amount });
  if (gate.kind === "already") {
    const fresh = await repo.getContact(contactId);
    return { ok: true, charged: 0, contact: present(fresh ?? contact, gate.saved), message: "Already unlocked. No credit was used." };
  }
  if (gate.kind === "replay" && gate.reservation.result) {
    const saved = await repo.getSavedById(userId, gate.reservation.result.savedId);
    const fresh = await repo.getContact(contactId);
    return {
      ok: true,
      charged: 0,
      contact: present(fresh ?? contact, saved),
      message: "This unlock was already completed.",
    };
  }
  if (gate.kind === "insufficient") {
    return { ok: false, charged: 0, code: "insufficient_credits", message: "You need 1 credit to unlock this contact." };
  }
  if (gate.kind === "in_progress") {
    return { ok: false, charged: 0, code: "in_progress", message: "This unlock is already running." };
  }

  try {
    const enriched = await enrichPerson(contact, userId);
    if (!enriched.ok) {
      await repo.releaseReservation(gate.reservation.id, enriched.reason);
      await repo.insertAudit({ userId, action: "unlock_failed", metadata: { contactId, reason: enriched.reason } });
      return { ok: false, charged: 0, code: "lookup_failed", message: enriched.message };
    }
    const finalized = await repo.finalizeReservation({
      reservationId: gate.reservation.id,
      contactPatch: {
        email: enriched.email,
        phone: enriched.phone,
        emailStatus: enriched.emailStatus,
        phoneStatus: enriched.phoneStatus,
        fetchedAt: nowIso(),
        costCents: enriched.costCents,
        costEstimated: enriched.estimated,
      },
      saved: {
        userId,
        contactId,
        status: "not_contacted",
        notes: "",
        followUpAt: null,
        listName: "All",
        optOut: false,
        autoFollowUpAuthorized: false,
      },
    });
    const fresh = await repo.getContact(contactId);
    if (finalized.kind === "already") {
      return { ok: true, charged: 0, contact: present(fresh ?? contact, finalized.saved), message: "Already unlocked. No credit was used." };
    }
    if (finalized.kind !== "finalized") {
      return { ok: false, charged: 0, code: "lookup_failed", message: "The unlock could not be saved. You were not charged." };
    }
    await repo.insertAudit({ userId, action: "unlock", metadata: { contactId, charged: finalized.charged, provider: enriched.provider } });
    await repo.insertAnalytics({ userId, name: "unlock", properties: { source: contact.dataSource, provider: enriched.provider } });
    return {
      ok: true,
      charged: finalized.charged,
      contact: present(fresh ?? contact, finalized.saved),
      message: contact.dataSource === "sample" ? "Sample contact saved. No provider was billed." : "Contact unlocked.",
    };
  } catch (error) {
    await repo.releaseReservation(gate.reservation.id, "error");
    throw error;
  }
}
