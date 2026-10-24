import { id, nowIso, repo } from "@/lib/db/file-store";
import { ServiceError } from "@/lib/errors";
import { encryptSecret, randomToken } from "@/lib/security";
import { serverConfig } from "@/lib/config";
import { loginWithOAuth } from "@/lib/services/auth";

type Provider = "google" | "microsoft" | "gmail" | "outlook";

const LOGIN = new Set(["google", "microsoft"]);

export async function beginOAuth(provider: Provider, userId: string | null) {
  const client = clientFor(provider);
  if (!client.id) throw new ServiceError(`${label(provider)} is not configured yet.`, "oauth_unconfigured", 400);
  const state = randomToken();
  await repo.createOAuthState({
    id: id(),
    state,
    provider,
    userId,
    purpose: LOGIN.has(provider) ? "login" : "mailbox",
    createdAt: nowIso(),
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  });
  const redirectUri = `${serverConfig().appUrl}/api/oauth/${provider}/callback`;
  const url = new URL(client.authorize);
  url.searchParams.set("client_id", client.id);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", client.scope);
  url.searchParams.set("state", state);
  if (provider === "google" || provider === "gmail") url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  return url.toString();
}

export async function finishOAuth(provider: Provider, code: string, state: string) {
  const saved = await repo.consumeOAuthState(state);
  if (!saved || saved.provider !== provider) throw new ServiceError("This sign-in attempt expired. Start again.", "oauth_state");
  const client = clientFor(provider);
  const redirectUri = `${serverConfig().appUrl}/api/oauth/${provider}/callback`;
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
  if (provider === "google" || provider === "microsoft") {
    return loginWithOAuth({
      email: profile.email,
      name: profile.name,
      provider: provider === "google" ? "google" : "microsoft",
      emailVerified: profile.verified,
    });
  }
  if (!saved.userId) throw new ServiceError("Sign in before connecting a mailbox.", "auth", 401);
  await repo.upsertMailbox({
    id: id(),
    userId: saved.userId,
    provider: provider === "gmail" ? "gmail" : "outlook",
    email: profile.email,
    accessTokenEncrypted: encryptSecret(tokens.access_token),
    refreshTokenEncrypted: tokens.refresh_token ? encryptSecret(tokens.refresh_token) : null,
    expiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null,
    connectedAt: nowIso(),
  });
  return { mailbox: profile.email };
}

function clientFor(provider: Provider) {
  if (provider === "google" || provider === "gmail") {
    return {
      id: process.env.GOOGLE_CLIENT_ID || "",
      secret: process.env.GOOGLE_CLIENT_SECRET || "",
      authorize: "https://accounts.google.com/o/oauth2/v2/auth",
      token: "https://oauth2.googleapis.com/token",
      scope:
        provider === "gmail"
          ? "openid email profile https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly"
          : "openid email profile",
    };
  }
  return {
    id: process.env.MICROSOFT_CLIENT_ID || "",
    secret: process.env.MICROSOFT_CLIENT_SECRET || "",
    authorize: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    token: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scope: provider === "outlook" ? "offline_access openid email profile User.Read Mail.Send Mail.Read" : "openid email profile User.Read",
  };
}

async function fetchProfile(provider: Provider, accessToken: string) {
  if (provider === "google" || provider === "gmail") {
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
  if (provider === "google" || provider === "gmail") return "Google";
  return "Microsoft";
}
