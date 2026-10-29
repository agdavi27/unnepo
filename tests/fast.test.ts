import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright-core";
import { fillGreenhouse } from "@/lib/apply/fast/greenhouse";
import { mapAnswers } from "@/lib/apply/fast/mapper";
import { knownAnswers, mappingFromQuestions, questionsFromMapping } from "@/lib/apply/fast/pipeline";
import { parseGreenhouse, type GreenhouseJobJson } from "@/lib/apply/fast/schema";
import { planAnswers } from "@/lib/apply/questions";
import { degreeAnswer, keepStated, resumeFieldAnswer } from "@/lib/apply/resume-profile";
import type { ApplicationProfile } from "@/lib/apply/types";

/** Saved copies of real public Greenhouse postings (Job Board API, questions=true). */
const fixture = (name: string) => JSON.parse(readFileSync(path.join(__dirname, "fixtures", name), "utf8")) as GreenhouseJobJson;
const anthropic = parseGreenhouse(fixture("greenhouse-anthropic.json"), "anthropic", "5456619008");
const stripe = parseGreenhouse(fixture("greenhouse-stripe.json"), "stripe", "8172487");

describe("Greenhouse schema", () => {
  it("reads every question with its type, options, and the form's own extras", () => {
    const by = (id: string) => anthropic.fields.find((field) => field.id === id);
    expect(anthropic.formUrl).toBe("https://job-boards.greenhouse.io/embed/job_app?for=anthropic&token=5456619008");
    expect(by("first_name")).toMatchObject({ type: "text", required: true, section: "core" });
    expect(by("email")?.type).toBe("email");
    expect(by("phone")?.type).toBe("tel");
    expect(by("resume")).toMatchObject({ type: "file", required: true });
    // The paste-instead box duplicates the file field and is dropped.
    expect(by("resume_text")).toBeUndefined();
    expect(by("question_19018739008")).toMatchObject({ type: "select", required: true, options: [{ label: "Yes", value: expect.any(String) }, { label: "No", value: expect.any(String) }] });
    expect(by("question_19018743008")).toMatchObject({ label: "Why Anthropic?", type: "textarea" });
    // Legal agreements, sponsorship, and EEOC questions are never AI's to answer.
    expect(by("question_19018752008")?.sensitive).toBe(true);
    expect(by("question_19018745008")?.sensitive).toBe(true);
    expect(by("gender")).toMatchObject({ section: "eeoc", sensitive: true, type: "select" });
    expect(by("veteran_status")?.label).toBe("Veteran Status");
    expect(by("country")).toMatchObject({ type: "phone_country", ifPresent: true });
    expect(by("school--0")?.type).toBe("school");
    expect(anthropic.description).not.toMatch(/&lt;|<p>/);
  });

  it("handles multi-selects, cover letters, and location questions", () => {
    const by = (id: string) => stripe.fields.find((field) => field.id === id);
    expect(by("question_68935297[]")).toMatchObject({ type: "multiselect", required: true });
    expect(by("question_68935297[]")!.options.length).toBe(30);
    expect(by("question_68935296")!.options.length).toBe(31);
    expect(by("cover_letter")).toMatchObject({ type: "file", required: false });
    expect(by("cover_letter_text")).toBeUndefined();
    expect(by("candidate-location")).toMatchObject({ type: "location", required: true });
    expect(by("latitude")).toBeUndefined();
  });
});

