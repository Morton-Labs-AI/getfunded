"use client";

import * as React from "react";
import { useActionState, useId } from "react";

import { US_STATES } from "@/components/auth/us-states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatEin } from "@/lib/format";
import { updateOrganizationAction, type ActionState } from "@/lib/settings/actions";
import { PROFILE_FIELD_COPY } from "@/lib/settings/copy";
import type { WorkspaceProfile } from "@/lib/workspace/context";

import { FormNotice } from "./form-notice";

const INITIAL: ActionState = { ok: false };

type ControlProps = {
  id: string;
  name: string;
  "aria-invalid"?: true;
  "aria-describedby"?: string;
  disabled?: boolean;
};

function joinList(values: string[] | undefined): string {
  return values?.join(", ") ?? "";
}

/**
 * The organization profile: the same fields as /welcome, each with one line
 * on what it is and one on why the AI reads it. Compare-and-swap on the
 * workspace version; read-only for plain members.
 */
export function OrganizationForm({
  workspace,
  canEdit,
}: {
  workspace: { id: string; version: number; name: string; profile: WorkspaceProfile };
  canEdit: boolean;
}) {
  const [state, formAction, pending] = useActionState(updateOrganizationAction, INITIAL);
  const errors = state.fieldErrors ?? {};
  const baseId = useId();
  const id = (field: string) => `${baseId}-${field}`;
  const p = workspace.profile;

  const field = (name: keyof typeof PROFILE_FIELD_COPY, control: (props: ControlProps) => React.ReactNode) => {
    const copy = PROFILE_FIELD_COPY[name];
    const error = errors[name];
    const describedBy = [error ? `${id(name)}-error` : null, `${id(name)}-help`].filter(Boolean).join(" ");
    return (
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id(name)}>{copy.label}</Label>
        {control({
          id: id(name),
          name,
          "aria-invalid": error ? true : undefined,
          "aria-describedby": describedBy,
          disabled: !canEdit,
        })}
        {error ? (
          <p id={`${id(name)}-error`} className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <p id={`${id(name)}-help`} className="text-xs leading-5 text-ink-3">
          {copy.what} <span className="text-ink-2">Why: {copy.why}</span>
        </p>
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Organization profile</CardTitle>
        <CardDescription>
          The fit analysis reads this as &ldquo;the applicant&rdquo;. Nothing here is sent anywhere else, and every field can
          stay blank.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-5" noValidate>
          <input type="hidden" name="workspace_id" value={workspace.id} />
          <input type="hidden" name="version" value={workspace.version} />

          {field("name", (props) => (
            <Input {...props} defaultValue={workspace.name} maxLength={120} autoComplete="organization" required />
          ))}

          {field("mission", (props) => (
            <Textarea {...props} defaultValue={p.mission ?? ""} maxLength={2000} rows={3} placeholder={PROFILE_FIELD_COPY.mission.placeholder} />
          ))}

          <div className="grid gap-5 sm:grid-cols-2">
            {field("ein", (props) => (
              <Input
                {...props}
                defaultValue={p.ein ? formatEin(p.ein) : ""}
                inputMode="numeric"
                placeholder={PROFILE_FIELD_COPY.ein.placeholder}
                className="font-mono tnum"
              />
            ))}
            {field("website", (props) => (
              <Input {...props} defaultValue={p.website ?? ""} type="url" inputMode="url" placeholder={PROFILE_FIELD_COPY.website.placeholder} />
            ))}
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            {field("state", (props) => (
              <Select name={props.name} defaultValue={p.state ?? "none"} disabled={props.disabled}>
                <SelectTrigger
                  id={props.id}
                  aria-invalid={props["aria-invalid"]}
                  aria-describedby={props["aria-describedby"]}
                  className="w-full"
                >
                  <SelectValue placeholder="Choose a state" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not sure yet</SelectItem>
                  {US_STATES.map((code) => (
                    <SelectItem key={code} value={code}>
                      {code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ))}
            {field("annual_budget", (props) => (
              <Input
                {...props}
                defaultValue={p.annual_budget ?? ""}
                inputMode="numeric"
                placeholder={PROFILE_FIELD_COPY.annual_budget.placeholder}
                className="tnum"
              />
            ))}
          </div>

          {field("counties", (props) => (
            <Input {...props} defaultValue={joinList(p.counties)} placeholder={PROFILE_FIELD_COPY.counties.placeholder} />
          ))}
          {field("program_areas", (props) => (
            <Input {...props} defaultValue={joinList(p.program_areas)} placeholder={PROFILE_FIELD_COPY.program_areas.placeholder} />
          ))}
          {field("populations_served", (props) => (
            <Input {...props} defaultValue={joinList(p.populations_served)} placeholder={PROFILE_FIELD_COPY.populations_served.placeholder} />
          ))}
          {field("keywords", (props) => (
            <Input {...props} defaultValue={joinList(p.keywords)} placeholder={PROFILE_FIELD_COPY.keywords.placeholder} />
          ))}

          <FormNotice state={state} />

          {canEdit ? (
            <CardFooter className="flex flex-col-reverse gap-3 px-0 pt-2 sm:flex-row sm:items-center sm:justify-end">
              <Button type="submit" disabled={pending} className="h-10 sm:min-w-36">
                {pending ? "Saving…" : "Save changes"}
              </Button>
            </CardFooter>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
