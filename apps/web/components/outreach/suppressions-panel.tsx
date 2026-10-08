"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Ban, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { addSuppressionAction, removeSuppressionAction } from "@/app/(app)/app/outreach/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate } from "@/lib/format";
import { OUTREACH_COPY } from "@/lib/outreach/copy";

export type PanelSuppression = { kind: "email" | "domain"; value: string; reason: string | null; createdAt: string };

/** The do-not-contact list: add an address or a whole domain, remove one. */
export function SuppressionsPanel({ entries }: { entries: PanelSuppression[] }) {
  const router = useRouter();
  const [kind, setKind] = React.useState<"email" | "domain">("email");
  const [value, setValue] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const [removing, setRemoving] = React.useState<string | null>(null);
  const id = React.useId();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{OUTREACH_COPY.suppress.title}</CardTitle>
        <CardDescription>{OUTREACH_COPY.suppress.help}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form
          className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const result = await addSuppressionAction({ kind, value, reason });
              if (!result.ok) return void toast.error("Could not add", { description: result.error });
              toast.success("Added to the list", { description: result.value });
              setValue("");
              setReason("");
              router.refresh();
            });
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-kind`}>Block</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as "email" | "domain")}>
              <SelectTrigger id={`${id}-kind`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="email">One address</SelectItem>
                <SelectItem value="domain">A whole domain</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-value`}>{kind === "email" ? "Email address" : "Domain"}</Label>
            <Input id={`${id}-value`} value={value} placeholder={kind === "email" ? "grants@example.org" : "example.org"} maxLength={320} onChange={(e) => setValue(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-reason`}>Why (optional)</Label>
            <Input id={`${id}-reason`} value={reason} placeholder="e.g. asked us not to write" maxLength={300} onChange={(e) => setReason(e.target.value)} />
          </div>
          <Button type="submit" size="sm" disabled={pending || !value.trim()}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Ban aria-hidden />}
            Add
          </Button>
        </form>

        {entries.length === 0 ? <p className="text-sm text-ink-3">The list is empty.</p> : null}
        <ul className="divide-y rounded-lg border">
          {entries.map((s) => {
            const key = `${s.kind}:${s.value}`;
            return (
              <li key={key} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <Badge variant="secondary">{s.kind === "email" ? "Address" : "Domain"}</Badge>
                  <span className="truncate font-medium">{s.value}</span>
                  {s.reason ? <span className="text-ink-3">{s.reason}</span> : null}
                  <span className="text-xs text-ink-3">
                    added <time className="tnum">{formatDate(s.createdAt)}</time>
                  </span>
                </span>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Remove ${s.value} from the list`}
                  disabled={removing !== null}
                  onClick={async () => {
                    setRemoving(key);
                    try {
                      const result = await removeSuppressionAction({ kind: s.kind, value: s.value });
                      if (!result.ok) return void toast.error("Could not remove", { description: result.error });
                      toast.success("Removed from the list");
                      router.refresh();
                    } finally {
                      setRemoving(null);
                    }
                  }}
                >
                  {removing === key ? <Loader2 className="animate-spin" /> : <Trash2 />}
                </Button>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
