import Link from "next/link";
import { ArrowRight, KeyRound, Mail, Search, Sparkles, type LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AiHealth } from "@/lib/billing/health";

import { UpgradeNotice } from "./upgrade-notice";

export type IntegrationsView = {
  ai: AiHealth;
  /** Steward flag; null when unknown. */
  aiFlagEnabled: boolean | null;
  semanticSearch: boolean;
  gmail: { configured: boolean; allowed: boolean; connected: number };
  api: { allowed: boolean; activeKeys: number };
  selfHosted: boolean;
};

function StatusBadge({ tone, children }: { tone: "success" | "warning" | "danger" | "secondary"; children: React.ReactNode }) {
  return <Badge variant={tone}>{children}</Badge>;
}

function IntegrationCard({
  icon: Icon,
  title,
  status,
  children,
  action,
}: {
  icon: LucideIcon;
  title: string;
  status: React.ReactNode;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Icon className="size-4 text-ink-3" aria-hidden />
          {title}
          {status}
        </CardTitle>
        <CardDescription className="leading-6">{children}</CardDescription>
      </CardHeader>
      {action ? <CardContent>{action}</CardContent> : null}
    </Card>
  );
}

/** What is wired up on this deployment and for this workspace. Read-only; no secrets reach the page. */
export function IntegrationsPanel({ view }: { view: IntegrationsView }) {
  const aiOn = view.ai === "enabled" && view.aiFlagEnabled !== false;
  const aiStatus =
    view.ai === "mock" ? (
      <StatusBadge tone="warning">Mock</StatusBadge>
    ) : view.ai === "disabled" ? (
      <StatusBadge tone="danger">Off</StatusBadge>
    ) : view.aiFlagEnabled === false ? (
      <StatusBadge tone="warning">Paused</StatusBadge>
    ) : (
      <StatusBadge tone="success">Enabled</StatusBadge>
    );

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <IntegrationCard icon={Sparkles} title="AI" status={aiStatus}>
        {view.ai === "mock"
          ? "This install runs the AI in mock mode: answers are deterministic placeholders, cost nothing and are labelled as mock. Set AI_MODE to live with an ANTHROPIC_API_KEY to use a real model."
          : view.ai === "disabled"
            ? "AI is turned off for this deployment (AI_ENABLED=false). Search and funder profiles still work; nothing is sent to a model."
            : view.aiFlagEnabled === false
              ? "The steward has paused AI features for everyone. Search and funder profiles still work."
              : "Fit analysis, research dossiers, draft polish, natural-language filters and Ask the analyst are available. Every output is labelled AI and cites the evidence it was given."}
        {aiOn ? " Credits are metered per call; see Billing." : ""}
      </IntegrationCard>

      <IntegrationCard
        icon={Search}
        title="Semantic search"
        status={view.semanticSearch ? <StatusBadge tone="success">Enabled</StatusBadge> : <StatusBadge tone="secondary">Keyword only</StatusBadge>}
      >
        {view.semanticSearch
          ? "“Funds work like mine” search uses a query embedding (Voyage AI, 512 dimensions) over the foundation index. Public charities are matched by name and EIN."
          : "No VOYAGE_API_KEY on this install, so search matches names, EINs and filters only. A visible notice says so on the search page."}
      </IntegrationCard>

      <IntegrationCard
        icon={Mail}
        title="Gmail"
        status={
          view.gmail.connected > 0 ? (
            <StatusBadge tone="success">Connected</StatusBadge>
          ) : !view.gmail.configured ? (
            <StatusBadge tone="secondary">Not configured</StatusBadge>
          ) : (
            <StatusBadge tone="secondary">Not connected</StatusBadge>
          )
        }
        action={
          view.gmail.allowed ? (
            <Button asChild variant="outline" size="sm">
              <Link href="/app/outreach/settings">
                Outreach settings
                <ArrowRight aria-hidden />
              </Link>
            </Button>
          ) : (
            <UpgradeNotice feature="send_gmail" compact selfHosted={view.selfHosted} />
          )
        }
      >
        {view.gmail.connected > 0
          ? `You have ${view.gmail.connected} connected ${view.gmail.connected === 1 ? "mailbox" : "mailboxes"} in this workspace. Each message is approved by you before it is sent.`
          : !view.gmail.configured
            ? "This install has no Google OAuth client (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET). Drafting works on every plan; sending needs the operator to configure it."
            : "Connect your own Gmail to send approved outreach one message at a time, under a daily cap you set. Tokens are encrypted at rest and only you can read them."}
      </IntegrationCard>

      <IntegrationCard
        icon={KeyRound}
        title="Public API"
        status={
          view.api.allowed ? (
            <StatusBadge tone={view.api.activeKeys > 0 ? "success" : "secondary"}>
              {view.api.activeKeys > 0 ? `${view.api.activeKeys} active ${view.api.activeKeys === 1 ? "key" : "keys"}` : "No keys"}
            </StatusBadge>
          ) : (
            <StatusBadge tone="secondary">Team and above</StatusBadge>
          )
        }
        action={
          view.api.allowed ? (
            <Button asChild variant="outline" size="sm">
              <Link href="/app/settings/api">
                Manage API keys
                <ArrowRight aria-hidden />
              </Link>
            </Button>
          ) : (
            <UpgradeNotice feature="api" compact selfHosted={view.selfHosted} />
          )
        }
      >
        Read search results, funder profiles and your saved list from your own tools through <code>/api/v1</code>. Keys
        are shown once and rate limited.
      </IntegrationCard>
    </div>
  );
}
