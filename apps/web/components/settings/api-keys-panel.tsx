"use client";

import * as React from "react";
import { useActionState, useId } from "react";
import { AlertTriangle, KeyRound, Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { formatDate, formatDateTime } from "@/lib/format";
import { createApiKeyAction, revokeApiKeyAction, type ActionState, type ApiKeyState } from "@/lib/settings/actions";

import { CopyField } from "./copy-button";
import { FormNotice } from "./form-notice";

export type ApiKeyView = {
  id: string;
  name: string;
  key_prefix: string;
  scopes: ("read" | "write")[];
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

const INITIAL: ActionState = { ok: false };
const INITIAL_KEY: ApiKeyState = { ok: false };

function CreateKeyForm() {
  const [state, formAction, pending] = useActionState(createApiKeyAction, INITIAL_KEY);
  const formRef = React.useRef<HTMLFormElement>(null);
  const baseId = useId();
  const errors = state.fieldErrors ?? {};

  React.useEffect(() => {
    if (state.ok && state.key) formRef.current?.reset();
  }, [state]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create a key</CardTitle>
        <CardDescription>Name it after where it will be used (a script, a data warehouse, a partner tool).</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form ref={formRef} action={formAction} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${baseId}-name`}>Key name</Label>
            <Input
              id={`${baseId}-name`}
              name="name"
              maxLength={80}
              placeholder="Grants dashboard sync"
              required
              disabled={pending}
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? `${baseId}-name-error` : undefined}
            />
            {errors.name ? (
              <p id={`${baseId}-name-error`} className="text-sm text-danger">
                {errors.name}
              </p>
            ) : null}
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Scopes</legend>
            <div className="flex items-center gap-2">
              <Checkbox id={`${baseId}-read`} name="scopes" value="read" defaultChecked disabled={pending} />
              <Label htmlFor={`${baseId}-read`} className="font-normal">
                Read <span className="text-ink-3">(search, funder profiles, your saved list)</span>
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id={`${baseId}-write`} name="scopes" value="write" disabled={pending} />
              <Label htmlFor={`${baseId}-write`} className="font-normal">
                Write <span className="text-ink-3">(save funders, move stages)</span>
              </Label>
            </div>
          </fieldset>
          <div>
            <Button type="submit" disabled={pending}>
              <Plus aria-hidden />
              {pending ? "Creating…" : "Create key"}
            </Button>
          </div>
        </form>

        <FormNotice state={state} />

        {state.ok && state.key ? (
          <div className="flex flex-col gap-2 rounded-md border border-warning/30 bg-warning-tint p-3">
            <p className="flex items-start gap-2 text-sm text-warning">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                This is the only time the full key is shown. Copy it now and store it somewhere safe. If you lose it,
                revoke it and create a new one.
              </span>
            </p>
            <CopyField value={state.key.plaintext} label={`API key ${state.key.name}`} />
            <p className="text-xs text-ink-2">
              Use it as <code>Authorization: Bearer {state.key.prefix}…</code> on requests to <code>/api/v1</code>.
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function RevokeKeyForm({ apiKey }: { apiKey: ApiKeyView }) {
  const [state, formAction, pending] = useActionState(revokeApiKeyAction, INITIAL);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm" aria-label={`Revoke key ${apiKey.name}`}>
          <Trash2 aria-hidden />
          <span className="hidden sm:inline">Revoke</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revoke &ldquo;{apiKey.name}&rdquo;?</DialogTitle>
          <DialogDescription>
            Requests with this key stop working right away. This cannot be undone; create a new key if you need one.
          </DialogDescription>
        </DialogHeader>
        <FormNotice state={state} />
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Keep
            </Button>
          </DialogClose>
          <form action={formAction}>
            <input type="hidden" name="key_id" value={apiKey.id} />
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? "Revoking…" : "Revoke key"}
            </Button>
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ApiKeysPanel({ keys, canManage }: { keys: ApiKeyView[]; canManage: boolean }) {
  const active = keys.filter((k) => !k.revoked_at);
  const revoked = keys.filter((k) => k.revoked_at);
  return (
    <div className="flex flex-col gap-5">
      {canManage ? <CreateKeyForm /> : null}
      <Card>
        <CardHeader>
          <CardTitle>Your keys</CardTitle>
          <CardDescription>
            {active.length === 0 ? "No active keys." : `${active.length} active ${active.length === 1 ? "key" : "keys"}.`} The app
            stores a fingerprint only; a lost key cannot be recovered.
          </CardDescription>
        </CardHeader>
        {keys.length > 0 ? (
          <CardContent className="px-0">
            <ul className="divide-y">
              {[...active, ...revoked].map((k) => (
                <li key={k.id} className="flex items-center gap-3 px-6 py-3">
                  <KeyRound className="size-4 shrink-0 text-ink-3" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-foreground">
                      <span className="truncate">{k.name}</span>
                      {k.scopes.map((s) => (
                        <Badge key={s} variant="outline">
                          {s}
                        </Badge>
                      ))}
                      {k.revoked_at ? <Badge variant="danger">Revoked {formatDate(k.revoked_at)}</Badge> : null}
                    </p>
                    <p className="truncate text-xs text-ink-3">
                      <span className="font-mono">{k.key_prefix}…</span> · Created {formatDate(k.created_at)} ·{" "}
                      {k.last_used_at ? `Last used ${formatDateTime(k.last_used_at)}` : "Never used"}
                    </p>
                  </div>
                  {canManage && !k.revoked_at ? <RevokeKeyForm apiKey={k} /> : null}
                </li>
              ))}
            </ul>
          </CardContent>
        ) : null}
      </Card>
    </div>
  );
}
