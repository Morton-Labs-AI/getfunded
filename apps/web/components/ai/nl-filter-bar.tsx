"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { AiBadge } from "@/components/data/ai-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { postAi, type AiApiError } from "@/lib/ai/api-client";
import type { FilterResponse } from "@/lib/ai/api-schemas";
import { AI_COPY } from "@/lib/ai/copy";
import { CREDIT_COSTS } from "@/lib/plans";
import { toQueryString, type SearchParams } from "@/lib/search/params";

import { AiErrorNotice } from "./ai-error-notice";

const MAX_CHARS = 500;

/**
 * The natural-language filter bar under the search box (signed-in search
 * only). One sentence goes to /api/ai/filter; the answer is a SearchParams
 * object, which becomes the URL. The person then sees the same removable
 * chips a hand-set filter would make, so a model can never set a filter they
 * cannot see and undo. Costs one credit per sentence; the price is on the
 * button.
 */
export function NlFilterBar(props: { current: SearchParams }) {
  const { current } = props;
  const router = useRouter();
  const inputId = React.useId();
  const [text, setText] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<AiApiError | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  const credits = CREDIT_COSTS.filter;
  const tooShort = text.trim().length < 2;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const sentence = text.trim();
    if (tooShort || pending) return;
    setPending(true);
    setError(null);
    setNote(null);
    try {
      const currentRecord = Object.fromEntries(new URLSearchParams(toQueryString(current)));
      const result = await postAi<FilterResponse>("/api/ai/filter", { sentence, current: currentRecord });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const { params, chips, dropped } = result.data;
      if (chips.length === 0) {
        setNote(dropped.length > 0 ? `${AI_COPY.filter.nothing} Not applied: ${dropped.map((d) => d.chip.label).join(", ")}.` : AI_COPY.filter.nothing);
        return;
      }
      const droppedNote = dropped.length > 0 ? ` Not applied: ${dropped.map((d) => `${d.chip.label} (${d.reason})`).join("; ")}` : "";
      toast.success(AI_COPY.filter.applied, { description: `${chips.map((c) => c.label).join(" · ")}.${droppedNote}` });
      setText("");
      router.push(`/app/search?${toQueryString(params)}`);
    } finally {
      setPending(false);
    }
  }

  return (
    <form data-slot="nl-filter-bar" className="data-ai flex flex-col gap-2 p-3" onSubmit={submit} aria-label="Describe what you are looking for">
      <div className="flex flex-wrap items-center gap-2 pr-5">
        <AiBadge reason={AI_COPY.filter.hint} />
        <Label htmlFor={inputId} className="text-[13px] font-semibold text-foreground">
          Describe what you are looking for
        </Label>
        <span className="tnum ml-auto text-xs text-ink-3">
          Uses {credits} credit{credits === 1 ? "" : "s"} per sentence
        </span>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id={inputId}
          name="sentence"
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX_CHARS))}
          placeholder={AI_COPY.filter.placeholder}
          maxLength={MAX_CHARS}
          disabled={pending}
          autoComplete="off"
          enterKeyHint="go"
          className="bg-surface"
        />
        <Button type="submit" variant="ai" disabled={pending || tooShort} className="shrink-0 bg-surface">
          {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />}
          {AI_COPY.filter.button}
        </Button>
      </div>
      <p className="text-xs text-ink-3">{AI_COPY.filter.hint}</p>
      {error ? <AiErrorNotice error={error} /> : null}
      {note ? (
        <p role="status" className="text-sm text-ink-2">
          {note}
        </p>
      ) : null}
    </form>
  );
}
