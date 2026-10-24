"""Private classification ledger over immutable observations; no remote client.

Recorded registry types, explicit tax observations and acquisition states are
separate from source interpretation, standing, approval and publication.
"""
from __future__ import annotations

import fcntl
import hashlib
import json
import shutil
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

from .crawl import now
from .pipeline import sha256, write_json

RULESET = 'classification-ledger/v1'


def readonly(path: Path):
    db = sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True, timeout=30)
    db.row_factory = sqlite3.Row
    db.execute('pragma query_only=on')
    return db


def guard(path: Path):
    if shutil.disk_usage(path).free < 10 * 1024**3:
        raise RuntimeError('10 GiB disk guard; resume this local ledger later')


def immutable(path: Path, obj) -> str:
    body = (json.dumps(obj, sort_keys=True, ensure_ascii=False) + '\n').encode()
    if path.exists() and path.read_bytes() != body:
        raise ValueError('retained artifact differs; choose a new vintage')
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(body)
    return hashlib.sha256(body).hexdigest()


@contextmanager
def ledger_db(run: Path):
    run.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect((run / 'ledger.sqlite3').resolve().as_uri(), uri=True, timeout=30)
    db.row_factory = sqlite3.Row
    db.execute('pragma journal_mode=wal')
    db.executescript('''
      create table if not exists metadata(key text primary key,value text not null);
      create table if not exists organizations(
        org_id text primary key,org_type text,country text,ein text,ntee_code text,
        website_candidate text,registry_dataset text,registry_locator text,registry_license text,
        inventory_page_sha256 text,inventory_line_sha256 text);
      create table if not exists acquisition(org_id text primary key,state text,observed_at text,result_path text);
      create table if not exists tax_observations(org_id text primary key,subsection text,
        path text,sha256 text,observed_at text);
      create table if not exists screening(org_id text primary key,state text,assessment_path text);
      create table if not exists reviews(review_sha256 text primary key,org_id text,kind text,
        path text,recorded_at text,disposition text,role text);
      create index if not exists review_org on reviews(org_id,recorded_at);
      create view if not exists classifications as
      select o.*,t.subsection,t.path as tax_source_path,t.sha256 as tax_source_sha256,
        t.observed_at as tax_observed_at,a.state as acquisition_state,a.observed_at as acquisition_observed_at,
        a.result_path,s.state as screening_state,
        case when t.subsection='03' then 'subsection03_observed'
          when t.subsection is not null then 'other_subsection_observed' else 'unknown' end as tax_classification,
        case when a.state='evidence_ready' then 'html_acquired_identity_pending'
          when a.state='blocked' then 'acquisition_blocked'
          when a.state='needs_discovery' then 'website_unresolved'
          else 'acquisition_pending_or_unknown' end as website_classification,
        coalesce(r.role,'not_established') as funding_role,
        case when r.org_id is not null then 'bounded_agent_review' else 'not_semantically_reviewed' end as review_state,
        case when r.org_id is not null then r.disposition
          when s.state in ('website_criteria_candidate_pending_semantic_review','live_funding_lead_identity_pending') then 'review_funding_identity_and_scope'
          when a.state='evidence_ready' then 'review_identity_and_role'
          when a.state='blocked' then 'resolve_access_dependency'
          else 'discover_and_attribute_website' end as next_step
      from organizations o left join acquisition a using(org_id)
      left join tax_observations t using(org_id) left join screening s using(org_id)
      left join reviews r on r.org_id=o.org_id and r.rowid=(select rr.rowid from reviews rr
        where rr.org_id=o.org_id order by rr.recorded_at desc,rr.rowid desc limit 1);
    ''')
    try:
        with db:
            yield db
    finally:
        db.close()


def _metadata(db, key, value):
    db.execute('insert into metadata values(?,?) on conflict(key) do update set value=excluded.value',
               (key, json.dumps(value, sort_keys=True)))


