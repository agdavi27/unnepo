import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addJobByHand, setDeferForTests, summary, titleMissing, updateJobDetails, jobDescription } from "@/lib/apply/service";
import { choosePosting, findPosting, postingsFor, setPostingSearcherForTests } from "@/lib/apply/find-posting";
import { setJobPageFetcherForTests } from "@/lib/apply/safe-fetch";
import { applications } from "@/lib/apply/store";
import { login, signUp, verifyEmail } from "@/lib/services/auth";
import { useTempDb } from "./helpers";

let counter = 0;
async function student() {
  counter += 1;
  const email = `pat${counter}@colby.edu`;
  const signed = await signUp({ email, password: "password123", name: "Pat Doe" });
  await verifyEmail(signed.verifyToken!);
  return (await login(email, "password123")).user.id;
}

const GREENHOUSE_LIST = { jobs: [
  { id: 1, title: "Associate, Client Service, 2027", location: { name: "New York" }, absolute_url: "https://www.alphasights.com/careers/open-roles?gh_jid=1" },
  { id: 2, title: "Associate, Client Service, 2027", location: { name: "San Francisco" }, absolute_url: "https://www.alphasights.com/careers/open-roles?gh_jid=2" },
  { id: 3, title: "Associate, Client Service, Arabic Speaker, 2027", location: { name: "Dubai" }, absolute_url: "https://www.alphasights.com/careers/open-roles?gh_jid=3" },
  { id: 4, title: "Data Intern", location: { name: "London" }, absolute_url: "https://www.alphasights.com/careers/open-roles?gh_jid=4" },
] };

/** Only AlphaSights has a job list. Everything else is a 404, so nothing here reaches the internet. */
function fakeSites(extra: Record<string, unknown> = {}) {
  const seen: string[] = [];
  setJobPageFetcherForTests(async (url) => {
    seen.push(url);
    const pages: Record<string, unknown> = {
      "https://boards-api.greenhouse.io/v1/boards/alphasights/jobs": GREENHOUSE_LIST,
      "https://boards-api.greenhouse.io/v1/boards/alphasights": { name: "AlphaSights" },
      "https://boards-api.greenhouse.io/v1/boards/alphasights/jobs/4?questions=true": { title: "Data Intern", location: { name: "London" }, content: "<p>Work with data at AlphaSights.</p>", absolute_url: "https://www.alphasights.com/careers/open-roles?gh_jid=4" },
      "https://boards-api.greenhouse.io/v1/boards/alphasights/jobs/1?questions=true": { title: "Associate, Client Service, 2027", location: { name: "New York" }, content: "<p>Advise clients at AlphaSights.</p>" },
      ...extra,
    };
    return url in pages ? new Response(JSON.stringify(pages[url]), { status: 200, headers: { "content-type": "application/json" } }) : new Response("not found", { status: 404 });
  });
  return seen;
}
async function emailJob(userId: string, title: string, company = "AlphaSights") {
  return (await addJobByHand(userId, { title, company })).application;
}

beforeEach(() => {
  useTempDb();
  setDeferForTests(() => undefined);
  setPostingSearcherForTests(async () => []);
});
afterEach(() => {
  setDeferForTests(null);
  setJobPageFetcherForTests(null);
  setPostingSearcherForTests(null);
});

describe("job details", () => {
  it("treats 'Unknown role' as a missing title", () => {
    expect(titleMissing("Unknown role")).toBe(true);
    expect(titleMissing("Data Intern")).toBe(false);
  });

  it("doesn't shorten a long description when it's edited, and hands back the whole thing", async () => {
    const userId = await student();
    const app = await emailJob(userId, "Data Intern");
    const long = "word ".repeat(2000).trim();
    await updateJobDetails(userId, { applicationId: app.id, description: long });
    const saved = await applications.get(userId, app.id);
    expect(saved!.description).toBe(long);
    expect(summary(saved!)).toMatchObject({ descriptionCut: true });
    expect(summary(saved!).description.length).toBe(4000);
    expect((await jobDescription(userId, app.id)).description).toBe(long);
  });
});

