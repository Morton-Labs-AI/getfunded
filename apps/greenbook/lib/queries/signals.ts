import { sql } from "@/lib/db";

/**
 * Funder signals (corpus migration 0032): a funder's own dated announcements,
 * classified. Published rows only on the public profile. The seal traces to
 * OUR compilation file (cc_by); the publisher's page snapshot is a separate
 * non-republishable raw file that never leaves the review console.
 */
export interface SignalRow {
  id: string;
  url: string;
  publisher: string | null;
  headline: string | null;
  published_at: string | null;
  discovered_at: string;
  signal_type: string | null;
  amount_usd: string | null;
  amount_kind: string | null;
  instruments: string[];
  eligible_recipients: string[];
  sectors: string[];
  geographies: string[];
  horizon_end: string | null;
  summary: string | null;
  action_hint: string | null;
  extraction_model: string | null;
  extraction_confidence: number | null;
  match_method: string;
  dataset_name: string;
  sha256: string;
  source_url: string | null;
  license_name: string;
  source_record_locator: string;
}

export async function orgSignals(memberIds: string[], limit = 12): Promise<SignalRow[]> {
  try {
    return await sql<SignalRow[]>`
      select s.id::text as id, s.url, s.publisher, s.headline,
             s.published_at::text as published_at, s.discovered_at::text as discovered_at,
             s.signal_type, s.amount_usd::text as amount_usd, s.amount_kind,
             s.instruments, s.eligible_recipients, s.sectors, s.geographies,
             s.horizon_end::text as horizon_end, s.summary, s.action_hint,
             s.extraction_model, s.extraction_confidence, so.match_method,
             rf.dataset_name, rf.sha256, rf.source_url, lm.license_name, s.source_record_locator
      from internal.funder_signals s
      join internal.funder_signal_orgs so on so.signal_id = s.id and so.org_id = any(${memberIds}::uuid[])
      join internal.raw_files rf on rf.id = s.raw_file_id
      join internal.licensing_map lm on lm.license_code = rf.license_code
      where s.status = 'published'
      order by s.published_at desc nulls last, s.id desc
      limit ${limit}`;
  } catch (e) {
    console.warn("orgSignals unavailable:", (e as Error).message);
    return [];
  }
}

/** The review worklist (dev-only console): classified candidates first, then unprocessed. */
export interface SignalReviewRow extends Omit<SignalRow, "match_method" | "dataset_name" | "sha256" | "source_url" | "license_name" | "source_record_locator"> {
  status: string;
  relevance: string | null;
  submitted_by: string;
  discovery_note: string | null;
  extracted_at: string | null;
  notes: string | null;
  org_id: string | null;
  org_name: string | null;
  violations: number;
}

export async function signalReviewQueue(limit = 100): Promise<SignalReviewRow[]> {
  try {
    return await sql<SignalReviewRow[]>`
      select s.id::text as id, s.url, s.publisher, s.headline,
             s.published_at::text as published_at, s.discovered_at::text as discovered_at,
             s.signal_type, s.amount_usd::text as amount_usd, s.amount_kind,
             s.instruments, s.eligible_recipients, s.sectors, s.geographies,
             s.horizon_end::text as horizon_end, s.summary, s.action_hint,
             s.extraction_model, s.extraction_confidence, s.status, s.relevance,
             s.submitted_by, s.discovery_note, s.extracted_at::text as extracted_at, s.notes,
             so.org_id::text as org_id, o.name as org_name,
             coalesce(jsonb_array_length(s.raw_source->'violations'), 0)::int as violations
      from internal.funder_signals s
      left join lateral (
        select org_id from internal.funder_signal_orgs x
        where x.signal_id = s.id order by (x.role = 'subject') desc, x.confidence desc limit 1
      ) so on true
      left join internal.organizations o on o.id = so.org_id
      where s.status in ('candidate', 'rejected')
      order by (s.status = 'candidate') desc, (s.extracted_at is not null) desc,
               s.extraction_confidence desc nulls last, s.discovered_at desc
      limit ${limit}`;
  } catch (e) {
    console.warn("signalReviewQueue unavailable:", (e as Error).message);
    return [];
  }
}
