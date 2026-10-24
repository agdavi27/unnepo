import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resetMemory, setDataDir } from "@/lib/db/file-store";
import { resetContactFetcher } from "@/lib/providers/contacts/http";
import { setMailSenderForTests } from "@/lib/services/outreach";

export function useTempDb() {
  const dir = mkdtempSync(path.join(tmpdir(), "unnepo-"));
  setDataDir(dir);
  resetMemory();
  resetContactFetcher();
  setMailSenderForTests(null);
  delete process.env.APOLLO_API_KEY;
  delete process.env.HUNTER_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.STRIPE_SECRET_KEY;
  process.env.DAILY_GLOBAL_SPEND_CENTS = "2500";
  process.env.DAILY_USER_SPEND_CENTS = "200";
  process.env.UNNEPO_SAMPLE_DIRECTORY = "true";
  process.env.SIGNUP_CREDITS = "25";
  process.env.REFERRAL_CREDITS = "50";
  return dir;
}
