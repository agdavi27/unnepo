import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright-core";
import { AutofillStopped, runApplicationFlow } from "@/lib/apply/browser";
import { bestOption } from "@/lib/apply/options";

/**
 * A local copy of Workday's apply flow, built from the structure of a live Workday career site
 * (data-automation-id names, "Sign in with email", click_filter layers over buttons, the hidden
 * "beecatcher" field, listbox dropdowns, searchable prompts) so autofill can be tested end to end.
 */
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const hasChrome = existsSync(CHROME);

const WORKDAY = String.raw`<!doctype html><html><head><style>
  .wrap { position: relative; display: inline-block; }
  .wrap [data-automation-id='click_filter'] { position: absolute; inset: 0; }
  ul[role=listbox] { border: 1px solid #ccc; padding: 4px; }
  #beecatcher { width: 1px; height: 1px; opacity: 0.01; }
</style></head><body>
<header><button data-automation-id="utilityButtonSignIn" onclick="state.headerClicked = true">Sign In</button></header>
<main id="app"></main>
<input data-automation-id="beecatcher" id="beecatcher" type="text">
<script>
const state = { view: "start", accounts: {}, values: {}, uploads: 0, headerClicked: false, errors: [] };
window.state = state;
const app = document.getElementById("app");
function go(view) { state.view = view; render(); }
function overlay(label, action) { return '<div data-automation-id="click_filter" role="button" aria-label="' + label + '" onclick="' + action + '"></div>'; }
function listbox(id, label, options, required) {
  const value = state.values[id];
  return '<div data-automation-id="formField-' + id + '"><label id="' + id + 'Label">' + label + (required ? '*' : '') + '</label>' +
    '<button type="button" id="' + id + '" aria-haspopup="listbox" aria-labelledby="' + id + 'Label"' + (required ? ' aria-required="true"' : '') + ' onclick="openList(\'' + id + '\', ' + JSON.stringify(options).replace(/"/g, '&quot;') + ')">' + (value || 'Select One') + '</button></div>';
}
window.openList = (id, options) => {
  document.querySelectorAll("ul[role=listbox]").forEach((el) => el.remove());
  const list = document.createElement("ul");
  list.setAttribute("role", "listbox");
  for (const option of options) {
    const item = document.createElement("li");
    item.setAttribute("role", "option");
    item.textContent = option;
    item.onclick = () => { state.values[id] = option; list.remove(); render(); };
    list.appendChild(item);
  }
  document.body.appendChild(list);
};
document.addEventListener("keydown", (event) => { if (event.key === "Escape") document.querySelectorAll("ul[role=listbox]").forEach((el) => el.remove()); });
function input(id, label, required) {
  return '<div data-automation-id="formField-' + id + '"><label for="' + id + '">' + label + (required ? '*' : '') + '</label><input type="text" id="' + id + '" data-automation-id="' + id + '"' + (required ? ' aria-required="true"' : '') + ' value="' + (state.values[id] || '') + '" oninput="state.values[\'' + id + '\'] = this.value"></div>';
}
window.promptSearch = (event) => {
  if (event.key !== "Enter") return;
  const text = event.target.value.toLowerCase();
  const results = ["Job Board", "LinkedIn", "Referral"].filter((option) => option.toLowerCase().includes(text));
  document.getElementById("promptResults").innerHTML = results.map((option) => '<div data-automation-id="promptOption" onclick="pickSource(\'' + option + '\')">' + option + '</div>').join("");
};
window.pickSource = (option) => { state.values.source = state.values.source ? state.values.source + "," + option : option; render(); };
function requireAll(ids, next) {
  const missing = ids.filter((id) => !state.values[id]);
  if (missing.length) {
    state.errors = missing;
    render();
    document.getElementById("errors").innerHTML = missing.map((id) => '<div data-automation-id="errorMessage">' + id + ' is required</div>').join("");
    return;
  }
  go(next);
}
window.signIn = () => {
  const email = document.getElementById("email").value, password = document.getElementById("password").value;
  if (state.accounts[email] === password) return go("info");
  document.getElementById("signinError").textContent = "Wrong email address or password.";
};
window.createAccount = () => {
  const email = document.getElementById("email").value, password = document.getElementById("password").value;
  if (!document.getElementById("terms").checked || password !== document.getElementById("verifyPassword").value) return;
  state.accounts[email] = password;
  go("info");
};
function render() {
  const v = state.view;
  if (v === "start") app.innerHTML = '<div data-automation-id="applyAdventurePage"><h2>Start Your Application</h2><a href="#" role="button" data-automation-id="autofillWithResume" onclick="go(\'signin\');return false">Autofill with Resume</a> <a href="#" role="button" data-automation-id="applyManually" onclick="go(\'signin\');return false">Apply Manually</a></div>';
  if (v === "signin") app.innerHTML = '<h2>Sign In</h2><button type="button" data-automation-id="SignInWithEmailButton" onclick="go(\'signinEmail\')">Sign in with email</button>';
  if (v === "signinEmail") app.innerHTML = '<form data-automation-id="signInFormo" onsubmit="return false"><div data-automation-id="formField-email"><label for="email">Email Address*</label><input id="email" type="text" data-automation-id="email"></div><div data-automation-id="formField-password"><label for="password">Password*</label><input id="password" type="password" data-automation-id="password"></div><p id="signinError" role="alert"></p><div class="wrap"><button type="submit" data-automation-id="signInSubmitButton">Sign In</button>' + overlay("Submit", "signIn()") + '</div></form><button type="button" data-automation-id="createAccountLink" onclick="go(\'create\')">Create Account</button>';
  if (v === "create") app.innerHTML = '<h2>Create Account</h2><form onsubmit="return false"><label for="email">Email Address*</label><input id="email" type="text"><label for="password">Password*</label><input id="password" type="password"><label for="verifyPassword">Verify New Password*</label><input id="verifyPassword" type="password"><div data-automation-id="formField-"><label><input type="checkbox" id="terms" data-automation-id="createAccountCheckbox"> I agree</label></div><div class="wrap"><button type="submit" data-automation-id="createAccountSubmitButton">Create Account</button>' + overlay("Create Account", "createAccount()") + '</div></form><button type="button" data-automation-id="signInLink" onclick="go(\'signinEmail\')">Sign In</button>';
  if (v === "info") app.innerHTML = '<ol><li>current step 2 of 6 My Information</li></ol><h2>My Information</h2>' +
    '<div data-automation-id="formField-source"><label for="source">How Did You Hear About Us?*</label><div data-automation-id="multiselectInputContainer">' + (state.values.source ? state.values.source.split(",").map((item) => '<span data-automation-id="selectedItem">' + item + '</span>').join("") : '') + '<input type="text" id="source" data-automation-id="searchBox" onkeydown="promptSearch(event)"></div><div id="promptResults"></div></div>' +
    '<fieldset><legend>Have you previously worked for Acme?*</legend><label><input type="radio" name="previousWorker" value="true" required ' + (state.values.prev === "true" ? "checked" : "") + ' onchange="state.values.prev=this.value">Yes</label><label><input type="radio" name="previousWorker" value="false" ' + (state.values.prev === "false" ? "checked" : "") + ' onchange="state.values.prev=this.value">No</label></fieldset>' +
    listbox("country", "Country", ["Canada", "United States of America"], true) + input("legalFirstName", "Legal First Name", true) + input("legalLastName", "Legal Last Name", true) +
    input("addressLine1", "Address Line 1", true) + input("city", "City", true) + listbox("state", "State", ["Maine", "Massachusetts"], true) + input("postalCode", "Postal Code", true) +
    listbox("phoneDeviceType", "Phone Device Type", ["Landline", "Mobile"], true) + input("phoneNumber", "Phone Number", true) +
    '<div id="errors"></div><button type="button" data-automation-id="bottom-navigation-next-button" onclick="requireAll([\'source\', \'prev\', \'country\', \'legalFirstName\', \'legalLastName\', \'addressLine1\', \'city\', \'state\', \'postalCode\', \'phoneDeviceType\', \'phoneNumber\'], \'experience\')">Save and Continue</button>';
  if (v === "experience") app.innerHTML = '<ol><li>current step 3 of 6 My Experience</li></ol><h2>My Experience</h2><h3>Resume/CV</h3><div data-automation-id="formField-resume"><label for="resumeUpload">Upload a file</label><input type="file" id="resumeUpload" data-automation-id="file-upload-input-ref" onchange="state.uploads += 1; state.values.resume = this.files[0].name"></div><div id="errors"></div><button type="button" data-automation-id="bottom-navigation-next-button" onclick="requireAll([\'resume\'], \'disclosures\')">Save and Continue</button>';
  if (v === "disclosures") app.innerHTML = '<ol><li>current step 5 of 6 Voluntary Disclosures</li></ol><h2>Voluntary Disclosures</h2>' + listbox("gender", "Gender", ["Female", "Male", "I do not wish to answer"], false) +
    '<div data-automation-id="formField-agreement"><label><input type="checkbox" id="agreement" required data-automation-id="agreementCheckbox" onchange="state.values.agreement = this.checked ? \'yes\' : \'\'"> Yes, I have read and consent to the terms and conditions*</label></div><div id="errors"></div><button type="button" data-automation-id="bottom-navigation-next-button" onclick="requireAll([\'agreement\'], \'review\')">Save and Continue</button>';
  if (v === "review") app.innerHTML = '<ol><li>current step 6 of 6 Review</li></ol><h2>Review</h2><button type="button" data-automation-id="bottom-navigation-next-button">Submit</button>';
}
render();
</script></body></html>`;

