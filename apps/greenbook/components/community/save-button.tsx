"use client";

import { useOptimistic, useTransition, useState } from "react";

import { saveOrg, unsaveOrg } from "@/lib/actions/collections";
import type { ViewerCollectionRef } from "@/lib/queries/community/org";

/**
 * Save / Saved toggle for the org page header.
 *
 * Optimistic via useOptimistic so the button responds on click rather than
 * after a round trip — the corpus pages are fast and a laggy control would read
 * as broken. On failure the optimistic value is discarded (React reverts it when
 * the transition ends) and the error is shown inline; there is no toast system
 * in this app and adding one for a single control is not worth the dependency.
 */
export function SaveButton({
  orgId,
  collections,
}: {
  orgId: string;
  collections: ViewerCollectionRef[];
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(collections.length > 0);
  const [optimisticSaved, setOptimisticSaved] = useOptimistic(saved);

  function toggle() {
    setError(null);
    start(async () => {
      const next = !saved;
      setOptimisticSaved(next);
      const res = next ? await saveOrg({ orgId, collectionId: null }) : await unsaveOrg({ orgId });
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setSaved(next);
    });
  }

  const label = optimisticSaved ? "Saved" : "Save";

  return (
    <span className="inline-flex items-center gap-2">
      {error ? <span className="text-[12px] text-ink-3">{error}</span> : null}
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed={optimisticSaved}
        className={
          "inline-flex items-center gap-1.5 rounded-[8px] border px-3 py-1.5 text-[12.5px] font-medium transition-colors duration-[90ms] disabled:opacity-60 " +
          (optimisticSaved
            ? "border-accent-border bg-accent-tint text-accent"
            : "border-border-1 text-ink-2 hover:border-border-2 hover:text-ink-1")
        }
      >
        <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden
             fill={optimisticSaved ? "currentColor" : "none"}>
          <path d="M6 4h12a1 1 0 0 1 1 1v15l-7-4-7 4V5a1 1 0 0 1 1-1Z"
                stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        </svg>
        {label}
      </button>
    </span>
  );
}
