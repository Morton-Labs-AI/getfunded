"""Shared entity-resolution machinery used by every resolve job.

The JobSpec registry is the single source of truth for each job's class
taxonomy: which SQL predicate defines the corroborated (auto-eligible) class,
which labeling strata exist, and which stratum certifies apply. The gate
query, the apply query, and the eval classifier must stay provably identical —
keeping the predicates here is what makes that a lookup instead of a
convention.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

# Person names are TOKEN-SORTED before comparison: ADV Schedule A/B stores
# "Last, First Middle" while Form D stores "First Last", so raw normalization
# never intersects ("BONDICK GREGORY JOHN" vs "GREGORY JOHN BONDICK"). Sorting
# tokens makes both sides "BONDICK GREGORY JOHN". Entity GPs listed as Form D
# related persons (names containing LLC/LP/FUND/...) are organizations, not
# people, and are filtered out wherever person names serve as evidence.
PERSON_KEY_SQL = """
(select string_agg(t, ' ' order by t)
   from unnest(string_to_array(internal.norm_name(p.full_name), ' ')) t)
"""
ENTITY_NAME_RE = (
    r"\m(LLC|L L C|LTD|INC|CORP|GP|LP|L P|LLP|FUND|FUNDS|GROUP|PARTNERS|"
    r"CAPITAL|MANAGEMENT|HOLDINGS|ADVISORS|ADVISERS|COMPANY|TRUST)\M"
)


def wilson_low(correct: int, n: int) -> float:
    """95% Wilson score interval lower bound."""
    if n == 0:
        return 0.0
    phat = correct / n
    z = 1.96
    denom = 1 + z * z / n
    centre = phat + z * z / (2 * n)
    margin = z * math.sqrt(phat * (1 - phat) / n + z * z / (4 * n * n))
    return (centre - margin) / denom


def union_find_clusters(
    pairs: list[tuple], cap: int
) -> tuple[list[list[str]], set[str]]:
    """Union-find with a cluster cap. Merges that would push a component past
    `cap` members mark every involved id oversize instead; clusters touching
    an oversize id are dropped entirely (all their links stay pending)."""
    parent: dict[str, str] = {}

    def find(x: str) -> str:
        while parent.get(x, x) != x:
            parent[x] = parent.get(parent[x], parent[x])
            x = parent[x]
        return x

    members: dict[str, set[str]] = {}
    oversize: set[str] = set()
    for a, b in pairs:
        a, b = str(a), str(b)
        ra, rb = find(a), find(b)
        if ra == rb:
            continue
        ma = members.setdefault(ra, {ra})
        mb = members.setdefault(rb, {rb})
        if len(ma) + len(mb) > cap:
            oversize.update(ma | mb)
            continue
        parent[rb] = ra
        ma |= mb
        members.pop(rb, None)

    clusters = [sorted(m) for m in members.values()
                if len(m) > 1 and not (m & oversize)]
    return clusters, oversize


def export_query_to_parquet(conn, sql: str, params, path, batch_rows: int = 50_000,
                            schema=None) -> int:
    """Stream a query into a parquet file without materializing every row in
    Python at once (the people frame is ~900k rows with array columns).

    Pass an explicit pyarrow `schema` when a column could be all-NULL or
    all-empty-array within a single batch — inference would type it null."""
    import pyarrow as pa
    import pyarrow.parquet as pq

    n = 0
    writer = None
    try:
        # set local needs a plain cursor (it also opens the transaction the
        # named cursor below participates in); the NAMED cursor makes this a
        # true server-side stream — a client-side cursor would buffer the
        # whole result set in Python at execute().
        with conn.cursor() as setup:
            setup.execute("set local statement_timeout = '30min'")
        with conn.cursor(name="er_parquet_export") as cur:
            cur.itersize = batch_rows
            cur.execute(sql, params)
            cols = [d.name for d in cur.description]
            while True:
                rows = cur.fetchmany(batch_rows)
                if not rows:
                    break
                table = pa.table(
                    {c: [r[i] for r in rows] for i, c in enumerate(cols)},
                    schema=schema,
                )
                if writer is None:
                    writer = pq.ParquetWriter(path, table.schema)
                elif table.schema != writer.schema:
                    table = table.cast(writer.schema)
                writer.write_table(table)
                n += len(rows)
    finally:
        if writer is not None:
            writer.close()
    return n


@dataclass(frozen=True)
class JobSpec:
    job: str                    # entity_links.job value
    entity_type: str            # 'organization' | 'person'
    dataset: str                # staging/ledger dataset name
    gamma_gate: str             # SQL bool over el.*: the corroborated class
    auto_threshold: float
    apply_threshold: float      # binds %(threshold)s: the floor apply merges at
    cluster_cap: int
    strata: dict[str, str]      # labeling stratum -> SQL where over el
    gate_stratum: str           # class whose labels certify apply
    class_case_sql: str         # CASE expr classifying a labeled pair
    prompt_noun: str            # what a y-answer asserts ("fund", "person")
    # (class, description, auto_rule) rows for eval display, in print order.
    class_info: tuple = field(default=())


# Stratum/class predicates may reference %(threshold)s; callers bind the job's
# apply_threshold (psycopg named params ignore unused keys, so threshold-free
# predicates are fine).
JOBS: dict[str, JobSpec] = {
    "funds": JobSpec(
        job="funds_adv_formd",
        entity_type="organization",
        dataset="resolve_funds",
        gamma_gate="coalesce((el.features->>'gamma_people')::int, 0) >= 1",
        auto_threshold=0.99,
        # The funds model's probability range is 0.566–0.943: a 0.99 apply
        # floor would certify (and merge) the empty set. Corroboration, not
        # the threshold, defines the certified class here; REVIEW_FLOOR makes
        # the threshold real while staying a no-op on today's population.
        apply_threshold=0.20,
        cluster_cap=4,
        strata={
            # The certified class: people-corroborated AND above threshold —
            # exactly the population apply merges, so this stratum's labels
            # certify it.
            "people": "el.method like 'splink:%%' and "
                      "coalesce((el.features->>'gamma_people')::int, 0) >= 1 and "
                      "el.match_probability >= %(threshold)s",
            # Exact normalized name PLUS cross-side person corroboration.
            # The name carries fund identity; person overlap only disambiguates
            # same-name funds at different firms. (The 'people' stratum inverts
            # that — it selects on shared people, which the labeling rubric
            # calls FAMILY-level evidence, explicitly not evidence of fund
            # identity — and it failed its gate at 0.858 on 2026-08-08.)
            # people_overlap is backfilled by funds.backfill_people_overlap().
            "nameonly_people": "el.method = 'deterministic:exact_name' and "
                               "coalesce((el.features->>'people_overlap')::int, 0) >= 1",
            # Exact name with NO person corroboration — measured separately,
            # never certified on its own (a bare name match cannot distinguish
            # two unrelated "Growth Fund I LP"s).
            "nameonly": "el.method = 'deterministic:exact_name' and "
                        "coalesce((el.features->>'people_overlap')::int, 0) = 0",
            "band": "el.method like 'splink:%%' and "
                    "coalesce((el.features->>'gamma_people')::int, 0) = 0",
            "all": "true",
        },
        gate_stratum="people",
        class_case_sql="""
            case when el.method = 'deterministic:exact_name'
                      and coalesce((el.features->>'people_overlap')::int, 0) >= 1
                      then 'nameonly_people'
                 when el.method = 'deterministic:exact_name' then 'nameonly'
                 when coalesce((el.features->>'gamma_people')::int, 0) >= 1
                      and el.match_probability >= %(threshold)s then 'people'
                 when coalesce((el.features->>'gamma_people')::int, 0) >= 1 then 'people_band'
                 else 'band' end""",
        prompt_noun="fund",
        class_info=(
            ("nameonly_people",
             "exact normalized name + cross-side person corroboration",
             "auto-accept if certified"),
            ("people",
             "people-corroborated splink pairs + above threshold "
             "(FAILED its gate 2026-08-08 at 227/252, Wilson low 0.858)",
             "NOT certified — stays pending"),
            ("people_band", "people-corroborated but below threshold", "stays pending"),
            ("nameonly", "exact name, NO person corroboration",
             "never certified alone — a bare name match is not identity"),
            ("band", "fuzzy name, weak evidence", "stays pending"),
        ),
    ),
    "people": JobSpec(
        job="people_dedupe",
        entity_type="person",
        dataset="resolve_people",
        gamma_gate="coalesce((el.features->>'gamma_orgs')::int, 0) >= 1",
        auto_threshold=0.99,
        apply_threshold=0.99,   # == auto_threshold: the auto stratum IS the merge population
        cluster_cap=5,
        strata={
            # The auto tier: org-corroborated AND above threshold — exactly the
            # population apply merges, so this stratum's labels certify it.
            "auto": "el.method like 'splink:%%' and "
                    "coalesce((el.features->>'gamma_orgs')::int, 0) >= 1 and "
                    "el.match_probability >= %(threshold)s",
            "band": "el.method like 'splink:%%' and "
                    "el.match_probability >= 0.80 and "
                    "el.match_probability < %(threshold)s",
            "below": "el.method like 'splink:%%' and el.match_probability < 0.80",
            # Common-name oversample: exact name key, zero org evidence.
            # Ordered by probability ASC at sampling time — TF adjustment is
            # exactly what depresses common names, so ascending surfaces them.
            "common": "el.method like 'splink:%%' and "
                      "coalesce((el.features->>'gamma_orgs')::int, 0) = 0 and "
                      "coalesce((el.features->>'gamma_name_key')::int, 0) = 3",
            "all": "true",
        },
        gate_stratum="auto",
        class_case_sql="""
            case when coalesce((el.features->>'gamma_orgs')::int, 0) >= 1
                      and el.match_probability >= %(threshold)s then 'auto'
                 when coalesce((el.features->>'gamma_orgs')::int, 0) >= 1 then 'orgs_band'
                 when coalesce((el.features->>'gamma_name_key')::int, 0) = 3 then 'nameonly'
                 else 'band' end""",
        prompt_noun="person",
        class_info=(
            ("auto", "org-corroborated + above threshold (the population apply merges)",
             "auto-accept if certified"),
            ("orgs_band", "org-corroborated but below threshold", "stays pending"),
            ("nameonly", "exact name key, zero org evidence (the Eric Schmidt class)",
             "NEVER auto-merges; human accept only"),
            ("band", "fuzzy name, weak evidence", "stays pending"),
        ),
    ),
}
