"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Link2, Link2Off, Loader2, Mail } from "lucide-react";
import { toast } from "sonner";

import { updateDailyCapAction } from "@/app/(app)/app/outreach/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/lib/format";
import { OUTREACH_COPY } from "@/lib/outreach/copy";

export type PanelIdentity = {
  id: string;
  userId: string;
  email: string;
  displayName: string | null;
  status: "connected" | "disconnected" | "error";
  dailyCap: number;
  version: number;
  createdAt: string;
  isMine: boolean;
};

const STATUS_WORDS: Record<PanelIdentity["status"], { label: string; variant: "success" | "secondary" | "danger" }> = {
  connected: { label: "Connected", variant: "success" },
  disconnected: { label: "Disconnected", variant: "secondary" },
  error: { label: "Needs reconnecting", variant: "danger" },
};

function CapForm({ identity }: { identity: PanelIdentity }) {
  const router = useRouter();
  const [value, setValue] = React.useState(String(identity.dailyCap));
  const [pending, startTransition] = React.useTransition();
  const id = React.useId();
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await updateDailyCapAction({ senderIdentityId: identity.id, version: identity.version, dailyCap: Number(value) });
          if (!result.ok) return void toast.error("Could not save the limit", { description: result.error });
          toast.success("Daily limit saved");
          router.refresh();
        });
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id}>Sends per day from this mailbox</Label>
        <Input id={id} type="number" min={0} max={2000} value={value} onChange={(e) => setValue(e.target.value)} className="w-32" />
      </div>
      <Button type="submit" size="sm" variant="outline" disabled={pending || Number(value) === identity.dailyCap}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
        Save limit
      </Button>
      <p className="basis-full text-xs leading-5 text-ink-3">Counted per calendar day. 0 pauses sending. Google applies its own limits on top.</p>
    </form>
  );
}

/**
 * Connected mailboxes. Connect is a plain link to the OAuth start route (a
 * top-level navigation, by design); disconnect is a same-origin POST.
 */
export function SenderPanel({
  identities,
  isAdmin,
  canSendGmail,
  sendGmailReason,
  configured,
  notice,
}: {
  identities: PanelIdentity[];
  isAdmin: boolean;
  canSendGmail: boolean;
  sendGmailReason: string | null;
  /** The person who runs the server finished the Google setup (OAuth client) and the secrets setup (encryption key). */
  configured: { gmail: boolean; secrets: boolean };
  notice?: { tone: "success" | "error"; text: string } | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const mine = identities.find((i) => i.isMine && i.status === "connected") ?? null;

  async function disconnect(identity: PanelIdentity) {
    if (!window.confirm(`Disconnect ${identity.email}? Approved email will wait until a mailbox is connected again.`)) return;
    setBusy(identity.id);
    try {
      const res = await fetch("/api/integrations/gmail/disconnect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ senderIdentityId: identity.id }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!res.ok) return void toast.error("Could not disconnect", { description: data.error?.message });
      toast.success("Disconnected", { description: "The saved connection was removed and Google was asked to revoke it." });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const ready = canSendGmail && configured.gmail && configured.secrets;

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Your Gmail</CardTitle>
        <CardDescription>{OUTREACH_COPY.gmail.scopes}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {notice ? (
          <p className={notice.tone === "success" ? "rounded-md bg-success-tint px-3 py-2 text-sm text-success" : "rounded-md bg-danger-tint px-3 py-2 text-sm text-danger"} role="status">
            {notice.text}
          </p>
        ) : null}
        {!canSendGmail ? <p className="rounded-md bg-inset px-3 py-2 text-sm text-ink-2">{sendGmailReason}</p> : null}
        {canSendGmail && !configured.gmail ? (
          <p className="rounded-md bg-inset px-3 py-2 text-sm text-ink-2">{OUTREACH_COPY.gmail.notSetUp}</p>
        ) : null}
        {canSendGmail && configured.gmail && !configured.secrets ? (
          <p className="rounded-md bg-inset px-3 py-2 text-sm text-ink-2">{OUTREACH_COPY.gmail.noSecretsKey}</p>
        ) : null}

        {identities.length === 0 ? <p className="text-sm text-ink-3">No mailbox is connected yet.</p> : null}
        <ul className="flex flex-col gap-3">
          {identities.map((identity) => {
            const look = STATUS_WORDS[identity.status];
            const canManage = identity.isMine || isAdmin;
            return (
              <li key={identity.id} className="flex flex-col gap-3 rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2 text-sm">
                    <Mail className="size-4 shrink-0 text-ink-3" aria-hidden />
                    <span className="truncate font-medium">{identity.email}</span>
                    {identity.isMine ? <Badge variant="yours">Yours</Badge> : null}
                    <Badge variant={look.variant}>{look.label}</Badge>
                  </div>
                  <span className="text-xs text-ink-3">
                    Connected <time className="tnum">{formatDate(identity.createdAt)}</time>
                  </span>
                </div>
                {canManage ? <CapForm identity={identity} /> : null}
                {canManage ? (
                  <div className="flex flex-wrap gap-2">
                    {identity.status !== "connected" && identity.isMine && ready ? (
                      <Button size="sm" asChild>
                        <a href="/api/integrations/gmail/connect">
                          <Link2 aria-hidden />
                          Reconnect Gmail
                        </a>
                      </Button>
                    ) : null}
                    {identity.status === "connected" ? (
                      <Button size="sm" variant="outline" onClick={() => void disconnect(identity)} disabled={busy !== null}>
                        {busy === identity.id ? <Loader2 className="animate-spin" aria-hidden /> : <Link2Off aria-hidden />}
                        Disconnect
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>

        {ready && !mine ? (
          <div className="flex flex-col gap-2">
            <Button asChild className="w-fit">
              <a href="/api/integrations/gmail/connect">
                <Link2 aria-hidden />
                Connect my Gmail
              </a>
            </Button>
            <p className="text-xs leading-5 text-ink-3">You will be sent to Google to approve the two permissions above. {OUTREACH_COPY.gmail.disconnect}</p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
