"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";

/**
 * The omnibox: the topbar's ask-anything input. Submits to the Ask page.
 * ⌘K focuses it from anywhere (the command palette upgrades this later).
 * Hidden on the Ask page itself — the page's own input is the front door.
 */
export function Omnibox() {
  const router = useRouter();
  const pathname = usePathname();
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");

  if (pathname === "/") return <div className="w-[480px]" aria-hidden />;

  return (
    <form
      className="group relative w-[480px] transition-[width] duration-[200ms] focus-within:w-[640px]"
      onSubmit={(e) => {
        e.preventDefault();
        const q = value.trim();
        if (!q) return;
        setValue("");
        router.push(`/?q=${encodeURIComponent(q)}`);
      }}
    >
      <input
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Ask anything — who funds fusion research?"
        className="h-9 w-full rounded-[10px] border border-border-2 bg-raised px-3.5 pr-12 text-[13.5px] text-ink-1 placeholder:text-ink-4 focus:outline-none"
        style={{ boxShadow: "none" }}
      />
      <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2">
        ⌘K
      </kbd>
    </form>
  );
}
