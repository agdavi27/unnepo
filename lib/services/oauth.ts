import { readFileSync } from "node:fs";
import { id, nowIso, repo } from "@/lib/db/file-store";
import { ServiceError } from "@/lib/errors";
import { randomToken } from "@/lib/security";
import { loginWithOAuth } from "@/lib/services/auth";

/** Sign in with Google or Microsoft. Unnepo doesn't connect mailboxes or send email. */
type Provider = "google" | "microsoft";

export async function beginOAuth(provider: Provider, userId: string | null, origin: string) {
  const client = clientFor(provider);
  if (!client.id || !client.secret) {
    throw new ServiceError(`${label(provider)} is not connected yet.`, "oauth_unconfigured", 400);
  }
  const state = randomToken();
  const redirectOrigin = origin.replace(/\/$/, "");
  await repo.createOAuthState({
    id: id(),
    state,
    provider,
    userId,
    purpose: "login",
    redirectOrigin,
    createdAt: nowIso(),
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  });
  const redirectUri = `${redirectOrigin}/api/oauth/${provider}/callback`;
  const url = new URL(client.authorize);
  url.searchParams.set("client_id", client.id);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", client.scope);
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

export function oauthReady() {
  const google = clientFor("google");
  const microsoft = clientFor("microsoft");
  return {
    google: Boolean(google.id && google.secret),
    microsoft: Boolean(microsoft.id && microsoft.secret),
  };
}

export async function finishOAuth(provider: Provider, code: string, state: string, origin: string) {
  const saved = await repo.consumeOAuthState(state);
  if (!saved || saved.provider !== provider) throw new ServiceError("This sign-in attempt expired. Start again.", "oauth_state");
  const client = clientFor(provider);
  const redirectUri = `${(saved.redirectOrigin || origin).replace(/\/$/, "")}/api/oauth/${provider}/callback`;
  const body = new URLSearchParams({
    client_id: client.id,
    client_secret: client.secret,
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const tokenResponse = await fetch(client.token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!tokenResponse.ok) throw new ServiceError("The provider rejected the authorization code.", "oauth_token", 502);
  const tokens = (await tokenResponse.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!tokens.access_token) throw new ServiceError("The provider did not return an access token.", "oauth_token", 502);
  const profile = await fetchProfile(provider, tokens.access_token);
  return loginWithOAuth({ email: profile.email, name: profile.name, provider, emailVerified: profile.verified });
}

function envValue(name: string) {
  if (process.env[name]) return process.env[name] || "";
  if (process.env.NODE_ENV === "production") return "";
  try {
    const line = readFileSync(".env.local", "utf8")
      .split("\n")
      .find((item) => item.startsWith(`${name}=`));
    return line ? line.slice(name.length + 1).trim().replace(/^["']|["']$/g, "") : "";
  } catch {
    return "";
  }
}

function clientFor(provider: Provider) {
  if (provider === "google") {
    return {
      id: envValue("GOOGLE_CLIENT_ID"),
      secret: envValue("GOOGLE_CLIENT_SECRET"),
      authorize: "https://accounts.google.com/o/oauth2/v2/auth",
      token: "https://oauth2.googleapis.com/token",
      scope: "openid email profile",
    };
  }
  return {
    id: envValue("MICROSOFT_CLIENT_ID"),
    secret: envValue("MICROSOFT_CLIENT_SECRET"),
    authorize: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    token: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scope: "openid email profile User.Read",
  };
}

async function fetchProfile(provider: Provider, accessToken: string) {
  if (provider === "google") {
    const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throw new ServiceError("Google did not return a profile.", "oauth_profile", 502);
    const body = (await response.json()) as { email?: string; name?: string; email_verified?: boolean };
    if (!body.email) throw new ServiceError("Google did not share an email address.", "oauth_profile");
    return { email: body.email, name: body.name || "", verified: Boolean(body.email_verified) };
  }
  const response = await fetch("https://graph.microsoft.com/v1.0/me", { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new ServiceError("Microsoft did not return a profile.", "oauth_profile", 502);
  const body = (await response.json()) as { mail?: string; userPrincipalName?: string; displayName?: string };
  const email = body.mail || body.userPrincipalName || "";
  if (!email) throw new ServiceError("Microsoft did not share an email address.", "oauth_profile");
  return { email, name: body.displayName || "", verified: true };
}

function label(provider: Provider) {
  if (provider === "google") return "Google";
  return "Microsoft";
}
