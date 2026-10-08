"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { HandCoins, LayoutGrid, Rows3 } from "lucide-react";

import { POSTURE_LABELS } from "@/components/data/posture";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GIVING_TO_PLACEHOLDER } from "@/lib/content/copy";
import { NTEE_FILTER_GROUPS, NTEE_MAJOR, ORG_TYPE_LABELS, US_STATES } from "@/lib/content/labels";
import { formatMoneyCompact } from "@/lib/format";
import {
  SEARCH_POSTURES,
  SEARCH_SORTS,
  SEARCH_TYPES,
  searchHref,
  withParams,
  type SearchParams,
  type SearchPosture,
  type SearchSort,
  type SearchType,
  type SearchView,
} from "@/lib/search/params";
import { cn } from "@/lib/utils";

const ANY = "any";

export const DISTRIBUTION_PRESETS = [100_000, 500_000, 1_000_000, 5_000_000, 25_000_000] as const;
export const ASSET_PRESETS = [1_000_000, 10_000_000, 100_000_000, 1_000_000_000] as const;

const SORT_LABELS: Record<SearchSort, string> = {
  relevance: "Best match",
  distributions: "Most giving",
  assets: "Largest assets",
  name: "Name A to Z",
};

/**
 * Structured filters. Every change writes the URL and resets the page, so
 * the back button, a shared link and the JSON API all see the same state.
 */
export function FilterControls({ current, base }: { current: SearchParams; base: string }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [givingTo, setGivingTo] = React.useState(current.givingTo ?? "");
  // Fresh URL state (back button, a shared link): adopt it. React's "storing
  // information from previous renders" pattern; no effect, no ref.
  const [seenGivingTo, setSeenGivingTo] = React.useState(current.givingTo ?? "");
  if (seenGivingTo !== (current.givingTo ?? "")) {
    setSeenGivingTo(current.givingTo ?? "");
    setGivingTo(current.givingTo ?? "");
  }

  function set(patch: Partial<SearchParams>) {
    startTransition(() => router.push(searchHref(base, withParams(current, patch))));
  }

  const selectClass = "h-9 w-full min-w-0 max-w-full";
  const baseId = React.useId();
  const id = (name: string) => `${baseId}-${name}`;

  return (
    <div className="flex flex-col gap-3" aria-busy={pending}>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end">
        <Field id={id("type")} label="Type">
          <Select value={current.type} onValueChange={(v) => set({ type: v as SearchType })}>
            <SelectTrigger id={id("type")} className={selectClass}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SEARCH_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t === "all" ? "All funder types" : ORG_TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field id={id("state")} label="State">
          <Select value={current.state ?? ANY} onValueChange={(v) => set({ state: v === ANY ? null : v })}>
            <SelectTrigger id={id("state")} className={selectClass}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any state</SelectItem>
              {US_STATES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field id={id("posture")} label="Applications">
          <Select value={current.posture ?? ANY} onValueChange={(v) => set({ posture: v === ANY ? null : (v as SearchPosture) })}>
            <SelectTrigger id={id("posture")} className={selectClass}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any application status</SelectItem>
              {SEARCH_POSTURES.map((p) => (
                <SelectItem key={p} value={p}>
                  {POSTURE_LABELS[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field id={id("giving")} label="Gives per year">
          <Select
            value={current.minDistributions ? String(current.minDistributions) : ANY}
            onValueChange={(v) => set({ minDistributions: v === ANY ? null : Number(v) })}
          >
            <SelectTrigger id={id("giving")} className={selectClass}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any giving level</SelectItem>
              {DISTRIBUTION_PRESETS.map((v) => (
                <SelectItem key={v} value={String(v)}>
                  Gives {formatMoneyCompact(v)}+ a year
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field id={id("assets")} label="Assets">
          <Select value={current.minAssets ? String(current.minAssets) : ANY} onValueChange={(v) => set({ minAssets: v === ANY ? null : Number(v) })}>
            <SelectTrigger id={id("assets")} className={selectClass}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any asset size</SelectItem>
              {ASSET_PRESETS.map((v) => (
                <SelectItem key={v} value={String(v)}>
                  Assets {formatMoneyCompact(v)}+
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field id={id("focus")} label="Focus area">
          <Select value={current.ntee ?? ANY} onValueChange={(v) => set({ ntee: v === ANY ? null : v })}>
            <SelectTrigger id={id("focus")} className={selectClass}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any focus area</SelectItem>
              {NTEE_FILTER_GROUPS.map((k) => (
                <SelectItem key={k} value={k}>
                  {NTEE_MAJOR[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <form
          className="flex min-w-0 flex-1 items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            set({ givingTo: givingTo.trim() || null });
          }}
        >
          <Label htmlFor="search-giving-to" className="shrink-0 gap-1.5 text-[13px] text-ink-2">
            <HandCoins className="size-4 text-source" aria-hidden />
            Funds organizations like
          </Label>
          <Input
            id="search-giving-to"
            value={givingTo}
            onChange={(e) => setGivingTo(e.target.value)}
            placeholder={GIVING_TO_PLACEHOLDER}
            className="h-9 max-w-xs"
          />
          <Button type="submit" variant="outline" size="sm" className="h-9">
            Apply
          </Button>
        </form>

        <div className="flex items-end gap-2">
          <Field id={id("sort")} label="Sort">
            <Select value={current.sort} onValueChange={(v) => set({ sort: v as SearchSort })}>
              <SelectTrigger id={id("sort")} className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SEARCH_SORTS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {SORT_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <ViewToggle value={current.view} onChange={(view) => set({ view, page: current.page })} />
        </div>
      </div>
    </div>
  );
}

/** A visible label over one control. The label is the control's name, not a hint. */
function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Label htmlFor={id} className="text-xs font-medium text-ink-3">
        {label}
      </Label>
      {children}
    </div>
  );
}

function ViewToggle({ value, onChange }: { value: SearchView; onChange: (v: SearchView) => void }) {
  return (
    <div role="radiogroup" aria-label="Result layout" className="inline-flex rounded-md border border-input bg-surface p-0.5">
      {(
        [
          ["cards", LayoutGrid, "Cards"],
          ["table", Rows3, "Table"],
        ] as const
      ).map(([view, Icon, label]) => (
        <button
          key={view}
          type="button"
          role="radio"
          aria-checked={value === view}
          aria-label={`${label} view`}
          onClick={() => onChange(view)}
          className={cn(
            "rounded-sm p-1.5 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
            value === view ? "bg-primary-tint text-primary" : "text-ink-3 hover:text-foreground",
          )}
        >
          <Icon className="size-4" aria-hidden />
        </button>
      ))}
    </div>
  );
}
