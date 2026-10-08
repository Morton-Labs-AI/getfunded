import Link from "next/link";
import { ArrowUpRight, Download, FileSpreadsheet, Hourglass } from "lucide-react";

import { Missing } from "@/components/data/missing";
import { SourceChip } from "@/components/data/source-chip";
import { CopyButton } from "@/components/marketing/copy-button";
import { LINKS } from "@/components/marketing/links";
import { Button } from "@/components/ui/button";
import { formatBytes, formatYearRange, type DataRelease, type DataReleaseFile } from "@/lib/data-release";
import { formatDate, formatNumber } from "@/lib/format";
import { site } from "@/lib/site";

import { listFile } from "./columns";

/** How many characters of the file fingerprint the card shows. The full value is in the title and on the Copy button. */
const FINGERPRINT_CHARS = 12;

/** The sentence the page shows while there is no release. Exported so the wording lives in one place. */
export const RELEASE_PENDING_NOTICE =
  "The first public release is being prepared. You can already search every foundation below.";

/**
 * The "How to cite" line: who to credit, which release, where it lives and
 * the license. Before the first release it carries no release name or date.
 */
export function citationLine(release: DataRelease): string {
  const parts = [`${release.attribution}.`];
  if (release.published) {
    const date = release.publishedAt ? formatDate(release.publishedAt, "long") : null;
    const detail = [release.tag ? `release ${release.tag}` : null, date].filter(Boolean).join(", ");
    parts.push(detail ? `The Open Foundation List (${detail}).` : "The Open Foundation List.");
  } else {
    parts.push("The Open Foundation List.");
  }
  parts.push(`${site.url}/foundations.`);
  parts.push(`Licensed ${release.licence}.`);
  return parts.join(" ");
}

function Fact({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <dt className="eyebrow text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm text-foreground">{children}</dd>
    </div>
  );
}

function FileCard({ file }: { file: DataReleaseFile }) {
  const description = file.description || listFile(file.name)?.summary || "";
  return (
    <article className="flex h-full flex-col rounded-lg border bg-card p-5 shadow-card">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary-tint text-primary">
          <FileSpreadsheet className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <h3 className="font-mono text-sm font-semibold break-all text-foreground">{file.name}</h3>
          {description ? <p className="mt-1 text-sm text-pretty text-muted-foreground">{description}</p> : null}
        </div>
      </div>

      <dl className="mt-4 grid flex-1 grid-cols-2 content-start gap-x-4 gap-y-3 sm:grid-cols-3">
        <Fact label="Rows">
          {file.rows === null ? <Missing /> : <span className="tnum font-mono">{formatNumber(file.rows)}</span>}
        </Fact>
        <Fact label="Size">{file.bytes === null ? <Missing /> : <span className="tnum">{formatBytes(file.bytes)}</span>}</Fact>
        <Fact label="File fingerprint" className="col-span-2 sm:col-span-1">
          {file.sha256 === null ? (
            <Missing />
          ) : (
            <code className="tnum font-mono" title={file.sha256}>
              {file.sha256.slice(0, FINGERPRINT_CHARS)}
            </code>
          )}
        </Fact>
      </dl>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Button asChild>
          <a href={file.url} rel="noreferrer">
            <Download aria-hidden />
            Download
            <span className="sr-only"> {file.name}</span>
          </a>
        </Button>
        {file.sha256 ? <CopyButton text={file.sha256} label="Copy full fingerprint" /> : null}
      </div>
    </article>
  );
}

/** The release line and one card per file. Rendered only when there is a release. */
function ReleaseFiles({ release }: { release: DataRelease }) {
  const years = formatYearRange(release.indexYears);
  return (
    <>
      <dl className="mt-8 flex flex-wrap gap-x-10 gap-y-4">
        <Fact label="Released">
          {release.publishedAt ? (
            <time dateTime={release.publishedAt}>{formatDate(release.publishedAt, "long")}</time>
          ) : (
            <Missing />
          )}
        </Fact>
        <Fact label="Years covered">
          {years ? (
            <>
              <span className="tnum">{years}</span>{" "}
              <span className="block text-xs text-ink-3">By the year the IRS processed each return.</span>
            </>
          ) : (
            <Missing />
          )}
        </Fact>
        {release.releaseUrl ? (
          <Fact label="Release on GitHub">
            <a
              href={release.releaseUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 font-medium text-primary underline underline-offset-4 hover:text-primary-hover"
            >
              <span className="font-mono text-[13px] break-all">{release.tag}</span>
              <ArrowUpRight className="size-3 shrink-0" aria-hidden />
            </a>
          </Fact>
        ) : null}
        {release.vintage ? (
          <Fact label="Snapshot label">
            <span className="font-mono text-[13px] break-all">{release.vintage}</span>
          </Fact>
        ) : null}
      </dl>

      <ul className="mt-6 grid gap-4 md:grid-cols-2">
        {release.files.map((file) => (
          <li key={file.name}>
            <FileCard file={file} />
          </li>
        ))}
      </ul>
    </>
  );
}

function ReleasePending() {
  return (
    <div className="mt-8 flex max-w-2xl items-start gap-3 rounded-lg border border-primary-border bg-primary-tint/50 p-5">
      <Hourglass className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
      <div>
        <p className="font-medium text-pretty text-foreground">{RELEASE_PENDING_NOTICE}</p>
        <p className="mt-3">
          <Button variant="outline" size="sm" asChild>
            <a href="#browse">Browse by state</a>
          </Button>
        </p>
      </div>
    </div>
  );
}

/**
 * The downloads block: the files (or the honest "being prepared" notice),
 * then the license line and the copyable citation. No download button is
 * ever rendered without a published release behind it.
 */
export function Downloads({ release }: { release: DataRelease }) {
  const cite = citationLine(release);
  const isCcBy = release.licence === site.license.data;

  return (
    <>
      {release.published ? <ReleaseFiles release={release} /> : <ReleasePending />}

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <div className="rounded-lg border bg-card p-5 shadow-card">
          <h3 className="font-semibold text-foreground">License</h3>
          <p className="mt-2 text-sm leading-6 text-pretty text-ink-2">
            The list is published under{" "}
            {isCcBy ? (
              <a
                href={LINKS.ccBy}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-primary underline underline-offset-4 hover:text-primary-hover"
              >
                {release.licence}
              </a>
            ) : (
              <span className="font-medium text-foreground">{release.licence}</span>
            )}
            . You may use it, share it and change it, as long as you credit the source. The IRS records underneath are public
            domain and need no credit.
          </p>
          <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-3">
            <span>Built from</span>
            <SourceChip label="IRS Form 990-PF e-file" />
          </p>
        </div>

        <div className="rounded-lg border bg-card p-5 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold text-foreground">How to cite</h3>
            <CopyButton text={cite} label="Copy citation" />
          </div>
          <blockquote className="mt-2 border-l-2 border-primary-border bg-primary-tint/50 px-3 py-2 text-sm leading-6 text-ink-2">
            {cite}
          </blockquote>
          {release.published ? null : (
            <p className="mt-2 text-xs text-ink-3">The release name and date are added to this line when the first release is out.</p>
          )}
        </div>
      </div>

      <p className="mt-6 text-sm text-ink-3">
        New to <code className="rounded-sm border bg-inset px-1 font-mono text-[0.85em]">.csv.gz</code> files?{" "}
        <Link href="/docs/open-foundation-list" className="underline underline-offset-4 hover:text-foreground">
          How to open the list in Excel or Google Sheets
        </Link>
        .
      </p>
    </>
  );
}
