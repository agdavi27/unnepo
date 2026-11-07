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
