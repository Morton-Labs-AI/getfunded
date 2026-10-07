import Link from "next/link";

import type { CommunityNote } from "@/lib/queries/community/org";

/**
 * "What members know" — practitioner knowledge on an org page.
 *
 * A COUNTER-SEAL, NOT A WIDER ONE. components/source-glyph.tsx states the
 * doctrine: "One component, identical everywhere; sameness IS the trust
 * signal." Rendering a member's claim to look identical to a sha256-verified
 * filing fact would INVERT that. So this deliberately looks like a different
 * hand on the page: dashed rules where facts are dotted, an attribution line
 * where a fact carries a chain of custody, and the basis stated in the open.
 *
 * The basis and date are not decoration. Practitioner knowledge decays — a 2019
 * "they're responsive" is not a 2026 fact — and a claim with no stated basis is
 * an opinion a reader cannot weigh. The schema enforces both for anything
 * shared (ck_cm_notes_shared_is_evidenced).
 */
const BASIS_LABEL: Record<string, string> = {
  applied_and_heard_back: "applied and heard back",
  spoke_with_staff: "spoke with staff",
  attended_briefing: "attended a briefing",
  read_their_materials: "read their materials",
  secondhand: "secondhand",
  document_correction: "document correction",
};

function monthYear(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(`${iso.slice(0, 7)}-01T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function MemberNotes({
  notes,
  signedIn,
}: {
  notes: CommunityNote[];
  signedIn: boolean;
}) {
  if (notes.length === 0) {
    // Only the person who could act on it sees the invitation. A signed-out
    // reader gets nothing rather than an empty shell advertising absence.
    if (!signedIn) return null;
    return (
      <p className="max-w-[70ch] text-[14px] leading-6 text-ink-3">
        Nothing here yet. If this funder has ever told you it doesn&apos;t take
        unsolicited proposals when its 990 says nothing either way — that is the
        single most useful thing you could add to this page, and nobody else can
        add it.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-5">
      {notes.map((n) => {
        const when = monthYear(n.occurredOn);
        return (
          <li
            key={n.id}
            className="border-l-2 pl-4"
            style={{ borderLeftStyle: "dashed", borderLeftColor: "var(--ink-4)" }}
          >
            <p className="max-w-[70ch] text-[14.5px] leading-6 text-ink-1">{n.body}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-4">
              {n.authorHandle ? (
                <Link
                  href={`/members/${n.authorHandle}`}
                  className="text-ink-3 hover:text-ink-1"
                >
                  @{n.authorHandle}
                </Link>
              ) : (
                <span>a member</span>
              )}
              {n.basis ? (
                <>
                  <span aria-hidden>·</span>
                  <span>{BASIS_LABEL[n.basis] ?? n.basis}</span>
                </>
              ) : null}
              {when ? (
                <>
                  <span aria-hidden>·</span>
                  <span>{when}</span>
                </>
              ) : null}
              {n.isMine ? (
                <>
                  <span aria-hidden>·</span>
                  <span className="mono-label">yours</span>
                </>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
