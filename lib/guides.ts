import fs from "node:fs";
import path from "node:path";

/**
 * The /guides blog. Every article is a Markdown file in content/guides with a small front-matter block. All of them
 * ship in the repo at once; each one only appears (on /guides, its own page, the sitemap and the RSS feed) once its
 * `publishAt` date has arrived, so the blog posts one a day by itself with no cron job and no redeploy.
 *
 * Front matter: title, description, keyword (the search phrase it targets), category, publishAt (YYYY-MM-DD), and
 * optionally updated (YYYY-MM-DD). The body is a small Markdown subset (see parseBlocks) plus a `[[cta]]` line where
 * the mid-article Unnepo box goes.
 */

import { SITE_URL } from "@/lib/config";

export { SITE_URL };
export const GUIDES_AUTHOR = { name: "Drew Davis", role: "Student at Colby College and founder of Unnepo" };

const GUIDES_DIR = path.join(process.cwd(), "content", "guides");

/** An article goes live at midnight Eastern (05:00 UTC in winter) on its publish date. */
const PUBLISH_HOUR_UTC = 5;

export type Inline = string;

export type Block =
  | { type: "h2"; text: Inline; id: string }
  | { type: "h3"; text: Inline }
  | { type: "p"; text: Inline }
  | { type: "ul"; items: Inline[] }
  | { type: "ol"; items: Inline[] }
  | { type: "quote"; lines: Inline[] }
  | { type: "cta" };

export type Faq = { question: string; answer: string };

export type Guide = {
  slug: string;
  title: string;
  description: string;
  keyword: string;
  category: string;
  publishAt: string;
  updated?: string;
  blocks: Block[];
  faq: Faq[];
  readMinutes: number;
};

export function publishTime(date: string) {
  return Date.parse(`${date}T${String(PUBLISH_HOUR_UTC).padStart(2, "0")}:00:00Z`);
}

/** Splits the front matter off a Markdown file. Values are plain `key: value` lines. */
export function parseFrontMatter(source: string) {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(source.replace(/\r\n/g, "\n"));
  if (!match) return { data: {} as Record<string, string>, body: source };
  const data: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const at = line.indexOf(":");
    if (at > 0) data[line.slice(0, at).trim()] = line.slice(at + 1).trim().replace(/^"(.*)"$/, "$1");
  }
  return { data, body: source.replace(/\r\n/g, "\n").slice(match[0].length) };
}

export function slugify(text: string) {
  return text.toLowerCase().replace(/\*\*|\*|`/g, "").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Strips inline Markdown so text can go into meta tags, JSON-LD and the RSS feed. */
export function plainText(text: string) {
  return text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1").replace(/`([^`]+)`/g, "$1");
}

/**
 * The Markdown the articles use: `## ` and `### ` headings, paragraphs, `- ` and `1. ` lists, `> ` quotes (used for
 * email templates; consecutive lines stay one block, a bare `>` is a blank line inside it), and `[[cta]]`.
 */
export function parseBlocks(body: string): Block[] {
  const blocks: Block[] = [];
  const lines = body.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) { i++; continue; }
    if (trimmed === "[[cta]]") { blocks.push({ type: "cta" }); i++; continue; }
    if (trimmed.startsWith("### ")) { blocks.push({ type: "h3", text: trimmed.slice(4) }); i++; continue; }
    if (trimmed.startsWith("## ")) { const text = trimmed.slice(3); blocks.push({ type: "h2", text, id: slugify(text) }); i++; continue; }
    if (trimmed.startsWith(">")) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) { quote.push(lines[i].trim().replace(/^>\s?/, "")); i++; }
      blocks.push({ type: "quote", lines: quote });
      continue;
    }
    if (/^- /.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^- /.test(lines[i].trim())) { items.push(lines[i].trim().slice(2)); i++; }
      blocks.push({ type: "ul", items });
      continue;
    }
    if (/^\d+\. /.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\. /.test(lines[i].trim())) { items.push(lines[i].trim().replace(/^\d+\.\s/, "")); i++; }
      blocks.push({ type: "ol", items });
      continue;
    }
    const paragraph: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{2,3} |> ?|>$|- |\d+\. |\[\[cta\]\])/.test(lines[i].trim())) { paragraph.push(lines[i].trim()); i++; }
    blocks.push({ type: "p", text: paragraph.join(" ") });
  }
  return blocks;
}

