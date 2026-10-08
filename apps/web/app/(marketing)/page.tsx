import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Bot, FileCheck, Search, Sparkles, Sprout } from "lucide-react";

import { CodeBlock } from "@/components/marketing/code-block";
import { AGENT_PROMPT, HONESTY_RULES, HOW_IT_WORKS, SELF_INSTALL_STEPS } from "@/components/marketing/copy";
import { CtaBand } from "@/components/marketing/cta";
import { DataClassDemo } from "@/components/marketing/data-class-demo";
import { LINKS } from "@/components/marketing/links";
import { ProofPoints } from "@/components/marketing/live-stats";
import { Container, Section, SectionHeading, Steps } from "@/components/marketing/section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatNumber } from "@/lib/format";
import { CREDIT_COSTS, PLANS, formatPlanPrice, type Feature } from "@/lib/plans";
import { site } from "@/lib/site";

/** How many runs of a feature a monthly allowance buys. */
function perMonth(credits: number | null, feature: Feature): number | null {
  return credits === null ? null : Math.floor(credits / CREDIT_COSTS[feature]);
}

export const metadata: Metadata = {
  title: { absolute: `${site.name} · ${site.tagline}` },
  description: site.description,
  alternates: { canonical: "/" },
};

function Hero() {
  return (
    <div className="border-b bg-surface">
      <Container className="flex flex-col items-center pt-16 pb-14 text-center sm:pt-24 sm:pb-20">
        <p className="eyebrow text-primary">Open fundraising database</p>
        <h1 className="mt-4 max-w-3xl font-display text-4xl font-medium tracking-tight text-balance text-foreground sm:text-5xl md:text-6xl">
          {site.tagline}
        </h1>
        <p className="mt-5 max-w-xl text-lg text-balance text-muted-foreground">
          Search every U.S. foundation by what it has actually funded, straight from public IRS filings. Verified facts
          stay verified. Anything our AI adds is labelled.
        </p>

        <form action="/search" method="get" role="search" className="mt-8 flex w-full max-w-xl flex-col gap-2 sm:flex-row">
          <Label htmlFor="q" className="sr-only">
            Describe your work
          </Label>
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              id="q"
              name="q"
              type="search"
              autoComplete="off"
              enterKeyHint="search"
              placeholder="Try “youth mental health in Oregon”"
              className="h-11 pl-9 text-base"
            />
          </div>
          <Button type="submit" size="lg" className="h-11">
            Search funders
          </Button>
        </form>
        <p className="mt-3 text-xs text-ink-3">Free. No account needed. Search never uses AI credits.</p>

        <ul className="mt-8 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
          <li className="inline-flex items-center gap-1.5">
            <FileCheck className="size-4 text-source" aria-hidden />
            Verified from IRS filings
          </li>
          <li className="inline-flex items-center gap-1.5">
            <Sparkles className="size-4 text-ai" aria-hidden />
            AI suggestions always labelled
          </li>
          <li className="inline-flex items-center gap-1.5">
            <Sprout className="size-4 text-primary" aria-hidden />
            Open source, open data
          </li>
        </ul>
      </Container>
    </div>
  );
}

