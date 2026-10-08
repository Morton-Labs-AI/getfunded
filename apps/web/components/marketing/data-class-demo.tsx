import { FileCheck, Sparkles, User } from "lucide-react";

import { AiBadge, AiCard } from "@/components/data/ai-badge";
import { Missing } from "@/components/data/missing";
import { Money } from "@/components/data/money";
import { Posture } from "@/components/data/posture";
import { ProvenanceSeal } from "@/components/data/provenance-seal";
import { SourceChip, SourceValue } from "@/components/data/source-chip";
import { YoursBlock, YoursTag } from "@/components/data/yours-tag";

import { DATA_CLASSES } from "./copy";

/**
 * The three data classes, shown with the real components the product uses.
 * Every value here is an obviously-placeholder example, labelled as such.
 */

const EXAMPLE_SHA = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

function ClassCard({
  tone,
  icon: Icon,
  name,
  summary,
  body,
  children,
}: {
  tone: "source" | "ai" | "yours";
  icon: typeof FileCheck;
  name: string;
  summary: string;
  body: string;
  children: React.ReactNode;
}) {
  const color = tone === "source" ? "text-source" : tone === "ai" ? "text-ai" : "text-yours";
  return (
    <div className="flex flex-col rounded-lg border bg-card shadow-card">
      <div className="border-b p-5">
        <div className={`flex items-center gap-2 ${color}`}>
          <Icon className="size-4" aria-hidden />
          <h3 className="eyebrow">{name}</h3>
        </div>
        <p className="mt-2 font-semibold text-foreground">{summary}</p>
        <p className="mt-1 text-sm text-pretty text-muted-foreground">{body}</p>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-5">
        <p className="eyebrow text-ink-4">Example</p>
        {children}
      </div>
    </div>
  );
}

export function DataClassDemo() {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <ClassCard tone="source" icon={FileCheck} {...DATA_CLASSES.source}>
        <div className="flex flex-wrap items-center gap-2">
          <SourceChip
            label="IRS 990-PF · FY2023"
            provenance={
              <ProvenanceSeal source="IRS 990-PF e-file" filingYear={2023} sha256={EXAMPLE_SHA} license="Public domain" />
            }
          />
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-ink-3">Grants paid</dt>
          <dd>
            <SourceValue
              label="Grants paid, verified from filings"
              provenance={<ProvenanceSeal source="IRS 990-PF e-file" filingYear={2023} sha256={EXAMPLE_SHA} />}
            >
              <Money value={1_000_000} />
            </SourceValue>
          </dd>
          <dt className="text-ink-3">Total revenue</dt>
          <dd>
            <Missing />
          </dd>
          <dt className="text-ink-3">Applications</dt>
          <dd className="flex flex-wrap gap-1.5">
            <Posture value="open" />
          </dd>
          <dt className="text-ink-3">Or</dt>
          <dd className="flex flex-wrap gap-1.5">
            <Posture value="unknown" />
          </dd>
        </dl>
        <p className="text-xs text-ink-3">A missing line reads &ldquo;Not available.&rdquo; An absent statement reads &ldquo;Not stated in filings.&rdquo;</p>
      </ClassCard>

      <ClassCard tone="ai" icon={Sparkles} {...DATA_CLASSES.ai}>
        <AiCard
          title="Fit analysis"
          reason="Example only. A real analysis cites evidence ids from the filing package it was given."
          meta={<span className="text-xs text-ink-3">2 citations</span>}
        >
          <p className="text-sm text-ink-2">
            Example: recent grants went to food programs in the same county as your organization{" "}
            <span className="font-mono text-xs text-ai">[E1]</span>. Typical grant size is close to your ask{" "}
            <span className="font-mono text-xs text-ai">[E2]</span>.
          </p>
          <p className="mt-2 text-xs text-ink-3">Accept, edit or dismiss. Your verdict is recorded.</p>
        </AiCard>
        <p className="text-xs text-ink-3">
          The <AiBadge className="align-middle" /> badge appears on every machine-suggested value, in the app and in exports.
        </p>
      </ClassCard>

      <ClassCard tone="yours" icon={User} {...DATA_CLASSES.yours}>
        <div className="flex flex-wrap gap-1.5">
          <YoursTag>Tier 1</YoursTag>
          <YoursTag label="Stage: Cultivating" />
        </div>
        <YoursBlock title="Your notes">
          <p className="text-sm text-ink-2">
            Example: met the program officer at the regional conference. Next action: send a two-page summary.
          </p>
        </YoursBlock>
        <p className="text-xs text-ink-3">Stages, tiers, owners, tasks and notes live here. Nothing in this class ever reads as a filing fact.</p>
      </ClassCard>
    </div>
  );
}
