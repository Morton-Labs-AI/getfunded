"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bookmark,
  ChartColumn,
  Kanban,
  LayoutDashboard,
  LifeBuoy,
  Mail,
  Menu,
  PanelLeft,
  PanelLeftClose,
  Search,
  Settings,
  SquareCheck,
  type LucideIcon,
} from "lucide-react";

import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { SkipLink } from "@/components/ui/skip-link";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

import { usePersistedBoolean } from "./use-persisted-boolean";

/* ----------------------------------------------------------------------------
   Nav model
---------------------------------------------------------------------------- */

export const NAV_ICONS = {
  dashboard: LayoutDashboard,
  search: Search,
  saved: Bookmark,
  pipeline: Kanban,
  tasks: SquareCheck,
  outreach: Mail,
  reports: ChartColumn,
  settings: Settings,
  help: LifeBuoy,
} as const;

export type NavIconName = keyof typeof NAV_ICONS;

export type NavItem = {
  label: string;
  href: string;
  /** A named icon (serialisable from server components) or a lucide component. */
  icon: NavIconName | LucideIcon;
  /** Count or short text shown at the right of the item. */
  badge?: string | number;
  /** Match the pathname exactly instead of by prefix. */
  exact?: boolean;
};

export const DEFAULT_NAV: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: "dashboard", exact: true },
  { label: "Search", href: "/search", icon: "search" },
  { label: "Saved funders", href: "/saved", icon: "saved" },
  { label: "Pipeline", href: "/pipeline", icon: "pipeline" },
  { label: "Tasks", href: "/tasks", icon: "tasks" },
  { label: "Outreach", href: "/outreach", icon: "outreach" },
  { label: "Reports", href: "/reports", icon: "reports" },
];

export const DEFAULT_BOTTOM_NAV: NavItem[] = [
  { label: "Settings", href: "/settings", icon: "settings" },
  { label: "Help", href: "/help", icon: "help" },
];

export type ShellUser = {
  name: string;
  email?: string | null;
  avatarUrl?: string | null;
};

export type ShellUsage = {
  used: number;
  /** null means unlimited. */
  limit: number | null;
  plan: string;
  /** What is being metered. Defaults to "AI lookups this month". */
  label?: string;
};

export type AppShellProps = {
  nav?: NavItem[];
  bottomNav?: NavItem[];
  user?: ShellUser | null;
  usage?: ShellUsage | null;
  /** Top-bar page title or breadcrumb. */
  title?: React.ReactNode;
  /** Top-bar right-side actions, before the theme toggle. */
  actions?: React.ReactNode;
  /** ⌘K trigger. Defaults to a link-style button to /search. */
  searchTrigger?: React.ReactNode;
  /** Replaces the default avatar dropdown. */
  userMenu?: React.ReactNode;
  /** Replaces the default usage meter. */
  usageSlot?: React.ReactNode;
  /** Render inside a fixed-height frame (styleguide) instead of the viewport. */
  embedded?: boolean;
  className?: string;
  children: React.ReactNode;
};

function resolveIcon(icon: NavItem["icon"]): LucideIcon {
  return typeof icon === "string" ? NAV_ICONS[icon] : icon;
}

