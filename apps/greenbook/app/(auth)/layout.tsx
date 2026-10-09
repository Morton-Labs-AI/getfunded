import { memberRobots } from "@/lib/community/posture";

/**
 * Every member-facing route is noindex UNCONDITIONALLY — not derived from
 * COMMUNITY_MODE. Members joined a funder database, not a public people-search
 * index. Opening the corpus to crawlers (mode `open`) must never open the
 * roster, and keeping the two decisions in different places is what stops one
 * flag from doing both.
 */
export const metadata = { robots: memberRobots };

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children;
}
