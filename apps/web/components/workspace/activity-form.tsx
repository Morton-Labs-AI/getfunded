"use client";

import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { logActivityAction } from "@/lib/workspace/actions";
import { HUMAN_ACTIVITY_KINDS, type HumanActivityKind } from "@/lib/workspace/types";

import { NativeSelect } from "./native-select";

const LABELS: Record<HumanActivityKind, string> = {
  note: "Note",
  email: "Email",
  call: "Call",
  meeting: "Meeting",
  letter: "Letter",
  event: "Event",
};

/** Log a note, call, email, meeting, letter or event on a funder's timeline. */
export function ActivityForm({ savedFunderId }: { savedFunderId: string }) {
  const [pending, startTransition] = React.useTransition();
  const formRef = React.useRef<HTMLFormElement>(null);
  const ids = { kind: React.useId(), body: React.useId(), on: React.useId() };
  const today = new Date().toISOString().slice(0, 10);

  return (
    <form
      ref={formRef}
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(async () => {
          const result = await logActivityAction({
            savedFunderId,
            kind: String(fd.get("kind") ?? "note") as HumanActivityKind,
            body: String(fd.get("body") ?? ""),
            occurredOn: String(fd.get("on") ?? "") || null,
          });
          if (!result.ok) {
            toast.error("Could not log that", { description: result.message });
            return;
          }
          toast.success("Logged");
          formRef.current?.reset();
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[9rem_1fr]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.kind}>What happened</Label>
          <NativeSelect id={ids.kind} name="kind" size="default" defaultValue="note">
            {HUMAN_ACTIVITY_KINDS.map((k) => (
              <option key={k} value={k}>
                {LABELS[k]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.on}>When</Label>
          <Input id={ids.on} name="on" type="date" defaultValue={today} max={today} className="tnum sm:w-44" />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.body}>Details</Label>
        <Textarea id={ids.body} name="body" required maxLength={5000} rows={3} placeholder="Spoke with the program officer. They want a one-page summary before the spring board meeting." />
      </div>
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Logging…" : "Log it"}
        </Button>
      </div>
    </form>
  );
}
