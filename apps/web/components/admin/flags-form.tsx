"use client";

import * as React from "react";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { saveFlags, type ActionState } from "@/lib/admin/actions";
import { BANNER_TONES, SIGNUP_MODES, SIGNUP_MODE_LABELS, type Flags } from "@/lib/admin/flags";

import { BannerBar } from "./site-banner";

const INITIAL: ActionState = { ok: false };

export function FlagsForm({ flags }: { flags: Flags }) {
  const [state, action, pending] = useActionState(saveFlags, INITIAL);
  const [aiEnabled, setAiEnabled] = React.useState(flags.aiEnabled);
  const [bannerText, setBannerText] = React.useState(flags.banner?.text ?? "");
  const [bannerHref, setBannerHref] = React.useState(flags.banner?.href ?? "");
  const [bannerTone, setBannerTone] = React.useState<(typeof BANNER_TONES)[number]>(flags.banner?.tone ?? "info");
  const errors = state.fieldErrors ?? {};

  return (
    <form action={action} className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-4 rounded-lg border bg-card p-4 shadow-card sm:p-5">
        <legend className="px-1 text-sm font-semibold">AI</legend>
        <div className="flex items-start justify-between gap-4">
          <div>
            <Label htmlFor="ai_enabled" className="text-sm">
              AI features are on
            </Label>
            <p className="mt-1 text-xs text-muted-foreground">
              Off pauses every model call for everyone and shows a notice. Search keeps working. Use it when costs run away
              or a provider is down.
            </p>
          </div>
          <Switch id="ai_enabled" name="ai_enabled" checked={aiEnabled} onCheckedChange={setAiEnabled} aria-describedby="ai_enabled_hint" />
        </div>
        <p id="ai_enabled_hint" className="text-xs text-muted-foreground">
          {aiEnabled ? "Model calls are allowed within each plan's credits." : "Model calls will be refused with a plain notice."}
        </p>
      </fieldset>

      <fieldset className="flex flex-col gap-4 rounded-lg border bg-card p-4 shadow-card sm:p-5">
        <legend className="px-1 text-sm font-semibold">Sign-ups</legend>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="signup_mode">Who can create an account</Label>
          <Select name="signup_mode" defaultValue={flags.signupMode}>
            <SelectTrigger id="signup_mode" className="w-full sm:w-72" aria-invalid={errors.signup_mode ? true : undefined}>
              <SelectValue placeholder="Choose" />
            </SelectTrigger>
            <SelectContent>
              {SIGNUP_MODES.map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {SIGNUP_MODE_LABELS[mode]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.signup_mode ? <p className="text-xs text-danger">{errors.signup_mode}</p> : null}
          <p className="text-xs text-muted-foreground">Existing members can always sign in. The sign-in page reads this value.</p>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4 rounded-lg border bg-card p-4 shadow-card sm:p-5">
        <legend className="px-1 text-sm font-semibold">Site banner</legend>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="banner_text">Message</Label>
          <Input
            id="banner_text"
            name="banner_text"
            value={bannerText}
            onChange={(e) => setBannerText(e.target.value)}
            maxLength={240}
            placeholder="Leave empty for no banner"
            aria-invalid={errors.banner_text ? true : undefined}
          />
          {errors.banner_text ? <p className="text-xs text-danger">{errors.banner_text}</p> : null}
          <p className="text-xs text-muted-foreground">Shown at the top of the website and the app. Up to 240 characters.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="banner_href">Link (optional)</Label>
            <Input
              id="banner_href"
              name="banner_href"
              value={bannerHref}
              onChange={(e) => setBannerHref(e.target.value)}
              placeholder="/docs/changelog or https://…"
              aria-invalid={errors.banner_href ? true : undefined}
            />
            {errors.banner_href ? <p className="text-xs text-danger">{errors.banner_href}</p> : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="banner_tone">Tone</Label>
            <Select name="banner_tone" value={bannerTone} onValueChange={(v) => setBannerTone(v as (typeof BANNER_TONES)[number])}>
              <SelectTrigger id="banner_tone" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="info">Information</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {bannerText.trim() ? (
          <div className="flex flex-col gap-1.5">
            <span className="eyebrow text-muted-foreground">Preview</span>
            <div className="overflow-hidden rounded-md border">
              <BannerBar banner={{ text: bannerText.trim(), href: bannerHref.trim() || undefined, tone: bannerTone }} />
            </div>
          </div>
        ) : null}
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save flags"}
        </Button>
        {state.message ? (
          <p role="status" className={state.ok ? "text-sm text-success" : "text-sm text-danger"}>
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
