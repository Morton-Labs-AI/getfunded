import { ArrowUpRight } from "lucide-react";

import { SOURCES_NOTE, SOURCES_TITLE } from "@/lib/content/copy";
import { returnTypeLabel } from "@/lib/content/labels";
import { formatDate } from "@/lib/format";
import type { FilingSummary, FunderRecord } from "@/lib/queries/corpus/types";

import { ProfileSection } from "./profile-section";
import { Seal } from "./provenance";

/** Every dataset behind the page, with the seal for each filing. */
export function SourcesSection({ funder, filings }: { funder: FunderRecord; filings: FilingSummary[] }) {
  return (
    <ProfileSection id="sources" title={SOURCES_TITLE} note={SOURCES_NOTE}>
      <ul className="space-y-3">
        <li>
          <p className="mb-1 text-xs text-ink-3">
            Identity, address, type and the asset snapshot
            {funder.bmf.lastVerifiedAt ? ` · verified ${formatDate(funder.bmf.lastVerifiedAt)}` : ""}
          </p>
          <Seal p={funder.bmf.provenance} />
        </li>
        {filings.map((f) => (
          <li key={f.objectId}>
            <p className="mb-1 flex flex-wrap items-center gap-x-2 text-xs text-ink-3">
              <span>
                Form {returnTypeLabel(f.returnType)} · FY{f.fy ?? "?"}
                {f.taxPeriodEnd ? ` · period ending ${formatDate(f.taxPeriodEnd)}` : ""}
                {f.amended ? " · amended" : ""}
              </span>
              {f.xmlZipUrl ? (
                <a href={f.xmlZipUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-primary hover:underline">
                  IRS bulk XML
                  <ArrowUpRight className="size-3" aria-hidden />
                </a>
              ) : null}
            </p>
            <Seal p={f.provenance} />
          </li>
        ))}
      </ul>
    </ProfileSection>
  );
}
