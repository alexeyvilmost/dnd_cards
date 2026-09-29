"""Build an immutable guarded completion migration from the fresh production snapshot.

The default is a progress check. --write refuses an incomplete/disjoint audit;
it cannot turn a pending mechanic into a narrative item or a verified status.
"""
import argparse
import hashlib
import json
import pathlib
import re
from collections import Counter

ROOT = pathlib.Path(__file__).resolve().parents[2]
COMMON = 'name name_en description detailed_description mechanics related_actions related_effects related_cards type rarity is_extended'.split()
COLUMNS = {
 'card': 'slot price range weight effects mastery contents attunement bonus_type properties bonus_value damage_type is_template weapon_type defense_type enchant_bonus battle_profile container_mode price_currency price_abbreviated requires_attunement elemental_damage_type elemental_damage_value',
 'feat': 'category prerequisite ability_increase repeatable',
 'spell': 'area level range damage ritual school classes duration heal_dice resources is_healing subclasses casting_time save_outcome concentration material_text component_verbal component_somatic component_material upcast_description',
 'effect': 'price script weight properties repeatable effect_type condition_description',
 'action': 'price script weight properties distance recharge resource action_type recharge_custom',
 'resource': 'category recharge sort_order',
 'monster': 'slug size creature_type alignment challenge_rating armor_class max_hp speed initiative_bonus proficiency_bonus abilities action_ids effect_ids ai token_url token_storage_id',
}
TABLES = {'card':'cards','feat':'feats','spell':'spells','effect':'effects','action':'actions','resource':'resources','monster':'monsters'}
REFERENCE_LIMITS = {'card':20,'feat':50,'spell':50,'effect':50,'action':50,'resource':100,'monster':100}
PENDING = re.compile(r'pending|ожидает реализации|незавершённое предложение|требует реализации|не реализован', re.I)

def read(path):
 return json.loads(path.read_text(encoding='utf-8'))

def write(path, value):
 path.parent.mkdir(parents=True,exist_ok=True)
 path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

def description_sha(row):
 raw=json.dumps([row.get('description'),row.get('detailed_description')],ensure_ascii=False,separators=(',',':')).encode()
 return hashlib.sha256(raw).hexdigest()

def preimage(kind,row):
 return {key:row[key] for key in [*COMMON,*COLUMNS[kind].split(),'deleted_at'] if key in row}

def identity(kind,row):
 return {'entity_type':kind,'id':row['id'],'card_number':row.get('card_number') or row.get('resource_id') or row['slug'],'name':row['name'],
  'description_sha256':description_sha(row)}

def review(row,audit):
 clauses=audit['clauses']
 narrative=any(clause.get('classification')=='narrative' for clause in clauses)
 mechanical=any(clause.get('classification') in ('mechanical','implemented') for clause in clauses)
 limitations=audit.get('limitations',[])
 evidence=sorted({path for clause in clauses for path in clause.get('evidence',[])})
 implemented=[]
 for clause in clauses:
  declaration=clause.get('implementation','')
  detail=declaration.get('details','') if isinstance(declaration,dict) else declaration
  if clause.get('classification') in ('mechanical','implemented'):
   implemented.append(clause['text']+' — '+str(detail))
 # A schema check and a family regression do not prove an entire item correct.
 status='narrative' if narrative and not mechanical and not limitations else 'not_verified'
 if mechanical and evidence:status='partial_narrative_verified_partial' if narrative else 'verified_partial'
 if limitations:status='partial_narrative_not_verified' if narrative else 'not_verified'
 return {'status':status,'summary':'Полный разбор описания предмета «'+row['name']+'»; автоматические тесты старой сертификации не использовались.',
  'implemented':implemented,'tested':['Схема и целевые проверки общих примитивов; индивидуальный полный сценарий предмета не подтверждён.'] if evidence else [],
  'limitations':limitations,'evidence':evidence}

