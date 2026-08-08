"use client";

/**
 * Fund-pair labeling screen (dev-only; served by admin routes that refuse
 * non-localhost). BLINDED BY CONSTRUCTION: the /next payload contains no
 * probability, no gammas, no accuracy aggregate — those exist only in the
 * /decide response, rendered post-write in the collapsed "model said" panel.
 * The only counter on screen is non-unsure labels vs the fixed target.
 *
 * There is deliberately NO link, key, or fetch to /admin/label/results here.
 */

import { useCallback, useEffect, useRef, useState } from "react";

interface Person { key: string; name: string; title: string | null }
interface Side {
  org_id: string; side: "ADV" | "FormD"; name: string; name_normalized: string;
  state: string | null; state_note: string | null; gav: string | null;
  adviser: string | null; adviser_crd: string | null; offerings: number;
  id_types: string[]; source_url: string | null; dataset_name: string;
  source_record_locator: string; sha256_short: string; people: Person[];
}
interface Pair {
  id_a: string; id_b: string; sides: Side[];
  shared_people: { name_a: string; title_a: string | null; name_b: string; title_b: string | null }[];
}
interface Progress { done: number; target: number }
interface Revealed { match_probability: number | null; features: Record<string, number> }

// ---------------------------------------------------------------------------
// Token diff — the decision surface. Distinguishing tokens (present on one
// side only) that are roman numerals, digits, single letters, or fund-form
// qualifiers are the strongest NOT-MATCH signals and get the loudest style.
// ---------------------------------------------------------------------------
const QUALIFIERS = new Set([
  "ONSHORE", "OFFSHORE", "QP", "INSTITUTIONAL", "FEEDER", "MASTER",
  "PARALLEL", "OVERSEAS", "DOMESTIC", "INTERNATIONAL", "CAYMAN",
]);
const ROMAN = /^[IVXLCDM]+$/;
type TokenClass = "shared" | "diff" | "critical";

function diffTokens(a: string, b: string): { a: [string, TokenClass][]; b: [string, TokenClass][] } {
  const ta = a.split(/\s+/).filter(Boolean);
  const tb = b.split(/\s+/).filter(Boolean);
  const setA = new Set(ta);
  const setB = new Set(tb);
  const classify = (tok: string, other: Set<string>): TokenClass => {
    if (other.has(tok)) return "shared";
    const critical =
      ROMAN.test(tok) || /^\d+$/.test(tok) || tok.length === 1 || QUALIFIERS.has(tok);
    return critical ? "critical" : "diff";
  };
  return {
    a: ta.map((t) => [t, classify(t, setB)] as [string, TokenClass]),
    b: tb.map((t) => [t, classify(t, setA)] as [string, TokenClass]),
  };
}

const TOKEN_STYLE: Record<TokenClass, string> = {
  shared: "text-ink-4",
  diff: "text-ink-1 bg-inset rounded px-1",
  critical: "text-white bg-red-700 rounded px-1 font-semibold",
};

