import { AiCard } from "@/components/data/ai-badge";
import { YoursBlock } from "@/components/data/yours-tag";
import { OUTREACH_COPY } from "@/lib/outreach/copy";
import type { MessageClaim } from "@/lib/outreach/messages";

/**
 * The message text, labelled by where it came from: an AI-polished draft sits
 * in an AiCard with its claims; a template or hand-written draft is Yours.
 */
export function MessageBody({
  subject,
  body,
  channel,
  draftSource,
  claims,
}: {
  subject: string | null;
  body: string;
  channel: string;
  draftSource: "template" | "ai";
  claims: MessageClaim[];
}) {
  const text = (
    <div className="flex flex-col gap-3">
      {channel === "email" ? (
        <div className="text-sm">
          <span className="eyebrow mr-2 text-ink-3">Subject</span>
          <span className="font-medium">{subject?.trim() ? subject : <span className="text-ink-3">(no subject yet)</span>}</span>
        </div>
      ) : null}
      <pre className="font-sans text-sm leading-6 whitespace-pre-wrap text-foreground">{body.trim() ? body : "(empty)"}</pre>
    </div>
  );

  if (draftSource === "ai") {
    return (
      <AiCard title="Draft polished by AI" reason={OUTREACH_COPY.ai.labelReason} meta={<span className="text-xs text-ink-3">{claims.length} claim{claims.length === 1 ? "" : "s"} cited</span>}>
        {text}
        {claims.length ? (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-ink-2">What the model kept, and the evidence it cites</summary>
            <ul className="mt-2 flex flex-col gap-1.5">
              {claims.map((c, i) => (
                <li key={`${c.evidenceId}-${i}`} className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
                  <span className="text-ink-2">{c.text}</span>
                  <code className="shrink-0 text-xs text-ink-3">{c.evidenceId}</code>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </AiCard>
    );
  }
  return <YoursBlock title="Your draft">{text}</YoursBlock>;
}
