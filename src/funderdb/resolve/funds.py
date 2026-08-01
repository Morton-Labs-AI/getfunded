"""Job A: link ADV Schedule D 7B1 fund records to Form D fund issuers (Splink).

Same real-world fund, two rows: the ADV side carries sec_private_fund_id, GAV,
and a manages_fund edge from its adviser; the Form D side carries a CIK and
reg_d_offering events. Evidence for linkage: fund name (TF-adjusted — 'FUND II
LP' boilerplate makes many names near-identical), the people overlap between
the adviser's Schedule A/B owners and the Form D related persons (the
discriminator), state (weak: ADV reports Delaware domicile, Form D reports
principal place of business), and fund type.

Runs locally on DuckDB. Predictions land in internal.entity_links as
status='auto' (p >= AUTO_THRESHOLD) or 'pending'; human decisions are never
overwritten. Apply (canonical map) is refused until the precision gate has
labels — see labeling.py.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

from .. import ledger, staging
from ..config import get_settings
from ..db import connect

AUTO_THRESHOLD = 0.99   # provisional until `resolve eval funds` certifies
REVIEW_FLOOR = 0.20     # wide pending band; the labeling pass locates the cliff
CLUSTER_CAP = 4

# Token-sorted person-name key + entity-GP filter live in common.py (shared
# with the people dedupe job); aliased here so the frame SQL reads unchanged.
from .common import ENTITY_NAME_RE as _ENTITY_NAME_RE
from .common import PERSON_KEY_SQL as _PERSON_KEY
from .common import union_find_clusters, wilson_low

_ADV_FRAME_SQL = f"""
select f.id::text as unique_id,
       f.name_normalized as name_norm,
       split_part(f.name_normalized, ' ', 1) as first_token,
       f.state,
       f.focus_areas[1] as fund_type,
       max(a.name_normalized) as adviser_name,
       coalesce(array_agg(distinct {_PERSON_KEY})
                filter (where p.id is not null
                        and internal.norm_name(p.full_name) !~ %(entity_re)s),
                '{{}}') as people
from internal.organizations f
join internal.org_identifiers fi
  on fi.org_id = f.id and fi.id_type = 'sec_private_fund_id'
join internal.relationships mf
  on mf.to_org_id = f.id and mf.rel_type = 'manages_fund'
join internal.organizations a on a.id = mf.from_org_id
left join internal.relationships pr
  on pr.to_org_id = a.id and pr.rel_type in ('owner_of', 'executive_of')
 and pr.from_person_id is not null
left join internal.people p on p.id = pr.from_person_id
where f.org_type = 'fund'
group by f.id, f.name_normalized, f.state, f.focus_areas
"""

_FORMD_FRAME_SQL = f"""
select f.id::text as unique_id,
       f.name_normalized as name_norm,
       split_part(f.name_normalized, ' ', 1) as first_token,
       f.state,
       null::text as fund_type,
       null::text as adviser_name,
       coalesce(array_agg(distinct {_PERSON_KEY})
                filter (where p.id is not null
                        and internal.norm_name(p.full_name) !~ %(entity_re)s),
                '{{}}') as people
from internal.organizations f
join internal.org_identifiers fi on fi.org_id = f.id and fi.id_type = 'cik'
left join internal.relationships pr
  on pr.to_org_id = f.id and pr.rel_type in ('executive_of', 'director_of')
 and pr.from_person_id is not null
left join internal.people p on p.id = pr.from_person_id
where f.org_type = 'fund'
  and not exists (select 1 from internal.org_identifiers x
                  where x.org_id = f.id and x.id_type = 'sec_private_fund_id')
