import type { Metadata } from "next";
import { Suspense } from "react";

import { WelcomeForm } from "@/components/auth/welcome-form";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { firstParam, safeNextPath } from "@/lib/auth/next-path";
import { requireWorkspace } from "@/lib/workspace/context";

export const metadata: Metadata = {
  title: "Welcome",
  description: "Tell GetFunded about your organization so funder matches fit your work.",
  robots: { index: false, follow: false },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function WelcomePage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col px-4 py-12 sm:px-6 sm:py-16">
      <Suspense fallback={<WelcomeSkeleton />}>
        <WelcomeContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function WelcomeContent({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const next = safeNextPath(firstParam(params.next));
  const { user, workspace } = await requireWorkspace();

  return (
    <WelcomeForm
      next={next}
      greetingName={user.displayName}
      workspace={{
        id: workspace.id,
        version: workspace.version,
        name: workspace.name,
        profile: workspace.profile,
      }}
    />
  );
}

function WelcomeSkeleton() {
  return (
    <Card aria-busy="true" aria-label="Loading">
      <CardHeader>
        <Skeleton className="h-7 w-56" />
        <Skeleton className="mt-2 h-4 w-full" />
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </CardContent>
    </Card>
  );
}