describe("finding a posting", () => {
  const listed = GREENHOUSE_LIST.jobs.map((job) => ({ title: job.title, location: job.location.name, url: job.absolute_url, readUrl: `r${job.id}`, board: "greenhouse" }));

  it("prefers the exact title over one that only shares its words", () => {
    expect(postingsFor(listed, { title: "Associate, Client Service, 2027" }).map((job) => job.location)).toEqual(["New York", "San Francisco"]);
  });
  it("narrows by place when it can", () => {
    expect(postingsFor(listed, { title: "Associate, Client Service, 2027", location: "San Francisco, CA" }).map((job) => job.location)).toEqual(["San Francisco"]);
  });

  it("fills a job in from the company's job list when one posting fits", async () => {
    fakeSites();
    const userId = await student();
    const app = await emailJob(userId, "Data Intern");
    const result = await findPosting(userId, app.id, {}, { web: false });
    expect(result).toMatchObject({ found: true, how: "job_list" });
    const saved = await applications.get(userId, app.id);
    expect(saved).toMatchObject({ location: "London", jobUrl: "https://www.alphasights.com/careers/open-roles?gh_jid=4" });
    expect(saved!.fillReport?.postingUrl).toBe("https://www.alphasights.com/careers/open-roles?gh_jid=4");
    expect(saved!.description).toContain("Work with data");
  });

  it("asks which one when a job is listed in two places, and uses the one picked", async () => {
    fakeSites();
    const userId = await student();
    const app = await emailJob(userId, "Associate, Client Service, 2027");
    const result = await findPosting(userId, app.id, {}, { web: false });
    expect(result).toMatchObject({ found: false, choices: 2 });
    let saved = await applications.get(userId, app.id);
    expect(saved!.fillReport?.postingChoices).toHaveLength(2);
    expect(saved!.location).toBeNull();
    await expect(choosePosting(userId, { applicationId: app.id, url: "https://not-on-the-list.example/job" })).rejects.toThrow();
    await choosePosting(userId, { applicationId: app.id, url: "https://www.alphasights.com/careers/open-roles?gh_jid=1" });
    saved = await applications.get(userId, app.id);
    expect(saved).toMatchObject({ location: "New York", jobUrl: "https://www.alphasights.com/careers/open-roles?gh_jid=1" });
    expect(saved!.fillReport?.postingChoices).toBeUndefined();
  });

  it("never replaces what the student typed", async () => {
    fakeSites();
    const userId = await student();
    const app = await emailJob(userId, "Data Intern");
    await updateJobDetails(userId, { applicationId: app.id, location: "Remote", description: "My own long notes about this job.".repeat(20) });
    await findPosting(userId, app.id, {}, { web: false });
    const saved = await applications.get(userId, app.id);
    expect(saved).toMatchObject({ location: "Remote", title: "Data Intern" });
    expect(saved!.description).toContain("My own long notes");
  });

  it("won't use another company's job list that has the same address", async () => {
    fakeSites({
      "https://boards-api.greenhouse.io/v1/boards/acme/jobs": { jobs: [{ id: 9, title: "Data Intern", location: { name: "Boston" }, absolute_url: "https://other.example/9" }] },
      "https://boards-api.greenhouse.io/v1/boards/acme": { name: "Totally Different Inc" },
    });
    const userId = await student();
    const app = await emailJob(userId, "Data Intern", "Acme");
    expect(await findPosting(userId, app.id, {}, { web: false })).toMatchObject({ found: false, choices: 0 });
  });

  it("only pays for a web search with a title, and checks what comes back", async () => {
    const page = "https://careers.acme.com/jobs/12";
    const html = `<html><head><title>Data Intern</title><script type="application/ld+json">${JSON.stringify({ "@type": "JobPosting", title: "Data Intern", hiringOrganization: { name: "Acme" }, description: "<p>Data work at Acme, with plenty to say about it so this reads as a real posting.</p>" })}</script></head><body>Data Intern at Acme</body></html>`;
    setJobPageFetcherForTests(async (url) => new Response(url === page ? html : "not found", { status: url === page ? 200 : 404, headers: { "content-type": "text/html" } }));
    const searched: string[] = [];
    setPostingSearcherForTests(async (query) => {
      searched.push(`${query.company}|${query.title}`);
      return ["https://careers.acme.com/jobs/99", page];
    });
    const userId = await student();
    const app = await emailJob(userId, "Data Intern", "Acme");
    expect(await findPosting(userId, app.id, {}, { web: false })).toMatchObject({ found: false });
    expect(searched).toEqual([]);
    expect(await findPosting(userId, app.id, {}, { web: true })).toMatchObject({ found: true, how: "web" });
    expect(searched).toEqual(["Acme|Data Intern"]);
    expect((await applications.get(userId, app.id))!.fillReport?.postingUrl).toBe(page);
  });

  it("rejects a web result for a different job", async () => {
    const html = `<html><head><title>Sales Manager</title><script type="application/ld+json">${JSON.stringify({ "@type": "JobPosting", title: "Sales Manager", hiringOrganization: { name: "Acme" }, description: "<p>Sell things at Acme, with plenty to say about it so this reads as a real posting.</p>" })}</script></head><body>Sales Manager</body></html>`;
    setJobPageFetcherForTests(async (url) => new Response(url.includes("careers.acme.com") ? html : "not found", { status: url.includes("careers.acme.com") ? 200 : 404, headers: { "content-type": "text/html" } }));
    setPostingSearcherForTests(async () => ["https://careers.acme.com/jobs/12"]);
    const userId = await student();
    const app = await emailJob(userId, "Data Intern", "Acme");
    expect(await findPosting(userId, app.id, {}, { web: true })).toMatchObject({ found: false });
    expect((await applications.get(userId, app.id))!.fillReport?.postingUrl).toBeUndefined();
  });
});
