import { postureBadge } from "@/lib/community/posture";

/**
 * The nav badge. It replaces a hardcoded "read-only · local" string that was
 * TRUE, which is the only reason it was worth anything — the app had no auth,
 * no user concept and one read-only pool. The moment a member can write,
 * leaving that string up is a lie in the most trust-sensitive pixel of the
 * product, so the copy is derived from the same constant that gates everything
 * else. With COMMUNITY_MODE unset it returns today's string, byte for byte.
 */
export function PostureBadge() {
  return (
    <span className="mono-label hidden rounded-[5px] border border-border-1 px-2 py-1 lg:inline">
      {postureBadge()}
    </span>
  );
}
