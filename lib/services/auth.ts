import bcrypt from "bcryptjs";
import { serverConfig } from "@/lib/config";
import { id, nowIso, repo } from "@/lib/db/file-store";
import type { User } from "@/lib/db/types";
import { ServiceError } from "@/lib/errors";
import { isSchoolEmail, normalizeEmail } from "@/lib/schools";
import { randomToken, referralCode, sha256 } from "@/lib/security";
import { appOrigin, sendPasswordResetEmail } from "@/lib/email/transactional";

const SESSION_DAYS = 30;

export async function signUp(input: { email: string; password: string; name: string }) {
  const email = input.email.trim().toLowerCase();
  const emailNormalized = normalizeEmail(email);
  if (!isSchoolEmail(email)) {
    throw new ServiceError("Use a school email address. Personal inboxes such as Gmail are not eligible.", "school_email");
  }
  if (input.password.length < 8) throw new ServiceError("Use at least 8 characters for your password.", "password");
  if (!input.name.trim()) throw new ServiceError("Add your name so outreach can be signed.", "name");
  if (await repo.getUserByEmail(emailNormalized)) {
    throw new ServiceError("An account with this email already exists.", "duplicate", 409);
  }

  let code = referralCode();
  while (await repo.getUserByReferralCode(code)) code = referralCode();
  const user = await repo.createUser({
    id: id(),
    email,
    emailNormalized,
    passwordHash: await bcrypt.hash(input.password, 10),
    name: input.name.trim(),
    schoolEmailVerifiedAt: null,
    authProvider: "password",
    createdAt: nowIso(),
    referralCode: code,
    referredByUserId: null,
    onboardingStep: "profile",
    role: "student",
    deletedAt: null,
    demoUser: false,
  });

  const token = await issueToken(user.id, "verify_email");
  await repo.insertAudit({ userId: user.id, action: "signup", metadata: { provider: "password" } });
  await repo.insertAnalytics({ userId: user.id, name: "signup", properties: { provider: "password" } });
  return { user: publicUser(user), verifyToken: exposeDevToken(token) };
}

export async function resendVerification(email: string) {
  const user = await repo.getUserByEmail(normalizeEmail(email));
  if (!user || user.schoolEmailVerifiedAt) return { devToken: null as string | null };
  const token = await issueToken(user.id, "verify_email");
  return { devToken: exposeDevToken(token) };
}

export async function verifyEmail(rawToken: string) {
  const record = await repo.getTokenByHash(sha256(rawToken));
  if (!record || record.purpose !== "verify_email" || record.usedAt || new Date(record.expiresAt).getTime() < Date.now()) {
    throw new ServiceError("This verification link is invalid or expired.", "token");
  }
  const config = serverConfig();
  await repo.grantCreditsOnce({
    userId: record.userId,
    entryType: "signup_grant",
    amount: config.signupCredits,
    bucket: "allowance",
    idempotencyKey: `signup:${record.userId}`,
    includedAllowance: config.signupCredits,
    note: "New verified student",
  });
  const user = await repo.updateUser(record.userId, { schoolEmailVerifiedAt: nowIso() });
  await repo.consumeToken(sha256(rawToken), "verify_email");
  await repo.insertAudit({ userId: record.userId, action: "email_verified", metadata: {} });
  return user ? publicUser(user) : null;
}

export async function login(email: string, password: string) {
  const user = await repo.getUserByEmail(normalizeEmail(email));
  if (!user?.passwordHash) throw new ServiceError("Email or password is incorrect.", "credentials", 401);
  const matches = await bcrypt.compare(password, user.passwordHash);
  if (!matches) throw new ServiceError("Email or password is incorrect.", "credentials", 401);
  if (!user.schoolEmailVerifiedAt) throw new ServiceError("Verify your school email before signing in.", "unverified", 403);
  const token = randomToken();
  await repo.createSession({
    id: id(),
    userId: user.id,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + SESSION_DAYS * 86400000).toISOString(),
    createdAt: nowIso(),
  });
  return { token, user: publicUser(user) };
}

