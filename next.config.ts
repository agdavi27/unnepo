import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Production deploy marker. Keeps an empty commit from being skipped.
  // Cache Components prerendered the client forms as static HTML and the
  // browser submitted them natively, so sign-in never reached the API.
  allowedDevOrigins: ["127.0.0.1"],
  // The guides are read from content/guides at request time, so ship those files with the routes that read them.
  outputFileTracingIncludes: {
    "/guides": ["./content/guides/**/*"],
    "/guides/*": ["./content/guides/**/*"],
    "/guides/*/opengraph-image": ["./content/guides/**/*"],
    "/guides/rss.xml": ["./content/guides/**/*"],
    "/sitemap.xml": ["./content/guides/**/*"],
  },
  serverExternalPackages: ["bcryptjs", "mammoth", "unpdf", "@sentry/node", "postgres"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
