import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { repo } from "@/lib/db/file-store";
import { setJobPageFetcherForTests } from "@/lib/apply/safe-fetch";
import { setContactFetcher } from "@/lib/providers/contacts/http";
import { buildEmail, emailsOnPage, guessEmail, learnFormat, nameParts, patternFromLocals, patternOf, robotsAllows } from "@/lib/apply/email-guess";
import { useTempDb } from "./helpers";

beforeEach(() => {
  useTempDb();
  process.env.DAILY_USER_SPEND_CENTS = "500";
});

afterEach(() => setJobPageFetcherForTests(null));

/** Hunter answers: the verifier says valid only for these addresses, accept_all for a catch-all domain. */
function hunter(valid: string[], options: { acceptAll?: boolean; pattern?: string } = {}) {
  const checked: string[] = [];
  process.env.HUNTER_API_KEY = "hunter";
  setContactFetcher(async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/email-verifier")) {
      const email = url.searchParams.get("email")!;
      checked.push(email);
      return Response.json({ data: { status: options.acceptAll ? "accept_all" : valid.includes(email) ? "valid" : "invalid" } });
    }
    if (url.pathname.endsWith("/domain-search")) return Response.json({ data: { pattern: options.pattern ?? null, accept_all: Boolean(options.acceptAll), emails: [] } });
    return new Response("unexpected", { status: 500 });
  });
  return checked;
}

/** The company's website: these pages, and robots.txt. */
function site(pages: Record<string, string>) {
  setJobPageFetcherForTests(async (url) => {
    const path = new URL(url).pathname;
    return pages[path] !== undefined ? new Response(pages[path]) : new Response("not found", { status: 404 });
  });
}

describe("email formats", () => {
  it("builds and recognizes the common formats from a name", () => {
    expect(nameParts("José De la Cruz-Ortiz, Jr.")).toEqual({ first: "jose", last: "ortiz" });
    expect(buildEmail("{first}.{last}", "Jane Doe", "Acme.com")).toBe("jane.doe@acme.com");
    expect(buildEmail("{f}{last}", "Jane Doe", "acme.com")).toBe("jdoe@acme.com");
    expect(buildEmail("{first}.{last}", "Jane", "acme.com")).toBeNull();
    expect(patternOf("JDoe@acme.com", "Jane Doe")).toBe("{f}{last}");
    expect(patternOf("j.d@acme.com", "Jane Doe")).toBeNull();
    expect(patternFromLocals(["sam.lee", "ava.chen", "info"])).toBe("{first}.{last}");
    expect(patternFromLocals(["sam.lee"])).toBeNull();
  });

  it("reads personal addresses at the company's domain off a page, skipping shared inboxes", () => {
    const html = `<a href="mailto:Sam.Lee@acme.com">Sam</a> ava.chen [at] acme.com info@acme.com jo@gmail.com x@mail.acme.com.au`;
    expect(emailsOnPage(html, "acme.com")).toEqual(["sam.lee@acme.com", "ava.chen@acme.com"]);
  });

  it("follows robots.txt for every crawler", () => {
    const robots = "User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /team\nAllow: /team/public\n";
    expect(robotsAllows(robots, "/about")).toBe(true);
    expect(robotsAllows(robots, "/team")).toBe(false);
    expect(robotsAllows(robots, "/team/public")).toBe(true);
    expect(robotsAllows("", "/team")).toBe(true);
  });
});

