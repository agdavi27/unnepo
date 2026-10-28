import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright-core";
import { detectConfirmation, fillApplicationForm, passwordAllowedOn, runApplicationFlow, submitAndConfirm } from "@/lib/apply/browser";
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

describe("where the job-site password may be typed", () => {
  it("allows the company's site and known job systems only", () => {
    expect(passwordAllowedOn("https://acme.wd5.myworkdayjobs.com/en-US/login", "https://careers.acme.com/job/1")).toBe(true);
    expect(passwordAllowedOn("https://jobs.acme.com/login", "https://careers.acme.com/job/1")).toBe(true);
    expect(passwordAllowedOn("https://acme-login.evil.com/login", "https://careers.acme.com/job/1")).toBe(false);
    expect(passwordAllowedOn("http://jobs.acme.com/login", "https://careers.acme.com/job/1")).toBe(false);
  });
});

/** A tiny job site: Apply → sign in (or create an account, then verify email) → two form pages → review. */
function jobSite() {
  const accounts = new Map<string, { password: string; verified: boolean }>();
  const signups: Array<Record<string, string>> = [];
  const page = (body: string) => `<!doctype html><html><body>${body}</body></html>`;
  const handler = async (request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse) => {
    const url = new URL(request.url ?? "/", "http://x");
    let form = new URLSearchParams();
    if (request.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk as Buffer);
      form = new URLSearchParams(Buffer.concat(chunks).toString());
    }
    const send = (html: string) => { response.writeHead(200, { "Content-Type": "text/html" }); response.end(page(html)); };
    const go = (to: string) => { response.writeHead(303, { Location: to }); response.end(); };
    if (url.pathname === "/job") return send(`<h1>Analyst</h1><input type="search" placeholder="Search jobs"><a href="/login">Apply</a>`);
    if (url.pathname === "/login" && request.method === "GET") {
      return send(`<form method="post" action="/login">${url.searchParams.get("error") ? "<p role='alert'>Invalid email or password</p>" : ""}<label for="em">Email Address</label><input id="em" name="email" type="email"><label for="pw">Password</label><input id="pw" name="password" type="password"><button type="submit">Sign In</button></form><a href="/signup">Create Account</a>`);
    }
    if (url.pathname === "/login") {
      const account = accounts.get(form.get("email") ?? "");
      if (!account || account.password !== form.get("password")) return go("/login?error=1");
      if (!account.verified) return send("<p>Please verify your email. Check your inbox.</p>");
      return go("/step1");
    }
    if (url.pathname === "/signup" && request.method === "GET") {
      return send(`<h1>Create Account</h1><form method="post" action="/signup"><label for="e">Email Address</label><input id="e" name="email" type="email"><label for="p1">Password</label><input id="p1" name="password" type="password"><label for="p2">Verify New Password</label><input id="p2" name="verify" type="password"><label><input type="checkbox" name="terms" required> I agree to the Terms and Privacy Policy</label><label><input type="checkbox" name="marketing"> Send me job alerts and marketing emails</label><button type="submit">Create Account</button></form>`);
    }
    if (url.pathname === "/signup") {
      signups.push(Object.fromEntries(form));
      if (!form.get("terms") || form.get("password") !== form.get("verify")) return go("/signup");
      accounts.set(form.get("email")!, { password: form.get("password")!, verified: false });
      return send("<h1>Almost there</h1><p>We've sent you an email. Verify your email to continue.</p>");
    }
    if (url.pathname === "/step1") {
      return send(`<h2>My Information</h2><form action="/step2"><label for="fn">First Name *</label><input id="fn" required><label for="ln">Last Name *</label><input id="ln" required><label for="ph">Phone Number *</label><input id="ph" required><label for="g">Gender</label><select id="g"><option>Select</option><option>Female</option><option>Male</option></select><button type="submit">Save and Continue</button></form>`);
    }
    if (url.pathname === "/step2") return send(`<h2>My Experience</h2><form action="/review"><label for="cv">Upload Resume</label><input id="cv" type="file"><button type="submit">Next</button></form>`);
    if (url.pathname === "/review") return send(`<h2>Review</h2><p>Check everything.</p><button type="button">Submit</button>`);
    response.writeHead(404);
    response.end();
  };
  return { accounts, signups, handler };
}

describe.skipIf(!hasChrome)("multi-page applications with job-site accounts (local Chrome)", () => {
  let server: Server;
  let base = "";
  let browser: Browser;
  const site = jobSite();

  beforeAll(async () => {
    server = createServer((request, response) => void site.handler(request, response));
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

  it("creates the account, stops for email verification, then signs in and fills every page up to review", async () => {
    const page = await browser.newPage();
    const known: Record<string, string> = { "first name": "Pat", "last name": "Doe", "phone number": "207-555-0100" };
    const options = {
      url: `${base}/job`,
      questions: [],
      resume: { name: "resume.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") },
      credentials: { email: "pat@colby.edu", password: "Str0ng!Passw0rd" },
      answerFor: (label: string) => known[label.toLowerCase()] ?? null,
    };

    // Without consent, Unnepo stops instead of creating an account.
    const blocked = await runApplicationFlow(page, { ...options, navigate: true, allowSignup: false });
    expect(blocked.stoppedAt).toBe("needs_account");
    expect(site.signups).toHaveLength(0);

    const first = await runApplicationFlow(page, { ...options, navigate: true, allowSignup: true });
    expect(first).toMatchObject({ stoppedAt: "email_verification", account: "created" });
    expect(site.signups[0]).toMatchObject({ email: "pat@colby.edu", password: "Str0ng!Passw0rd", verify: "Str0ng!Passw0rd", terms: "on" });
    expect(site.signups[0].marketing).toBeUndefined();

    // The student clicks the link in their inbox, then presses Continue autofill.
    site.accounts.get("pat@colby.edu")!.verified = true;
    const second = await runApplicationFlow(page, { ...options, navigate: false, allowSignup: true });
    expect(second).toMatchObject({ stoppedAt: "review", account: "signed_in" });
    expect(second.filled).toEqual(expect.arrayContaining(["First Name", "Last Name", "Phone Number", "Upload Resume"]));
    expect(second.filled).not.toContain("Gender");
    expect(new URL(page.url()).pathname).toBe("/review");
    await page.close();
  }, 120_000);

  it("reports a wrong password instead of creating a second account", async () => {
    const page = await browser.newPage();
    const result = await runApplicationFlow(page, {
      url: `${base}/job`, navigate: true, questions: [], resume: null, allowSignup: false,
      credentials: { email: "pat@colby.edu", password: "Wrong!Passw0rd1" }, answerFor: () => null,
    });
    expect(result.stoppedAt).toBe("needs_account");
    expect(site.signups).toHaveLength(1);
    await page.close();
  }, 60_000);
});

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
