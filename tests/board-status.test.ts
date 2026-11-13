import { describe, expect, it } from "vitest";
import { APPLIED_LINE, appliedDay, isAppliedListPage } from "@/extension/src/content/board-status";
import { newLabel } from "@/extension/src/content/quick-apply";

const now = new Date(2026, 10, 12, 15, 0);

describe("APPLIED_LINE", () => {
  it.each([
    "Applied on November 12, 2026",
    "Applied 3 days ago",
    "✓ Applied · Nov 2",
    "Application submitted on 11/02/2026",
    "You applied today",
    "Applied 2026-11-01",
  ])("matches %s", (text) => expect(APPLIED_LINE.test(text)).toBe(true));

  it.each(["Applied Scientist", "Applied Machine Learning Intern", "Applied", "Apply now", "Applied Physics Lab"])(
    "ignores %s",
    (text) => expect(APPLIED_LINE.test(text)).toBe(false),
  );
});

describe("appliedDay", () => {
  it("reads dates the boards show", () => {
    expect(appliedDay("Applied on November 12, 2026", now)).toBe("2026-11-12");
    expect(appliedDay("Applied 3 days ago", now)).toBe("2026-11-09");
    expect(appliedDay("Applied 2 weeks ago", now)).toBe("2026-10-29");
    expect(appliedDay("Applied today", now)).toBe("2026-11-12");
    expect(appliedDay("Applied yesterday", now)).toBe("2026-11-11");
    expect(appliedDay("Applied 5 hours ago", now)).toBe("2026-11-12");
    expect(appliedDay("Application submitted on 11/02/2026", now)).toBe("2026-11-02");
    expect(appliedDay("Applied 2026-10-03", now)).toBe("2026-10-03");
  });

  it("puts a yearless date in the future into last year", () => {
    expect(appliedDay("Applied Nov 2", now)).toBe("2026-11-02");
    expect(appliedDay("Applied Dec 20", now)).toBe("2025-12-20");
  });

  it("returns empty when there is no date", () => expect(appliedDay("Applied", now)).toBe(""));
});

describe("isAppliedListPage", () => {
  const page = (url: string) => {
    const { hostname, pathname, search } = new URL(url);
    return isAppliedListPage({ hostname, pathname, search });
  };
  it("knows the boards' application lists", () => {
    expect(page("https://app.joinhandshake.com/stu/applications")).toBe(true);
    expect(page("https://colby.joinhandshake.com/applications?page=2")).toBe(true);
    expect(page("https://www.linkedin.com/my-items/saved-jobs/?cardType=APPLIED")).toBe(true);
    expect(page("https://www.linkedin.com/jobs-tracker/?stage=applied")).toBe(true);
    expect(page("https://www.ziprecruiter.com/candidate/my-jobs")).toBe(true);
    expect(page("https://myjobs.indeed.com/applied")).toBe(true);
  });
  it("leaves job pages alone", () => {
    expect(page("https://app.joinhandshake.com/stu/jobs/123")).toBe(false);
    expect(page("https://www.linkedin.com/my-items/saved-jobs/?cardType=SAVED")).toBe(false);
    expect(page("https://www.linkedin.com/jobs/view/123")).toBe(false);
    expect(page("https://www.example.com/applications")).toBe(false);
  });
});

describe("newLabel", () => {
  it("finds an Applied label that appeared", () => {
    expect(newLabel(new Map([["Apply", 1]]), new Map([["Applied", 1]]))).toBeTruthy();
    expect(newLabel(new Map([["Applied", 1]]), new Map([["Applied", 2]]))).toBeTruthy();
  });
  it("ignores labels that were already there", () => {
    expect(newLabel(new Map([["Applied", 1]]), new Map([["Applied", 1]]))).toBeFalsy();
  });
});
