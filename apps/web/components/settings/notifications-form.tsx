"use client";

import * as React from "react";
import { useActionState, useId } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { savePreferencesAction, type PreferencesActionState } from "@/lib/workspace/notification-actions";
import type { NotificationPreferences } from "@/lib/workspace/notifications";

import { FormNotice } from "./form-notice";

const INITIAL: PreferencesActionState = { ok: false };

/**
 * Per-person alert settings. The Switch components are controlled so the
 * hidden inputs carry "on" to the server action exactly as a checkbox would.
 */
export function NotificationsForm({ prefs, discoveryAllowed }: { prefs: NotificationPreferences; discoveryAllowed: boolean }) {
  const [state, formAction, pending] = useActionState(savePreferencesAction, INITIAL);
  const current = state.ok ? state.prefs : prefs;
  const [signalAlerts, setSignalAlerts] = React.useState(current.signalAlerts);
  const [discoveryAlerts, setDiscoveryAlerts] = React.useState(current.discoveryAlerts);
  const [minScore, setMinScore] = React.useState(String(current.minScore));
  const [digest, setDigest] = React.useState(current.emailDigest);
  const id = useId();

  return (
    <form action={formAction}>
      <Card>
        <CardHeader>
          <CardTitle>Funder signals</CardTitle>
          <CardDescription>
            A signal is a funder&apos;s own announcement: new money committed, a program launched, a call opened, a deadline set. These settings are yours; teammates have their own.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <Row
            id={`${id}-signal`}
            label="Alerts on funders you have saved"
            help="A notification when a funder on your list announces something, with the reasons it reached you."
          >
            <Switch id={`${id}-signal`} checked={signalAlerts} onCheckedChange={setSignalAlerts} />
            <input type="hidden" name="signalAlerts" value={signalAlerts ? "on" : ""} />
          </Row>
          <Row
            id={`${id}-discovery`}
            label="Discovery alerts"
            help={
              discoveryAllowed
                ? "Funders you have not saved whose announcement says nonprofits are eligible and matches your program areas."
                : "Funders you have not saved whose announcement matches your program areas. On Starter and above."
            }
          >
            <Switch id={`${id}-discovery`} checked={discoveryAlerts} onCheckedChange={setDiscoveryAlerts} disabled={!discoveryAllowed} />
            <input type="hidden" name="discoveryAlerts" value={discoveryAlerts ? "on" : ""} />
          </Row>
          <Row id={`${id}-score`} label="How much has to match" help="A save alone scores 50. Raise this to hear only about funders you own or signals that also match your fields.">
            <Select value={minScore} onValueChange={setMinScore}>
              <SelectTrigger id={`${id}-score`} className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="50">Any saved funder (50)</SelectItem>
                <SelectItem value="65">Saved and owned by me, or saved with a match (65)</SelectItem>
                <SelectItem value="80">Only strong matches (80)</SelectItem>
              </SelectContent>
            </Select>
            <input type="hidden" name="minScore" value={minScore} />
          </Row>
          <Row id={`${id}-digest`} label="E-mail digest" help="Recorded now; e-mail delivery is not switched on in this release, so the bell is the channel.">
            <Select value={digest} onValueChange={(v) => setDigest(v as typeof digest)}>
              <SelectTrigger id={`${id}-digest`} className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off">Off</SelectItem>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
              </SelectContent>
            </Select>
            <input type="hidden" name="emailDigest" value={digest} />
          </Row>
          <FormNotice state={state.ok ? { ok: true, message: state.message } : { ok: false, error: state.message }} />
        </CardContent>
        <CardFooter className="justify-end">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}

function Row({ id, label, help, children }: { id: string; label: string; help: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <Label htmlFor={id}>{label}</Label>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-3">{help}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}
