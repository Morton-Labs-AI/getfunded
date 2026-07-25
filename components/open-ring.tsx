/**
 * The Open Ring — the Greenbook mark. Three arcs, one per money type
 * (equity / grant / federal), with visible gaps: the ring is *open*.
 * Pure SVG strokes; `mono` renders the single-arc variant for tiny sizes.
 */
export function OpenRing({
  size = 24,
  mono = false,
  className,
}: {
  size?: number;
  mono?: boolean;
  className?: string;
}) {
  if (mono) {
    return (
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill="none"
        aria-hidden
        className={className}
      >
        <circle
          cx="12"
          cy="12"
          r="9"
          stroke="var(--ink-1)"
          strokeWidth="2.5"
          strokeLinecap="round"
          pathLength={360}
          strokeDasharray="300 60"
          transform="rotate(-135 12 12)"
        />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      aria-hidden
      className={className}
    >
      <g strokeWidth="2.5" strokeLinecap="round" transform="rotate(-90 12 12)">
        <circle
          cx="12"
          cy="12"
          r="9"
          stroke="var(--cat-federal)"
          pathLength={360}
          strokeDasharray="100 260"
        />
        <circle
          cx="12"
          cy="12"
          r="9"
          stroke="var(--cat-grant)"
          pathLength={360}
          strokeDasharray="100 260"
          strokeDashoffset={-120}
        />
        <circle
          cx="12"
          cy="12"
          r="9"
          stroke="var(--cat-equity)"
          pathLength={360}
          strokeDasharray="100 260"
          strokeDashoffset={-240}
        />
      </g>
    </svg>
  );
}

/** The Seal variant: the ring as a stamp (provenance popovers). */
export function OpenSeal({ size = 28 }: { size?: number }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-full border border-border-2 bg-inset"
      style={{ width: size, height: size }}
    >
      <OpenRing size={Math.round(size * 0.58)} />
    </span>
  );
}
