/**
 * Paid and mailbox providers stay off until explicitly enabled.
 * Credentials may exist in the environment. These flags decide whether code may call them.
 */
export const integrations = {
  /** People search and verified email unlock on /home. */
  apollo: true,
  /** AI email drafts in the composer. Sending stays off with gmail and outlook. */
  anthropic: true,
  /** Onboarding answers may be organized into profile facts. */
  profileOrganization: true,
  stripeBilling: false,
  gmail: false,
  outlook: false,
} as const;

export type IntegrationName = keyof typeof integrations;