/** The questions under a "Frequently asked questions" heading, for the page and its FAQPage structured data. */
export function extractFaq(blocks: Block[]): Faq[] {
  const start = blocks.findIndex((block) => block.type === "h2" && /frequently asked/i.test(block.text));
  if (start < 0) return [];
  const faq: Faq[] = [];
  for (const block of blocks.slice(start + 1)) {
    if (block.type === "h2") break;
    if (block.type === "h3") faq.push({ question: plainText(block.text), answer: "" });
    else if (faq.length && block.type === "p") faq[faq.length - 1].answer = `${faq[faq.length - 1].answer} ${plainText(block.text)}`.trim();
  }
  return faq.filter((item) => item.answer);
}

export function parseGuide(slug: string, source: string): Guide {
  const { data, body } = parseFrontMatter(source);
  for (const key of ["title", "description", "keyword", "category", "publishAt"]) {
    if (!data[key]) throw new Error(`content/guides/${slug}.md is missing "${key}" in its front matter.`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.publishAt)) throw new Error(`content/guides/${slug}.md: publishAt must be YYYY-MM-DD.`);
  const blocks = parseBlocks(body);
  const words = body.split(/\s+/).filter(Boolean).length;
  return {
    slug,
    title: data.title,
    description: data.description,
    keyword: data.keyword,
    category: data.category,
    publishAt: data.publishAt,
    updated: data.updated || undefined,
    blocks,
    faq: extractFaq(blocks),
    readMinutes: Math.max(1, Math.round(words / 230)),
  };
}

let cache: Guide[] | null = null;

/** Every article, published or not, oldest first (then by title, so a day with several has a stable order). */
export function allGuides(): Guide[] {
  if (cache && process.env.NODE_ENV === "production") return cache;
  const files = fs.existsSync(GUIDES_DIR) ? fs.readdirSync(GUIDES_DIR).filter((file) => file.endsWith(".md")) : [];
  const guides = files.map((file) => parseGuide(file.replace(/\.md$/, ""), fs.readFileSync(path.join(GUIDES_DIR, file), "utf8")));
  guides.sort((a, b) => a.publishAt.localeCompare(b.publishAt) || a.title.localeCompare(b.title));
  cache = guides;
  return guides;
}

export function isPublished(guide: Pick<Guide, "publishAt">, now = Date.now()) {
  return publishTime(guide.publishAt) <= now;
}

/** In development every article shows, marked "Scheduled", so you can read them before they go live. */
export function showsScheduled() {
  return process.env.NODE_ENV !== "production";
}

/** The articles a visitor can see right now, newest first. */
export function publishedGuides(now = Date.now(), includeScheduled = showsScheduled()): Guide[] {
  return allGuides().filter((guide) => includeScheduled || isPublished(guide, now)).reverse();
}

export function getGuide(slug: string, now = Date.now(), includeScheduled = showsScheduled()): Guide | null {
  const guide = allGuides().find((item) => item.slug === slug);
  if (!guide) return null;
  return includeScheduled || isPublished(guide, now) ? guide : null;
}

/** Up to `count` published articles to read next: the same category first, then the most recent others. */
export function relatedGuides(guide: Guide, count = 3, now = Date.now(), includeScheduled = showsScheduled()): Guide[] {
  const others = publishedGuides(now, includeScheduled).filter((item) => item.slug !== guide.slug);
  const same = others.filter((item) => item.category === guide.category);
  const rest = others.filter((item) => item.category !== guide.category);
  return [...same, ...rest].slice(0, count);
}

export function guideUrl(slug: string) {
  return `${SITE_URL}/guides/${slug}`;
}

export function formatGuideDate(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}
