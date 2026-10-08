import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, FileSpreadsheet } from "lucide-react";

import { ProvenanceSeal } from "@/components/data/provenance-seal";
import { CodeBlock } from "@/components/marketing/code-block";
import { CtaBand } from "@/components/marketing/cta";
import { LINKS } from "@/components/marketing/links";
import { CoverageTable } from "@/components/marketing/live-stats";
import { Note, PageHero, Section, SectionHeading } from "@/components/marketing/section";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Data",
  description:
    "Where every fact comes from: the sources, live coverage numbers, known limits, the provenance contract and the rules for contact data.",
  alternates: { canonical: "/data" },
};

const SOURCES: Array<{ source: string; publisher: string; take: string; terms: string }> = [
  {
    source: "Form 990 / 990-PF e-file index and XML",
    publisher: "Internal Revenue Service",
    take: "Filings spine; 990-PF officers, grants paid, financial lines, Schedule B, Part XV application info; Form 990 Schedule I grants, core financials, Part IX split, Part VII compensation; filer-stated websites",
    terms: "US government work, public domain",
  },
  {
    source: "Exempt Organizations Business Master File",
    publisher: "Internal Revenue Service",
    take: "Identity: name, EIN, address, subsection, foundation code, NTEE code, ruling date, asset, income and revenue amounts",
    terms: "Public domain",
  },
  {
    source: "Form ADV (IAPD)",
    publisher: "US Securities and Exchange Commission",
    take: "Adviser identity, CRD and SEC file numbers, offices, assets under management, private-fund schedules",
    terms: "Public domain",
  },
  {
    source: "Form D",
    publisher: "US Securities and Exchange Commission",
    take: "Exempt-offering notices: issuer, offering amounts, related persons as filed",
    terms: "Public domain",
  },
  {
    source: "SBIR / STTR awards",
    publisher: "US Small Business Administration",
    take: "Award records: agency, program, phase, amount, awardee",
    terms: "Public domain",
  },
  {
    source: "ZCTA crosswalk",
    publisher: "US Census Bureau",
    take: "ZIP-to-ZCTA geography crosswalk used to normalize places",
    terms: "Public domain",
  },
  {
    source: "Federal agencies and programs",
    publisher: "This project",
    take: "10 agencies and 16 non-dilutive federal programs, curated by pull request",
    terms: "CC BY 4.0",
  },
  {
    source: "Entity-resolution labels",
    publisher: "This project",
    take: "Human match / not-match decisions that gate record linking",
    terms: "CC BY 4.0",
  },
];

const KNOWN_LIMITS: string[] = [
  "The same fund can appear more than once. Records of one fund from different SEC sources are kept as separate organizations, and people are kept per source; we have not merged them.",
  "Not ingested: 990-EZ, 990-N, 990-T, paper returns, Publication 78, auto-revocations and determination letters.",
  "The gives-per-year filter and the most-giving sort read the Form 990-PF giving lines (qualifying distributions, else charitable disbursements), so in name and browse searches they cover private foundations only; describe-the-work search also counts a public charity's reported grants, averaged per year. Profile grant lists include Schedule I grants from public charities as well as 990-PF grants.",
  "The IRS publishes XML in batches. At any time tens of thousands of indexed returns have no detail yet. They appear when the IRS publishes them.",
  "Back-year 990-PF grant rows are loaded for the newest index years only; earlier years carry filings, financials and officers.",
  "Form D names the issuer raising money, never the investors. It is not a deal graph.",
  "Inside parsed 990-PFs, the donor list (Schedule B) is present on about a quarter of filings, and the how-to-apply section (Part XV) says something usable on about a quarter.",
  "Keyword search matches names and titles only. Describe-the-work search reads giving records, so it covers private foundations, companies, federal programs and the public charities that report the grants they make; a charity with no grant list is found by name or EIN only.",
  "Filers make mistakes. We publish filings as filed. Out-of-range numbers are set to missing, not corrected.",
];

const EXAMPLE_SHA = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

