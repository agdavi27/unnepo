import { id, nowIso, repo } from "@/lib/db/file-store";
import type { EmailMessage, OutreachStatus } from "@/lib/db/types";
import { classifyReply, statusForReply } from "@/lib/email/classify";
import { ServiceError } from "@/lib/errors";
import { decryptSecret } from "@/lib/security";

export type MailSender = {
  send: (input: { accessToken: string; to: string; subject: string; body: string; threadId?: string | null }) => Promise<{ id: string; threadId: string }>;
  replies: (input: { accessToken: string; threadId: string }) => Promise<Array<{ id: string; from: string; body: string }>>;
};

let senderOverride: MailSender | null = null;

export function setMailSenderForTests(sender: MailSender | null) {
  senderOverride = sender;
}

export async function saveDraft(userId: string, input: { savedContactId: string; subject: string; body: string; tone: string; purpose: string }) {
  const saved = await repo.getSavedById(userId, input.savedContactId);
  if (!saved) throw new ServiceError("Saved contact not found.", "not_found", 404);
  return repo.insertDraft({
    id: id(),
    userId,
    savedContactId: input.savedContactId,
    subject: input.subject,
    body: input.body,
    tone: input.tone,
    purpose: input.purpose,
    selectedFactIds: [],
    attachResume: false,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
}

export async function sendOutreach(userId: string, input: {
  savedContactId: string;
  subject: string;
  body: string;
  idempotencyKey: string;
  delivery: "provider" | "demo_outbox";
  followUpDays?: number | null;
  authorizeAutoFollowUp?: boolean;
}) {
  const saved = await repo.getSavedById(userId, input.savedContactId);
  if (!saved) throw new ServiceError("Saved contact not found.", "not_found", 404);
  if (saved.optOut) throw new ServiceError("This person opted out. Unnepo will not email them.", "opt_out", 409);
  const contact = await repo.getContact(saved.contactId);
  if (!contact?.email) throw new ServiceError("There is no email on file for this person yet.", "no_email");
  const existing = (await repo.listMessages(userId)).find((message) => message.idempotencyKey === input.idempotencyKey);
  if (existing) return { message: existing, created: false, creditsCharged: 0 };

  if (input.delivery === "demo_outbox") {
    const inserted = await repo.insertMessage({
      id: id(),
      userId,
      savedContactId: saved.id,
      direction: "outbound",
      provider: "demo",
      providerMessageId: null,
      providerThreadId: null,
      subject: input.subject,
      body: input.body,
      status: "demo_outbox",
      deliveryConfirmed: false,
      idempotencyKey: input.idempotencyKey,
      classification: null,
      createdAt: nowIso(),
      sentAt: null,
    });
    await maybeScheduleFollowUp(userId, saved.id, input.followUpDays, Boolean(input.authorizeAutoFollowUp));
    await repo.insertAudit({ userId, action: "demo_outbox", metadata: { savedContactId: saved.id } });
    return { message: inserted.message, created: inserted.created, creditsCharged: 0 };
  }

  const mailbox = (await repo.getMailboxSecrets(userId, "gmail")) ?? (await repo.getMailboxSecrets(userId, "outlook"));
  if (!mailbox?.accessTokenEncrypted) {
    throw new ServiceError("Connect Gmail or Outlook before sending. Nothing was marked as sent.", "mailbox_required", 409);
  }
  const sender = senderOverride ?? (mailbox.provider === "outlook" ? outlookSender : gmailSender);
  let providerResult: { id: string; threadId: string };
  try {
    providerResult = await sender.send({
      accessToken: senderOverride ? mailbox.accessTokenEncrypted : decryptSecret(mailbox.accessTokenEncrypted),
      to: contact.email,
      subject: input.subject,
      body: input.body,
    });
  } catch (error) {
    await repo.insertMessage({
      id: id(),
      userId,
      savedContactId: saved.id,
      direction: "outbound",
      provider: mailbox.provider === "outlook" ? "outlook" : "gmail",
      providerMessageId: null,
      providerThreadId: null,
      subject: input.subject,
      body: input.body,
      status: "failed",
      deliveryConfirmed: false,
      idempotencyKey: input.idempotencyKey,
      classification: null,
      createdAt: nowIso(),
      sentAt: null,
    });
    throw new ServiceError(error instanceof Error ? error.message : "The mailbox rejected the message. It was not marked as sent.", "send_failed", 502);
  }
  if (!providerResult.id) {
    throw new ServiceError("The mailbox did not confirm a message id. It was not marked as sent.", "send_unconfirmed", 502);
  }
  const inserted = await repo.insertMessage({
    id: id(),
    userId,
    savedContactId: saved.id,
    direction: "outbound",
    provider: mailbox.provider === "outlook" ? "outlook" : "gmail",
    providerMessageId: providerResult.id,
    providerThreadId: providerResult.threadId,
    subject: input.subject,
    body: input.body,
    status: "sent",
    deliveryConfirmed: true,
    idempotencyKey: input.idempotencyKey,
    classification: null,
    createdAt: nowIso(),
    sentAt: nowIso(),
  });
  await repo.updateSaved(userId, saved.id, { status: "contacted" });
  await maybeScheduleFollowUp(userId, saved.id, input.followUpDays, Boolean(input.authorizeAutoFollowUp));
  await repo.insertAudit({ userId, action: "email_sent", metadata: { provider: mailbox.provider, messageId: providerResult.id } });
  return { message: inserted.message, created: inserted.created, creditsCharged: 0 };
}

async function maybeScheduleFollowUp(userId: string, savedContactId: string, days: number | null | undefined, autoSend: boolean) {
  if (!days || days < 1) {
    if (autoSend) await repo.updateSaved(userId, savedContactId, { autoFollowUpAuthorized: true });
    return;
  }
  await repo.insertFollowUp({
    id: id(),
    userId,
    savedContactId,
    dueAt: new Date(Date.now() + days * 86400000).toISOString(),
    note: autoSend ? "Authorized single follow-up if there is no reply." : "Reminder only. This will not send automatically.",
    status: "open",
    autoSend,
    createdAt: nowIso(),
  });
  const followUpAt = new Date(Date.now() + days * 86400000).toISOString();
  if (autoSend) await repo.updateSaved(userId, savedContactId, { autoFollowUpAuthorized: true, followUpAt, status: "follow_up_needed" });
  else await repo.updateSaved(userId, savedContactId, { followUpAt });
}

export async function syncReplies(userId: string) {
  const mailbox = (await repo.getMailboxSecrets(userId, "gmail")) ?? (await repo.getMailboxSecrets(userId, "outlook"));
  const messages = (await repo.listMessages(userId)).filter((message) => message.deliveryConfirmed && message.providerThreadId);
  if (!mailbox?.accessTokenEncrypted) return { imported: 0 };
  const sender = senderOverride ?? (mailbox.provider === "outlook" ? outlookSender : gmailSender);
  let imported = 0;
  for (const message of messages) {
    const replies = await sender.replies({
      accessToken: senderOverride ? mailbox.accessTokenEncrypted! : decryptSecret(mailbox.accessTokenEncrypted),
      threadId: message.providerThreadId!,
    });
    for (const reply of replies) {
      const already = await repo.getMessageByProviderId(reply.id);
      if (already) continue;
      const classification = classifyReply(reply.body);
      const status = statusForReply(classification);
      await repo.insertMessage({
        id: id(),
        userId,
        savedContactId: message.savedContactId,
        direction: "inbound",
        provider: message.provider,
        providerMessageId: reply.id,
        providerThreadId: message.providerThreadId,
        subject: message.subject,
        body: reply.body,
        status: "replied",
        deliveryConfirmed: true,
        idempotencyKey: `reply:${reply.id}`,
        classification,
        createdAt: nowIso(),
        sentAt: nowIso(),
      });
      const patch: { status: OutreachStatus; optOut?: boolean } = { status };
      if (classification === "opt_out") patch.optOut = true;
      await repo.updateSaved(userId, message.savedContactId, patch);
      if (classification === "opt_out" || classification === "replied" || classification === "interested" || classification === "interview_scheduled" || classification === "closed") {
        const followups = await repo.listFollowUps(userId);
        for (const followup of followups.filter((item) => item.savedContactId === message.savedContactId && item.status === "open")) {
          await repo.updateFollowUp(userId, followup.id, { status: "cancelled" });
        }
      }
      imported += 1;
    }
  }
  return { imported };
}

const gmailSender: MailSender = {
  async send({ accessToken, to, subject, body }) {
    const raw = Buffer.from(`To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`)
      .toString("base64url");
    const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
    });
    if (!response.ok) throw new Error(`Gmail did not accept the message (${response.status}).`);
    const json = (await response.json()) as { id?: string; threadId?: string };
    if (!json.id) throw new Error("Gmail did not return a message id.");
    return { id: json.id, threadId: json.threadId || json.id };
  },
  async replies({ accessToken, threadId }) {
    const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return [];
    const json = (await response.json()) as { messages?: Array<{ id: string; payload?: { headers?: Array<{ name: string; value: string }>; body?: { data?: string } } }> };
    return (json.messages ?? []).slice(1).map((message) => {
      const from = message.payload?.headers?.find((header) => header.name.toLowerCase() === "from")?.value ?? "";
      const data = message.payload?.body?.data ?? "";
      const text = data ? Buffer.from(data, "base64url").toString("utf8") : "";
      return { id: message.id, from, body: text };
    });
  },
};