describe("dropdown option matching", () => {
  it("matches answers to Workday's wording without loose guesses", () => {
    expect(bestOption("United States", ["Canada", "United States of America"])).toBe("United States of America");
    expect(bestOption("United States", ["Canada", "United States of America (+1)"])).toBe("United States of America (+1)");
    expect(bestOption("Maine", ["Maine", "Massachusetts"])).toBe("Maine");
    expect(bestOption("No", ["Not applicable", "No"])).toBe("No");
    expect(bestOption("No", ["Not applicable", "Yes"])).toBeNull();
    expect(bestOption("Mass", ["Massachusetts", "Mass General"])).toBeNull();
  });
});

describe.skipIf(!hasChrome)("Workday-style application (local Chrome)", () => {
  let server: Server;
  let base = "";
  let browser: Browser;

  beforeAll(async () => {
    server = createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end(WORKDAY);
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

  it("creates the account, asks only what it can't know, then fills every step to Review", async () => {
    const page = await browser.newPage();
    const saved: Record<string, string> = {
      "how did you hear about us?": "Job Board",
      country: "United States",
      "legal first name": "Pat",
      "legal last name": "Doe",
      "address line 1": "4000 Mayflower Hill Dr",
      city: "Waterville",
      state: "Maine",
      "postal code": "04901",
      "phone number": "2075550100",
    };
    const options = {
      url: `${base}/apply`,
      questions: [],
      resume: { name: "Pat Doe Resume.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") },
      credentials: { email: "pat@colby.edu", password: "Str0ng!Passw0rd" },
      allowSignup: true,
      answerFor: (label: string) => saved[label.toLowerCase()] ?? null,
    };

    // Stop is honored before anything is typed.
    await expect(runApplicationFlow(page, { ...options, navigate: true, shouldStop: async () => true })).rejects.toBeInstanceOf(AutofillStopped);

    const started = Date.now();
    const first = await runApplicationFlow(page, { ...options, navigate: true });
    expect(first).toMatchObject({ stoppedAt: "needs_input", account: "created" });
    const state1 = await page.evaluate(() => (window as unknown as { state: { accounts: Record<string, string>; values: Record<string, string>; headerClicked: boolean } }).state);
    expect(state1.accounts).toEqual({ "pat@colby.edu": "Str0ng!Passw0rd" });
    expect(state1.headerClicked).toBe(false);
    expect(state1.values).toMatchObject({ source: "Job Board", country: "United States of America", state: "Maine", legalFirstName: "Pat", phoneNumber: "2075550100" });
    expect(await page.inputValue("#beecatcher")).toBe("");
    // The two questions it can't know come back to the student, with Workday's own options.
    expect(first.pending).toEqual(expect.arrayContaining([
      { label: "Phone Device Type", kind: "select", options: ["Landline", "Mobile"] },
      expect.objectContaining({ label: "Have you previously worked for Acme?", options: ["Yes", "No"] }),
    ]));

    // The student answers in Unnepo; the answers are saved and autofill continues in the same browser.
    saved["phone device type"] = "Mobile";
    saved["have you previously worked for acme?"] = "No";
    saved["yes, i have read and consent to the terms and conditions"] = "Yes";
    const second = await runApplicationFlow(page, { ...options, navigate: false });
    const state2 = await page.evaluate(() => (window as unknown as { state: { view: string; values: Record<string, string>; uploads: number } }).state);
    expect(second.stoppedAt).toBe("review");
    expect(state2.view).toBe("review");
    expect(state2.values).toMatchObject({ phoneDeviceType: "Mobile", prev: "false", resume: "Pat Doe Resume.pdf", agreement: "yes", source: "Job Board" });
    expect(state2.uploads).toBe(1);
    console.log(`Workday copy filled to Review in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    expect(state2.values.gender).toBeUndefined();
    await page.close();
  }, 240_000);
});
