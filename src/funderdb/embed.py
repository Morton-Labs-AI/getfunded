"""Semantic-search corpus: build aggregate documents + embed via Voyage.

Aggregate-then-embed (measured rationale in migration 0008): one document per
entity, four kinds — foundation "revealed thesis" docs, SBIR-company award
docs, adviser docs (name-carried), program docs. Individual grants are never
embedded. Both hybrid legs (FTS + HNSW) run over this corpus.

Sync is hash-driven: rebuilding docs is cheap SQL; only docs whose
sha256(doc_text|model) changed get re-embedded (embedding reset to NULL, then
re-embedded in batches). Build and embed are separately restartable.
"""

from __future__ import annotations

import hashlib
import json
import time
from datetime import datetime
from pathlib import Path

import httpx

from . import ledger, staging
from .config import get_settings
from .db import connect

MODEL = "voyage-3.5"
DIMS = 512
MODEL_TAG = f"{MODEL}-{DIMS}"
VOYAGE_URL = "https://api.voyageai.com/v1/embeddings"
BATCH = 128
DOC_CAP = 4000

NTEE_MAJOR = {
    "A": "Arts & Culture", "B": "Education", "C": "Environment", "D": "Animal Welfare",
    "E": "Health Care", "F": "Mental Health", "G": "Disease Research", "H": "Medical Research",
    "I": "Crime & Legal", "J": "Employment", "K": "Food & Agriculture", "L": "Housing",
    "M": "Public Safety", "N": "Recreation & Sports", "O": "Youth Development",
    "P": "Human Services", "Q": "International Affairs", "R": "Civil Rights",
    "S": "Community Improvement", "T": "Philanthropy & Grantmaking",
    "U": "Science & Technology Research", "V": "Social Science Research",
    "W": "Public & Societal Benefit", "X": "Religion", "Y": "Mutual Benefit", "Z": "Unknown",
}

# ---------------------------------------------------------------------------
# Doc builders — one set-based SQL per kind, assembled server-side, capped.
# ---------------------------------------------------------------------------

FOUNDATION_DOCS_SQL = f"""
with grant_stats as (
  select org_id, n, total, first_fy, last_fy
  from internal.mv_funder_event_stats where event_type = 'grant'
),
purposes as (
  select funder_org_id, string_agg(p, '; ' order by total desc) as txt
  from (
    select funder_org_id, upper(purpose_text) ||
           case when count(*) > 1 then ' (x' || count(*) || ')' else '' end as p,
           sum(amount) as total,
           row_number() over (partition by funder_org_id
                              order by sum(amount) desc nulls last) as rn
    from internal.funding_events
    where event_type = 'grant' and purpose_text is not null
    group by funder_org_id, upper(purpose_text)
  ) t where rn <= 40
  group by funder_org_id
),
recipients as (
  select funder_org_id, string_agg(r, '; ' order by total desc) as txt
  from (
    select funder_org_id, upper(recipient_name) as r, sum(amount) as total,
           row_number() over (partition by funder_org_id
                              order by sum(amount) desc nulls last) as rn
    from internal.funding_events
    where event_type = 'grant'
    group by funder_org_id, upper(recipient_name)
  ) t where rn <= 15
  group by funder_org_id
),
geo as (
  select funder_org_id, string_agg(recipient_state, ', ' order by n desc) as txt
  from (
    select funder_org_id, recipient_state, count(*) as n,
           row_number() over (partition by funder_org_id order by count(*) desc) as rn
    from internal.funding_events
    where event_type = 'grant' and recipient_state is not null
    group by funder_org_id, recipient_state
  ) t where rn <= 5
  group by funder_org_id
)
select o.id as org_id, o.org_type, o.state, o.asset_amount as size_amount,
  left(
    o.name || ' - private foundation in ' ||
    coalesce(o.city || ', ', '') || coalesce(o.state, 'US') || '. ' ||
    coalesce('%(ntee_case)s' || '. ', '') ||
    coalesce('Assets $' || o.asset_amount::bigint || '. ', '') ||
    gs.n || ' grants on file, FY' || coalesce(gs.first_fy::text, '?') ||
    '-' || coalesce(gs.last_fy::text, '?') || '. ' ||
    coalesce('Grant purposes: ' || p.txt || '. ', '') ||
    coalesce('Grantees: ' || r.txt || '. ', '') ||
    coalesce('Grant geography: ' || g.txt || '.', ''),
  {DOC_CAP}) as doc_text
from internal.organizations o
join grant_stats gs on gs.org_id = o.id
left join purposes p on p.funder_org_id = o.id
left join recipients r on r.funder_org_id = o.id
left join geo g on g.funder_org_id = o.id
where o.org_type = 'private_foundation'
"""

