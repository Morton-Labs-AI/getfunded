import type { MetadataRoute } from "next";

import { site } from "@/lib/site";

/** Public pages are crawlable. The workspace, the admin and the API are not. */
export default function robots(): MetadataRoute.Robots {
  const base = site.url.replace(/\/+$/, "");
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/app", "/app/", "/admin", "/admin/", "/api", "/api/", "/auth/", "/welcome", "/dev/"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
