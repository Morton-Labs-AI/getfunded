"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FileCheck, Loader2, Pencil, Plus, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { copyFilingContactAction, createContactAction, deleteContactAction, updateContactAction } from "@/app/(app)/app/outreach/actions";
import { SourceChip } from "@/components/data/source-chip";
import { YoursTag } from "@/components/data/yours-tag";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FilingChannel } from "@/lib/outreach/contacts";
import { OUTREACH_COPY } from "@/lib/outreach/copy";

export type PanelContact = {
  id: string;
  fullName: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  source: string;
  sourceUrl: string | null;
  version: number;
};

type FormState = { fullName: string; title: string; email: string; phone: string };
const EMPTY: FormState = { fullName: "", title: "", email: "", phone: "" };

function ContactFields({ value, onChange, idPrefix }: { value: FormState; onChange: (v: FormState) => void; idPrefix: string }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <Label htmlFor={`${idPrefix}-name`}>Name or role</Label>
        <Input id={`${idPrefix}-name`} value={value.fullName} maxLength={200} placeholder="e.g. Jane Doe, or Grants Office" onChange={(e) => onChange({ ...value, fullName: e.target.value })} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-title`}>Title (optional)</Label>
        <Input id={`${idPrefix}-title`} value={value.title} maxLength={200} onChange={(e) => onChange({ ...value, title: e.target.value })} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-email`}>Email</Label>
        <Input id={`${idPrefix}-email`} type="email" value={value.email} maxLength={320} onChange={(e) => onChange({ ...value, email: e.target.value })} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-phone`}>Phone (optional)</Label>
        <Input id={`${idPrefix}-phone`} value={value.phone} maxLength={60} onChange={(e) => onChange({ ...value, phone: e.target.value })} />
      </div>
    </div>
  );
}

/**
 * Contacts for one saved funder: the workspace's own rows (Yours), plus the
 * role-based channels the funder listed in its public filing (Source) with a
 * one-click "Use this contact" that copies them in with their provenance.
 */
export function ContactsPanel({
  savedFunderId,
  funderName,
  contacts,
  channels,
  channelsNote,
}: {
  savedFunderId: string | null;
  funderName: string | null;
  contacts: PanelContact[];
  channels: FilingChannel[];
  /** Why the filing channels could not be read, when they could not. */
  channelsNote?: string | null;
}) {
  const router = useRouter();
  const baseId = React.useId();
  const [adding, setAdding] = React.useState(false);
  const [form, setForm] = React.useState<FormState>(EMPTY);
  const [editing, setEditing] = React.useState<PanelContact | null>(null);
  const [editForm, setEditForm] = React.useState<FormState>(EMPTY);
  const [busy, setBusy] = React.useState<string | null>(null);

  if (!savedFunderId) return null;

  async function add() {
    setBusy("add");
    try {
      const result = await createContactAction({ savedFunderId, ...form });
      if (!result.ok) return void toast.error("Could not add the contact", { description: result.error });
      toast.success("Contact added");
      setForm(EMPTY);
      setAdding(false);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function saveEdit() {
    if (!editing) return;
    setBusy(editing.id);
    try {
      const result = await updateContactAction({ id: editing.id, version: editing.version, ...editForm });
      if (!result.ok) return void toast.error("Could not save the contact", { description: result.error });
      toast.success("Contact saved");
      setEditing(null);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function remove(c: PanelContact) {
    if (!window.confirm(`Remove ${c.fullName} from this funder's contacts? Messages already written to them keep their copy.`)) return;
    setBusy(c.id);
    try {
      const result = await deleteContactAction({ id: c.id });
      if (!result.ok) return void toast.error("Could not remove the contact", { description: result.error });
      toast.success("Contact removed");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function applyChannel(ch: FilingChannel) {
    setBusy(ch.id);
    try {
      const result = await copyFilingContactAction({ savedFunderId, channelId: ch.id });
      if (!result.ok) return void toast.error("Could not copy the contact", { description: result.error });
      toast.success("Contact added from the filing", { description: "It is now in your contacts for this funder." });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const alreadyUsed = new Set(contacts.flatMap((c) => [c.email?.toLowerCase(), c.phone?.trim()].filter(Boolean) as string[]));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Contacts{funderName ? ` at ${funderName}` : ""}</CardTitle>
        <CardDescription>Your own contact rows for this funder, and what the funder listed in its public filing.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="eyebrow text-yours">Yours</h3>
            {!adding ? (
              <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
                <Plus aria-hidden />
                Add a contact
              </Button>
            ) : null}
          </div>
          {contacts.length === 0 && !adding ? <p className="text-sm text-ink-3">{OUTREACH_COPY.contacts.none}</p> : null}
          <ul className="flex flex-col gap-2">
            {contacts.map((c) => (
              <li key={c.id} className="data-yours flex flex-col gap-2 px-3 py-2.5">
                {editing?.id === c.id ? (
                  <div className="flex flex-col gap-3">
                    <ContactFields value={editForm} onChange={setEditForm} idPrefix={`${baseId}-edit`} />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => void saveEdit()} disabled={busy !== null}>
                        {busy === c.id ? <Loader2 className="animate-spin" aria-hidden /> : null}
                        Save
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{c.fullName}</span>
                        {c.source === "filing_part_xv" ? <SourceChip label="From filing" /> : <YoursTag>Added by you</YoursTag>}
                      </div>
                      {c.title ? <div className="text-ink-3">{c.title}</div> : null}
                      <div className="text-ink-2">{c.email ?? c.phone ?? <span className="text-ink-3">No email or phone yet</span>}</div>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Edit ${c.fullName}`}
                        onClick={() => {
                          setEditing(c);
                          setEditForm({ fullName: c.fullName, title: c.title ?? "", email: c.email ?? "", phone: c.phone ?? "" });
                        }}
                      >
                        <Pencil />
                      </Button>
                      <Button size="icon-sm" variant="ghost" aria-label={`Remove ${c.fullName}`} onClick={() => void remove(c)} disabled={busy !== null}>
                        <Trash2 />
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {adding ? (
            <div className="flex flex-col gap-3 rounded-lg border bg-inset/50 p-3">
              <ContactFields value={form} onChange={setForm} idPrefix={`${baseId}-add`} />
              <div className="flex gap-2">
                <Button size="sm" onClick={() => void add()} disabled={busy !== null || !form.fullName.trim()}>
                  {busy === "add" ? <Loader2 className="animate-spin" aria-hidden /> : <UserPlus aria-hidden />}
                  Add contact
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="eyebrow text-source">Listed in the funder&apos;s filing</h3>
          <p className="text-xs leading-5 text-ink-3">{OUTREACH_COPY.contacts.useFilingHelp}</p>
          {channelsNote ? <p className="text-sm text-ink-3">{channelsNote}</p> : null}
          {!channelsNote && channels.length === 0 ? <p className="text-sm text-ink-3">No public contact channel is listed in this funder&apos;s filings.</p> : null}
          <ul className="flex flex-col gap-2">
            {channels.map((ch) => {
              const used = alreadyUsed.has(ch.kind === "email" ? ch.value.toLowerCase() : ch.value.trim());
              return (
                <li key={ch.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-source-border bg-source-tint/40 px-3 py-2 text-sm">
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    <FileCheck className="size-3.5 text-source" aria-hidden />
                    <span className="data-source truncate">{ch.value}</span>
                    <span className="text-xs text-ink-3">{ch.label}</span>
                    {ch.sourceUrl ? (
                      <a href={ch.sourceUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">
                        View filing
                      </a>
                    ) : null}
                  </span>
                  <Button size="sm" variant="outline" onClick={() => void applyChannel(ch)} disabled={used || busy !== null}>
                    {busy === ch.id ? <Loader2 className="animate-spin" aria-hidden /> : null}
                    {used ? "Already in your contacts" : OUTREACH_COPY.contacts.useFiling}
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      </CardContent>
    </Card>
  );
}
