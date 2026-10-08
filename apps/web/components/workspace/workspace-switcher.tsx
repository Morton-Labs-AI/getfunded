"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronsUpDown } from "lucide-react";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type SwitcherWorkspace = { id: string; name: string; slug: string; role: string };

/**
 * Shown in the top bar when the person belongs to more than one workspace.
 * `switchAction` is the server action from lib/workspace/context.ts; it
 * re-checks membership before setting the cookie.
 */
export function WorkspaceSwitcher({
  workspaces,
  activeId,
  switchAction,
}: {
  workspaces: SwitcherWorkspace[];
  activeId: string;
  switchAction: (workspaceId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const active = workspaces.find((w) => w.id === activeId);

  function choose(id: string) {
    if (id === activeId) return;
    startTransition(async () => {
      const result = await switchAction(id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      router.push("/app");
      router.refresh();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={pending}
          className="inline-flex max-w-56 items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-foreground outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60"
          aria-label={`Workspace: ${active?.name ?? "choose"}. Switch workspace`}
        >
          <span className="truncate">{active?.name ?? "Workspace"}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-ink-3" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Switch workspace</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {workspaces.map((w) => (
          <DropdownMenuItem key={w.id} onSelect={() => choose(w.id)} className={cn(w.id === activeId && "font-medium")}>
            <span className="flex size-4 items-center justify-center">{w.id === activeId ? <Check className="size-4" /> : null}</span>
            <span className="truncate">{w.name}</span>
            <span className="ml-auto text-xs capitalize text-muted-foreground">{w.role}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
