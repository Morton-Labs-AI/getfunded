import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { CtaBand } from "@/components/marketing/cta";
import { LINKS } from "@/components/marketing/links";
import { PageHero, Section } from "@/components/marketing/section";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "About",
  description: `${site.name} is an open-source fundraising database for nonprofits, stewarded by ${site.builtBy.name}.`,
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <>
      <PageHero eyebrow="About" title="A public record, made readable." />
      <Section className="py-10 sm:py-14">
        <div className="max-w-2xl space-y-5 text-[17px] leading-8 text-ink-2">
          <p>
            {site.name} turns public records about foundations and other funders into a database that a nonprofit can search
            in plain language, with the source of every fact one click away. The code is open source under {site.license.code},
            the compiled dataset is {site.license.data}, and the government records underneath are public domain.{" "}
            <a href={site.builtBy.url} target="_blank" rel="noreferrer" className="font-medium text-primary underline underline-offset-4">
              {site.builtBy.name}
            </a>{" "}
            is the steward: it holds the getfunded.ai domain, runs the hosted service, owns the trademark, and breaks ties
            until a Steering Committee exists. Paid plans on the hosted service fund the free tier and the open-source
            project. How decisions are made is written down in the{" "}
            <Link href="/open-source" className="font-medium text-primary underline underline-offset-4">
              governance summary
            </Link>
            ; the people with merge rights are listed in{" "}
            <a href={LINKS.maintainers} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium text-primary underline underline-offset-4">
              MAINTAINERS.md
              <ArrowUpRight className="size-3" aria-hidden />
            </a>
            .
          </p>
        </div>
        <dl className="mt-10 grid max-w-2xl gap-4 text-sm sm:grid-cols-3">
          <div className="rounded-lg border bg-card p-4 shadow-card">
            <dt className="eyebrow text-muted-foreground">Code</dt>
            <dd className="mt-1 font-medium text-foreground">{site.license.code}</dd>
          </div>
          <div className="rounded-lg border bg-card p-4 shadow-card">
            <dt className="eyebrow text-muted-foreground">Data</dt>
            <dd className="mt-1 font-medium text-foreground">{site.license.data}</dd>
          </div>
          <div className="rounded-lg border bg-card p-4 shadow-card">
            <dt className="eyebrow text-muted-foreground">Steward</dt>
            <dd className="mt-1 font-medium text-foreground">{site.builtBy.name}</dd>
          </div>
        </dl>
      </Section>
      <CtaBand
        title="Questions? We answer in public."
        body="Discussions on GitHub for questions and ideas; email for account matters."
        primary={{ label: "Contact", href: "/contact" }}
        secondary={{ label: "Open source", href: "/open-source" }}
      />
    </>
  );
}
