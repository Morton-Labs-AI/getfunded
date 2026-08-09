"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
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
interface PersonHit {
  id: string;
  full_name: string;
  primary_title: string | null;
  primary_org_name: string | null;
}
interface ProgramHit {
  id: string;
  name: string;
}

const GROUP_LABEL: Record<string, string> = {
  org: "organizations",
  person: "people",
  program: "programs",
};

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
  const [people, setPeople] = useState<PersonHit[]>([]);
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
      setPeople([]);
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
      setPeople([]);
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
        setPeople(data.people ?? []);
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

  // Single source for BOTH rendering and keyboard selection — index i is
  // the selection index, so groups can never drift from the arithmetic.
  const items: {
    kind: "org" | "person" | "program" | "ask";
    key: string;
    go: () => void;
    row: React.ReactNode;
  }[] = [
    ...orgs.map((o) => ({
      kind: "org" as const,
      key: `org:${o.id}`,
      go: () => router.push(`/org/${o.id}`),
      row: (
        <>
          <span className="truncate text-[13.5px] font-medium text-ink-1">{o.name}</span>
          <span className="flex shrink-0 items-center gap-2">
            <TrichotomyBadge orgType={o.org_type} />
            <span className="tnum w-16 text-right font-mono text-[11px] text-ink-4">
              {o.size ? moneyCompact(o.size) : o.state ?? ""}
            </span>
          </span>
        </>
      ),
    })),
    ...people.map((p) => ({
      kind: "person" as const,
      key: `person:${p.id}`,
      go: () => router.push(`/person/${p.id}`),
      row: (
        <>
          <span className="truncate text-[13.5px] font-medium text-ink-1">{p.full_name}</span>
          <span className="max-w-[50%] shrink-0 truncate text-right text-[11px] text-ink-4">
            {[p.primary_title, p.primary_org_name].filter(Boolean).join(" · ")}
          </span>
        </>
      ),
    })),
    ...programs.map((p) => ({
      kind: "program" as const,
      key: `program:${p.id}`,
      go: () => router.push(`/programs/${p.id}`),
      row: (
        <span className="truncate text-[13.5px] font-medium text-ink-1">{p.name}</span>
      ),
    })),
  ];
  if (q.trim().length >= 2) {
    items.push({
      kind: "ask",
      key: "ask",
      go: () => router.push(`/?q=${encodeURIComponent(q.replace(/^\?\s*/, ""))}`),
      row: (
        <span className="flex items-center gap-2.5">
          <span className="text-accent" aria-hidden>
            ✦
          </span>
          <span className="text-[13.5px] text-ink-2">
            Ask the database: “{q.replace(/^\?\s*/, "")}”
          </span>
        </span>
      ),
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
            placeholder="Search organizations, people, and programs — or ? to ask"
            className="h-12 w-full bg-transparent text-[15px] text-ink-1 placeholder:text-ink-4 focus:outline-none"
          />
          <kbd>esc</kbd>
        </div>

        <div className="max-h-[380px] overflow-y-auto p-1.5">
          {items.map((item, i) => (
            <Fragment key={item.key}>
              {item.kind !== items[i - 1]?.kind && (
                <div className="mono-label px-2.5 pb-1 pt-2">
                  {item.kind === "ask"
                    ? orgs.length === 0 && !q.startsWith("?")
                      ? "no matching org"
                      : "ask"
                    : GROUP_LABEL[item.kind]}
                </div>
              )}
              <button
                onMouseEnter={() => setSel(i)}
                onClick={() => pick(i)}
                className={`flex w-full items-center justify-between gap-3 rounded-[8px] px-2.5 py-2 text-left ${
                  sel === i ? "bg-raised" : ""
                }`}
              >
                {item.row}
              </button>
            </Fragment>
          ))}

          {q.trim().length < 2 && (
            <div className="px-2.5 py-6 text-center text-[12.5px] text-ink-4">
              Type to search 2.3M organizations · prefix with{" "}
              <kbd>?</kbd> to ask the analyst
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
