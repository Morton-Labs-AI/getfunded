"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";

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
import { Textarea } from "@/components/ui/textarea";
import { createTaskAction } from "@/lib/workspace/actions";
import type { Member } from "@/lib/workspace/types";

import { NativeSelect } from "./native-select";

/**
 * New task. From a funder page the task is linked to that funder; from the
 * tasks page or the dashboard it is free-standing.
 */
export function TaskDialog({
  members,
  currentUserId,
  savedFunderId,
  funderName,
  defaultTitle,
  trigger,
  open: controlledOpen,
  onOpenChange,
}: {
  members: Member[];
  currentUserId: string;
  savedFunderId?: string | null;
  funderName?: string | null;
  defaultTitle?: string;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [innerOpen, setInnerOpen] = React.useState(false);
  const open = controlledOpen ?? innerOpen;
  const setOpen = onOpenChange ?? setInnerOpen;
  const [pending, startTransition] = React.useTransition();
  const ids = { title: React.useId(), details: React.useId(), due: React.useId(), who: React.useId() };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger !== null ? (
        <DialogTrigger asChild>
          {trigger ?? (
            <Button size="sm">
              <Plus aria-hidden />
              New task
            </Button>
          )}
        </DialogTrigger>
      ) : null}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
          <DialogDescription>
            {funderName ? `Linked to ${funderName}. It shows on their page and in your task list.` : "What needs doing, by whom, and by when."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            startTransition(async () => {
              const result = await createTaskAction({
                title: String(fd.get("title") ?? ""),
                details: String(fd.get("details") ?? "") || null,
                dueDate: String(fd.get("due") ?? "") || null,
                assigneeId: String(fd.get("assignee") ?? "") || null,
                savedFunderId: savedFunderId ?? null,
              });
              if (!result.ok) {
                toast.error("Could not add the task", { description: result.message });
                return;
              }
              toast.success("Task added");
              setOpen(false);
            });
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={ids.title}>Task</Label>
            <Input id={ids.title} name="title" required maxLength={200} defaultValue={defaultTitle} placeholder="Call the program officer about timing" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={ids.due}>Due date</Label>
              <Input id={ids.due} name="due" type="date" className="tnum" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={ids.who}>Assign to</Label>
              <NativeSelect id={ids.who} name="assignee" size="default" defaultValue={currentUserId}>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id === currentUserId ? `${m.name} (me)` : m.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={ids.details}>Details</Label>
            <Textarea id={ids.details} name="details" maxLength={5000} rows={3} placeholder="Anything the person doing this needs to know." />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? "Adding…" : "Add task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
