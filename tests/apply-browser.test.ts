import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright-core";
import { detectConfirmation, fillApplicationForm, submitAndConfirm } from "@/lib/apply/browser";
import type { ApplicationQuestion } from "@/lib/apply/types";

/** Runs the real form filler in a local Chrome against local test forms. Skipped where Chrome isn't installed. */
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const hasChrome = existsSync(CHROME);

const FORM = `<!doctype html><html><body>
<form id="application" onsubmit="event.preventDefault(); if (!document.getElementById('consent').checked) { document.getElementById('err').textContent='Required'; return; } document.body.innerHTML='<h1>Thank you for applying!</h1><p>Your application has been submitted.</p>';">
  <label for="first_name">First Name *</label><input id="first_name" name="first_name" required>
  <label for="last_name">Last Name *</label><input id="last_name" name="last_name" required>
  <label for="email">Email *</label><input id="email" name="email" type="email" required>
  <label for="resume">Resume/CV *</label><input id="resume" name="resume" type="file" required>
  <label for="question_1">Graduation year</label><select id="question_1"><option value="">Select</option><option>2026</option><option>2027</option></select>
  <label for="question_2">School</label><input id="question_2" role="combobox" aria-autocomplete="list">
  <div role="listbox"><div role="option">Colby College</div></div>
  <fieldset><legend>Willing to relocate?</legend><label><input type="radio" name="relocate" value="y">Yes</label><label><input type="radio" name="relocate" value="n">No</label></fieldset>
  <label><input type="checkbox" id="consent" required> I consent to the privacy policy</label>
  <label for="question_3">Why this team? *</label><textarea id="question_3" required></textarea>
  <span id="err" role="alert"></span>
  <button type="submit">Submit application</button>
</form></body></html>`;

function q(key: string, label: string, kind: ApplicationQuestion["kind"], answer: string | null, required = false): ApplicationQuestion {
  return { key, label, kind, required, options: [], sensitive: false, answer, source: answer ? "profile" : null, evidence: null };
}

describe.skipIf(!hasChrome)("application form filler (local Chrome)", () => {
  let server: Server;
  let base = "";
  let browser: Browser;

  beforeAll(async () => {
    server = createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end(FORM);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const { chromium } = await import("playwright-core");
    browser = await chromium.launch({ executablePath: CHROME, headless: true });
  }, 30_000);

  afterAll(async () => {
    await browser?.close();
    server?.closeAllConnections();
    server?.close();
  }, 30_000);

  it("fills answered fields, reports what's left, and only confirms after the site says so", async () => {
    const page = await browser.newPage();
    const questions = [
      q("first_name", "First Name", "text", "Pat", true),
      q("last_name", "Last Name", "text", "Doe", true),
      q("email", "Email", "text", "pat@colby.edu", true),
      q("resume", "Resume/CV", "file", "resume.pdf", true),
      q("question_1", "Graduation year", "select", "2027"),
      q("question_2", "School", "select", "Colby College"),
      q("relocate", "Willing to relocate?", "select", "Yes"),
      q("question_3", "Why this team?", "textarea", null, true),
    ];
    const report = await fillApplicationForm(page, base, questions, { name: "resume.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") });
    expect(report.filled).toEqual(expect.arrayContaining(["First Name", "Last Name", "Email", "Resume/CV", "Graduation year", "School", "Willing to relocate?"]));
    expect(await page.inputValue("#first_name")).toBe("Pat");
    expect(await page.inputValue("#question_1")).toBe("2027");
    expect(await page.locator("#resume").evaluate((el) => (el as HTMLInputElement).files?.[0]?.name)).toBe("resume.pdf");
    expect(await page.isChecked("input[name=relocate][value=y]")).toBe(true);
    // Unanswered required fields are left for the student, never guessed.
    expect(report.failed.map((item) => item.label)).toEqual(expect.arrayContaining(["Why this team?", "I consent to the privacy policy"]));
    expect(await page.inputValue("#question_3")).toBe("");
    expect(await detectConfirmation(page)).toBeNull();

    // A rejected submit is not a confirmation.
    await page.fill("#question_3", "I like the work.");
    expect(await submitAndConfirm(page).catch(() => null)).toBeNull();

    await page.check("#consent");
    const confirmation = await submitAndConfirm(page);
    expect(confirmation?.text).toMatch(/Thank you for applying/);
    await page.close();
  }, 90_000);
});