const profile: ApplicationProfile = {
  firstName: "Pat", lastName: "Doe", email: "pat@colby.edu", phone: "207-555-0100", linkedin: "https://linkedin.com/in/patdoe", website: "", github: "",
  city: "Waterville", state: "Maine", country: "United States", saved: {}, accountConsentAt: "2026-10-01T00:00:00Z",
  eligibility: { workAuthorized: "Yes", needsSponsorship: "No", over18: "Yes" },
};
const resumeText = "Pat Doe. Colby College, B.A. Economics, Expected May 2027. Data Analyst Intern, Maine Credit Union, May 2024 - August 2024. Built loan dashboards in Tableau used by the lending team.";
const resumeProfile = keepStated({ education: [{ school: "Colby College", degree: "B.A.", field: "Economics", end: "Expected May 2027" }], experience: [{ title: "Data Analyst Intern", company: "Maine Credit Union", start: "May 2024", end: "August 2024" }] }, resumeText, "h");
const context = { profile: { ...profile, resumeProfile }, school: "Colby College", majors: ["Economics"], graduationYear: "2027", resumeFileName: "Pat Doe Resume.pdf" };
const answerFor = (label: string, kind: Parameters<typeof planAnswers>[0][number]["kind"], options: string[], where?: { section?: string; format?: string | null }) => {
  const [planned] = planAnswers([{ key: label, label, kind, required: false, options, sensitive: false, answer: null, source: null, evidence: null }], context);
  if (planned.source === "saved" || planned.source === "student") return planned.answer;
  return resumeFieldAnswer(resumeProfile, { label, section: where?.section, kind, options, format: where?.format }) ?? (planned.source !== "resume_file" ? planned.answer : null);
};
const known = knownAnswers({ answerFor, profile: context.profile, school: "Colby College", resumeProfile });

describe("Greenhouse degree options", () => {
  it("picks the right degree, never turning B.A. into M.B.A.", () => {
    const options = ["Associate's Degree", "Bachelor's Degree", "Doctor of Medicine (M.D.)", "Doctor of Philosophy (Ph.D.)", "Engineer's Degree", "High School", "Juris Doctor (J.D.)", "Master of Business Administration (M.B.A.)", "Master's Degree", "Other"];
    expect(["B.A.", "BA", "B.S.", "Bachelor of Arts", "M.B.A.", "MBA", "M.S.", "Master of Science", "Ph.D.", "BS in Economics"].map((degree) => degreeAnswer(degree, options))).toEqual([
      "Bachelor's Degree", "Bachelor's Degree", "Bachelor's Degree", "Bachelor's Degree",
      "Master of Business Administration (M.B.A.)", "Master of Business Administration (M.B.A.)",
      "Master's Degree", "Master's Degree", "Doctor of Philosophy (Ph.D.)", "Bachelor's Degree",
    ]);
  });
});

describe("field mapping", () => {
  it("answers what's on file without AI, makes one call for the rest, and keeps only grounded answers", async () => {
    const asked: string[] = [];
    const mapped = await mapAnswers({
      schema: stripe,
      known,
      facts: "First name: Pat\nAuthorized to work in the United States: Yes",
      sources: resumeText,
      consent: true,
      resumeFileName: "Pat Doe Resume.pdf",
      ask: async (_system, content) => {
        asked.push(content);
        return JSON.stringify({ answers: [
          { id: "question_68935295", value: "Data Analyst Intern", source: "resume", evidence: "Data Analyst Intern" },
          { id: "question_68935296", value: "Narnia", source: "profile", evidence: "First name: Pat" },
          { id: "question_68935297[]", value: ["US", "Atlantis"], source: "student_answer", evidence: "Authorized to work in the United States: Yes" },
          { id: "question_69457836", value: "Yes", source: "resume", evidence: "invented consent" },
        ] });
      },
    });
    expect(mapped.llmCalls).toBe(1);
    const value = (id: string) => mapped.answers.get(id)?.values;
    // From the student's details and eligibility answers: no AI needed.
    expect(value("first_name")).toEqual(["Pat"]);
    expect(value("question_68935298")).toEqual(["Yes"]);
    expect(value("question_68935299")).toEqual(["No"]);
    expect(value("candidate-location")).toEqual(["Waterville, Maine"]);
    expect(value("school--0")).toEqual(["Colby College"]);
    expect(value("resume")).toEqual(["Pat Doe Resume.pdf"]);
    // Only the fields nothing on file answered went to the model, in one call.
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("question_68935295");
    expect(asked[0]).not.toContain('"id":"first_name"');
    // "Who is your current or previous employer?" comes straight from the resume's latest job.
    expect(asked[0]).not.toContain('"id":"question_68935294"');
    // Grounded answers kept; an option that doesn't exist and an unsupported quote dropped.
    expect(value("question_68935294")).toEqual(["Maine Credit Union"]);
    expect(value("question_68935295")).toEqual(["Data Analyst Intern"]);
    expect(value("question_68935296")).toBeUndefined();
    expect(value("question_68935297[]")).toEqual(["US"]);
    expect(value("question_69457836")).toBeUndefined();
  });

  it("round-trips through the review screen, keeping the student's edits", () => {
    const answers = new Map([["question_68935297[]", { id: "question_68935297[]", values: ["US", "CA"], source: "ai", why: null }]]);
    const questions = questionsFromMapping(stripe, answers);
    const multi = questions.find((question) => question.key === "question_68935297[]")!;
    expect(multi).toMatchObject({ kind: "multiselect", answer: "US\nCA" });
    multi.answer = "US";
    expect(mappingFromQuestions(stripe, questions).get("question_68935297[]")?.values).toEqual(["US"]);
  });
});

