export type ParsedLinkedInJob = {
  externalId: string;
  title: string;
  company: string;
  location: string;
  url: string;
  postedAt: string;
  logoUrl: string | null;
};

export function parseLinkedInGuestHtml(html: string): ParsedLinkedInJob[] {
  const cards = html.split(/<li\b/i).slice(1);
  const jobs: ParsedLinkedInJob[] = [];
  for (const card of cards) {
    const externalId = card.match(/jobPosting:(\d+)/)?.[1];
    const title = text(card.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)?.[1] || "");
    const company = text(card.match(/hidden-nested-link[\s\S]*?>([\s\S]*?)<\/a>/i)?.[1] || "");
    const location = text(card.match(/job-search-card__location">([\s\S]*?)<\/span>/i)?.[1] || "");
    const href = decode(card.match(/href="(https:\/\/www\.linkedin\.com\/jobs\/view\/[^"]+)"/i)?.[1] || "");
    const postedAt = card.match(/datetime="([^"]+)"/i)?.[1] || new Date().toISOString();
    const logoUrl = decode(card.match(/data-delayed-url="([^"]+)"/i)?.[1] || "") || null;
    if (!externalId || !title || !href) continue;
    jobs.push({
      externalId,
      title,
      company: company || "Company",
      location,
      url: href.split("?")[0],
      postedAt: postedAt.length === 10 ? `${postedAt}T00:00:00.000Z` : postedAt,
      logoUrl,
    });
  }
  return jobs;
}

function text(value: string) {
  return decode(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function decode(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
