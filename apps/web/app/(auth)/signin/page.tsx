import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { SignInForm } from "@/components/auth/signin-form";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
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
};

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

  const user = await getUserOrNull();
  if (user) redirect(next);

  const errorKey = firstParam(params.error);
  const initialError = errorKey ? (ERROR_COPY[errorKey] ?? "Sign-in did not work. Try again.") : null;

  return <SignInForm next={next} appUrl={appUrl()} initialError={initialError} />;
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
