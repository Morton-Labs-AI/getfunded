"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Chart, type ChartSpec } from "./chart";
import { moneyFull, MDASH } from "@/lib/format";
import { AS_REPORTED_NOTE } from "@/lib/content/facts";

/* ----------------------------------------------------------------- types */

type SqlSegment = {
  kind: "sql";
  sql: string;
  purpose: string;
  status: "running" | "done" | "error";
  startedAt: number;
  ms?: number;
  columns?: string[];
  rows?: unknown[][];
  total?: number;
  capped?: boolean;
  errorMessage?: string;
  repaired?: boolean;
};

type Segment =
  | { kind: "text"; md: string }
  | SqlSegment
  | { kind: "chart"; spec: ChartSpec }
  | { kind: "note"; tone: "caution" | "negative"; text: string };

interface AssistantMsg {
  role: "assistant";
  segments: Segment[];
}
interface UserMsg {
  role: "user";
  content: string;
}
type Msg = AssistantMsg | UserMsg;

export interface Suggestion {
  q: string;
  hint: string;
  cat: "equity" | "grant" | "federal" | null;
}

/* ------------------------------------------------------------ component */

const THINK_PHASES = [
  "parsing question",
  "planning query",
  "querying 2.6M events",
];

export function ChatView({
  suggestions,
  seedQuery,
  onActiveChange,
}: {
  suggestions: Suggestion[];
  seedQuery?: string;
  onActiveChange?: (active: boolean) => void;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [thinkPhase, setThinkPhase] = useState(0);
  const [, tick] = useState(0); // live ms timers
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const seededRef = useRef(false);

  const active = messages.length > 0;
  useEffect(() => onActiveChange?.(active), [active, onActiveChange]);

  // restore / persist thread
  useEffect(() => {
    try {
      const raw = localStorage.getItem("ofdb-thread");
      if (raw) setMessages(JSON.parse(raw));
    } catch {}
  }, []);
  useEffect(() => {
    try {
      if (messages.length) localStorage.setItem("ofdb-thread", JSON.stringify(messages));
      else localStorage.removeItem("ofdb-thread");
    } catch {}
  }, [messages]);

  // live timer + thinking phase cycling while streaming
  useEffect(() => {
    if (!streaming) return;
    const t = setInterval(() => tick((n) => n + 1), 80);
    const p = setInterval(
      () => setThinkPhase((n) => (n + 1) % THINK_PHASES.length),
      1400
    );
    return () => {
      clearInterval(t);
      clearInterval(p);
    };
  }, [streaming]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages, streaming]);

  const send = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || streaming) return;
      setInput("");
      setStreaming(true);
      setThinkPhase(0);

      const history = [...messages, { role: "user", content: q } as UserMsg];
      const assistant: AssistantMsg = { role: "assistant", segments: [] };
      setMessages([...history, assistant]);

      const transcript = history.map((m) => ({
        role: m.role,
        content:
          m.role === "user"
            ? m.content
            : m.segments
                .filter((s): s is Extract<Segment, { kind: "text" }> => s.kind === "text")
                .map((s) => s.md)
                .join("\n"),
      }));

      const segments: Segment[] = [];
      const patch = () =>
        setMessages([...history, { role: "assistant", segments: [...segments] }]);

      const lastSql = () =>
        [...segments].reverse().find((s): s is SqlSegment => s.kind === "sql");

      try {
        const ctrl = new AbortController();
        abortRef.current = ctrl;
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messages: transcript }),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          const detail = await res.text().catch(() => "");
          throw new Error(detail || `Request failed (${res.status})`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let sawSqlError = false;

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const frames = buf.split("\n\n");
          buf = frames.pop() ?? "";
          for (const frame of frames) {
            if (!frame.startsWith("data: ")) continue;
            let ev: Record<string, unknown>;
            try {
              ev = JSON.parse(frame.slice(6));
            } catch {
              continue;
            }
            switch (ev.type) {
              case "text": {
                const last = segments[segments.length - 1];
                if (last?.kind === "text") last.md += ev.text as string;
                else segments.push({ kind: "text", md: ev.text as string });
                break;
              }
              case "sql":
                segments.push({
                  kind: "sql",
                  sql: ev.sql as string,
                  purpose: (ev.purpose as string) || "Query",
                  status: "running",
                  startedAt: performance.now(),
                  repaired: sawSqlError,
                });
                break;
              case "rows": {
                const seg = lastSql();
                if (seg) {
                  seg.status = "done";
                  seg.columns = ev.columns as string[];
                  seg.rows = ev.rows as unknown[][];
                  seg.total = ev.total as number;
                  seg.capped = Boolean(ev.capped);
                  seg.ms = ev.ms as number;
                }
                break;
              }
              case "sql_error": {
                const seg = lastSql();
                if (seg) {
                  seg.status = "error";
                  seg.errorMessage = ev.message as string;
                }
                if (sawSqlError) {
                  segments.push({
                    kind: "note",
                    tone: "negative",
                    text: `Query failed twice: ${String(ev.message).slice(0, 200)}`,
                  });
                }
                sawSqlError = true;
                break;
              }
              case "chart":
                segments.push({ kind: "chart", spec: ev.spec as ChartSpec });
                break;
              case "error":
                segments.push({
                  kind: "note",
                  tone: "negative",
                  text: String(ev.message),
                });
                break;
            }
            patch();
          }
        }
        if (sawSqlError && lastSql()?.status === "done") {
          segments.push({
            kind: "note",
            tone: "caution",
            text: "Adjusted the query once after an error.",
          });
          patch();
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          segments.push({
            kind: "note",
            tone: "negative",
            text: err instanceof Error ? err.message : String(err),
          });
          patch();
        }
      } finally {
        abortRef.current = null;
        setStreaming(false);
      }
    },
    [messages, streaming]
  );

  // seed from ?q= (omnibox handoff) once
  useEffect(() => {
    if (seedQuery && !seededRef.current && !streaming) {
      seededRef.current = true;
      send(seedQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedQuery]);

  const stop = () => abortRef.current?.abort();
  const reset = () => {
    abortRef.current?.abort();
    setMessages([]);
  };

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-1 flex-col">
      {active && (
        <div className="flex justify-end pb-2">
          <button
            onClick={reset}
            className="text-[12.5px] text-ink-3 transition-colors duration-[90ms] hover:text-ink-1"
          >
            New chat
          </button>
        </div>
      )}

      <div className="flex flex-1 flex-col gap-8">
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[75%] rounded-[10px] border border-border-1 bg-raised px-3.5 py-2.5 text-[15px] text-ink-1">
                {m.content}
              </div>
            </div>
          ) : (
            <AssistantTurn
              key={i}
              segments={m.segments}
              streaming={streaming && i === messages.length - 1}
              thinkPhase={thinkPhase}
            />
          )
        )}
        <div ref={bottomRef} />
      </div>

      <form
        className={active ? "sticky bottom-4 mt-6" : "mt-9"}
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <div className="relative">
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder="Ask anything — e.g., which foundations actually fund fusion research?"
            className="h-14 w-full resize-none rounded-[12px] border border-border-2 bg-raised px-4 py-4 pr-24 text-[15px] leading-[22px] text-ink-1 placeholder:text-ink-4 focus:outline-none"
            style={{ boxShadow: "var(--shadow-sm)" }}
          />
          <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-2">
            {streaming ? (
              <button
                type="button"
                onClick={stop}
                aria-label="Stop"
                className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-border-2 text-negative"
              >
                <span className="block h-3 w-3 rounded-[2px] bg-current" />
              </button>
            ) : (
              <>
                <span className="hidden text-[11px] text-ink-4 sm:inline">
                  ⏎ to run
                </span>
                <button
                  type="submit"
                  aria-label="Send"
                  className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-accent text-accent-ink transition-colors duration-[90ms] hover:bg-accent-hover"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M12 19V5m0 0-6 6m6-6 6 6"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </>
            )}
          </div>
        </div>
      </form>

      {!active && (
        <SuggestionGrid suggestions={suggestions} onPick={(q) => send(q)} />
      )}
    </div>
  );
}

