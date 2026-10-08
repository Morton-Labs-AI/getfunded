"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Building2, ChartColumn, Gauge, Search, ToggleLeft } from "lucide-react";

import { AppShell, type NavItem, type ShellUser } from "@/components/shell/app-shell";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * The steward's frame: the product AppShell with the admin navigation and a
 * workspace search in the top bar. Client component only because the shell
 * is one (icons are components, so they cannot cross from a Server Component).
 */

const ADMIN_NAV: NavItem[] = [
  { label: "Overview", href: "/admin", icon: Gauge, exact: true },
  { label: "Workspaces", href: "/admin/workspaces", icon: Building2 },
  { label: "Usage and cost", href: "/admin/usage", icon: ChartColumn },
  { label: "Flags", href: "/admin/flags", icon: ToggleLeft },
];

const ADMIN_BOTTOM_NAV: NavItem[] = [{ label: "Back to the app", href: "/app", icon: ArrowLeft }];

function WorkspaceSearch() {
  const router = useRouter();
  const [q, setQ] = React.useState("");
  return (
    <form
      role="search"
      className="relative w-full max-w-sm"
      onSubmit={(e) => {
        e.preventDefault();
        router.push(`/admin/workspaces?q=${encodeURIComponent(q.trim())}`);
      }}
    >
      <Label htmlFor="admin-q" className="sr-only">
        Find a workspace by name, slug or member email
      </Label>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input
        id="admin-q"
        name="q"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Find a workspace…"
        autoComplete="off"
        className="h-9 pl-9"
      />
    </form>
  );
}

export function AdminShell({ user, children }: { user: ShellUser; children: React.ReactNode }) {
  return (
    <AppShell
      nav={ADMIN_NAV}
      bottomNav={ADMIN_BOTTOM_NAV}
      user={user}
      title="Steward admin"
      searchTrigger={<WorkspaceSearch />}
      usageSlot={<span className="eyebrow px-1 text-muted-foreground">Steward</span>}
    >
      {children}
    </AppShell>
  );
}
