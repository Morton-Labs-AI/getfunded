"""990-PF Part XV application contacts -> internal.contact_channels.

These are the addresses and phone numbers a foundation printed on its own
public return *so that applicants would use them*. That makes them materially
different from, say, an SBIR PI's personal email — but only when the address
is a role inbox. `grants@foundation.org` is a desk; `alan_topfer@castletop.org`
is a person who happens to run one.

So the tiering is:

    role-based inbox  -> privacy_tier 'green',  publishability 'public'
    named individual  -> privacy_tier 'yellow', publishability 'internal_only'
    unparseable value -> not loaded at all

The classification lives in SQL (internal.is_role_based_email, 0018) rather
than here, so the loader, the benchmarks and any future reviewer are all
running the identical rule.

Three properties worth stating up front:

* **Winning filings only.** The source set comes from
  internal.mv_org_application_posture, i.e. each org's latest PARSED
  non-superseded 990-PF. An address a foundation dropped in 2021 must not
  become public in 2026.
* **Org-scoped, never person-scoped.** These are application desks;
  `person_id` stays NULL and ck_contact_one_owner enforces the XOR.
* **Downgrades must stay possible.** The upsert's `do update` is scoped to
  rows this loader owns (`source_record_locator like 'partxv:%'`), so a
  re-run can flip a row from public back to internal_only if the classifier
  is later found wrong. `do nothing` would freeze a mistake forever, and it
  simultaneously guarantees we never touch the sec_adv or sbir writers' rows.

This is the first code in the project to write publishability='public'. The
license-guard trigger (0002:266-282) has never fired on that path before;
provenance is the 990 batch zip (us_public_domain, republishable), so it
passes.
"""

from __future__ import annotations

from collections import defaultdict

from .. import ledger
from ..db import connect

DATASET = "irs_990_xml"

# The classified source set: one Part XV row per org, from its winning filing.
_SOURCE = """
from internal.mv_org_application_posture p
join internal.filing_application_info fa on fa.object_id = p.object_id
"""

_PROJECTION_SQL = f"""
select
  count(*) filter (where internal.email_local_flat(fa.email) is not null
                    and internal.is_role_based_email(fa.email, fa.contact_name))
    as email_role,
  count(*) filter (where internal.email_local_flat(fa.email) is not null
                    and not internal.is_role_based_email(fa.email, fa.contact_name))
    as email_named,
  count(*) filter (where fa.email is not null
                    and internal.email_local_flat(fa.email) is null)
    as email_unusable,
  count(*) filter (where internal.nanp_e164(fa.phone) is not null) as phone_valid,
  count(*) filter (where fa.phone is not null and internal.nanp_e164(fa.phone) is null)
    as phone_junk
{_SOURCE}
"""

# Deterministic sample for human review — ordered, not random, so two reviewers
# see the same rows and a re-run is comparable.
_SAMPLE_SQL = f"""
select lower(btrim(fa.email)) as email, fa.contact_name, o.name as org_name,
       p.app_state
{_SOURCE}
join internal.organizations o on o.id = p.org_id
where internal.email_local_flat(fa.email) is not null
  and internal.is_role_based_email(fa.email, fa.contact_name) = %(role)s
order by md5(lower(btrim(fa.email)))
limit %(n)s
"""

_EMAIL_INSERT = f"""
insert into internal.contact_channels as c
  (org_id, person_id, channel_type, value, is_role_based, privacy_tier,
   publishability, last_verified_at, raw_file_id, source_record_locator)
select p.org_id, null, 'email', lower(btrim(fa.email)),
       internal.is_role_based_email(fa.email, fa.contact_name),
       case when internal.is_role_based_email(fa.email, fa.contact_name)
            then 'green' else 'yellow' end,
       case when internal.is_role_based_email(fa.email, fa.contact_name)
            then 'public' else 'internal_only' end,
       p.tax_period_end, fa.raw_file_id, 'partxv:' || fa.object_id
{_SOURCE}
where internal.email_local_flat(fa.email) is not null
on conflict (org_id, person_id, channel_type, value) do update set
  is_role_based    = excluded.is_role_based,
  privacy_tier     = excluded.privacy_tier,
  publishability   = excluded.publishability,
  last_verified_at = excluded.last_verified_at,
  raw_file_id      = excluded.raw_file_id,
  source_record_locator = excluded.source_record_locator,
  updated_at       = now()
where c.source_record_locator like 'partxv:%%'
"""

_PHONE_INSERT = f"""
insert into internal.contact_channels as c
  (org_id, person_id, channel_type, value, is_role_based, privacy_tier,
   publishability, last_verified_at, raw_file_id, source_record_locator)
select p.org_id, null, 'phone', internal.nanp_e164(fa.phone),
       true, 'green', 'public',
       p.tax_period_end, fa.raw_file_id, 'partxv:' || fa.object_id
{_SOURCE}
where internal.nanp_e164(fa.phone) is not null
on conflict (org_id, person_id, channel_type, value) do update set
  last_verified_at = excluded.last_verified_at,
  raw_file_id      = excluded.raw_file_id,
  source_record_locator = excluded.source_record_locator,
  updated_at       = now()
where c.source_record_locator like 'partxv:%%'
"""


