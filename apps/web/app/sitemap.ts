import type { MetadataRoute } from "next";

import { listDocs } from "@/lib/docs";
import { site } from "@/lib/site";

/**
 * Public pages only. Funder profiles are not listed here on purpose: with
 * millions of organizations a sitemap index belongs to the search owner,
 * generated from the corpus, not hand-written.
 */
const STATIC_ROUTES: Array<{ path: string; changeFrequency: "daily" | "weekly" | "monthly" | "yearly"; priority: number }> = [
  { path: "/", changeFrequency: "weekly", priority: 1 },
  { path: "/search", changeFrequency: "daily", priority: 0.9 },
  { path: "/pricing", changeFrequency: "monthly", priority: 0.8 },
  { path: "/docs", changeFrequency: "weekly", priority: 0.8 },
  { path: "/data", changeFrequency: "weekly", priority: 0.7 },
  { path: "/open-source", changeFrequency: "monthly", priority: 0.6 },
  { path: "/about", changeFrequency: "yearly", priority: 0.4 },
  { path: "/contact", changeFrequency: "yearly", priority: 0.4 },
  { path: "/changelog", changeFrequency: "weekly", priority: 0.4 },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.3 },
  { path: "/terms", changeFrequency: "yearly", priority: 0.3 },
  { path: "/signin", changeFrequency: "yearly", priority: 0.3 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const base = site.url.replace(/\/+$/, "");
  const lastModified = new Date();
  const pages: MetadataRoute.Sitemap = STATIC_ROUTES.map((r) => ({
    url: `${base}${r.path}`,
    lastModified,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));
  const docs: MetadataRoute.Sitemap = listDocs().map((doc) => ({
    url: `${base}/docs/${doc.slug}`,
    lastModified,
    changeFrequency: "monthly",
    priority: 0.6,
  }));
  return [...pages, ...docs];
}
