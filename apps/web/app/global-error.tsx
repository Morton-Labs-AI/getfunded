"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * The last resort: an error thrown by the root layout itself. It replaces the
 * whole document, so it must render its own <html> and <body> and can rely on
 * nothing from the app (no fonts, no theme provider). globals.css still loads,
 * so the colour tokens work; no literal colours here either.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[global]", error.digest ?? "", error);
  }, [error]);

  return (
    <html lang="en">
      <body className="flex min-h-full flex-col bg-background font-sans text-foreground antialiased">
        <main id="main" className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center px-4 py-20 text-center" role="alert">
          <h1 className="text-xl font-semibold">GetFunded hit a problem</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            The page could not be shown. Nothing you saved was lost. Try again, or come back in a few minutes.
          </p>
          {error.digest ? <p className="mt-2 font-mono text-xs text-ink-4">Error code {error.digest}</p> : null}
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={reset}
              className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
            >
              Try again
            </button>
            <Link href="/" className="inline-flex h-9 items-center rounded-md border border-input bg-surface px-4 text-sm font-medium hover:bg-accent">
              Home
            </Link>
          </div>
        </main>
      </body>
    </html>
  );
}
