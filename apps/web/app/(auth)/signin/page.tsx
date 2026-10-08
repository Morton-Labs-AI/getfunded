import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { SignInForm } from "@/components/auth/signin-form";
import { SignOutButton } from "@/components/auth/signout-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getFlags } from "@/lib/admin/flags-server";
import { appUrl } from "@/lib/auth/env";
import { firstParam, safeNextPath } from "@/lib/auth/next-path";
import { getUserOrNull } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in or create a free GetFunded account with your name and email. No password.",
};

/** Reasons the callback route can hand back. Plain language, no blame. */
const ERROR_COPY: Record<string, string> = {
  link_invalid: "That sign-in link has expired or was already used. Request a new one below.",
  link_missing: "That link was incomplete. Request a new one below.",
  no_session: "We could not finish signing you in. Try again.",
  provisioning_failed: "You are signed in, but we could not set up your workspace. Wait a minute and try again.",
  // The sign-up gate (lib/auth/signup-gate.ts) refused a NEW account; the session was ended.
  signups_closed: "New accounts are paused right now, so we did not create one for that address. If you already have an account, use the email it is under.",
  invite_required:
    "New accounts are by invitation right now, and no pending invitation names that address. Ask the workspace admin for an invitation, then sign in with the address it was sent to.",
};

/**
 * Refusals that can arrive WITH a live session: requireWorkspace() sends a
 * signed-in person whose account the sign-up gate would not create here. For
 * them the page must not bounce back to `next` (that would loop), so it shows
 * the reason and a sign-out button instead of the form.
 */
const SIGNUP_REFUSALS = new Set(["signups_closed", "invite_required"]);

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function SignInPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col px-4 py-16 sm:px-6 sm:py-24">
      <Suspense fallback={<SignInSkeleton />}>
        <SignInContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function SignInContent({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const next = safeNextPath(firstParam(params.next));

  const errorKey = firstParam(params.error);
  const user = await getUserOrNull();
  if (user && errorKey && SIGNUP_REFUSALS.has(errorKey)) {
    return <SignedInWithoutAccount email={user.email} message={ERROR_COPY[errorKey] ?? "We could not create an account for that address."} />;
  }
  if (user) redirect(next);

  const initialError = errorKey ? (ERROR_COPY[errorKey] ?? "Sign-in did not work. Try again.") : null;
  // The steward flag decides whether the form may ask the auth server to create
  // an account; the rule itself is enforced when the account is provisioned.
  const { signupMode } = await getFlags();

  return <SignInForm next={next} appUrl={appUrl()} initialError={initialError} signupMode={signupMode} />;
}

/** A session with no account behind it: explain, and offer the one useful action. */
function SignedInWithoutAccount({ email, message }: { email: string; message: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h1" className="text-2xl">
          No account for {email}
        </CardTitle>
        <CardDescription>{message}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          You are signed in, but there is no GetFunded account behind this session. Sign out, then sign in again with
          the address your account or invitation uses.
        </p>
        <SignOutButton variant="outline" className="self-start" />
      </CardContent>
    </Card>
  );
}

function SignInSkeleton() {
  return (
    <Card aria-busy="true" aria-label="Loading sign-in">
      <CardHeader>
        <Skeleton className="h-7 w-32" />
        <Skeleton className="mt-2 h-4 w-full" />
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </CardContent>
    </Card>
  );
}
