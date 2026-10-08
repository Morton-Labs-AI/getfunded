import { cn } from "@/lib/utils";

import { CopyButton } from "./copy-button";

/**
 * A command or code block for the marketing site and docs. Mono, scrolls
 * sideways on a phone instead of breaking the layout, with a copy button.
 */
export function CodeBlock({
  code,
  title,
  lang,
  copy = true,
  className,
}: {
  code: string;
  title?: string;
  lang?: string;
  copy?: boolean;
  className?: string;
}) {
  return (
    <figure data-slot="code-block" className={cn("overflow-hidden rounded-lg border bg-inset/70", className)}>
      {title || copy ? (
        <figcaption className="flex items-center justify-between gap-2 border-b px-3 py-1.5">
          <span className="eyebrow text-muted-foreground">{title ?? lang ?? "code"}</span>
          {copy ? <CopyButton text={code} /> : null}
        </figcaption>
      ) : null}
      <pre className="overflow-x-auto p-4 text-[13px] leading-relaxed text-ink-2">
        <code className={lang ? `language-${lang}` : undefined}>{code}</code>
      </pre>
    </figure>
  );
}