group by f.id, f.name_normalized, f.state
"""


def _export_frames(er_dir: Path) -> tuple[Path, Path, int, int]:
    er_dir.mkdir(parents=True, exist_ok=True)
    paths = []
    counts = []
    with connect() as conn:
        for label, sql_text in (("adv", _ADV_FRAME_SQL), ("formd", _FORMD_FRAME_SQL)):
            with conn.cursor() as cur:
                cur.execute("set local statement_timeout = '30min'")
                cur.execute(sql_text, {"entity_re": _ENTITY_NAME_RE})
                rows = cur.fetchall()
                cols = [d.name for d in cur.description]
            table = pa.table(
                {c: [r[i] for r in rows] for i, c in enumerate(cols)}
            )
            path = er_dir / f"funds_{label}.parquet"
            pq.write_table(table, path)
            paths.append(path)
            counts.append(len(rows))
    return paths[0], paths[1], counts[0], counts[1]


def _settings_dict():
    """Version-robust Splink settings: dict-based comparisons with raw DuckDB
    SQL conditions (no dependence on comparison-library class names)."""
    name_comparison = {
        "output_column_name": "name_norm",
        "comparison_levels": [
            {"sql_condition": '"name_norm_l" IS NULL OR "name_norm_r" IS NULL',
             "label_for_charts": "null", "is_null_level": True},
            {"sql_condition": '"name_norm_l" = "name_norm_r"',
             "label_for_charts": "exact",
             "tf_adjustment_column": "name_norm"},
            {"sql_condition": 'jaro_winkler_similarity("name_norm_l", "name_norm_r") >= 0.94',
             "label_for_charts": "jw>=0.94"},
            {"sql_condition": 'jaro_winkler_similarity("name_norm_l", "name_norm_r") >= 0.88',
             "label_for_charts": "jw>=0.88"},
            {"sql_condition": "ELSE", "label_for_charts": "different"},
        ],
    }
    people_comparison = {
        "output_column_name": "people",
        "comparison_levels": [
            {"sql_condition": 'len("people_l") = 0 OR len("people_r") = 0',
             "label_for_charts": "no people", "is_null_level": True},
            {"sql_condition": 'len(list_intersect("people_l", "people_r")) >= 2',
             "label_for_charts": "2+ shared people"},
            {"sql_condition": 'len(list_intersect("people_l", "people_r")) = 1',
             "label_for_charts": "1 shared person"},
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
    return name_comparison, people_comparison, state_comparison


def predict(sample_only: bool = False) -> dict:
    from splink import DuckDBAPI, Linker, SettingsCreator, block_on

    settings_obj = get_settings()
    er_dir = Path(settings_obj.data_root) / "er"
    adv_path, formd_path, n_adv, n_formd = _export_frames(er_dir)

    import duckdb as ddb

    con = ddb.connect()
    df_adv = con.read_parquet(str(adv_path)).df()
    df_formd = con.read_parquet(str(formd_path)).df()

    name_c, people_c, state_c = _settings_dict()
    settings = SettingsCreator(
        link_type="link_only",
        comparisons=[name_c, people_c, state_c],
        blocking_rules_to_generate_predictions=[
            block_on("name_norm"),
            block_on("first_token", "state"),
        ],
        retain_intermediate_calculation_columns=True,
    )
    db_api = DuckDBAPI()
    linker = Linker([df_adv, df_formd], settings, db_api,
                    input_table_aliases=["adv", "formd"])

    linker.training.estimate_probability_two_random_records_match(
        [
            'l.name_norm = r.name_norm and len(list_intersect(l.people, r.people)) >= 1'
        ],
        recall=0.7,
    )
    linker.training.estimate_u_using_random_sampling(max_pairs=5_000_000)
    # Two EM passes: a variable's m-values can't be trained inside its own
    # blocking rule, so name_norm trains in the (first_token, state) session
    # and people/state/fund_type train in the name_norm session.
    linker.training.estimate_parameters_using_expectation_maximisation(
        block_on("name_norm")
    )
    linker.training.estimate_parameters_using_expectation_maximisation(
        block_on("first_token", "state")
    )

    preds = linker.inference.predict(threshold_match_probability=REVIEW_FLOOR)
    df = preds.as_pandas_dataframe()

    import numpy as np
    hist, edges = np.histogram(df["match_probability"],
                               bins=[0.2, 0.5, 0.8, 0.95, 0.99, 1.0001])
    print("probability distribution:",
          {f"{edges[i]:.2f}-{edges[i+1]:.2f}": int(hist[i]) for i in range(len(hist))},
          flush=True)

    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    pred_path = er_dir / f"funds_predictions_{ts}.parquet"
    df.to_parquet(pred_path)

    model_json = json.dumps(linker.misc.save_model_to_json(), sort_keys=True, default=str)
    model_sha = hashlib.sha256(model_json.encode()).hexdigest()[:12]
    (er_dir / "models").mkdir(exist_ok=True)
    (er_dir / "models" / f"funds@{model_sha}.json").write_text(model_json)

    # Load into entity_links (auto rows only; human decisions untouched).
    counts = {"adv_funds": n_adv, "formd_funds": n_formd, "pairs_scored": len(df)}
    with connect() as conn:
        staged = staging.stage_local("resolve_funds", pred_path)
        rfid = staging.register_raw_file(conn, staged, license_code="cc_by",
                                        content_type="application/x-parquet")
        conn.commit()
        run_id = ledger.start_run(conn, rfid, "resolve_funds")
        try:
            with conn.cursor() as cur:
                cur.execute("set local statement_timeout = '30min'")
                cur.execute("""
                    delete from internal.entity_links
                    where job = 'funds_adv_formd' and status in ('auto', 'pending')""")
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
                cur.execute("""
                    insert into internal.entity_links
                      (entity_type, job, id_a, id_b, method, match_weight,
                       match_probability, features, status, raw_file_id,
                       source_record_locator)
                    select 'organization', 'funds_adv_formd', l.id_a, l.id_b,
                           %(method)s, l.weight, l.prob, l.features,
                           case when l.prob >= %(auto)s then 'auto' else 'pending' end,
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
                    {"method": f"splink:funds@{model_sha}", "rfid": rfid,
                     "auto": AUTO_THRESHOLD})
                counts["links_loaded"] = cur.rowcount

                # Deterministic candidate class: exact-name pairs WITHOUT people
                # corroboration score below the model's floor (people arrays are
                # sparse on the Form D side), but an exact fund-name collision
                # deserves human review, not a silent drop. Loaded as pending;
                # the labeling pass measures this class's true precision.
                cur.execute("""
                    insert into internal.entity_links
                      (entity_type, job, id_a, id_b, method, match_probability,
                       features, status, raw_file_id, source_record_locator)
                    select 'organization', 'funds_adv_formd',
                           least(a.id, b.id), greatest(a.id, b.id),
                           'deterministic:exact_name', null,
                           jsonb_build_object('exact_name', true,
                                              'state_match', a.state = b.state),
                           'pending', %(rfid)s,
                           'pair:' || least(a.id, b.id) || ':' || greatest(a.id, b.id)
                    from internal.organizations a
                    join internal.org_identifiers ai
                      on ai.org_id = a.id and ai.id_type = 'sec_private_fund_id'
                    join internal.organizations b
                      on b.name_normalized = a.name_normalized
                     and b.org_type = 'fund' and b.id <> a.id
                    join internal.org_identifiers bi
                      on bi.org_id = b.id and bi.id_type = 'cik'
                    where a.org_type = 'fund'
                      and not exists (select 1 from internal.org_identifiers x
                                      where x.org_id = b.id
                                        and x.id_type = 'sec_private_fund_id')
                    on conflict (job, id_a, id_b) do nothing""",
                    {"rfid": rfid})
                counts["nameonly_pending_added"] = cur.rowcount

                cur.execute("""select status, count(*) from internal.entity_links
                               where job='funds_adv_formd' group by 1""")
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
    """Recompute the canonical map: accepted ∪ (auto ≥ threshold) − rejected,
    union-find with a cluster cap. Refused until the precision gate has labels
    unless --force."""
    counts: dict[str, int] = {}
    with connect() as conn:
        with conn.cursor() as cur:
            # Gate: the people-corroborated class must be label-certified
            # (>=100 labels, Wilson 95% lower bound > 0.90).
            cur.execute("""
                select count(*) filter (where l.label = 'match'), count(*)
                from internal.er_labels l
                join internal.entity_links el
                  on el.job = l.job and el.id_a = l.id_a and el.id_b = l.id_b
                where l.job = 'funds_adv_formd' and l.label <> 'unsure'
                  and l.labeled_by not like '%%:parked'
                  and el.method like 'splink:%%'
                  and coalesce((el.features->>'gamma_people')::int, 0) >= 1""")
            correct, n_labels = cur.fetchone()
            low = wilson_low(correct or 0, n_labels or 0)
            if (n_labels < 100 or low <= 0.90) and not force:
                raise RuntimeError(
                    f"Precision gate: people-class labels {correct}/{n_labels}, "
                    f"Wilson lower bound {low:.3f} (need n>=100 and >0.90). "
                    "Run `funderdb resolve label funds --stratum people` first, "
                    "or pass --force to apply provisionally."
                )
            # Certified links: human-accepted pairs plus the people-corroborated
            # Splink class. Name-only pairs apply ONLY via explicit acceptance.
            cur.execute("""
                select id_a, id_b from internal.entity_links
                where job = 'funds_adv_formd'
                  and (status = 'accepted'
                       or (status in ('auto', 'pending')
                           and method like 'splink:%%'
                           and coalesce((features->>'gamma_people')::int, 0) >= 1))
                except
                select id_a, id_b from internal.entity_links
                where job = 'funds_adv_formd' and status = 'rejected'""")
            pairs = cur.fetchall()

        clusters, oversize = union_find_clusters(pairs, CLUSTER_CAP)
        counts["pairs_used"] = len(pairs)
        counts["clusters"] = len(clusters)
        counts["oversize_skipped"] = len(oversize)

        with conn.cursor() as cur:
            cur.execute("set local statement_timeout = '30min'")
            # Canonical rep: most identifiers, then most relationships, then oldest.
            all_ids = [i for c in clusters for i in c]
            cur.execute("""
                create temp table _rank on commit drop as
                select o.id::text as id,
                       (select count(*) from internal.org_identifiers i where i.org_id = o.id) as n_ids,
                       (select count(*) from internal.relationships r
                         where r.to_org_id = o.id or r.from_org_id = o.id) as n_rels,
                       o.created_at
                from internal.organizations o where o.id::text = any(%s)""",
                (all_ids,))
            cur.execute("select id, n_ids, n_rels, created_at from _rank")
            rank = {r[0]: (r[1], r[2], r[3]) for r in cur.fetchall()}

            mapping: list[tuple[str, str]] = []
            for cluster in clusters:
                rep = max(cluster, key=lambda i: (rank[i][0], rank[i][1],
                                                  -rank[i][2].timestamp()))
                for i in cluster:
                    if i != rep:
                        mapping.append((i, rep))

            cur.execute("""
                update internal.organizations set canonical_org_id = null
                where canonical_org_id is not null
                  and id in (select id_a from internal.entity_links where job='funds_adv_formd'
                             union select id_b from internal.entity_links where job='funds_adv_formd')""")
            for dup, rep in mapping:
                cur.execute("""update internal.organizations
                               set canonical_org_id = %s where id = %s""", (rep, dup))
            counts["orgs_canonicalized"] = len(mapping)
        conn.commit()
    return counts
