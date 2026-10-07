import { memberRobots } from "@/lib/community/posture";

/** Member surfaces are never indexable, independent of COMMUNITY_MODE. */
export const metadata = { robots: memberRobots };

export default function CollectionsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
