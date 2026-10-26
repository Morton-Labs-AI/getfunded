"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CAUSE_KEYS } from "@/lib/search/context";
import { cn } from "@/lib/utils";
import {
  FUNDING_NEEDS,
  FUNDING_NEED_LABELS,
  MAX_CAUSE_AREAS,
  SERVICE_AREAS,
  SERVICE_AREA_LABELS,
  causeLabel,
} from "@/lib/workspace/search-profile";
import type { WorkspaceProfile } from "@/lib/workspace/context";

/** A toggle chip; a group of them stands for a checkbox list. */
function Chip({ on, onClick, children, disabled }: { on: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors duration-150 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50",
        on ? "border-primary-border bg-primary-tint text-primary" : "border-input bg-surface text-ink-2 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/**
 * The profile fields that tune funder search: the causes the organization
 * works in, its city, how far its work reaches, what it needs money for and a
 * typical request. Shared by /welcome and Settings › Organization. Multi-choice
 * fields post as one hidden comma list.
 */
export function SearchProfileFields({
  profile,
  idPrefix,
  disabled = false,
  errors = {},
}: {
  profile: WorkspaceProfile;
  idPrefix: string;
  disabled?: boolean;
  errors?: Record<string, string>;
}) {
  const [causes, setCauses] = React.useState<string[]>(profile.cause_areas ?? []);
  const [needs, setNeeds] = React.useState<string[]>(profile.funding_needs ?? []);
  const toggle = (list: string[], set: (v: string[]) => void, key: string, max: number) =>
    set(list.includes(key) ? list.filter((k) => k !== key) : list.length >= max ? list : [...list, key]);
  const id = (f: string) => `${idPrefix}-${f}`;
  const err = (f: string) =>
    errors[f] ? (
      <p id={`${id(f)}-error`} className="text-sm text-danger">
        {errors[f]}
      </p>
    ) : null;

  return (
    <fieldset className="flex flex-col gap-5" disabled={disabled}>
      <legend className="mb-1 text-sm font-medium text-foreground">How funder search ranks for you</legend>

      <div className="flex flex-col gap-1.5">
        <p id={id("cause_areas-label")} className="text-sm font-medium">
          What you work on
        </p>
        <input type="hidden" name="cause_areas" value={causes.join(",")} />
        <div role="group" aria-labelledby={id("cause_areas-label")} aria-describedby={id("cause_areas-help")} className="flex flex-wrap gap-1.5">
          {CAUSE_KEYS.map((k) => (
            <Chip key={k} on={causes.includes(k)} onClick={() => toggle(causes, setCauses, k, MAX_CAUSE_AREAS)} disabled={disabled}>
              {causeLabel(k)}
            </Chip>
          ))}
        </div>
        {err("cause_areas")}
        <p id={id("cause_areas-help")} className="text-xs leading-5 text-ink-3">
          Up to {MAX_CAUSE_AREAS}, most central first. Search ranks funders whose grants went to groups like yours first. Left blank, we use
          the category on your IRS record.
        </p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={id("city")}>City</Label>
          <Input id={id("city")} name="city" defaultValue={profile.city ?? ""} maxLength={120} placeholder="Toledo" aria-describedby={id("city-help")} />
          {err("city")}
          <p id={id("city-help")} className="text-xs leading-5 text-ink-3">
            Where you work from. Left blank, we use your IRS record.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={id("service_area")}>How far your work reaches</Label>
          <select
            id={id("service_area")}
            name="service_area"
            defaultValue={profile.service_area ?? ""}
            className="h-9 w-full rounded-md border border-input bg-surface px-3 text-sm"
            aria-describedby={id("service_area-help")}
          >
            <option value="">Not sure yet</option>
            {SERVICE_AREAS.map((a) => (
              <option key={a} value={a}>
                {SERVICE_AREA_LABELS[a]}
              </option>
            ))}
          </select>
          <p id={id("service_area-help")} className="text-xs leading-5 text-ink-3">
            Local groups do best with funders that give nearby; national work can look further.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <p id={id("funding_needs-label")} className="text-sm font-medium">
          What the money is for
        </p>
        <input type="hidden" name="funding_needs" value={needs.join(",")} />
        <div role="group" aria-labelledby={id("funding_needs-label")} className="flex flex-wrap gap-1.5">
          {FUNDING_NEEDS.map((k) => (
            <Chip key={k} on={needs.includes(k)} onClick={() => toggle(needs, setNeeds, k, FUNDING_NEEDS.length)} disabled={disabled}>
              {FUNDING_NEED_LABELS[k]}
            </Chip>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5 sm:max-w-xs">
        <Label htmlFor={id("typical_ask")}>A typical request</Label>
        <Input
          id={id("typical_ask")}
          name="typical_ask"
          defaultValue={profile.typical_ask ?? ""}
          inputMode="numeric"
          placeholder="25000"
          className="tnum"
          aria-describedby={id("typical_ask-help")}
        />
        {err("typical_ask")}
        <p id={id("typical_ask-help")} className="text-xs leading-5 text-ink-3">
          Whole dollars. We show each funder&apos;s typical grant from its filings so you can compare.
        </p>
      </div>
    </fieldset>
  );
}
