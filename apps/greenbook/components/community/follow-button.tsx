"use client";

import { useOptimistic, useTransition, useState } from "react";

import { toggleFollowOrg } from "@/lib/actions/follows";

/**
 * Follow / Following toggle.
 *
 * Distinct from Save on purpose: saving is CURATION (it goes in a list you
 * shape), following is ATTENTION (you want to know when something changes).
 * Collapsing them into one control would force a member to accept one to get
 * the other, and the two have different privacy weights — a follow is private
 * by default and a list can be published.
 */
export function FollowButton({
  orgId,
  following: initial,
}: {
  orgId: string;
  following: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [following, setFollowing] = useState(initial);
  const [optimistic, setOptimistic] = useOptimistic(following);

  function toggle() {
    setError(null);
    start(async () => {
      setOptimistic(!following);
      const res = await toggleFollowOrg({ orgId });
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setFollowing(res.following);
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      {error ? <span className="text-[12px] text-ink-3">{error}</span> : null}
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed={optimistic}
        className={
          "rounded-[8px] border px-3 py-1.5 text-[12.5px] font-medium transition-colors duration-[90ms] disabled:opacity-60 " +
          (optimistic
            ? "border-border-2 bg-inset text-ink-1"
            : "border-border-1 text-ink-2 hover:border-border-2 hover:text-ink-1")
        }
      >
        {optimistic ? "Following" : "Follow"}
      </button>
    </span>
  );
}
