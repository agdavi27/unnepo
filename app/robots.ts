import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/config";

/** Search engines get the marketing pages and /guides; the signed-in app, the API and previews stay out. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/home", "/applications", "/jobs", "/settings", "/onboarding", "/admin", "/extension/", "/login", "/signup", "/reset", "/modal-preview"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
