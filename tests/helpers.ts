import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resetMemory, setDataDir } from "@/lib/db/file-store";
import { resetContactFetcher } from "@/lib/providers/contacts/http";
import { setLastNameSearcherForTests } from "@/lib/apply/people-web";

export function useTempDb() {
  const dir = mkdtempSync(path.join(tmpdir(), "unnepo-"));
  setDataDir(dir);
  resetMemory();
  resetContactFetcher();
  // The web search for blurred last names finds nothing unless a test says otherwise.
  setLastNameSearcherForTests(async () => []);
  delete process.env.APOLLO_API_KEY;
  delete process.env.HUNTER_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.STRIPE_SECRET_KEY;
  process.env.DAILY_GLOBAL_SPEND_CENTS = "2500";
  process.env.DAILY_USER_SPEND_CENTS = "200";
  process.env.SIGNUP_CREDITS = "3";
  // New accounts start on the 7-day Pro trial; tests are on Free unless a test turns the trial on.
  process.env.TRIAL_DAYS = "0";
  process.env.PACK_CREDITS = "75";
  process.env.GRIND_MONTHLY_CREDITS = "30";
  return dir;
}
