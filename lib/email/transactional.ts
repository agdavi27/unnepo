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
 * A friend request, sent from RESEND_FROM (contact@unnepo.com by default) as a fight night: the friend's jobs this
 * week against a "?", Unnepo's spider refereeing (public/email/spider-angry.gif, made by scripts/email-spider-gif.ts),
 * and a button to sign up (or log in, when they already have an account). Laid out in tables with inline styles,
 * so it looks the same in Gmail, Apple Mail and Outlook. False when email isn't set up or it failed.
 */
export async function sendFriendInviteEmail(input: { to: string; fromName: string; appliedThisWeek: number; hasAccount: boolean; origin: string }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  const name = input.fromName.replace(/[<>&"]/g, "").slice(0, 80) || "A friend";
  const first = name.split(/\s+/)[0] || name;
  const link = input.hasAccount ? `${input.origin}/login` : `${input.origin}/signup?email=${encodeURIComponent(input.to)}`;
  const spider = `${input.origin}/email/spider-angry.gif`;
  const count = input.appliedThisWeek;
  const jobs = count === 1 ? "job" : "jobs";
  const score = count > 0
    ? `${first} has applied to ${count} ${jobs} this week. Think you can beat that?`
    : `The week just started. Whoever applies to more jobs by Sunday wins.`;
  const ref = count > 0
    ? `I'm the ref. I want a clean fight. No ghosting recruiters. Touch gloves and start applying.`
    : `I'm the ref. Nobody's thrown a punch yet. First one to apply takes the lead.`;
  const how = input.hasAccount
    ? "Open the Unnepo extension and go to Me to accept."
    : "Sign up with your school email, add the Chrome extension, and accept under Me. It's free.";
  /** Why Unnepo, for someone who hasn't heard of it: the fighter's training kit. */
  const perks = input.hasAccount ? [] : [
    "Autofills job applications from your resume, so each one takes minutes",
    "Tracks every job you apply to, with a calendar of every day you did something",
    "Finds people to email at each company and reminds you to follow up",
  ];
  const perksText = perks.length ? `\n\nWhat Unnepo does:\n${perks.map((perk) => `- ${perk}`).join("\n")}` : "";

  const font = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
  const corner = (label: string, value: string, note: string, dim: boolean) =>
    `<td width="40%" align="center" valign="top" style="${font};padding:0">
<p style="margin:0 0 6px;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#9A9AA3;font-weight:700">${label}</p>
<p style="margin:0;font-size:60px;line-height:60px;font-weight:900;color:${dim ? "#4A4A52" : "#FFFFFF"}">${value}</p>
<p style="margin:6px 0 0;font-size:12px;color:#8B8B94">${note}</p></td>`;
  const perksHtml = perks.length ? `<tr><td style="padding:0 32px 26px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;border:1px solid #26262C;border-radius:12px"><tr><td style="${font};padding:16px 18px;text-align:left">
<p style="margin:0 0 8px;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#FF4D4D;font-weight:800">Your training kit</p>
${perks.map((perk) => `<p style="margin:0 0 6px;font-size:14px;line-height:20px;color:#D4D4DA">&#9656;&nbsp; ${perk}</p>`).join("")}
</td></tr></table></td></tr>` : "";

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>${name} challenged you</title></head>
<body style="margin:0;padding:0;background:#000000">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${score}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000" style="background:#000000"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0C0C0E" style="max-width:480px;background:#0C0C0E;border-radius:18px;border:1px solid #1E1E24">
<tr><td align="center" style="${font};padding:30px 32px 4px">
<p style="margin:0;font-size:12px;letter-spacing:3px;text-transform:uppercase;color:#FF4D4D;font-weight:800">Tonight's main event</p>
<p style="margin:8px 0 0;font-size:22px;line-height:28px;font-weight:800;color:#FFFFFF">${name} challenged you to a&nbsp;job&nbsp;hunt</p>
</td></tr>
<tr><td style="padding:22px 24px 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
${corner(first, String(count), `${jobs} this week`, false)}
<td width="20%" align="center" valign="middle" style="${font};font-size:24px;font-weight:900;color:#FF4D4D;padding-top:14px">VS</td>
${corner("You", "?", "not in the ring yet", true)}
</tr></table></td></tr>
<tr><td align="center" style="padding:18px 32px 0"><img src="${spider}" width="120" height="120" alt="Unnepo's spider, refereeing" style="display:block;border:0;width:120px;height:120px"></td></tr>
<tr><td align="center" style="padding:4px 32px 24px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#FFFFFF" style="${font};background:#FFFFFF;border-radius:14px;padding:12px 18px;font-size:15px;line-height:21px;font-weight:700;color:#111111;text-align:center">&ldquo;${ref}&rdquo;</td></tr></table></td></tr>
<tr><td align="center" style="${font};padding:0 32px 22px;font-size:15px;line-height:22px;color:#C4C4CC">Accept and you each see how many jobs the other applied to this week, side by side. Nothing else is shared.</td></tr>
${perksHtml}
<tr><td align="center" style="padding:0 32px 14px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#FF4D4D" style="border-radius:10px;background:#FF4D4D"><a href="${link}" style="${font};display:inline-block;padding:14px 28px;font-size:15px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#FFFFFF;text-decoration:none;border-radius:10px">Step into the ring</a></td></tr></table></td></tr>
<tr><td align="center" style="${font};padding:0 32px 26px;font-size:13px;line-height:19px;color:#9A9AA3">${how}</td></tr>
<tr><td align="center" style="${font};padding:18px 32px 26px;border-top:1px solid #1E1E24;font-size:12px;line-height:18px;color:#6E6E78">You got this because ${name} added this address on Unnepo. Ignore it and nothing happens.<br>Questions? <a href="mailto:${CONTACT_EMAIL}" style="color:#9A9AA3">${CONTACT_EMAIL}</a></td></tr>
</table>
</td></tr></table>
</body></html>`;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.RESEND_FROM || `Unnepo <${CONTACT_EMAIL}>`,
      to: [input.to],
      subject: `${name} challenged you to a job hunt`,
      reply_to: CONTACT_EMAIL,
      text: `TONIGHT'S MAIN EVENT: ${name} vs you.\n\n${score}\n\nThe ref says: "${ref}"\n\nAccept and you each see how many jobs the other applied to this week. Nothing else is shared.${perksText}\n\n${how}\n\nStep into the ring: ${link}\n\nYou got this because ${name} added this address on Unnepo. Ignore it and nothing happens. Questions? ${CONTACT_EMAIL}`,
      html,
    }),
  });
  if (!response.ok) console.error("Resend rejected the friend invite", response.status, await response.text().catch(() => ""));
  return response.ok;
}
