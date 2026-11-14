import type { MetadataRoute } from "next";
import { guideUrl, publishedGuides, SITE_URL } from "@/lib/guides";

// Re-checked every hour so each day's guide is listed the day it goes live.
export const revalidate = 3600;

/** The public pages and every published guide. Signed-in app pages are left out (robots.ts blocks them too). */
export default function sitemap(): MetadataRoute.Sitemap {
  const guides = publishedGuides(Date.now(), false);
  const latest = guides[0] ? new Date(`${guides[0].publishAt}T12:00:00Z`) : undefined;
  return [
    { url: SITE_URL, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/guides`, lastModified: latest, changeFrequency: "daily", priority: 0.8 },
    { url: `${SITE_URL}/story`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/demo`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE_URL}/for-students`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE_URL}/founder`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/privacy`, changeFrequency: "yearly", priority: 0.1 },
    { url: `${SITE_URL}/terms`, changeFrequency: "yearly", priority: 0.1 },
    ...guides.map((guide) => ({
      url: guideUrl(guide.slug),
      lastModified: new Date(`${guide.updated ?? guide.publishAt}T12:00:00Z`),
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
  ];
}