def project() -> dict:
    """Counts only — no writes, no transaction left open."""
    with connect() as conn, conn.cursor() as cur:
        cur.execute("set local statement_timeout = '10min'")
        cur.execute(_PROJECTION_SQL)
        role, named, unusable, phones, phone_junk = cur.fetchone()
        conn.rollback()
    return {
        "email_role_based_public": role,
        "email_named_internal": named,
        "email_unusable_skipped": unusable,
        "phone_public": phones,
        "phone_junk_skipped": phone_junk,
        "public_rows_after_load": role + phones,
    }


def sample(n: int = 100, role: bool = True) -> list[tuple]:
    """A deterministic slice of one classification bucket, for human review."""
    with connect() as conn, conn.cursor() as cur:
        cur.execute("set local statement_timeout = '10min'")
        cur.execute(_SAMPLE_SQL, {"n": n, "role": role})
        rows = cur.fetchall()
        conn.rollback()
    return rows


def sync() -> dict:
    """Load Part XV contacts with tiering. Idempotent; re-runs re-tier."""
    totals: dict[str, int] = defaultdict(int)
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                select rf.id from internal.raw_files rf
                where rf.dataset_name = %s order by rf.id desc limit 1""",
                (DATASET,))
            row = cur.fetchone()
        if row is None:
            raise RuntimeError("no irs_990_xml raw file registered — ingest first")
        run_id = ledger.start_run(conn, int(row[0]), DATASET)
        try:
            with conn.cursor() as cur:
                cur.execute("set local statement_timeout = '30min'")
                cur.execute("""
                    select count(*) from internal.contact_channels
                    where publishability = 'public'""")
                totals["public_before"] = cur.fetchone()[0]

                cur.execute(_EMAIL_INSERT)
                totals["emails_written"] = cur.rowcount
                cur.execute(_PHONE_INSERT)
                totals["phones_written"] = cur.rowcount

                cur.execute("""
                    select count(*) filter (where publishability = 'public'),
                           count(*) filter (where publishability = 'public'
                                             and channel_type = 'email'),
                           count(*) filter (where privacy_tier = 'yellow'
                                             and source_record_locator like 'partxv:%')
                    from internal.contact_channels""")
                pub, pub_email, yellow = cur.fetchone()
                totals["public_after"] = pub
                totals["public_emails"] = pub_email
                totals["partxv_yellow"] = yellow
            conn.commit()
            ledger.complete_run(
                conn, run_id, inserted=totals["emails_written"] + totals["phones_written"],
                notes=f"part-xv contacts: {dict(totals)}")
        except Exception as exc:
            try:
                conn.rollback()
                ledger.fail_run(conn, run_id, f"{type(exc).__name__}: {exc}")
            except Exception:
                pass
            raise
    return dict(totals)


_AUDIT = [
    ("public rows that are not green",
     "select count(*) from internal.contact_channels "
     "where publishability = 'public' and privacy_tier <> 'green'"),
    ("public EMAILS that are not role-based",
     "select count(*) from internal.contact_channels "
     "where publishability = 'public' and channel_type = 'email' "
     "and not is_role_based"),
    ("public rows from a non-republishable source",
     "select count(*) from internal.contact_channels c "
     "join internal.raw_files rf on rf.id = c.raw_file_id "
     "join internal.licensing_map lm on lm.license_code = rf.license_code "
     "where c.publishability = 'public' and not lm.republishable"),
    ("red-tier rows (must never exist)",
     "select count(*) from internal.contact_channels where privacy_tier = 'red'"),
    ("public view row count vs internal public rows (difference)",
     "select (select count(*) from internal.contact_channels "
     "        where publishability = 'public' and privacy_tier <> 'red') "
     "     - (select count(*) from public.contact_channels)"),
    # Named-individual smell test. A published address may be a compound only
    # when a role word sits on one END of it — <org>.foundation@ and
    # executive.director@ are desks, jane.doe@ is not. Reviewed 2026-08-09:
    # the 19 rows an end-agnostic version of this flagged were 17 org-name
    # compounds, one role title, and one genuine false positive
    # (jdoe.email@ — fixed in 0019 by demoting the weak tokens mail/email).
    ("named-individual smell test on public emails",
     "select count(*) from internal.contact_channels "
     "where publishability = 'public' and channel_type = 'email' "
     "and value ~ '^[a-z]+[._][a-z]+@' "
     "and split_part(value, '@', 1) !~ "
     "  '(^|[._-])(grants?|info|contact|apply|application|applications|"
     "foundation|fdn|admin|office|general|main|scholarships?|programs?|"
     "director|finaid|mail|inquir|trust|fund)([._-]|$)'"),
]


def audit() -> list[tuple[str, int]]:
    """Every count here must be 0. Run after any contact write."""
    out = []
    with connect() as conn, conn.cursor() as cur:
        cur.execute("set local statement_timeout = '10min'")
        for label, sql in _AUDIT:
            cur.execute(sql)
            out.append((label, int(cur.fetchone()[0])))
        conn.rollback()
    return out
