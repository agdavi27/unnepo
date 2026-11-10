import { describe, expect, it } from "vitest";
import { isJobPage, sendsApplication } from "../extension/src/shared/job-page";

describe("isJobPage", () => {
  it("accepts application systems, job boards and job addresses", () => {
    expect(isJobPage({ url: "https://boards.greenhouse.io/stripe/jobs/123" })).toBe(true);
    expect(isJobPage({ url: "https://acme.wd5.myworkdayjobs.com/en-US/External/job/Boston/Analyst_R1" })).toBe(true);
    expect(isJobPage({ url: "https://app.joinhandshake.com/stu/jobs/9" })).toBe(true);
    expect(isJobPage({ url: "https://www.acme.com/careers/data-intern-4411" })).toBe(true);
    expect(isJobPage({ url: "https://careers.acme.com/role/analyst" })).toBe(true);
    expect(isJobPage({ url: "https://example.com/page", ats: "lever" })).toBe(true);
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
    for (const label of ["1-Click Apply", "Easy Apply", "Submit application", "Apply with profile"]) expect(sendsApplication(label)).toBe(true);
  });
  it("doesn't count bare Apply or Submit (filters, newsletters)", () => {
    for (const label of ["Apply", "Apply now", "Submit", "Apply filters"]) expect(sendsApplication(label)).toBe(false);
  });
});