COMPANY_DOCS_SQL = f"""
with awards as (
  select recipient_org_id as org_id,
         count(*) as n,
         string_agg(t, '; ' order by total desc) as titles,
         string_agg(distinct agency, ', ') as agencies
  from (
    select fe.recipient_org_id, upper(fe.purpose_text) as t, sum(fe.amount) as total,
           max(a.name) as agency,
           row_number() over (partition by fe.recipient_org_id
                              order by sum(fe.amount) desc nulls last) as rn
    from internal.funding_events fe
    join internal.organizations a on a.id = fe.funder_org_id
    where fe.event_type in ('sbir_award', 'sttr_award')
      and fe.recipient_org_id is not null and fe.purpose_text is not null
    group by fe.recipient_org_id, upper(fe.purpose_text)
  ) t where rn <= 30
  group by recipient_org_id
)
select o.id as org_id, o.org_type, o.state, null::numeric as size_amount,
  left(
    o.name || ' - company in ' ||
    coalesce(o.city || ', ', '') || coalesce(o.state, 'US') ||
    ', SBIR/STTR awardee (' || aw.n || ' awards). ' ||
    coalesce('Funded by: ' || aw.agencies || '. ', '') ||
    'Award topics: ' || aw.titles,
  {DOC_CAP}) as doc_text
from internal.organizations o
join awards aw on aw.org_id = o.id
where o.org_type = 'company'
"""

ADVISER_DOCS_SQL = f"""
with funds as (
  select r.from_org_id as org_id,
         count(*) as n,
         string_agg(fn, '; ' order by gav desc) as names,
         string_agg(distinct ft, ', ') as types
  from (
    select r.from_org_id, f.name as fn, f.fund_size as gav,
           f.focus_areas[1] as ft,
           row_number() over (partition by r.from_org_id
                              order by f.fund_size desc nulls last) as rn
    from internal.relationships r
    join internal.organizations f on f.id = r.to_org_id
    where r.rel_type = 'manages_fund'
  ) r where rn <= 12
  group by r.from_org_id
)
select o.id as org_id, o.org_type, o.state,
  coalesce(o.aum, o.fund_size) as size_amount,
  left(
    o.name ||
    case o.org_type when 'vc' then ' - venture capital firm'
                    when 'pe' then ' - private equity firm'
                    else ' - investment adviser' end ||
    ' in ' || coalesce(o.city || ', ', '') || coalesce(o.state, 'US') || '. ' ||
    case when o.is_era then 'Exempt reporting adviser. ' else '' end ||
    coalesce('Assets under management $' || coalesce(o.aum, o.fund_size)::bigint || '. ', '') ||
    coalesce('Fund types: ' || f.types || '. ', '') ||
    coalesce('Manages: ' || f.names || '.', ''),
  {DOC_CAP}) as doc_text
from internal.organizations o
left join funds f on f.org_id = o.id
where o.org_type in ('vc', 'pe', 'investment_adviser')
"""

PROGRAM_DOCS_SQL = f"""
select fp.id as program_id, 'gov_agency' as org_type, null::text as state,
  fp.award_ceiling as size_amount,
  left(
    fp.name || ' - federal ' || fp.program_type || ' program administered by ' ||
    a.name || '. ' ||
    case when fp.non_dilutive then 'Non-dilutive funding (no equity taken). ' else '' end ||
    case when fp.funds_lab_not_company
         then 'Important: funds a national laboratory to work on the company''s behalf; the company does not receive the money directly. '
         else '' end ||
    coalesce(fp.description || ' ', '') ||
    coalesce('Eligibility: ' || fp.eligibility || '. ', '') ||
    coalesce('Award range $' || fp.award_floor::bigint || ' to $' || fp.award_ceiling::bigint || '.', ''),
  {DOC_CAP}) as doc_text
from internal.funding_programs fp
join internal.organizations a on a.id = fp.administering_org_id
"""


