import { id, nowIso, repo } from "@/lib/db/file-store";
import { ServiceError } from "@/lib/errors";
import { randomToken, sha256 } from "@/lib/security";

/**
 * Tokens for the Chrome extension. They live in the sessions table, hashed with an "extension:" prefix,
 * so an extension token can't be used as a website cookie and a website cookie can't be used here.
 * They only work on /api/extension/*.
 */
const TOKEN_DAYS = 90;
const PREFIX = "unx_";

const hashOf = (token: string) => sha256(`extension:${token}`);

export async function issueExtensionToken(userId: string) {
  const token = `${PREFIX}${randomToken()}`;
  const expiresAt = new Date(Date.now() + TOKEN_DAYS * 86400000).toISOString();
  await repo.createSession({ id: id(), userId, tokenHash: hashOf(token), expiresAt, createdAt: nowIso() });
  await repo.insertAudit({ userId, action: "extension_connected", metadata: {} });
  return { token, expiresAt };
}

function bearer(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(\S+)$/i);
  return match && match[1].startsWith(PREFIX) ? match[1] : null;
}

export function hasExtensionToken(request: Request) {
  return Boolean(bearer(request));
}

/** The user behind the extension's token. */
export async function requireExtensionUser(request: Request) {
  const token = bearer(request);
  if (!token) throw new ServiceError("Connect the extension to your Unnepo account first.", "extension_auth", 401);
  const session = await repo.getSessionByTokenHash(hashOf(token));
  if (!session || new Date(session.expiresAt).getTime() < Date.now()) throw new ServiceError("The extension was signed out. Connect it again from Unnepo.", "extension_auth", 401);
  const user = await repo.getUserById(session.userId);
  if (!user || user.deletedAt) throw new ServiceError("Connect the extension to your Unnepo account first.", "extension_auth", 401);
  return { user, sessionId: session.id };
}

export async function revokeExtensionToken(sessionId: string) {
  await repo.deleteSession(sessionId);
}
