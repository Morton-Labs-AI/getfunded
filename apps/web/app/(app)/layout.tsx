import type { Metadata } from "next";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { NotificationBell } from "@/components/workspace/notification-bell";
import { UsageMeter } from "@/components/workspace/usage-meter";
import { UserMenu } from "@/components/workspace/user-menu";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { WorkspaceSwitcher } from "@/components/workspace/workspace-switcher";
import { getUsage } from "@/lib/billing/meter";
import { listWorkspaces, requireWorkspace, setActiveWorkspace } from "@/lib/workspace/context";
import { listNotifications, unreadNotificationCount } from "@/lib/workspace/notifications";
import { softFail } from "@/lib/workspace/safe";

export const metadata: Metadata = {
  title: { default: "Dashboard", template: "%s · GetFunded" },
  robots: { index: false, follow: false },
};

/**
 * Everything signed in: the workspace shell (nav, search trigger, theme) is
 * static and prerenders. The three slots that need the session and the
 * `gf_ws` cookie (workspace switcher, account menu, usage meter) each stream
 * in behind their own Suspense boundary, as Cache Components requires.
 *
 * This layout is a convenience, not the security boundary: every page under
 * it calls `requireWorkspace()` itself, and every server action checks again.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceShell
      title={
        <Suspense fallback={<Skeleton className="h-5 w-32" />}>
          <ShellTitle />
        </Suspense>
      }
      userMenu={
        <Suspense fallback={<Skeleton className="size-8 rounded-full" />}>
          <ShellUserMenu />
        </Suspense>
      }
      usageSlot={
        <Suspense fallback={<UsageFallback />}>
          <ShellUsage />
        </Suspense>
      }
      actions={
        <Suspense fallback={<Skeleton className="size-8 rounded-md" />}>
          <ShellNotifications />
        </Suspense>
      }
    >
      {children}
    </WorkspaceShell>
  );
}

/** The workspace name, or a switcher when the person belongs to more than one. */
async function ShellTitle() {
  const { user, workspace } = await requireWorkspace();
  const workspaces = await listWorkspaces(user.id);
  if (workspaces.length <= 1) return <span className="truncate text-foreground">{workspace.name}</span>;
  return (
    <WorkspaceSwitcher
      workspaces={workspaces.map((w) => ({ id: w.id, name: w.name, slug: w.slug, role: w.role }))}
      activeId={workspace.id}
      switchAction={setActiveWorkspace}
    />
  );
}

async function ShellUserMenu() {
  const { user, workspace } = await requireWorkspace();
  return (
    <UserMenu
      user={{ name: user.displayName ?? user.email, email: user.email }}
      workspace={{ name: workspace.name, plan: workspace.plan, role: workspace.role }}
    />
  );
}

/** AI credits this period. A failed read hides the meter; it never takes the shell down. */
async function ShellUsage() {
  const { user, workspace } = await requireWorkspace();
  const usage = await softFail("usage meter", null, () => getUsage(workspace.id, user.id));
  return usage ? <UsageMeter usage={usage} /> : null;
}

/** The bell: my unread count and the eight most recent. A failed read hides it; it never takes the shell down. */
async function ShellNotifications() {
  const { user, workspace } = await requireWorkspace();
  const ctx = { userId: user.id, workspaceId: workspace.id };
  const [count, recent] = await Promise.all([
    softFail("unread notifications", null, () => unreadNotificationCount(ctx)),
    softFail("recent notifications", null, () => listNotifications(ctx, { limit: 8 })),
  ]);
  if (count === null || recent === null) return null;
  return <NotificationBell count={count} recent={recent} />;
}

function UsageFallback() {
  return (
    <div className="rounded-md border border-sidebar-border bg-surface/70 p-2.5 [[data-collapsed]_aside_&]:hidden" aria-hidden>
      <Skeleton className="h-3 w-28" />
      <Skeleton className="mt-2 h-1.5 w-full" />
      <Skeleton className="mt-2 h-3 w-20" />
    </div>
  );
}
