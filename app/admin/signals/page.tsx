import Link from "next/link";
import { AddSignalForm, SignalReviewRowActions, fmtMoney } from "@/components/admin/signal-review";
import { signalReviewQueue } from "@/lib/queries/signals";

export const dynamic = "force-dynamic";

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/** The funder-signal review console (dev only). Candidates the pipeline has
    fetched and classified wait here for a human publish; unprocessed URLs
    show what `funderdb signals process` still has to do. Publishing is the
    only act that puts a signal on a profile, into public.funder_signals, and
    in front of every workspace app's alert sync. */
export default async function SignalReviewPage() {
  const rows = await signalReviewQueue(100);
  const classified = rows.filter((r) => r.status === "candidate" && r.extracted_at);
  const pending = rows.filter((r) => r.status === "candidate" && !r.extracted_at);
  const rejected = rows.filter((r) => r.status === "rejected");

  return (
    <div className="page-enter mx-auto w-full max-w-[1080px] px-6 pb-16 pt-10">
      <span className="mono-label">funder signals · review · dev only</span>
      <h1 className="mt-2 text-[24px] font-[650] leading-8 tracking-[-0.02em] text-ink-1">Signal review</h1>
      <p className="mt-2 max-w-[720px] text-[13px] leading-relaxed text-ink-3">
        A funder&rsquo;s own announcements, classified by the corpus pipeline with a quoted passage behind every field.
        Nothing here is visible on a profile or in the public views until you publish it. Rows the model triaged out
        (&ldquo;not a funding signal&rdquo;) sit under rejected; reopen one if the model was wrong.
      </p>

      <AddSignalForm />

      <Block title={`ready to publish · ${classified.length}`} rows={classified} empty="Nothing classified is waiting. Run `funderdb signals poll` then `funderdb signals process` in the corpus repo." />
      <Block title={`waiting for the pipeline · ${pending.length}`} rows={pending} empty="No unprocessed URLs." />
      <Block title={`rejected · ${rejected.length}`} rows={rejected} empty="Nothing rejected." />
    </div>
  );
}

function Block({ title, rows, empty }: { title: string; rows: Awaited<ReturnType<typeof signalReviewQueue>>; empty: string }) {
  return (
    <section className="mt-8">
      <span className="mono-label">{title}</span>
      {rows.length === 0 ? (
        <p className="mt-2 text-[13px] text-ink-4">{empty}</p>
      ) : (
        <ul className="mt-3 flex flex-col divide-y divide-border-1/60 rounded-[10px] border border-border-1 bg-surface">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-col gap-2 px-4 py-3 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-ink-4">
                  <span className="font-mono">#{r.id}</span>
                  <span>{r.published_at ?? "undated"}</span>
                  {r.signal_type && <span className="rounded-full border border-border-2 px-2 py-px">{r.signal_type.replace(/_/g, " ")}</span>}
                  {r.amount_usd && <span className="tnum">{fmtMoney(r.amount_usd)}</span>}
                  {r.relevance && <span>relevance {r.relevance}</span>}
                  {r.extraction_confidence !== null && <span className="tnum">conf {r.extraction_confidence.toFixed(2)}</span>}
                  {r.violations > 0 && <span className="text-caution">{r.violations} dropped field{r.violations === 1 ? "" : "s"}</span>}
                  {r.extraction_model && <span className="font-mono">{r.extraction_model}</span>}
                </div>
                <div className="mt-1 text-[14px] font-[550] text-ink-1">
                  {r.org_id ? (
                    <Link href={`/org/${r.org_id}`} className="text-accent hover:text-accent-hover">
                      {r.org_name}
                    </Link>
                  ) : (
                    <span className="text-caution">no org linked</span>
                  )}
                  <span className="text-ink-4"> · </span>
                  <a href={r.url} target="_blank" rel="noreferrer" className="hover:underline">
                    {r.headline ?? host(r.url)}
                  </a>
                </div>
                {r.summary && <p className="mt-1 max-w-[760px] text-[13px] leading-relaxed text-ink-2">{r.summary}</p>}
                <div className="mt-1 flex flex-wrap gap-1.5 text-[11.5px] text-ink-3">
                  {r.eligible_recipients.map((x) => <span key={`e-${x}`} className="rounded-full bg-inset px-2 py-px">{x.replace(/_/g, " ")}</span>)}
                  {r.instruments.map((x) => <span key={`i-${x}`} className="rounded-full bg-inset px-2 py-px">{x}</span>)}
                  {r.sectors.map((x) => <span key={`s-${x}`} className="rounded-full bg-inset px-2 py-px">{x.replace(/_/g, " ")}</span>)}
                </div>
                {(r.discovery_note || r.notes) && (
                  <p className="mt-1 text-[11.5px] text-ink-4">
                    {r.submitted_by}
                    {r.discovery_note ? ` · ${r.discovery_note}` : ""}
                    {r.notes ? ` · ${r.notes}` : ""}
                  </p>
                )}
              </div>
              <SignalReviewRowActions row={r} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
