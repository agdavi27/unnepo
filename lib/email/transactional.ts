import { serverConfig } from "@/lib/config";

export async function sendPasswordResetEmail(to: string, resetUrl: string) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  const from = process.env.RESEND_FROM || "Unnepo <beth.t@example.com>";
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
      text: `Use this link to choose a new password. It expires in 24 hours.\n\n${resetUrl}\n\nIf you did not ask for this, ignore the email.`,
      html: `<p>Use this link to choose a new password. It expires in 24 hours.</p><p><a href="${resetUrl}">Reset password</a></p><p>If you did not ask for this, ignore the email.</p>`,
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
