"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bookmark, BookmarkCheck, LoaderCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { signInPath } from "@/lib/auth/next-path";
import { saveFunderAction } from "@/lib/workspace/actions";
import type { FunderSnapshot } from "@/lib/workspace/types";
import { cn } from "@/lib/utils";

/**
 * "Save" on a search result or a funder profile. Optimistic flip, reverted
 * with a toast when the save is refused (plan limit, permissions).
 *
 * When the viewer is signed out (`signedIn={false}`) the button sends them to
 * /signin?next=<this page>; the save action itself also redirects to sign-in
 * if the session has expired, so a stale page can never save silently.
 */
export function SaveFunderButton({
  orgId,
  snapshot,
  saved = false,
  savedFunderId,
  signedIn = true,
  sourceDetail,
  size = "sm",
  className,
}: {
  orgId: string;
  snapshot: FunderSnapshot;
  saved?: boolean;
  savedFunderId?: string;
  /** Pass false on public surfaces so the button links to sign-in instead. */
  signedIn?: boolean;
  /** Why this funder is on the list, e.g. "Search: youth literacy in Oregon". */
  sourceDetail?: string | null;
  size?: "sm" | "default";
  className?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [isSaved, setSaved] = React.useState(saved);
  void savedFunderId;

  if (isSaved) {
    return (
      <Button variant="outline" size={size} asChild className={cn("border-yours-border bg-yours-tint text-yours hover:bg-yours-tint/80", className)}>
        <Link href={`/app/funders/${orgId}`} aria-label={`${snapshot.name} is saved. Open it in your workspace`}>
          <BookmarkCheck aria-hidden />
          Saved
        </Link>
      </Button>
    );
  }

  function onClick() {
    if (!signedIn) {
      const here = typeof window === "undefined" ? "/app" : `${window.location.pathname}${window.location.search}`;
      router.push(signInPath(here));
      return;
    }
    startTransition(async () => {
      setSaved(true);
      const result = await saveFunderAction({ snapshot: { ...snapshot, orgId }, sourceDetail: sourceDetail ?? null });
      if (result.ok) {
        toast.success(result.inserted ? "Saved to your list" : "Already on your list", {
          description: snapshot.name,
          action: { label: "Open", onClick: () => router.push(`/app/funders/${orgId}`) },
        });
        return;
      }
      setSaved(false);
      if (result.code === "limit_reached") {
        toast.warning("Your plan's saved-funder limit is reached", {
          description: result.message,
          action: { label: "See plans", onClick: () => router.push(result.upgradeUrl) },
        });
        return;
      }
      toast.error("Could not save", { description: result.message });
    });
  }

  return (
    <Button variant="outline" size={size} onClick={onClick} disabled={pending} className={className} aria-label={`Save ${snapshot.name} to your list`}>
      {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : <Bookmark aria-hidden />}
      Save
    </Button>
  );
}
