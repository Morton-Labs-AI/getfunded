"""Job B: dedupe internal.people across sources (Splink on DuckDB, local).

~940k person rows from four sources (ADV Schedule A/B, Form D related persons,
990-PF officers, SBIR POC/PI); 74,505 cross-source duplicate name groups
measured at scoping. Evidence: TF-adjusted token-sorted name, org-graph
overlap, weak state.

POLICY (the Eric Schmidt rule): a pair auto-merges ONLY when the org-evidence
comparison fired — name-only exact matches cap at 'pending' no matter the
probability. Two different people who share a name must never auto-merge on
the name alone. Enforced twice: in the status CASE at load and by a post-load
assertion.

ORDERING: runs after `resolve funds --apply`. ADV person edges point at the
ADVISER while Form D person edges point at the FUND the funds job merges into
the ADV fund — the org-evidence arrays only intersect across those sources
when direct orgs are expanded one hop through manages_fund and every org id
is routed through the canonical map (org_resolve). Without the funds apply
the discriminator is structurally blind across ADV/Form D, which is why
predict refuses on an all-NULL canonical map.

No deterministic exact-name class here (deliberate divergence from funds):
every exact-name pair is already inside the name_key block and gets a
TF-adjusted score; loading ~10^5 name-only pairs as pending would flood
review with exactly the pairs the policy forbids auto-merging anyway.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime
from pathlib import Path

from .. import ledger, staging
from ..config import get_settings
from ..db import connect
from .common import (ENTITY_NAME_RE, JOBS, PERSON_KEY_SQL,
                     export_query_to_parquet, union_find_clusters, wilson_low)

SPEC = JOBS["people"]
JOB = SPEC.job                       # 'people_dedupe'
AUTO_THRESHOLD = SPEC.auto_threshold
REVIEW_FLOOR = 0.20                  # wide pending band; labeling locates the cliff
CLUSTER_CAP = SPEC.cluster_cap
PAIR_GUARD = 50_000_000              # abort predict if blocking estimates above this

# first_token/last_token are the alphabetical extremes of the SORTED name key —
# not first/surname (unrecoverable across "Last First Middle" vs "First Last").
# They exist purely as a recall blocking key that survives middle-name
# insertion/omission whenever the added token doesn't sort to an extreme.
_FRAME_SQL = f"""
with edges as (
  select rel.from_person_id as person_id, rel.to_org_id, orr.canonical_id
  from internal.relationships rel
  join internal.org_resolve orr on orr.org_id = rel.to_org_id
  where rel.from_person_id is not null
    and rel.rel_type in ('owner_of','executive_of','officer_of',
                         'director_of','trustee_of','poc_for')
),
managed as (
  -- One-hop expansion: funds managed by the person's direct orgs. This is
  -- what makes ADV-person(->adviser) and FormD-person(->fund) arrays
  -- intersect once the funds job has merged the fund rows.
  select e.person_id, fr.canonical_id
  from edges e
  join internal.relationships mf
    on mf.from_org_id = e.to_org_id and mf.rel_type = 'manages_fund'
  join internal.org_resolve fr on fr.org_id = mf.to_org_id
),
org_evidence as (
  select person_id, array_agg(distinct canonical_id::text) as orgs
  from (select person_id, canonical_id from edges
        union
        select person_id, canonical_id from managed
        union
        select p2.id, r2.canonical_id
          from internal.people p2
          join internal.org_resolve r2 on r2.org_id = p2.primary_org_id) u
  group by person_id
)
select p.id::text as unique_id,
       nk.name_key,
       split_part(nk.name_key, ' ', 1) as first_token,
       (select max(t) from unnest(string_to_array(nk.name_key, ' ')) t) as last_token,
       o.state,
       p.primary_title as title,
       split_part(p.source_natural_key, ':', 1) as source,
       coalesce(oe.orgs, '{{}}') as orgs
