import Link from "next/link";
import { Info, TriangleAlert } from "lucide-react";

import type { Banner, BannerTone } from "@/lib/admin/flags";
import { cn } from "@/lib/utils";

/**
 * What the bar needs: text, a tone, and maybe a link. A stored `Banner` fits;
 * so does a form preview that has no link yet (href "", null or absent).
 */
export type BannerBarInput = Pick<Banner, "text"> & { tone?: BannerTone; href?: string | null };

/**
 * The presentational half of the steward's site-wide notice: pure, testable,
 * and safe to import from client components (the admin flags form previews
 * it live). The server half that reads flags.banner is `<SiteBanner />` in
 * ./site-banner.tsx; keep this file free of server-only imports.
 */
export function BannerBar({ banner, className }: { banner: BannerBarInput; className?: string }) {
  const tone: BannerTone = banner.tone ?? "info";
  const warning = tone === "warning";
  const Icon = warning ? TriangleAlert : Info;
  const href = banner.href?.trim() || null;
  const external = href ? /^https?:\/\//i.test(href) : false;
  return (
    <div
      role="status"
      data-slot="site-banner"
      data-tone={tone}
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
          {href ? (
            <>
              {" "}
              {external ? (
                <a href={href} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-4">
                  Learn more
                </a>
              ) : (
                <Link href={href} className="font-medium underline underline-offset-4">
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
