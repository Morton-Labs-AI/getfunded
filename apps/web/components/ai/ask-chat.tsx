"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUp, LoaderCircle, RotateCcw, Square } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { AiBadge, AiCard } from "@/components/data/ai-badge";
import { Missing } from "@/components/data/missing";
import { SourceChip } from "@/components/data/source-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { readAiError, type AiApiError } from "@/lib/ai/api-client";
import { AI_COPY } from "@/lib/ai/copy";
import { parseSseFrames, type AskEvent } from "@/lib/ai/sse";
import { formatMoney, formatNumber, toNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

import { AiErrorNotice } from "./ai-error-notice";

/* ----------------------------------------------------------------- types */

type Cell = string | number | boolean | null;

type SqlSegment = {
  kind: "sql";
  sql: string;
  purpose: string;
  repaired: boolean;
  status: "running" | "done" | "error";
  columns?: string[];
  rows?: Cell[][];
  total?: number;
  ms?: number;
  capped?: boolean;
  errorMessage?: string;
};

type Segment = SqlSegment | { kind: "text"; text: string } | { kind: "note"; tone: "warning" | "danger"; text: string };

type Phase = "write" | "run" | "explain";

type Usage = { credits: number; inputTokens: number; outputTokens: number; model: string; mock: boolean };

type Turn = {
  id: number;
  question: string;
  segments: Segment[];
  status: "streaming" | "done" | "stopped";
  phase: Phase | null;
  usage: Usage | null;
  error: AiApiError | null;
  startedAt: number;
  endedAt: number | null;
};

const PHASE_INDEX: Record<Phase, number> = { write: 1, run: 2, explain: 3 };
const PREVIEW_ROWS = 25;

/* -------------------------------------------------------- event reducer */

function lastSql(segments: Segment[]): SqlSegment | undefined {
  for (let i = segments.length - 1; i >= 0; i--) {
    const s = segments[i];
    if (s.kind === "sql") return s;
  }
  return undefined;
}

/** Apply one SSE event to a turn. Pure; returns a new turn. */
export function applyAskEvent(turn: Turn, ev: AskEvent, now: number): Turn {
  const segments = turn.segments.map((s) => ({ ...s }));
  switch (ev.type) {
    case "phase":
      return { ...turn, phase: ev.phase, segments };
    case "sql":
      segments.push({ kind: "sql", sql: ev.sql, purpose: ev.purpose || "Query", repaired: Boolean(ev.repaired), status: "running" });
      return { ...turn, segments };
    case "rows": {
      const seg = lastSql(segments);
      if (seg) Object.assign(seg, { status: "done", columns: ev.columns, rows: ev.rows, total: ev.total, ms: ev.ms, capped: ev.capped });
      return { ...turn, segments };
    }
    case "sql_error": {
      const seg = lastSql(segments);
      if (seg) Object.assign(seg, { status: "error", errorMessage: ev.message });
      return { ...turn, segments };
    }
    case "text": {
      const last = segments[segments.length - 1];
      if (last && last.kind === "text") last.text += ev.text;
      else segments.push({ kind: "text", text: ev.text });
      return { ...turn, segments };
    }
    case "usage":
      return { ...turn, usage: { credits: ev.credits, inputTokens: ev.inputTokens, outputTokens: ev.outputTokens, model: ev.model, mock: ev.mock }, segments };
    case "error":
      return {
        ...turn,
        segments,
        error: errorFromEvent(ev),
        status: "done",
        endedAt: now,
      };
    case "done":
      return { ...turn, segments, status: "done", phase: null, endedAt: turn.endedAt ?? now };
  }
}

function errorFromEvent(ev: Extract<AskEvent, { type: "error" }>): AiApiError {
  const kind: AiApiError["kind"] =
    ev.code === "quota_exceeded" || ev.status === 402 ? "quota" : ev.code === "ai_disabled" ? "disabled" : ev.code === "not_configured" ? "not_configured" : ev.code === "plan_feature" ? "plan" : "other";
  return ev.upgradeUrl ? { kind, status: ev.status, code: ev.code, message: ev.message, upgradeUrl: ev.upgradeUrl } : { kind, status: ev.status, code: ev.code, message: ev.message };
}

/** The assistant's answer text, for the history the next question carries. */
function answerText(turn: Turn): string {
  return turn.segments
    .filter((s): s is Extract<Segment, { kind: "text" }> => s.kind === "text")
    .map((s) => s.text)
    .join("")
    .trim();
}

/* -------------------------------------------------------------- component */

/**
 * "Ask the analyst". One question at a time; every answer shows the SQL that
 * produced it, the rows it ran on and what it cost. The conversation lives in
 * component state only: nothing is stored, and the next question carries the
 * earlier turns as history so follow-ups work ("and only in Oregon?").
 */
export function AskChat({ credits, aiDisabled = false }: { credits: number; aiDisabled?: boolean }) {
  const [turns, setTurns] = React.useState<Turn[]>([]);
  const [input, setInput] = React.useState("");
  const [streaming, setStreaming] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);
  const nextId = React.useRef(1);
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const textareaId = React.useId();

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [turns]);

  React.useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const updateTurn = React.useCallback((id: number, fn: (t: Turn) => Turn) => {
    setTurns((prev) => prev.map((t) => (t.id === id ? fn(t) : t)));
  }, []);

  async function send(raw: string) {
    const question = raw.trim();
    if (question.length < 3 || streaming) return;
    const id = nextId.current++;
    const history = turns
      .filter((t) => t.status !== "streaming")
      .flatMap((t) => {
        const answer = answerText(t);
        return answer ? [{ role: "user" as const, content: t.question }, { role: "assistant" as const, content: answer.slice(0, 8000) }] : [];
      })
      .slice(-12);
    const turn: Turn = { id, question, segments: [], status: "streaming", phase: "write", usage: null, error: null, startedAt: Date.now(), endedAt: null };
    setTurns((prev) => [...prev, turn]);
    setInput("");
    setStreaming(true);

    if (aiDisabled) {
      updateTurn(id, (t) => ({ ...t, status: "done", phase: null, endedAt: Date.now(), error: { kind: "disabled", status: 503, code: "ai_disabled", message: AI_COPY.disabled.hint } }));
      setStreaming(false);
      return;
    }

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch("/api/ai/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, history: history.length ? history : undefined }),
        signal: ctrl.signal,
        credentials: "same-origin",
      });
      if (!res.ok || !res.body) {
        const error = await readAiError(res);
        updateTurn(id, (t) => ({ ...t, status: "done", phase: null, endedAt: Date.now(), error }));
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { events, rest } = parseSseFrames(buffer);
        buffer = rest;
        if (events.length > 0) {
          const now = Date.now();
          updateTurn(id, (t) => events.reduce((acc, ev) => applyAskEvent(acc, ev, now), t));
        }
      }
      updateTurn(id, (t) => (t.status === "streaming" ? { ...t, status: "done", phase: null, endedAt: Date.now() } : t));
    } catch (err) {
      const aborted = err instanceof Error && err.name === "AbortError";
      updateTurn(id, (t) => ({
        ...t,
        status: aborted ? "stopped" : "done",
        phase: null,
        endedAt: Date.now(),
        error: aborted ? null : { kind: "other", status: 0, code: "network", message: "The connection dropped before the answer finished. Ask again." },
      }));
    } finally {
      abortRef.current = null;
      setStreaming(false);
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  function reset() {
    abortRef.current?.abort();
    setTurns([]);
    setInput("");
  }

  const active = turns.length > 0;

  return (
    <div data-slot="ask-chat" className="flex w-full flex-col gap-6">
      {active ? (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={reset} disabled={streaming}>
            <RotateCcw aria-hidden />
            {AI_COPY.ask.newChat}
          </Button>
        </div>
      ) : null}

      <ol className="flex flex-col gap-6" aria-live="polite" aria-label="Conversation">
        {turns.map((turn) => (
          <li key={turn.id} className="flex flex-col gap-3">
            <div className="flex justify-end">
              <p className="max-w-[85%] rounded-lg border border-yours-border bg-yours-tint px-3.5 py-2.5 text-sm text-foreground sm:max-w-[70%]">{turn.question}</p>
            </div>
            <AssistantTurn turn={turn} />
          </li>
        ))}
      </ol>
      <div ref={bottomRef} />

      <form
        className={cn("flex flex-col gap-2", active && "sticky bottom-4")}
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <label htmlFor={textareaId} className="sr-only">
          Your question
        </label>
        <div className="relative">
          <Textarea
            id={textareaId}
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value.slice(0, 2000))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            placeholder={AI_COPY.ask.placeholder}
            disabled={streaming}
            className="min-h-14 resize-none bg-surface pr-24 shadow-card"
            maxLength={2000}
          />
          <div className="absolute right-2 bottom-2 flex items-center gap-2">
            {streaming ? (
              <Button type="button" size="sm" variant="outline" onClick={stop} aria-label={AI_COPY.ask.stop}>
                <Square aria-hidden />
                {AI_COPY.ask.stop}
              </Button>
            ) : (
              <Button type="submit" size="sm" variant="ai" disabled={input.trim().length < 3} aria-label={AI_COPY.ask.send}>
                <ArrowUp aria-hidden />
                {AI_COPY.ask.send}
              </Button>
            )}
          </div>
        </div>
        <p className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-3">
          <span className="tnum">
            Each question uses {credits} credit{credits === 1 ? "" : "s"}.
          </span>
          <span className="hidden sm:inline">Enter sends. Shift+Enter adds a line.</span>
        </p>
      </form>
    </div>
  );
}

