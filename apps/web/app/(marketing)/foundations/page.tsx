import { Fragment } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, HandCoins, Search, Trophy, type LucideIcon } from "lucide-react";

import { Missing } from "@/components/data/missing";
import { Posture } from "@/components/data/posture";
import { CodeBlock } from "@/components/marketing/code-block";
import { CtaBand } from "@/components/marketing/cta";
import {
  FOUNDATION_LIST_FILES,
  READING_RULES,
  REBUILD_GUIDE_PATH,
  REBUILD_STEPS,
} from "@/components/marketing/foundations/columns";
import { Downloads } from "@/components/marketing/foundations/downloads";
import { StateGrid } from "@/components/marketing/foundations/state-grid";
import { LINKS, repoFile } from "@/components/marketing/links";
import { PageHero, Section, SectionHeading } from "@/components/marketing/section";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatYearRange, getDataRelease } from "@/lib/data-release";
import { searchHref } from "@/lib/search/params";

const TITLE = "The Open Foundation List";

const SUMMARY =
  "Every U.S. private foundation that files Form 990-PF electronically, with what it gave, what it holds, and whether it says it accepts applications.";

export function generateMetadata(): Metadata {
  const release = getDataRelease();
  const years = formatYearRange(release.indexYears);
  const description = release.published
    ? `${SUMMARY} Free to download${years ? `, covering ${years}` : ""}, and free to reuse with attribution (${release.licence}).`
    : `${SUMMARY} Free to search now. The first public download is being prepared.`;
  return {
    title: TITLE,
    description,
    alternates: { canonical: "/foundations" },
  };
}

/** The three shortcuts into search. Hrefs are built by the search validator's own serializer. */
const QUICK_LINKS: Array<{ title: string; body: string; href: string; icon: LucideIcon }> = [
  {
    title: "Foundations that accept applications",
    body: "Foundations whose latest Form 990-PF says they accept applications.",
    href: searchHref("/search", { type: "private_foundation", posture: "open" }),
    icon: HandCoins,
  },
  {
    title: "Largest by giving",
    body: "Private foundations, with the ones that give the most each year first.",
    href: searchHref("/search", { type: "private_foundation", sort: "distributions" }),
    icon: Trophy,
  },
  {
    title: "Search by name",
    body: "Type a foundation’s name or its EIN.",
    href: "/search",
    icon: Search,
  },
];

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-0.5 font-medium text-primary underline underline-offset-4 hover:text-primary-hover"
    >
      {children}
      <ArrowUpRight className="size-3" aria-hidden />
    </a>
  );
}

/**
 * A column name that may wrap after an underscore on a narrow screen, so the
 * dictionary fits a phone without pushing the meaning off the side. The
 * break adds no character: a copied name is still the exact header.
 */
function ColumnName({ name }: { name: string }) {
  return (
    <>
      {name.split("_").map((part, i) => (
        <Fragment key={i}>
          {i > 0 ? (
            <>
              _<wbr />
            </>
          ) : null}
          {part}
        </Fragment>
      ))}
    </>
  );
}

