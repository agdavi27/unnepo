import { describe, expect, it } from "vitest";
import { companyGuess, junkCompanyName } from "@/lib/apply/company-name";

describe("company names read off a job page", () => {
  it("leaves the company blank for job sites and LinkedIn's lines", () => {
    for (const read of ["No response insights available yet", "No response insights available yet · LinkedIn", "LinkedIn", "Handshake", "Indeed", "ZipRecruiter", "Glassdoor", "Easy Apply", "Promoted", "200 applicants", ""]) {
      expect(companyGuess(read), read).toBe("");
    }
    expect(junkCompanyName("Response insights")).toBe(true);
  });

  it("keeps a real company, dropping a job site's name next to it", () => {
    expect(companyGuess("Stripe")).toBe("Stripe");
    expect(companyGuess("Stripe · LinkedIn")).toBe("Stripe");
    expect(companyGuess("Pennock & Co. | Indeed")).toBe("Pennock & Co.");
    expect(companyGuess("Johnson & Johnson")).toBe("Johnson & Johnson");
    expect(companyGuess("Coca-Cola")).toBe("Coca-Cola");
    expect(junkCompanyName("Insight Global")).toBe(false);
  });
});