def build(source: Path, active: Path, out: Path, echo=print) -> dict:
    source, active, out = source.resolve(), active.resolve(), out.resolve()
    if source.parent.name != 'research' or source.parent not in out.parents or out in (source, active):
        raise ValueError('use a separate private research ledger directory')
    out.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((source / 'inventory.jsonl.meta.json').read_text())
    binding = {'ruleset': RULESET, 'inventory_sha256': manifest['sha256'],
               'population': manifest['organizations'], 'source_run': str(source), 'active_run': str(active)}
    immutable(out / 'binding.json', binding)
    with (out / 'ledger.lock').open('a') as lease:
        fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
        guard(out);start=time.perf_counter()
        with ledger_db(out) as db:
            meta={r['key']:json.loads(r['value']) for r in db.execute('select * from metadata')}
            if not meta.get('inventory_complete'):
                last=db.execute('select max(org_id) from organizations').fetchone()[0]
                digest=hashlib.sha256();rows=[];count=0;previous=None
                with (source / 'inventory.jsonl').open('rb') as stream:
                    for line in stream:
                        digest.update(line);o=json.loads(line);oid=o['org_id'];count+=1
                        if previous is not None and oid<=previous:
                            raise ValueError('inventory identifiers are not strictly ordered')
                        previous=oid
                        if last is not None and oid<=last:continue
                        rows.append((oid,o.get('org_type'),o.get('country'),o.get('ein'),o.get('ntee_code'),
                            o.get('website'),o.get('registry_source_dataset'),o.get('registry_source_locator'),
                            o.get('registry_license_code'),o.get('inventory_page_sha256'),hashlib.sha256(line).hexdigest()))
                        if len(rows)>=10000:
                            guard(out);db.executemany('insert into organizations values(?,?,?,?,?,?,?,?,?,?,?)',rows);db.commit();rows=[]
                            if count%100000==0:echo(json.dumps({'ledger_registry_rows':count,'population':binding['population']}))
                if digest.hexdigest()!=binding['inventory_sha256'] or count!=binding['population']:
                    raise ValueError('immutable inventory count/hash mismatch; ledger remains incomplete')
                db.executemany('insert into organizations values(?,?,?,?,?,?,?,?,?,?,?)',rows)
                _metadata(db,'inventory_complete',True);db.commit()
            # Atomic, frozen copies from read-only source databases. The live
            # campaign is never migrated, updated or requeued by this module.
            for key,origin,sql in [
                ('acquisition_snapshot',source/'queue.sqlite3',
                 'insert into acquisition select org_id,state,updated_at,result_path from frozen.organizations'),
                ('tax_snapshot',active/'verification.sqlite3',
                 "insert into tax_observations select org_id,json_extract(record,'$.subsection_code'),page,page_sha256,observed_at from frozen.eligibility"),
                ('screening_snapshot',active/'verification.sqlite3',
                 "insert into screening select m.org_id,json_extract(a.summary,'$.state'),m.packet_path from frozen.members m join frozen.assessments a using(org_id)")]:
                if key in meta:continue
                guard(out);db.execute('attach database ? as frozen',(origin.as_uri()+'?mode=ro',))
                try:
                    db.execute(sql);_metadata(db,key,{'at':now(),'source_path':str(origin),'kind':'frozen_read_only_observation'});db.commit()
                finally:db.execute('detach database frozen')
            _metadata(db,'build_elapsed_seconds',time.perf_counter()-start);db.commit()
        return status(out)


def status(run: Path) -> dict:
    binding=json.loads((run/'binding.json').read_text())
    with readonly(run/'ledger.sqlite3') as db:
        meta={r['key']:json.loads(r['value']) for r in db.execute('select * from metadata')}
        count=db.execute('select count(*) from organizations').fetchone()[0]
        types=dict(db.execute('select org_type,count(*) from organizations group by org_type'))
        tax=dict(db.execute('select subsection,count(*) from tax_observations group by subsection'))
        acquisition=dict(db.execute('select state,count(*) from acquisition group by state'))
        roles=dict(db.execute("select coalesce(role,'not_established'),count(*) from reviews where rowid in (select max(rowid) from reviews group by org_id) group by role"))
        reviewed=db.execute('select count(distinct org_id) from reviews').fetchone()[0]
        repeats=db.execute('select count(*)-count(distinct org_id) from reviews').fetchone()[0]
        duplicate_eins=db.execute("select coalesce(sum(n-1),0) from (select count(*) n from organizations where length(ein)=9 group by ein having count(*)>1)").fetchone()[0]
    result={**binding,'schema':RULESET,'as_of':now(),'registry_classified':count,
        'inventory_integrity_complete':bool(meta.get('inventory_complete') and count==binding['population']),
        'registry_types':types,'tax_subsection_observed':sum(tax.values()),
        'subsection03_observed':tax.get('03',0),'tax_unknown':count-sum(tax.values()),
        'acquisition_states':acquisition,'bounded_agent_reviews':reviewed,'role_review_dispositions':roles,
        'funding_role_source_supported':sum(v for k,v in roles.items() if k.startswith('source_supported_')),
        'funding_role_unresolved':count-sum(v for k,v in roles.items() if k.startswith('source_supported_')),
        'fully_vetted':0,'human_reviewed':0,'remote_applied':0,'published':0,
        'duplicate_organization_rows':0,
        'repeated_identifier_rows':duplicate_eins,'repeated_review_records':repeats,
        'snapshot_dates':{k:v for k,v in meta.items() if k.endswith('_snapshot')},
        'build_elapsed_seconds':meta.get('build_elapsed_seconds'),'model_calls':0,'remote_mutations':0,
        'completion_note':'Registry-classified includes explicit unknowns; it is not source audit, completed vetting or funder qualification. Existing observations retain their dates.'}
    with (run/'status-history.jsonl').open('a') as f:f.write(json.dumps(result)+'\n')
    write_json(run/'classification-status.json',result)
    return result


