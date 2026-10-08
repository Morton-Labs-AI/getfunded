"use client";

import * as React from "react";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";

import { Missing } from "@/components/data/missing";
import { YoursTag } from "@/components/data/yours-tag";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addContactAction, deleteContactAction } from "@/lib/workspace/actions";
import type { Contact } from "@/lib/workspace/types";

const SOURCE_LABEL: Record<Contact["source"], string> = {
  manual: "Added by hand",
  import: "Imported",
  web: "From the web",
  filing_part_xv: "From the filing",
};

/**
 * The workspace's own contacts for a funder. These are YOURS: people the
 * team added. Public filing contacts are shown by the funder profile with
 * their own Source chip; they are not mixed in here.
 */
export function ContactList({ savedFunderId, contacts }: { savedFunderId: string; contacts: Contact[] }) {
  const [adding, setAdding] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const ids = { name: React.useId(), title: React.useId(), email: React.useId(), phone: React.useId() };

  function remove(c: Contact) {
    if (!window.confirm(`Remove ${c.fullName} from this funder's contacts?`)) return;
    startTransition(async () => {
      const r = await deleteContactAction({ id: c.id });
      if (!r.ok) toast.error("Could not remove", { description: r.message });
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {contacts.length === 0 ? (
        <p className="text-sm text-ink-3">No contacts added yet.</p>
      ) : (
        <ul className="divide-y rounded-md border bg-card">
          {contacts.map((c) => (
            <li key={c.id} className="flex items-start gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">
                  {c.fullName}
                  {c.title ? <span className="font-normal text-ink-3"> · {c.title}</span> : null}
                </p>
                <p className="flex flex-wrap gap-x-3 text-xs text-ink-2">
                  {c.email ? (
                    <a href={`mailto:${c.email}`} className="hover:underline">
                      {c.email}
                    </a>
                  ) : (
                    <Missing bare />
                  )}
                  {c.phone ? <span className="tnum">{c.phone}</span> : null}
                </p>
                <p className="mt-1 flex items-center gap-1.5">
                  <YoursTag />
                  <Badge variant="outline" className="text-[10px]">
                    {SOURCE_LABEL[c.source]}
                  </Badge>
                </p>
              </div>
              <Button variant="ghost" size="icon-sm" aria-label={`Remove ${c.fullName}`} disabled={pending} onClick={() => remove(c)}>
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <form
          className="flex flex-col gap-3 rounded-md border bg-surface p-3"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            startTransition(async () => {
              const r = await addContactAction({
                savedFunderId,
                fullName: String(fd.get("fullName") ?? ""),
                title: String(fd.get("title") ?? "") || null,
                email: String(fd.get("email") ?? "") || "",
                phone: String(fd.get("phone") ?? "") || null,
                source: "manual",
              });
              if (!r.ok) {
                toast.error("Could not add the contact", { description: r.message });
                return;
              }
              toast.success("Contact added");
              setAdding(false);
            });
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={ids.name}>Name</Label>
              <Input id={ids.name} name="fullName" required maxLength={200} autoComplete="off" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={ids.title}>Title</Label>
              <Input id={ids.title} name="title" maxLength={200} placeholder="Program officer" autoComplete="off" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={ids.email}>Email</Label>
              <Input id={ids.email} name="email" type="email" maxLength={254} autoComplete="off" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={ids.phone}>Phone</Label>
              <Input id={ids.phone} name="phone" maxLength={60} autoComplete="off" className="tnum" />
            </div>
          </div>
          <p className="text-xs text-ink-3">Only people who have agreed to be contacted by your organization. Stored in your workspace only.</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Adding…" : "Add contact"}
            </Button>
          </div>
        </form>
      ) : (
        <div>
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            <Plus aria-hidden />
            Add a contact
          </Button>
        </div>
      )}
    </div>
  );
}
