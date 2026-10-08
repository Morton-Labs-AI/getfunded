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

/**
 * Setup details for the person who runs a self-install. Hidden on the hosted
 * service, where the operator is the steward and nobody else can act on them.
 */
function OperatorNote({ show, children }: { show: boolean; children: React.ReactNode }) {
  if (!show) return null;
  return (
    <details className="mt-2 text-xs text-ink-3">
      <summary className="cursor-pointer font-medium text-ink-2">Setup details for the operator</summary>
      <p className="mt-1 leading-5">{children}</p>
    </details>
  );
}

function IntegrationCard({
  icon: Icon,
  title,
  status,
  children,
  operator,
  action,
}: {
  icon: LucideIcon;
  title: string;
  status: React.ReactNode;
  children: React.ReactNode;
  operator?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2" className="flex flex-wrap items-center gap-2">
          <Icon className="size-4 text-ink-3" aria-hidden />
          {title}
          {status}
        </CardTitle>
        <CardDescription className="leading-6">{children}</CardDescription>
        {operator}
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
      <StatusBadge tone="warning">Test mode</StatusBadge>
    ) : view.ai === "disabled" ? (
      <StatusBadge tone="danger">Off</StatusBadge>
    ) : view.aiFlagEnabled === false ? (
      <StatusBadge tone="warning">Paused</StatusBadge>
    ) : (
      <StatusBadge tone="success">On</StatusBadge>
    );

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <IntegrationCard
        icon={Sparkles}
        title="AI"
        status={aiStatus}
        operator={
          <OperatorNote show={view.selfHosted && view.ai !== "enabled"}>
            {view.ai === "mock"
              ? "AI_MODE is set to mock. Set AI_MODE=live and add an ANTHROPIC_API_KEY to use a real model."
              : "AI_ENABLED is false. Set it to true to turn model calls back on."}
          </OperatorNote>
        }
      >
        {view.ai === "mock"
          ? "The AI is in test mode. Answers are placeholders, cost nothing, and are labelled as test output."
          : view.ai === "disabled"
            ? "AI is turned off on this install. Search and funder profiles still work; nothing is sent to a model."
            : view.aiFlagEnabled === false
              ? "The steward has paused AI features for everyone. Search and funder profiles still work."
              : "Fit analysis, research on the web, draft polish, natural-language filters and Ask the analyst are available. Every output is labelled AI and shows the evidence it was given."}
        {aiOn ? " Each call uses credits; see Billing." : ""}
      </IntegrationCard>

      <IntegrationCard
        icon={Search}
        title="Describe-the-work search"
        status={view.semanticSearch ? <StatusBadge tone="success">On</StatusBadge> : <StatusBadge tone="secondary">Keyword only</StatusBadge>}
        operator={
          <OperatorNote show={view.selfHosted && !view.semanticSearch}>
            Add a VOYAGE_API_KEY to turn on meaning-based search. The corpus must have embeddings loaded.
          </OperatorNote>
        }
      >
        {view.semanticSearch
          ? "You can describe your work in a sentence and search finds funders whose giving reads like it. Public charities are matched by name and EIN."
          : "Search matches names, EINs and filters only on this install. A notice on the search page says so."}
      </IntegrationCard>

      <IntegrationCard
        icon={Mail}
        title="Gmail"
        status={
          view.gmail.connected > 0 ? (
            <StatusBadge tone="success">Connected</StatusBadge>
          ) : !view.gmail.configured ? (
            <StatusBadge tone="secondary">Not set up</StatusBadge>
          ) : (
            <StatusBadge tone="secondary">Not connected</StatusBadge>
          )
        }
        operator={
          <OperatorNote show={view.selfHosted && !view.gmail.configured}>
            Create a Google OAuth client and set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET. A SECRETS_KEY is also needed to store
            connections encrypted.
          </OperatorNote>
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
            ? "Sending through Gmail is not set up on this install yet. Drafting works on every plan; sending needs the person who runs the install to finish the Google setup."
            : "Connect your own Gmail to send approved outreach one message at a time, under a daily limit you set. The connection is stored encrypted and only you can use it."}
      </IntegrationCard>

      <IntegrationCard
        icon={KeyRound}
        title="API"
        status={
          view.api.allowed ? (
            <StatusBadge tone={view.api.activeKeys > 0 ? "success" : "secondary"}>
              {view.api.activeKeys > 0 ? `${view.api.activeKeys} active ${view.api.activeKeys === 1 ? "key" : "keys"}` : "No keys yet"}
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
        Read search results, funder profiles and your saved list from your own tools. A key is shown once, when you make it,
        and has a rate limit.
      </IntegrationCard>
    </div>
  );
}
