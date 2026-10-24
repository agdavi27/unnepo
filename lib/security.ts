import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function sha256Buffer(value: Buffer | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function key() {
  const secret = process.env.SESSION_SECRET || "dev-only-unnepo-secret-change-me";
  return scryptSync(secret, "unnepo-oauth-v1", 32);
}

export function encryptSecret(plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptSecret(payload: string) {
  const [ivRaw, tagRaw, dataRaw] = payload.split(".");
  if (!ivRaw || !tagRaw || !dataRaw) throw new Error("invalid secret payload");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataRaw, "base64url")), decipher.final()]);
  return decrypted.toString("utf8");
}

export function usingDefaultSecret() {
  return !process.env.SESSION_SECRET || process.env.SESSION_SECRET === "dev-only-unnepo-secret-change-me";
}

export function referralCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  let code = "";
  for (let i = 0; i < 8; i += 1) code += alphabet[bytes[i]! % alphabet.length];
  return code;
}

export function randomToken() {
  return randomBytes(32).toString("base64url");
}
