"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { TrichotomyBadge } from "./trichotomy-badge";
import { moneyCompact } from "@/lib/format";

interface OrgHit {
  id: string;
  name: string;
  org_type: string;
  state: string | null;
  size: string | null;
}
interface ProgramHit {
  id: string;
  name: string;
}

/**
 * ⌘K dual-mode palette: type = instant entity search (FTS + trigram);
 * Enter with no good match = ask the database instead. Every failed search
 * converts into an AI interaction — the AI-native thesis in miniature.
 */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [orgs, setOrgs] = useState<OrgHit[]>([]);
  const [programs, setPrograms] = useState<ProgramHit[]>([]);
  const [sel, setSel] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQ("");
      setOrgs([]);
      setPrograms([]);
      setSel(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const ask = q.startsWith("?");
    if (q.trim().length < 2 || ask) {
      setOrgs([]);
      setPrograms([]);
      return;
    }
    const t = setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
          signal: ctrl.signal,
        });
        const data = await res.json();
        setOrgs(data.orgs ?? []);
        setPrograms(data.programs ?? []);
        setSel(0);
      } catch {
        /* aborted */
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q, open]);

  const items: { kind: "org" | "program" | "ask"; label: string; go: () => void }[] = [
    ...orgs.map((o) => ({
      kind: "org" as const,
      label: o.name,
      go: () => router.push(`/org/${o.id}`),
    })),
    ...programs.map((p) => ({
      kind: "program" as const,
      label: p.name,
      go: () => router.push(`/programs/${p.id}`),
    })),
  ];
  if (q.trim().length >= 2) {
    items.push({
      kind: "ask",
      label: q.replace(/^\?\s*/, ""),
      go: () => router.push(`/?q=${encodeURIComponent(q.replace(/^\?\s*/, ""))}`),
    });
  }

  const pick = useCallback(
    (i: number) => {
      const item = items[i];
      if (!item) return;
      setOpen(false);
      item.go();
    },
    [items]
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      style={{ background: "var(--scrim)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div
        className="seal-press w-full max-w-[560px] overflow-hidden rounded-[12px] border border-border-1 bg-overlay"
        style={{ boxShadow: "var(--shadow-overlay)" }}
        role="dialog"
        aria-label="Search"
      >
        <div className="flex items-center gap-3 border-b border-border-1 px-4">
          <span className="text-ink-4" aria-hidden>
            {loading ? <span className="thinking-cursor">▍</span> : "⌕"}
          </span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel((s) => Math.min(s + 1, items.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel((s) => Math.max(s - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                pick(sel);
              }
            }}
            placeholder="Search organizations and programs — or ? to ask"
            className="h-12 w-full bg-transparent text-[15px] text-ink-1 placeholder:text-ink-4 focus:outline-none"
          />
          <kbd>esc</kbd>
        </div>

        <div className="max-h-[380px] overflow-y-auto p-1.5">
          {orgs.length > 0 && <div className="mono-label px-2.5 pb-1 pt-2">organizations</div>}
          {orgs.map((o, i) => (
            <button
              key={o.id}
              onMouseEnter={() => setSel(i)}
              onClick={() => pick(i)}
              className={`flex w-full items-center justify-between gap-3 rounded-[8px] px-2.5 py-2 text-left ${
                sel === i ? "bg-raised" : ""
              }`}
            >
              <span className="truncate text-[13.5px] font-medium text-ink-1">{o.name}</span>
              <span className="flex shrink-0 items-center gap-2">
                <TrichotomyBadge orgType={o.org_type} />
                <span className="tnum w-16 text-right font-mono text-[11px] text-ink-4">
                  {o.size ? moneyCompact(o.size) : o.state ?? ""}
                </span>
              </span>
            </button>
          ))}

          {programs.length > 0 && <div className="mono-label px-2.5 pb-1 pt-2">programs</div>}
          {programs.map((p, i) => (
            <button
              key={p.id}
              onMouseEnter={() => setSel(orgs.length + i)}
              onClick={() => pick(orgs.length + i)}
              className={`flex w-full items-center gap-3 rounded-[8px] px-2.5 py-2 text-left ${
                sel === orgs.length + i ? "bg-raised" : ""
              }`}
            >
              <span className="truncate text-[13.5px] font-medium text-ink-1">{p.name}</span>
            </button>
          ))}

          {q.trim().length >= 2 && (
            <>
              <div className="mono-label px-2.5 pb-1 pt-2">
                {orgs.length === 0 && !q.startsWith("?") ? "no matching org" : "ask"}
              </div>
              <button
                onMouseEnter={() => setSel(items.length - 1)}
                onClick={() => pick(items.length - 1)}
                className={`flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left ${
                  sel === items.length - 1 ? "bg-raised" : ""
                }`}
              >
                <span className="text-accent" aria-hidden>
                  ✦
                </span>
                <span className="text-[13.5px] text-ink-2">
                  Ask the database: “{q.replace(/^\?\s*/, "")}”
                </span>
              </button>
            </>
          )}

          {q.trim().length < 2 && (
            <div className="px-2.5 py-6 text-center text-[12.5px] text-ink-4">
              Type to search 418,309 organizations · prefix with{" "}
              <kbd>?</kbd> to ask the analyst
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
