import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, ArrowUpRight, ChevronDown } from "lucide-react";

import { DocToc, DocsNav } from "@/components/marketing/docs-nav";
import { repoFile } from "@/components/marketing/links";
import { Markdown } from "@/components/marketing/markdown";
import { Container } from "@/components/marketing/section";
import { DOC_GROUP_LABELS, docGroups, docNeighbours, getDoc, listDocs } from "@/lib/docs";

type Params = { slug: string };

export function generateStaticParams(): Params[] {
  return listDocs().map((doc) => ({ slug: doc.slug }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const doc = getDoc(slug);
  if (!doc) return { title: "Guide not found" };
  return {
    title: doc.title,
    description: doc.description,
    alternates: { canonical: `/docs/${doc.slug}` },
  };
}

export default async function DocPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const doc = getDoc(slug);
  if (!doc) notFound();

  const groups = docGroups();
  const { prev, next } = docNeighbours(doc.slug);

  return (
    <Container className="py-8 sm:py-12">
      <div className="grid gap-8 lg:grid-cols-[14rem_minmax(0,1fr)] xl:grid-cols-[14rem_minmax(0,1fr)_12rem]">
        <aside className="lg:sticky lg:top-20 lg:self-start">
          {/* Phone: a collapsed list. Wide screens: always open. */}
          <details className="group rounded-lg border bg-card lg:hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-sm font-medium text-foreground [&::-webkit-details-marker]:hidden">
              All guides
              <ChevronDown className="size-4 text-ink-4 transition-transform duration-150 group-open:rotate-180" aria-hidden />
            </summary>
            <div className="border-t p-2">
              <DocsNav groups={groups} current={doc.slug} />
            </div>
          </details>
          <DocsNav groups={groups} current={doc.slug} className="hidden lg:block" />
        </aside>

        <article className="min-w-0">
          <p className="eyebrow text-primary">{DOC_GROUP_LABELS[doc.group]}</p>
          <h1 className="mt-2 font-display text-3xl font-medium tracking-tight text-balance text-foreground sm:text-4xl">
            {doc.title}
          </h1>
          <p className="mt-3 text-lg text-pretty text-muted-foreground">{doc.description}</p>

          <div className="mt-6 xl:hidden">
            <DocToc headings={doc.headings} />
          </div>

          <div className="mt-8 border-t pt-6">
            <Markdown body={doc.body} hideTitle />
          </div>

          <footer className="mt-10 border-t pt-6">
            <div className="grid gap-3 sm:grid-cols-2">
              {prev ? (
                <Link
                  href={`/docs/${prev.slug}`}
                  className="flex items-center gap-2 rounded-lg border bg-card p-4 text-sm transition-colors duration-150 hover:border-primary-border"
                >
                  <ArrowLeft className="size-4 shrink-0 text-ink-4" aria-hidden />
                  <span>
                    <span className="block text-xs text-ink-3">Previous</span>
                    <span className="font-medium text-foreground">{prev.title}</span>
                  </span>
                </Link>
              ) : (
                <span />
              )}
              {next ? (
                <Link
                  href={`/docs/${next.slug}`}
                  className="flex items-center justify-end gap-2 rounded-lg border bg-card p-4 text-right text-sm transition-colors duration-150 hover:border-primary-border"
                >
                  <span>
                    <span className="block text-xs text-ink-3">Next</span>
                    <span className="font-medium text-foreground">{next.title}</span>
                  </span>
                  <ArrowRight className="size-4 shrink-0 text-ink-4" aria-hidden />
                </Link>
              ) : null}
            </div>
            <p className="mt-6 text-xs text-ink-3">
              Found a mistake?{" "}
              <a
                href={repoFile(`apps/web/content/docs/${doc.slug}.md`)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 underline underline-offset-4 hover:text-foreground"
              >
                Edit this page on GitHub
                <ArrowUpRight className="size-3" aria-hidden />
              </a>
            </p>
          </footer>
        </article>

        <aside className="hidden xl:sticky xl:top-20 xl:block xl:self-start">
          <DocToc headings={doc.headings} />
        </aside>
      </div>
    </Container>
  );
}
