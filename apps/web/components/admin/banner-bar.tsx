import Link from "next/link";
import { Info, TriangleAlert } from "lucide-react";

import type { Banner } from "@/lib/admin/flags";
import { cn } from "@/lib/utils";

/**
 * The presentational half of the steward's site-wide notice: pure, testable,
 * and safe to import from client components (the admin flags form previews
 * it live). The server half that reads flags.banner is `<SiteBanner />` in
 * ./site-banner.tsx; keep this file free of server-only imports.
 */
export function BannerBar({ banner, className }: { banner: Banner; className?: string }) {
  const warning = banner.tone === "warning";
  const Icon = warning ? TriangleAlert : Info;
  const external = banner.href ? /^https?:\/\//i.test(banner.href) : false;
  return (
    <div
      role="status"
      data-slot="site-banner"
      data-tone={banner.tone}
      className={cn(
        "border-b px-4 py-2 text-sm",
        warning ? "border-warning/30 bg-warning-tint text-foreground" : "border-primary-border bg-primary-tint text-foreground",
        className,
      )}
    >
      <div className="mx-auto flex w-full max-w-6xl items-start gap-2 sm:items-center">
        <Icon className={cn("mt-0.5 size-4 shrink-0 sm:mt-0", warning ? "text-warning" : "text-primary")} aria-hidden />
        <p className="min-w-0 flex-1 text-balance">
          <span className="sr-only">{warning ? "Warning: " : "Notice: "}</span>
          {banner.text}
          {banner.href ? (
            <>
              {" "}
              {external ? (
                <a href={banner.href} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-4">
                  Learn more
                </a>
              ) : (
                <Link href={banner.href} className="font-medium underline underline-offset-4">
                  Learn more
                </Link>
              )}
            </>
          ) : null}
        </p>
      </div>
    </div>
  );
}
