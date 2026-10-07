"use client";

import { Bookmark, Landmark, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";

export function ToastDemo() {
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() => toast("Saved to your pipeline", { description: "Oregon Community Foundation" })}
      >
        Toast
      </Button>
      <Button variant="outline" size="sm" onClick={() => toast.success("Export ready", { description: "24 funders, CSV" })}>
        Success
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => toast.warning("Usage at 90%", { description: "AI lookups renew Nov 1" })}
      >
        Warning
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => toast.error("Could not reach the database", { description: "Retry in a moment" })}
      >
        Error
      </Button>
    </div>
  );
}

/**
 * Inline command palette. The value is held empty on mount so cmdk does not
 * select the first item and scroll the whole page to it; typing or arrowing
 * selects as usual.
 */
export function CommandDemo() {
  return (
    <Command className="rounded-lg border shadow-card" value="" onValueChange={() => {}}>
      <CommandInput placeholder="Search funders, pages, actions…" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        <CommandGroup heading="Funders">
          <CommandItem>
            <Landmark />
            Oregon Community Foundation
          </CommandItem>
          <CommandItem>
            <Landmark />
            Meyer Memorial Trust
          </CommandItem>
        </CommandGroup>
        <CommandGroup heading="Actions">
          <CommandItem>
            <Bookmark />
            Save current search
            <CommandShortcut>⌘S</CommandShortcut>
          </CommandItem>
          <CommandItem>
            <Sparkles />
            Suggest similar funders
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  );
}