def record_review(run: Path, record: dict) -> dict:
    if record.get('human_reviewed') is not False or record.get('application_status')!='awaiting_separate_application':
        raise ValueError('agent reviews cannot approve human review or live application')
    oid=record['org_id'];path=run/'reviews'/oid[:2]/(hashlib.sha256(json.dumps(record,sort_keys=True).encode()).hexdigest()+'.json')
    digest=immutable(path,record)
    with ledger_db(run) as db:
        if not db.execute('select 1 from organizations where org_id=?',(oid,)).fetchone():raise ValueError('outside fixed inventory')
        db.execute('insert or ignore into reviews values(?,?,?,?,?,?,?)',
            (digest,oid,record['kind'],str(path.resolve()),record['reviewed_at'],record['disposition'],record['role']))
    return {'org_id':oid,'path':str(path.resolve()),'sha256':digest}


def evaluate_pilot(run: Path) -> dict:
    """Reconcile the frozen pilot against independently read native fields.

    This measures source-field agreement, never semantic role or legal accuracy.
    """
    sample_path,labels_path=run/'pilot-1000.json',run/'pilot-labels.json'
    for path,proof in [(sample_path,run/'pilot-1000.sha256'),(labels_path,run/'pilot-labels.sha256')]:
        if sha256(path)!=proof.read_text().strip():raise ValueError('frozen pilot/labels changed')
    sample=json.loads(sample_path.read_text());labels=json.loads(labels_path.read_text())['labels']
    binding=json.loads((run/'binding.json').read_text())
    if sample['inventory_sha256']!=binding['inventory_sha256']:raise ValueError('pilot inventory mismatch')
    if len(sample['members'])!=1000 or len({m['target']['org_id'] for m in sample['members']})!=1000:
        raise ValueError('pilot must contain1000 distinct organizations')
    start=time.perf_counter();fields=['org_type','country','ein','ntee_code','registry_dataset','tax_subsection']
    counts={k:{'agree':0,'disagree':0,'non_null_expected':0} for k in fields};results=[];types={};tax_known=0;acquired=0
    with readonly(run/'ledger.sqlite3') as db:
        for m,gold in zip(sample['members'],labels):
            oid=m['target']['org_id'];assert oid==gold['org_id']
            row=dict(db.execute('select * from classifications where org_id=?',(oid,)).fetchone())
            row['tax_subsection']=row['subsection'];mismatches=[]
            for key in fields:
                equal=row[key]==gold[key];counts[key]['agree' if equal else 'disagree']+=1
                counts[key]['non_null_expected']+=gold[key] is not None
                if not equal:mismatches.append(key)
            if row['inventory_line_sha256']!=m['inventory_line_sha256']:raise ValueError('source row digest differs')
            tax_known+=row['subsection'] is not None;acquired+=row['acquisition_state']=='evidence_ready'
            types[row['org_type']]=types.get(row['org_type'],0)+1
            results.append({'org_id':oid,'classification':row,'mismatched_fields':mismatches})
    agreement=sum(not r['mismatched_fields'] for r in results);candidates=json.loads((run/'candidates-308.json').read_text())
    overlap=len({m['target']['org_id'] for m in sample['members']} & {m['org_id'] for m in candidates['members']})
    result={'inventory_sha256':binding['inventory_sha256'],'as_of':now(),'members':1000,'evaluated':len(results),
        'sample_sha256':sha256(sample_path),'labels_sha256':sha256(labels_path),'fields':counts,
        'field_agreement_organizations':agreement,'field_agreement_percent':100*agreement/1000,
        'semantic_accuracy':None,'sampling':'fixed systematic full-inventory positions; not a funder-filtered cohort',
        'type_counts':types,'explicit_tax_evidence':tax_known,'tax_unknown':1000-tax_known,
        'html_available_identity_pending':acquired,'new_identity_verified_domains':0,'new_qualified_funders':0,
        'overlap_with_308_review':overlap,'duplicate_organization_rows':0,
        'registry_source_page_references':1000,'unique_registry_source_pages':len({g['registry_page']['sha256'] for g in labels}),
        'evaluation_wall_seconds':time.perf_counter()-start,'supabase_calls':0,'remote_mutations':0,
        'model_calls':0,'new_web_requests':0,'results':results,
        'completion_note':'1000 local classification outputs reconciled to native registry/tax fields. Source agreement is not semantic funder accuracy or human vetting; no new discovery performed.'}
    immutable(run/'pilot-results.json',result)
    return {k:v for k,v in result.items() if k!='results'}
