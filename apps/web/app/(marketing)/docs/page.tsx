import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BookOpen, Code2 } from "lucide-react";

import { CodeBlock } from "@/components/marketing/code-block";
import { AGENT_PROMPT } from "@/components/marketing/copy";
import { Container, PageHero } from "@/components/marketing/section";
import { docGroups } from "@/lib/docs";

export const metadata: Metadata = {
  title: "Docs",
  description:
    "Guides for nonprofit staff and for developers: getting started, search, funder profiles, AI and credits, workspace, outreach, self-install, API, data and license.",
  alternates: { canonical: "/docs" },
};

export default function DocsIndexPage() {
  const groups = docGroups();
  return (
    <>
      <PageHero
        eyebrow="Docs"
        title="Guides, in plain language."
        lede="Short pages with numbered steps. The first group is for nonprofit staff. The second is for developers and AI agents, with exact commands."
      />
      <Container className="py-10 sm:py-14">
        {groups.length === 0 ? (
          <p className="text-sm text-ink-3">No guides were found in this build.</p>
        ) : null}
        <div className="flex flex-col gap-12">
          {groups.map((group) => {
            const Icon = group.group === "developers" ? Code2 : BookOpen;
            return (
              <section key={group.group} aria-labelledby={`docs-${group.group}`}>
                <div className="flex items-center gap-2">
                  <Icon className="size-4 text-primary" aria-hidden />
                  <h2 id={`docs-${group.group}`} className="eyebrow text-muted-foreground">
                    {group.label}
                  </h2>
                </div>
                <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {group.docs.map((doc) => (
                    <li key={doc.slug}>
                      <Link
                        href={`/docs/${doc.slug}`}
                        className="group flex h-full flex-col rounded-lg border bg-card p-5 shadow-card transition-[border-color,box-shadow] duration-150 hover:border-primary-border hover:shadow-lift"
                      >
                        <h3 className="font-semibold text-foreground">{doc.title}</h3>
                        <p className="mt-1.5 flex-1 text-sm text-pretty text-muted-foreground">{doc.description}</p>
                        <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary">
                          Read
                          <ArrowRight className="size-3.5 transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>

        <section className="mt-14 grid gap-6 rounded-lg border bg-surface p-6 lg:grid-cols-[1fr_1.2fr] lg:items-center">
          <div>
            <p className="eyebrow text-primary">For AI agents</p>
            <h2 className="mt-2 font-display text-2xl font-medium tracking-tight text-foreground">
              Hand your agent this prompt.
            </h2>
            <p className="mt-2 text-sm text-pretty text-muted-foreground">
              The repository ships <code className="font-mono text-[0.9em]">AGENTS.md</code> files with the conventions that
              matter. An agent that reads them first makes fewer mistakes.
            </p>
          </div>
          <CodeBlock title="Prompt" code={AGENT_PROMPT} />
        </section>
      </Container>
    </>
  );
}
