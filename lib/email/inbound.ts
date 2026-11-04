import { timingSafeEqual } from "node:crypto";
import { htmlToText } from "@/lib/apply/extract";
import { tokenIn } from "@/lib/email/address";
import type { InboundEmail } from "@/lib/email/filter";
import { processEmail, type Processed } from "@/lib/email/process";
import { emailInboxes } from "@/lib/email/store";

/**
 * Postmark's inbound webhook: Postmark receives the email at the student's address and posts it here as JSON.
 * Postmark doesn't sign these posts, so the webhook's address carries a username and password (Basic auth) that
 * only Postmark and Unnepo know; anything else is turned away. The email is read in memory and never logged.
 */

const same = (a: string, b: string) => {
  const [x, y] = [Buffer.from(a), Buffer.from(b)];
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Whether the request carries the webhook's username and password. Not set up: nothing gets in. */
export function webhookAuthorized(request: Request) {
  const user = process.env.INBOUND_WEBHOOK_USER?.trim();
  const secret = process.env.INBOUND_WEBHOOK_SECRET?.trim();
  if (!user || !secret || secret.length < 16) return false;
  const header = request.headers.get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("basic ")) return false;
  const [givenUser, ...rest] = Buffer.from(header.slice(6).trim(), "base64").toString("utf8").split(":");
  return same(givenUser ?? "", user) && same(rest.join(":"), secret);
}

type PostmarkAddress = { Email?: string };
type PostmarkInbound = {
  From?: string; FromFull?: PostmarkAddress & { Name?: string }; To?: string; ToFull?: PostmarkAddress[]; CcFull?: PostmarkAddress[]; BccFull?: PostmarkAddress[];
  OriginalRecipient?: string; Subject?: string; Date?: string; MessageID?: string; TextBody?: string; HtmlBody?: string;
  Headers?: Array<{ Name?: string; Value?: string }>;
};

/**
 * An email the student forwarded by hand ("Fwd: …") carries the original's sender, date and subject at the top of
 * its text. Those are what count, not the student's own address.
 */
export function unwrapForward(email: InboundEmail): InboundEmail {
  if (!/^\s*(fwd?|fw)\s*:/i.test(email.subject)) return email;
  const block = email.text.match(/-{2,}\s*(?:Forwarded message|Original Message)\s*-{2,}([\s\S]{0,1200})/i)?.[1] ?? email.text.slice(0, 1200);
  const field = (name: string) => block.match(new RegExp(`^\\s*\\*?${name}:\\*?\\s*(.+)$`, "im"))?.[1]?.trim() ?? "";
  const from = field("From");
  if (!from) return email;
  return { ...email, from, subject: field("Subject") || email.subject.replace(/^\s*(fwd?|fw)\s*:\s*/i, ""), date: field("Date") || field("Sent") || email.date };
}

/** The email in Postmark's post: who it was for, and what Unnepo reads. */
export function fromPostmark(body: PostmarkInbound): { recipients: string[]; email: InboundEmail } {
  const recipients = [body.OriginalRecipient, ...(body.ToFull ?? []).map((item) => item.Email), ...(body.CcFull ?? []).map((item) => item.Email), ...(body.BccFull ?? []).map((item) => item.Email), body.To]
    .filter((item): item is string => Boolean(item));
  // The sender's own Message-ID, so the same email forwarded twice is one email. Postmark's id when it has none.
  const header = (body.Headers ?? []).find((item) => item.Name?.toLowerCase() === "message-id")?.Value;
  const from = body.FromFull?.Email ? `${body.FromFull.Name ?? ""} <${body.FromFull.Email}>`.trim() : body.From ?? "";
  // Some emails only say "view this in a browser" as text: the HTML is the real email then.
  const plain = body.TextBody?.trim() ?? "";
  const fromHtml = body.HtmlBody ? htmlToText(body.HtmlBody) : "";
  const text = plain.length >= 200 || plain.length >= fromHtml.length ? plain : fromHtml;
  return { recipients, email: unwrapForward({ from, subject: body.Subject ?? "", date: body.Date, text, messageId: header || body.MessageID, html: body.HtmlBody }) };
}

/** One post from Postmark. 403 for an address no student has (Postmark doesn't retry those). */
export async function handlePostmark(raw: unknown): Promise<{ status: number; result?: Processed["outcome"] }> {
  const { recipients, email } = fromPostmark((raw ?? {}) as PostmarkInbound);
  const token = recipients.map(tokenIn).find(Boolean);
  const inbox = token ? await emailInboxes.byToken(token) : null;
  if (!inbox) return { status: 403 };
  const processed = await processEmail(inbox.userId, email, "forward");
  return { status: 200, result: processed.outcome };
}
