import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addJobByHand, setDeferForTests, summary, titleMissing, updateJobDetails, deleteApplication, jobDescription } from "@/lib/apply/service";
import { choosePosting, findPosting, findPostingNow, postingsFor, setPostingSearcherForTests } from "@/lib/apply/find-posting";
import { setJobPageFetcherForTests } from "@/lib/apply/safe-fetch";
import { applications } from "@/lib/apply/store";
import { setClassifierForTests } from "@/lib/email/classify";
import { fromPostmark } from "@/lib/email/inbound";
import { jobLinksIn } from "@/lib/email/links";
import { processEmail, reviewEmail } from "@/lib/email/process";
import { emailsForJob } from "@/lib/email/service";
import { emailEvents, emailTexts, removeEmailData } from "@/lib/email/store";
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
  setClassifierForTests(null);
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

describe("links in emails", () => {
  it("keeps posting links and leaves out anything that could do something when opened", () => {
    const html = `
      <a href="https://job-boards.greenhouse.io/acme/jobs/123">The job</a>
      <a href="https://jobs.lever.co/acme/abc-def">Another</a>
      <a href="https://acme.wd5.myworkdayjobs.com/en-US/Careers/job/Boston/Analyst_R-1">Workday</a>
      <a href="https://acme.com/careers/jobs/4471">On their site</a>
      <a href="https://acme.com/careers/jobs/4471/withdraw">Withdraw</a>
      <a href="https://acme.com/careers/jobs/4472?token=abc">Your application</a>
      <a href="https://u123.ct.sendgrid.net/ls/click?upn=xyz">Tracked</a>
      <a href="https://click.acme.com/careers/jobs/1">Also tracked</a>
      <a href="https://acme.com/unsubscribe">Unsubscribe</a>
      <a href="https://www.linkedin.com/jobs/view/123">LinkedIn</a>
      <a href="http://acme.com/careers/jobs/1">Not secure</a>`;
    expect(jobLinksIn({ html, text: "See https://jobs.ashbyhq.com/acme/9f8e7d." }).sort()).toEqual([
      "https://acme.com/careers/jobs/4471",
      "https://acme.wd5.myworkdayjobs.com/en-US/Careers/job/Boston/Analyst_R-1",
      "https://job-boards.greenhouse.io/acme/jobs/123",
      "https://jobs.ashbyhq.com/acme/9f8e7d",
      "https://jobs.lever.co/acme/abc-def",
    ].sort());
  });

  it("reads the HTML when the plain text only says to view it in a browser", () => {
    const body = { Subject: "Thanks", TextBody: "View in browser", HtmlBody: "<p>Thank you for applying to the Data Intern role at Acme. We have your application and will review it soon, and a recruiter will reach out if your experience fits.</p>" };
    expect(fromPostmark(body).email.text).toContain("Data Intern role");
    expect(fromPostmark({ ...body, TextBody: "x".repeat(300) }).email.text).toBe("x".repeat(300));
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

describe("emails saved on a job", () => {
  const confirmation = { messageId: "<one@x>", from: "AlphaSights <no-reply@greenhouse.io>", subject: "Thank you for applying", text: "Thank you for applying to the Data Intern role at AlphaSights. Secret detail in the body.", html: '<a href="https://acme.com/unsubscribe">Unsubscribe</a>' };
  const reply = '{"type":"applied","company":"AlphaSights","job_title":"Data Intern","location":"London","job_number":"R-77","confidence":0.95,"summary":"AlphaSights confirmed your application."}';

  it("saves the email encrypted and shows it on its job, with what it said about the job", async () => {
    let later: Array<() => Promise<void>> = [];
    setDeferForTests((task) => { later.push(task); });
    fakeSites();
    setClassifierForTests(async () => reply);
    const userId = await student();
    const result = await processEmail(userId, confirmation, "forward");
    const id = result.applicationId!;
    expect((await applications.get(userId, id))!.location).toBe("London");
    for (const task of later) await task();
    later = [];
    const saved = await applications.get(userId, id);
    expect(saved!.fillReport?.jobNumber).toBe("R-77");
    expect(saved!.fillReport?.postingUrl).toContain("gh_jid=4");
    const { emails } = await emailsForJob(userId, id);
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({ subject: "Thank you for applying", from: confirmation.from });
    expect(emails[0].text).toContain("Secret detail");
    const { withLock } = await import("@/lib/db/file-store");
    const raw = await withLock((db) => JSON.stringify(db.emailTexts));
    expect(raw).not.toContain("Secret detail");
  });

  it("keeps nothing from an email that isn't about a job", async () => {
    setClassifierForTests(async () => '{"type":"not_job_related","company":"","job_title":null,"confidence":0.95,"summary":"A newsletter."}');
    const userId = await student();
    const result = await processEmail(userId, { messageId: "<n@x>", from: "News <n@x.com>", subject: "Your application for our newsletter", text: "Thank you for applying to our newsletter." }, "forward");
    expect(result.outcome).toBe("ignored");
    expect(await emailTexts.read(userId, [result.event!.id])).toEqual(new Map());
  });

  it("removes a dismissed email's text, a deleted job's emails, and everything when an account goes", async () => {
    setClassifierForTests(async (email) => (email.messageId === "<unsure@x>" ? '{"type":"applied","company":"Globex","job_title":null,"confidence":0.3,"summary":"Unclear."}' : reply));
    const userId = await student();
    const unsure = await processEmail(userId, { ...confirmation, messageId: "<unsure@x>" }, "forward");
    expect((await emailTexts.read(userId, [unsure.event!.id])).size).toBe(1);
    await reviewEmail(userId, { eventId: unsure.event!.id, action: "dismiss" });
    expect((await emailTexts.read(userId, [unsure.event!.id])).size).toBe(0);

    const kept = await processEmail(userId, confirmation, "forward");
    expect((await emailTexts.read(userId, [kept.event!.id])).size).toBe(1);
    await deleteApplication(userId, { applicationId: kept.applicationId });
    expect((await emailTexts.read(userId, [kept.event!.id])).size).toBe(0);

    const again = await processEmail(userId, { ...confirmation, messageId: "<two@x>" }, "forward");
    await removeEmailData(userId);
    expect((await emailTexts.read(userId, [again.event!.id])).size).toBe(0);
    expect(await emailEvents.list(userId)).toEqual([]);
  });

  it("Find the posting uses what the job's emails said", async () => {
    fakeSites();
    setClassifierForTests(async () => '{"type":"applied","company":"AlphaSights","job_title":null,"confidence":0.95,"summary":"AlphaSights confirmed your application."}');
    const userId = await student();
    const result = await processEmail(userId, confirmation, "forward");
    const first = await findPostingNow(userId, { applicationId: result.applicationId });
    expect(first).toMatchObject({ found: false, choices: 4 });
    expect(first.application?.titleMissing).toBe(true);
  });
});
