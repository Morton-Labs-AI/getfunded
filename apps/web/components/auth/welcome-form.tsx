"use client";

import Link from "next/link";
import { useActionState, useId } from "react";

import { saveOnboarding, type OnboardingState } from "@/app/(auth)/welcome/actions";
import { US_STATES } from "@/components/auth/us-states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatEin } from "@/lib/format";
import type { WorkspaceProfile } from "@/lib/workspace/context";
import { cn } from "@/lib/utils";

/**
 * One screen. Every field has helper text, every field but the name is
 * optional, and the footer says the quiet part out loud: you can change all of
 * this later in Settings.
 */

const INITIAL: OnboardingState = { ok: false };

function joinList(values: string[] | undefined): string {
  return values?.join(", ") ?? "";
}

export function WelcomeForm({
  next,
  greetingName,
  workspace,
}: {
  next: string;
  greetingName: string | null;
  workspace: { id: string; version: number; name: string; profile: WorkspaceProfile };
}) {
  const [state, formAction, pending] = useActionState(saveOnboarding, INITIAL);
  const errors = state.fieldErrors ?? {};
  const baseId = useId();
  const id = (field: string) => `${baseId}-${field}`;

  const field = (name: string, label: string, help: string, control: (props: ControlProps) => React.ReactNode) => {
    const error = errors[name];
    return (
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id(name)}>{label}</Label>
        {control({
          id: id(name),
          name,
          "aria-invalid": error ? true : undefined,
          "aria-describedby": error ? `${id(name)}-error ${id(name)}-help` : `${id(name)}-help`,
        })}
        {error ? (
          <p id={`${id(name)}-error`} className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <p id={`${id(name)}-help`} className="text-xs leading-5 text-ink-3">
          {help}
        </p>
      </div>
    );
  };

  const p = workspace.profile;

  return (
    <Card>
      <CardHeader>
        <p className="eyebrow text-primary">Step 1 of 1</p>
        <CardTitle className="text-2xl font-semibold tracking-tight">
          {greetingName ? `Welcome, ${greetingName.split(/\s+/)[0]}.` : "Welcome."}
        </CardTitle>
        <CardDescription>
          Tell us about your organization. We use this to judge how well a funder fits your work. Everything here is
          optional except the name, and you can change it later in Settings.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-5" noValidate>
          <input type="hidden" name="workspace_id" value={workspace.id} />
          <input type="hidden" name="version" value={workspace.version} />
          <input type="hidden" name="next" value={next} />

          {field("name", "Organization name", "The name funders would recognize. Required.", (props) => (
            <Input {...props} defaultValue={workspace.name} maxLength={120} autoComplete="organization" required />
          ))}

          {field(
            "mission",
            "Mission",
            "One or two sentences on what you do and for whom. This is the single most useful field for fit.",
            (props) => (
              <Textarea
                {...props}
                defaultValue={p.mission ?? ""}
                maxLength={2000}
                rows={3}
                placeholder="We run after-school tutoring for middle schoolers in two rural counties."
              />
            ),
          )}

          <div className="grid gap-5 sm:grid-cols-2">
            {field("ein", "EIN", "Your 9-digit IRS number. Lets us match your own public filings.", (props) => (
              <Input
                {...props}
                defaultValue={p.ein ? formatEin(p.ein) : ""}
                inputMode="numeric"
                placeholder="12-3456789"
                className="font-mono tnum"
              />
            ))}
            {field("website", "Website", "We only read it when you ask for a research dossier.", (props) => (
              <Input {...props} defaultValue={p.website ?? ""} type="url" inputMode="url" placeholder="https://example.org" />
            ))}
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            {field("state", "State", "Where you are based. Many funders only give in their own state.", (props) => (
              <Select name={props.name} defaultValue={p.state ?? "none"}>
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
            {field("annual_budget", "Annual budget", "Whole dollars. Helps us suggest a realistic ask.", (props) => (
              <Input {...props} defaultValue={p.annual_budget ?? ""} inputMode="numeric" placeholder="250000" className="tnum" />
            ))}
          </div>

          {field("counties", "Counties you serve", "Separate with commas. Leave blank if you work statewide.", (props) => (
            <Input {...props} defaultValue={joinList(p.counties)} placeholder="Lane, Douglas" />
          ))}

          {field("program_areas", "Program areas", "Separate with commas. Use plain words, not grant jargon.", (props) => (
            <Input {...props} defaultValue={joinList(p.program_areas)} placeholder="Youth education, Food security" />
          ))}

          {field("populations_served", "Who you serve", "Separate with commas.", (props) => (
            <Input {...props} defaultValue={joinList(p.populations_served)} placeholder="Middle school students, Rural families" />
          ))}

          {field("keywords", "Keywords", "Words a funder might use to describe work like yours. Separate with commas.", (props) => (
            <Input {...props} defaultValue={joinList(p.keywords)} placeholder="tutoring, literacy, after-school" />
          ))}

          {state.error ? (
            <p role="alert" className="rounded-md border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">
              {state.error}
            </p>
          ) : null}

          <CardFooter className={cn("flex flex-col-reverse gap-3 px-0 pt-2 sm:flex-row sm:items-center sm:justify-between")}>
            <Button variant="ghost" asChild>
              <Link href={next}>Skip for now</Link>
            </Button>
            <Button type="submit" disabled={pending} className="h-10 sm:min-w-44">
              {pending ? "Saving…" : "Save and continue"}
            </Button>
          </CardFooter>
          <p className="text-xs leading-5 text-ink-3">You can change all of this later in Settings → Organization.</p>
        </form>
      </CardContent>
    </Card>
  );
}

type ControlProps = {
  id: string;
  name: string;
  "aria-invalid"?: true;
  "aria-describedby"?: string;
};
