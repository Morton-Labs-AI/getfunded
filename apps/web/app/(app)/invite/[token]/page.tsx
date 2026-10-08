import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { InviteAcceptForm } from "@/components/settings/invite-accept-form";
import { SettingsSkeleton } from "@/components/settings/settings-skeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import { ACCEPT_INVITE_COPY, parseInviteToken } from "@/lib/settings/invites";

export const metadata: Metadata = {
  title: "Join a workspace",
  robots: { index: false, follow: false },
};

type Params = Promise<{ token: string }>;

/**
 * /invite/[token]: the link an admin copies from Settings → Members. Opening
 * it does nothing by itself; the button below POSTs `accept_invite()`. A
 * signed-out visitor is sent to sign in and comes straight back here.
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

async function InviteContent({ params }: { params: Params }) {
  const { token: raw } = await params;
  const token = parseInviteToken(raw);
  if (!token) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>This link is not valid</CardTitle>
          <CardDescription>{ACCEPT_INVITE_COPY.invalid}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/app">Go to my workspace</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }
  const user = await requireUser(`/invite/${encodeURIComponent(token)}`);
  return <InviteAcceptForm token={token} email={user.email} />;
}
