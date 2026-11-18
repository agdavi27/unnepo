import { CHROME_STORE_URL } from "@/lib/config";
import { id, withLock } from "@/lib/db/file-store";
import type { InstallLinkSignup } from "@/lib/db/types";
import { sendInstallLinkEmail, sendInstallReminderEmail, type InstallEmailInput } from "@/lib/email/transactional";
import { ServiceError } from "@/lib/errors";
import { rateLimit } from "@/lib/http";
import { normalizeEmail } from "@/lib/schools";
import { randomToken } from "@/lib/security";

/**
 * /get, the landing page for Instagram ads. Most of that traffic is on a phone, where the Chrome extension can't be
 * installed, so the page asks for an email and sends the install link to open on a computer, then one reminder the
 * next day (Vercel's daily schedule calls /api/cron/install-reminders; see vercel.json).
 */

/**
 * The demo of the extension at work, shown on /get and in both emails, drawn by scripts/demo-animation.ts (run it
 * again after changing it): the spider drops in, shrinks onto a job application, then fills it, writes the cover
 * letter and finds people to follow up with. In public/get/:
 *   demo.webp (720 px animated, lossless, ~330 KB; the page)
 *   demo.gif  (480 px, ~560 KB; email apps don't play WebP)
 *   demo.jpg  (one still, for people who turn off motion)
 * With `ready: false` the page shows a stand-in card and the emails leave the GIF out.
 */
export const DEMO_MEDIA = {
  ready: true,
  webp: "/get/demo.webp",
  still: "/get/demo.jpg",
  gif: "/get/demo.gif",
  width: 720,
  height: 450,
};

/** The reminder goes on the first daily run at least this long after they asked (the run is 15:00 UTC, morning in the US). */
export const REMINDER_AFTER_MS = 10 * 60 * 60 * 1000;
/** Past this, a reminder the schedule missed isn't sent at all. */
export const REMINDER_GIVE_UP_MS = 7 * 24 * 60 * 60 * 1000;
/** Per address: at most this many install-link emails a day, and none within a couple of minutes of the last. */
export const SENDS_PER_EMAIL_PER_DAY = 3;
export const RESEND_GAP_MS = 2 * 60 * 1000;
/** Per IP: sign-ups an hour (a dorm or a phone carrier can share one, so not too tight). */
export const SIGNUPS_PER_IP_PER_HOUR = 8;

const DAY_MS = 24 * 60 * 60 * 1000;
const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/i;

export function validInstallEmail(raw: unknown) {
  const email = String(raw ?? "").trim();
  if (!email || email.length > 254 || !EMAIL.test(email)) return null;
  return email;
}

function emailInput(signup: InstallLinkSignup, origin: string): InstallEmailInput {
  return {
    to: signup.email,
    installUrl: CHROME_STORE_URL,
    unsubscribeUrl: `${origin}/api/install-link/unsubscribe?token=${encodeURIComponent(signup.token)}`,
    gifUrl: DEMO_MEDIA.ready ? `${origin}${DEMO_MEDIA.gif}` : null,
  };
}

/**
 * Someone typed their email on /get. Checks it, holds back repeats (per IP and per address), saves the sign-up and
 * sends the install link right away. `alreadySent` means a copy went out minutes ago, so this one was skipped.
 */