export default function DataPage() {
  return (
    <>
      <PageHero
        eyebrow="The data"
        title="Every fact points at a file you can download and hash yourself."
        lede="GetFunded is built only from public government records. This page lists the sources, shows what the database holds right now, says what is missing, and explains the rules for contact data."
      >
        <Link
          href="/foundations"
          className="group flex max-w-2xl items-start gap-4 rounded-lg border border-primary-border bg-primary-tint/50 p-5 shadow-card transition-[border-color,box-shadow] duration-150 hover:border-primary hover:shadow-lift"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-card text-primary">
            <FileSpreadsheet className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="eyebrow text-primary">Open data</p>
            <h2 className="mt-1 font-display text-xl font-medium tracking-tight text-foreground">The Open Foundation List</h2>
            <p className="mt-1.5 text-sm text-pretty text-ink-2">
              Every U.S. private foundation that files Form 990-PF electronically, in one public list: what it gave, what it
              holds, and whether it says it accepts applications. Free to reuse with attribution.
            </p>
            <p className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary">
              Open the list
              <ArrowRight className="size-3.5 transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden />
            </p>
          </div>
        </Link>
      </PageHero>

      <Section id="coverage" className="py-10 sm:py-14">
        <SectionHeading eyebrow="Coverage" title="What the database holds." lede="Live from the database, cached for a few hours." />
        <div className="mt-8">
          <CoverageTable />
        </div>
      </Section>

      <Section id="sources" tone="surface">
        <SectionHeading
          eyebrow="Sources"
          title="Eight sources. All public."
          lede={
            <>
              URLs, refresh cadence and the limits of each source are in{" "}
              <a href={LINKS.corpusDataSources} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                corpus/docs/DATA-SOURCES.md
              </a>
              .
            </>
          }
        />
        <div className="mt-8 rounded-lg border bg-card shadow-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead>Publisher</TableHead>
                <TableHead>What we take</TableHead>
                <TableHead>Terms</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {SOURCES.map((row) => (
                <TableRow key={row.source} className="align-top">
                  <TableCell className="min-w-44 whitespace-normal font-medium text-foreground">{row.source}</TableCell>
                  <TableCell className="min-w-40 whitespace-normal">{row.publisher}</TableCell>
                  <TableCell className="min-w-72 whitespace-normal text-ink-2">{row.take}</TableCell>
                  <TableCell className="min-w-36 whitespace-normal">{row.terms}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Section>

      <Section id="limits" tone="inset">
        <SectionHeading
          eyebrow="Known limits"
          title="What is not here, said plainly."
          lede="A database that hides its gaps is not trustworthy. These are the ones we know about."
        />
        <ul className="mt-8 grid gap-3 sm:grid-cols-2">
          {KNOWN_LIMITS.map((item) => (
            <li key={item} className="rounded-lg border bg-card p-4 text-sm leading-6 text-pretty text-ink-2 shadow-card">
              {item}
            </li>
          ))}
        </ul>
      </Section>

      <Section id="provenance">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.3fr]">
          <SectionHeading
            eyebrow="The provenance contract"
            title="One chain, kept for every row."
            lede="Every fact on a funder page points back to the exact government file it came from, and to the exact record inside that file. If we read a file again later, the old facts cannot pretend to be new."
          />
          <div className="flex flex-col gap-4">
            <div>
              <p className="eyebrow text-muted-foreground">How it looks on a funder page (example values)</p>
              <div className="mt-2">
                <ProvenanceSeal source="IRS 990-PF e-file" filingYear={2023} sha256={EXAMPLE_SHA} license="Public domain" />
              </div>
              <p className="mt-2 text-sm leading-6 text-ink-2">
                The dataset, the filing year, the fingerprint of the file we read (the first characters of its sha256 hash) and a
                link to the filing. When a fact has no file behind it, such as the identity line from the IRS master file, the
                fingerprint is left out rather than shown blank.
              </p>
            </div>
            <ul className="space-y-2 text-sm leading-6 text-ink-2">
              <li>
                <strong className="font-semibold text-foreground">Every file is kept and fingerprinted.</strong> We store the file as
                we downloaded it, its sha256 hash, when we fetched it, the publisher&rsquo;s last-modified date, and when we last
                read it.
              </li>
              <li>
                <strong className="font-semibold text-foreground">Every fact knows its place in the file.</strong> A CSV row or an
                element inside the 990 XML, so anyone can open the same file and find the same value.
              </li>
              <li>
                <strong className="font-semibold text-foreground">Amended filings replace the original.</strong> Within one EIN, return
                type and tax period, the newest filing is the one that counts. Older ones keep their detail rows but lose their
                grant rows, so nothing is counted twice.
              </li>
              <li>
                <strong className="font-semibold text-foreground">Exports are reproducible.</strong> A published export is byte-identical
                on re-run and its manifest lists the hash of every file.
              </li>
            </ul>
            <details className="group rounded-lg border bg-card p-4 shadow-card">
              <summary className="cursor-pointer text-sm font-medium text-foreground">How it works in detail</summary>
              <div className="mt-3 flex flex-col gap-3">
                <CodeBlock
                  title="The chain"
                  copy={false}
                  code={[
                    "dataset name → source URL → sha256-hashed immutable file → licence code",
                    "            → ingestion-ledger run → row (raw_file_id + source_record_locator)",
                  ].join("\n")}
                />
                <p className="text-sm leading-6 text-ink-2">
                  Record locators look like{" "}
                  <code className="rounded-sm border bg-inset px-1 font-mono text-[0.85em]">row:EIN=…</code> for a CSV row or an
                  element path inside the 990 XML for a filing value. Full description:{" "}
                  <a
                    href={LINKS.corpusProvenance}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-0.5 font-medium text-primary underline underline-offset-4"
                  >
                    PROVENANCE.md
                    <ArrowUpRight className="size-3" aria-hidden />
                  </a>
                </p>
              </div>
            </details>
          </div>
        </div>
      </Section>

      <Section id="contacts" tone="surface">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.3fr]">
          <SectionHeading
            eyebrow="Contact data"
            title="Published by affirmative act, never by default."
            lede="A funder page shows a contact only when the record allows it. Otherwise the database sends no value at all, so a bug in the app cannot leak it."
          />
          <div className="rounded-lg border bg-card shadow-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rule</TableHead>
                  <TableHead>What it means</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow className="align-top">
                  <TableCell className="whitespace-normal font-medium text-foreground">
                    Published on purpose
                    <span className="mt-0.5 block font-mono text-[0.8em] font-normal text-ink-3">publishability = public</span>
                  </TableCell>
                  <TableCell className="whitespace-normal text-ink-2">
                    Every contact record starts as internal only. Publishing it is a deliberate flag, set by the loader under one
                    rule written once in the database, so every reviewer applies the same rule.
                  </TableCell>
                </TableRow>
                <TableRow className="align-top">
                  <TableCell className="whitespace-normal font-medium text-foreground">Role inboxes only</TableCell>
                  <TableCell className="whitespace-normal text-ink-2">
                    grants@ and info@ are desks and can publish. A named person&rsquo;s address is withheld by policy, even when it
                    appears on a public filing.
                  </TableCell>
                </TableRow>
                <TableRow className="align-top">
                  <TableCell className="whitespace-normal font-medium text-foreground">Three privacy tiers</TableCell>
                  <TableCell className="whitespace-normal text-ink-2">
                    Green is a shared desk such as grants@ or an office phone. Yellow is a professional contact for a named person,
                    taken from a filing; it stays internal. Red is never shown. The database refuses to mark a red contact public.
                  </TableCell>
                </TableRow>
                <TableRow className="align-top">
                  <TableCell className="whitespace-normal font-medium text-foreground">No vendors, no scraping</TableCell>
                  <TableCell className="whitespace-normal text-ink-2">
                    Vendor contact data is never used. Facts from funder websites are never republished. A trigger refuses to mark
                    either as public.
                  </TableCell>
                </TableRow>
                <TableRow className="align-top">
                  <TableCell className="whitespace-normal font-medium text-foreground">Checked before every export</TableCell>
                  <TableCell className="whitespace-normal text-ink-2">
                    Seven safety checks run before a single byte is written. If one fails, the export stops.
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </div>
      </Section>

      <Section id="license">
        <SectionHeading eyebrow="License and corrections" title="Use it. Credit it. Tell us when it is wrong." />
        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <div className="rounded-lg border bg-card p-5 shadow-card">
            <h3 className="font-semibold text-foreground">{site.license.data} for the compilation</h3>
            <p className="mt-2 text-sm leading-6 text-ink-2">
              Our selection, cleaning, linking and arrangement is {site.license.data}. The government records underneath are public
              domain and need no credit. When you reuse the dataset, say:
            </p>
            <blockquote className="mt-3 border-l-2 border-primary-border bg-primary-tint/50 px-3 py-2 text-sm text-ink-2">
              Data from GetFunded, Open Funder Database ({site.url}), licensed CC BY 4.0. Derived from IRS, SEC, SBA, and US
              Census public records.
            </blockquote>
          </div>
          <div className="rounded-lg border bg-card p-5 shadow-card">
            <h3 className="font-semibold text-foreground">We publish filings as filed</h3>
            <p className="mt-2 text-sm leading-6 text-ink-2">
              Filings can be late, amended or wrong. We filter superseded filings; we do not correct the record. If a profile looks
              wrong, open a{" "}
              <a href={LINKS.dataCorrection} target="_blank" rel="noreferrer" className="font-medium text-primary underline underline-offset-4">
                data correction issue
              </a>
              . We trace the fact to its file and either fix our parser, load a newer filing, or leave it as filed with a note.
            </p>
            <Note className="mt-3">The dataset is provided as is, without warranty of any kind.</Note>
          </div>
        </div>
        <p className="mt-6 text-sm text-ink-3">
          The full guide:{" "}
          <Link href="/docs/data-sources-and-license" className="underline underline-offset-4 hover:text-foreground">
            Data sources and license
          </Link>
          .
        </p>
      </Section>

      <CtaBand
        title="See the data for yourself."
        body="Search is free and needs no account. Every fact on a funder page carries its source line."
        primary={{ label: "Search funders", href: "/search" }}
        secondary={{ label: "Self-install the database", href: "/docs/self-install" }}
      />
    </>
  );
}
