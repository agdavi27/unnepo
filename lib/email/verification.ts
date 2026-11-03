import type { InboundEmail } from "@/lib/email/filter";

/**
 * The email a mail service sends to the forwarding address to make sure the student owns it: Gmail's
 * "Gmail Forwarding Confirmation" from forwarding-noreply@google.com, and Outlook's. Its code and link are
 * shown on the setup page, so the student can finish without opening Unnepo's inbox.
 */
export type ForwardingVerification = { provider: "gmail" | "outlook"; code: string | null; link: string | null };

export function forwardingVerification(email: InboundEmail): ForwardingVerification | null {
  const from = email.from.toLowerCase();
  const text = `${email.subject}\n${email.text}`;
  if (from.includes("forwarding-noreply@google.com") || /gmail forwarding confirmation/i.test(email.subject)) {
    const code = text.match(/confirmation code:\s*(\d{6,12})/i)?.[1] ?? email.subject.match(/\(#(\d{6,12})\)/)?.[1] ?? null;
    const link = text.match(/https:\/\/(?:mail-settings\.google\.com|mail\.google\.com|isolated\.mail\.google\.com)\/mail\/[^\s<>"')]+/i)?.[0] ?? null;
    return { provider: "gmail", code, link };
  }
  const microsoft = /@(?:[a-z0-9-]+\.)*(microsoft\.com|outlook\.com|hotmail\.com|live\.com)\b/.test(from);
  if (microsoft && /forward/i.test(text) && /(verif|confirm)/i.test(text)) {
    const code = text.match(/\b(?:code|security code)[^\d]{0,20}(\d{4,8})\b/i)?.[1] ?? null;
    const link = text.match(/https:\/\/(?:[a-z0-9-]+\.)*(?:microsoft\.com|live\.com|outlook\.com|office\.com)\/[^\s<>"')]+/i)?.[0] ?? null;
    return { provider: "outlook", code, link };
  }
  return null;
}
