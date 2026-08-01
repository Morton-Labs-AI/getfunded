"""Interactive labeling + precision eval for the ER gates (job-generic).

`funderdb resolve label <job>` shows candidate pairs with all the evidence and
records y/n/u into internal.er_labels. Sampling is stratified (see
common.JOBS[job].strata) so the eval can place the threshold: gate-stratum
pairs certify precision; band pairs locate the cliff.

Pass rule (per plan): >=100 labeled gate-stratum pairs with a 95% Wilson lower
bound above 0.90. At n=200 that means >=189 correct (189/200 -> 0.904;
188/200 -> 0.898 and does NOT clear — an earlier docstring said 188).
`resolve eval <job>` reports progress against that bar at any label count.
"""

from __future__ import annotations

import json

import click
import psycopg

from ..db import connect
from .common import JOBS, wilson_low


def _fresh(conn):
    """Replace a dead connection (best-effort close, then reconnect)."""
    try:
        conn.close()
    except Exception:
        pass
    return connect()


def _write_label(conn, job: str, id_a, id_b, lab: str,
                 labeled_by: str = "cli") -> None:
    """The CLI's label writer. labeled_by is REQUIRED in the DO UPDATE SET:
    without it, a pair first labeled at the CLI and later corrected by
    another writer (the labeling UI writes 'ui') would keep its stale tag —
    and per-source gate auditing depends on the tag being truthful."""
    with conn.cursor() as cur:
        cur.execute("""
            insert into internal.er_labels (job, id_a, id_b, label, labeled_by)
            values (%s, %s, %s, %s, %s)
            on conflict on constraint uq_er_labels
            do update set label = excluded.label,
                          labeled_by = excluded.labeled_by""",
            (job, id_a, id_b, lab, labeled_by))
    conn.commit()


# Labels whose labeled_by ends in ':parked' are excluded from every gate,
# eval, and status computation: parking retires a sample without deleting
# the historical record (first use: the 2 pre-UI CLI labels, retired when
# the labeling UI restarted the funds sample cleanly).
PARKED_FILTER = "l.labeled_by not like '%%:parked'"

_FUND_DETAIL = """
select o.id, o.name, o.state, o.fund_size::text,
       (select a.name from internal.relationships r
          join internal.organizations a on a.id = r.from_org_id
         where r.to_org_id = o.id and r.rel_type = 'manages_fund' limit 1) as adviser,
       (select count(*) from internal.funding_events fe
         where fe.recipient_org_id = o.id and fe.event_type = 'reg_d_offering') as offerings,
       (select string_agg(i.id_type, ',') from internal.org_identifiers i
         where i.org_id = o.id) as id_types
from internal.organizations o where o.id = any(%s)
"""

# Org evidence is displayed with the SAME three arms the people job's frame
# computes — direct edges ∪ one-hop manages_fund ∪ primary org, all
# canonical-routed — so the reviewer sees exactly what the model saw. The
# hop arm is load-bearing: ADV person edges point at the adviser while
# Form D edges point at the fund, so cross-source shared evidence exists
# ONLY via the hop; a direct-only display would tell the labeler "name
# evidence only" on precisely the pairs the org gate certifies.
_PERSON_DETAIL = """
select p.id, p.full_name, p.primary_title,
       split_part(p.source_natural_key, ':', 1) as source,
       po.name as primary_org, po.state,
       coalesce((select jsonb_agg(jsonb_build_object('cid', x.cid, 'label', x.label)
                        order by x.label)
          from (select distinct orr.canonical_id::text as cid,
                       og.name || ' [' || rel.rel_type || ']' as label
                  from internal.relationships rel
                  join internal.org_resolve orr on orr.org_id = rel.to_org_id
                  join internal.organizations og on og.id = orr.canonical_id
                 where rel.from_person_id = p.id
                   and rel.rel_type in ('owner_of','executive_of','officer_of',
                                        'director_of','trustee_of','poc_for')
                union
                select distinct fr.canonical_id::text,
                       og2.name || ' [fund]'
                  from internal.relationships rel2
                  join internal.relationships mf
                    on mf.from_org_id = rel2.to_org_id
                   and mf.rel_type = 'manages_fund'
                  join internal.org_resolve fr on fr.org_id = mf.to_org_id
                  join internal.organizations og2 on og2.id = fr.canonical_id
                 where rel2.from_person_id = p.id
                   and rel2.rel_type in ('owner_of','executive_of','officer_of',
                                         'director_of','trustee_of','poc_for')
                union
                select r3.canonical_id::text, og3.name || ' [primary]'
                  from internal.org_resolve r3
                  join internal.organizations og3 on og3.id = r3.canonical_id
                 where r3.org_id = p.primary_org_id) x), '[]'::jsonb) as orgs
from internal.people p
left join internal.organizations po on po.id = p.primary_org_id
where p.id = any(%s)
"""


