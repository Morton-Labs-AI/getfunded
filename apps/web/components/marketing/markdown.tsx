import * as React from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Element } from "hast";

import { slugifyHeading } from "@/lib/docs";
import { cn } from "@/lib/utils";

import { CodeBlock } from "./code-block";

/**
 * Markdown for the docs and the changelog: react-markdown + GFM, mapped to
 * the site's type scale and tokens. Headings get stable ids so the sidebar
 * and in-page links work; code blocks scroll sideways on a phone; external
 * links open in a new tab with an icon; tables scroll instead of overflowing.
 */

function textOf(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

/** The source text and language of a fenced block, from the hast `pre` node. */
function fencedCode(node: Element | undefined): { code: string; lang?: string } {
  const code = node?.children.find((c): c is Element => c.type === "element" && c.tagName === "code");
  const text = code?.children.map((c) => (c.type === "text" ? c.value : "")).join("") ?? "";
  const classes = code?.properties?.className;
  const list = Array.isArray(classes) ? classes.map(String) : typeof classes === "string" ? [classes] : [];
  const lang = list.find((c) => c.startsWith("language-"))?.slice("language-".length);
  return { code: text.replace(/\n$/, ""), lang };
}

/** Drop the first `# Title` line: the page renders the title itself. */
export function stripLeadingH1(body: string): string {
  return body.replace(/^\s*#\s+[^\n]*\n+/, "");
}

export function Markdown({ body, hideTitle = false, className }: { body: string; hideTitle?: boolean; className?: string }) {
  const seen = new Map<string, number>();
  const headingId = (children: React.ReactNode) => {
    let id = slugifyHeading(textOf(children));
    const count = seen.get(id) ?? 0;
    seen.set(id, count + 1);
    if (count > 0) id = `${id}-${count + 1}`;
    return id;
  };

  const components: Components = {
    h1: ({ children }) => (
      <h1 className="mt-10 mb-4 font-display text-3xl font-medium tracking-tight text-foreground first:mt-0 sm:text-4xl">
        {children}
      </h1>
    ),
    h2: ({ children }) => {
      const id = headingId(children);
      return (
        <h2 id={id} className="group mt-10 mb-3 scroll-mt-24 text-xl font-semibold tracking-tight text-foreground first:mt-0">
          <a href={`#${id}`} className="no-underline hover:underline">
            {children}
          </a>
        </h2>
      );
    },
    h3: ({ children }) => {
      const id = headingId(children);
      return (
        <h3 id={id} className="mt-7 mb-2 scroll-mt-24 text-base font-semibold text-foreground">
          <a href={`#${id}`} className="no-underline hover:underline">
            {children}
          </a>
        </h3>
      );
    },
    h4: ({ children }) => <h4 className="mt-5 mb-1.5 text-sm font-semibold text-foreground">{children}</h4>,
    p: ({ children }) => <p className="my-3 leading-7 text-pretty text-ink-2">{children}</p>,
    a: ({ href, children }) => {
      const url = href ?? "";
      if (url.startsWith("/") || url.startsWith("#")) {
        return (
          <Link href={url} className="font-medium text-primary underline underline-offset-4 hover:text-primary-hover">
            {children}
          </Link>
        );
      }
      return (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-baseline gap-0.5 font-medium text-primary underline underline-offset-4 hover:text-primary-hover"
        >
          {children}
          <ArrowUpRight className="size-3 translate-y-px text-ink-4" aria-hidden />
        </a>
      );
    },
    ul: ({ children }) => <ul className="my-3 list-disc space-y-1.5 pl-6 leading-7 text-ink-2 marker:text-ink-4">{children}</ul>,
    ol: ({ children }) => (
      <ol className="my-3 list-decimal space-y-1.5 pl-6 leading-7 text-ink-2 marker:font-medium marker:text-ink-3">{children}</ol>
    ),
    li: ({ children }) => <li className="pl-1 [&>p]:my-1">{children}</li>,
    blockquote: ({ children }) => (
      <blockquote className="my-4 border-l-2 border-primary-border bg-primary-tint/50 px-4 py-2 text-ink-2 [&>p]:my-1">
        {children}
      </blockquote>
    ),
    hr: () => <hr className="my-8 border-border" />,
    strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
    code: ({ children }) => (
      <code className="rounded-sm border bg-inset px-1 py-0.5 font-mono text-[0.85em] text-ink">{children}</code>
    ),
    pre: ({ node }) => {
      const { code, lang } = fencedCode(node);
      return <CodeBlock code={code} lang={lang} className="my-4" />;
    },
    table: ({ children }) => (
      <div className="my-4 w-full overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead className="bg-inset/70 [&_tr]:border-b">{children}</thead>,
    tbody: ({ children }) => <tbody className="[&_tr:last-child]:border-0">{children}</tbody>,
    tr: ({ children }) => <tr className="border-b align-top">{children}</tr>,
    th: ({ children }) => <th className="eyebrow px-3 py-2 text-left whitespace-nowrap text-muted-foreground">{children}</th>,
    td: ({ children }) => <td className="px-3 py-2 leading-6 text-ink-2">{children}</td>,
  };

  return (
    <div data-slot="markdown" className={cn("text-[15px]", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {hideTitle ? stripLeadingH1(body) : body}
      </ReactMarkdown>
    </div>
  );
}
