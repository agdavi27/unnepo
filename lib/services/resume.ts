import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dataDir, id, nowIso, repo } from "@/lib/db/file-store";
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
  const text = await extractResumeText(fileName, bytes);
  const parsed = parseResumeText(text);
  const resumeId = id();
  const storagePath = path.join(dataDir(), "resumes", userId, `${resumeId}-${fileName.replace(/[^\w.\-]+/g, "_")}`);
  mkdirSync(path.dirname(storagePath), { recursive: true });
  writeFileSync(storagePath, bytes);
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
