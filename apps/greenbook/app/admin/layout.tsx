import { assertAdminPage } from "@/lib/admin/guard";

/**
 * The single chokepoint for every page under /admin.
 *
 * Before this existed, only the six /api/admin route handlers were guarded.
 * The pages were protected by nothing but not being linked from the nav —
 * and app/admin/enrich/[id]/page.tsx reads through the unguarded read-only
 * pool, so it rendered non-republishable internal.org_web_facts content to
 * anyone who knew the URL shape.
 *
 * Applying the guard by nesting rather than per page means a future admin
 * page is covered the moment it is created.
 */

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await assertAdminPage();
  return <>{children}</>;
}