const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/** A local copy of Greenhouse's hosted form: React-style selects, checkbox multi-selects, hidden file inputs. */
function mockGreenhouse() {
  const countries = stripe.fields.find((field) => field.id === "question_68935297[]")!.options.filter((option) => ["US", "Canada"].includes(option.label));
  const select = (id: string, label: string, options: string[], required = true) => `
    <div class="select"><label id="${id}-label" for="${id}">${label}${required ? "*" : ""}</label>
      <div class="select__control"><div class="select__value-container"></div>
        <input id="${id}" class="select__input" role="combobox" aria-required="${required}" data-options='${JSON.stringify(options).replace(/'/g, "&#39;")}'></div></div>`;
  return `<!doctype html><html><body><form id="application-form">
    <label for="first_name">First Name*</label><input id="first_name" aria-required="true">
    <label for="last_name">Last Name*</label><input id="last_name" aria-required="true">
    <label for="email">Email*</label><input id="email" aria-required="true">
    ${select("country", "Country", ["Canada +1", "United States +1", "United Kingdom +44"])}
    <label for="phone">Phone*</label><input id="phone" type="tel" aria-required="true">
    ${select("candidate-location", "Location (City)", ["Waterville, Maine, United States", "Waterville, Ohio, United States"])}
    <div><button type="button">Attach</button><input id="resume" class="visually-hidden" type="file" style="position:absolute;width:1px;height:1px;opacity:0"></div>
    <div><button type="button">Attach</button><input id="cover_letter" type="file" style="position:absolute;width:1px;height:1px;opacity:0"></div>
    ${select("school--0", "School", ["Colby College", "Colby-Sawyer College", "Other"])}
    ${select("degree--0", "Degree", ["Associate's Degree", "Bachelor's Degree", "Master's Degree", "Other"])}
    <label for="question_68935294">Who is your current or previous employer?*</label><input id="question_68935294" aria-required="true">
    <label for="question_68935295">What is your current or previous job title?*</label><input id="question_68935295" aria-required="true">
    ${select("question_68935298", "Are you authorized to work in the location(s) you selected?", ["Yes", "No"])}
    ${select("question_68935299", "Will you require Stripe to sponsor you?", ["Yes", "No"])}
    <fieldset><legend>Countries *</legend>
      ${countries.map((option) => `<label><input type="checkbox" id="question_68935297[]_${option.value}"> ${option.label}</label>`).join("")}</fieldset>
    <button type="submit">Submit application</button>
  </form>
  <script>
    // Marks the inputs the way React does once it has taken over the page.
    document.querySelectorAll("input").forEach((input) => { input.__reactProps$test = {}; });
    // Behaves like react-select: click opens a listbox, typing filters, a click sets the single value.
    document.querySelectorAll("input[role=combobox]").forEach((input) => {
      const all = JSON.parse(input.dataset.options);
      const render = () => {
        document.querySelectorAll(".select__menu").forEach((menu) => menu.remove());
        const menu = document.createElement("div");
        menu.className = "select__menu";
        menu.setAttribute("role", "listbox");
        all.filter((option) => option.toLowerCase().includes(input.value.toLowerCase())).forEach((option, index) => {
          const item = document.createElement("div");
          item.id = "react-select-" + input.id + "-option-" + index;
          item.setAttribute("role", "option");
          item.className = "select__option";
          item.textContent = option;
          item.addEventListener("click", () => {
            const box = input.closest(".select").querySelector(".select__value-container");
            box.innerHTML = '<div class="select__single-value">' + option + "</div>";
            input.value = "";
            menu.remove();
          });
          menu.appendChild(item);
        });
        input.closest(".select").appendChild(menu);
      };
      input.addEventListener("click", render);
      input.addEventListener("input", render);
      input.addEventListener("keydown", (event) => { if (event.key === "Escape") document.querySelectorAll(".select__menu").forEach((menu) => menu.remove()); });
    });
  </script></body></html>`;
}

