import { FileCheck, Search, Sparkles, Sprout } from "lucide-react";

import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { site } from "@/lib/site";

/**
 * TEMPORARY placeholder landing. The real marketing page replaces this;
 * it exists so the shell, tokens and header/footer have a home that compiles.
 */
export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        <section className="mx-auto flex w-full max-w-3xl flex-col items-center px-4 pt-20 pb-24 text-center sm:px-6 sm:pt-28">
          <p className="eyebrow text-primary">Open fundraising database</p>
          <h1 className="mt-4 font-display text-4xl font-medium tracking-tight text-balance text-foreground sm:text-5xl md:text-6xl">
            {site.tagline}
          </h1>
          <p className="mt-5 max-w-xl text-lg text-balance text-muted-foreground">
            Search every U.S. foundation by what it has actually funded, straight from public IRS filings. Verified
            facts stay verified; anything our AI adds is labelled.
          </p>

          <form action="/search" method="get" role="search" className="mt-8 flex w-full max-w-xl flex-col gap-2 sm:flex-row">
            <Label htmlFor="q" className="sr-only">
              Search funders
            </Label>
            <div className="relative flex-1">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                id="q"
                name="q"
                type="search"
                autoComplete="off"
                placeholder="Try “youth mental health in Oregon”"
                className="h-11 pl-9 text-base"
              />
            </div>
            <Button type="submit" size="lg" className="h-11">
              Search funders
            </Button>
          </form>

          <ul className="mt-8 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
            <li className="inline-flex items-center gap-1.5">
              <FileCheck className="size-4 text-source" aria-hidden />
              Verified from IRS filings
            </li>
            <li className="inline-flex items-center gap-1.5">
              <Sparkles className="size-4 text-ai" aria-hidden />
              AI suggestions always labelled
            </li>
            <li className="inline-flex items-center gap-1.5">
              <Sprout className="size-4 text-primary" aria-hidden />
              Open source, open data
            </li>
          </ul>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
