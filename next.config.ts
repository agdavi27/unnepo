import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Production deploy marker. Keeps an empty commit from being skipped.
  // Cache Components prerendered the client forms as static HTML and the
  // browser submitted them natively, so sign-in never reached the API.
  allowedDevOrigins: ["127.0.0.1"],
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
