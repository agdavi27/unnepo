import { guideUrl, publishedGuides, publishTime, SITE_URL } from "@/lib/guides";

// Re-checked every hour, like the pages, so each new guide joins the feed on its day.
export const revalidate = 3600;

function escape(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** RSS for /guides: published guides only, newest first. */
export function GET() {
  const guides = publishedGuides(Date.now(), false);
  const items = guides.map((guide) => `    <item>
      <title>${escape(guide.title)}</title>
      <link>${guideUrl(guide.slug)}</link>
      <guid isPermaLink="true">${guideUrl(guide.slug)}</guid>
      <pubDate>${new Date(publishTime(guide.publishAt)).toUTCString()}</pubDate>
      <category>${escape(guide.category)}</category>
      <description>${escape(guide.description)}</description>
    </item>`).join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Unnepo student career guides</title>
    <link>${SITE_URL}/guides</link>
    <atom:link href="${SITE_URL}/guides/rss.xml" rel="self" type="application/rss+xml" />
    <description>Practical guides for college students applying to internships and first jobs.</description>
    <language>en-us</language>
    <lastBuildDate>${guides[0] ? new Date(publishTime(guides[0].publishAt)).toUTCString() : new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>
`;
  return new Response(xml, { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
}
