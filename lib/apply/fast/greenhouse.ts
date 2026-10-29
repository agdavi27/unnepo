import type { Locator, Page } from "playwright-core";
import { applyFix, emptyRequired, siteErrors, type EmptyField, type ResumeFile } from "@/lib/apply/browser";
import { bestOption } from "@/lib/apply/options";
import { degreeAnswer } from "@/lib/apply/resume-profile";
import { answerChoices } from "@/lib/apply/questions";
import type { MappedAnswer } from "@/lib/apply/fast/mapper";
import type { FormSchema, SchemaField } from "@/lib/apply/fast/schema";

/**
 * Greenhouse adapter: fills the hosted application form from an approved mapping by each field's
 * stable id, in one pass, with no AI in the loop. Greenhouse's dropdowns are React selects whose input
 * id is the API field name; their options appear as #react-select-{id}-option-N. Multi-selects are
 * checkboxes with ids {name}_{value id}. Files go into the hidden inputs behind "Attach".
 */
export type FillFiles = { resume: ResumeFile | null; coverLetter: (() => Promise<ResumeFile | null>) | null };
export type AdapterResult = { filled: string[]; failed: Array<{ id: string; label: string; reason: string }>; fallback: string[]; llmCalls: number; ms: number };
export type FixFields = (fields: EmptyField[], errors: string[]) => Promise<Array<{ index: number; value: string; why: string }>>;

const byId = (page: Page, id: string) => page.locator(`[id="${id.replace(/"/g, '\\"')}"]`);

async function present(page: Page, field: SchemaField) {
  if (field.type === "multiselect") return (await page.locator(`[id^="${field.id.replace(/"/g, '\\"')}_"]`).count()) > 0;
  return (await byId(page, field.id).count()) > 0;
}

/** Opens a Greenhouse React select, optionally types to filter, and clicks the option that matches. */
async function chooseOption(page: Page, id: string, answer: string, options: { type?: string; pick?: (texts: string[]) => string | null } = {}) {
  const input = byId(page, id).first();
  await input.scrollIntoViewIfNeeded().catch(() => undefined);
  await input.click({ timeout: 5_000 });
  if (options.type) await input.pressSequentially(options.type.slice(0, 40), { delay: 15 });
  const list = page.locator(`[id^="react-select-${id}-option-"]`);
  await list.first().waitFor({ timeout: options.type ? 6_000 : 3_000 });
  const texts = (await list.allInnerTexts()).map((text) => text.replace(/\s+/g, " ").trim());
  const choice = options.pick ? options.pick(texts) : answerChoices(answer).map((candidate) => bestOption(candidate, texts)).find(Boolean) ?? null;
  if (!choice) {
    await input.press("Escape").catch(() => undefined);
    throw new Error(`no option matching "${answer}"`);
  }
  await list.nth(texts.indexOf(choice)).click({ timeout: 3_000 });
}

/** What a field shows now: the typed value, the chosen option, the ticked boxes, or the attached file. */
async function currentValue(page: Page, field: SchemaField) {
  if (field.type === "multiselect") return (await page.locator(`[id^="${field.id.replace(/"/g, '\\"')}_"]:checked`).count()) > 0 ? "checked" : "";
  const target = byId(page, field.id).first();
  return target.evaluate((el) => {
    const input = el as HTMLInputElement;
    if (input.type === "file") return input.files?.length ? input.files[0].name : (el.closest("div")?.parentElement?.textContent?.match(/\.(pdf|docx?|txt|rtf)\b/i) ? "attached" : "");
    if (input.getAttribute("role") === "combobox") return el.closest(".select")?.querySelector(".select__single-value, .select__multi-value")?.textContent?.trim() ?? "";
    return input.value?.trim() ?? "";
  }).catch(() => "");
}

