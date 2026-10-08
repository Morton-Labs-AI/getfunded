import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Search } from "lucide-react";

import { ContactsPanel } from "@/components/outreach/contacts-panel";
import { MessageComposer } from "@/components/outreach/message-composer";
import { OutreachPage, OutreachPageHeader } from "@/components/outreach/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/workspace/page-header";
import { firstParam } from "@/lib/auth/next-path";
import { aiHealth } from "@/lib/billing/health";
import { listWorkspaceTemplates } from "@/lib/outreach/boilerplate";
import { listContacts, type FilingChannel } from "@/lib/outreach/contacts";
import { OUTREACH_COPY } from "@/lib/outreach/copy";
import { getFilingChannels } from "@/lib/outreach/deps";
import { listSavedFunderOptions } from "@/lib/outreach/funders";
import { BUILT_IN_TEMPLATES } from "@/lib/outreach/templates";
import { CREDIT_COSTS } from "@/lib/plans";
import { requireWorkspace } from "@/lib/workspace/context";

import { composerInitial, toComposerContact, toComposerFunder, toComposerTemplate, toPanelContact, uuidParam } from "../helpers";
import { CardsSkeleton, HeaderSkeleton } from "../skeletons";

export const metadata: Metadata = { title: "Write a message" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Compose: pick a saved funder (the URL carries the choice), a contact and a
 * template; fill the fields; polish with the model if you want; save a draft.
 * Nothing on this page sends. Below the form, the funder's contacts: your own
 * rows and the role-based channels from its public filing.
 */
export default function NewMessagePage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <OutreachPage>
      <Suspense
        fallback={
          <>
            <HeaderSkeleton />
            <CardsSkeleton cards={2} rows={5} />
          </>
        }
      >
        <ComposeContent searchParams={searchParams} />
      </Suspense>
    </OutreachPage>
  );
}

const CHANNELS_UNAVAILABLE = "The funder's filing could not be read right now. You can still add a contact by hand.";

async function ComposeContent({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const requestedFunder = uuidParam(firstParam(params.funder));
  const initial = composerInitial({
    contact: firstParam(params.contact),
    template: firstParam(params.template),
    channel: firstParam(params.channel),
  });

  const { user, workspace } = await requireWorkspace();
  const ctx = { userId: user.id, workspaceId: workspace.id };

  const [funders, workspaceTemplates] = await Promise.all([listSavedFunderOptions(ctx), listWorkspaceTemplates(ctx)]);

  const header = (
    <OutreachPageHeader
      title="Write a message"
      description="Pick a funder from your saved list, choose who to write to and start from a template. Save it as a draft; approving comes later, on the message page."
      back={{ href: "/app/outreach", label: "Back to Outreach" }}
    />
  );

  if (funders.length === 0) {
    return (
      <>
        {header}
        <EmptyState
          title="Save a funder first"
          hint="Messages are written to funders on your saved list, so the draft and the record stay with that funder. Search for one and press Save, then come back here."
          action={
            <Button size="sm" asChild>
              <Link href="/app/search">
                <Search aria-hidden />
                Search funders
              </Link>
            </Button>
          }
        />
      </>
    );
  }

  const selected = funders.find((f) => f.id === requestedFunder) ?? null;

  let contacts: Awaited<ReturnType<typeof listContacts>> = [];
  let channels: FilingChannel[] = [];
  let channelsNote: string | null = null;
  if (selected) {
    const [contactRows, channelResult] = await Promise.all([
      listContacts(ctx, selected.id),
      getFilingChannels(selected.orgId).then(
        (list) => ({ ok: true as const, list }),
        (error: unknown) => {
          console.warn("[outreach/new] filing channels unavailable", { orgId: selected.orgId, error: error instanceof Error ? error.message : String(error) });
          return { ok: false as const };
        },
      ),
    ]);
    contacts = contactRows;
    if (channelResult.ok) channels = channelResult.list;
    else channelsNote = CHANNELS_UNAVAILABLE;
  }

  const templates = [...BUILT_IN_TEMPLATES, ...workspaceTemplates].map(toComposerTemplate);
  const ai = aiHealth();

  return (
    <>
      {header}
      <MessageComposer
        funders={funders.map(toComposerFunder)}
        selectedFunderId={selected?.id ?? null}
        contacts={contacts.map(toComposerContact)}
        templates={templates}
        initial={initial}
        org={{ name: workspace.name, mission: workspace.profile.mission ?? null, website: workspace.profile.website ?? null }}
        senderName={user.displayName ?? user.email}
        ai={{ enabled: ai !== "disabled", mock: ai === "mock", creditCost: CREDIT_COSTS.draft }}
      />
      {selected ? (
        <ContactsPanel savedFunderId={selected.id} funderName={selected.name} contacts={contacts.map(toPanelContact)} channels={channels} channelsNote={channelsNote} />
      ) : (
        <Card>
          <CardContent className="py-6 text-sm leading-6 text-ink-3">
            Pick a funder above to see your contacts for it and the role-based channels listed in its public filing. {OUTREACH_COPY.contacts.useFilingHelp}
          </CardContent>
        </Card>
      )}
    </>
  );
}