from internal.people p
cross join lateral (select {PERSON_KEY_SQL} as name_key) nk
left join internal.organizations o on o.id = p.primary_org_id
left join org_evidence oe on oe.person_id = p.id
where internal.norm_name(p.full_name) !~ %(entity_re)s
  and coalesce(array_length(string_to_array(internal.norm_name(p.full_name), ' '), 1), 0) >= 2
"""

_SKIP_COUNT_SQL = """
select count(*) filter (where internal.norm_name(full_name) ~ %(entity_re)s)
         as entity_rows_skipped,
       count(*) filter (where internal.norm_name(full_name) !~ %(entity_re)s
         and coalesce(array_length(string_to_array(
               internal.norm_name(full_name), ' '), 1), 0) < 2)
         as short_name_skipped
from internal.people
"""


def _settings_dict():
    """Version-robust Splink settings (raw DuckDB SQL conditions, no
    comparison-library class names) — same pattern as funds."""
    name_comparison = {
        "output_column_name": "name_key",
        "comparison_levels": [
            {"sql_condition": '"name_key_l" IS NULL OR "name_key_r" IS NULL',
             "label_for_charts": "null", "is_null_level": True},
            {"sql_condition": '"name_key_l" = "name_key_r"',
             "label_for_charts": "exact",
             "tf_adjustment_column": "name_key"},
            {"sql_condition": 'jaro_winkler_similarity("name_key_l", "name_key_r") >= 0.94',
             "label_for_charts": "jw>=0.94"},
            {"sql_condition": 'jaro_winkler_similarity("name_key_l", "name_key_r") >= 0.88',
             "label_for_charts": "jw>=0.88"},
            {"sql_condition": "ELSE", "label_for_charts": "different"},
        ],
    }
    orgs_comparison = {
        "output_column_name": "orgs",
        "comparison_levels": [
            {"sql_condition": 'len("orgs_l") = 0 OR len("orgs_r") = 0',
             "label_for_charts": "no org evidence", "is_null_level": True},
            {"sql_condition": 'len(list_intersect("orgs_l", "orgs_r")) >= 2',
             "label_for_charts": "2+ shared orgs"},
            {"sql_condition": 'len(list_intersect("orgs_l", "orgs_r")) = 1',
             "label_for_charts": "1 shared org"},
            {"sql_condition": "ELSE", "label_for_charts": "no overlap"},
        ],
    }
    state_comparison = {
        "output_column_name": "state",
        "comparison_levels": [
            {"sql_condition": '"state_l" IS NULL OR "state_r" IS NULL',
             "label_for_charts": "null", "is_null_level": True},
            {"sql_condition": '"state_l" = "state_r"', "label_for_charts": "same state"},
            {"sql_condition": "ELSE", "label_for_charts": "different state"},
        ],
    }
    # title is deliberately NOT a comparison: cross-source vocabulary is
    # incomparable ("CEO" vs relationship-clarification prose). Display-only.
    return name_comparison, orgs_comparison, state_comparison


def _export_frame(er_dir: Path) -> tuple[Path, int]:
    import pyarrow as pa

    er_dir.mkdir(parents=True, exist_ok=True)
    path = er_dir / "people_frame.parquet"
    # Explicit schema: orgs is all-empty for large swaths of the frame and
    # a batch of only empty arrays would infer list<null>.
    schema = pa.schema([
        ("unique_id", pa.string()), ("name_key", pa.string()),
        ("first_token", pa.string()), ("last_token", pa.string()),
        ("state", pa.string()), ("title", pa.string()),
        ("source", pa.string()), ("orgs", pa.list_(pa.string())),
    ])
    with connect() as conn:
        n = export_query_to_parquet(conn, _FRAME_SQL, {"entity_re": ENTITY_NAME_RE},
                                    path, schema=schema)
    return path, n


def _preflight(con, frame_path: Path) -> dict:
    """Pair-volume estimate per blocking rule, printed and ledgered. The guard
    exists so a bad key never melts a laptop."""
    stats = {}
    for key, expr in (("name_key", "name_key"),
                      ("first_last", "first_token || '|' || last_token")):
        row = con.execute(f"""
            select count(*) filter (where n > 1),
                   coalesce(sum(n*(n-1)/2) filter (where n > 1), 0),
                   coalesce(max(n), 0)
            from (select count(*) as n from read_parquet('{frame_path}')
                  group by {expr})""").fetchone()
        stats[f"{key}_dup_groups"] = int(row[0])
        stats[f"{key}_block_pairs"] = int(row[1])
        stats[f"{key}_largest_group"] = int(row[2])
    total = stats["name_key_block_pairs"] + stats["first_last_block_pairs"]
    print(f"pre-flight: {stats}  (combined ~{total:,} pairs)", flush=True)
    if total > PAIR_GUARD:
        raise RuntimeError(
            f"Blocking estimates {total:,} candidate pairs (> {PAIR_GUARD:,}). "
            "A blocking key is degenerate — inspect the frame before running.")
    return stats


def predict(force: bool = False) -> dict:
    from splink import DuckDBAPI, Linker, SettingsCreator, block_on

    settings_obj = get_settings()
    er_dir = Path(settings_obj.data_root) / "er"

    counts: dict[str, int] = {}
    with connect() as conn, conn.cursor() as cur:
        # ORDERING CHECK: the org-evidence discriminator is blind across
        # ADV/Form D until the funds canonical map exists.
        cur.execute("select count(canonical_org_id) from internal.organizations")
        (n_canonical,) = cur.fetchone()
        if n_canonical == 0 and not force:
            raise RuntimeError(
                "people dedupe requires the fund canonical map: run "
                "`funderdb resolve funds --apply` first (funds -> people "
                "ordering); pass --force to run with unrouted org evidence "
                "(recall degradation only, but the labels you collect will "
                "not transfer to the post-apply prediction).")
        counts["n_canonical_orgs"] = n_canonical
        cur.execute(_SKIP_COUNT_SQL, {"entity_re": ENTITY_NAME_RE})
        entity_skipped, short_skipped = cur.fetchone()
        counts["entity_rows_skipped"] = entity_skipped
        counts["short_name_skipped"] = short_skipped

    frame_path, n_rows = _export_frame(er_dir)
    counts["frame_rows"] = n_rows

    import duckdb as ddb

    con = ddb.connect()
    counts.update(_preflight(con, frame_path))
    df_people = con.read_parquet(str(frame_path)).df()

    name_c, orgs_c, state_c = _settings_dict()
    settings = SettingsCreator(
        link_type="dedupe_only",
        comparisons=[name_c, orgs_c, state_c],
        blocking_rules_to_generate_predictions=[
            block_on("name_key"),
            block_on("first_token", "last_token"),
        ],
        retain_intermediate_calculation_columns=True,
    )
    db_api = DuckDBAPI()
    linker = Linker(df_people, settings, db_api)

    linker.training.estimate_probability_two_random_records_match(
        ['l.name_key = r.name_key and len(list_intersect(l.orgs, r.orgs)) >= 1'],
        recall=0.7,
    )
    linker.training.estimate_u_using_random_sampling(max_pairs=5_000_000)
    # Two EM passes: a variable's m-values can't be trained inside its own
    # blocking rule, so name_key trains in the (first_token, last_token)
    # session and orgs/state train in the name_key session.
    linker.training.estimate_parameters_using_expectation_maximisation(
        block_on("name_key")
    )
    linker.training.estimate_parameters_using_expectation_maximisation(
        block_on("first_token", "last_token")
    )

    preds = linker.inference.predict(threshold_match_probability=REVIEW_FLOOR)
    df = preds.as_pandas_dataframe()
    counts["pairs_scored"] = len(df)

    import numpy as np
    hist, edges = np.histogram(df["match_probability"],
                               bins=[0.2, 0.5, 0.8, 0.95, 0.99, 1.0001])
    print("probability distribution:",
          {f"{edges[i]:.2f}-{edges[i+1]:.2f}": int(hist[i]) for i in range(len(hist))},
          flush=True)

    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    pred_path = er_dir / f"people_predictions_{ts}.parquet"
    df.to_parquet(pred_path)

    model_json = json.dumps(linker.misc.save_model_to_json(), sort_keys=True, default=str)
    model_sha = hashlib.sha256(model_json.encode()).hexdigest()[:12]
    (er_dir / "models").mkdir(exist_ok=True)
    (er_dir / "models" / f"people@{model_sha}.json").write_text(model_json)

    with connect() as conn:
        staged = staging.stage_local(SPEC.dataset, pred_path)
        rfid = staging.register_raw_file(conn, staged, license_code="cc_by",
                                        content_type="application/x-parquet")
        conn.commit()
        run_id = ledger.start_run(conn, rfid, SPEC.dataset)
        try:
            with conn.cursor() as cur:
                cur.execute("set local statement_timeout = '30min'")
                # Splink-scoped delete: human decisions survive by status,
                # and (unlike the original funds delete) nothing outside
                # method='splink:%' is touched.
                cur.execute("""
                    delete from internal.entity_links
                    where job = %(job)s and status in ('auto', 'pending')
                      and method like 'splink:%%'""", {"job": JOB})
                cur.execute("""
                    create temp table _links (
                      id_a uuid, id_b uuid, weight real, prob real, features jsonb
                    ) on commit drop""")
                gamma_cols = [c for c in df.columns if c.startswith("gamma_")]
                with cur.copy("copy _links (id_a, id_b, weight, prob, features) from stdin") as copy:
                    for row in df.itertuples(index=False):
                        d = row._asdict()
                        a, b = sorted((d["unique_id_l"], d["unique_id_r"]))
                        copy.write_row((
                            a, b,
                            float(d["match_weight"]),
                            float(d["match_probability"]),
                            json.dumps({g: int(d[g]) for g in gamma_cols
                                        if d.get(g) is not None}),
                        ))
                # THE POLICY, in the status CASE: auto requires the org
                # comparison to have fired, not just a high probability.
                cur.execute("""
                    insert into internal.entity_links
                      (entity_type, job, id_a, id_b, method, match_weight,
                       match_probability, features, status, raw_file_id,
                       source_record_locator)
                    select 'person', %(job)s, l.id_a, l.id_b,
                           %(method)s, l.weight, l.prob, l.features,
                           case when l.prob >= %(auto)s
                                 and coalesce((l.features->>'gamma_orgs')::int, 0) >= 1
                                then 'auto' else 'pending' end,
                           %(rfid)s, 'pair:' || l.id_a || ':' || l.id_b
                    from _links l
                    on conflict (job, id_a, id_b) do update set
                      match_weight = excluded.match_weight,
                      match_probability = excluded.match_probability,
                      features = excluded.features,
                      method = excluded.method,
                      raw_file_id = excluded.raw_file_id,
                      status = case when internal.entity_links.status in ('auto','pending')
                                    then excluded.status
                                    else internal.entity_links.status end""",
                    {"job": JOB, "method": f"splink:people@{model_sha}",
                     "rfid": rfid, "auto": AUTO_THRESHOLD})
                counts["links_loaded"] = cur.rowcount

                # Structural invariant (the Eric Schmidt rule as code).
                cur.execute("""
                    select count(*) from internal.entity_links
                    where job = %(job)s and status = 'auto'
                      and coalesce((features->>'gamma_orgs')::int, 0) = 0""",
                    {"job": JOB})
                (bad,) = cur.fetchone()
                if bad:
                    raise RuntimeError(
                        f"POLICY VIOLATION: {bad} auto rows without org evidence")

                cur.execute("""select status, count(*) from internal.entity_links
                               where job = %(job)s group by 1""", {"job": JOB})
                for status, n in cur.fetchall():
                    counts[f"status_{status}"] = n
            conn.commit()
            ledger.complete_run(conn, run_id, inserted=counts.get("links_loaded", 0),
                                notes=json.dumps({k: v for k, v in counts.items()}))
        except Exception as exc:
            try:
                conn.rollback()
                ledger.fail_run(conn, run_id, f"{type(exc).__name__}: {exc}")
            except Exception:
                pass
            raise
    return counts


def apply(threshold: float = AUTO_THRESHOLD, force: bool = False) -> dict:
    """Recompute canonical_person_id: accepted ∪ (org-corroborated splink
    >= threshold) − rejected, union-find capped at CLUSTER_CAP. Refused until
    the auto-class precision gate has labels unless --force. The threshold is
    real here (unlike the original funds apply): gate and certified set carry
    the identical predicate, so certification and merge population match."""
    counts: dict[str, int] = {}
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                select count(*) filter (where l.label = 'match'), count(*)
                from internal.er_labels l
                join internal.entity_links el
                  on el.job = l.job and el.id_a = l.id_a and el.id_b = l.id_b
                where l.job = %(job)s and l.label <> 'unsure'
                  and el.method like 'splink:%%'
                  and coalesce((el.features->>'gamma_orgs')::int, 0) >= 1
                  and el.match_probability >= %(threshold)s""",
                {"job": JOB, "threshold": threshold})
            correct, n_labels = cur.fetchone()
            low = wilson_low(correct or 0, n_labels or 0)
            if (n_labels < 100 or low <= 0.90) and not force:
                raise RuntimeError(
                    f"Precision gate: auto-class labels {correct}/{n_labels}, "
                    f"Wilson lower bound {low:.3f} (need n>=100 and >0.90). "
                    "Run `funderdb resolve label people --stratum auto` first, "
                    "or pass --force to apply provisionally.")
            # Certified links mirror the auto filter exactly; name-only pairs
            # merge ONLY via explicit human acceptance.
            cur.execute("""
                select id_a, id_b from internal.entity_links
                where job = %(job)s
                  and (status = 'accepted'
                       or (status in ('auto', 'pending')
                           and method like 'splink:%%'
                           and coalesce((features->>'gamma_orgs')::int, 0) >= 1
                           and match_probability >= %(threshold)s))
                except
                select id_a, id_b from internal.entity_links
                where job = %(job)s and status = 'rejected'""",
                {"job": JOB, "threshold": threshold})
            pairs = cur.fetchall()

        clusters, oversize = union_find_clusters(pairs, CLUSTER_CAP)
        counts["pairs_used"] = len(pairs)
        counts["clusters"] = len(clusters)
        counts["oversize_skipped"] = len(oversize)

        with conn.cursor() as cur:
            cur.execute("set local statement_timeout = '30min'")
            # Canonical rep: most relationships, then most contact channels,
            # then oldest (no person_identifiers table to count).
            all_ids = [i for c in clusters for i in c]
            cur.execute("""
                create temp table _rank on commit drop as
                select p.id::text as id,
                       (select count(*) from internal.relationships r
                         where r.from_person_id = p.id) as n_rels,
                       (select count(*) from internal.contact_channels c
                         where c.person_id = p.id) as n_contacts,
                       p.created_at
                from internal.people p where p.id::text = any(%s)""",
                (all_ids,))
            cur.execute("select id, n_rels, n_contacts, created_at from _rank")
            rank = {r[0]: (r[1], r[2], r[3]) for r in cur.fetchall()}

            mapping: list[tuple[str, str]] = []
            for cluster in clusters:
                rep = max(cluster, key=lambda i: (rank[i][0], rank[i][1],
                                                  -rank[i][2].timestamp()))
                for i in cluster:
                    if i != rep:
                        mapping.append((i, rep))

            cur.execute("""
                update internal.people set canonical_person_id = null
                where canonical_person_id is not null
                  and id in (select id_a from internal.entity_links where job = %(job)s
                             union
                             select id_b from internal.entity_links where job = %(job)s)""",
                {"job": JOB})
            cur.execute("""
                create temp table _map (dup uuid, rep uuid) on commit drop""")
            with cur.copy("copy _map (dup, rep) from stdin") as copy:
                for dup, rep in mapping:
                    copy.write_row((dup, rep))
            cur.execute("""
                update internal.people p set canonical_person_id = m.rep
                from _map m where p.id = m.dup""")
            counts["people_canonicalized"] = len(mapping)
        conn.commit()
    return counts