def main():
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--snapshot',type=pathlib.Path,default=ROOT/'outputs/catalog-completion-20260929/catalog.json')
 parser.add_argument('--write',action='store_true')
 args=parser.parse_args()
 source=read(args.snapshot); snapshot=hashlib.sha256(args.snapshot.read_bytes()).hexdigest()
 monsters_path=args.snapshot.parent/'monsters.json'
 if monsters_path.exists():source['monsters']=read(monsters_path)
 cards={row['card_number']:row for row in source['cards'] if row.get('deleted_at') is None}
 if len(cards)!=886:raise SystemExit(f'Unexpected fresh active item count: {len(cards)}; review scope before building')
 all_reviews={}; errors=[]; progress={}
 for part in ('low','middle','high'):
  batch=read(ROOT/f'scripts/content/data/item-completion-{part}-20260929.json')
  duplicate=set(batch)&set(all_reviews)
  if duplicate:errors.append(f'Overlapping ownership: {sorted(duplicate)}')
  pending=[]
  for ref,audit in batch.items():
   clauses=audit.get('clauses',[])
   if audit.get('work_remaining') or not clauses or any(PENDING.search(json.dumps(clause,ensure_ascii=False)) for clause in clauses):pending.append(ref)
   for clause in clauses:
    classification=clause.get('classification')
    if classification not in ('mechanical','implemented','narrative','underspecified','source_undefined','unspecified'):
     errors.append(f'{ref}: unsupported clause classification {classification}')
    if classification in ('underspecified','source_undefined','unspecified') and not audit.get('limitations'):
     errors.append(f'{ref}: absent source parameter must be recorded explicitly')
    for path in clause.get('evidence',[]):
     if not (ROOT/path).is_file():errors.append(f'{ref}: missing evidence file {path}')
   if ref in cards and audit.get('id',cards[ref]['id'])!=cards[ref]['id']:errors.append(f'{ref}: source identity changed')
  progress[part]={'reviewed_rows':len(batch),'pending_rows':len(pending),'pending':pending}
  all_reviews.update(batch)
 if set(cards)!=set(all_reviews):errors.append(f'Scope mismatch; absent={sorted(set(cards)-set(all_reviews))}, foreign={sorted(set(all_reviews)-set(cards))}')
 indexed={kind:{row['id']:row for row in source.get(table,[])} for kind,table in TABLES.items()}
 related=[]; related_keys=set(); related_refs=set()
 for part in ('low','middle','high'):
  path=ROOT/f'scripts/content/data/item-completion-{part}-related-20260929.json'
  if not path.exists():continue
  for raw in read(path)['entities']:
   kind=raw.get('entity_type'); entity_id=raw.get('id'); patch=raw.get('patch')
   if kind not in TABLES or not isinstance(patch,dict) or not entity_id:
    errors.append(f'{part}: malformed related entity identity or patch')
    continue
   prior=indexed[kind].get(entity_id)
   row=prior or patch
   ref=row.get('card_number') or row.get('resource_id') or row.get('slug')
   key=(kind,entity_id)
   if not ref or not row.get('name'):
    errors.append(f'{part}: missing related entity reference/name for {kind}:{entity_id}')
   elif len(ref)>REFERENCE_LIMITS[kind]:
    errors.append(f'{part}: related entity reference exceeds {REFERENCE_LIMITS[kind]} characters: {kind}:{ref}')
   if key in related_keys:
    errors.append(f'{part}: related entity authored more than once: {kind}:{entity_id}')
   related_keys.add(key)
   if (kind,ref) in related_refs:
    errors.append(f'{part}: related entity reference authored more than once: {kind}:{ref}')
   related_refs.add((kind,ref))
   if prior:
    forbidden=set(patch)-set(preimage(kind,prior))
    if forbidden:errors.append(f'{part}: unguarded related patch {kind}:{ref}: {sorted(forbidden)}')
   else:
    required={'id','name','description',{'resource':'resource_id','monster':'slug'}.get(kind,'card_number')}
    if required-set(patch):errors.append(f'{part}: related insert {kind}:{ref} lacks {sorted(required-set(patch))}')
    if any(existing.get('card_number',existing.get('resource_id',existing.get('slug')))==ref for existing in indexed[kind].values()):
     errors.append(f'{part}: related insert reference already exists: {kind}:{ref}')
   status=raw.get('review',{}).get('status','not_verified')
   if status in ('verified','partial_narrative_verified'):
    errors.append(f'{part}: prohibited related review status {kind}:{ref}: {status}')
   related.append(raw)
 report={'snapshot_sha256':snapshot,'active_items':len(cards),'parts':progress,'errors':errors}
 write(ROOT/'outputs/catalog-completion-20260929/completion-progress.json',report)
 print(json.dumps({**report,'parts':{part:{key:value for key,value in stats.items() if key!='pending'} for part,stats in progress.items()}},ensure_ascii=False,indent=2))
 if not args.write:return
 if errors or any(stats['pending_rows'] for stats in progress.values()):raise SystemExit('Incomplete audit: refusing to generate migration279')
 entities=[]
 for ref,row in sorted(cards.items()):
  audit=all_reviews[ref];patch=dict(audit.get('patch',{}))
  if audit.get('mechanics')!=row.get('mechanics'):patch['mechanics']=audit.get('mechanics')
  patch={key:value for key,value in patch.items() if value!=row.get(key)}
  if set(patch)-set(preimage('card',row)):raise SystemExit(f'Forbidden or unguarded item patch: {ref}')
  entities.append({**identity('card',row),'preimage':preimage('card',row),'patch':patch,'review':review(row,audit)})
 for raw in related:
   kind=raw['entity_type']; prior=indexed[kind].get(raw['id']);patch=raw['patch'];row=prior or patch
   entry={**identity(kind,row),'preimage':preimage(kind,prior) if prior else None,'patch':patch,
    'review':raw.get('review',{'status':'not_verified','summary':'Связанная механика предмета «'+row['name']+'».',
      'implemented':['Исполняемая декларация используется предметом через каноничную связь.'],'tested':[],
      'limitations':['Полный индивидуальный сценарий связанной сущности не подтверждён.'],'evidence':[]})}
   if prior:entry['patch']={key:value for key,value in patch.items() if value!=prior.get(key)}
   entities.append(entry)
 keys=[(entry['entity_type'],entry['id']) for entry in entities]
 if len(keys)!=len(set(keys)):raise SystemExit('Related entity is authored by multiple owners')
 # Reference guards pin the library used during development. A concurrent
 # production edit aborts the transaction rather than overwriting new content.
 owned=set(keys); guards=[]
 for kind in ('action','effect','resource','spell','feat'):
  for row in source[TABLES[kind]]:
   if row.get('deleted_at') is None and (kind,row['id']) not in owned:
    guards.append({**identity(kind,row),'preimage':preimage(kind,row)})
 manifest={'schema_version':1,'audit_id':'item-completion-279-20260929','source_snapshot_sha256':snapshot,
  'expected_active_cards':len(cards),
  'entities':entities,'guards':guards}
 destination=ROOT/'backend/migrations/data/item-completion-279/items.json'
 write(destination,manifest)
 write(ROOT/'docs/audits/item-completion-279-coverage.json',{'snapshot_sha256':snapshot,'items':all_reviews})
 print(json.dumps({'entities':len(entities),'items':len(cards),'mechanics_changes':sum('mechanics' in e['patch'] for e in entities if e['entity_type']=='card'),
  'statuses':dict(Counter(e['review']['status'] for e in entities if e['entity_type']=='card'))},ensure_ascii=False))

if __name__=='__main__':main()
