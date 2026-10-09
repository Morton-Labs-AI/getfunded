import { orgCategory, eventCategory, ORG_TYPE_LABELS, EVENT_TYPE_LABELS } from "@/lib/format";

const CAT_LABEL: Record<string, string> = {
  equity: "equity",
  grant: "grant",
  federal: "federal",
};

/** One badge anatomy everywhere: 3px category bar + mono-caps label + tint. */
export function TrichotomyBadge({
  orgType,
  eventType,
  label,
}: {
  orgType?: string;
  eventType?: string;
  label?: string;
}) {
  const cat = orgType ? orgCategory(orgType) : eventType ? eventCategory(eventType) : null;
  const text =
    label ??
    (orgType ? ORG_TYPE_LABELS[orgType] ?? orgType : EVENT_TYPE_LABELS[eventType ?? ""] ?? eventType);
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-[5px] py-[3px] pl-1.5 pr-2"
      style={{ background: cat ? `var(--cat-${cat}-tint)` : "var(--bg-inset)" }}
    >
      <span
        className="h-3 w-[3px] rounded-[1.5px]"
        style={{ background: cat ? `var(--cat-${cat})` : "var(--ink-4)" }}
      />
      <span
        className="font-mono text-[10.5px] font-medium uppercase tracking-[0.08em]"
        style={{ color: cat ? `var(--cat-${cat})` : "var(--ink-3)" }}
      >
        {text}
      </span>
    </span>
  );
}

/** The category accent rule under a profile title. */
export function CategoryRule({ orgType }: { orgType: string }) {
  const cat = orgCategory(orgType);
  if (!cat) return <div className="h-[2px] w-full bg-border-1" />;
  return <div className="h-[2px] w-full" style={{ background: `var(--cat-${cat})` }} />;
}
