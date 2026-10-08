import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // /changelog reads the monorepo CHANGELOG.md at request time (lib/docs.ts
  // CHANGELOG_PATHS). It sits two directories above apps/web, outside what the
  // file tracer sees on its own, so name it or the deployed page says the
  // changelog "was not included in this build".
  turbopack: {
    // apps/web is its own npm project (own lockfile). Pin the root so Turbopack
    // never picks up a stray lockfile above the repository.
    root: path.join(__dirname),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