/* ---------------------------------------------------------- the answer */

function AssistantTurn({ turn }: { turn: Turn }) {
  const phaseIndex = turn.phase ? PHASE_INDEX[turn.phase] : 0;
  const elapsedMs = turn.endedAt ? turn.endedAt - turn.startedAt : null;
  const streaming = turn.status === "streaming";
  const empty = turn.segments.length === 0;

  return (
    <AiCard
      reason="The query and the explanation were written by a model from your question. The rows are real results from the public funder data."
      meta={
        <span className="tnum text-xs text-ink-3">
          {elapsedMs !== null ? `${(elapsedMs / 1000).toFixed(1)} s` : null}
        </span>
      }
    >
      <div className="flex flex-col gap-3">
        {turn.segments.map((seg, i) => {
          switch (seg.kind) {
            case "sql":
              return <SqlBlock key={i} seg={seg} />;
            case "text":
              return <AnswerText key={i} text={seg.text} />;
            case "note":
              return (
                <p key={i} role="status" className={cn("rounded-md border px-3 py-2 text-xs", seg.tone === "danger" ? "border-danger/40 bg-danger-tint text-danger" : "border-warning/40 bg-warning-tint text-warning")}>
                  {seg.text}
                </p>
              );
          }
        })}

        {streaming ? (
          <p className="inline-flex items-center gap-2 font-mono text-xs text-ink-3" role="status">
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
            {empty ? AI_COPY.ask.phases[phaseIndex] ?? AI_COPY.ask.phases[0] : turn.phase ? AI_COPY.ask.phases[phaseIndex] : "Working…"}
          </p>
        ) : null}

        {turn.status === "stopped" ? <p className="text-xs text-ink-3">Stopped. The credits for this question were still used.</p> : null}
        {turn.error ? <AiErrorNotice error={turn.error} /> : null}

        {turn.usage ? (
          <p className="tnum flex flex-wrap items-center gap-x-2 gap-y-1 border-t pt-2 text-xs text-ink-3">
            <span>
              {turn.usage.credits} credit{turn.usage.credits === 1 ? "" : "s"}
            </span>
            <span aria-hidden>·</span>
            <span>
              {formatNumber(turn.usage.inputTokens)} tokens in, {formatNumber(turn.usage.outputTokens)} out
            </span>
            <span aria-hidden>·</span>
            <span className="font-mono">{turn.usage.model}</span>
            {turn.usage.mock ? <Badge variant="outline">Mock model</Badge> : null}
          </p>
        ) : null}
      </div>
    </AiCard>
  );
}

