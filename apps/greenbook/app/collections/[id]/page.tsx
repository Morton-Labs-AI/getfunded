import Link from "next/link";
import { notFound } from "next/navigation";

import { getViewer } from "@/lib/auth/viewer";
import { getCollection } from "@/lib/queries/community/collections";
import { communityLive, memberRobots } from "@/lib/community/posture";
import { moneyCompact, countCompact, MDASH } from "@/lib/format";

export const metadata = { robots: memberRobots };

export default async function CollectionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!communityLive) notFound();
  const { id } = await params;

  const viewer = await getViewer();
  // getCollection returns null when RLS hides the row — a private list belonging
  // to someone else is indistinguishable from one that does not exist, which is
  // the correct answer to give a stranger.
  const data = await getCollection(id, viewer?.memberId ?? null);
  if (!data) notFound();

  const { summary, items } = data;

  return (
    <div className="page-enter mx-auto w-full max-w-[1100px] px-6 pb-16 pt-10">
      <Link href="/collections" className="mono-label hover:text-ink-2">← lists</Link>
      <h1 className="mt-2 text-[26px] font-[650] tracking-[-0.02em] text-ink-1">
        {summary.name}
      </h1>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <span className="mono-label">
          {summary.itemCount} {summary.itemCount === 1 ? "funder" : "funders"}
        </span>
        {summary.ownerHandle && !summary.isMine ? (
          <Link href={`/members/${summary.ownerHandle}`} className="text-[12.5px] text-ink-3 hover:text-ink-1">
            by @{summary.ownerHandle}
          </Link>
        ) : null}
      </div>
      {summary.description ? (
        <p className="mt-3 max-w-[68ch] text-[15px] leading-6 text-ink-2">{summary.description}</p>
      ) : null}

      {items.length === 0 ? (
        <p className="mt-8 text-[14.5px] text-ink-3">Nothing in this list yet.</p>
      ) : (
        <div className="mt-8 overflow-x-auto">
          <table className="w-full border-collapse text-[13.5px]">
            <thead>
              <tr>
                <th className="mono-label border-b border-border-1 px-3.5 py-2 text-left">funder</th>
                <th className="mono-label border-b border-border-1 px-3.5 py-2 text-left">where</th>
                <th className="mono-label border-b border-border-1 px-3.5 py-2 text-right">assets</th>
                <th className="mono-label border-b border-border-1 px-3.5 py-2 text-right">grants paid</th>
                <th className="mono-label border-b border-border-1 px-3.5 py-2 text-left">applications</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className="border-b border-border-1 last:border-0 hover:bg-raised">
                  <td className="px-3.5 py-2.5">
                    {it.orgId ? (
                      <Link href={`/org/${it.orgId}`} className="font-medium text-ink-1 hover:text-accent">
                        {it.orgNameLive ?? it.orgName}
                      </Link>
                    ) : (
                      <span className="font-medium text-ink-1">{it.orgName}</span>
                    )}
                    {/* Snapshot drift is shown, not hidden: the corpus renamed
                        this org since it was saved, and a reader deserves to
                        know which name they filed it under. */}
                    {it.orgNameLive && it.orgNameLive !== it.orgName ? (
                      <span className="ml-2 text-[12px] text-ink-4">saved as {it.orgName}</span>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-3.5 py-2.5 text-ink-3">
                    {[it.city, it.state].filter(Boolean).join(", ") || MDASH}
                  </td>
                  <td className="tnum whitespace-nowrap px-3.5 py-2.5 text-right font-mono text-[12.5px] text-ink-1">
                    {moneyCompact(it.totalAssetsEoy)}
                  </td>
                  <td className="tnum whitespace-nowrap px-3.5 py-2.5 text-right font-mono text-[12.5px] text-ink-1">
                    {it.grantsTotal ? moneyCompact(it.grantsTotal) : MDASH}
                    {it.grantsN ? (
                      <span className="ml-1.5 text-ink-4">({countCompact(it.grantsN)})</span>
                    ) : null}
                  </td>
                  <td className="px-3.5 py-2.5 text-ink-3">
                    {it.applicationPosture ?? MDASH}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
