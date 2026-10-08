import type { Metadata } from "next";
import Link from "next/link";
import { SearchX } from "lucide-react";

import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { Button } from "@/components/ui/button";
import { PAGE_NOT_FOUND_HINT, PAGE_NOT_FOUND_TITLE } from "@/lib/content/copy";

export const metadata: Metadata = { title: "Page not found", robots: { index: false, follow: false } };

/**
 * The site-wide 404, served with a real 404 status for any URL that matches
 * no route and for /funder/<id> when the id cannot be a funder (proxy.ts
 * rewrites those here). Static: nothing on it reads the request.
 */
export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="flex-1">
        <div className="mx-auto flex w-full max-w-xl flex-col items-center px-4 py-20 text-center sm:px-6">
          <SearchX className="size-8 text-ink-4" aria-hidden />
          <h1 className="mt-4 text-xl font-semibold text-foreground">{PAGE_NOT_FOUND_TITLE}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{PAGE_NOT_FOUND_HINT}</p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Button asChild>
              <Link href="/search">Search funders</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/">Home</Link>
            </Button>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
