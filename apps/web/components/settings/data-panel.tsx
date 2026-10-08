"use client";

import * as React from "react";
import { useActionState, useId } from "react";
import { AlertTriangle, Download, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { deleteWorkspaceAction, type ActionState } from "@/lib/settings/actions";

import { FormNotice } from "./form-notice";
import { Notice } from "./settings-section";

const INITIAL: ActionState = { ok: false };

export const EXPORT_PATH = "/app/settings/data/export";

function ExportCard({ canExport, counts }: { canExport: boolean; counts: { saved_funders: number; tasks: number; activities: number } }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Export your workspace</CardTitle>
        <CardDescription>
          A ZIP of JSON files: your saved funders with stage and notes, tasks, activities and stage history, plus the
          organization profile and member list. Readable without GetFunded.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="tnum text-sm text-ink-2">
          {counts.saved_funders.toLocaleString("en-US")} saved funders · {counts.tasks.toLocaleString("en-US")} tasks ·{" "}
          {counts.activities.toLocaleString("en-US")} activities
        </p>
        {canExport ? (
          <div>
            <Button asChild>
              <a href={EXPORT_PATH} download>
                <Download aria-hidden />
                Download ZIP
              </a>
            </Button>
          </div>
        ) : (
          <p className="text-xs text-ink-3">Only a workspace owner or admin can export the workspace.</p>
        )}
        <p className="text-xs text-ink-3">
          Public filing data is not included; it is public and re-fetchable. Anything marked AI in the export was
          machine-suggested, never a fact.
        </p>
      </CardContent>
    </Card>
  );
}

function DeleteWorkspaceDialog({ workspace }: { workspace: { id: string; name: string; version: number } }) {
  const [state, formAction, pending] = useActionState(deleteWorkspaceAction, INITIAL);
  const [typed, setTyped] = React.useState("");
  const id = useId();
  const matches = typed.trim().toLowerCase() === workspace.name.trim().toLowerCase();
  const errors = state.fieldErrors ?? {};

  return (
    <Dialog onOpenChange={(open) => !open && setTyped("")}>
      <DialogTrigger asChild>
        <Button type="button" variant="destructive">
          <Trash2 aria-hidden />
          Delete workspace
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form action={formAction} className="flex flex-col gap-4" noValidate>
          <input type="hidden" name="workspace_id" value={workspace.id} />
          <input type="hidden" name="version" value={workspace.version} />
          <DialogHeader>
            <DialogTitle>Delete &ldquo;{workspace.name}&rdquo;?</DialogTitle>
            <DialogDescription>
              Every member loses access at once. Saved funders, pipeline, tasks, notes and API keys stop being reachable.
              Export first if you want a copy.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={id}>
              Type <span className="font-mono">{workspace.name}</span> to confirm
            </Label>
            <Input
              id={id}
              name="confirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={errors.confirm ? true : undefined}
            />
            {errors.confirm ? <p className="text-sm text-danger">{errors.confirm}</p> : null}
          </div>
          <FormNotice state={state} />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Keep workspace
              </Button>
            </DialogClose>
            <Button type="submit" variant="destructive" disabled={!matches || pending}>
              {pending ? "Deleting…" : "Delete workspace"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DataPanel({
  workspace,
  canExport,
  canDelete,
  counts,
}: {
  workspace: { id: string; name: string; version: number };
  canExport: boolean;
  canDelete: boolean;
  counts: { saved_funders: number; tasks: number; activities: number };
}) {
  return (
    <div className="flex flex-col gap-5">
      <ExportCard canExport={canExport} counts={counts} />
      <Card className="border-danger/30">
        <CardHeader>
          <CardTitle as="h2" className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-danger" aria-hidden />
            Delete this workspace
          </CardTitle>
          <CardDescription>
            The workspace is hidden from everyone right away. Nothing in it can be reached again, so export first if you
            want a copy. Only the owner can do this.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {canDelete ? (
            <DeleteWorkspaceDialog workspace={workspace} />
          ) : (
            <Notice tone="info">Only the workspace owner can delete it. You can leave the workspace from Settings → Members.</Notice>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
