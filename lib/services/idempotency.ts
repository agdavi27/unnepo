import { repo } from "@/lib/db/file-store";

export async function runIdempotent<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const claim = await repo.claimIdempotency(key);
  if (claim.state === "done") return claim.result as T;
  if (claim.state === "pending") throw new Error("job_in_progress");
  try {
    const result = await fn();
    await repo.finishIdempotency(key, result);
    return result;
  } catch (error) {
    await repo.releaseIdempotency(key);
    throw error;
  }
}
