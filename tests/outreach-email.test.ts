import { describe, expect, it } from "vitest";
import { jobIdOf, outreachEmail } from "@/lib/apply/outreach-email";

const base = {
  firstName: "Jane", studentName: "Drew Davis", year: "Junior", school: "Colby College", major: "Economics",
  role: "Sports Analyst", company: "WPP Media", jobId: "Job ID 11922471", detail: "its sports partnerships", link: "I ran stats for Colby's hockey team.",
};

describe("outreachEmail", () => {
  it("follows the template", () => {
    const email = outreachEmail(base);
    expect(email.subject).toBe("Colby College student, applied to Sports Analyst at WPP Media");
    expect(email.body).toBe([
      "Hi Jane,",
      "I’m Drew Davis, a junior at Colby College studying Economics. I just applied for the Sports Analyst position at WPP Media (Job ID 11922471) and wanted to reach out directly.",
      "I was excited to learn more about WPP Media’s work on its sports partnerships. I ran stats for Colby's hockey team.",
      "If you have a few minutes sometime this week, it would be great to learn more. Happy to connect whenever is most convenient for you. I’ve also attached my resume for your reference.",
      "Best,\nDrew Davis",
    ].join("\n\n"));
  });

  it("drops missing pieces cleanly", () => {
    const email = outreachEmail({ ...base, year: "", major: "", jobId: "", detail: "", link: "", company: "Adidas" });
    expect(email.body).toContain("I’m Drew Davis, a student at Colby College. I just applied for the Sports Analyst position at Adidas and wanted");
    expect(email.body).toContain("I was excited to learn more about the work Adidas is doing.\n");
    const noSchool = outreachEmail({ ...base, school: "", year: "" });
    expect(noSchool.subject).toBe("Applied to Sports Analyst at WPP Media");
    expect(noSchool.body).toContain("I’m Drew Davis, a student studying Economics.");
  });
});

describe("jobIdOf", () => {
  it("prefers the requisition number the posting states", () => {
    expect(jobIdOf({ jobUrl: "https://jobs.lever.co/acme/6f1c2b9e-1111-2222-3333-444455556666", description: "Requisition ID: R-20451\nAbout us" })).toBe("Job ID R-20451");
  });
  it("reads the job's number from its link", () => {
    expect(jobIdOf({ jobUrl: "https://www.linkedin.com/jobs/view/4012345678/" })).toBe("Job ID 4012345678");
    expect(jobIdOf({ jobUrl: "https://app.joinhandshake.com/jobs/11922471" })).toBe("Job ID 11922471");
    expect(jobIdOf({ jobUrl: "https://boards.greenhouse.io/acme/jobs/5123456" })).toBe("Job ID 5123456");
    expect(jobIdOf({ jobUrl: "https://acme.wd5.myworkdayjobs.com/en-US/Careers/job/Boston/Analyst_JR-104233" })).toBe("Job ID JR-104233");
  });
  it("leaves out long random ids", () => {
    expect(jobIdOf({ jobUrl: "https://jobs.lever.co/acme/6f1c2b9e-1111-2222-3333-444455556666" })).toBe("");
    expect(jobIdOf({ jobUrl: "https://jobs.ashbyhq.com/acme/0b3f6c1e-aaaa-bbbb-cccc-ddddeeeeffff" })).toBe("");
  });
});
