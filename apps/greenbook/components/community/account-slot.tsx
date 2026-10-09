import Link from "next/link";

import { AccountMenu } from "./account-menu";
import { getViewer, toChip, viewerEmail } from "@/lib/auth/viewer";
import { communityLive } from "@/lib/community/posture";

/**
 * The nav's identity slot. Renders NOTHING when the community layer is off, so
 * the header is byte-identical to today until the mode is deliberately flipped.
 *
 * COST, stated because it is real and easy to miss: this reads cookies, which
 * makes every route that renders <Nav> dynamic. /data and /programs prerender
 * at build today. That is an accepted trade — the expensive queries are already
 * memoized in lib/queries/stats.ts via unstable_cache, and getViewer() adds one
 * JWT verification plus one indexed lookup, memoized per request by
 * React.cache(). Do NOT "fix" it by fetching the viewer client-side from an
 * /api/me route: that reintroduces an auth flash on the one component that is
 * above the fold on every page.
 */
export async function AccountSlot() {
  if (!communityLive) return null;

  const viewer = await getViewer();

  if (!viewer) {
    return (
      <Link
        href="/sign-in"
        className="text-[13.5px] font-medium text-ink-3 transition-colors duration-[90ms] hover:text-ink-1"
      >
        Sign in
      </Link>
    );
  }

  // The address is used ONLY to derive a monogram for a member who has not yet
  // chosen a display name; the chip carries the initials, never the address.
  const email = viewer.displayName || viewer.handle ? null : await viewerEmail();

  return <AccountMenu chip={toChip(viewer, email)} />;
}
