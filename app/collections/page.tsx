import Link from "next/link";
import { notFound } from "next/navigation";

import { getViewer } from "@/lib/auth/viewer";
import { myCollections } from "@/lib/queries/community/collections";
import { communityLive, memberRobots } from "@/lib/community/posture";

export const metadata = {
  title: "Your lists — Open Funder Database",
  robots: memberRobots,
};

const VIS_LABEL: Record<string, string> = {
  private: "private",
  unlisted: "unlisted",
  members: "visible to members",
  public: "public",
};

export default async function CollectionsPage() {
  if (!communityLive) notFound();

  const viewer = await getViewer();
  if (!viewer) {
    return (
      <div className="page-enter mx-auto w-full max-w-[720px] px-6 pb-16 pt-16">
        <h1 className="text-[24px] font-[650] tracking-[-0.02em] text-ink-1">Your lists</h1>
        <p className="mt-2 text-[14.5px] leading-6 text-ink-2">
          <Link href="/sign-in" className="text-accent hover:text-accent-hover">Sign in</Link>{" "}
          to keep lists of funders.
        </p>
      </div>
    );
  }

  const collections = await myCollections(viewer.memberId);

  return (
    <div className="page-enter mx-auto w-full max-w-[900px] px-6 pb-16 pt-10">
      <span className="mono-label">your lists</span>
      <h1 className="mt-2 text-[26px] font-[650] tracking-[-0.02em] text-ink-1">Collections</h1>
      <p className="mt-2 max-w-[68ch] text-[15px] leading-6 text-ink-2">
        Lists you keep. Private unless you say otherwise — publishing is always
        something you choose, never something that happens by default.
      </p>

      {collections.length === 0 ? (
        <p className="mt-8 max-w-[68ch] text-[14.5px] leading-6 text-ink-3">
          Nothing saved yet. Find a funder in{" "}
          <Link href="/browse" className="text-accent hover:text-accent-hover">Browse</Link>{" "}
          and hit Save — the first one makes your list.
        </p>
      ) : (
        <ul className="mt-8 flex flex-col gap-3">
          {collections.map((c) => (
            <li key={c.id}>
              <Link
                href={`/collections/${c.id}`}
                className="flex items-baseline justify-between gap-4 rounded-[10px] border border-border-1 bg-surface px-4 py-3.5 transition-colors duration-[90ms] hover:border-border-2"
              >
                <span className="flex flex-col gap-1">
                  <span className="text-[15px] font-medium text-ink-1">{c.name}</span>
                  {c.description ? (
                    <span className="text-[13px] text-ink-3">{c.description}</span>
                  ) : null}
                </span>
                <span className="flex shrink-0 items-baseline gap-3">
                  <span className="mono-label">{VIS_LABEL[c.visibility]}</span>
                  <span className="tnum text-[13px] text-ink-2">
                    {c.itemCount} {c.itemCount === 1 ? "funder" : "funders"}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