const markdownComponents: Components = {
  p: ({ children }) => <p className="my-2 text-sm leading-6 text-ink-2 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5 text-sm leading-6 text-ink-2 marker:text-ink-4">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5 text-sm leading-6 text-ink-2">{children}</ol>,
  li: ({ children }) => <li className="[&>p]:my-0">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  code: ({ children }) => <code className="rounded-sm border bg-inset px-1 py-0.5 font-mono text-[0.85em] text-ink">{children}</code>,
  h1: ({ children }) => <p className="my-2 text-sm font-semibold text-foreground">{children}</p>,
  h2: ({ children }) => <p className="my-2 text-sm font-semibold text-foreground">{children}</p>,
  h3: ({ children }) => <p className="my-2 text-sm font-semibold text-foreground">{children}</p>,
  a: ({ href, children }) => {
    const url = href ?? "";
    if (url.startsWith("/")) {
      return (
        <Link href={url} className="font-medium text-primary underline underline-offset-4">
          {children}
        </Link>
      );
    }
    return (
      <a href={url} target="_blank" rel="noreferrer" className="font-medium text-primary underline underline-offset-4">
        {children}
      </a>
    );
  },
  table: ({ children }) => (
    <div className="my-2 w-full overflow-x-auto rounded-md border">
      <table className="w-full text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="eyebrow px-2 py-1.5 text-left whitespace-nowrap text-muted-foreground">{children}</th>,
  td: ({ children }) => <td className="px-2 py-1.5 text-ink-2">{children}</td>,
};

function AnswerText({ text }: { text: string }) {
  return (
    <div data-slot="ask-answer" className="min-w-0">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

/* -------------------------------------------------------- show the work */

function SqlBlock({ seg }: { seg: SqlSegment }) {
  const [open, setOpen] = React.useState(false);
  const running = seg.status === "running";
  return (
    <div data-slot="ask-sql" className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-md border bg-inset">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <span className="flex min-w-0 items-center gap-2 text-xs">
            <span className="font-medium text-foreground">{AI_COPY.ask.showWork}</span>
            <span className="truncate text-ink-3">{seg.purpose}</span>
            {seg.repaired ? (
              <Badge variant="warning" className="shrink-0">
                Fixed once
              </Badge>
            ) : null}
          </span>
          <span className="tnum shrink-0 font-mono text-[11px] text-ink-3">
            {running ? (
              <span className="inline-flex items-center gap-1">
                <LoaderCircle className="size-3 animate-spin" aria-hidden />
                {AI_COPY.ask.running}
              </span>
            ) : seg.status === "error" ? (
              "error"
            ) : (
              `${formatNumber(seg.total ?? 0)} rows · ${formatNumber(seg.ms ?? 0)} ms`
            )}
            <span className="ml-2 text-ink-4" aria-hidden>
              {open ? "−" : "+"}
            </span>
          </span>
        </button>
        {open ? (
          <pre className="overflow-x-auto border-t px-3 py-2.5 font-mono text-[12.5px] leading-5 text-ink-2">
            <code>{seg.sql}</code>
          </pre>
        ) : null}
        {seg.status === "error" && seg.errorMessage ? <p className="border-t px-3 py-2 font-mono text-xs text-danger">{seg.errorMessage}</p> : null}
      </div>
      {seg.status === "done" && seg.columns && seg.rows ? <ResultTable columns={seg.columns} rows={seg.rows} total={seg.total ?? seg.rows.length} capped={Boolean(seg.capped)} /> : null}
    </div>
  );
}

/* ---------------------------------------------------------- result table */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORG_ID_COL = /(^|_)org_id$|^id$/i;
const NAME_COL = /name|funder|recipient|organization|foundation|charity/i;
const MONEY_COL = /amount|total|assets|revenue|distributions|disbursements|expenses|income|aum|fund_size|contributions|compensation|comp$|giving|paid|sum/i;
const COUNT_COL = /^(n|count|grants|events|n_.*|.*_count|rows)$/i;

/** Pair each org-id column with a name column; the name links to the funder page and the id hides. */
function linkPlan(columns: string[]): { hidden: Set<number>; linkFor: (number | null)[] } {
  const hidden = new Set<number>();
  const linkFor: (number | null)[] = columns.map(() => null);
  columns.forEach((c, i) => {
    if (!ORG_ID_COL.test(c)) return;
    let nameIdx = columns.findIndex((n, j) => j === i + 1 && !ORG_ID_COL.test(n) && NAME_COL.test(n));
    if (nameIdx < 0) nameIdx = columns.findIndex((n, j) => j !== i && !ORG_ID_COL.test(n) && NAME_COL.test(n) && linkFor[j] === null);
    if (nameIdx >= 0 && linkFor[nameIdx] === null) {
      hidden.add(i);
      linkFor[nameIdx] = i;
    }
  });
  return { hidden, linkFor };
}

function ResultTable({ columns, rows, total, capped }: { columns: string[]; rows: Cell[][]; total: number; capped: boolean }) {
  const [expanded, setExpanded] = React.useState(false);
  if (rows.length === 0) {
    return (
      <p className="rounded-md border bg-surface px-3 py-2.5 text-sm text-ink-3" role="status">
        {AI_COPY.ask.zeroRows}
      </p>
    );
  }
  const { hidden, linkFor } = linkPlan(columns);
  const visible = columns.map((c, i) => ({ c, i })).filter(({ i }) => !hidden.has(i));
  const shown = expanded ? rows : rows.slice(0, PREVIEW_ROWS);

  return (
    <div data-slot="ask-rows" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SourceChip label="Open Funder Database · live query" />
        <span className="tnum text-xs text-ink-3">
          {capped ? AI_COPY.ask.capped : `${formatNumber(shown.length)} of ${formatNumber(total)} row${total === 1 ? "" : "s"}`}
        </span>
      </div>
      <div className="overflow-hidden rounded-md border bg-surface">
        <Table>
          <TableHeader>
            <TableRow>
              {visible.map(({ c }) => (
                <TableHead key={c} className={cn(MONEY_COL.test(c) || COUNT_COL.test(c) ? "text-right" : undefined)}>
                  {c.replaceAll("_", " ")}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((row, ri) => (
              <TableRow key={ri}>
                {visible.map(({ c, i }) => {
                  const idIdx = linkFor[i];
                  const linkId = idIdx !== null ? row[idIdx] : null;
                  return <ResultCell key={i} col={c} value={row[i]} linkId={typeof linkId === "string" && UUID_RE.test(linkId) ? linkId : null} />;
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {rows.length > PREVIEW_ROWS ? (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => setExpanded((e) => !e)}>
            {expanded ? "Show fewer" : `Show all ${formatNumber(rows.length)}`}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ResultCell({ col, value, linkId }: { col: string; value: Cell; linkId: string | null }) {
  if (value === null || value === undefined || value === "") {
    return (
      <TableCell className={cn(MONEY_COL.test(col) || COUNT_COL.test(col) ? "text-right" : undefined)}>
        <Missing bare />
      </TableCell>
    );
  }
  if (MONEY_COL.test(col) && toNumber(typeof value === "boolean" ? null : value) !== null) {
    return <TableCell className="tnum text-right font-mono text-[12.5px] text-foreground">{formatMoney(value as string | number)}</TableCell>;
  }
  if (COUNT_COL.test(col) && toNumber(typeof value === "boolean" ? null : value) !== null) {
    return <TableCell className="tnum text-right font-mono text-[12.5px] text-foreground">{formatNumber(value as string | number)}</TableCell>;
  }
  const text = String(value);
  if (linkId) {
    return (
      <TableCell>
        <Link href={`/app/funders/${linkId}`} className="font-medium text-primary hover:underline">
          {text}
        </Link>
      </TableCell>
    );
  }
  return (
    <TableCell className="max-w-[360px] truncate text-ink-2" title={text.length > 48 ? text : undefined}>
      {text}
    </TableCell>
  );
}

/** Exported for the Ask page header: the badge that says who wrote the answer. */
export function AskAiBadge() {
  return <AiBadge reason="Answers are written by a model from a query it also wrote. The rows are real; read the query before you rely on the words." />;
}
