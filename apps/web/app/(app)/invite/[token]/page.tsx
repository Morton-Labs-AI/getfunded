import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { InviteAcceptForm } from "@/components/settings/invite-accept-form";
import { SettingsSkeleton } from "@/components/settings/settings-skeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import { withUser } from "@/lib/db/app";
import { ACCEPT_INVITE_COPY, inviteMatchesEmail, parseInviteToken, type InvitePreview } from "@/lib/settings/invites";
import { invitePreview } from "@/lib/settings/service";

export const metadata: Metadata = {
  title: "Join a workspace",
  robots: { index: false, follow: false },
};

type Params = Promise<{ token: string }>;

/**
 * /invite/[token]: the link an admin copies from Settings → Members. Opening
 * it does nothing by itself; the button below POSTs `accept_invite()`. A
 * signed-out visitor is sent to sign in and comes straight back here.
 *
 * The page names the address the invitation was sent to (through the
 * `invite_preview` door, migration 0011), because `accept_invite` is bound to
 * that address: a person signed in with a different account sees why the
 * button will not work before they press it.
 */
export default function InvitePage({ params }: { params: Params }) {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col px-4 py-12 sm:px-6 sm:py-16">
      <Suspense fallback={<SettingsSkeleton rows={2} />}>
        <InviteContent params={params} />
      </Suspense>
    </div>
  );
}

function NotValid({ title, copy }: { title: string; copy: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{copy}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline">
          <Link href="/app">Go to my workspace</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

async function InviteContent({ params }: { params: Params }) {
  const { token: raw } = await params;
  const token = parseInviteToken(raw);
  if (!token) return <NotValid title="This link is not valid" copy={ACCEPT_INVITE_COPY.invalid} />;

  const user = await requireUser(`/invite/${encodeURIComponent(token)}`);

  // Best effort: a failed preview still shows the accept button, and
  // accept_invite() remains the one that decides.
  let preview: InvitePreview | null = null;
  try {
    preview = await withUser(user.id, (sql) => invitePreview(sql, token));
  } catch (error) {
    console.warn("[invite] preview unavailable", error instanceof Error ? error.message : error);
  }

  if (preview?.status === "accepted") return <NotValid title="This invitation was already used" copy={ACCEPT_INVITE_COPY.used} />;
  if (preview?.status === "expired") return <NotValid title="This invitation has expired" copy={ACCEPT_INVITE_COPY.expired} />;

  const mismatch = preview ? !inviteMatchesEmail(preview, user.email) : false;

  return (
    <div className="flex flex-col gap-4">
      {preview ? (
        <p className="text-sm text-ink-2" data-testid="invite-preview">
          This invitation to <span className="font-medium text-foreground">{preview.workspaceName}</span> was sent to{" "}
          <span className="font-medium text-foreground">{preview.email}</span>
          {preview.role === "admin" ? " as an admin." : "."}
        </p>
      ) : null}
      {mismatch ? (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">
          You are signed in as <span className="font-medium">{user.email}</span>, which is not the address this invitation
          was sent to. {ACCEPT_INVITE_COPY.wrong_email}
        </p>
      ) : null}
      <InviteAcceptForm token={token} email={user.email} />
    </div>
  );
}
