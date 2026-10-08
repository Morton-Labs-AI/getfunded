import * as React from "react";
import { connection } from "next/server";

import { getSiteBanner } from "@/lib/admin/flags-server";

import { BannerBar } from "./banner-bar";

/**
 * The steward's site-wide notice (flags.banner), for the marketing header and
 * the app shell. Drop `<SiteBanner />` anywhere in a Server Component tree:
 * it carries its own Suspense boundary, streams in at request time, and
 * renders nothing when no banner is set or the database is unreachable.
 *
 * Server-only: it reads the database through lib/admin/flags-server. The
 * presentational half lives in ./banner-bar.tsx so client components (the
 * admin flags form) can preview a banner without pulling postgres into the
 * browser bundle. Import `BannerBar` from there, never from this file.
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
