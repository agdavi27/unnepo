import { beforeEach, describe, expect, it } from "vitest";
import { repo } from "@/lib/db/file-store";
import { allGuides, extractFaq, getGuide, isPublished, parseBlocks, parseFrontMatter, publishedGuides, publishTime, relatedGuides } from "@/lib/guides";
import { joinWaitlist } from "@/lib/waitlist";
import { useTempDb } from "./helpers";

describe("guide parsing", () => {
  it("reads front matter, stripping surrounding quotes but keeping inner ones", () => {
    const { data, body } = parseFrontMatter('---\ntitle: "A: B"\nother: Say "hi" (now)\n---\nBody');
    expect(data).toEqual({ title: "A: B", other: 'Say "hi" (now)' });
    expect(body).toBe("Body");
  });

  it("turns the Markdown subset into blocks", () => {
    const blocks = parseBlocks("Intro line\ncontinues.\n\n## Big Idea\n- one\n- two\n\n1. first\n2. second\n\n> Hi,\n>\n> Thanks\n\n[[cta]]\n\n### Small");
    expect(blocks.map((block) => block.type)).toEqual(["p", "h2", "ul", "ol", "quote", "cta", "h3"]);
    expect(blocks[0]).toEqual({ type: "p", text: "Intro line continues." });
    expect(blocks[1]).toMatchObject({ id: "big-idea" });
    expect(blocks[4]).toEqual({ type: "quote", lines: ["Hi,", "", "Thanks"] });
  });

  it("pulls FAQ questions and answers for structured data", () => {
    const faq = extractFaq(parseBlocks("## Frequently asked questions\n\n### Is it **ok**?\n\nYes, see [this](/guides/x).\n\n## After"));
    expect(faq).toEqual([{ question: "Is it ok?", answer: "Yes, see this." }]);
  });
});

describe("scheduling", () => {
  const guides = allGuides();
  const first = guides[0];
  const last = guides[guides.length - 1];

  it("goes live at midnight Eastern on the publish date", () => {
    expect(new Date(publishTime("2026-11-14")).toISOString()).toBe("2026-11-14T05:00:00.000Z");
    expect(isPublished({ publishAt: "2026-11-14" }, Date.parse("2026-11-14T04:59:59Z"))).toBe(false);
    expect(isPublished({ publishAt: "2026-11-14" }, Date.parse("2026-11-14T05:00:00Z"))).toBe(true);
  });

  it("hides future guides from listings, pages and related links in production", () => {
    const before = publishTime(last.publishAt) - 1;
    expect(publishedGuides(before, false).some((guide) => guide.slug === last.slug)).toBe(false);
    expect(getGuide(last.slug, before, false)).toBeNull();
    expect(relatedGuides(first, 30, before, false).some((guide) => guide.slug === last.slug)).toBe(false);
    expect(getGuide(last.slug, publishTime(last.publishAt), false)?.slug).toBe(last.slug);
  });

  it("lists published guides newest first", () => {
    const list = publishedGuides(publishTime(last.publishAt), false);
    expect(list[0].slug).toBe(last.slug);
    expect(list).toHaveLength(guides.length);
  });
});

describe("the article set", () => {
  const guides = allGuides();
  const slugs = new Set(guides.map((guide) => guide.slug));

  it("has 30 articles: five on launch day, then one a day", () => {
    expect(guides).toHaveLength(30);
    const byDay = new Map<string, number>();
    for (const guide of guides) byDay.set(guide.publishAt, (byDay.get(guide.publishAt) ?? 0) + 1);
    const days = [...byDay.keys()].sort();
    expect(byDay.get(days[0])).toBe(5);
    expect(days.slice(1).every((day) => byDay.get(day) === 1)).toBe(true);
    for (let i = 1; i < days.length; i++) expect(publishTime(days[i]) - publishTime(days[i - 1])).toBe(24 * 60 * 60 * 1000);
  });

  it.each(guides.map((guide) => [guide.slug, guide] as const))("%s is complete and SEO-ready", (_slug, guide) => {
    expect(guide.title.length).toBeLessThanOrEqual(80);
    expect(guide.description.length).toBeGreaterThanOrEqual(80);
    expect(guide.description.length).toBeLessThanOrEqual(220);
    expect(guide.blocks.filter((block) => block.type === "cta")).toHaveLength(1);
    expect(guide.faq.length).toBeGreaterThanOrEqual(3);
    expect(guide.readMinutes).toBeGreaterThanOrEqual(3);
    const body = JSON.stringify(guide.blocks);
    const links = [...body.matchAll(/\]\(\/guides\/([a-z0-9-]+)\)/g)].map((match) => match[1]);
    expect(links.length).toBeGreaterThanOrEqual(2);
    for (const target of links) {
      expect(slugs.has(target), `${guide.slug} links to missing guide ${target}`).toBe(true);
      expect(target).not.toBe(guide.slug);
    }
  });

  it("gives every article a unique title and search phrase", () => {
    expect(new Set(guides.map((guide) => guide.title)).size).toBe(guides.length);
    expect(new Set(guides.map((guide) => guide.keyword.toLowerCase())).size).toBe(guides.length);
  });
});

describe("waitlist source", () => {
  beforeEach(() => { useTempDb(); });

  it("records the guide a signup came from, keeps the first one, and drops junk", async () => {
    await joinWaitlist({ name: "Pat", email: "pat@colby.edu", source: "guide/how-to-follow-up-on-a-job-application" });
    await joinWaitlist({ name: "Pat", email: "pat@colby.edu", source: "guide/other" });
    await joinWaitlist({ name: "Sam", email: "sam@colby.edu", source: "<script>" });
    const rows = await repo.listWaitlist();
    expect(rows.find((row) => row.email === "pat@colby.edu")?.source).toBe("guide/how-to-follow-up-on-a-job-application");
    expect(rows.find((row) => row.email === "sam@colby.edu")?.source).toBeUndefined();
  });
});
