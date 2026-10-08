import type { Metadata } from "next";
import { Suspense } from "react";
import { TriangleAlert } from "lucide-react";

import { AdminShell } from "@/components/admin/admin-shell";
import { SiteBanner } from "@/components/admin/site-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { requireSteward } from "@/lib/admin/gate";

export const metadata: Metadata = {
  title: { default: "Steward admin", template: "%s · Steward admin" },
  robots: { index: false, follow: false },
};

/**
 * Everything under /admin: the steward gate (sign-in redirect, 404 for
 * non-stewards), then the admin shell. The session read is pushed into a
 * component behind Suspense, as Cache Components requires.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<AdminFrameSkeleton />}>
      <AdminFrame>{children}</AdminFrame>
    </Suspense>
  );
}

async function AdminFrame({ children }: { children: React.ReactNode }) {
  const session = await requireSteward();
  return (
    <AdminShell user={{ name: session.user.displayName ?? session.user.email, email: session.user.email }}>
      <SiteBanner />
      {!session.flagged ? (
        <div role="alert" className="border-b border-warning/30 bg-warning-tint px-4 py-2 text-sm text-foreground">
          <div className="mx-auto flex w-full max-w-6xl items-start gap-2">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <p>
              Your email is listed in ADMIN_EMAILS, but your account&apos;s steward flag is not set in the database, so
              other workspaces stay hidden on these pages. Apply migration 0009 (<code>npm run db:migrate</code>) and
              reload; the flag is set on your next visit.
            </p>
          </div>
        </div>
      ) : null}
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">{children}</div>
    </AdminShell>
  );
}

function AdminFrameSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-48" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