def _ntee_decode_case() -> str:
    """SQL CASE expression decoding the NTEE major group letter."""
    whens = " ".join(
        f"when left(o.ntee_code, 1) = '{k}' then '{v}'" for k, v in NTEE_MAJOR.items()
    )
    return f"case {whens} else null end"


BUILDERS: dict[str, str] = {
    "foundation": FOUNDATION_DOCS_SQL.replace("'%(ntee_case)s'", _ntee_decode_case()),
    "company": COMPANY_DOCS_SQL,
    "adviser": ADVISER_DOCS_SQL,
    "program": PROGRAM_DOCS_SQL,
}


def _doc_hash(text: str) -> str:
    return hashlib.sha256(f"{text}|{MODEL_TAG}".encode()).hexdigest()


def build_docs(kinds: list[str] | None = None, dry_run: bool = False) -> dict:
    """Build/refresh doc rows. Changed hash => embedding reset to NULL."""
    counts: dict[str, dict] = {}
    with connect() as conn:
        for kind, sql_text in BUILDERS.items():
            if kinds and kind not in kinds:
                continue
            with conn.cursor() as cur:
                cur.execute("set local statement_timeout = '30min'")
                cur.execute(sql_text)
                rows = cur.fetchall()
                cols = [d.name for d in cur.description]
            idx = {c: i for i, c in enumerate(cols)}
            built = []
            for r in rows:
                text = (r[idx["doc_text"]] or "").strip()
                if len(text) < 40:
                    continue
                built.append({
                    "org_id": r[idx["org_id"]] if "org_id" in idx else None,
                    "program_id": r[idx["program_id"]] if "program_id" in idx else None,
                    "org_type": r[idx["org_type"]],
                    "state": r[idx["state"]],
                    "size_amount": r[idx["size_amount"]],
                    "doc_text": text,
                    "doc_hash": _doc_hash(text),
                    "token_count": len(text) // 4,
                })
            tokens = sum(d["token_count"] for d in built)
            counts[kind] = {"docs": len(built), "tokens": tokens,
                            "est_cost_usd": round(tokens / 1_000_000 * 0.06, 2)}
            if dry_run:
                sample = next((d["doc_text"] for d in built
                               if "SIMONS FOUNDATION" in d["doc_text"][:60]), None)
                if sample:
                    counts[kind]["sample"] = sample[:600]
                continue

            with conn.cursor() as cur:
                cur.execute("set local statement_timeout = '30min'")
                cur.execute("""
                    create temp table _docs (
                      org_id uuid, program_id uuid, org_type text, state text,
                      size_amount numeric, doc_text text, doc_hash char(64),
                      token_count int
                    ) on commit drop""")
                with cur.copy(
                    "copy _docs (org_id, program_id, org_type, state, size_amount,"
                    " doc_text, doc_hash, token_count) from stdin"
                ) as copy:
                    for d in built:
                        copy.write_row((d["org_id"], d["program_id"], d["org_type"],
                                        d["state"], d["size_amount"], d["doc_text"],
                                        d["doc_hash"], d["token_count"]))
                cur.execute("""
                    insert into internal.search_documents
                      (org_id, program_id, doc_kind, doc_text, doc_hash,
                       org_type, state, size_amount, model, token_count)
                    select org_id, program_id, %(kind)s, doc_text, doc_hash,
                           org_type, state, size_amount, %(model)s, token_count
                    from _docs
                    on conflict (org_id, program_id) do update set
                      doc_text = excluded.doc_text,
                      doc_hash = excluded.doc_hash,
                      org_type = excluded.org_type,
                      state = excluded.state,
                      size_amount = excluded.size_amount,
                      token_count = excluded.token_count,
                      embedding = case when internal.search_documents.doc_hash
                                            <> excluded.doc_hash
                                       then null
                                       else internal.search_documents.embedding end
                """, {"kind": kind, "model": MODEL_TAG})
            conn.commit()
    return counts


