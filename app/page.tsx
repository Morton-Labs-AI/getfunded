import { AskClient } from "@/components/ask-client";
import { getEventTypeTotals, getOverviewTotals } from "@/lib/queries/stats";

export default async function AskPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const [{ q }, totals, eventTypes] = await Promise.all([
    searchParams,
    getOverviewTotals(),
    getEventTypeTotals(),
  ]);

  return <AskClient totals={totals} eventTypes={eventTypes} seedQuery={q} />;
}
