/**
 * Paid and mailbox providers stay off until explicitly enabled.
 * Credentials may exist in the environment. These flags decide whether code may call them.
 */
export const integrations = {
  apollo: false,
  /** Email generation and other writing stay off. */
  anthropic: false,
  /** Onboarding answers may be organized into profile facts. */
  profileOrganization: true,
  stripeBilling: false,
  gmail: false,
  outlook: false,
} as const;

export type IntegrationName = keyof typeof integrations;