def _show_fund_pair(conn, id_a, id_b) -> None:
    with conn.cursor() as cur:
        cur.execute(_FUND_DETAIL, ([str(id_a), str(id_b)],))
        rows = {str(r[0]): r for r in cur.fetchall()}
    for oid in (str(id_a), str(id_b)):
        r = rows.get(oid)
        if not r:
            continue
        side = "ADV " if "sec_private_fund_id" in (r[6] or "") else "FormD"
        click.echo(f"  [{side}] {r[1]}")
        click.echo(f"         state={r[2] or '—'}  gav={r[3] or '—'}  "
                   f"adviser={r[4] or '—'}  offerings={r[5]}")


def _show_person_pair(conn, id_a, id_b) -> None:
    with conn.cursor() as cur:
        cur.execute(_PERSON_DETAIL, ([str(id_a), str(id_b)],))
        rows = {str(r[0]): r for r in cur.fetchall()}
    org_sets: dict[str, dict[str, str]] = {}
    for pid in (str(id_a), str(id_b)):
        r = rows.get(pid)
        if not r:
            continue
        orgs = r[6] if isinstance(r[6], list) else json.loads(r[6] or "[]")
        org_sets[pid] = {o["cid"]: o["label"] for o in orgs}
        shown = " · ".join(o["label"] for o in orgs[:4])
        more = f"  (+{len(orgs) - 4} more)" if len(orgs) > 4 else ""
        click.echo(f"  [{r[3]:<8}] {r[1]} — {r[2] or 'no title'}")
        click.echo(f"             primary: {r[4] or '—'} ({r[5] or '—'})")
        click.echo(f"             orgs: {shown or '—'}{more}")
    sets = list(org_sets.values())
    shared = set(sets[0]) & set(sets[1]) if len(sets) == 2 else set()
    if shared:
        click.echo("  SHARED orgs (canonical): "
                   + " · ".join(sorted(sets[0][c] for c in shared)))
    else:
        click.echo("  SHARED orgs: none — name evidence only")


_PAIR_RENDERERS = {"funds": _show_fund_pair, "people": _show_person_pair}


def label(job_key: str, n: int, stratum: str | None) -> None:
    spec = JOBS[job_key]
    stratum = stratum or spec.gate_stratum
    if stratum not in spec.strata:
        raise click.UsageError(
            f"Unknown stratum {stratum!r} for job {job_key!r}; "
            f"valid: {', '.join(spec.strata)}")
    where = spec.strata[stratum]
    # Common-name oversample surfaces high-TF names first: TF adjustment is
    # exactly what depresses their probability, so ascending order finds them.
    order = ("el.match_probability asc nulls last, random()"
             if stratum == "common" else "random()")
    show_pair = _PAIR_RENDERERS[job_key]

    conn = connect()
    try:
        with conn.cursor() as cur:
            cur.execute(f"""
                select el.id, el.id_a, el.id_b, el.match_probability, el.features
                from internal.entity_links el
                where el.job = %(job)s and {where}
                  and not exists (select 1 from internal.er_labels l
                                  where l.job = el.job and l.id_a = el.id_a
                                    and l.id_b = el.id_b)
                order by {order} limit %(n)s""",
                {"job": spec.job, "n": n, "threshold": spec.auto_threshold})
            pairs = cur.fetchall()

        if not pairs:
            click.echo("No unlabeled pairs in this stratum.")
            return

        click.echo(f"{len(pairs)} pairs · y = same real-world {spec.prompt_noun} · "
                   "n = different · u = unsure · q = quit\n")
        done = 0
        for _link_id, id_a, id_b, prob, features in pairs:
            click.echo("─" * 76)
            # An interactive session can idle long enough for the socket to
            # die under it; reconnect-and-retry so a drop never loses an
            # answer or kills the run.
            try:
                show_pair(conn, id_a, id_b)
            except psycopg.OperationalError:
                click.echo("  (connection dropped — reconnecting)")
                conn = _fresh(conn)
                show_pair(conn, id_a, id_b)
            p_str = f"{prob:.4f}" if prob is not None else "—"
            click.echo(f"  p={p_str}  evidence={features}")
            ans = click.prompt(f"  same {spec.prompt_noun}?",
                               type=click.Choice(["y", "n", "u", "q"]),
                               show_choices=False)
            if ans == "q":
                break
            lab = {"y": "match", "n": "not_match", "u": "unsure"}[ans]
            try:
                _write_label(conn, spec.job, id_a, id_b, lab, labeled_by="cli")
            except psycopg.OperationalError:
                click.echo("  (connection dropped — reconnecting; your answer is kept)")
                conn = _fresh(conn)
                _write_label(conn, spec.job, id_a, id_b, lab, labeled_by="cli")
            done += 1
        click.echo(f"\nrecorded {done} labels")
    finally:
        try:
            conn.close()
        except Exception:
            pass


