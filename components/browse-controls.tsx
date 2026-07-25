"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const STATES = "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" ");

const NTEE: Record<string, string> = {
  A: "Arts & Culture",
  B: "Education",
  C: "Environment",
  D: "Animals",
  E: "Health",
  H: "Medical Research",
  Q: "International",
  S: "Community",
  T: "Philanthropy & Grantmaking",
  U: "Science & Technology",
  V: "Social Science",
  W: "Public & Societal Benefit",
};

const ASSET_PRESETS = [
  { label: "$1M+", v: 1_000_000 },
  { label: "$10M+", v: 10_000_000 },
  { label: "$100M+", v: 100_000_000 },
  { label: "$1B+", v: 1_000_000_000 },
];

export function BrowseControls({ segment }: { segment: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [nl, setNl] = useState("");
  const [pending, startTransition] = useTransition();
  const [aiBusy, setAiBusy] = useState(false);

  const setParam = (kv: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    next.delete("cursor");
    next.delete("dir");
    for (const [k, v] of Object.entries(kv)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    startTransition(() => router.push(`/browse?${next.toString()}`));
  };

  const askAi = async () => {
    const text = nl.trim();
    if (!text || aiBusy) return;
    setAiBusy(true);
    try {
      const res = await fetch("/api/filters", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (data.filters) {
        const f = data.filters as Record<string, unknown>;
        const next = new URLSearchParams();
        if (f.segment) next.set("segment", String(f.segment));
        if (f.state) next.set("state", String(f.state));
        if (f.q) next.set("q", String(f.q));
        if (f.minAssets) next.set("min", String(f.minAssets));
        if (f.maxAssets) next.set("max", String(f.maxAssets));
        if (f.ntee) next.set("ntee", String(f.ntee));
        if (f.era) next.set("era", String(f.era));
        if (f.fundType) next.set("fundType", String(f.fundType));
        setNl("");
        startTransition(() => router.push(`/browse?${next.toString()}`));
      }
    } finally {
      setAiBusy(false);
    }
  };

  // active chips from URL
  const chips: { k: string; label: string }[] = [];
  const chipDefs: [string, (v: string) => string][] = [
    ["state", (v) => `state: ${v}`],
    ["q", (v) => `“${v}”`],
    ["min", (v) => `≥ $${Number(v).toLocaleString()}`],
    ["max", (v) => `≤ $${Number(v).toLocaleString()}`],
    ["ntee", (v) => `NTEE ${v} — ${NTEE[v] ?? v}`],
    ["era", (v) => (v === "era" ? "ERA only" : "RIA only")],
    ["fundType", (v) => v],
  ];
  for (const [k, fmt] of chipDefs) {
    const v = params.get(k);
    if (v) chips.push({ k, label: fmt(v) });
  }

  return (
    <div className="flex flex-col gap-3">
      <form
        className="relative"
        onSubmit={(e) => {
          e.preventDefault();
          askAi();
        }}
      >
        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-accent" aria-hidden>
          {aiBusy ? <span className="thinking-cursor">▍</span> : "✦"}
        </span>
        <input
          value={nl}
          onChange={(e) => setNl(e.target.value)}
          placeholder="Describe what you're looking for — “IL science foundations over $10M” — or use the filters"
          className="h-11 w-full rounded-[10px] border border-border-2 bg-raised pl-9 pr-4 text-[13.5px] text-ink-1 placeholder:text-ink-4 focus:outline-none"
        />
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={params.get("state") ?? ""}
          onChange={(e) => setParam({ state: e.target.value || null })}
          className="h-8 rounded-[8px] border border-border-1 bg-surface px-2 font-mono text-[11.5px] text-ink-2"
        >
          <option value="">state: any</option>
          {STATES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        {segment === "foundations" && (
          <select
            value={params.get("ntee") ?? ""}
            onChange={(e) => setParam({ ntee: e.target.value || null })}
            className="h-8 max-w-[220px] rounded-[8px] border border-border-1 bg-surface px-2 font-mono text-[11.5px] text-ink-2"
          >
            <option value="">NTEE: any</option>
            {Object.entries(NTEE).map(([k, v]) => (
              <option key={k} value={k}>
                {k} — {v}
              </option>
            ))}
          </select>
        )}

        {segment === "advisers" && (
          <select
            value={params.get("era") ?? ""}
            onChange={(e) => setParam({ era: e.target.value || null })}
            className="h-8 rounded-[8px] border border-border-1 bg-surface px-2 font-mono text-[11.5px] text-ink-2"
          >
            <option value="">ERA / RIA: any</option>
            <option value="era">ERA (exempt reporting)</option>
            <option value="ria">RIA (registered)</option>
          </select>
        )}

        {segment === "funds" && (
          <select
            value={params.get("fundType") ?? ""}
            onChange={(e) => setParam({ fundType: e.target.value || null })}
            className="h-8 rounded-[8px] border border-border-1 bg-surface px-2 font-mono text-[11.5px] text-ink-2"
          >
            <option value="">fund type: any</option>
            <option>Venture Capital Fund</option>
            <option>Private Equity Fund</option>
            <option>Hedge Fund</option>
          </select>
        )}

        {ASSET_PRESETS.map((p) => (
          <button
            key={p.v}
            onClick={() => setParam({ min: params.get("min") === String(p.v) ? null : String(p.v) })}
            className={`h-8 rounded-[8px] border px-2.5 font-mono text-[11.5px] transition-colors duration-[90ms] ${
              params.get("min") === String(p.v)
                ? "border-accent-border bg-accent-tint text-accent"
                : "border-border-1 bg-surface text-ink-3 hover:border-border-2"
            }`}
          >
            {p.label}
          </button>
        ))}
        {pending && <span className="thinking-cursor text-[12px]">▍</span>}
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {chips.map((c) => (
            <button
              key={c.k}
              onClick={() => setParam({ [c.k]: null })}
              className="inline-flex items-center gap-1.5 rounded-full border border-accent-border bg-accent-tint px-3 py-1 text-[12.5px] text-accent transition-colors duration-[90ms] hover:border-accent"
            >
              {c.label}
              <span aria-hidden>×</span>
            </button>
          ))}
          <button
            onClick={() =>
              setParam({ state: null, q: null, min: null, max: null, ntee: null, era: null, fundType: null })
            }
            className="text-[12px] text-ink-4 hover:text-ink-2"
          >
            clear all
          </button>
        </div>
      )}
    </div>
  );
}