/* ----------------------------------------------------- assistant turn */

function AssistantTurn({
  segments,
  streaming,
  thinkPhase,
}: {
  segments: Segment[];
  streaming: boolean;
  thinkPhase: number;
}) {
  const empty = segments.length === 0;
  return (
    <div className="flex flex-col gap-4">
      {segments.map((seg, i) => {
        switch (seg.kind) {
          case "text":
            return (
              <div
                key={i}
                className="prose-greenbook max-w-none text-[15px] leading-6 text-ink-2"
              >
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{seg.md}</ReactMarkdown>
              </div>
            );
          case "sql":
            return <SqlBlock key={i} seg={seg} />;
          case "chart":
            return (
              <div
                key={i}
                className="rounded-[10px] border border-border-1 bg-surface p-4"
              >
                {seg.spec.title && (
                  <div className="mb-2 text-[13.5px] font-semibold text-ink-1">
                    {seg.spec.title}
                  </div>
                )}
                <Chart spec={seg.spec} />
              </div>
            );
          case "note":
            return (
              <div
                key={i}
                className="rounded-[8px] border px-3 py-2 text-[12.5px]"
                style={{
                  borderColor: `var(--${seg.tone})`,
                  color: `var(--${seg.tone})`,
                  background: "transparent",
                  opacity: 0.9,
                }}
              >
                {seg.text}
              </div>
            );
        }
      })}
      {streaming && (
        <div className="font-mono text-[12.5px] text-ink-3">
          {empty ? THINK_PHASES[thinkPhase] : ""}
          <span className="thinking-cursor">▍</span>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------- SQL block */

const SQL_KEYWORDS =
  /\b(select|from|where|join|left|right|inner|outer|on|group\s+by|order\s+by|limit|offset|with|as|and|or|not|in|is|null|desc|asc|distinct|count|sum|min|max|avg|coalesce|case|when|then|else|end|union|all|having|interval|between|like|ilike|any|array|exists|extract)\b/gi;

function highlightSql(sql: string): string {
  const esc = sql
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  // Single pass: strings | comments | keywords. Chained replaces would
  // re-process inserted HTML (e.g. the "--" in var(--cat-grant)).
  const combined = new RegExp(
    `('[^']*')|(--[^\\n]*)|${SQL_KEYWORDS.source}`,
    "gi"
  );
  return esc.replace(combined, (m, str, comment) => {
    if (str) return `<span style="color:var(--cat-grant)">${str}</span>`;
    if (comment)
      return `<span style="color:var(--ink-4);font-style:italic">${comment}</span>`;
    return `<span style="color:var(--accent);font-weight:500">${m}</span>`;
  });
}

function SqlBlock({ seg }: { seg: SqlSegment }) {
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const running = seg.status === "running";
  const liveMs = running ? Math.round(performance.now() - seg.startedAt) : seg.ms;

  return (
    <div className="flex flex-col gap-3">
      <div
        className="sql-rule overflow-hidden rounded-[8px] border border-border-1 bg-inset"
        data-cooled={!running}
      >
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex w-full items-center justify-between gap-3 px-3.5 py-2 text-left"
        >
          <span className="mono-label truncate normal-case tracking-normal">
            {running ? "RUNNING QUERY — " : ""}
            {seg.purpose}
          </span>
          <span className="tnum shrink-0 font-mono text-[11px] text-ink-3">
            {seg.status === "error"
              ? "error"
              : seg.status === "done"
                ? `→ ${seg.total?.toLocaleString()} rows · ${seg.ms} ms`
                : `${liveMs} ms`}
            <span className="ml-2 text-ink-4">{open ? "−" : "+"}</span>
          </span>
        </button>
        {open && (
          <div className="relative border-t border-border-1">
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(seg.sql);
                setCopied(true);
                setTimeout(() => setCopied(false), 900);
              }}
              className="absolute right-2.5 top-2 z-10 rounded-[5px] border border-border-1 bg-surface px-1.5 py-0.5 text-[10.5px] text-ink-3 hover:text-ink-1"
            >
              {copied ? "copied" : "copy"}
            </button>
            <pre className="sql-block overflow-x-auto px-3.5 py-3 font-mono text-[13px] leading-[21px] text-ink-2">
              <code dangerouslySetInnerHTML={{ __html: highlightSql(seg.sql) }} />
            </pre>
          </div>
        )}
        {seg.status === "error" && seg.errorMessage && (
          <div className="border-t border-border-1 px-3.5 py-2 font-mono text-[12px] text-negative">
            {seg.errorMessage}
          </div>
        )}
      </div>
      {seg.status === "done" && seg.columns && seg.rows && (
        <ResultTable
          columns={seg.columns}
          rows={seg.rows}
          total={seg.total ?? seg.rows.length}
          capped={seg.capped}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------- result table */

const ID_COL = /(^|_)org_id$|(^|_)program_id$/;
const MONEY_COL =
  /^(amount|total|total_amount|aum|fund_size|asset_amount|assets|income_amount|revenue_amount|size|award_ceiling|award_floor|gav)$/;

function ResultTable({
  columns,
  rows,
  total,
  capped,
}: {
  columns: string[];
  rows: unknown[][];
  total: number;
  capped?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  if (rows.length === 0) {
    return (
      <div className="rounded-[10px] border border-border-1 bg-surface px-4 py-3 text-[13.5px] text-ink-3">
        The query ran cleanly — 0 rows.
      </div>
    );
  }

  // paired-id rule: id columns pair with the following name column → link, hide id
  const hidden = new Set<number>();
  const linkFor: (number | null)[] = columns.map(() => null);
  columns.forEach((c, i) => {
    if (ID_COL.test(c)) {
      const nameIdx = columns.findIndex(
        (n, j) => j !== i && !ID_COL.test(n) && (j === i + 1 || /name|foundation|agency|adviser|fund/i.test(n))
      );
      if (nameIdx >= 0 && linkFor[nameIdx] === null) {
        hidden.add(i);
        linkFor[nameIdx] = i;
      }
    }
  });

  const visible = columns
    .map((c, i) => ({ c, i }))
    .filter(({ i }) => !hidden.has(i));
  const shown = expanded ? rows.slice(0, 50) : rows.slice(0, 8);

  return (
    <div className="overflow-hidden rounded-[10px] border border-border-1 bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13.5px]">
          <thead>
            <tr className="bg-raised">
              {visible.map(({ c }) => (
                <th
                  key={c}
                  className={`mono-label whitespace-nowrap border-b border-border-1 px-3.5 py-2 text-left ${MONEY_COL.test(c) ? "text-right" : ""}`}
                >
                  {c.replaceAll("_", " ")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, ri) => (
              <tr key={ri} className="border-b border-border-1 last:border-0">
                {visible.map(({ c, i }) => (
                  <Cell key={i} col={c} value={row[i]} linkId={linkFor[i] !== null ? String(row[linkFor[i]!]) : null} isProgram={linkFor[i] !== null && /program_id/.test(columns[linkFor[i]!])} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-t border-border-1 px-3.5 py-2">
        <span className="tnum font-mono text-[11px] text-ink-3">
          {capped ? `Showing ${shown.length} of 500+ (capped)` : `Showing ${shown.length} of ${total.toLocaleString()}`}
        </span>
        {rows.length > 8 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-[12.5px] text-accent hover:text-accent-hover"
          >
            {expanded ? "Show fewer" : `Show more`}
          </button>
        )}
      </div>
    </div>
  );
}

function Cell({
  col,
  value,
  linkId,
  isProgram,
}: {
  col: string;
  value: unknown;
  linkId: string | null;
  isProgram: boolean;
}) {
  const isMoney = MONEY_COL.test(col);
  if (value === null || value === undefined || value === "") {
    return (
      <td className={`px-3.5 py-2 text-ink-4 ${isMoney ? "text-right" : ""}`}>
        {MDASH}
      </td>
    );
  }
  if (isMoney) {
    return (
      <td className="tnum whitespace-nowrap px-3.5 py-2 text-right font-mono text-[12.5px] text-ink-1">
        {moneyFull(String(value))}
      </td>
    );
  }
  if (linkId) {
    return (
      <td className="px-3.5 py-2">
        <Link
          href={isProgram ? `/programs/${linkId}` : `/org/${linkId}`}
          className="font-medium text-accent hover:text-accent-hover"
        >
          {String(value)}
        </Link>
      </td>
    );
  }
  if (col === "recipient_name") {
    return (
      <td className="px-3.5 py-2 text-ink-2">
        <span className="as-reported" title={AS_REPORTED_NOTE}>
          {String(value)}
        </span>
      </td>
    );
  }
  const s = String(value);
  return (
    <td className="max-w-[360px] truncate px-3.5 py-2 text-ink-2" title={s.length > 48 ? s : undefined}>
      {s}
    </td>
  );
}

/* ------------------------------------------------------- suggestions */

const CAT_DOT: Record<string, string> = {
  equity: "var(--cat-equity-fill)",
  grant: "var(--cat-grant-fill)",
  federal: "var(--cat-federal-fill)",
};

function SuggestionGrid({
  suggestions,
  onPick,
}: {
  suggestions: Suggestion[];
  onPick: (q: string) => void;
}) {
  return (
    <div className="mt-8 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
      {suggestions.map((s) => (
        <button
          key={s.q}
          onClick={() => onPick(s.q)}
          className="group flex flex-col gap-1 rounded-[10px] border border-border-1 bg-surface px-4 py-3 text-left transition-colors duration-[90ms] hover:border-accent-border"
        >
          <span className="flex items-start gap-2 text-[13.5px] leading-5 text-ink-1">
            {s.cat && (
              <span
                className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: CAT_DOT[s.cat] }}
              />
            )}
            {s.q}
          </span>
          <span className="mono-label">{s.hint}</span>
        </button>
      ))}
    </div>
  );
}