function TokenRow({ toks }: { toks: [string, TokenClass][] }) {
  return (
    <div className="flex flex-wrap gap-1 font-mono text-[13px]">
      {toks.map(([t, c], i) => (
        <span key={i} className={TOKEN_STYLE[c]}>{t}</span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------

function SideCard({ s }: { s: Side }) {
  return (
    <div className="flex-1 rounded-[10px] border border-border-1 bg-surface p-4">
      <div className="mono-label mb-1">{s.side === "ADV" ? "ADV (Schedule D 7B1)" : "Form D"}</div>
      <div className="text-[16px] font-semibold text-ink-1">{s.name}</div>
      <dl className="mt-3 space-y-1 text-[13px] text-ink-2">
        <div>
          <span className="text-ink-4">state:</span>{" "}
          <span className="font-mono">{s.state ?? "—"}</span>
          {s.state_note && <span className="ml-1 text-amber-500">({s.state_note})</span>}
        </div>
        <div><span className="text-ink-4">GAV:</span> <span className="font-mono">{s.gav ?? "—"}</span></div>
        <div><span className="text-ink-4">adviser:</span> {s.adviser ?? "—"}</div>
        <div><span className="text-ink-4">reg D offerings:</span> {s.offerings}</div>
        <div>
          <span className="text-ink-4">identifiers:</span>{" "}
          {s.id_types.length
            ? s.id_types.map((t) => (
                <span key={t} className="mr-1 rounded-[4px] bg-inset px-1.5 py-[1px] font-mono text-[10.5px] uppercase tracking-wide text-ink-3">
                  {t}
                </span>
              ))
            : "—"}
        </div>
        <div className="pt-1">
          {s.source_url ? (
            <a href={s.source_url} target="_blank" rel="noreferrer"
               className="text-accent hover:text-accent-hover">
              source filing ↗
            </a>
          ) : (
            <span className="font-mono text-[11px] text-ink-4">
              {s.dataset_name} · {s.source_record_locator} · {s.sha256_short}
            </span>
          )}
        </div>
      </dl>
    </div>
  );
}

const RUBRIC = [
  ["MATCH", "same legal entity, differing only in case, punctuation, or legal suffix formatting."],
  ["NOT MATCH", "any distinguishing token differs (III vs IV, 2023 vs 2024, Institutional Partners vs (AM) Investors, Onshore vs Offshore)."],
  ["FAMILY ≠ FUND", "same adviser and shared people are FAMILY-level evidence and are NOT evidence that two funds are the same fund."],
  ["UNSURE", "genuinely undecidable. Costs nothing; excluded from the gate's numerator and denominator, and replaced by another pair."],
] as const;

export default function LabelFundsPage() {
  const [pair, setPair] = useState<Pair | null>(null);
  const [progress, setProgress] = useState<Progress>({ done: 0, target: 250 });
  const [allDone, setAllDone] = useState(false);
  const [notes, setNotes] = useState("");
  const [revealed, setRevealed] = useState<Revealed | null>(null);
  const [revealOpen, setRevealOpen] = useState(false);
  const [decided, setDecided] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastPair = useRef<{ id_a: string; id_b: string } | null>(null);

  const fetchNext = useCallback(async () => {
    setBusy(true);
    setError(null);
    setRevealed(null);
    setRevealOpen(false);
    setDecided(null);
    setNotes("");
    try {
      const res = await fetch("/api/admin/label/next");
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      const data = await res.json();
      setProgress(data.progress);
      if (data.done) { setAllDone(true); setPair(null); }
      else setPair(data.pair);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { fetchNext(); }, [fetchNext]);

  const decide = useCallback(async (d: "y" | "n" | "u") => {
    if (!pair || busy || decided) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/label/decide", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id_a: pair.id_a, id_b: pair.id_b, decision: d,
                               notes: notes.trim() || null }),
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      const data = await res.json();
      lastPair.current = { id_a: pair.id_a, id_b: pair.id_b };
      setProgress(data.progress);
      setRevealed(data.revealed);
      setDecided(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [pair, busy, decided, notes]);

  const undo = useCallback(async () => {
    const lp = lastPair.current;
    if (!lp || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/label/undo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(lp),
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      lastPair.current = null;
      await fetchNext(); // the undone pair re-serves at its seeded position
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [busy, fetchNext]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      if (decided) {
        if (e.key === " " || e.key === "Enter") { e.preventDefault(); fetchNext(); }
        else if (e.key === "z") undo();
        return;
      }
      if (e.key === "y") decide("y");
      else if (e.key === "n") decide("n");
      else if (e.key === "u") decide("u");
      else if (e.key === "z") undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [decide, undo, decided, fetchNext]);

  const d = pair ? diffTokens(pair.sides[0]?.name_normalized ?? "",
                              pair.sides[1]?.name_normalized ?? "") : null;

  return (
    <div className="mx-auto w-full max-w-[1100px] px-6 pb-16 pt-8">
      <div className="flex items-baseline justify-between">
        <div>
          <span className="mono-label">funds labeling · name + person corroboration · blinded</span>
          <h1 className="text-[22px] font-[650] text-ink-1">Same fund?</h1>
        </div>
        <div className="tnum font-mono text-[15px] text-ink-1">
          {progress.done} <span className="text-ink-4">/ {progress.target} non-unsure</span>
        </div>
      </div>

      {/* Rubric — always visible */}
      <div className="mt-4 rounded-[10px] border border-border-1 bg-raised p-3 text-[12.5px] leading-5">
        {RUBRIC.map(([k, v]) => (
          <div key={k} className="flex gap-2">
            <span className="w-[110px] shrink-0 font-mono text-[11px] font-semibold uppercase text-ink-2">{k}</span>
            <span className="text-ink-3">{v}</span>
          </div>
        ))}
      </div>

      {error && (
        <div className="mt-4 rounded-[8px] border border-red-700 bg-red-950/40 p-3 font-mono text-[12px] text-red-400">
          {error}
        </div>
      )}

      {allDone && (
        <div className="mt-8 text-[15px] text-ink-2">
          No unlabeled pairs remain in this class.
        </div>
      )}

      {pair && (
        <>
          <div className="mt-5 flex gap-4">
            <SideCard s={pair.sides[0]} />
            <SideCard s={pair.sides[1]} />
          </div>

          {/* Token-level diff of the normalized names — the decision. */}
          {d && (
            <div className="mt-4 rounded-[10px] border border-border-1 bg-surface p-4">
              <div className="mono-label mb-2">normalized-name diff (highlighted = distinguishing token)</div>
              <TokenRow toks={d.a} />
              <div className="my-1 border-t border-dashed border-border-1" />
              <TokenRow toks={d.b} />
            </div>
          )}

          {/* Shared people BY NAME with per-side roles. */}
          <div className="mt-4 rounded-[10px] border border-border-1 bg-surface p-4">
            <div className="mono-label mb-2">
              shared people ({pair.shared_people.length}) — family-level evidence, NOT fund identity
            </div>
            {pair.shared_people.length === 0 ? (
              <span className="text-[13px] text-ink-4">none</span>
            ) : (
              <table className="w-full text-[13px]">
                <tbody>
                  {pair.shared_people.map((p, i) => (
                    <tr key={i} className="border-b border-border-1 last:border-0">
                      <td className="py-1 pr-3 text-ink-1">{p.name_a}</td>
                      <td className="py-1 pr-3 text-ink-3">{p.title_a?.toLowerCase() ?? "—"}
                        <span className="text-ink-4"> (ADV side)</span></td>
                      <td className="py-1 text-ink-3">{p.title_b?.toLowerCase() ?? "—"}
                        <span className="text-ink-4"> (Form D side)</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Notes + decision */}
          <div className="mt-4 flex items-start gap-4">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="notes (optional, saved with the label)"
              rows={2}
              className="flex-1 rounded-[8px] border border-border-1 bg-raised p-2 text-[13px] text-ink-1 placeholder:text-ink-4 focus:outline-none"
              disabled={!!decided}
            />
            <div className="flex gap-2">
              {!decided ? (
                <>
                  <button onClick={() => decide("y")} disabled={busy}
                    className="rounded-[8px] border border-accent-border bg-accent-tint px-4 py-2 text-[14px] font-medium text-accent">
                    y — match
                  </button>
                  <button onClick={() => decide("n")} disabled={busy}
                    className="rounded-[8px] border border-border-2 px-4 py-2 text-[14px] font-medium text-ink-1">
                    n — not match
                  </button>
                  <button onClick={() => decide("u")} disabled={busy}
                    className="rounded-[8px] border border-border-1 px-4 py-2 text-[14px] text-ink-3">
                    u — unsure
                  </button>
                </>
              ) : (
                <button onClick={fetchNext} disabled={busy}
                  className="rounded-[8px] border border-accent-border bg-accent-tint px-4 py-2 text-[14px] font-medium text-accent">
                  next pair (space)
                </button>
              )}
              <button onClick={undo} disabled={busy || !lastPair.current}
                className="rounded-[8px] border border-border-1 px-3 py-2 text-[12.5px] text-ink-4"
                title="revert the last decision (z)">
                z — undo
              </button>
            </div>
          </div>

          {/* Post-decision reveal — collapsed; never rendered before a write. */}
          {decided && revealed && (
            <div className="mt-4 rounded-[10px] border border-border-1 bg-raised p-3">
              <button onClick={() => setRevealOpen(!revealOpen)}
                className="mono-label text-ink-3">
                model said {revealOpen ? "▾" : "▸"} (recorded: {decided})
              </button>
              {revealOpen && (
                <div className="mt-2 font-mono text-[12.5px] text-ink-2">
                  p={revealed.match_probability === null ? "—" : revealed.match_probability.toFixed(4)}
                  {"  "}evidence={JSON.stringify(revealed.features)}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
