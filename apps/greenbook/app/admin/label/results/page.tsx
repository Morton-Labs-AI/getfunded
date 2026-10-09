"use client";

/**
 * Verification-suite view for the funds labeling pass. SEPARATE ROUTE by
 * design: nothing on /admin/label/funds links or keys here — open it
 * deliberately. Warns loudly when the pass is incomplete, because viewing
 * observed precision mid-pass biases the remaining labels.
 *
 * Reads the same numbers `resolve eval funds` / `resolve status` produce
 * (same class CASE, same parked exclusion, same Wilson z=1.96) — the CLI
 * and this page must agree exactly.
 */

import { useEffect, useState } from "react";

interface Payload {
  progress: { done: number; target: number };
  complete: boolean;
  seed: string | null;
  by_stratum_source: { cls: string; labeled_by: string; label: string; n: number }[];
  gate: { n: number; correct: number; wilson_low: number; certified: boolean };
  threshold_ladder: { threshold: number; n: number; correct: number; wilson_low: number }[];
  bands: { band: string; n: number; correct: number; unsure: number }[];
  model_agreement: { at_auto_threshold: number | null; at_half: number | null; n: number };
}

const TH = "mono-label border-b border-border-1 px-3 py-1.5 text-left";
const TD = "border-b border-border-1 px-3 py-1.5 font-mono text-[12.5px]";

export default function LabelResultsPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ack, setAck] = useState(false);

  useEffect(() => {
    fetch("/api/admin/label/results")
      .then(async (r) => { if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`); return r.json(); })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (error) return <div className="p-8 font-mono text-[13px] text-red-400">{error}</div>;
  if (!data) return <div className="p-8 text-ink-3">loading…</div>;

  if (!data.complete && !ack) {
    return (
      <div className="mx-auto max-w-[640px] px-6 pt-16">
        <div className="rounded-[10px] border border-amber-600 bg-amber-950/30 p-5">
          <div className="mono-label mb-2 text-amber-500">incomplete pass</div>
          <p className="text-[14px] leading-6 text-ink-2">
            Only <span className="font-mono">{data.progress.done}</span> of{" "}
            <span className="font-mono">{data.progress.target}</span> non-unsure labels are
            recorded. Viewing observed precision mid-pass can bias your remaining
            judgments — the Wilson bound assumes the sample size was fixed blind.
          </p>
          <button onClick={() => setAck(true)}
            className="mt-4 rounded-[8px] border border-amber-600 px-3 py-1.5 text-[13px] text-amber-500">
            I understand — show results anyway
          </button>
        </div>
      </div>
    );
  }

  const g = data.gate;
  return (
    <div className="mx-auto w-full max-w-[900px] px-6 pb-16 pt-8">
      <span className="mono-label">funds labeling · verification suite</span>
      <h1 className="text-[22px] font-[650] text-ink-1">Results</h1>
      <p className="mt-1 font-mono text-[11.5px] text-ink-4">
        session seed: {data.seed ?? "—"} · progress {data.progress.done}/{data.progress.target}
        {" · "}matches `resolve eval funds` exactly (same CASE, parked excluded, z=1.96)
      </p>

      <div className="mt-6 rounded-[10px] border border-border-1 bg-surface p-4">
        <div className="mono-label mb-1">the gate (people class, pooled non-parked sources)</div>
        <div className="text-[20px] font-semibold text-ink-1">
          {g.correct}/{g.n} match · Wilson low {g.wilson_low.toFixed(3)} ·{" "}
          {g.certified
            ? <span className="text-green-500">CERTIFIED (n≥100, &gt;0.90)</span>
            : <span className="text-amber-500">not certified (need n≥100 and &gt;0.90)</span>}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
        <div>
          <div className="mono-label mb-2">labels by stratum × source × label</div>
          <table className="w-full text-[13px]">
            <thead><tr>
              <th className={TH}>class</th><th className={TH}>labeled_by</th>
              <th className={TH}>label</th><th className={TH}>n</th>
            </tr></thead>
            <tbody>
              {data.by_stratum_source.map((r, i) => (
                <tr key={i}>
                  <td className={TD}>{r.cls}</td><td className={TD}>{r.labeled_by}</td>
                  <td className={TD}>{r.label}</td><td className={TD}>{r.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <div className="mono-label mb-2">pre-registered threshold ladder (people class)</div>
          <table className="w-full text-[13px]">
            <thead><tr>
              <th className={TH}>p ≥</th><th className={TH}>n</th>
              <th className={TH}>correct</th><th className={TH}>Wilson low</th>
            </tr></thead>
            <tbody>
              {data.threshold_ladder.map((r) => (
                <tr key={r.threshold}>
                  <td className={TD}>{r.threshold}</td><td className={TD}>{r.n}</td>
                  <td className={TD}>{r.correct}</td><td className={TD}>{r.wilson_low.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mono-label mb-2 mt-6">probability bands (incl. unsure)</div>
          <table className="w-full text-[13px]">
            <thead><tr>
              <th className={TH}>band</th><th className={TH}>n</th>
              <th className={TH}>match</th><th className={TH}>unsure</th>
            </tr></thead>
            <tbody>
              {data.bands.map((r) => (
                <tr key={r.band}>
                  <td className={TD}>{r.band}</td><td className={TD}>{r.n}</td>
                  <td className={TD}>{r.correct}</td><td className={TD}>{r.unsure}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-6 rounded-[10px] border border-border-1 bg-surface p-4 text-[13.5px] text-ink-2">
        <div className="mono-label mb-1">agreement with the model</div>
        at auto threshold (p≥0.99):{" "}
        <span className="font-mono">
          {data.model_agreement.at_auto_threshold === null ? "—"
            : (data.model_agreement.at_auto_threshold * 100).toFixed(1) + "%"}
        </span>
        {" · "}at p≥0.5:{" "}
        <span className="font-mono">
          {data.model_agreement.at_half === null ? "—"
            : (data.model_agreement.at_half * 100).toFixed(1) + "%"}
        </span>
        {" · "}n={data.model_agreement.n}
      </div>
    </div>
  );
}
