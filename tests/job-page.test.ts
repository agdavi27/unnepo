import { describe, expect, it } from "vitest";
import { isJobPage, sendsApplication } from "../extension/src/shared/job-page";

describe("isJobPage", () => {
  it("accepts application systems, job boards and job addresses", () => {
    expect(isJobPage({ url: "https://boards.greenhouse.io/stripe/jobs/123" })).toBe(true);
    expect(isJobPage({ url: "https://acme.wd5.myworkdayjobs.com/en-US/External/job/Boston/Analyst_R1" })).toBe(true);
    expect(isJobPage({ url: "https://app.joinhandshake.com/stu/jobs/9" })).toBe(true);
    // UKG Pro Recruiting's new address (UltiPro's old one is ultipro.com).
    expect(isJobPage({ url: "https://snp98.rec.pro.ukg.net/JAK1500JAKO/JobBoard/74f2e917-c09c-454b-b413-e11f7a62bf4b/OpportunityApply?opportunityId=5777cb78-b281-4c79-a8e7-6a396f0b992c" })).toBe(true);
    // LinkedIn: only a job it has open, never the feed or a search with no job picked.
    expect(isJobPage({ url: "https://www.linkedin.com/jobs/view/4012345678/" })).toBe(true);
    expect(isJobPage({ url: "https://www.linkedin.com/jobs/search/?currentJobId=4012345678&keywords=intern" })).toBe(true);
    expect(isJobPage({ url: "https://www.linkedin.com/jobs/search/?keywords=intern", description: "x".repeat(400) })).toBe(false);
    expect(isJobPage({ url: "https://www.linkedin.com/feed/", description: "x".repeat(400) })).toBe(false);
    expect(isJobPage({ url: "https://www.acme.com/careers/data-intern-4411" })).toBe(true);
    expect(isJobPage({ url: "https://careers.acme.com/role/analyst" })).toBe(true);
    expect(isJobPage({ url: "https://example.com/page", ats: "lever" })).toBe(true);
  });

  it("on Indeed, only a job it has open or Indeed Apply's form", () => {
    expect(isJobPage({ url: "https://www.indeed.com/viewjob?jk=9f8e7d6c5b4a3210" })).toBe(true);
    expect(isJobPage({ url: "https://www.indeed.com/jobs?q=intern&l=Boston&vjk=9f8e7d6c5b4a3210" })).toBe(true);
    expect(isJobPage({ url: "https://www.indeed.com/rc/clk?jk=abc123&from=serp" })).toBe(true);
    expect(isJobPage({ url: "https://smartapply.indeed.com/beta/indeedapply/form/contact-info" })).toBe(true);
    expect(isJobPage({ url: "https://www.indeed.com/jobs?q=intern&l=Boston" })).toBe(false);
    expect(isJobPage({ url: "https://www.indeed.com/cmp/Initech/reviews", description: "x".repeat(400) })).toBe(false);
    expect(isJobPage({ url: "https://www.indeed.com/career/salaries" })).toBe(false);
  });

  it("accepts any page with a posting read from it", () => {
    expect(isJobPage({ url: "https://www.acme.com/team", description: "We're hiring an analyst. ".repeat(12) })).toBe(true);
  });

  it("rejects pages that only have a title and a site name", () => {
    expect(isJobPage({ url: "https://www.nytimes.com/2026/11/10/business/hiring.html" })).toBe(false);
    expect(isJobPage({ url: "https://www.amazon.com/dp/B0123" })).toBe(false);
    expect(isJobPage({ url: "https://mail.google.com/mail/u/0/#inbox" })).toBe(false);
    expect(isJobPage({ url: "chrome://extensions" })).toBe(false);
  });

  it("rejects job search and list pages on company sites", () => {
    expect(isJobPage({ url: "https://www.acme.com/careers/" })).toBe(false);
    expect(isJobPage({ url: "https://www.acme.com/jobs/search?q=intern" })).toBe(false);
  });
});

describe("sendsApplication", () => {
  it("counts presses that send the application", () => {
    for (const label of ["1-Click Apply", "Easy Apply", "Submit application", "Submit your application", "Apply with profile"]) expect(sendsApplication(label)).toBe(true);
  });
  it("doesn't count bare Apply or Submit (filters, newsletters)", () => {
    for (const label of ["Apply", "Apply now", "Submit", "Apply filters"]) expect(sendsApplication(label)).toBe(false);
  });
});
