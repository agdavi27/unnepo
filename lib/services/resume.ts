import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dataDir, id, nowIso, repo } from "@/lib/db/file-store";
import { getResumeObject, putResumeObject } from "@/lib/db/remote";
import { ServiceError } from "@/lib/errors";
import { extractResumeText, parseResumeText } from "@/lib/resume/parse";
import { sha256Buffer } from "@/lib/security";

const MAX_BYTES = 5 * 1024 * 1024;

export async function storeResume(userId: string, fileName: string, mime: string, bytes: Uint8Array) {
  const lower = fileName.toLowerCase();
  if (!lower.endsWith(".pdf") && !lower.endsWith(".docx")) {
    throw new ServiceError("Upload a PDF or DOCX file.", "file_type");
  }
  if (bytes.byteLength > MAX_BYTES) throw new ServiceError("Resumes need to be 5 MB or smaller.", "file_size");
  const hash = sha256Buffer(bytes);
  const cached = await repo.getResumeByHash(userId, hash);
  if (cached) {
    const facts = await repo.getFacts(userId);
    return { resume: cached, facts, cached: true };
  }
  let text = "";
  try {
    text = await extractResumeText(fileName, bytes);
  } catch (error) {
    console.error(error);
    throw new ServiceError("Could not read that file. Use a text-based PDF or DOCX, not a photo of a resume.", "parse");
  }
  const parsed = parseResumeText(text);
  const resumeId = id();
  const safeName = fileName.replace(/[^\w.\-]+/g, "_");
  const storagePath = await saveResumeBytes(dataDir(), `${userId}/${resumeId}-${safeName}`, bytes, mime);
  const resume = await repo.insertResume({
    id: resumeId,
    userId,
    fileName,
    mime,
    byteSize: bytes.byteLength,
    sha256: hash,
    storagePath,
    text: text.slice(0, 20000),
    createdAt: nowIso(),
  });
  const facts = parsed.map((fact) => ({
    id: id(),
    userId,
    resumeId,
    category: fact.category,
    label: fact.label,
    detail: fact.detail,
    sourceExcerpt: fact.sourceExcerpt,
    edited: false,
    createdAt: nowIso(),
  }));
  const savedFacts = await repo.replaceFacts(userId, resumeId, facts);
  await repo.insertAudit({ userId, action: "resume_uploaded", metadata: { bytes: bytes.byteLength, facts: facts.length } });
  return { resume, facts: savedFacts, cached: false };
}

export async function saveResumeBytes(dir: string, relativePath: string, bytes: Uint8Array, mime: string) {
  const storagePath = path.join(dir, "resumes", relativePath);
  try {
    mkdirSync(path.dirname(storagePath), { recursive: true });
    writeFileSync(storagePath, bytes);
    return storagePath;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EROFS" && code !== "EPERM" && code !== "EACCES" && code !== "ENOENT" && code !== "ENOTDIR") throw error;
    const saved = await putResumeObject(relativePath, bytes, mime);
    return saved ? `supabase:${relativePath}` : "";
  }
}

export async function readStoredResume(storagePath: string) {
  if (!storagePath) return null;
  if (storagePath.startsWith("supabase:")) return getResumeObject(storagePath.slice("supabase:".length));
  if (!existsSync(storagePath)) return null;
  return new Uint8Array(readFileSync(storagePath));
}
