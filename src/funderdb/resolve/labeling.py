"""Interactive labeling + precision eval for the ER gate.

`funderdb resolve label funds` shows candidate pairs with all the evidence and
records y/n/u into internal.er_labels. Sampling is stratified by match
probability so the eval can place the threshold: above-auto pairs certify
precision; band pairs locate the cliff.

Pass rule (per plan): on >=200 labeled above-threshold pairs, >=188 correct —
the 95% Wilson lower bound then clears 0.90. `resolve eval funds` reports
progress against that bar at any label count.
"""

from __future__ import annotations

import math

import click

from ..db import connect

_PAIR_DETAIL = """
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


def label_funds(n: int, stratum: str) -> None:
    with connect() as conn:
        with conn.cursor() as cur:
            where = {
                # Splink-scored pairs with people corroboration — the auto-tier
                # candidates the gate certifies first.
                "people": "el.method like 'splink:%%' and coalesce((el.features->>'gamma_people')::int, 0) >= 1",
                # Exact-name-only deterministic class — measured separately.
                "nameonly": "el.method = 'deterministic:exact_name'",
                "band": "el.method like 'splink:%%' and coalesce((el.features->>'gamma_people')::int, 0) = 0",
                "all": "true",
            }[stratum]
            cur.execute(f"""
                select el.id, el.id_a, el.id_b, el.match_probability, el.features
                from internal.entity_links el
                where el.job = 'funds_adv_formd' and {where}
                  and not exists (select 1 from internal.er_labels l
                                  where l.job = el.job and l.id_a = el.id_a
                                    and l.id_b = el.id_b)
                order by random() limit %s""", (n,))
            pairs = cur.fetchall()

        if not pairs:
            click.echo("No unlabeled pairs in this stratum.")
            return

        click.echo(f"{len(pairs)} pairs · y = same real-world fund · "
                   "n = different · u = unsure · q = quit\n")
        done = 0
        for link_id, id_a, id_b, prob, features in pairs:
            with conn.cursor() as cur:
                cur.execute(_PAIR_DETAIL, ([str(id_a), str(id_b)],))
                rows = {str(r[0]): r for r in cur.fetchall()}
            click.echo("─" * 76)
            for oid in (str(id_a), str(id_b)):
                r = rows.get(oid)
                if not r:
                    continue
                side = "ADV " if "sec_private_fund_id" in (r[6] or "") else "FormD"
                click.echo(f"  [{side}] {r[1]}")
                click.echo(f"         state={r[2] or '—'}  gav={r[3] or '—'}  "
                           f"adviser={r[4] or '—'}  offerings={r[5]}")
            click.echo(f"  p={prob:.4f}  evidence={features}")
            ans = click.prompt("  same fund?", type=click.Choice(["y", "n", "u", "q"]),
                               show_choices=False)
            if ans == "q":
                break
            label = {"y": "match", "n": "not_match", "u": "unsure"}[ans]
            with conn.cursor() as cur:
                cur.execute("""
                    insert into internal.er_labels (job, id_a, id_b, label)
                    values ('funds_adv_formd', %s, %s, %s)
                    on conflict on constraint uq_er_labels
                    do update set label = excluded.label""", (id_a, id_b, label))
            conn.commit()
            done += 1
        click.echo(f"\nrecorded {done} labels")


def _wilson_low(correct: int, n: int) -> float:
    if n == 0:
        return 0.0
    phat = correct / n
    z = 1.96
    denom = 1 + z * z / n
    centre = phat + z * z / (2 * n)
    margin = z * math.sqrt(phat * (1 - phat) / n + z * z / (4 * n * n))
    return (centre - margin) / denom


def eval_funds(threshold: float = 0.99) -> None:  # threshold kept for CLI compat
    with connect() as conn, conn.cursor() as cur:
        cur.execute("""
            select l.label,
                   case when el.method = 'deterministic:exact_name' then 'nameonly'
                        when coalesce((el.features->>'gamma_people')::int, 0) >= 1 then 'people'
                        else 'band' end as cls
            from internal.er_labels l
            join internal.entity_links el
              on el.job = l.job and el.id_a = l.id_a and el.id_b = l.id_b
            where l.job = 'funds_adv_formd' and l.label <> 'unsure'""")
        rows = cur.fetchall()
    if not rows:
        click.echo("No labels yet. Run `funderdb resolve label funds` first.")
        return

    click.echo(f"labels total (excl. unsure): {len(rows)}\n")
    gate_passed = False
    for cls, description, auto_rule in (
        ("people", "exact/near name + shared people (Splink auto-tier candidates)",
         "auto-accept if certified"),
        ("nameonly", "exact name, no people evidence (deterministic class)",
         "auto-accept ONLY if this class certifies separately"),
        ("band", "fuzzy name, weak evidence", "stays pending"),
    ):
        sub = [lab for lab, c in rows if c == cls]
        if not sub:
            click.echo(f"{cls:>9}: no labels yet — {description}")
            continue
        correct = sum(1 for lab in sub if lab == "match")
        low = _wilson_low(correct, len(sub))
        verdict = "CERTIFIED (>0.90)" if low > 0.90 and len(sub) >= 100 else \
                  f"not yet (n={len(sub)}, need >=100 and lower bound > 0.90)"
        click.echo(f"{cls:>9}: {correct}/{len(sub)} match · Wilson low {low:.3f} · {verdict}")
        click.echo(f"           {description} → {auto_rule}")
        if cls == "people" and low > 0.90 and len(sub) >= 100:
            gate_passed = True
    click.echo("\nGATE " + ("PASSED for the people class — `resolve funds --apply` unlocked "
                            "for people-corroborated links"
                            if gate_passed else "not yet passed"))
