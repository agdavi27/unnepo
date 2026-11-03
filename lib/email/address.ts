import { randomBytes } from "node:crypto";

/**
 * Each student's forwarding address. The part that's theirs is a token, "u_" and 20 random letters and digits
 * (100 bits), so nobody can guess another student's address. With a domain of Unnepo's own
 * (INBOUND_EMAIL_DOMAIN=inbox.example.com) it's u_…@inbox.example.com; on Postmark's own inbound address
 * (INBOUND_EMAIL_BASE=abc123@inbound.postmarkapp.com) it rides after a plus: abc123+u_…@inbound.postmarkapp.com.
 */

const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

export function newToken() {
  const bytes = randomBytes(20);
  return `u_${Array.from(bytes, (byte) => ALPHABET[byte % 32]).join("")}`;
}

export const TOKEN = /\bu_[a-z2-7]{20}\b/;

/** Whether inbound email is set up on this server. */
export function inboundReady() {
  return Boolean(process.env.INBOUND_EMAIL_DOMAIN?.trim() || /^[^@\s+]+@[^@\s]+$/.test(process.env.INBOUND_EMAIL_BASE?.trim() ?? ""));
}

/** The address a student forwards to. */
export function addressFor(token: string) {
  const domain = process.env.INBOUND_EMAIL_DOMAIN?.trim();
  if (domain) return `${token}@${domain}`;
  const base = process.env.INBOUND_EMAIL_BASE?.trim() ?? "";
  const [box, host] = base.split("@");
  if (box && host) return `${box}+${token}@${host}`;
  return `${token}@inbox.unnepo.local`;
}

/** The token in a recipient address ("abc+u_…@…", "u_…@…", or "Name <u_…@…>"), or null. */
export function tokenIn(recipient: string) {
  return recipient.toLowerCase().match(TOKEN)?.[0] ?? null;
}
