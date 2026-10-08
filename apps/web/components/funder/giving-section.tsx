import { Missing } from "@/components/data/missing";
import { GIVING_FOCUS_NOTE, NTEE_CAVEAT } from "@/lib/content/copy";
import { formatMoneyCompact, formatNumber, toNumber } from "@/lib/format";
import type { GivingProfile } from "@/lib/queries/corpus/types";

import { ProfileSection } from "./profile-section";

/** What they fund: recipient focus areas and states, from the grant rows. */
export function GivingSection({ profile }: { profile: GivingProfile }) {
  const hasFocus = profile.focus.length > 0;
  const hasGeo = profile.geography.length > 0;
  if (!hasFocus && !hasGeo) return null;

  const max = Math.max(...profile.focus.map((f) => toNumber(f.total) ?? 0), 1);

  return (
    <ProfileSection
      id="giving"
      title="What they fund"
      note={
        <>
          {GIVING_FOCUS_NOTE(profile.resolvedPct)} {NTEE_CAVEAT}
        </>
      }
    >
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div>
          <p className="eyebrow mb-2 text-muted-foreground">Recipient focus areas</p>
          {hasFocus ? (
            <ul className="space-y-1.5">
              {profile.focus.map((f) => {
                const total = toNumber(f.total) ?? 0;
                return (
                  <li key={f.major} className="flex flex-col gap-1 text-[13px] sm:flex-row sm:items-center sm:gap-3">
                    <span className="flex items-baseline justify-between gap-3 sm:contents">
                      <span className="min-w-0 truncate text-ink-2 sm:w-40 sm:shrink-0" title={f.label}>
                        {f.label}
                      </span>
                      <span className="tnum shrink-0 text-right text-ink-3 sm:order-last sm:w-24">
                        {f.total ? formatMoneyCompact(f.total) : <Missing bare />} · {formatNumber(f.n)}
                      </span>
                    </span>
                    <div className="h-5 w-full flex-1 overflow-hidden rounded-sm bg-inset sm:w-auto">
                      <div className="h-full rounded-sm" style={{ width: `${Math.max(total > 0 ? 6 : 2, (total / max) * 100)}%`, background: "var(--chart-1)" }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <Missing kind="no-public-data" />
          )}
        </div>
        <div>
          <p className="eyebrow mb-2 text-muted-foreground">Where recipients are</p>
          {hasGeo ? (
            <ul className="flex flex-wrap gap-2">
              {profile.geography.map((g) => (
                <li key={g.state} className="rounded-sm border bg-inset px-2 py-1 text-xs">
                  <span className="font-medium text-foreground">{g.state === "??" ? "Not stated" : g.state}</span>{" "}
                  <span className="tnum text-ink-3">
                    {g.total ? formatMoneyCompact(g.total) : <Missing bare />} · {formatNumber(g.n)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Missing kind="no-public-data" />
          )}
        </div>
      </div>
    </ProfileSection>
  );
}