const outlookSender: MailSender = {
  async send({ accessToken, to, subject, body }) {
    const response = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message: { subject, body: { contentType: "Text", content: body }, toRecipients: [{ emailAddress: { address: to } }] }, saveToSentItems: true }),
    });
    if (!response.ok) throw new Error(`Outlook did not accept the message (${response.status}).`);
    return { id: `outlook_${crypto.randomUUID()}`, threadId: `outlook_thread_${to}` };
  },
  async replies() {
    return [];
  },
};

export function outreachSummary(messages: EmailMessage[], savedCount: number, statuses: OutreachStatus[]) {
  const confirmed = messages.filter((message) => message.direction === "outbound" && message.deliveryConfirmed);
  const demo = messages.filter((message) => message.status === "demo_outbox");
  const replied = statuses.filter((status) => ["replied", "interested", "interview_scheduled"].includes(status)).length;
  const positive = statuses.filter((status) => ["interested", "interview_scheduled"].includes(status)).length;
  const interviews = statuses.filter((status) => status === "interview_scheduled").length;
  const outreached = statuses.filter((status) => status !== "not_contacted").length;
  return {
    unlocked: savedCount,
    outreached,
    confirmedSends: confirmed.length,
    demoOutbox: demo.length,
    replies: replied,
    replyRate: outreached ? replied / outreached : 0,
    positiveRate: outreached ? positive / outreached : 0,
    interviews,
  };
}