def eval_job(job_key: str, threshold: float | None = None) -> None:
    spec = JOBS[job_key]
    thr = spec.auto_threshold if threshold is None else threshold
    with connect() as conn, conn.cursor() as cur:
        cur.execute(f"""
            select l.label, {spec.class_case_sql} as cls, l.labeled_by
            from internal.er_labels l
            join internal.entity_links el
              on el.job = l.job and el.id_a = l.id_a and el.id_b = l.id_b
            where l.job = %(job)s and l.label <> 'unsure'
              and {PARKED_FILTER}""",
            {"job": spec.job, "threshold": thr})
        rows = cur.fetchall()
    if not rows:
        click.echo(f"No labels yet. Run `funderdb resolve label {job_key}` first.")
        return

    click.echo(f"labels total (excl. unsure, excl. parked): {len(rows)}\n")
    gate_passed = False
    for cls, description, auto_rule in spec.class_info:
        sub = [(lab, by) for lab, c, by in rows if c == cls]
        if not sub:
            click.echo(f"{cls:>9}: no labels yet — {description}")
            continue
        correct = sum(1 for lab, _by in sub if lab == "match")
        low = wilson_low(correct, len(sub))
        verdict = "CERTIFIED (>0.90)" if low > 0.90 and len(sub) >= 100 else \
                  f"not yet (n={len(sub)}, need >=100 and lower bound > 0.90)"
        click.echo(f"{cls:>9}: {correct}/{len(sub)} match · Wilson low {low:.3f} · {verdict}")
        click.echo(f"           {description} → {auto_rule}")
        # Per-source breakdown: certification must be auditable BY WRITER
        # (the gate itself stays a single pooled bound over all sources).
        by_source: dict[str, list[str]] = {}
        for lab, by in sub:
            by_source.setdefault(by, []).append(lab)
        for by in sorted(by_source):
            labs = by_source[by]
            c = sum(1 for x in labs if x == "match")
            click.echo(f"           by {by}: {c}/{len(labs)} match · "
                       f"Wilson low {wilson_low(c, len(labs)):.3f}")
        if cls == spec.gate_stratum and low > 0.90 and len(sub) >= 100:
            gate_passed = True
    click.echo("\nGATE " + (f"PASSED for the {spec.gate_stratum} class — "
                            f"`resolve {job_key} --apply` unlocked"
                            if gate_passed else "not yet passed"))


def export_labels(out_dir: str | None = None) -> dict[str, int]:
    """Write data/seed/er_labels/<job>.csv (CC-BY, committed) — the durable,
    reviewable form of the hand-labeling investment. Full-file rewrite per
    job; the DB stays the source of truth and the CSV is its export."""
    import csv
    from pathlib import Path

    from ..config import get_settings

    out = Path(out_dir) if out_dir else \
        Path(get_settings().data_root) / "seed" / "er_labels"
    out.mkdir(parents=True, exist_ok=True)
    written: dict[str, int] = {}
    with connect() as conn, conn.cursor() as cur:
        cur.execute("select distinct job from internal.er_labels order by 1")
        jobs = [j for (j,) in cur.fetchall()]
        for job in jobs:
            cur.execute("""
                select id_a, id_b, recipient_name_normalized, org_id, label,
                       labeled_by, notes, created_at
                from internal.er_labels where job = %s
                order by created_at, id_a, id_b""", (job,))
            rows = cur.fetchall()
            path = out / f"{job}.csv"
            with open(path, "w", newline="") as f:
                w = csv.writer(f)
                w.writerow(["id_a", "id_b", "recipient_name_normalized",
                            "org_id", "label", "labeled_by", "notes",
                            "created_at"])
                w.writerows(rows)
            written[job] = len(rows)
    return written


def status_report() -> None:
    """Per-job link/label/gate/canonical summary for `resolve status`."""
    with connect() as conn, conn.cursor() as cur:
        for job_key, spec in JOBS.items():
            cur.execute("""
                select status, count(*) from internal.entity_links
                where job = %s group by 1 order by 1""", (spec.job,))
            links = {s: c for s, c in cur.fetchall()}
            cur.execute("""
                select labeled_by || ' ' || label, count(*)
                from internal.er_labels
                where job = %s group by 1 order by 1""", (spec.job,))
            labels = {s: c for s, c in cur.fetchall()}
            gate_where = spec.strata[spec.gate_stratum]
            cur.execute(f"""
                select count(*) filter (where l.label = 'match'), count(*)
                from internal.er_labels l
                join internal.entity_links el
                  on el.job = l.job and el.id_a = l.id_a and el.id_b = l.id_b
                where l.job = %(job)s and l.label <> 'unsure' and {gate_where}
                  and {PARKED_FILTER}""",
                {"job": spec.job, "threshold": spec.auto_threshold})
            correct, n = cur.fetchone()
            low = wilson_low(correct or 0, n or 0)
            table, col = (("internal.organizations", "canonical_org_id")
                          if spec.entity_type == "organization"
                          else ("internal.people", "canonical_person_id"))
            cur.execute(f"select count({col}) from {table}")
            (n_canon,) = cur.fetchone()
            gate = ("PASSED" if (n or 0) >= 100 and low > 0.90
                    else f"open (n={n or 0}, Wilson low {low:.3f})")
            click.echo(f"{job_key}: links={links or '—'}  labels={labels or '—'}")
            click.echo(f"{'':>{len(job_key) + 2}}gate[{spec.gate_stratum}]={gate}  "
                       f"canonicalized={n_canon:,}")
