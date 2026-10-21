"""Prepare bounded source contexts for actual agent interpretation, not approval."""
from __future__ import annotations

import gzip
import hashlib
import json
import re
from pathlib import Path

from lxml import html

from .classification import guard, immutable
from .evidence import build_packet
from .sweep import _excluded_block
from .active_funders import envelope
from .web_text import visible_text

GRANT = re.compile(r'\bgrant\w*|\bscholarship\w*|\bfunding|letter of (?:inquiry|intent)|\bLOI\b', re.I)
INQUIRY = re.compile(r'unsolicited|invitation|inquir|apply|application|proposal|contact.{0,30}(?:grant|program)|eligib', re.I)
ROLE = re.compile(r'\b(?:we|our|foundation|trust|fund|grants)\b.{0,100}\b(?:award|provid|mak|distribut|offer|support|grantmak|fund)\w*|\bgrants?\s+(?:are\s+)?(?:award|provid|offer)\w*', re.I)
FIT = re.compile(r'eligib|priorit|geograph|focus|communities|nonprofit organizations|organizations (?:in|within|located)|we fund', re.I)
CYCLE = re.compile(r'\b20(?:2[4-9]|3\d)\b|deadline|application (?:period|cycle)|rolling',re.I)


def prepare_candidates(source: Path, run: Path, echo=print) -> dict:
    frozen=json.loads((run/'candidates-308.json').read_text());index=[]
    for number,m in enumerate(frozen['members'],1):
        guard(run);target=m['target'];oid=m['org_id'];ap=Path(m['assessment_path'])
        if hashlib.sha256(ap.read_bytes()).hexdigest()!=m['assessment_sha256']:raise ValueError('frozen assessment changed')
        path=Path(m['source_result_path']);data=path.read_bytes();changed=hashlib.sha256(data).hexdigest()!=m['source_result_sha256']
        if not changed:result=json.loads(data)
        else:
            pages=[]
            for c in m['prior_assessment']['url_checks']:
                digest=c['snapshot_sha256'];p=source/'snapshots'/digest[:2]/(digest+'.json.gz')
                if not p.exists():raise ValueError('frozen source is missing; preserve blocker')
                pages.append({'url':c['final_url'],'snapshot':{'path':str(p.resolve()),'sha256':digest,'encoding':'gzip'}})
            result={'org_id':oid,'ein':target.get('ein'),'pages':pages}
        packet=build_packet(target,result,source);contexts=[];seen=set()
        for p in packet['pages']:
            raw=envelope(p);doc=html.fromstring(raw['text']);heading=''
            for node in doc.xpath('//h1|//h2|//h3|//p|//li|//td|//div[not(*)]'):
                if _excluded_block(node):continue
                text=visible_text(node,p['extractor'])
                if node.tag in {'h1','h2','h3'}:heading=text[:180]
                if not 30<=len(text)<=1800 or not GRANT.search(text):continue
                start=p['text'].find(text)
                if start<0:continue
                key=(p['snapshot']['sha256'],start,start+len(text))
                if key in seen:continue
                seen.add(key)
                contexts.append({'source_url':p['url'],'snapshot_sha256':p['snapshot']['sha256'],
                    'text_sha256':p['text_sha256'],'start':start,'end':start+len(text),'excerpt':text,
                    'heading':heading,'role_hit':bool(ROLE.search(text)),'inquiry_hit':bool(INQUIRY.search(text)),
                    'fit_hit':bool(FIT.search(text)),'cycle_hit':bool(CYCLE.search(text))})
        # Diversity by source and topic; retained full paragraphs preserve
        # negation/recipient scope. These are retrieval contexts, not claims.
        selected=[];keys=set()
        for topic,limit in [('role_hit',3),('inquiry_hit',3),('fit_hit',2),('cycle_hit',2)]:
            choices=[x for x in contexts if x[topic]]
            choices.sort(key=lambda x:(len(x['excerpt'])>900,not x['inquiry_hit'] if topic=='inquiry_hit' else False,len(x['excerpt'])))
            for x in choices[:limit]:
                key=(x['snapshot_sha256'],x['start'],x['end'])
                if key not in keys:selected.append(x);keys.add(key)
        if not selected:selected=contexts[:3]
        item={'org_id':oid,'ordinal':number,'target':target,'identity_gate':packet['identity_gate'],
            'integrity_failures':packet['integrity_failures'],'source_result_changed_since_assessment':changed,
            'pages':[{k:p[k] for k in ['url','snapshot','text_sha256','observed_at','extractor']} for p in packet['pages']],
            'contexts':selected,'all_contexts':contexts,'retrieval_not_completed_review':True,
            'source_dates':m['prior_assessment'].get('date_evidence',[]),
            'contact_page_candidates':m['prior_assessment'].get('contact_page_candidates',[]),
            'unknowns':['current IRS standing','whole-site updated month','exact paid donation date','unvisited call terms'],
            'human_reviewed':False,'application_status':'awaiting_separate_application'}
        output=run/'candidate-contexts'/f'{number:03}.json';digest=immutable(output,item)
        index.append({'ordinal':number,'org_id':oid,'path':str(output.resolve()),'sha256':digest})
        if number%40==0:echo(json.dumps({'candidate_contexts_prepared':number,'completed_semantic_reviews':0}))
    immutable(run/'candidate-context-index.json',{'members':index,'not_completed_reviews':True})
    return {'prepared':len(index),'semantic_reviews':0}
