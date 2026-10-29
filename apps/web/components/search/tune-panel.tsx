"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SlidersHorizontal, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { US_STATES } from "@/lib/content/labels";
import { formatMoneyCompact } from "@/lib/format";
import { CAUSE_KEYS, CAUSE_WORDS, type SearcherContext } from "@/lib/search/context";
import { searchHref, withParams, type SearchParams } from "@/lib/search/params";
import { stateName } from "@/lib/search/understand";

const ANY = "any";

/** Budget bands; each stands for its midpoint when ranking compares grant sizes. */
export const BUDGET_BANDS = [
  { value: 75_000, label: "Under $100k" },
  { value: 300_000, label: "$100k to $500k" },
  { value: 1_000_000, label: "$500k to $2M" },
  { value: 5_000_000, label: "$2M to $10M" },
  { value: 20_000_000, label: "Over $10M" },
] as const;

function budgetLabel(v: number | null): string | null {
  if (!v) return null;
  const band = BUDGET_BANDS.find((b) => b.value === v);
  return band ? `${band.label} budget` : `${formatMoneyCompact(v)} budget`;
}

const SOURCE_WORDS = { url: "", query: " (from your words)", profile: " (from your profile)" } as const;

/**
 * "Tune results for your organization": the grantseeker's state, cause and
 * budget, carried in the URL (for_state, for_cause, for_budget) so a tuned
 * search can be shared and the JSON API sees the same thing. Tuning changes
 * the order, never the membership: national funders that fit the words still
 * show. In the app, the workspace profile tunes every search by default; the
 * reader can switch that off for one search.
 */
export function TunePanel({
  current,
  base,
  context,
  mode,
  hasProfile,
}: {
  current: SearchParams;
  base: string;
  context: SearcherContext | null | undefined;
  mode: "public" | "app";
  hasProfile: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [open, setOpen] = React.useState(false);
  const [state, setState] = React.useState(current.forState ?? context?.state ?? ANY);
  const [cause, setCause] = React.useState(current.forCause ?? context?.cause ?? ANY);
  const [budget, setBudget] = React.useState(String(current.forBudget ?? context?.budget ?? ANY));
  const baseId = React.useId();

  function go(patch: Partial<SearchParams>) {
    startTransition(() => router.push(searchHref(base, withParams(current, patch))));
  }

  const parts: string[] = [];
  if (context?.state) parts.push(`${context.city ? `${context.city}, ` : ""}${stateName(context.state)}${SOURCE_WORDS[context.stateSource ?? "url"]}`);
  if (context?.cause) parts.push(`${CAUSE_WORDS[context.cause]?.label ?? context.cause}${SOURCE_WORDS[context.causeSource ?? "url"]}`);
  const b = budgetLabel(context?.budget ?? null);
  if (b) parts.push(b);
  const tunedByUrl = Boolean(current.forState || current.forCause || current.forBudget);
  const profileOff = mode === "app" && current.tune === "off";

  return (
    <section className="rounded-lg border border-dashed bg-surface px-3 py-2.5" aria-busy={pending} aria-labelledby={`${baseId}-title`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p id={`${baseId}-title`} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-2">
          <SlidersHorizontal className="size-4 text-ink-3" aria-hidden />
          {parts.length ? (
            <>
              <span className="font-medium text-foreground">Ranked for:</span> {parts.join(" · ")}
            </>
          ) : profileOff ? (
            <span>Not using your profile for this search.</span>
          ) : (
            <span>Tell us where you work and what you do, and funders who give there and to work like yours rank first.</span>
          )}
        </p>
        <div className="flex items-center gap-1.5">
          {tunedByUrl ? (
            <Button variant="ghost" size="sm" onClick={() => go({ forState: null, forCause: null, forBudget: null, forCity: null })}>
              <X className="size-3.5" aria-hidden />
              Clear
            </Button>
          ) : null}
          {mode === "app" && hasProfile ? (
            profileOff ? (
              <Button variant="ghost" size="sm" onClick={() => go({ tune: null })}>
                Use my profile
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => go({ tune: "off" })}>
                Ignore my profile
              </Button>
            )
          ) : null}
          <Button variant="outline" size="sm" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls={`${baseId}-form`}>
            {parts.length ? "Change" : "Tune results"}
          </Button>
        </div>
      </div>

      {open ? (
        <form
          id={`${baseId}-form`}
          className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            setOpen(false);
            go({
              forState: state === ANY ? null : state,
              forCause: cause === ANY ? null : cause,
              forBudget: budget === ANY ? null : Number(budget),
              forCity: null,
            });
          }}
        >
          <div className="flex min-w-0 flex-col gap-1">
            <Label htmlFor={`${baseId}-state`} className="text-xs font-medium text-ink-3">
              Where you work
            </Label>
            <Select value={state} onValueChange={setState}>
              <SelectTrigger id={`${baseId}-state`} className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Anywhere</SelectItem>
                {US_STATES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {stateName(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <Label htmlFor={`${baseId}-cause`} className="text-xs font-medium text-ink-3">
              What you do
            </Label>
            <Select value={cause} onValueChange={setCause}>
              <SelectTrigger id={`${baseId}-cause`} className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any cause</SelectItem>
                {CAUSE_KEYS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {CAUSE_WORDS[k].label.charAt(0).toUpperCase() + CAUSE_WORDS[k].label.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <Label htmlFor={`${baseId}-budget`} className="text-xs font-medium text-ink-3">
              Annual budget
            </Label>
            <Select value={budget} onValueChange={setBudget}>
              <SelectTrigger id={`${baseId}-budget`} className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any size</SelectItem>
                {BUDGET_BANDS.map((band) => (
                  <SelectItem key={band.value} value={String(band.value)}>
                    {band.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" size="sm" className="h-9" disabled={pending}>
            Apply
          </Button>
          {mode === "app" ? (
            <p className="text-xs text-ink-4 sm:col-span-4">
              Your organization profile tunes every search.{" "}
              <Link href="/app/settings/organization" className="underline hover:text-foreground">
                Edit the profile
              </Link>{" "}
              to change it for good.
            </p>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}
