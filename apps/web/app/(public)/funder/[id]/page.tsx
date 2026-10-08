import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { FunderProfile } from "@/components/funder/funder-profile";
import { ProfileSkeleton } from "@/components/funder/profile-skeleton";
import { formatEin } from "@/lib/format";
import { getFunder } from "@/lib/queries/corpus/funder";
import { isUuid } from "@/lib/queries/corpus/safe";
import { site } from "@/lib/site";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function describe(funder: NonNullable<Awaited<ReturnType<typeof getFunder>>>): string {
  const where = [funder.city, funder.state].filter(Boolean).join(", ");
  const parts = [funder.orgTypeLabel, where || null, funder.ein ? `EIN ${formatEin(funder.ein)}` : null].filter(Boolean);
  return `${funder.name}: ${parts.join(" · ")}. Application policy, financials, grants paid and contacts from public IRS filings on ${site.name}.`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const funder = isUuid(id) ? await getFunder(id) : null;
  if (!funder) return { title: "Funder not found", robots: { index: false, follow: false } };
  return {
    title: funder.name,
    description: describe(funder),
    robots: { index: true, follow: true },
    alternates: { canonical: `/funder/${funder.canonicalOrgId ?? funder.orgId}` },
    openGraph: { title: `${funder.name} · ${site.name}`, description: describe(funder), type: "profile" },
  };
}

/** Public funder profile. No account needed; everything is from filings. */
export default function FunderPage({ params, searchParams }: Props) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <Suspense fallback={<ProfileSkeleton />}>
        <FunderContent params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function FunderContent({ params, searchParams }: Props) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!isUuid(id)) notFound();
  const funder = await getFunder(id);
  if (!funder) notFound();
  // A merged record's page sends the reader to the canonical row.
  if (funder.canonicalOrgId && funder.canonicalOrgId !== funder.orgId) redirect(`/funder/${funder.canonicalOrgId}`);

  const page = Number(first(sp.gpage)) || 1;
  const q = first(sp.gq) ?? null;
  return <FunderProfile orgId={funder.orgId} mode="public" grants={{ page, q }} />;
}
