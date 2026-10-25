import type { MetadataRoute } from "next";

import { site } from "@/lib/site";

/**
 * Public pages are crawlable. The workspace, the admin and the API are not.
 *
 * Query-string variants of the database-backed public pages are not crawlable
 * either: `/funder/<id>?gpage=..&gq=..` (grants table pages) and
 * `/search?...` (every filter combination). Each is a full database render,
 * each declares the bare path as its canonical URL, and together they are an
 * unbounded crawl space. The bare `/funder/<id>` and `/search` stay open.
 */
export default function robots(): MetadataRoute.Robots {
  const base = site.url.replace(/\/+$/, "");
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/app",
          "/app/",
          "/admin",
          "/admin/",
          "/api",
          "/api/",
          "/auth/",
          "/welcome",
          "/dev/",
          "/funder/*?",
          "/search?",
        ],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
