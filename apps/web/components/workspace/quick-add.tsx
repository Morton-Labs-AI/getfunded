"use client";

import * as React from "react";
import Link from "next/link";
import { BookOpen, Plus, Search, SquareCheck, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Member } from "@/lib/workspace/types";

import { TaskDialog } from "./task-dialog";

/** The dashboard's "Quick add": a task now, or a jump to the place that adds the rest. */
export function QuickAdd({ members, currentUserId }: { members: Member[]; currentUserId: string }) {
  const [taskOpen, setTaskOpen] = React.useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button>
            <Plus aria-hidden />
            Quick add
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Add</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => setTaskOpen(true)}>
            <SquareCheck />
            New task
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/app/search">
              <Search />
              Find and save a funder
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/app/import">
              <Upload />
              Import a spreadsheet
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/app/knowledge">
              <BookOpen />
              Add a fact about your work
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <TaskDialog members={members} currentUserId={currentUserId} trigger={null} open={taskOpen} onOpenChange={setTaskOpen} />
    </>
  );
}
