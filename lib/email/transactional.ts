import { CONTACT_EMAIL, serverConfig } from "@/lib/config";

export async function sendPasswordResetEmail(to: string, resetUrl: string) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  const from = process.env.RESEND_FROM || `Unnepo <${CONTACT_EMAIL}>`;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: "Reset your Unnepo password",
      reply_to: CONTACT_EMAIL,
      text: `Someone asked to reset the password on your Unnepo account.\n\nChoose a new password here (the link works once and expires in 24 hours):\n${resetUrl}\n\nIf it wasn't you, ignore this email: your password stays the same.\n\nQuestions? ${CONTACT_EMAIL}`,
      html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;color:#111;line-height:1.5">
<p style="font-size:18px;font-weight:700;margin:0 0 16px">Reset your Unnepo password</p>
<p style="margin:0 0 20px">Someone asked to reset the password on your Unnepo account. Choose a new one below. The link works once and expires in 24 hours.</p>
<p style="margin:0 0 24px"><a href="${resetUrl}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px">Choose a new password</a></p>
<p style="margin:0 0 8px;font-size:13px;color:#555">If it wasn't you, ignore this email: your password stays the same.</p>
<p style="margin:0;font-size:13px;color:#555">Questions? <a href="mailto:${CONTACT_EMAIL}" style="color:#555">${CONTACT_EMAIL}</a></p>
</div>`,
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error("Resend rejected the reset email", response.status, detail);
  }
  return response.ok;
}

export function appOrigin(origin?: string) {
  return (origin || serverConfig().appUrl).replace(/\/$/, "");
}

/** A friend request to someone, who may not have an account yet. False when email isn't set up or it failed. */
export async function sendFriendInviteEmail(to: string, fromName: string, link: string) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  const from = process.env.RESEND_FROM || `Unnepo <${CONTACT_EMAIL}>`;
  const name = fromName.replace(/[<>&"]/g, "").slice(0, 80) || "A friend";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [to],
      subject: `${name} added you as a friend on Unnepo`,
      reply_to: CONTACT_EMAIL,
      text: `${name} wants to keep each other going on job applications. Accept, and you'll each see how many jobs the other applied to this week. Nothing else is shared.\n\nOpen the Unnepo extension and go to Me, or sign up here:\n${link}\n\nQuestions? ${CONTACT_EMAIL}`,
      html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;color:#111;line-height:1.5">
<p style="font-size:18px;font-weight:700;margin:0 0 16px">${name} added you as a friend</p>
<p style="margin:0 0 20px">Accept, and you'll each see how many jobs the other applied to this week. Nothing else is shared.</p>
<p style="margin:0 0 24px"><a href="${link}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px">Open Unnepo</a></p>
<p style="margin:0;font-size:13px;color:#555">Already have the extension? Open it and go to Me to accept.</p>
</div>`,
    }),
  });
  if (!response.ok) console.error("Resend rejected the friend invite", response.status, await response.text().catch(() => ""));
  return response.ok;
}