async function fillOne(page: Page, field: SchemaField, answer: MappedAnswer, files: FillFiles) {
  const value = answer.values[0] ?? "";
  const target: Locator = byId(page, field.id).first();
  switch (field.type) {
    case "text":
    case "email":
    case "tel":
    case "textarea":
      await target.fill(value, { timeout: 5_000 });
      return;
    case "file": {
      const file = field.id === "cover_letter" ? await files.coverLetter?.() : files.resume;
      if (!file) throw new Error("no file");
      await target.setInputFiles({ name: file.name, mimeType: file.mimeType, buffer: file.buffer });
      return;
    }
    case "select":
      await chooseOption(page, field.id, value, { type: field.options.length > 12 || !field.options.length ? value : undefined });
      return;
    case "multiselect": {
      for (const chosen of answer.values) {
        const option = field.options.find((item) => item.label === chosen);
        if (!option) continue;
        await page.locator(`[id="${`${field.id}_${option.value}`.replace(/"/g, '\\"')}"]`).check({ force: true, timeout: 3_000 });
      }
      return;
    }
    case "phone_country":
      await chooseOption(page, field.id, value, { type: value, pick: (texts) => texts.find((text) => text.toLowerCase().startsWith(value.toLowerCase())) ?? bestOption(value, texts) });
      return;
    case "location": {
      // "Waterville, Maine": type the city, then pick the suggestion that also names the state.
      const [city, state] = value.split(",").map((part) => part.trim());
      await chooseOption(page, field.id, value, { type: city, pick: (texts) => texts.find((text) => text.toLowerCase().startsWith(city.toLowerCase()) && (!state || text.toLowerCase().includes(state.toLowerCase()))) ?? (texts.length === 1 ? texts[0] : null) });
      return;
    }
    case "school":
      await chooseOption(page, field.id, value, { type: value, pick: (texts) => bestOption(value, texts) ?? texts.find((text) => /^other$/i.test(text)) ?? null });
      return;
    case "degree":
      await chooseOption(page, field.id, value, { pick: (texts) => degreeAnswer(value, texts) });
      return;
  }
}

/** Fills every mapped field, checks that every required field has a value, then makes one fallback pass. */
export async function fillGreenhouse(page: Page, schema: FormSchema, answers: Map<string, MappedAnswer>, files: FillFiles, fixFields?: FixFields): Promise<AdapterResult> {
  const started = Date.now();
  page.setDefaultTimeout(8_000);
  await page.goto(schema.formUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await byId(page, "first_name").waitFor({ timeout: 15_000 });
  // The form is server-rendered, then React takes over and resets any typed values. Wait for React first.
  await page.waitForFunction(() => {
    const el = document.getElementById("first_name");
    return Boolean(el && Object.keys(el).some((key) => key.startsWith("__react")));
  }, undefined, { timeout: 5_000 }).catch(() => undefined);
  const filled: string[] = [];
  const failed: AdapterResult["failed"] = [];
  for (const field of schema.fields) {
    const answer = answers.get(field.id);
    if (!answer?.values.length) continue;
    if (!(await present(page, field))) continue;
    try {
      await fillOne(page, field, answer, files);
      filled.push(field.id);
    } catch (error) {
      failed.push({ id: field.id, label: field.label, reason: error instanceof Error ? error.message.slice(0, 120) : "couldn't fill" });
    }
  }
  // A late re-render can still clear a typed box; type those again once.
  for (const field of schema.fields) {
    if (!filled.includes(field.id) || !["text", "email", "tel", "textarea"].includes(field.type) || (await currentValue(page, field))) continue;
    await fillOne(page, field, answers.get(field.id)!, files).catch(() => undefined);
  }

  // Verify: every required field on the page has a value. Anything empty gets one fallback pass.
  let llmCalls = 0;
  const fallback: string[] = [];
  const empty = (await emptyRequired(page)).filter((field) => field.control !== "file");
  if (empty.length && fixFields) {
    llmCalls = 1;
    const actions = await fixFields(empty, await siteErrors(page)).catch(() => []);
    for (const action of actions) {
      const field = empty[action.index];
      if (!field) continue;
      try {
        await applyFix(page, field, action.value);
        fallback.push(field.label);
      } catch {
        // Stays empty and is reported below.
      }
    }
  }
  for (const field of schema.fields) {
    if (!field.required || !(await present(page, field))) continue;
    if ((await currentValue(page, field)) || failed.some((item) => item.id === field.id)) continue;
    failed.push({ id: field.id, label: field.label, reason: field.type === "file" ? "Attach this file in the live view." : "Required and still empty." });
  }
  // Anything else the page itself marks required (the same question may read slightly differently there).
  const same = (a: string, b: string) => a.slice(0, 60).toLowerCase() === b.slice(0, 60).toLowerCase();
  for (const field of await emptyRequired(page)) {
    if (field.control === "file" || fallback.includes(field.label) || failed.some((item) => same(item.label, field.label))) continue;
    failed.push({ id: field.selector, label: field.label, reason: "Required and still empty." });
  }
  return { filled: filled.filter((id) => !failed.some((item) => item.id === id)), failed, fallback, llmCalls, ms: Date.now() - started };
}

/** Greenhouse may email a security code after Submit; that step is the student's. */
export async function greenhouseNeedsCode(page: Page) {
  return /security code|verification code|enter the code|we sent (a|an) (code|email)/i.test(await page.locator("body").innerText({ timeout: 3_000 }).catch(() => ""));
}
