import { integrations } from "@/lib/integrations/flags";

/** People-search quotes from the product forms: 25 people = 1 credit, through 250 = 10. */
export const PEOPLE_PER_CREDIT = 25;
export const MIN_SEARCH_PEOPLE = 25;
export const MAX_SEARCH_PEOPLE = 250;
export const VERIFIED_EMAIL_UNLOCK_CREDITS = 1;

export function creditsForPeople(quantity: number) {
  if (!Number.isInteger(quantity) || quantity < MIN_SEARCH_PEOPLE || quantity > MAX_SEARCH_PEOPLE || quantity % PEOPLE_PER_CREDIT !== 0) {
    throw new Error("Choose 25, 50, 75, 100, 125, 150, 175, 200, 225, or 250 people.");
  }
  return quantity / PEOPLE_PER_CREDIT;
}

export type PreparedCreditTransaction = {
  userId: string;
  amount: number;
  entryType: "search_debit" | "unlock_debit";
  idempotencyKey: string;
  referenceType: "people_search" | "email_unlock";
  referenceId: string;
  note: string;
  commit: false;
};

export function prepareSearchDebit(userId: string, requestId: string, quantity: number): PreparedCreditTransaction {
  const credits = creditsForPeople(quantity);
  return {
    userId,
    amount: credits,
    entryType: "search_debit",
    idempotencyKey: `search:${userId}:${requestId}`,
    referenceType: "people_search",
    referenceId: requestId,
    note: `Quote for up to ${quantity} people`,
    commit: false,
  };
}

export function prepareUnlockDebit(userId: string, contactId: string): PreparedCreditTransaction {
  return {
    userId,
    amount: VERIFIED_EMAIL_UNLOCK_CREDITS,
    entryType: "unlock_debit",
    idempotencyKey: `unlock:${userId}:${contactId}`,
    referenceType: "email_unlock",
    referenceId: contactId,
    note: "Quote for one new verified work email",
    commit: false,
  };
}

/** Refuses to post a debit while search and mailbox providers are disabled. */
export function assertCreditCommitAllowed(kind: "search" | "unlock") {
  const enabled = kind === "search" ? integrations.apollo : false;
  if (!enabled) {
    throw new Error("Credits are not deducted until that feature is connected and succeeds.");
  }
}