export async function requestInstallLink(input: { email: unknown; ip: string; source?: unknown; origin: string; now?: number }) {
  const now = input.now ?? Date.now();
  const email = validInstallEmail(input.email);
  if (!email) throw new ServiceError("Enter a real email address, like you@gmail.com.", "invalid_email", 400);
  if (!rateLimit(`install-link-ip:${input.ip}`, SIGNUPS_PER_IP_PER_HOUR, 60 * 60 * 1000)) {
    throw new ServiceError("Too many tries from here. Try again in an hour.", "rate_limited", 429);
  }
  const emailNormalized = normalizeEmail(email);
  const source = typeof input.source === "string" && input.source.trim() ? input.source.trim().slice(0, 80) : undefined;
  const at = new Date(now).toISOString();

  const claimed = await withLock((db) => {
    db.installLinks = db.installLinks ?? [];
    let signup = db.installLinks.find((item) => item.emailNormalized === emailNormalized);
    if (signup) {
      const today = signup.sends.filter((sent) => now - Date.parse(sent) < DAY_MS);
      const last = today.length ? Math.max(...today.map((sent) => Date.parse(sent))) : 0;
      if (last && now - last < RESEND_GAP_MS) return { signup, send: false as const };
      if (today.length >= SENDS_PER_EMAIL_PER_DAY) return { signup: null, send: false as const };
      // Asking again is asking to hear from us again.
      delete signup.unsubscribedAt;
      signup.sends = [...today, at];
    } else {
      signup = { id: id(), email, emailNormalized, source, token: randomToken(), createdAt: at, sends: [at] };
      db.installLinks.push(signup);
    }
    return { signup, send: true as const };
  });

  if (!claimed.signup) throw new ServiceError("We've already sent this address the link a few times today. Check your inbox (and spam).", "rate_limited", 429);
  if (!claimed.send) return { ok: true, email, alreadySent: true };

  const sent = await sendInstallLinkEmail(emailInput(claimed.signup, input.origin)).catch((error) => {
    console.error("Install link email failed", error);
    return false;
  });
  if (!sent) {
    // Give the send back, so trying again isn't counted against them.
    await withLock((db) => {
      const row = db.installLinks?.find((item) => item.id === claimed.signup.id);
      if (row) row.sends = row.sends.filter((stamp) => stamp !== at);
    });
    throw new ServiceError("We couldn't send the email just now. Try again in a minute.", "email_failed", 503);
  }
  return { ok: true, email, alreadySent: false };
}

/** Whether this sign-up's reminder should go out on a run at `now`: once, 10 hours or more after they asked, within a week. */
export function reminderDue(signup: InstallLinkSignup, now: number) {
  if (signup.reminderSentAt || signup.reminderSkipped || signup.unsubscribedAt) return false;
  const age = now - Date.parse(signup.createdAt);
  return age >= REMINDER_AFTER_MS && age <= REMINDER_GIVE_UP_MS;
}

/**
 * The daily run. Each sign-up gets its one reminder when due, unless an account now exists for that address (making
 * one happens in the extension, so they've installed it or are about to). Claimed before sending, so two overlapping
 * runs can't both send; a failed send is released for the next run.
 */
export async function sendDueReminders(origin: string, now = Date.now()) {
  const at = new Date(now).toISOString();
  const work = await withLock((db) => {
    const due: InstallLinkSignup[] = [];
    let skipped = 0;
    for (const signup of db.installLinks ?? []) {
      if (signup.reminderSentAt || signup.reminderSkipped || signup.unsubscribedAt) continue;
      if (now - Date.parse(signup.createdAt) > REMINDER_GIVE_UP_MS) {
        signup.reminderSkipped = "too_old";
        continue;
      }
      if (!reminderDue(signup, now)) continue;
      if (db.users.some((user) => user.emailNormalized === signup.emailNormalized && !user.deletedAt)) {
        signup.reminderSkipped = "signed_up";
        skipped += 1;
        continue;
      }
      signup.reminderSentAt = at;
      due.push({ ...signup });
    }
    return { due, skipped };
  });

  let sent = 0;
  let failed = 0;
  for (const signup of work.due) {
    const ok = await sendInstallReminderEmail(emailInput(signup, origin)).catch(() => false);
    if (ok) {
      sent += 1;
      continue;
    }
    failed += 1;
    await withLock((db) => {
      const row = db.installLinks?.find((item) => item.id === signup.id);
      if (row && row.reminderSentAt === at) delete row.reminderSentAt;
    });
  }
  return { sent, skipped: work.skipped, failed };
}

/** The unsubscribe link in both emails. True when the token matched someone. */
export async function unsubscribeInstallLink(token: string, now = Date.now()) {
  if (!token) return false;
  return withLock((db) => {
    const signup = db.installLinks?.find((item) => item.token === token);
    if (!signup) return false;
    signup.unsubscribedAt = signup.unsubscribedAt ?? new Date(now).toISOString();
    return true;
  });
}

/** For tests and the cron: the stored sign-ups. */
export async function listInstallLinks() {
  return withLock((db) => db.installLinks ?? []);
}
