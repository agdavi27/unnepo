import { describe, expect, it } from "vitest";
import { BANNED, CLOSING, followUpEmail, jobIdOf, outreachEmail, shortRole, slot, subjectFor, usable, wordCount } from "@/lib/apply/outreach-email";
import { composeLink, withoutJobId } from "@/lib/apply/compose-link";
import { assembleLetter } from "@/lib/apply/cover-letter";

const base = {
  firstName: "Jane", studentName: "Drew Davis", role: "Sports Analyst", company: "WPP Media",
  field: "live sports media analytics", initiative: "WPP Media's Open Intelligence platform",
  skills: ["SQL", "statistical modeling", "client presentations"],
};
const words = (text: string) => wordCount(text.replace(/^Hi [^,]+,|(Thank you|Best),\n.*$/g, ""));

describe("outreachEmail", () => {
  it("is three sentences, with the AI filling only the slots", () => {
    const email = outreachEmail(base);
    expect(email.subject).toBe("Thank you! - Sports Analyst");
    expect(email.body).toBe([
      "Hi Jane,",
      "I just applied for the Sports Analyst role at WPP Media. I've been following your team's work in live sports media analytics, especially WPP Media's Open Intelligence platform. My experience in SQL, statistical modeling, and client presentations lines up with what the role needs. I'm really excited about the chance to join the team, so please reach out if you have any questions about my application.",
      "Best,\nDrew Davis",
    ].join("\n\n"));
  });

  it("never invents an initiative: with none, the sentence stops at the team's work", () => {
    const email = outreachEmail({ ...base, initiative: "" });
    expect(email.body).toContain("I've been following your team's work in live sports media analytics. My experience");
  });

  it("drops a slot that's long, gushes, or is a placeholder, for a plain wording", () => {
    expect(slot("[initiative]")).toBe("");
    expect(slot("their innovative, cutting-edge work")).toBe("");
    expect(slot("Wow!")).toBe("");
    expect(slot(Array(20).fill("word").join(" "))).toBe("");
    expect(slot("  sports analytics. ")).toBe("sports analytics");
    const email = outreachEmail({ ...base, field: "the innovative world of sports", initiative: "N/A", skills: ["SQL", "", "SQL", "[skill]"] });
    expect(email.body).toContain("I've been following the work your team is doing at WPP Media. ");
    expect(email.body).toContain("My experience in SQL lines up");
    const none = outreachEmail({ ...base, skills: [] });
    expect(none.body).toContain("My background lines up with what the role needs");
    expect(outreachEmail({ ...base, skills: ["SQL", "Excel"] }).body).toContain("in SQL and Excel lines up");
  });

  it("ends by saying the student is excited and inviting questions", () => {
    expect(outreachEmail(base).body).toContain(`needs. ${CLOSING}\n\nBest,`);
  });

  it("is three blocks, four sentences, and short", () => {
    const email = outreachEmail(base);
    expect(email.body.split("\n\n")).toHaveLength(3);
    expect(email.body.split("\n\n")[1].match(/[.!?](\s|$)/g)).toHaveLength(4);
    expect(BANNED.test(email.body.replace(CLOSING, ""))).toBe(false);
    expect(words(email.body)).toBeLessThanOrEqual(90);
  });

  it("keeps a long posting title out of the subject", () => {
    expect(shortRole("Investment Banking Summer Analyst – New York, 2027")).toBe("Investment Banking Summer Analyst");
    expect(subjectFor({ role: "Investment Banking Summer Analyst – New York" })).toBe("Thank you! - Investment Banking Summer Analyst");
    expect(usable("I ran the numbers for our club's fund")).toBe("I ran the numbers for our club's fund.");
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

describe("assembleLetter", () => {
  it("wraps the AI's middle sentences in the fixed greeting, closing and sign-off", () => {
    const middle = "I'm a junior at Colby studying Economics, and I just applied for the Sports Analyst role. I built SQL dashboards 40 students use.";
    expect(assembleLetter(middle, "Drew Davis").letter).toBe(`Dear Hiring Team,\n\n${middle} ${CLOSING}\n\nSincerely,\nDrew Davis`);
  });

  it("drops a greeting, sign-off or closing line the AI wrote anyway, and caps it at three sentences", () => {
    const messy = "Dear Ms. Smith,\n\nOne. Two. Three. Four.\n\nI look forward to hearing from you.\n\nSincerely,\nDrew";
    expect(assembleLetter(messy, "Drew Davis").letter).toBe(`Dear Hiring Team,\n\nOne. Two. Three. ${CLOSING}\n\nSincerely,\nDrew Davis`);
  });
});