def embed_pending(limit: int | None = None) -> dict:
    """Embed all docs with embedding IS NULL, in Voyage batches."""
    settings = get_settings()
    api_key = getattr(settings, "voyage_api_key", None)
    if not api_key:
        raise RuntimeError("VOYAGE_API_KEY is not set in .env")

    embedded = 0
    tokens = 0
    with connect() as conn:
        while True:
            with conn.cursor() as cur:
                cur.execute("""
                    select id, doc_text, token_count from internal.search_documents
                    where embedding is null
                    order by id limit %s""", (BATCH,))
                batch = cur.fetchall()
            if not batch:
                break
            texts = [b[1] for b in batch]
            for attempt in range(6):
                try:
                    resp = httpx.post(
                        VOYAGE_URL,
                        headers={"Authorization": f"Bearer {api_key}"},
                        json={"input": texts, "model": MODEL,
                              "input_type": "document", "output_dimension": DIMS},
                        timeout=120.0,
                    )
                    if resp.status_code == 429:
                        time.sleep(min(2 ** attempt * 2, 60))
                        continue
                    resp.raise_for_status()
                    break
                except httpx.TransportError:
                    if attempt == 5:
                        raise
                    time.sleep(min(2 ** attempt * 2, 60))
            data = resp.json()["data"]
            with conn.cursor() as cur:
                cur.execute("""
                    create temp table _emb (id bigint primary key, v text)
                    on commit drop""")
                with cur.copy("copy _emb (id, v) from stdin") as copy:
                    for row, item in zip(batch, data):
                        copy.write_row((row[0], json.dumps(item["embedding"])))
                cur.execute("""
                    update internal.search_documents sd
                    set embedding = _emb.v::extensions.halfvec(512),
                        embedded_at = now()
                    from _emb where sd.id = _emb.id""")
            conn.commit()
            embedded += len(batch)
            tokens += sum(b[2] or 0 for b in batch)
            if limit and embedded >= limit:
                break
            print(f"embedded {embedded} docs…", flush=True)
    return {"embedded": embedded, "tokens": tokens}


def ensure_hnsw() -> bool:
    """Create the HNSW index if missing (after bulk embed)."""
    with connect() as conn, conn.cursor() as cur:
        cur.execute("""
            select 1 from pg_indexes
            where schemaname = 'internal' and indexname = 'ix_sd_hnsw'""")
        if cur.fetchone():
            return False
        cur.execute("set local statement_timeout = '30min'")
        cur.execute("set local maintenance_work_mem = '256MB'")
        cur.execute("""
            create index ix_sd_hnsw on internal.search_documents
            using hnsw (embedding extensions.halfvec_cosine_ops)
            with (m = 16, ef_construction = 64)""")
        conn.commit()
        return True


def sync(kinds: list[str] | None = None, dry_run: bool = False,
         rebuild: bool = False, skip_index: bool = False) -> dict:
    if rebuild and not dry_run:
        with connect() as conn, conn.cursor() as cur:
            cur.execute("update internal.search_documents set embedding = null, doc_hash = ''")
            conn.commit()

    counts = build_docs(kinds, dry_run=dry_run)
    result: dict = {"build": counts}
    if dry_run:
        return result

    emb = embed_pending()
    result["embed"] = emb
    # The HNSW build needs ~200MB + temp space in one shot; --skip-index lets
    # the (resumable, batch-committed) embedding land first on a tight disk.
    result["hnsw_created"] = False if skip_index else ensure_hnsw()

    # Ledger + run manifest (file-first doctrine: the run manifest is the artifact)
    manifest_dir = Path(get_settings().data_root) / "embeddings"
    manifest_dir.mkdir(parents=True, exist_ok=True)
    manifest = manifest_dir / f"run-{datetime.now():%Y%m%d-%H%M%S}.json"
    manifest.write_text(json.dumps({"model": MODEL_TAG, **result}, indent=2, default=str))
    with connect() as conn:
        staged = staging.stage_local(f"embeddings_{MODEL_TAG}", manifest)
        rfid = staging.register_raw_file(conn, staged, license_code="cc_by",
                                         content_type="application/json")
        conn.commit()
        run_id = ledger.start_run(conn, rfid, f"embeddings:{MODEL_TAG}")
        ledger.complete_run(conn, run_id, inserted=emb["embedded"],
                            notes=json.dumps({k: v.get("docs") for k, v in counts.items()}))
    return result
