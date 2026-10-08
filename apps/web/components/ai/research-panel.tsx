import { Suspense } from "react";
import { ExternalLink } from "lucide-react";

import { AiBadge, AiCard } from "@/components/data/ai-badge";
import { UpgradeNotice } from "@/components/settings/upgrade-notice";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AI_COPY } from "@/lib/ai/copy";
import { getLatestResearch, type LatestResearch } from "@/lib/ai/research";
import { aiMode } from "@/lib/billing/meter";
import { formatDate, formatDateTime } from "@/lib/format";
import { CREDIT_COSTS, can, isSelfHosted, planFor } from "@/lib/plans";
import { requireWorkspace } from "@/lib/workspace/context";

import { ResearchButton } from "./research-actions";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * "Research on the web" for one funder in the signed-in workspace. Server
 * component: loads the latest stored dossier (lib/ai/research → lib/ai/analyses)
 * under RLS and renders every section inside <AiCard />, each with the pages it
 * came from, so nothing machine-written ever reads as a fact. The button posts
 * to /api/ai/research, which meters CREDIT_COSTS.research and reuses a dossier
 * younger than RESEARCH_FRESH_DAYS unless forced.
 *
 * Reads the session, so it wraps itself in <Suspense>: drop it next to
 * <FitPanel /> on the funder page without extra plumbing.
 */
export function ResearchPanel(props: { orgId: string; savedFunderId?: string }) {
  return (
    <Suspense fallback={<ResearchPanelSkeleton />}>
      <ResearchPanelContent {...props} />
    </Suspense>
  );
}

export function ResearchPanelSkeleton() {
  return (
    <section data-slot="ai-card" className="data-ai p-4" aria-busy>
      <div className="mb-3 flex items-center gap-2">
        <AiBadge />
        <h3 className="text-[13px] font-semibold text-foreground">{AI_COPY.research.title}</h3>
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-8 w-40" />
      </div>
    </section>
  );
}