describe.skipIf(!existsSync(CHROME))("Greenhouse adapter (local Chrome)", () => {
  let server: Server;
  let browser: Browser;
  let base = "";
  beforeAll(async () => {
    server = createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end(mockGreenhouse());
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
  });

  it("fills every field by id in one pass, verifies them, and needs no fallback", async () => {
    const page = await browser.newPage();
    const answers = new Map<string, { id: string; values: string[]; source: string; why: null }>();
    const set = (id: string, ...values: string[]) => answers.set(id, { id, values, source: "profile", why: null });
    set("first_name", "Pat"); set("last_name", "Doe"); set("email", "pat@colby.edu"); set("phone", "207-555-0100");
    set("country", "United States"); set("candidate-location", "Waterville, Maine");
    set("resume", "Pat Doe Resume.pdf"); set("cover_letter", "Cover letter");
    set("school--0", "Colby College"); set("degree--0", "B.A.");
    set("question_68935294", "Maine Credit Union"); set("question_68935295", "Data Analyst Intern");
    set("question_68935298", "Yes"); set("question_68935299", "No");
    set("question_68935297[]", "US");
    let fallbackAsked = 0;
    const result = await fillGreenhouse(page, { ...stripe, formUrl: base }, answers, {
      resume: { name: "Pat Doe Resume.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") },
      coverLetter: async () => ({ name: "Pat Doe Cover Letter.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") }),
    }, async () => {
      fallbackAsked += 1;
      return [];
    });
    const chosen = (id: string) => page.locator(`[id="${id}"]`).evaluate((el) => el.closest(".select")?.querySelector(".select__single-value")?.textContent ?? "");
    expect(await page.inputValue("#first_name")).toBe("Pat");
    expect(await chosen("country")).toBe("United States +1");
    expect(await chosen("candidate-location")).toBe("Waterville, Maine, United States");
    expect(await chosen("school--0")).toBe("Colby College");
    expect(await chosen("degree--0")).toBe("Bachelor's Degree");
    expect(await chosen("question_68935299")).toBe("No");
    const optionId = (label: string) => `[id='question_68935297[]_${stripe.fields.find((field) => field.id === "question_68935297[]")!.options.find((option) => option.label === label)!.value}']`;
    expect(await page.isChecked(optionId("US"))).toBe(true);
    expect(await page.isChecked(optionId("Canada"))).toBe(false);
    expect(await page.locator("#resume").evaluate((el) => (el as HTMLInputElement).files?.[0]?.name)).toBe("Pat Doe Resume.pdf");
    expect(await page.locator("#cover_letter").evaluate((el) => (el as HTMLInputElement).files?.[0]?.name)).toBe("Pat Doe Cover Letter.pdf");
    // Chosen dropdowns count as filled, so nothing went to the fallback.
    expect(result.failed).toEqual([]);
    expect(fallbackAsked).toBe(0);
    expect(result.llmCalls).toBe(0);
    console.log(`Greenhouse copy filled in ${(result.ms / 1000).toFixed(1)}s`);
    expect(result.ms).toBeLessThan(20_000);
    await page.close();
  }, 60_000);
});
