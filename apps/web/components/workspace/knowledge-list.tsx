"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, Plus, Trash } from "lucide-react";
import { toast } from "sonner";

import { YoursTag } from "@/components/data/yours-tag";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/format";
import { createKnowledgeAction, deleteKnowledgeAction, setKnowledgeApprovedAction } from "@/lib/workspace/actions";
import { KNOWLEDGE_KINDS, type KnowledgeItem, type KnowledgeKind } from "@/lib/workspace/types";
import { cn } from "@/lib/utils";

import { NativeSelect } from "./native-select";

export const KIND_LABELS: Record<KnowledgeKind, string> = {
  fact: "Fact",
  program: "Program",
  outcome: "Outcome",
  boilerplate: "Boilerplate",
};

const KIND_HINTS: Record<KnowledgeKind, string> = {
  fact: "A true statement about your organization. \"Founded in 2004. Serves three counties.\"",
  program: "What a program does and for whom.",
  outcome: "A result you can stand behind, with the year.",
  boilerplate: "Approved wording you reuse in letters and proposals.",
};

/**
 * Knowledge items with the approval switch. Only admins see the switch and
 * the remove button; everyone can add a draft. Only approved items ever reach
 * a prompt, and the list says so.
 */
export function KnowledgeList({ items, isAdmin }: { items: KnowledgeItem[]; isAdmin: boolean }) {
  const router = useRouter();
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [, startTransition] = React.useTransition();

  function approve(item: KnowledgeItem, approved: boolean) {
    setPendingId(item.id);
    startTransition(async () => {
      try {
        const r = await setKnowledgeApprovedAction({ id: item.id, version: item.version, approved });
        if (!r.ok) {
          toast.error("Could not change that", { description: r.message });
          if (r.code === "stale") router.refresh();
          return;
        }
        toast.success(approved ? "Approved. The AI may use it now." : "Approval removed.");
      } finally {
        setPendingId(null);
      }
    });
  }

  function remove(item: KnowledgeItem) {
    if (!window.confirm(`Remove "${item.title}"?`)) return;
    setPendingId(item.id);
    startTransition(async () => {
      try {
        const r = await deleteKnowledgeAction({ id: item.id });
        if (!r.ok) toast.error("Could not remove", { description: r.message });
      } finally {
        setPendingId(null);
      }
    });
  }

  const groups = KNOWLEDGE_KINDS.map((kind) => ({ kind, items: items.filter((i) => i.kind === kind) })).filter((g) => g.items.length > 0);

  return (
    <div className="flex flex-col gap-6">
      {groups.map((g) => (
        <section key={g.kind}>
          <h2 className="eyebrow mb-2 text-muted-foreground">{KIND_LABELS[g.kind]}</h2>
          <ul className="divide-y rounded-lg border bg-card shadow-card">
            {g.items.map((item) => {
              const busy = pendingId === item.id;
              return (
                <li key={item.id} className={cn("flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start", busy && "opacity-70")}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-foreground">{item.title}</h3>
                      <YoursTag />
                      {item.approved ? (
                        <Badge variant="success">
                          <BadgeCheck aria-hidden />
                          Approved
                        </Badge>
                      ) : (
                        <Badge variant="outline">Draft, not used</Badge>
                      )}
                    </div>
                    <p className="mt-1 text-sm whitespace-pre-wrap text-ink-2">{item.body}</p>
                    <p className="tnum mt-1 text-xs text-ink-3">
                      {item.approved && item.approvedByName
                        ? `Approved by ${item.approvedByName} on ${formatDate(item.approvedAt)}`
                        : `Added${item.createdByName ? ` by ${item.createdByName}` : ""} on ${formatDate(item.createdAt)}`}
                    </p>
                  </div>
                  {isAdmin ? (
                    <div className="flex shrink-0 items-center gap-3">
                      <label className="flex items-center gap-2 text-xs text-ink-2">
                        <Switch checked={item.approved} disabled={busy} onCheckedChange={(v) => approve(item, v)} aria-label={`Approve ${item.title}`} />
                        Approved
                      </label>
                      <Button variant="ghost" size="icon-sm" aria-label={`Remove ${item.title}`} disabled={busy} onClick={() => remove(item)}>
                        <Trash />
                      </Button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function KnowledgeDialog() {
  const [open, setOpen] = React.useState(false);
  const [kind, setKind] = React.useState<KnowledgeKind>("fact");
  const [pending, startTransition] = React.useTransition();
  const ids = { kind: React.useId(), title: React.useId(), body: React.useId() };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus aria-hidden />
          Add
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add to your knowledge</DialogTitle>
          <DialogDescription>It starts as a draft. An admin approves it before the AI may use it.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            startTransition(async () => {
              const r = await createKnowledgeAction({
                kind,
                title: String(fd.get("title") ?? ""),
                body: String(fd.get("body") ?? ""),
              });
              if (!r.ok) {
                toast.error("Could not add that", { description: r.message });
                return;
              }
              toast.success("Added as a draft");
              setOpen(false);
            });
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={ids.kind}>Kind</Label>
            <NativeSelect id={ids.kind} size="default" value={kind} onChange={(e) => setKind(e.target.value as KnowledgeKind)}>
              {KNOWLEDGE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </NativeSelect>
            <p className="text-xs text-ink-3">{KIND_HINTS[kind]}</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={ids.title}>Title</Label>
            <Input id={ids.title} name="title" required maxLength={200} placeholder="Meals served in 2025" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={ids.body}>The item itself</Label>
            <Textarea id={ids.body} name="body" required maxLength={8000} rows={4} placeholder="In 2025 we served 212,000 meals across three counties (audited annual report, p. 4)." />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? "Adding…" : "Add draft"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
