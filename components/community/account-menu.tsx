"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { ViewerChip } from "@/lib/auth/viewer";

/**
 * The signed-in account button and its popover.
 *
 * Outside-click + Escape + .seal-press match components/source-glyph.tsx, and
 * the 32px square button matches components/theme-toggle.tsx, so this reads as
 * part of the same nav rather than a bolted-on account widget.
 *
 * Takes a ViewerChip, never a Viewer. The chip cannot carry an email address
 * because Viewer has no email field at all — see lib/auth/viewer.ts.
 */
export function AccountMenu({ chip }: { chip: ViewerChip }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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

  const name = chip.displayName ?? (chip.handle ? `@${chip.handle}` : "Your account");

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Account"
        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border-1 text-[11px] font-semibold tracking-[0.02em] text-ink-2 transition-colors duration-[90ms] hover:border-border-2 hover:text-ink-1"
      >
        {chip.initials}
      </button>

      {open && (
        <div
          role="menu"
          className="seal-press absolute right-0 top-full z-50 mt-2 w-[232px] rounded-[10px] border border-border-1 bg-overlay p-1.5"
          style={{ boxShadow: "var(--shadow-overlay)" }}
        >
          <div className="border-b border-border-1 px-2.5 pb-2.5 pt-1.5">
            <div className="truncate text-[13.5px] font-medium text-ink-1">{name}</div>
            {chip.isMaintainer ? (
              <span className="mono-label mt-1 inline-block">maintainer</span>
            ) : null}
          </div>

          {/* An invited member has not chosen a handle or granted CC0 yet.
              Saying so plainly beats rendering a half-built profile. */}
          {chip.status === "invited" ? (
            <p className="px-2.5 py-2 text-[12.5px] leading-[1.45] text-ink-3">
              Your profile isn&apos;t set up yet.
            </p>
          ) : null}

          {chip.status === "suspended" || chip.status === "banned" ? (
            <p className="px-2.5 py-2 text-[12.5px] leading-[1.45] text-ink-3">
              This account can read, but not contribute.
            </p>
          ) : null}

          <Link
            href="/collections"
            onClick={() => setOpen(false)}
            className="block rounded-[6px] px-2.5 py-2 text-[13.5px] text-ink-2 transition-colors duration-[90ms] hover:bg-inset hover:text-ink-1"
          >
            Your lists
          </Link>

          {chip.handle ? (
            <Link
              href={`/members/${chip.handle}`}
              onClick={() => setOpen(false)}
              className="block rounded-[6px] px-2.5 py-2 text-[13.5px] text-ink-2 transition-colors duration-[90ms] hover:bg-inset hover:text-ink-1"
            >
              Your profile
            </Link>
          ) : null}

          {/* POST, not a link: a GET sign-out is CSRF-able, and Next's link
              prefetching would fire it on hover. */}
          <form action="/auth/sign-out" method="post">
            <button
              type="submit"
              className="w-full rounded-[6px] px-2.5 py-2 text-left text-[13.5px] text-ink-2 transition-colors duration-[90ms] hover:bg-inset hover:text-ink-1"
            >
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