function isActive(item: NavItem, pathname: string | null) {
  if (!pathname) return false;
  if (item.exact || item.href === "/") return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/* ----------------------------------------------------------------------------
   Nav links (pathname-aware leaf, kept small so the shell can prerender)
---------------------------------------------------------------------------- */

function NavLinks({
  items,
  pathname,
  collapsed,
  onNavigate,
}: {
  items: NavItem[];
  pathname: string | null;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  return (
    <ul className="flex flex-col gap-0.5">
      {items.map((item) => {
        const Icon = resolveIcon(item.icon);
        const active = isActive(item, pathname);
        const link = (
          <Link
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex items-center gap-3 rounded-md text-sm font-medium transition-colors duration-150 outline-none focus-visible:ring-[3px] focus-visible:ring-sidebar-ring/50",
              collapsed ? "size-9 justify-center" : "h-9 px-2.5",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "absolute left-0 h-5 w-0.5 rounded-r-full bg-sidebar-primary transition-opacity duration-150",
                active ? "opacity-100" : "opacity-0",
              )}
            />
            <Icon className={cn("size-4 shrink-0", active ? "text-sidebar-primary" : "text-ink-3 group-hover:text-sidebar-accent-foreground")} aria-hidden />
            {!collapsed ? <span className="truncate">{item.label}</span> : <span className="sr-only">{item.label}</span>}
            {!collapsed && item.badge !== undefined ? (
              <span className="tnum ml-auto rounded-full bg-inset px-1.5 text-[11px] font-medium text-ink-3">{item.badge}</span>
            ) : null}
          </Link>
        );
        return (
          <li key={item.href} className="relative">
            {collapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>{link}</TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  {item.label}
                  {item.badge !== undefined ? ` · ${item.badge}` : ""}
                </TooltipContent>
              </Tooltip>
            ) : (
              link
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ActiveNavLinks(props: Omit<React.ComponentProps<typeof NavLinks>, "pathname">) {
  const pathname = usePathname();
  return <NavLinks {...props} pathname={pathname} />;
}

function Nav(props: Omit<React.ComponentProps<typeof NavLinks>, "pathname">) {
  return (
    <React.Suspense fallback={<NavLinks {...props} pathname={null} />}>
      <ActiveNavLinks {...props} />
    </React.Suspense>
  );
}

/* ----------------------------------------------------------------------------
   Usage meter
---------------------------------------------------------------------------- */

function UsageMeter({ usage, collapsed }: { usage: ShellUsage; collapsed: boolean }) {
  const label = usage.label ?? "AI lookups this month";
  const pct = usage.limit ? Math.min(100, Math.round((usage.used / usage.limit) * 100)) : 0;
  const text =
    usage.limit === null
      ? `${formatNumber(usage.used)} used · unlimited`
      : `${formatNumber(usage.used)} of ${formatNumber(usage.limit)}`;
  const nearLimit = usage.limit !== null && pct >= 90;

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            href="/settings"
            aria-label={`${label}: ${text}. Plan ${usage.plan}`}
            className="flex size-9 items-center justify-center rounded-md outline-none hover:bg-sidebar-accent/60 focus-visible:ring-[3px] focus-visible:ring-sidebar-ring/50"
          >
            <span className="relative block h-5 w-1.5 overflow-hidden rounded-full bg-primary/15" aria-hidden>
              <span
                className={cn("absolute inset-x-0 bottom-0 rounded-full", nearLimit ? "bg-warning" : "bg-primary")}
                style={{ height: `${usage.limit === null ? 100 : pct}%` }}
              />
            </span>
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          {label}: {text} · {usage.plan}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <div className="rounded-md border border-sidebar-border bg-surface/70 p-2.5 text-xs dark:bg-surface/40">
      <div className="flex items-center justify-between gap-2">
        <span className="eyebrow text-muted-foreground">{label}</span>
        <Badge variant="secondary" className="px-1.5 text-[10px]">
          {usage.plan}
        </Badge>
      </div>
      {usage.limit !== null ? (
        <Progress
          value={pct}
          aria-label={`${pct}% of ${label.toLowerCase()} used`}
          className="mt-2 h-1.5"
          indicatorClassName={nearLimit ? "bg-warning" : undefined}
        />
      ) : null}
      <div className="tnum mt-1.5 flex items-center justify-between text-ink-2">
        <span>{text}</span>
        {usage.limit !== null ? <span className="text-ink-3">{pct}%</span> : null}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   Default slots
---------------------------------------------------------------------------- */

function DefaultSearchTrigger() {
  return (
    <Button
      variant="outline"
      asChild
      className="h-9 w-full max-w-sm justify-start gap-2 bg-surface px-3 font-normal text-muted-foreground shadow-none"
    >
      <Link href="/search">
        <Search className="size-4" aria-hidden />
        <span className="flex-1 truncate text-left">Search funders…</span>
        <kbd className="hidden sm:inline-flex">⌘K</kbd>
      </Link>
    </Button>
  );
}

function DefaultUserMenu({ user }: { user: ShellUser }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          aria-label={`Account menu for ${user.name}`}
        >
          <Avatar>
            {user.avatarUrl ? <AvatarImage src={user.avatarUrl} alt="" /> : null}
            <AvatarFallback>{initials(user.name) || "?"}</AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="truncate">{user.name}</span>
          {user.email ? <span className="truncate text-xs font-normal text-muted-foreground">{user.email}</span> : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/help">
            <LifeBuoy />
            Help
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ----------------------------------------------------------------------------
   Shell
---------------------------------------------------------------------------- */

export function AppShell({
  nav = DEFAULT_NAV,
  bottomNav = DEFAULT_BOTTOM_NAV,
  user,
  usage,
  title,
  actions,
  searchTrigger,
  userMenu,
  usageSlot,
  embedded = false,
  className,
  children,
}: AppShellProps) {
  const [collapsed, setCollapsed] = usePersistedBoolean("getfunded:sidebar-collapsed", false);
  const [mobileOpen, setMobileOpen] = React.useState(false);

  const usageBlock = usageSlot ?? (usage ? <UsageMeter usage={usage} collapsed={collapsed} /> : null);

  return (
    <div
      data-slot="app-shell"
      data-collapsed={collapsed ? "" : undefined}
      className={cn("flex w-full bg-background text-foreground", embedded ? "h-full min-h-0" : "min-h-dvh", className)}
    >
      <SkipLink />
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "sticky top-0 hidden shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-[var(--motion-ease-standard)] md:flex",
          embedded ? "h-full" : "h-dvh",
          collapsed ? "w-14" : "w-60",
        )}
        aria-label="Sidebar"
      >
        <div className={cn("flex h-14 items-center border-b border-sidebar-border", collapsed ? "justify-center px-2" : "justify-between pr-2 pl-4")}>
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={() => setCollapsed(false)} aria-label="Expand sidebar">
                  <PanelLeft />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                Expand sidebar
              </TooltipContent>
            </Tooltip>
          ) : (
            <>
              <Logo size="sm" />
              <Button variant="ghost" size="icon-sm" onClick={() => setCollapsed(true)} aria-label="Collapse sidebar">
                <PanelLeftClose />
              </Button>
            </>
          )}
        </div>

        <nav className={cn("flex-1 overflow-y-auto py-3", collapsed ? "px-2.5" : "px-3")} aria-label="Workspace">
          <Nav items={nav} collapsed={collapsed} />
        </nav>

        <div className={cn("flex flex-col gap-2 border-t border-sidebar-border py-3", collapsed ? "items-center px-2.5" : "px-3")}>
          {usageBlock}
          <Nav items={bottomNav} collapsed={collapsed} />
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-topbar px-3 backdrop-blur sm:px-4">
          {/* Mobile nav */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open navigation">
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 bg-sidebar text-sidebar-foreground">
              <SheetHeader className="h-14 flex-row items-center border-b border-sidebar-border">
                <SheetTitle>
                  <Logo size="sm" href={null} />
                </SheetTitle>
                <SheetDescription className="sr-only">Workspace navigation</SheetDescription>
              </SheetHeader>
              <nav className="flex-1 overflow-y-auto px-3" aria-label="Workspace">
                <Nav items={nav} collapsed={false} onNavigate={() => setMobileOpen(false)} />
              </nav>
              <div className="flex flex-col gap-2 border-t border-sidebar-border p-3">
                {usageSlot ?? (usage ? <UsageMeter usage={usage} collapsed={false} /> : null)}
                <Nav items={bottomNav} collapsed={false} onNavigate={() => setMobileOpen(false)} />
              </div>
            </SheetContent>
          </Sheet>

          <div className="md:hidden">
            <Logo size="sm" variant="mark" />
          </div>

          {title ? <div className="hidden min-w-0 truncate text-sm font-medium sm:block">{title}</div> : null}

          <div className="flex min-w-0 flex-1 justify-center px-2">{searchTrigger ?? <DefaultSearchTrigger />}</div>

          <div className="flex items-center gap-1">
            {actions}
            <ThemeToggle />
            {userMenu ?? (user ? <DefaultUserMenu user={user} /> : null)}
          </div>
        </header>

        <main id="main" tabIndex={-1} className="flex-1 outline-none">
          {children}
        </main>
      </div>
    </div>
  );
}
