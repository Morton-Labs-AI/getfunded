"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Hash, Loader2, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SEARCH_MODE_HINTS, SEARCH_MODE_LABELS, SEARCH_PLACEHOLDER } from "@/lib/content/copy";
import { detectEin } from "@/lib/search/ein";
import { SEARCH_MODES, searchHref, withParams, type SearchMode, type SearchParams } from "@/lib/search/params";
import { cn } from "@/lib/utils";

/**
 * The query box plus the mode switch. Every submit writes the URL; the
 * server does the searching. No model call happens here: an EIN or a name
 * is answered from an index, and "describe the work" is a plain request
 * that the server embeds (or falls back to keywords, with a notice).
 */
export function SearchForm({ current, base }: { current: SearchParams; base: string }) {
  const router = useRouter();
  const [text, setText] = React.useState(current.q ?? "");
  const [mode, setMode] = React.useState<SearchMode>(current.mode);
  const [pending, startTransition] = React.useTransition();
  // Fresh URL state (back button, a shared link, a server redirect): adopt it.
  // React's "storing information from previous renders" pattern; no effect.
  const [seen, setSeen] = React.useState({ q: current.q ?? "", mode: current.mode });
  if (seen.q !== (current.q ?? "") || seen.mode !== current.mode) {
    setSeen({ q: current.q ?? "", mode: current.mode });
    setText(current.q ?? "");
    setMode(current.mode);
  }

  const ein = detectEin(text);

  function submit(nextMode: SearchMode = mode) {
    const q = text.trim();
    const next = withParams(current, { q: q || null, mode: nextMode });
    startTransition(() => router.push(searchHref(base, next)));
  }

  return (
    <form
      role="search"
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Label htmlFor="search-q" className="sr-only">
            Search funders
          </Label>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            id="search-q"
            name="q"
            type="search"
            autoComplete="off"
            enterKeyHint="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={SEARCH_PLACEHOLDER}
            className="h-11 pl-9 text-base"
          />
        </div>
        <Button type="submit" size="lg" className="h-11" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Search
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div role="radiogroup" aria-label="Search mode" className="inline-flex rounded-md border border-input bg-surface p-0.5">
          {SEARCH_MODES.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => {
                setMode(m);
                if (text.trim()) submit(m);
              }}
              className={cn(
                "rounded-sm px-3 py-1.5 text-[13px] font-medium transition-colors duration-150 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                mode === m ? "bg-primary-tint text-primary" : "text-ink-3 hover:text-foreground",
              )}
            >
              {SEARCH_MODE_LABELS[m]}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {ein ? (
            <span className="inline-flex items-center gap-1 text-source">
              <Hash className="size-3" aria-hidden />
              Looks like an EIN. We will look it up exactly.
            </span>
          ) : (
            SEARCH_MODE_HINTS[mode]
          )}
        </p>
      </div>
    </form>
  );
}
