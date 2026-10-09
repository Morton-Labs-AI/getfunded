"use client";

import { useState } from "react";
import { CensusCounter } from "./census-counter";
import { StatTile } from "./stat-tile";
import { CompositionBar } from "./composition-bar";
import { ChatView, type Suggestion } from "./chat-view";
import { countFull, countCompact } from "@/lib/format";
import type { EventTypeTotal, OverviewTotals } from "@/lib/queries/stats";

export function AskClient({
  totals,
  eventTypes,
  seedQuery,
}: {
  totals: OverviewTotals;
  eventTypes: EventTypeTotal[];
  seedQuery?: string;
}) {
  const [active, setActive] = useState(false);

  const grants = eventTypes.find((e) => e.event_type === "grant");
  const suggestions: Suggestion[] = [
    {
      q: "Which foundations have actually written grants for energy or physics research?",
      hint: `evidence from ${countCompact(grants?.n ?? null)} grant records`,
      cat: "grant",
    },
    {
      q: "Which federal programs fund fusion companies without taking equity?",
      hint: "7 programs · INFUSE nuance flagged",
      cat: "federal",
    },
    {
      q: "Show me climate and energy VCs ranked by assets under management",
      hint: "3,268 VC firms on file",
      cat: "equity",
    },
    {
      q: "What do you have on Lowercarbon Capital?",
      hint: "CRD 162946 · 25 funds · $3.13B",
      cat: "equity",
    },
    {
      q: "Who raised money under Reg D in the last 90 days?",
      hint: "live SEC filings through 2026Q1",
      cat: "equity",
    },
    {
      q: "Chart foundation giving by fiscal year",
      hint: "2.3M grants, grouped in SQL",
      cat: "grant",
    },
  ];

  return (
    <div className="page-enter mx-auto flex w-full max-w-[1200px] flex-1 flex-col px-6 pb-10">
      {!active ? (
        <section className="relative flex flex-col items-center gap-10 pb-4 pt-16">
          <div className="ledger-ruling pointer-events-none absolute inset-0 -z-10" aria-hidden />
          <div className="flex flex-col items-center gap-1">
            <span className="mono-label">
              public record · refreshed{" "}
              {new Date(totals.refreshed_at).toISOString().slice(0, 10)}
            </span>
          </div>
          <CensusCounter
            value={totals.events}
            label="funding events, traceable to source."
            caption={`sha256-verified against ${countFull(totals.raw_files)} source files`}
          />
          <CompositionBar data={eventTypes} />
          <div className="flex flex-wrap justify-center gap-3">
            <StatTile label="organizations" value={totals.orgs} href="/browse" />
            <StatTile label="people" value={totals.people} />
            <StatTile label="relationships" value={totals.relationships} />
            <StatTile label="federal programs" value={totals.programs} href="/programs" />
            <StatTile label="source files" value={totals.raw_files} href="/data" />
          </div>
        </section>
      ) : (
        <section className="flex items-center justify-center gap-6 border-b border-border-1 py-3">
          <span className="tnum font-mono text-[11px] text-ink-3">
            {countFull(totals.orgs)} organizations · {countFull(totals.events)}{" "}
            funding events · every fact traced to a public filing
          </span>
        </section>
      )}

      <ChatView
        suggestions={suggestions}
        seedQuery={seedQuery}
        onActiveChange={setActive}
      />

      {!active && (
        <footer className="mt-10 text-center">
          <span className="text-[12.5px] text-ink-4">
            Read-only · Public-domain data spine · Every fact traces to a
            sha256-hashed source file
          </span>
        </footer>
      )}
    </div>
  );
}
