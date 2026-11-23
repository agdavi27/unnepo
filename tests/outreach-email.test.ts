import { describe, expect, it } from "vitest";
import { BANNED, followUpEmail, jobIdOf, outreachEmail, shortRole, subjectFor, usable, wordCount, type Audience } from "@/lib/apply/outreach-email";
import { composeLink, withoutJobId } from "@/lib/apply/compose-link";

const base = {
  firstName: "Jane", studentName: "Drew Davis", year: "Junior", school: "Colby College", major: "Economics",
  role: "Sports Analyst", company: "WPP Media", jobId: "Job ID 11922471", audience: "recruiter" as Audience,
  connection: "Your team runs the media buying for the NBA's streaming partners.", proof: "Last season I built the stats model Colby hockey used to set its lines.",
};
const words = (text: string) => wordCount(text.replace(/^Hi [^,]+,|Thank you,\n.*$/g, ""));

describe("outreachEmail", () => {
  it("writes to a recruiter: who, the exact role and job ID, one proof point, one question", () => {
    const email = outreachEmail(base);
    expect(email.subject).toBe("Sports Analyst application");
    expect(email.body).toBe([
      "Hi Jane,",
      "I’m a junior at Colby College studying Economics, and I just applied for the Sports Analyst role (Job ID 11922471).",
      "Last season I built the stats model Colby hockey used to set its lines.",
      "Is there anything else that would help your review?",
      "Thank you,\nDrew Davis",
    ].join("\n\n"));
  });

  it("leads with the reader for a hiring manager, the school for an alum, and never asks an alum for a job", () => {
    const manager = outreachEmail({ ...base, audience: "manager" });
    expect(manager.body.split("\n\n")[1]).toBe(base.connection);
    expect(manager.body).toContain("10-minute chat");
    expect(manager.subject).toBe("Sports Analyst at WPP Media");
    const alum = outreachEmail({ ...base, audience: "alum", connection: "", proof: "" });
    expect(alum.subject).toBe("Fellow Colby College student");
    expect(alum.body).toContain("I saw that you went to Colby College too");
    expect(alum.body).toContain("15-minute call about your path to WPP Media?");
    expect(alum.body).not.toMatch(/referr|job opening|hire me/i);
  });

  it("stays short, with exactly one question, for every kind of reader", () => {
    for (const audience of ["recruiter", "manager", "alum", "peer"] as Audience[]) {
      const email = outreachEmail({ ...base, audience });
      expect(words(email.body)).toBeGreaterThanOrEqual(25);
      expect(words(email.body)).toBeLessThanOrEqual(100);
      expect(email.body.match(/\?/g)).toHaveLength(1);
      expect(email.body).not.toMatch(BANNED);
      expect(wordCount(email.subject)).toBeLessThanOrEqual(6);
      expect(email.subject.length).toBeLessThanOrEqual(40);
    }
  });

  it("drops an AI sentence that's long, asks a question, gushes, or reads like a template", () => {
    expect(usable("I hope this email finds you well.")).toBe("");
    expect(usable("I'm so passionate about media")).toBe("");
    expect(usable("Would love to chat?")).toBe("");
    expect(usable("Wow!")).toBe("");
    expect(usable(Array(30).fill("word").join(" "))).toBe("");
    expect(usable("I ran the numbers for our club's fund")).toBe("I ran the numbers for our club's fund.");
    const email = outreachEmail({ ...base, audience: "peer", connection: "I'm thrilled about WPP Media's innovative work!" });
    expect(email.body).toContain("I’d love to hear what your work at WPP Media is like.");
    expect(email.body).not.toMatch(/thrilled|innovative/);
  });

  it("drops missing pieces cleanly", () => {
    const email = outreachEmail({ ...base, year: "", major: "", jobId: "", proof: "", company: "Adidas" });
    expect(email.body).toContain("I’m a student at Colby College, and I just applied for the Sports Analyst role.");
    expect(email.body.split("\n\n")).toHaveLength(4);
    const noSchool = outreachEmail({ ...base, audience: "alum", school: "", year: "", connection: "" });
    expect(noSchool.subject).toBe("Sports Analyst at WPP Media");
    expect(noSchool.body).toContain("I’m a student studying Economics");
  });

  it("keeps a long posting title out of the subject", () => {
    expect(shortRole("Investment Banking Summer Analyst – New York, 2027")).toBe("Investment Banking Summer Analyst");
    expect(subjectFor({ audience: "recruiter", school: "", role: "Investment Banking Summer Analyst – New York", company: "Evercore" }).length).toBeLessThanOrEqual(40);
  });
});

describe("followUpEmail", () => {
  it("is a short note in the same thread, then a last one that asks who else to talk to", () => {
    const first = followUpEmail({ firstName: "Jane", studentName: "Drew Davis", role: "Sports Analyst", audience: "manager", subject: "Sports Analyst at WPP Media", number: 1, detail: "I also led a 40-person fantasy league analytics project" });
    expect(first.subject).toBe("Re: Sports Analyst at WPP Media");
    expect(words(first.body)).toBeLessThanOrEqual(50);
    expect(first.body).toContain("I also led a 40-person fantasy league analytics project.");
    expect(first.body.match(/\?/g)).toHaveLength(1);
    const last = followUpEmail({ firstName: "Jane", studentName: "Drew Davis", role: "Sports Analyst", audience: "manager", subject: first.subject, number: 2, detail: "" });
    expect(last.subject).toBe("Re: Sports Analyst at WPP Media");
    expect(words(last.body)).toBeLessThanOrEqual(40);
    expect(last.body).toContain("someone else on the team");
    expect(last.body).not.toMatch(BANNED);
  });

  it("falls back to a plain line when the AI's detail won't do", () => {
    const email = followUpEmail({ firstName: "Sam", studentName: "Drew Davis", role: "Analyst", audience: "recruiter", subject: "Analyst application", number: 1, detail: "Just following up on my application!" });
    expect(email.body).toContain("I’m still very interested in the Analyst role. Is there anything I can send to help your review?");
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

describe("withoutJobId", () => {
  it("takes a job ID out of emails written before IDs were left out", () => {
    expect(withoutJobId("applied for the Analyst position at WPP Media (Job ID 11922471) and wanted")).toBe("applied for the Analyst position at WPP Media and wanted");
    expect(withoutJobId("at Acme (Requisition ID: R-20451) and")).toBe("at Acme and");
    expect(withoutJobId("at Acme (NYC office) and")).toBe("at Acme (NYC office) and");
    expect(decodeURIComponent(composeLink("gmail", "a@b.co", "Hi", "at Acme (Job ID JR-104233) and").url)).not.toContain("JR-104233");
  });
});
