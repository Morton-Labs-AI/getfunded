"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, Ellipsis, Info, LoaderCircle } from "lucide-react";
import { toast } from "sonner";

import { Missing } from "@/components/data/missing";
import { Money } from "@/components/data/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatEin } from "@/lib/format";
import {
  addToCollectionAction,
  archiveSavedFunderAction,
  bulkMoveStageAction,
  bulkUpdateSavedAction,
  createCollectionAction,
  moveStageAction,
  updateSavedFunderAction,
} from "@/lib/workspace/actions";
import { WORKSPACE_COPY } from "@/lib/workspace/copy";
import type { SavedPatch } from "@/lib/workspace/saved";
import { STAGES, STAGE_LABELS, TIERS, TIER_LABELS, type Stage } from "@/lib/workspace/stages";
import type { Collection, Member, SavedFunder, Tier } from "@/lib/workspace/types";
import { cn } from "@/lib/utils";

import { NativeSelect } from "./native-select";

/**
 * The working list: the spreadsheet replacement. Every cell edit is a
 * compare-and-swap on the row's `version`; a stale edit is refused with a
 * toast and the page reloads with the latest version. The rows are props
 * from the server (actions revalidate), so what you see is what is stored.
 */

type Patch = SavedPatch;

/** After this many days without contact a row says "quiet" in words, not only in colour. */
export const QUIET_AFTER_DAYS = 30;

