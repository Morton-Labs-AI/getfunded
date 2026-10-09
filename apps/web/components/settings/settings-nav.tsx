"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bell, Building2, CreditCard, Database, KeyRound, Plug, Users, type LucideIcon } from "lucide-react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SETTINGS_TABS, type SettingsTabKey } from "@/lib/settings/copy";
import { cn } from "@/lib/utils";

const ICONS: Record<SettingsTabKey, LucideIcon> = {
  organization: Building2,
  members: Users,
  billing: CreditCard,
  api: KeyRound,
  integrations: Plug,
  notifications: Bell,
  data: Database,
};

function activeKey(pathname: string | null): SettingsTabKey {
  if (!pathname) return "organization";
  for (const tab of SETTINGS_TABS) {
    if (pathname === tab.href || pathname.startsWith(`${tab.href}/`)) return tab.key;
  }
  return "organization";
}

function NavList({ pathname }: { pathname: string | null }) {
  const current = activeKey(pathname);
  return (
    <ul className="flex flex-col gap-0.5" aria-label="Settings sections">
      {SETTINGS_TABS.map((tab) => {
        const Icon = ICONS[tab.key];
        const active = tab.key === current;
        return (
          <li key={tab.key}>
            <Link
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm font-medium transition-colors duration-150 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                active ? "bg-primary-tint text-primary" : "text-ink-2 hover:bg-accent hover:text-foreground",
              )}
            >
              <Icon className={cn("size-4 shrink-0", active ? "text-primary" : "text-ink-3")} aria-hidden />
              {tab.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function NavSelect({ pathname }: { pathname: string | null }) {
  const router = useRouter();
  const current = activeKey(pathname);
  return (
    <Select
      value={current}
      onValueChange={(key) => {
        const tab = SETTINGS_TABS.find((t) => t.key === key);
        if (tab) router.push(tab.href);
      }}
    >
      <SelectTrigger className="w-full" aria-label="Settings section">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {SETTINGS_TABS.map((tab) => (
          <SelectItem key={tab.key} value={tab.key}>
            {tab.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ActiveNav({ variant }: { variant: "list" | "select" }) {
  const pathname = usePathname();
  return variant === "list" ? <NavList pathname={pathname} /> : <NavSelect pathname={pathname} />;
}

/**
 * Left tabs on desktop, a select on phones. `usePathname` sits under Suspense
 * so the static shell prerenders; the fallback renders the same links with no
 * active state.
 */
export function SettingsNav() {
  return (
    <nav aria-label="Settings" data-slot="settings-nav">
      <div className="md:hidden">
        <React.Suspense fallback={<NavSelect pathname={null} />}>
          <ActiveNav variant="select" />
        </React.Suspense>
      </div>
      <div className="hidden md:block">
        <React.Suspense fallback={<NavList pathname={null} />}>
          <ActiveNav variant="list" />
        </React.Suspense>
      </div>
    </nav>
  );
}
