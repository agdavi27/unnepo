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

/**
 * A friend request, sent from RESEND_FROM (contact@unnepo.com by default) as an invitation to compete: who added them, how many jobs that
 * person applied to this week, and a button to sign up (or log in, when they already have an account).
 * False when email isn't set up or it failed.
 */
export async function sendFriendInviteEmail(input: { to: string; fromName: string; appliedThisWeek: number; hasAccount: boolean; origin: string }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  const name = input.fromName.replace(/[<>&"]/g, "").slice(0, 80) || "A friend";
  const first = name.split(/\s+/)[0] || name;
  const link = input.hasAccount ? `${input.origin}/login` : `${input.origin}/signup?email=${encodeURIComponent(input.to)}`;
  const button = input.hasAccount ? "Accept the challenge" : "Sign up and accept";
  const count = input.appliedThisWeek;
  const score = count > 0
    ? `${first} has applied to ${count} ${count === 1 ? "job" : "jobs"} this week. Think you can beat that?`
    : `The week just started. Whoever applies to more jobs by Sunday wins.`;
  const how = input.hasAccount
    ? "Open the Unnepo extension and go to Me to accept."
    : "Sign up with your school email, add the Chrome extension, and accept under Me. It's free.";
  /** Why Unnepo, for someone who hasn't heard of it. */
  const perks = input.hasAccount ? [] : [
    "Autofills job applications from your resume, so each one takes minutes",
    "Tracks every job you apply to, with a calendar of every day you did something",
    "Finds people to email at each company and reminds you to follow up",
  ];
  const perksText = perks.length ? `\n\nWhat Unnepo does:\n${perks.map((perk) => `- ${perk}`).join("\n")}` : "";
  const perksHtml = perks.length ? `<p style="margin:0 0 8px;font-weight:700">What Unnepo does</p>
<ul style="margin:0 0 22px;padding-left:20px;color:#333">${perks.map((perk) => `<li style="margin:0 0 4px">${perk}</li>`).join("")}</ul>` : "";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.RESEND_FROM || `Unnepo <${CONTACT_EMAIL}>`,
      to: [input.to],
      subject: `${name} wants to compete with you on Unnepo`,
      reply_to: CONTACT_EMAIL,
      text: `${name} wants to compete with you on job applications.\n\n${score}\n\nOnce you accept, you each see how many jobs the other applied to this week. Nothing else is shared.${perksText}\n\n${how}\n\n${button}: ${link}\n\nQuestions? ${CONTACT_EMAIL}`,
      html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;color:#111;line-height:1.5">
<p style="margin:0 0 6px;font-size:12px;letter-spacing:1.2px;text-transform:uppercase;color:#666">Friend challenge</p>
<p style="font-size:22px;font-weight:800;margin:0 0 14px;letter-spacing:-.3px">${name} wants to compete with you</p>
<p style="margin:0 0 14px;font-size:16px">${score}</p>
<p style="margin:0 0 22px;color:#333">Once you accept, you each see how many jobs the other applied to this week, side by side. Nothing else is shared.</p>
${perksHtml}
<p style="margin:0 0 24px"><a href="${link}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;font-weight:600;padding:13px 22px;border-radius:10px">${button}</a></p>
<p style="margin:0 0 16px;font-size:14px;color:#444">${how}</p>
<p style="margin:0;font-size:12px;color:#777">You got this because ${name} added this address on Unnepo. Ignore it and nothing happens. Questions? <a href="mailto:${CONTACT_EMAIL}" style="color:#777">${CONTACT_EMAIL}</a></p>
</div>`,
    }),
  });
  if (!response.ok) console.error("Resend rejected the friend invite", response.status, await response.text().catch(() => ""));
  return response.ok;
}
