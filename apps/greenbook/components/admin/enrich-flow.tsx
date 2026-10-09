"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import type { ExtractedFacts } from "@/lib/admin/enrich";

interface FetchResult {
  ok: boolean;
  reused: boolean;
  raw_file_id: number;
  sha256: string;
  snapshot_file: string;
  final_url: string;
  fetched_at: string;
  page_count: number;
  pages: string[];
  extraction: { fields: ExtractedFacts; model: string };
}

interface StageError {
  stage?: string;
  error: string;
}

const FIELD_LABELS: [keyof ExtractedFacts, string][] = [
  ["focus_areas", "Focus areas"],
  ["giving_priorities", "Giving priorities"],
  ["application_info", "Application info"],
  ["application_url", "Application URL"],
  ["accepts_unsolicited", "Accepts unsolicited proposals"],
  ["geographic_focus", "Geographic focus"],
  ["extracted_summary", "Summary"],
];

function ConfidencePill({ value }: { value: number | undefined }) {
  if (value === undefined) return null;
  const level = value >= 0.8 ? "high" : value >= 0.5 ? "med" : "low";
  const tone =
    level === "high"
      ? "text-ink-2 border-border-2"
      : level === "med"
        ? "text-ink-3 border-border-1"
        : "text-ink-4 border-border-1";
  return (
    <span
      className={`mono-label rounded-full border px-1.5 py-px text-[10px] ${tone}`}
      title={`extraction confidence ${value.toFixed(2)}`}
    >
      {level}
    </span>
  );
}

function renderValue(v: ExtractedFacts[keyof ExtractedFacts]): string {
  if (v === null || v === undefined) return "—";
  if (Array.isArray(v)) return v.length ? v.map(String).join(" · ") : "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  return String(v);
}

export function EnrichFlow({
  orgId,
  orgName,
  orgState,
  existingUrl,
}: {
  orgId: string;
  orgName: string;
  orgState: string | null;
  existingUrl: string | null;
}) {
  const router = useRouter();
  const [url, setUrl] = useState(existingUrl ?? "");
  const [busy, setBusy] = useState<null | "fetch" | "confirm">(null);
  const [error, setError] = useState<StageError | null>(null);
  const [result, setResult] = useState<FetchResult | null>(null);
  const [done, setDone] = useState(false);

  const googleHref = `https://www.google.com/search?q=${encodeURIComponent(
    `"${orgName}" ${orgState ?? ""} foundation`
  )}`;

  async function runFetch(force = false) {
    setBusy("fetch");
    setError(null);
    setResult(null);
    setDone(false);
    try {
      const res = await fetch("/api/admin/enrich/fetch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org_id: orgId, org_name: orgName, url, force }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json as StageError);
        return;
      }
      setResult(json as FetchResult);
    } catch (e) {
      setError({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  async function runConfirm() {
    if (!result) return;
    setBusy("confirm");
    setError(null);
    try {
      const res = await fetch("/api/admin/enrich/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          org_id: orgId,
          raw_file_id: result.raw_file_id,
          final_url: result.final_url,
          model: result.extraction.model,
          fields: result.extraction.fields,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json as StageError);
        return;
      }
      setDone(true);
      router.refresh();
    } catch (e) {
      setError({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  const fields = result?.extraction.fields;

  return (
    <div className="mt-6 flex flex-col gap-5">
      {existingUrl && (
        <div className="rounded-[10px] border border-border-1 bg-raised px-4 py-3 text-[12.5px] text-ink-3">
          A confirmed enrichment already exists for this foundation. Re-running
          replaces the profile facts; every snapshot stays in raw_files.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…  (the foundation's own website)"
          className="min-w-[320px] flex-1 rounded-[8px] border border-border-1 bg-surface px-3 py-2 text-[13px] text-ink-1 outline-none focus:border-border-2"
        />
        <button
          type="button"
          disabled={!url || busy !== null}
          onClick={() => runFetch(false)}
          className="rounded-[8px] border border-accent-border px-4 py-2 text-[12.5px] font-medium text-accent transition-colors hover:bg-accent-tint disabled:opacity-40"
        >
          {busy === "fetch" ? "Fetching & extracting…" : "Fetch & preview"}
        </button>
        <a
          href={googleHref}
          target="_blank"
          rel="noreferrer"
          className="text-[12px] text-ink-4 underline decoration-dotted hover:text-ink-2"
        >
          search Google ↗
        </a>
      </div>

      {error && (
        <div className="rounded-[10px] border border-border-2 bg-raised px-4 py-3 text-[13px] text-ink-1">
          <span className="mono-label mr-2">{error.stage ?? "error"}</span>
          {error.error}
        </div>
      )}

      {result && fields && !done && (
        <div className="rounded-[12px] border border-border-1 bg-surface p-5">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <div className="text-[14px] font-medium text-ink-1">
              Extraction preview — nothing is saved until you confirm
            </div>
            <div className="mono-label">
              {result.reused ? "reused today's snapshot" : "fresh snapshot"} ·{" "}
              {result.page_count} page{result.page_count === 1 ? "" : "s"} · sha{" "}
              {result.sha256.slice(0, 12)}
            </div>
          </div>
          <div className="mb-4 text-[12px] text-ink-4">
            {result.final_url} · {result.snapshot_file}
          </div>

          <dl className="flex flex-col gap-3">
            {FIELD_LABELS.map(([key, label]) => {
              const snippet = fields.snippets?.[key as string];
              return (
                <div key={key as string}>
                  <dt className="mono-label flex items-center gap-2">
                    {label}
                    <ConfidencePill value={fields.confidence?.[key as string]} />
                  </dt>
                  <dd className="mt-0.5 text-[13px] leading-relaxed text-ink-1">
                    {renderValue(fields[key])}
                  </dd>
                  {snippet && (
                    <dd
                      className="as-reported mt-0.5 text-[11.5px] text-ink-4"
                      title={snippet.page}
                    >
                      “{snippet.excerpt}”
                    </dd>
                  )}
                </div>
              );
            })}

            <div>
              <dt className="mono-label flex items-center gap-2">
                People listed on the site
                <ConfidencePill value={fields.confidence?.people} />
              </dt>
              {fields.people.length === 0 ? (
                <dd className="mt-0.5 text-[13px] text-ink-4">—</dd>
              ) : (
                fields.people.map((p, i) => (
                  <dd key={i} className="mt-0.5 text-[13px] text-ink-1" title={p.source_page}>
                    {p.full_name}
                    {p.title ? ` — ${p.title}` : ""}{" "}
                    <span className="mono-label">{p.role.replace("_", " ")}</span>
                  </dd>
                ))
              )}
            </div>
          </dl>

          <div className="mt-5 flex items-center gap-3">
            <button
              type="button"
              disabled={busy !== null}
              onClick={runConfirm}
              className="rounded-[8px] bg-accent px-4 py-2 text-[12.5px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {busy === "confirm" ? "Saving…" : "Confirm & save to profile"}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => runFetch(true)}
              className="text-[12px] text-ink-4 underline decoration-dotted hover:text-ink-2"
            >
              re-fetch fresh snapshot
            </button>
          </div>
        </div>
      )}

      {done && (
        <div className="rounded-[10px] border border-border-1 bg-raised px-4 py-3 text-[13px] text-ink-1">
          Saved.{" "}
          <Link href={`/org/${orgId}`} className="text-accent underline">
            View profile →
          </Link>
        </div>
      )}
    </div>
  );
}
