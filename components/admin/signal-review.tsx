"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SignalReviewRow } from "@/lib/queries/signals";

const fmtMoney = (v: string | null) =>
  v === null ? "—" : `$${Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

/** Publish / reject / reopen one candidate. The decision is the only write. */
export function SignalReviewRowActions({ row }: { row: SignalReviewRow }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(status: "published" | "rejected" | "candidate") {
    setBusy(status);
    setError(null);
    try {
      const res = await fetch("/api/admin/signals/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: Number(row.id), status }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? `HTTP ${res.status}`);
        return;
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const classified = row.extracted_at !== null;
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1.5">
        {row.status === "candidate" ? (
          <>
            <button
              type="button"
              disabled={!classified || busy !== null}
              title={classified ? "Publish: appears on the profile and in public.funder_signals" : "Classify first (funderdb signals process)"}
              onClick={() => decide("published")}
              className="rounded-[6px] bg-accent px-2.5 py-1 text-[12px] font-medium text-white disabled:opacity-40"
            >
              {busy === "published" ? "…" : "Publish"}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => decide("rejected")}
              className="rounded-[6px] border border-border-2 px-2.5 py-1 text-[12px] text-ink-2 disabled:opacity-40"
            >
              {busy === "rejected" ? "…" : "Reject"}
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => decide("candidate")}
            className="rounded-[6px] border border-border-2 px-2.5 py-1 text-[12px] text-ink-2 disabled:opacity-40"
          >
            {busy === "candidate" ? "…" : "Reopen"}
          </button>
        )}
      </div>
      {error && <span className="text-[11px] text-negative">{error}</span>}
    </div>
  );
}

/** Record one announcement URL (+ EIN) as a candidate; the pipeline classifies it. */
export function AddSignalForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [ein, setEin] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/signals/add", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, ein: ein || null, discovery_note: note || null }),
      });
      const json = await res.json();
      if (!res.ok) {
        setResult(json.error ?? `HTTP ${res.status}`);
        return;
      }
      setResult(
        `${json.created ? "Recorded" : "Already on file"} as signal #${json.signalId}` +
          (json.linked ? " and linked to the org by EIN." : json.warning ? `. ${json.warning}.` : ".") +
          ` ${json.next}`
      );
      setUrl("");
      setEin("");
      setNote("");
      router.refresh();
    } catch (err) {
      setResult(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 flex flex-col gap-2 rounded-[10px] border border-border-1 bg-surface p-4">
      <span className="mono-label">add an announcement by hand</span>
      <input
        required
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://www.macfound.org/press/press-releases/dedicating-750-million-to-impact-investments"
        className="rounded-[6px] border border-border-1 bg-raised px-2.5 py-1.5 text-[13px] text-ink-1"
      />
      <div className="flex flex-wrap gap-2">
        <input
          value={ein}
          onChange={(e) => setEin(e.target.value)}
          placeholder="EIN (9 digits, optional)"
          className="w-48 rounded-[6px] border border-border-1 bg-raised px-2.5 py-1.5 font-mono text-[13px] text-ink-1"
        />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="How you found it (e.g. LinkedIn post by their managing director)"
          className="min-w-0 flex-1 rounded-[6px] border border-border-1 bg-raised px-2.5 py-1.5 text-[13px] text-ink-1"
        />
        <button type="submit" disabled={busy || !url} className="rounded-[6px] bg-accent px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-40">
          {busy ? "Recording…" : "Record"}
        </button>
      </div>
      {result && <p className="text-[12px] text-ink-3">{result}</p>}
    </form>
  );
}

export { fmtMoney };
