import { describe, expect, it } from "vitest";
import { findApplyEmail } from "@/extension/src/content/email-apply";

describe("findApplyEmail", () => {
  it("finds the address a posting says to apply at", () => {
    expect(findApplyEmail("Design Intern\nAbout us\nTo apply, send your resume and portfolio to hi@pennock.co.")).toEqual({ email: "hi@pennock.co", said: "To apply, send your resume and portfolio to hi@pennock.co." });
    expect(findApplyEmail("How to apply\nEmail jobs@acme.com with the subject line \"Summer Analyst\" and your CV.")?.email).toBe("jobs@acme.com");
    expect(findApplyEmail("How to Apply\nInterested candidates should submit a cover letter and resume to careers@smallco.org")?.email).toBe("careers@smallco.org");
  });
  it("leaves out addresses that aren't for applying", () => {
    expect(findApplyEmail("If you need an accommodation during the application process, email accommodations@acme.com.")).toBeNull();
    expect(findApplyEmail("Questions about our privacy policy and your application data? privacy@acme.com")).toBeNull();
    expect(findApplyEmail("Contact us: hello@acme.com")).toBeNull();
    expect(findApplyEmail("Apply below.\nPress inquiries: press@acme.com")).toBeNull();
  });
});
