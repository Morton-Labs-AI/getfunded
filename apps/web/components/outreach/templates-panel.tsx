"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { deleteTemplateAction, saveTemplateAction } from "@/app/(app)/app/outreach/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { BUILT_IN_TEMPLATES, MERGE_FIELDS, MERGE_FIELD_HELP } from "@/lib/outreach/templates";

export type PanelTemplate = { id: string; name: string; subject: string; body: string; version: number };

type Form = { id?: string; version?: number; name: string; subject: string; body: string };
const EMPTY: Form = { name: "", subject: "", body: "" };

/** Workspace templates (knowledge kind 'boilerplate'): list, write, edit, delete (admins). */
export function TemplatesPanel({ templates, isAdmin }: { templates: PanelTemplate[]; isAdmin: boolean }) {
  const router = useRouter();
  const [form, setForm] = React.useState<Form | null>(null);
  const [pending, startTransition] = React.useTransition();
  const [deleting, setDeleting] = React.useState<string | null>(null);
  const id = React.useId();

  function save() {
    if (!form) return;
    startTransition(async () => {
      const result = await saveTemplateAction(form);
      if (!result.ok) return void toast.error("Could not save the template", { description: result.error });
      toast.success("Template saved");
      setForm(null);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your templates</CardTitle>
        <CardDescription>
          The three built-in templates ({BUILT_IN_TEMPLATES.map((t) => t.name.toLowerCase()).join(", ")}) are always available. Save your own here. Fields in double braces are filled in when you write a message.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {templates.length === 0 && !form ? <p className="text-sm text-ink-3">No workspace templates yet.</p> : null}
        <ul className="flex flex-col gap-2">
          {templates.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="font-medium">{t.name}</span>
                {t.subject ? <span className="ml-2 text-ink-3">{t.subject}</span> : null}
              </span>
              <span className="flex gap-1">
                <Button size="icon-sm" variant="ghost" aria-label={`Edit ${t.name}`} onClick={() => setForm({ id: t.id, version: t.version, name: t.name, subject: t.subject, body: t.body })}>
                  <Pencil />
                </Button>
                {isAdmin ? (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Delete ${t.name}`}
                    disabled={deleting !== null}
                    onClick={async () => {
                      if (!window.confirm(`Delete the template "${t.name}"?`)) return;
                      setDeleting(t.id);
                      try {
                        const result = await deleteTemplateAction({ id: t.id });
                        if (!result.ok) return void toast.error("Could not delete", { description: result.error });
                        toast.success("Template deleted");
                        router.refresh();
                      } finally {
                        setDeleting(null);
                      }
                    }}
                  >
                    {deleting === t.id ? <Loader2 className="animate-spin" /> : <Trash2 />}
                  </Button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>

        {form ? (
          <div className="flex flex-col gap-3 rounded-lg border bg-inset/50 p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-name`}>Name</Label>
                <Input id={`${id}-name`} value={form.name} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-subject`}>Subject line</Label>
                <Input id={`${id}-subject`} value={form.subject} maxLength={300} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-body`}>Text</Label>
              <Textarea id={`${id}-body`} value={form.body} rows={10} className="min-h-48 font-sans" onChange={(e) => setForm({ ...form, body: e.target.value })} />
            </div>
            <details className="text-xs text-ink-3">
              <summary className="cursor-pointer">Fields you can use</summary>
              <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                {MERGE_FIELDS.map((f) => (
                  <li key={f}>
                    <code className="text-ink-2">{`{{${f}}}`}</code> — {MERGE_FIELD_HELP[f]}
                  </li>
                ))}
              </ul>
            </details>
            <div className="flex gap-2">
              <Button size="sm" onClick={save} disabled={pending || !form.name.trim() || !form.body.trim()}>
                {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                Save template
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setForm(null)} disabled={pending}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="outline" className="w-fit" onClick={() => setForm(EMPTY)}>
            <Plus aria-hidden />
            New template
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