export async function loginWithOAuth(input: { email: string; name: string; provider: "google" | "microsoft"; emailVerified: boolean }) {
  const email = input.email.trim().toLowerCase();
  if (!isSchoolEmail(email)) {
    throw new ServiceError("Sign in with the school email on your Google or Microsoft account.", "school_email");
  }
  if (!input.emailVerified) throw new ServiceError("That provider did not confirm the email address.", "unverified");
  let user = await repo.getUserByEmail(normalizeEmail(email));
  if (!user) {
    let code = referralCode();
    while (await repo.getUserByReferralCode(code)) code = referralCode();
    user = await repo.createUser({
      id: id(),
      email,
      emailNormalized: normalizeEmail(email),
      passwordHash: null,
      name: input.name || email.split("@")[0],
      schoolEmailVerifiedAt: nowIso(),
      authProvider: input.provider,
      createdAt: nowIso(),
      referralCode: code,
      referredByUserId: null,
      onboardingStep: "profile",
      role: "student",
      deletedAt: null,
      demoUser: false,
    });
    await repo.grantCreditsOnce({
      userId: user.id,
      entryType: "signup_grant",
      amount: serverConfig().signupCredits,
      bucket: "allowance",
      idempotencyKey: `signup:${user.id}`,
      includedAllowance: serverConfig().signupCredits,
    });
  } else if (!user.schoolEmailVerifiedAt) {
    user = (await repo.updateUser(user.id, { schoolEmailVerifiedAt: nowIso() }))!;
    await repo.grantCreditsOnce({
      userId: user.id,
      entryType: "signup_grant",
      amount: serverConfig().signupCredits,
      bucket: "allowance",
      idempotencyKey: `signup:${user.id}`,
      includedAllowance: serverConfig().signupCredits,
    });
  }
  const token = randomToken();
  await repo.createSession({
    id: id(),
    userId: user.id,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + SESSION_DAYS * 86400000).toISOString(),
    createdAt: nowIso(),
  });
  return { token, user: publicUser(user) };
}

export async function userFromSessionToken(token: string | undefined | null) {
  if (!token) return null;
  const session = await repo.getSessionByTokenHash(sha256(token));
  if (!session || new Date(session.expiresAt).getTime() < Date.now()) return null;
  const user = await repo.getUserById(session.userId);
  return user ? { session, user } : null;
}

export async function logout(token: string | undefined | null) {
  if (!token) return;
  const session = await repo.getSessionByTokenHash(sha256(token));
  if (session) await repo.deleteSession(session.id);
}

export async function requestPasswordReset(email: string, origin?: string) {
  const user = await repo.getUserByEmail(normalizeEmail(email));
  if (!user) return { sent: false, resetUrl: null as string | null };
  const token = await issueToken(user.id, "reset_password");
  const resetUrl = `${appOrigin(origin)}/reset?token=${encodeURIComponent(token)}`;
  const sent = await sendPasswordResetEmail(user.email, resetUrl);
  return { sent, resetUrl: exposeDevToken(token) ? resetUrl : null };
}

export async function resetPassword(rawToken: string, password: string) {
  if (password.length < 8) throw new ServiceError("Use at least 8 characters for your password.", "password");
  const consumed = await repo.consumeToken(sha256(rawToken), "reset_password");
  if (!consumed) throw new ServiceError("This reset link is invalid or expired.", "token");
  await repo.updateUser(consumed.userId, { passwordHash: await bcrypt.hash(password, 10) });
  await repo.deleteUserSessions(consumed.userId);
}

async function issueToken(userId: string, purpose: "verify_email" | "reset_password") {
  const token = randomToken();
  await repo.createToken({
    id: id(),
    userId,
    purpose,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
    usedAt: null,
    createdAt: nowIso(),
  });
  return token;
}

function exposeDevToken(token: string) {
  if (process.env.UNNEPO_DEV_VERIFY === "true") return token;
  // No mail provider is configured, so the browser that just signed up finishes verification itself.
  if (process.env.RESEND_API_KEY && process.env.NODE_ENV === "production") return null;
  return token;
}

export function publicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    verified: Boolean(user.schoolEmailVerifiedAt),
    referralCode: user.referralCode,
    onboardingStep: user.onboardingStep,
    role: user.role,
    authProvider: user.authProvider,
  };
}

export async function isAdminEmail(user: User) {
  const list = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return user.role === "admin" || list.includes(user.email.toLowerCase());
}
