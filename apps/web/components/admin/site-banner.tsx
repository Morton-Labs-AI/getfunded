import * as React from "react";
import Link from "next/link";
import { connection } from "next/server";
import { Info, TriangleAlert } from "lucide-react";

import { getSiteBanner } from "@/lib/admin/flags-server";
import type { Banner } from "@/lib/admin/flags";
import { cn } from "@/lib/utils";

/**
 * The steward's site-wide notice (flags.banner), for the marketing header and
 * the app shell. Drop `<SiteBanner />` anywhere in a Server Component tree:
 * it carries its own Suspense boundary, streams in at request time, and
 * renders nothing when no banner is set or the database is unreachable.
 *
 * `<BannerBar />` is the presentational half (pure, testable).
 */
export function SiteBanner({ className }: { className?: string }) {
  return (
    <React.Suspense fallback={null}>
      <SiteBannerInner className={className} />
    </React.Suspense>
  );
}

async function SiteBannerInner({ className }: { className?: string }) {
  await connection();
  const banner = await getSiteBanner();
  if (!banner) return null;
  return <BannerBar banner={banner} className={className} />;
}

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
