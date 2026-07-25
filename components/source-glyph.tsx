"use client";

import { useEffect, useRef, useState } from "react";
import { OpenSeal } from "./open-ring";
import { hashShort, dateShort } from "@/lib/format";

export interface Provenance {
  dataset: string;
  sourceUrl?: string | null;
  sha256: string;
  license: string;
  locator?: string | null;
  ingested?: string | null;
}

const DATASET_LABELS: Record<string, string> = {
  irs_eo_bmf: "IRS Exempt Orgs Business Master File",
  irs_990_xml: "IRS 990-PF e-file",
  sec_form_adv: "SEC Form ADV (daily feed)",
  sec_form_adv_filings: "SEC Form ADV (filing data)",
  sec_form_d: "SEC Form D",
  sbir_awards: "SBIR/STTR award data",
  seed_federal_agencies: "Curated federal-agency seed",
  seed_federal_programs: "Curated federal-program seed",
};

/**
 * The Provenance Seal — the chain-of-custody popover behind every sourced
 * fact. One component, identical everywhere; sameness IS the trust signal.
 */
export function SourceGlyph({
  prov,
  children,
}: {
  prov: Provenance;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  return (
    <span ref={ref} className="relative inline-flex items-baseline">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="fact text-inherit"
        aria-expanded={open}
        aria-label="Show source"
      >
        {children}
      </button>
      {open && (
        <div
          className="seal-press absolute left-0 top-full z-50 mt-2 w-[300px] rounded-[10px] border border-border-1 bg-overlay p-3.5"
          style={{ boxShadow: "var(--shadow-overlay)" }}
          role="dialog"
        >
          <div className="flex items-center gap-2.5 border-b border-border-1 pb-2.5">
            <OpenSeal size={28} />
            <span className="mono-label">chain of custody</span>
          </div>
          <div className="flex flex-col gap-2 pt-2.5 text-[12.5px]">
            <div className="text-ink-1">
              {DATASET_LABELS[prov.dataset] ?? prov.dataset}
            </div>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(prov.sha256);
                setCopied(true);
                setTimeout(() => setCopied(false), 900);
              }}
              className="tnum w-full rounded-[5px] px-2 py-1.5 text-left font-mono text-[11.5px] transition-colors duration-[120ms]"
              style={{
                background: copied ? "var(--accent-tint)" : "var(--bg-inset)",
                color: "var(--ink-2)",
              }}
            >
              {copied ? "copied full hash" : `sha256 ${hashShort(prov.sha256)}`}
            </button>
            {prov.locator && (
              <div className="break-all font-mono text-[10.5px] leading-4 text-ink-3">
                {prov.locator}
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="mono-label normal-case tracking-normal">
                {prov.license}
              </span>
              {prov.sourceUrl && (
                <a
                  href={prov.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11.5px] text-accent hover:text-accent-hover"
                >
                  view source ↗
                </a>
              )}
            </div>
            {prov.ingested && (
              <div className="border-t border-border-1 pt-2 text-[11px] text-ink-4">
                Acquired {dateShort(prov.ingested)} · every fact traces to a
                hashed public filing
              </div>
            )}
          </div>
        </div>
      )}
    </span>
  );
}