describe("learning a company's format", () => {
  it("uses an address it already knows there, then remembers it for every student", async () => {
    site({});
    const format = await learnFormat("u1", "acme.com", [{ email: "avery.kim@acme.com", name: "Avery Kim" }], ["Jane Doe"]);
    expect(format).toMatchObject({ pattern: "{first}.{last}", source: "apollo" });
    expect(await repo.getEmailFormat("acme.com")).toMatchObject({ pattern: "{first}.{last}", source: "apollo" });
    const again = await learnFormat("u2", "acme.com", [], ["Jane Doe"]);
    expect(again.pattern).toBe("{first}.{last}");
  });

  it("reads the format off the company's team page when robots.txt allows it", async () => {
    site({ "/robots.txt": "User-agent: *\nDisallow: /private", "/team": "<p>Jane Doe · jdoe@acme.com</p><p>Sam Lee · slee@acme.com</p>" });
    const format = await learnFormat("u1", "acme.com", [], ["Jane Doe"]);
    expect(format).toMatchObject({ pattern: "{f}{last}", source: "website" });
    expect(format.known).toContainEqual({ email: "jdoe@acme.com", name: "Jane Doe" });
  });

  it("asks Hunter last", async () => {
    site({});
    hunter([], { pattern: "{first}" });
    expect(await learnFormat("u1", "acme.com", [], ["Jane Doe"])).toMatchObject({ pattern: "{first}", source: "hunter" });
  });
});

describe("guessing one person's email", () => {
  it("checks the format's address and stops at the first valid one", async () => {
    const checked = hunter(["jane.doe@acme.com"]);
    const guess = await guessEmail("u1", "Jane Doe", "acme.com", { pattern: "{first}.{last}", acceptAll: false, source: "apollo", known: [] }, [], { checks: 6 });
    expect(guess).toEqual({ email: "jane.doe@acme.com", verified: true, source: "pattern" });
    expect(checked).toEqual(["jane.doe@acme.com"]);
  });

  it("tries the three most common formats when the format is unknown, and learns it from the one that's valid", async () => {
    const checked = hunter(["jdoe@acme.com"]);
    const guess = await guessEmail("u1", "Jane Doe", "acme.com", { pattern: null, acceptAll: false, source: "none", known: [] }, [], { checks: 6 });
    expect(guess).toMatchObject({ email: "jdoe@acme.com", verified: true });
    expect(checked).toEqual(["jane.doe@acme.com", "jdoe@acme.com"]);
    expect((await repo.getEmailFormat("acme.com"))?.pattern).toBe("{f}{last}");
  });

  it("calls a catch-all company's address likely, not verified, and stops checking", async () => {
    const checked = hunter([], { acceptAll: true });
    const guess = await guessEmail("u1", "Jane Doe", "acme.com", { pattern: "{first}.{last}", acceptAll: false, source: "apollo", known: [] }, [], { checks: 6 });
    expect(guess).toEqual({ email: "jane.doe@acme.com", verified: false, source: "likely" });
    expect(checked).toHaveLength(1);
    expect((await repo.getEmailFormat("acme.com"))?.acceptAll).toBe(true);
  });

  it("gives nothing when every guess fails or the checks run out, and never a blind guess without Hunter", async () => {
    hunter([]);
    expect(await guessEmail("u1", "Jane Doe", "acme.com", { pattern: null, acceptAll: false, source: "none", known: [] }, [], { checks: 6 })).toBeNull();
    const budget = { checks: 1 };
    hunter(["jdoe@acme.com"]);
    expect(await guessEmail("u1", "Jane Doe", "acme.com", { pattern: null, acceptAll: false, source: "none", known: [] }, [], budget)).toBeNull();
    expect(budget.checks).toBe(0);
    delete process.env.HUNTER_API_KEY;
    expect(await guessEmail("u1", "Jane Doe", "acme.com", { pattern: null, acceptAll: false, source: "none", known: [] }, [], { checks: 6 })).toBeNull();
    // A known format without Hunter: likely.
    expect(await guessEmail("u1", "Jane Doe", "acme.com", { pattern: "{first}", acceptAll: false, source: "website", known: [] }, [], { checks: 6 })).toMatchObject({ email: "jane@acme.com", verified: false });
  });

  it("uses an address found on the company's site for that person first", async () => {
    const checked = hunter(["jdoe@acme.com"]);
    const guess = await guessEmail("u1", "Jane Doe", "acme.com", { pattern: "{first}.{last}", acceptAll: false, source: "website", known: [{ email: "jdoe@acme.com", name: "Jane Doe" }] }, [], { checks: 6 });
    expect(guess).toEqual({ email: "jdoe@acme.com", verified: true, source: "website" });
    expect(checked).toEqual(["jdoe@acme.com"]);
  });
});