function daysAgo(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

export function SavedTable({
  rows,
  members,
  collections,
  currentUserId,
}: {
  rows: SavedFunder[];
  members: Member[];
  collections: Collection[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set());
  const [pendingIds, setPendingIds] = React.useState<Set<string>>(() => new Set());
  const [, startTransition] = React.useTransition();

  const visibleIds = React.useMemo(() => new Set(rows.map((r) => r.id)), [rows]);
  const selectedVisible = [...selected].filter((id) => visibleIds.has(id));
  const allSelected = rows.length > 0 && selectedVisible.length === rows.length;

  function markPending(id: string, on: boolean) {
    setPendingIds((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function handle(result: { ok: boolean; code?: string; message?: string }) {
    if (result.ok) return;
    if (result.code === "stale") {
      toast.warning("Changed somewhere else", { description: result.message });
      router.refresh();
      return;
    }
    toast.error("Could not save", { description: result.message });
  }

  function patch(row: SavedFunder, p: Patch) {
    markPending(row.id, true);
    startTransition(async () => {
      try {
        handle(await updateSavedFunderAction({ id: row.id, version: row.version, patch: p }));
      } finally {
        markPending(row.id, false);
      }
    });
  }

  function move(row: SavedFunder, stage: Stage) {
    if (stage === row.stage) return;
    markPending(row.id, true);
    startTransition(async () => {
      try {
        handle(await moveStageAction({ id: row.id, stage, expectedVersion: row.version }));
      } finally {
        markPending(row.id, false);
      }
    });
  }

  function archive(row: SavedFunder) {
    if (!window.confirm(`Archive ${row.snapshot.name}? It leaves the list and the board. Saving it again restores it, with its history.`)) return;
    markPending(row.id, true);
    startTransition(async () => {
      try {
        const r = await archiveSavedFunderAction({ id: row.id, version: row.version });
        handle(r);
        if (r.ok) toast.success("Archived", { description: row.snapshot.name });
      } finally {
        markPending(row.id, false);
      }
    });
  }

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {selectedVisible.length > 0 ? (
        <BulkBar
          ids={selectedVisible}
          members={members}
          collections={collections}
          onDone={() => setSelected(new Set())}
        />
      ) : null}

      <div className="rounded-lg border bg-card shadow-card">
        <Table className="min-w-[1180px]">
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 z-10 w-10 bg-card">
                <Checkbox
                  aria-label="Select all funders on this page"
                  checked={allSelected ? true : selectedVisible.length > 0 ? "indeterminate" : false}
                  onCheckedChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
                />
              </TableHead>
              <TableHead className="sticky left-10 z-10 min-w-[16rem] bg-card shadow-[1px_0_0_0_var(--border)]">Funder</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead>Tier</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead className="text-right">Planned ask</TableHead>
              <TableHead>Next action</TableHead>
              <TableHead>Due</TableHead>
              <TableHead>Last contact</TableHead>
              <TableHead className="w-10">
                <span className="sr-only">Row actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const busy = pendingIds.has(row.id);
              const quiet = daysAgo(row.lastTouchAt);
              const key = `${row.id}:${row.version}`;
              return (
                <TableRow key={row.id} data-state={selected.has(row.id) ? "selected" : undefined} className={cn("align-top", busy && "opacity-70")}>
                  <TableCell className="sticky left-0 z-10 bg-card">
                    <Checkbox
                      aria-label={`Select ${row.snapshot.name}`}
                      checked={selected.has(row.id)}
                      onCheckedChange={() => toggle(row.id)}
                    />
                  </TableCell>
                  <TableCell className="sticky left-10 z-10 max-w-[20rem] bg-card whitespace-normal shadow-[1px_0_0_0_var(--border)]">
                    <div className="flex items-start gap-1.5">
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/app/funders/${row.orgId}`}
                          className="block truncate text-sm font-medium text-foreground hover:text-primary hover:underline"
                          title={row.snapshot.name}
                        >
                          {row.snapshot.name}
                        </Link>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-3">
                          <span>{[row.snapshot.city, row.snapshot.state].filter(Boolean).join(", ") || <Missing bare />}</span>
                          {row.snapshot.ein ? <span className="tnum font-mono">{formatEin(row.snapshot.ein)}</span> : null}
                          {row.openTasks > 0 ? (
                            <span className="tnum">
                              {row.openTasks} open {row.openTasks === 1 ? "task" : "tasks"}
                            </span>
                          ) : null}
                        </div>
                        {row.tags.length > 0 ? (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {row.tags.slice(0, 4).map((t) => (
                              <Badge key={t} variant="secondary" className="px-1.5 text-[10px]">
                                {t}
                              </Badge>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      <WhyOnList detail={row.sourceDetail} name={row.snapshot.name} />
                    </div>
                  </TableCell>
                  <TableCell>
                    <NativeSelect
                      aria-label={`Stage for ${row.snapshot.name}`}
                      className="w-[11rem]"
                      value={row.stage}
                      disabled={busy}
                      onChange={(e) => move(row, e.target.value as Stage)}
                    >
                      {STAGES.map((s) => (
                        <option key={s} value={s}>
                          {STAGE_LABELS[s]}
                        </option>
                      ))}
                    </NativeSelect>
                  </TableCell>
                  <TableCell>
                    <NativeSelect
                      aria-label={`Tier for ${row.snapshot.name}`}
                      className="w-[6.5rem]"
                      value={row.tier ?? ""}
                      disabled={busy}
                      onChange={(e) => patch(row, { tier: e.target.value ? (Number(e.target.value) as Tier) : null })}
                    >
                      <option value="">Not set</option>
                      {TIERS.map((t) => (
                        <option key={t} value={t}>
                          {TIER_LABELS[t]}
                        </option>
                      ))}
                    </NativeSelect>
                  </TableCell>
                  <TableCell>
                    <NativeSelect
                      aria-label={`Owner for ${row.snapshot.name}`}
                      className="w-[9rem]"
                      value={row.ownerId ?? ""}
                      disabled={busy}
                      onChange={(e) => patch(row, { ownerId: e.target.value || null })}
                    >
                      <option value="">Nobody yet</option>
                      {members.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.id === currentUserId ? `${m.name} (me)` : m.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </TableCell>
                  <TableCell className="text-right">
                    <Input
                      key={`ask:${key}`}
                      aria-label={`Planned ask for ${row.snapshot.name}`}
                      className="tnum h-8 w-[7.5rem] text-right font-mono text-[13px]"
                      defaultValue={row.askAmount === null ? "" : String(row.askAmount)}
                      placeholder="Not set"
                      inputMode="numeric"
                      disabled={busy}
                      onBlur={(e) => {
                        const raw = e.target.value.replace(/[^0-9.]/g, "");
                        const value = raw === "" ? null : Math.round(Number(raw));
                        if (value !== null && !Number.isFinite(value)) return;
                        if (value !== row.askAmount) patch(row, { askAmount: value });
                      }}
                    />
                    {row.askAmount !== null ? (
                      <div className="mt-0.5 text-[11px] text-ink-3">
                        <Money value={row.askAmount} compact mono={false} />
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Input
                      key={`next:${key}`}
                      aria-label={`Next action for ${row.snapshot.name}`}
                      className="h-8 w-[12rem] text-[13px]"
                      defaultValue={row.nextAction ?? ""}
                      placeholder="What happens next?"
                      maxLength={500}
                      disabled={busy}
                      onBlur={(e) => {
                        const value = e.target.value.trim() || null;
                        if (value !== (row.nextAction ?? null)) patch(row, { nextAction: value });
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      key={`due:${key}`}
                      type="date"
                      aria-label={`Next action due date for ${row.snapshot.name}`}
                      className="tnum h-8 w-[9.5rem] text-[13px]"
                      defaultValue={row.nextActionDue ?? ""}
                      disabled={busy}
                      onBlur={(e) => {
                        const value = e.target.value || null;
                        if (value !== (row.nextActionDue ?? null)) patch(row, { nextActionDue: value });
                      }}
                    />
                  </TableCell>
                  <TableCell className="text-sm">
                    {row.lastTouchAt ? (
                      <span
                        className={cn("tnum", quiet !== null && quiet >= QUIET_AFTER_DAYS ? "font-medium text-warning" : "text-ink-2")}
                        title={`Last contact ${formatDate(row.lastTouchAt, "long")}${quiet !== null && quiet >= QUIET_AFTER_DAYS ? `. No contact in ${QUIET_AFTER_DAYS} days.` : ""}`}
                      >
                        {quiet === 0 ? "Today" : `${quiet}d ago`}
                        {quiet !== null && quiet >= QUIET_AFTER_DAYS ? " · quiet" : ""}
                      </span>
                    ) : (
                      <span className="text-ink-3">Never</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${row.snapshot.name}`} disabled={busy}>
                          {busy ? <LoaderCircle className="animate-spin" /> : <Ellipsis />}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <Link href={`/app/funders/${row.orgId}`}>Open funder</Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem variant="destructive" onSelect={() => archive(row)}>
                          <Archive />
                          Archive
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/** "Why on list": the source_detail recorded at save or import time. */
function WhyOnList({ detail, name }: { detail: string | null; name: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="mt-0.5 shrink-0 rounded-sm text-ink-4 hover:text-foreground"
          aria-label={`Why ${name} is on the list`}
          title={WORKSPACE_COPY.saved.whyOnList}
        >
          <Info className="size-3.5" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 text-sm">
        <p className="eyebrow mb-1 text-yours">{WORKSPACE_COPY.saved.whyOnList}</p>
        <p className="text-ink-2">{detail ?? WORKSPACE_COPY.saved.whyOnListMissing}</p>
      </PopoverContent>
    </Popover>
  );
}

/** A visible label over one bulk control. */
function BulkField({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex flex-col gap-0.5">
      <label htmlFor={id} className="text-[11px] font-medium text-ink-3">
        {label}
      </label>
      {children}
    </span>
  );
}

/** Bulk actions for the selected rows: set stage, tier or owner, or add to a list. */
function BulkBar({
  ids,
  members,
  collections,
  onDone,
}: {
  ids: string[];
  members: Member[];
  collections: Collection[];
  onDone: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [stage, setStage] = React.useState("");
  const [tier, setTier] = React.useState("");
  const [owner, setOwner] = React.useState("");
  const [list, setList] = React.useState("");
  const [newList, setNewList] = React.useState("");
  const baseId = React.useId();
  const id = (name: string) => `${baseId}-${name}`;

  const dirty = Boolean(stage || tier || owner || list || newList.trim());

  function apply() {
    startTransition(async () => {
      let touched = 0;
      if (stage) {
        const r = await bulkMoveStageAction({ ids, stage: stage as Stage });
        if (!r.ok) {
          toast.error("Could not move", { description: r.message });
          return;
        }
        touched += r.moved;
        if (r.failed > 0) toast.warning(`${r.failed} ${r.failed === 1 ? "funder" : "funders"} could not be moved`);
      }
      if (tier || owner) {
        const patch: { tier?: Tier | null; ownerId?: string | null } = {};
        if (tier) patch.tier = tier === "none" ? null : (Number(tier) as Tier);
        if (owner) patch.ownerId = owner === "none" ? null : owner;
        const r = await bulkUpdateSavedAction({ ids, patch });
        if (!r.ok) {
          toast.error("Could not update", { description: r.message });
          return;
        }
        touched += r.updated;
      }
      if (newList.trim()) {
        const r = await createCollectionAction({ name: newList.trim(), savedFunderIds: ids });
        if (!r.ok) {
          toast.error("Could not make the list", {
            description: r.message,
            action: r.code === "limit_reached" ? { label: "See plans", onClick: () => router.push(r.upgradeUrl) } : undefined,
          });
          return;
        }
        touched += ids.length;
      } else if (list) {
        const r = await addToCollectionAction({ collectionId: list, savedFunderIds: ids });
        if (!r.ok) {
          toast.error("Could not add to the list", { description: r.message });
          return;
        }
        touched += r.added;
      }
      toast.success(`Updated ${ids.length} ${ids.length === 1 ? "funder" : "funders"}`);
      void touched;
      onDone();
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-yours-border bg-yours-tint px-3 py-2" role="region" aria-label="Bulk actions">
      <span className="self-center text-sm font-medium text-yours">{ids.length} selected</span>
      <BulkField id={id("stage")} label="Set stage">
      <NativeSelect id={id("stage")} className="w-[10rem]" value={stage} onChange={(e) => setStage(e.target.value)}>
        <option value="">Keep as is</option>
        {STAGES.map((s) => (
          <option key={s} value={s}>
            {STAGE_LABELS[s]}
          </option>
        ))}
      </NativeSelect>
      </BulkField>
      <BulkField id={id("tier")} label="Set tier">
      <NativeSelect id={id("tier")} className="w-[7rem]" value={tier} onChange={(e) => setTier(e.target.value)}>
        <option value="">Keep as is</option>
        {TIERS.map((t) => (
          <option key={t} value={t}>
            {TIER_LABELS[t]}
          </option>
        ))}
        <option value="none">Clear tier</option>
      </NativeSelect>
      </BulkField>
      <BulkField id={id("owner")} label="Set owner">
      <NativeSelect id={id("owner")} className="w-[9rem]" value={owner} onChange={(e) => setOwner(e.target.value)}>
        <option value="">Keep as is</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
        <option value="none">Clear owner</option>
      </NativeSelect>
      </BulkField>
      <span className="inline-flex items-end gap-2">
        {collections.length > 0 ? (
          <BulkField id={id("list")} label="Add to list">
          <NativeSelect id={id("list")} className="w-[9rem]" value={list} onChange={(e) => setList(e.target.value)}>
            <option value="">None</option>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
          </BulkField>
        ) : null}
        <BulkField id={id("newList")} label="New list">
        <Input
          id={id("newList")}
          className="h-8 w-[10rem] text-[13px]"
          placeholder="Name it"
          value={newList}
          maxLength={120}
          onChange={(e) => setNewList(e.target.value)}
        />
        </BulkField>
      </span>
      <Button size="sm" onClick={apply} disabled={pending || !dirty}>
        {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
        Apply
      </Button>
      <Button size="sm" variant="ghost" onClick={onDone} disabled={pending}>
        Clear selection
      </Button>
    </div>
  );
}
