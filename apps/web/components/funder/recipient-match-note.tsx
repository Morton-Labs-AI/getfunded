import { RECIPIENT_ALIAS_MATCH_NOTE, RECIPIENT_ALIAS_SOURCE_NOTE } from "@/lib/content/recipient-alias-copy";
import { isExplainableAliasMatch, type RecipientAliasMatch } from "@/lib/queries/corpus/recipient-alias-types";
import { cn } from "@/lib/utils";

/**
 * One small line under a linked recipient name in the grants table: why this
 * row carries a link when the funder's own return gave no EIN, with the
 * source and the date of the count. A sourced fact from public filings, not a
 * model's suggestion, so it carries no AI marking.
 *
 * Renders nothing when the row has no alias link, or when the stored evidence
 * no longer supports the sentence (see isExplainableAliasMatch). Server or
 * client component; no state, no JavaScript of its own.
 *
 * Place it right after the recipient link, inside the same cell:
 *   <RecipientMatchNote match={aliasMatches[g.id]} />
 */
export function RecipientMatchNote({ match, className }: { match: RecipientAliasMatch | null | undefined; className?: string }) {
  if (!isExplainableAliasMatch(match)) return null;
  return (
    <span data-slot="recipient-match-note" className={cn("block text-xs text-ink-3", className)}>
      {RECIPIENT_ALIAS_MATCH_NOTE(match.nFilers)}{" "}
      {RECIPIENT_ALIAS_SOURCE_NOTE({ firstFy: match.firstFy, lastFy: match.lastFy, countedOn: match.countedOn })}
    </span>
  );
}
