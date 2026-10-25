import { cookies } from "next/headers";
import { ServiceError } from "@/lib/errors";
import { userFromSessionToken } from "@/lib/services/auth";

export async function readSession() {
  const token = (await cookies()).get("unnepo_session")?.value;
  return userFromSessionToken(token);
}

export async function requireUser() {
  const session = await readSession();
  if (!session) throw new ServiceError("Sign in to continue.", "auth", 401);
  return session.user;
}

export async function setSessionCookie(token: string) {
  (await cookies()).set("unnepo_session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete("unnepo_session");
}

export function publicOrigin(request: Request) {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (forwardedHost) return `${forwardedProto || "https"}://${forwardedHost}`;
  return new URL(request.url).origin;
}

export function assertSameOrigin(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  if (site === "same-origin" || site === "none") return;
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return;
  const originHost = new URL(origin).host;
  if (originHost === host) return;
  const forwarded = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  if (forwarded && originHost === forwarded) return;
  throw new ServiceError("Cross-origin request blocked.", "origin", 403);
}

export function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

export async function errorResponse(error: unknown) {
  if (error instanceof ServiceError) return json({ error: error.message, code: error.code }, error.status);
  console.error(error);
  if (process.env.SENTRY_DSN) {
    try {
      const Sentry = await import("@sentry/node");
      if (!Sentry.getClient()) Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0 });
      Sentry.captureException(error);
    } catch {
      // Monitoring is optional when the DSN or package is unavailable.
    }
  }
  return json({ error: "Something went wrong. Try again." }, 500);
}

const buckets = new Map<string, number[]>();

export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((stamp) => now - stamp < windowMs);
  if (hits.length >= limit) return false;
  hits.push(now);
  buckets.set(key, hits);
  return true;
}