function FreeVsPaid() {
  const free = PLANS.free;
  const starter = PLANS.starter;
  const pro = PLANS.pro;
  const team = PLANS.team;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="rounded-lg border border-primary-border bg-card p-6 shadow-card">
        <p className="eyebrow text-primary">Free</p>
        <p className="tnum mt-2 font-mono text-3xl font-semibold text-foreground">{formatPlanPrice(free)}</p>
        <ul className="mt-4 space-y-2 text-sm text-ink-2">
          <li>Unlimited funder search and full profiles: where every fact came from, and whether the funder says it accepts applications</li>
          <li>
            {formatNumber(free.monthly_credits)} AI credits a month: about {formatNumber(perMonth(free.monthly_credits, "fit"))} fit
            analyses or {formatNumber(perMonth(free.monthly_credits, "research"))} web research reports
          </li>
          <li>{formatNumber(free.saved_funders_limit)} saved funders and one pipeline</li>
          <li>Outreach drafts (uses credits), {formatNumber(free.export_rows)}-row CSV export</li>
        </ul>
        <Button className="mt-6 w-full sm:w-auto" asChild>
          <Link href="/signin">Start free</Link>
        </Button>
      </div>
      <div className="rounded-lg border bg-card p-6 shadow-card">
        <p className="eyebrow text-muted-foreground">Paid plans</p>
        <p className="tnum mt-2 font-mono text-3xl font-semibold text-foreground">
          from {formatPlanPrice(starter)}
          <span className="font-sans text-base font-normal text-ink-3"> / month</span>
        </p>
        <ul className="mt-4 space-y-2 text-sm text-ink-2">
          <li>
            {formatNumber(starter.monthly_credits)} to {formatNumber(PLANS.enterprise.monthly_credits)} AI credits a month, more seats, full CSV export
          </li>
          <li>
            {pro.name} ({formatPlanPrice(pro)}): send outreach through your own Gmail, each message approved by you
          </li>
          <li>
            {team.name} ({formatPlanPrice(team)}): a knowledge base shared across the team, follow-ups that stop when a funder
            replies, and the API
          </li>
          <li>Paid use funds the free tier and the open-source project</li>
        </ul>
        <Button variant="outline" className="mt-6 w-full sm:w-auto" asChild>
          <Link href="/pricing">
            See all plans
            <ArrowRight aria-hidden />
          </Link>
        </Button>
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <>
      <Hero />

      <Section id="coverage" className="py-10 sm:py-14">
        <ProofPoints />
      </Section>

      <Section id="how-it-works" tone="surface">
        <SectionHeading eyebrow="How it works" title="Three steps from a sentence to a shortlist." />
        <div className="mt-10">
          <Steps steps={HOW_IT_WORKS} />
        </div>
      </Section>

      <Section id="data-classes">
        <SectionHeading
          eyebrow="Three kinds of information"
          title="You always know what you are reading."
          lede="Every value on a funder page is one of three kinds. Each kind looks different, and colour is never the only signal."
        />
        <div className="mt-10">
          <DataClassDemo />
        </div>
      </Section>

      <Section id="honest" tone="inset">
        <SectionHeading
          eyebrow="Honest by design"
          title="Seven rules every page keeps."
          lede="These are written into the project's governance. A change that breaks one is not merged."
        />
        <ol className="mt-10 grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
          {HONESTY_RULES.map((rule, i) => (
            <li key={rule.title} className="flex gap-3">
              <span aria-hidden className="tnum font-mono text-sm font-semibold text-primary">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div>
                <h3 className="font-semibold text-foreground">{rule.title}</h3>
                <p className="mt-1 text-sm text-pretty text-muted-foreground">{rule.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-8 text-sm text-ink-3">
          The full list, and how decisions are made, is on the{" "}
          <Link href="/open-source" className="underline underline-offset-4 hover:text-foreground">
            open source page
          </Link>
          .
        </p>
      </Section>

      <Section id="plans">
        <SectionHeading
          eyebrow="Free and paid"
          title="Search is free for everyone. Credits pay for the AI."
          lede="Only calls to a language model cost credits. Every plan includes every search and every profile."
        />
        <div className="mt-10">
          <FreeVsPaid />
        </div>
      </Section>

      <Section id="self-install" tone="surface">
        <SectionHeading
          eyebrow="Open source, self-install"
          title="Run the whole thing yourself."
          lede="Apache-2.0 code, CC BY 4.0 data, no plan limits. Three parts: build the database, create the app role, run the web app."
        />
        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          {SELF_INSTALL_STEPS.map((step) => (
            <CodeBlock key={step.title} title={step.title} lang={step.lang} code={step.code} />
          ))}
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button variant="outline" asChild>
            <Link href="/docs/self-install">Self-install guide</Link>
          </Button>
          <Button variant="ghost" asChild>
            <a href={LINKS.github} target="_blank" rel="noreferrer">
              View on GitHub
              <ArrowUpRight aria-hidden />
            </a>
          </Button>
        </div>
      </Section>

      <Section id="agents">
        <div className="grid gap-8 lg:grid-cols-[1fr_1.2fr] lg:items-start">
          <SectionHeading
            eyebrow="Built for AI agents"
            title="Written so a coding agent can install, run and extend it."
            lede={
              <>
                Each part of the repository has an <code className="font-mono text-[0.9em]">AGENTS.md</code> with the rules that
                matter: data honesty, the read-only corpus boundary, metering, no private data. Team plans add an API.
              </>
            }
          />
          <div>
            <CodeBlock title="A good first prompt for an agent" code={AGENT_PROMPT} />
            <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
              <li>
                <Link href="/docs/api" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                  <Bot className="size-4" aria-hidden />
                  API docs
                </Link>
              </li>
              <li>
                <a
                  href={LINKS.webAgents}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                >
                  apps/web/AGENTS.md
                  <ArrowUpRight className="size-3.5" aria-hidden />
                </a>
              </li>
              <li>
                <a
                  href={LINKS.architecture}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                >
                  docs/ARCHITECTURE.md
                  <ArrowUpRight className="size-3.5" aria-hidden />
                </a>
              </li>
            </ul>
          </div>
        </div>
      </Section>

      <CtaBand />
    </>
  );
}
