"use client";

import Link from "next/link";
import { useEffect } from "react";
import { RotateCcw, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";

/** The error boundary for the steward pages under /admin. */
export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[admin]", error.digest ?? "", error);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col items-center px-4 py-20 text-center sm:px-6" role="alert">
      <TriangleAlert className="size-8 text-danger" aria-hidden />
      <h1 className="mt-4 text-xl font-semibold text-foreground">The admin page did not load</h1>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        Nothing was changed. Try again; if it keeps failing, check the server logs for the error code below.
      </p>
      {error.digest ? (
        <p className="tnum mt-2 font-mono text-xs text-ink-4">Error code {error.digest}</p>
      ) : null}
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button onClick={reset}>
          <RotateCcw aria-hidden />
          Try again
        </Button>
        <Button asChild variant="outline">
          <Link href="/admin">Admin home</Link>
        </Button>
      </div>
    </div>
  );
}
