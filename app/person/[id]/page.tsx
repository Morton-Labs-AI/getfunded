import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  getPerson,
  personMergedRecords,
  personOrgs,
  personContactCount,
} from "@/lib/queries/people";
import { SourceGlyph } from "@/components/source-glyph";
import { TrichotomyBadge } from "@/components/trichotomy-badge";
import { PERSON_CAVEAT } from "@/lib/content/facts";
import { MDASH, REL_LABEL } from "@/lib/format";

export default async function PersonPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { id } = await params;
  const { from } = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();

  const person = await getPerson(id);
  if (!person) notFound();
  // Non-canonical rows redirect to their survivor (temporary, not permanent:
  // the canonical map is recomputed on every ER apply and the rep can change).
  if (person.canonical_person_id)
    redirect(`/person/${person.canonical_person_id}?from=${id}`);

  const merged = await personMergedRecords(id);
  const memberIds = [id, ...merged.map((m) => m.id)];

  const [affiliations, contactCount] = await Promise.all([
    personOrgs(memberIds),
    personContactCount(memberIds),
  ]);

  const prov = {
    dataset: person.dataset_name,
    sourceUrl: person.source_url,
    sha256: person.sha256,
    license: person.license_name,
    locator: person.source_record_locator,
    ingested: person.downloaded_at,
  };

  return (
    <div className="page-enter mx-auto w-full max-w-[1200px] px-6 pb-16">
      {/* header */}
      <header className="pt-10">
        {from && (
          <div className="mb-3 text-[12.5px] text-ink-4">
            Redirected from a duplicate record (same real-world entity;
            provenance preserved on both rows).
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="mono-label">{person.primary_title ?? MDASH}</span>
          <Link
            href={`/?q=${encodeURIComponent(`Tell me about ${person.full_name} (person id ${person.id})`)}`}
            className="rounded-[8px] border border-accent-border px-3 py-1.5 text-[12.5px] font-medium text-accent transition-colors duration-[90ms] hover:bg-accent-tint"
          >
            Ask about this person
          </Link>
        </div>
        <h1 className="mt-2 text-[26px] font-[650] leading-8 tracking-[-0.02em] text-ink-1">
          {person.full_name}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {person.primary_org_link_id && person.primary_org_name && (
            <Link
              href={`/org/${person.primary_org_link_id}`}
              className="inline-flex items-center gap-1.5 rounded-[5px] bg-inset px-2 py-[3px] font-mono text-[11.5px] text-accent transition-colors duration-[90ms] hover:text-accent-hover"
            >
              <span className="uppercase text-ink-4">org</span>
              {person.primary_org_name}
            </Link>
          )}
          {merged.length > 0 && (
            <span
              className="rounded-[5px] bg-inset px-2 py-[3px] font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-3"
              title={merged
                .map((m) => `${m.dataset_name} · ${m.source_record_locator}`)
                .join("\n")}
            >
              {merged.length} merged record{merged.length > 1 ? "s" : ""}
            </span>
          )}
          {contactCount > 0 && (
            <span className="text-[12.5px] text-ink-4">
              {contactCount} contact channels on file (internal)
            </span>
          )}
        </div>
        <div className="mt-5 h-[2px] w-full bg-border-1" />
      </header>

      {/* affiliations */}
      {affiliations.length > 0 && (
        <Section title="Affiliations">
          <div className="overflow-hidden rounded-[10px] border border-border-1 bg-surface">
            <div className="overflow-x-auto">
              <table className="w-full text-[13.5px]">
                <thead>
                  <tr className="bg-raised">
                    <th className="mono-label border-b border-border-1 px-3.5 py-2 text-left">organization</th>
                    <th className="mono-label border-b border-border-1 px-3.5 py-2 text-left">role</th>
                    <th className="mono-label border-b border-border-1 px-3.5 py-2 text-left">type</th>
                    <th className="mono-label border-b border-border-1 px-3.5 py-2 text-right">source</th>
                  </tr>
                </thead>
                <tbody>
                  {affiliations.map((a) => (
                    <tr key={a.org_id} className="border-b border-border-1 last:border-0 align-top">
                      <td className="max-w-[380px] px-3.5 py-2">
                        <Link
                          href={`/org/${a.org_id}`}
                          className="font-medium text-accent hover:text-accent-hover"
                        >
                          {a.name}
                        </Link>
                      </td>
                      <td className="max-w-[260px] px-3.5 py-2 text-ink-2">
                        {a.title ?? REL_LABEL[a.rel_type] ?? a.rel_type}
                      </td>
                      <td className="whitespace-nowrap px-3.5 py-2">
                        <TrichotomyBadge orgType={a.org_type} />
                      </td>
                      <td className="whitespace-nowrap px-3.5 py-2 text-right font-mono text-[12px] text-ink-3">
                        <SourceGlyph
                          prov={{
                            dataset: a.dataset_name,
                            sourceUrl: a.source_url,
                            sha256: a.sha256,
                            license: a.license_name,
                            ingested: a.downloaded_at,
                          }}
                        >
                          {a.dataset_name}
                        </SourceGlyph>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Section>
      )}

      {/* provenance — the cluster's multi-source chain of custody */}
      <Section title="Provenance">
        <div className="rounded-[10px] border border-border-1 bg-surface px-4 py-3.5 text-[13px] text-ink-2">
          <SourceGlyph prov={prov}>
            <span className="font-mono text-[12px]">{person.dataset_name}</span>
          </SourceGlyph>
          <span className="text-ink-3"> · {person.license_name} · record </span>
          <span className="font-mono text-[12px] text-ink-3">{person.source_record_locator}</span>
          {merged.map((m) => (
            <div key={m.id} className="mt-2 border-t border-border-1 pt-2">
              <span className="font-mono text-[12px]">{m.dataset_name}</span>
              <span className="text-ink-3"> · record </span>
              <span className="font-mono text-[12px] text-ink-3">{m.source_record_locator}</span>
              <span className="text-ink-4"> · as “{m.full_name}”</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11.5px] text-ink-4">{PERSON_CAVEAT}</p>
      </Section>
    </div>
  );
}

/* ---------- helpers ---------- */

function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-border-1 py-7 last:border-0">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <h2 className="text-[19px] font-semibold tracking-[-0.015em] text-ink-1">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}
