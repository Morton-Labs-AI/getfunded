"use client";

import * as React from "react";
import Link from "next/link";
import { BookOpen, Search, Sparkles, Upload } from "lucide-react";

import { AppShell, type NavItem } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";

/**
 * The signed-in shell: AppShell with the workspace navigation. The nav itself
 * is static (part of the prerendered shell); the user menu, usage meter and
 * workspace switcher stream in through the slots the layout passes.
 */

export const WORKSPACE_NAV: NavItem[] = [
  { label: "Dashboard", href: "/app", icon: "dashboard", exact: true },
  { label: "Search", href: "/app/search", icon: "search" },
  { label: "Ask the analyst", href: "/app/ask", icon: Sparkles },
  { label: "Saved funders", href: "/app/saved", icon: "saved" },
  { label: "Pipeline", href: "/app/pipeline", icon: "pipeline" },
  { label: "Tasks", href: "/app/tasks", icon: "tasks" },
  { label: "Outreach", href: "/app/outreach", icon: "outreach" },
  { label: "Reports", href: "/app/reports", icon: "reports" },
  { label: "Knowledge", href: "/app/knowledge", icon: BookOpen },
  { label: "Import", href: "/app/import", icon: Upload },
];

export const WORKSPACE_BOTTOM_NAV: NavItem[] = [
  { label: "Settings", href: "/app/settings", icon: "settings" },
  { label: "Help", href: "/docs", icon: "help" },
];

function SearchTrigger() {
  return (
    <Button
      variant="outline"
      asChild
      className="h-9 w-full max-w-sm justify-start gap-2 bg-surface px-3 font-normal text-muted-foreground shadow-none"
    >
      <Link href="/app/search">
        <Search className="size-4" aria-hidden />
        <span className="flex-1 truncate text-left">Search funders…</span>
      </Link>
    </Button>
  );
}

export function WorkspaceShell({
  title,
  userMenu,
  usageSlot,
  actions,
  children,
}: {
  title?: React.ReactNode;
  userMenu: React.ReactNode;
  usageSlot: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <AppShell
      nav={WORKSPACE_NAV}
      bottomNav={WORKSPACE_BOTTOM_NAV}
      title={title}
      actions={actions}
      searchTrigger={<SearchTrigger />}
      userMenu={userMenu}
      usageSlot={usageSlot}
    >
      {children}
    </AppShell>
  );
}
