"use client";

import Link from "next/link";
import { useEffect } from "react";
import { RotateCcw, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * The error boundary for everything signed in (/app and /invite). It sits
 * inside the workspace shell, so the navigation stays and the person can try
 * the same page again or go back to the dashboard. The raw error never
 * reaches the page; it is logged for the operator.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[app]", error.digest ?? "", error);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col items-center px-4 py-20 text-center sm:px-6" role="alert">
      <TriangleAlert className="size-8 text-danger" aria-hidden />
      <h1 className="mt-4 text-xl font-semibold text-foreground">Something went wrong on this page</h1>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        Your saved funders, notes and tasks are safe. Try the page again. If it keeps failing, go to the dashboard and come
        back in a minute.
      </p>
      {error.digest ? (
        <p className="tnum mt-2 font-mono text-xs text-ink-4" title="Quote this code if you write to support.">
          Error code {error.digest}
        </p>
      ) : null}
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button onClick={reset}>
          <RotateCcw aria-hidden />
          Try again
        </Button>
        <Button asChild variant="outline">
          <Link href="/app">Dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