export default function FoundationsPage() {
  const release = getDataRelease();

  return (
    <>
      <PageHero
        eyebrow="Open data"
        title={TITLE}
        lede={`${SUMMARY} It is free to download, and free to reuse when you credit the source.`}
      >
        <div className="flex flex-wrap gap-3">
          {release.published ? (
            <Button asChild>
              <a href="#downloads">Download the list</a>
            </Button>
          ) : null}
          <Button variant={release.published ? "outline" : "default"} asChild>
            <a href="#browse">Browse by state</a>
          </Button>
          <Button variant="outline" asChild>
            <a href="#columns">See what is in the list</a>
          </Button>
        </div>
      </PageHero>

      <Section id="downloads" className="py-10 sm:py-14">
        <SectionHeading
          eyebrow="Downloads"
          title={release.published ? "Download the list." : "The first release is on its way."}
          lede={
            release.published
              ? "Plain spreadsheet files, published as a release on GitHub. No account is needed."
              : "The files will be published as a release on GitHub. No account will be needed to download them."
          }
        />
        <Downloads release={release} />
      </Section>

      <Section id="columns" tone="surface">
        <SectionHeading
          eyebrow="The columns"
          title="What is in the list."
          lede="Two files. The first has one row per foundation. The second has one row per foundation per fiscal year."
        />
        <div className="mt-8 grid items-start gap-6 lg:grid-cols-2">
          {FOUNDATION_LIST_FILES.map((file) => (
            <div key={file.name} className="rounded-lg border bg-card shadow-card">
              <div className="border-b px-3 py-3 sm:px-4">
                <h3 className="font-mono text-sm font-semibold break-all text-foreground">{file.name}</h3>
                <p className="mt-0.5 text-xs text-ink-3">
                  {file.rowIs}. <span className="tnum">{file.columns.length}</span> columns.
                </p>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="px-3 sm:px-4">Column</TableHead>
                    <TableHead className="px-3 sm:px-4">What it means</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {file.columns.map((column) => (
                    <TableRow key={column.name}>
                      <TableCell className="px-3 align-top font-mono text-[13px] leading-6 whitespace-normal text-foreground sm:px-4 sm:whitespace-nowrap">
                        <ColumnName name={column.name} />
                      </TableCell>
                      <TableCell className="px-3 align-top leading-6 whitespace-normal text-ink-2 sm:min-w-56 sm:px-4">
                        {column.meaning}
                        {column.values ? (
                          <ul className="mt-1.5 space-y-1">
                            {column.values.map((item) => (
                              <li key={item.value} className="flex flex-wrap items-baseline gap-x-2">
                                <code className="rounded-sm border bg-inset px-1 font-mono text-[0.85em] text-foreground">
                                  {item.value}
                                </code>
                                <span>{item.meaning}</span>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ))}
        </div>
      </Section>

      <Section id="honesty" tone="inset">
        <SectionHeading
          eyebrow="Four rules"
          title="How to read it honestly."
          lede="The list says what the returns say, and nothing more. Keep these four rules in mind when you sort, filter or add up."
        />
        <ol className="mt-8 grid gap-3 sm:grid-cols-2">
          {READING_RULES.map((rule, i) => (
            <li key={rule.title} className="rounded-lg border bg-card p-4 shadow-card">
              <p className="tnum font-mono text-xs font-semibold text-primary">{String(i + 1).padStart(2, "0")}</p>
              <h3 className="mt-1 font-semibold text-foreground">{rule.title}</h3>
              <p className="mt-1 text-sm text-pretty text-muted-foreground">{rule.body}</p>
            </li>
          ))}
        </ol>
        <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm text-ink-3">
          <span>
            On the site, <code className="font-mono text-[0.9em]">not_stated</code> reads
          </span>
          <Posture value="unknown" />
          <span>and an empty cell reads</span>
          <span className="rounded-sm border bg-card px-2 py-0.5">
            <Missing />
          </span>
        </p>
      </Section>

      <Section id="browse">
        <SectionHeading
          eyebrow="Search"
          title="Browse without downloading."
          lede="You do not need a spreadsheet. Pick a state, or start from one of these three lists. Search is free and needs no account."
        />
        <ul className="mt-8 grid gap-3 sm:grid-cols-3">
          {QUICK_LINKS.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="group flex h-full flex-col rounded-lg border bg-card p-5 shadow-card transition-[border-color,box-shadow] duration-150 hover:border-primary-border hover:shadow-lift"
              >
                <item.icon className="size-5 text-primary" aria-hidden />
                <h3 className="mt-3 font-semibold text-foreground">{item.title}</h3>
                <p className="mt-1.5 flex-1 text-sm text-pretty text-muted-foreground">{item.body}</p>
                <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary">
                  Open in search
                  <ArrowRight className="size-3.5 transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden />
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <h3 className="mt-10 font-semibold text-foreground">Private foundations by state</h3>
        <div className="mt-3">
          <StateGrid />
        </div>
      </Section>

      <Section id="rebuild" tone="surface">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.3fr]">
          <SectionHeading
            eyebrow="Open source"
            title="Rebuild it yourself."
            lede="The whole pipeline is open source. Anyone can run it on the same IRS files and compare the result with ours."
          />
          <div className="flex flex-col gap-4">
            <p className="text-sm leading-6 text-ink-2">
              You need a working copy of the database first. The{" "}
              <Link href="/docs/self-install" className="font-medium text-primary underline underline-offset-4 hover:text-primary-hover">
                self-install guide
              </Link>{" "}
              shows how. Then run these from the <code className="rounded-sm border bg-inset px-1 font-mono text-[0.85em]">corpus</code>{" "}
              folder.
            </p>
            <ol className="flex flex-col gap-4">
              {REBUILD_STEPS.map((step, i) => (
                <li key={step.code}>
                  <p className="text-sm font-medium text-foreground">
                    <span className="tnum font-mono text-primary">{i + 1}.</span> {step.title}
                  </p>
                  <CodeBlock lang="bash" code={step.code} className="mt-2" />
                </li>
              ))}
              <li>
                <p className="text-sm font-medium text-foreground">
                  <span className="tnum font-mono text-primary">{REBUILD_STEPS.length + 1}.</span> Read the full guide.
                </p>
                <p className="mt-1 text-sm leading-6 text-ink-2">
                  It is in the repository on GitHub:{" "}
                  <ExternalLink href={repoFile(REBUILD_GUIDE_PATH)}>
                    <span className="break-all">{REBUILD_GUIDE_PATH}</span>
                  </ExternalLink>
                </p>
              </li>
            </ol>
          </div>
        </div>
      </Section>

      <Section id="corrections">
        <SectionHeading
          eyebrow="Corrections"
          title="Found a mistake?"
          lede="We publish returns as they were filed, and filers make mistakes. If a row looks wrong, tell us. You do not need to know any code."
        />
        <div className="mt-6 flex flex-col items-start gap-3">
          <Button asChild>
            <a href={LINKS.dataCorrection} target="_blank" rel="noreferrer">
              Report a data correction on GitHub
              <ArrowUpRight aria-hidden />
            </a>
          </Button>
          <p className="max-w-2xl text-sm text-pretty text-ink-3">
            The form asks for the foundation’s name, its EIN, and what you checked. You need a free GitHub account. We trace the
            value back to the filing, then fix our reading of it, load a newer return, or leave it as filed with a note.
          </p>
        </div>
      </Section>

      <CtaBand
        title="Start with one foundation."
        body="Search is free and needs no account. Every fact on a foundation’s page points at the filing it came from."
        primary={{ label: "Search foundations", href: searchHref("/search", { type: "private_foundation" }) }}
        secondary={{ label: "Read the guide", href: "/docs/open-foundation-list" }}
      />
    </>
  );
}