function isNextControlFlow(err: unknown): boolean {
  const digest = (err as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && /^NEXT_/.test(digest);
}

async function ResearchPanelContent({ orgId, savedFunderId }: { orgId: string; savedFunderId?: string }) {
  const { user, workspace } = await requireWorkspace();
  const plan = planFor(workspace);
  const selfHosted = isSelfHosted();

  if (!can(plan, "research")) {
    return (
      <AiCard title={AI_COPY.research.title}>
        <UpgradeNotice feature="research" selfHosted={selfHosted} compact />
      </AiCard>
    );
  }

  const aiDisabled = aiMode() === "disabled";
  const credits = CREDIT_COSTS.research;

  let latest: LatestResearch | null = null;
  let loadFailed = false;
  if (UUID_RE.test(orgId)) {
    try {
      latest = await getLatestResearch({ userId: user.id, workspaceId: workspace.id }, orgId);
    } catch (err) {
      if (isNextControlFlow(err)) throw err;
      loadFailed = true;
      console.error("[research-panel]", err instanceof Error ? `${err.name}: ${err.message}` : err);
    }
  }

  if (!latest) {
    return (
      <AiCard title={AI_COPY.research.title} reason={AI_COPY.research.emptyHint}>
        <div className="flex flex-col gap-3">
          <p className="text-sm text-foreground">{loadFailed ? "The last research could not be loaded right now." : AI_COPY.research.empty}</p>
          <p className="max-w-prose text-sm leading-6 text-ink-3">{AI_COPY.research.emptyHint}</p>
          {aiDisabled ? <DisabledNote /> : null}
          <ResearchButton orgId={orgId} savedFunderId={savedFunderId} hasDossier={false} credits={credits} aiDisabled={aiDisabled} />
          <p className="text-xs text-ink-4">{AI_COPY.disclaimer}</p>
        </div>
      </AiCard>
    );
  }

  const { row, dossier: d } = latest;
  const r = AI_COPY.research;

  return (
    <div className="flex flex-col gap-4" data-slot="research-panel">
      <AiCard
        title={r.title}
        reason={r.emptyHint}
        meta={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {row.isMock ? <Badge variant="outline">Test output</Badge> : null}
            <span className="tnum text-xs text-ink-3">
              Searched <time dateTime={row.createdAt}>{formatDateTime(row.createdAt)}</time>
            </span>
            <ResearchButton
              orgId={orgId}
              savedFunderId={savedFunderId ?? row.savedFunderId ?? undefined}
              hasDossier
              credits={credits}
              aiDisabled={aiDisabled}
              className="flex flex-col items-end gap-2"
            />
          </div>
        }
      >
        {aiDisabled ? <DisabledNote /> : null}
        <p className="text-sm leading-6 text-ink-2">{d.summary}</p>
        {d.whatTheyFund.length > 0 ? (
          <>
            <h4 className="mt-4 text-[13px] font-semibold text-foreground">{r.whatTheyFund}</h4>
            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm leading-6 text-ink-2">
              {d.whatTheyFund.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </>
        ) : null}
      </AiCard>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <AiCard title={r.inNews}>
          {d.recentGrantsInNews.length === 0 ? (
            <p className="text-sm text-ink-3">No recent grants were found in the news.</p>
          ) : (
            <ul className="space-y-3">
              {d.recentGrantsInNews.map((n, i) => (
                <li key={i} className="text-sm leading-6 text-ink-2">
                  <span className="font-medium text-foreground">{n.url ? <SourceLink href={n.url}>{n.headline}</SourceLink> : n.headline}</span>
                  {n.date ? <span className="tnum ml-1 text-xs text-ink-4">{newsDate(n.date)}</span> : null}
                  {n.detail ? <p className="mt-0.5">{n.detail}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </AiCard>
        <AiCard title={r.people}>
          {d.people.length === 0 ? (
            <p className="text-sm text-ink-3">{r.noPeople}</p>
          ) : (
            <ul className="space-y-2">
              {d.people.map((p, i) => (
                <li key={i} className="text-sm leading-6 text-ink-2">
                  <span className="font-medium text-foreground">{p.name}</span>
                  <span className="text-ink-3">, {p.role}</span>
                  {p.url ? (
                    <>
                      {" "}
                      <SourceLink href={p.url}>page that states the role</SourceLink>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-ink-4">Only roles the funder or a news page published. Never personal contact details.</p>
        </AiCard>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <AiCard title={r.approach}>
          {d.howToApproach ? <p className="text-sm leading-6 whitespace-pre-wrap text-ink-2">{d.howToApproach}</p> : <p className="text-sm text-ink-3">The pages found do not say how to apply.</p>}
        </AiCard>
        <AiCard title={r.cautions}>
          {d.cautions.length === 0 ? (
            <p className="text-sm text-ink-3">Nothing to flag from the pages found.</p>
          ) : (
            <ul className="list-disc space-y-1 pl-5 text-sm leading-6 text-ink-2">
              {d.cautions.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          )}
        </AiCard>
      </div>

      <AiCard title={r.sources}>
        {d.sources.length === 0 ? (
          <p className="text-sm text-ink-3">No web pages were cited.</p>
        ) : (
          <ol className="space-y-1.5 text-sm leading-6 text-ink-2">
            {d.sources.map((src, i) => (
              <li key={src.url} className="flex gap-2">
                <span className="tnum w-5 shrink-0 text-right font-mono text-xs text-ink-4">{i + 1}</span>
                <span className="min-w-0">
                  <SourceLink href={src.url}>{src.title}</SourceLink>
                  <span className="block truncate text-xs text-ink-4">{hostOf(src.url)}</span>
                </span>
              </li>
            ))}
          </ol>
        )}
        <p className="mt-3 flex items-center gap-2 text-xs text-ink-3">
          <AiBadge />
          {AI_COPY.disclaimer} Written from these pages on {formatDate(row.createdAt)}.
        </p>
      </AiCard>
    </div>
  );
}

function DisabledNote() {
  return (
    <p className="mb-3 rounded-md border border-border bg-inset px-3 py-2 text-sm text-ink-2" role="status">
      <span className="font-medium text-foreground">{AI_COPY.disabled.title}.</span> {AI_COPY.disabled.hint}
    </p>
  );
}

/** A link to a page the model cited. Always opens in a new tab; never a bare URL as the label. */
function SourceLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline underline-offset-4 hover:text-primary-hover">
      {children}
      <ExternalLink className="size-3 shrink-0" aria-hidden />
    </a>
  );
}

/** "example.org" from a URL, for the line under a source title. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** The model writes YYYY-MM-DD or YYYY-MM; show "Mar 2024" or "Mar 1, 2024", else the text as given. */
export function newsDate(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return formatDate(value);
  if (/^\d{4}-\d{2}$/.test(value)) return formatDate(`${value}-01`, "month");
  return value;
}
