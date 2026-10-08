import Link from "next/link";

import type { DocGroup, DocMeta } from "@/lib/docs";
import { cn } from "@/lib/utils";

/**
 * The docs sidebar: guides grouped for nonprofits and for developers. On a
 * phone the page wraps it in a <details> so it does not push the article
 * down; on wide screens it is a sticky column.
 */
export function DocsNav({
  groups,
  current,
  className,
}: {
  groups: Array<{ group: DocGroup; label: string; docs: DocMeta[] }>;
  current?: string;
  className?: string;
}) {
  return (
    <nav aria-label="Guides" className={cn("text-sm", className)}>
      <Link
        href="/docs"
        aria-current={current === undefined ? "page" : undefined}
        className={cn(
          "block rounded-md px-2.5 py-1.5 font-medium text-ink-2 hover:bg-accent hover:text-foreground",
          current === undefined && "bg-primary-tint text-primary",
        )}
      >
        All guides
      </Link>
      {groups.map((group) => (
        <div key={group.group} className="mt-4">
          <p className="eyebrow px-2.5 text-muted-foreground">{group.label}</p>
          <ul className="mt-1.5 space-y-0.5">
            {group.docs.map((doc) => {
              const active = doc.slug === current;
              return (
                <li key={doc.slug}>
                  <Link
                    href={`/docs/${doc.slug}`}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "block rounded-md px-2.5 py-1.5 text-ink-2 transition-colors duration-150 hover:bg-accent hover:text-foreground",
                      active && "bg-primary-tint font-medium text-primary hover:bg-primary-tint hover:text-primary",
                    )}
                  >
                    {doc.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** In-page table of contents for one guide. */
export function DocToc({ headings }: { headings: Array<{ id: string; text: string; level: 2 | 3 }> }) {
  const h2s = headings.filter((h) => h.level === 2);
  if (h2s.length < 2) return null;
  return (
    <nav aria-label="On this page" className="text-sm">
      <p className="eyebrow text-muted-foreground">On this page</p>
      <ul className="mt-2 space-y-1 border-l pl-3">
        {h2s.map((h) => (
          <li key={h.id}>
            <a href={`#${h.id}`} className="block py-0.5 text-ink-3 hover:text-foreground">
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
