import { SourceGlyph } from "@/components/source-glyph";
import { moneyFull, moneyRegister, MDASH } from "@/lib/format";

/** Shared profile-page primitives, extracted from app/org/[id]/page.tsx the
    moment a second consumer (the filing page) appeared. Rendering is
    byte-identical to the originals. */

export function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-border-1 py-7 last:border-0">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <h2 className="text-[19px] font-semibold tracking-[-0.015em] text-ink-1">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function MoneyStat({
  label,
  value,
  prov,
}: {
  label: string;
  value: string | null;
  prov: Parameters<typeof SourceGlyph>[0]["prov"];
}) {
  const reg = moneyRegister(value);
  return (
    <div className="flex flex-col gap-1">
      <span className="mono-label">{label}</span>
      <SourceGlyph prov={prov}>
        {reg ? (
          <span
            className="tnum text-[30px] font-[620] leading-9 tracking-[-0.02em] text-ink-1"
            title={value ? moneyFull(value) : undefined}
          >
            <span className="text-[0.72em] font-medium text-ink-3">{reg.symbol}</span>
            {reg.digits}
            <span className="text-[0.72em] font-medium text-ink-3">{reg.suffix}</span>
          </span>
        ) : (
          <span className="text-[30px] font-[620] leading-9 text-ink-4">{MDASH}</span>
        )}
      </SourceGlyph>
    </div>
  );
}
