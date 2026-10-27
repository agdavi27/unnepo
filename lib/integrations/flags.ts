/**
 * Paid and mailbox providers stay off until explicitly enabled.
 * Credentials may exist in the environment. These flags decide whether code may call them.
 */
export const integrations = {
  apollo: false,
  anthropic: false,
  stripeBilling: false,
  gmail: false,
  outlook: false,
} as const;

export type IntegrationName = keyof typeof integrations;
