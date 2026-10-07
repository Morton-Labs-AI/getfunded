"use client";

import Link from "next/link";
import { ArrowUpRight, Menu } from "lucide-react";

import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { site } from "@/lib/site";
import { cn } from "@/lib/utils";

const NAV = [
  { label: "Search", href: "/search" },
  { label: "Pricing", href: "/pricing" },
  { label: "Docs", href: "/docs" },
  { label: "GitHub", href: site.github, external: true },
] as const;

function NavLink({
  href,
  external,
  className,
  children,
}: {
  href: string;
  external?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const base = cn(
    "inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium text-ink-2 transition-colors duration-150 hover:bg-accent hover:text-foreground",
    className,
  );
  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={base}>
        {children}
        <ArrowUpRight className="size-3.5 text-ink-4" aria-hidden />
      </a>
    );
  }
  return (
    <Link href={href} className={base}>
      {children}
    </Link>
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b bg-topbar backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Logo />

        <nav className="hidden items-center gap-0.5 md:flex" aria-label="Primary">
          {NAV.map((item) => (
            <NavLink key={item.href} href={item.href} external={"external" in item && item.external}>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <ThemeToggle />
          <Button variant="ghost" asChild>
            <Link href="/signin">Sign in</Link>
          </Button>
          <Button asChild>
            <Link href="/signup">Start free</Link>
          </Button>
        </div>

        <div className="flex items-center gap-1 md:hidden">
          <ThemeToggle />
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Open menu">
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent side="right">
              <SheetHeader>
                <SheetTitle>
                  <Logo href={null} />
                </SheetTitle>
                <SheetDescription className="sr-only">Site navigation</SheetDescription>
              </SheetHeader>
              <nav className="flex flex-col gap-0.5 px-4" aria-label="Mobile">
                {NAV.map((item) => (
                  <NavLink
                    key={item.href}
                    href={item.href}
                    external={"external" in item && item.external}
                    className="justify-between py-2.5 text-base"
                  >
                    {item.label}
                  </NavLink>
                ))}
              </nav>
              <div className="mt-auto flex flex-col gap-2 p-4">
                <Button variant="outline" asChild>
                  <Link href="/signin">Sign in</Link>
                </Button>
                <Button asChild>
                  <Link href="/signup">Start free</Link>
                </Button>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
