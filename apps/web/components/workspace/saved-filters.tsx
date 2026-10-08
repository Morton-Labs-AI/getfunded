"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, LoaderCircle, Search, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { exportSavedCsvAction } from "@/lib/workspace/actions";
import { hasFilters, savedFiltersToQuery } from "@/lib/workspace/filters";
import { STAGES, STAGE_LABELS, TIERS, TIER_LABELS } from "@/lib/workspace/stages";
import type { Collection, Member, SavedFilters } from "@/lib/workspace/types";
import { cn } from "@/lib/utils";

import { NativeSelect } from "./native-select";

export { hasFilters, savedFiltersToQuery };

/** A visible label over one control. */
function Field({ id, label, className, children }: { id: string; label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <Label htmlFor={id} className="text-xs font-medium text-ink-3">
        {label}
      </Label>
      {children}
    </div>
  );
}

/**
 * URL-driven filters for the saved list and the pipeline board, so a filtered
 * view is a link a person can send ("Dana's Tier 1 funders at Cultivating").
 * The parser and serializer live in lib/workspace/filters.ts so the server
 * pages and this client bar agree on the query keys.
 */
export function SavedFiltersBar({
  base,
  current,
  members,
  collections,
  showSort = true,
  showExport = false,
  exportLimit,
}: {
  base: "/app/saved" | "/app/pipeline";
  current: SavedFilters;
  members: Member[];
  collections: Collection[];
  showSort?: boolean;
  showExport?: boolean;
  /** Plan export cap for the hint; null = unlimited. */
  exportLimit?: number | null;
}) {
  const router = useRouter();
  const [text, setText] = React.useState(current.q ?? "");
  const [exporting, startExport] = React.useTransition();
  const baseId = React.useId();
  const id = (name: string) => `${baseId}-${name}`;

  function push(patch: Partial<SavedFilters>) {
    router.push(`${base}${savedFiltersToQuery({ ...current, ...patch })}`);
  }

  function exportCsv() {
    startExport(async () => {
      const result = await exportSavedCsvAction({
        q: current.q,
        stage: current.stage,
        ownerId: current.ownerId,
        tier: current.tier,
        collectionId: current.collectionId,
      });
      if (!result.ok) {
        toast.error("Export did not run", {
          description: result.message,
          action: result.upgradeUrl
            ? {
                label: "See plans",
                onClick: () => router.push(result.upgradeUrl!),
              }
            : undefined,
        });
        return;
      }
      const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      if (result.truncated) {
        toast.warning(`Exported the first ${result.rows} of ${result.total} funders`, {
          description: `Your plan exports ${result.limit} rows at a time.`,
          action: {
            label: "See plans",
            onClick: () => router.push("/app/settings/billing"),
          },
        });
      } else {
        toast.success(`Exported ${result.rows} ${result.rows === 1 ? "funder" : "funders"}`);
      }
    });
  }

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        push({ q: text.trim() || undefined });
      }}
      role="search"
      aria-label="Filter your funders"
    >
      <Field id={id("q")} label="Search" className="w-full sm:w-64">
        <div className="relative w-full">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-4" aria-hidden />
          <input
            id={id("q")}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Name, EIN, note, tag…"
            className="h-9 w-full rounded-md border border-input bg-surface pr-8 pl-8 text-sm text-foreground shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
          />
          {text ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setText("");
                push({ q: undefined });
              }}
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded-sm text-ink-4 hover:text-foreground"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          ) : null}
        </div>
      </Field>

      <Field id={id("stage")} label="Stage">
        <NativeSelect
          id={id("stage")}
          size="default"
          className="w-[11rem]"
          value={current.stage ?? ""}
          onChange={(e) =>
            push({
              stage: (e.target.value || undefined) as SavedFilters["stage"],
            })
          }
        >
          <option value="">Any stage</option>
          {STAGES.map((s) => (
            <option key={s} value={s}>
              {STAGE_LABELS[s]}
            </option>
          ))}
        </NativeSelect>
      </Field>

      <Field id={id("owner")} label="Owner">
        <NativeSelect
          id={id("owner")}
          size="default"
          className="w-[10rem]"
          value={current.ownerId ?? ""}
          onChange={(e) => push({ ownerId: e.target.value || undefined })}
        >
          <option value="">Any owner</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </NativeSelect>
      </Field>

      <Field id={id("tier")} label="Tier">
        <NativeSelect
          id={id("tier")}
          size="default"
          className="w-[7rem]"
          value={current.tier ? String(current.tier) : ""}
          onChange={(e) =>
            push({
              tier: e.target.value ? (Number(e.target.value) as 1 | 2 | 3) : undefined,
            })
          }
        >
          <option value="">Any tier</option>
          {TIERS.map((t) => (
            <option key={t} value={t}>
              {TIER_LABELS[t]}
            </option>
          ))}
        </NativeSelect>
      </Field>

      {collections.length > 0 ? (
        <Field id={id("list")} label="List">
          <NativeSelect
            id={id("list")}
            size="default"
            className="w-[10rem]"
            value={current.collectionId ?? ""}
            onChange={(e) => push({ collectionId: e.target.value || undefined })}
          >
            <option value="">Any list</option>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
      ) : null}

      {showSort ? (
        <Field id={id("sort")} label="Sort by">
          <NativeSelect
            id={id("sort")}
            size="default"
            className="w-[10rem]"
            value={current.sort ?? "updated"}
            onChange={(e) => push({ sort: e.target.value as SavedFilters["sort"] })}
          >
            <option value="updated">Recently changed</option>
            <option value="name">Name</option>
            <option value="due">Next action due</option>
            <option value="ask">Planned ask</option>
          </NativeSelect>
        </Field>
      ) : null}

      {hasFilters(current) ? (
        <Button variant="ghost" size="sm" asChild>
          <Link href={base}>Clear</Link>
        </Button>
      ) : null}

      {showExport ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={exportCsv}
          disabled={exporting}
          title={exportLimit === null || exportLimit === undefined ? "Download this view as CSV" : `Download up to ${exportLimit} rows as CSV`}
        >
          {exporting ? <LoaderCircle className="animate-spin" aria-hidden /> : <Download aria-hidden />}
          Export CSV
        </Button>
      ) : null}
    </form>
  );
}
