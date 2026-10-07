import {bindMigrationOwnedStage} from './identity-bridge.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const directory=path.dirname(fileURLToPath(import.meta.url));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const hash=v=>'sha256:'+sha(JSON.stringify(canonical(v)));
const lit=v=>`'${String(v).replaceAll("'","''")}'`;
const sourceCommit='48646f81672341128d38cce19c0440f6f6681e08';
const pinned={
 'migration144-67-derivation.json':'91fc9aa8af717d382bf70a89943f0a1ea5d8ab7354ec00236fb2b88d50a5ae55',
 'migration144-versioned-schedule.json':'2a7e3d90327d3025155623b823535f9e78d0d0c4d597335c76b7acf57a45e787',
};
async function readPinned(name){const b=await fs.readFile(path.join(directory,name));if(sha(b)!==pinned[name])throw Error('Reviewed source recipe changed');return JSON.parse(b);}
export async function loadPre144Stage(boundary){
 if(!['101_pin_tactical_basic_action_targets','118_repair_bard_spellcasting_contract'].includes(boundary))throw Error('Unsupported source hydration boundary');
 const derived=await readPinned('migration144-67-derivation.json'),plan=await readPinned('migration144-versioned-schedule.json');
 const allPins=[...derived.sourceFiles,...plan.sourceFiles],used=new Map();
 function source(file,revision=sourceCommit){const key=revision+':'+file;if(used.has(key))return used.get(key).bytes;const match=allPins.find(p=>p.commit===revision&&p.path===file);if(!match)throw Error('Unreviewed source file');const bytes=execFileSync('git',['show',key],{maxBuffer:64*1024**2});const blob=execFileSync('git',['rev-parse',key]).toString().trim();if(match.blob!==blob||match.sha256!=='sha256:'+sha(bytes)||match.bytes!==bytes.length)throw Error('Original source bytes differ');used.set(key,{pin:match,bytes});return bytes;}
 const catalogs=Object.fromEntries(['actions','spells','classes'].map(table=>[table,JSON.parse(source(`officials/canon/prod-snapshot/${table}.json`))]));
 const selected=plan.stages.find(s=>s.boundary===boundary);if(!selected)throw Error('Missing exact recipe boundary');
 const cantrip=boundary.startsWith('101_')?await import('data:text/javascript;base64,'+source('scripts/content/cantrips-2024.mjs').toString('base64')):null;
 const changes=[];
 for(const entry of selected.rows){
  if(!['actions','spells'].includes(entry.table)||!/^[a-f0-9-]{36}$/.test(entry.id))throw Error('Invalid source identity');
  const matches=catalogs[entry.table].filter(r=>!r.deleted_at&&(r.id===entry.id||r.card_number===entry.cardNumber));
  if(matches.length!==1||matches[0].id!==entry.id||matches[0].card_number!==entry.cardNumber)throw Error('Source identity drift');
  const row=matches[0];let before=structuredClone(row.mechanics),after;
  if(entry.kind==='complete-generic-domain-minus-complete-specialized-domain'){
   if(derived.rows.some(r=>r.table===entry.table&&r.id===entry.id)||!derived.genericResidual.some(r=>r.id===entry.id))throw Error('Generic source would overwrite specialized membership');
   after=cantrip.CANTRIP_UPGRADES[row.name]?.mechanics;if(!after)throw Error('Generic source missing');
  }else{
   const spec=derived.rows.find(r=>r.id===entry.id&&r.table===entry.table);if(!spec)throw Error('Specialized source missing');
   let data=JSON.parse(source(spec.definition.path,spec.definition.commit));for(const key of spec.definition.pointer.split('/').slice(1))data=data[key];after=data.mechanics;
  }
  if(boundary.startsWith('118_')){
   source('backend/migrations/normalize_live_happy_path_content.go');
   const labels=[...new Set(row.classes.map(s=>s.trim().toLowerCase()))],resolved=labels.map(label=>catalogs.classes.filter(c=>!c.deleted_at&&!c.is_subclass&&(c.name.trim().toLowerCase()===label||(c.name_en??'').trim().toLowerCase()===label)));
   if(resolved.some(a=>a.length!==1)||Object.hasOwn(before,'spell_class_list_ids'))throw Error('107 expected projection differs');before.spell_class_list_ids=[...new Set(resolved.map(a=>a[0].card_number))].sort();
  }
  if(hash(before)!==entry.beforeHash||hash(after)!==entry.afterHash)throw Error('Reviewed before/after derivation differs');
  const beforeName=row.name,afterName=entry.nameRepair?'Разговор с животными':beforeName;
  if(entry.nameRepair){if(row.card_number!=='SPELL-0277'||beforeName!=='Разговор с Животными')throw Error('Exact source name repair differs');source(entry.nameRepair.transformation.path,entry.nameRepair.transformation.commit);}
  changes.push({table:entry.table,id:entry.id,card:entry.cardNumber,before,after:structuredClone(after),beforeName,afterName,beforeHash:entry.beforeHash,afterHash:entry.afterHash,changeRequired:entry.beforeHash!==entry.afterHash||beforeName!==afterName});
 }
 if(new Set(changes.map(r=>r.table+':'+r.id)).size!==changes.length||changes.length!==(boundary.startsWith('101_')?81:2))throw Error('Source domain is not closed');
 return {boundary,changes,sourceFiles:[...used.values()].map(v=>v.pin),recipeHash:'sha256:'+pinned['migration144-versioned-schedule.json']};
}

export async function hydratePre144Stage({boundary,query,fullDataSnapshot,observe=()=>{},identityBridge}){
 const plan=bindMigrationOwnedStage(await loadPre144Stage(boundary),identityBridge);const actual=(await query('fresh_chain','SELECT max(version) FROM schema_migrations;')).trim();if(actual!==boundary)throw Error('Owned ledger boundary differs');
 const inspected=[];
 for(const table of ['actions','spells']){
  const rows=plan.changes.filter(r=>r.table===table);if(!rows.length)continue;
  const values=rows.map(r=>`SELECT jsonb_build_object('id',${lit(r.id)},'rows',count(*),'identity',coalesce(bool_and(id=${lit(r.id)}::uuid AND card_number=${lit(r.card)}),false),'notDeleted',coalesce(bool_and(deleted_at IS NULL),false),'mechanicsExact',coalesce(bool_and(mechanics=${lit(JSON.stringify(r.before))}::jsonb),false),'nameExact',coalesce(bool_and(name=${lit(r.beforeName)}),false),'unlocked',coalesce(bool_and(coalesce(support->>'mechanics_locked','false')<>'true'),false),'supportHash',encode(sha256(convert_to(coalesce(string_agg(coalesce(support::text,'<SQL-NULL>'),E'\\n' ORDER BY id),''),'UTF8')),'hex'),'rowHash',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY id),''),'UTF8')),'hex')) AS value FROM ${table} t WHERE id=${lit(r.id)}::uuid OR card_number=${lit(r.card)}`);
  const results=JSON.parse(await query('fresh_chain',`SELECT jsonb_agg(value) FROM (${values.join(' UNION ALL ')}) q;`));
  if(!Array.isArray(results)||results.length!==rows.length)throw Error('Target preflight cardinality mismatch');
  for(const r of rows){const before=results.filter(x=>x.id===r.id);if(before.length!==1)throw Error('Target preflight identity mismatch');inspected.push({table,cardNumber:r.card,...before[0]});}
 }
 observe({boundary,stage:'preflight',targets:inspected,identityBridge:plan.identityBridge??null});
 if(plan.changes.some(r=>r.requiredFullRowHash&&inspected.find(x=>x.table===r.table&&x.id===r.id)?.rowHash!==r.requiredFullRowHash))throw Error('Observed migration row changed since082');
 if(inspected.some(r=>r.rows!==1||!r.identity||!r.notDeleted||!r.mechanicsExact||!r.nameExact||!r.unlocked||!/^[a-f0-9]{64}$/.test(r.rowHash)))throw Error('Owned full target preimage refused');
 const changed=plan.changes.filter(r=>r.changeRequired),exclusions=['actions','spells'].map(table=>({table,ids:changed.filter(r=>r.table===table).map(r=>r.id)})).filter(x=>x.ids.length);
 const nonTargetBefore=await fullDataSnapshot(exclusions);const tables=[...new Set(plan.changes.map(r=>r.table))];
 const statements=['BEGIN; SET LOCAL statement_timeout=\'30s\';',`LOCK TABLE ${tables.join(',')} IN SHARE ROW EXCLUSIVE MODE;`,`CREATE TEMP TABLE schedule_ledger_before AS SELECT to_jsonb(m) AS row FROM schema_migrations m;`];
 for(const table of tables){const ids=plan.changes.filter(r=>r.table===table).map(r=>lit(r.id)+'::uuid').join(',');statements.push(`CREATE TEMP TABLE schedule_${table}_before AS SELECT id,to_jsonb(t) AS row FROM ${table} t WHERE id IN (${ids});`);}
 for(const r of changed){const before=inspected.find(x=>x.table===r.table&&x.id===r.id);statements.push(`DO $owned$ DECLARE n integer; BEGIN UPDATE ${r.table} t SET mechanics=${lit(JSON.stringify(r.after))}::jsonb${r.afterName!==r.beforeName?',name='+lit(r.afterName):''} WHERE id=${lit(r.id)}::uuid AND card_number=${lit(r.card)} AND deleted_at IS NULL AND name=${lit(r.beforeName)} AND mechanics=${lit(JSON.stringify(r.before))}::jsonb AND coalesce(support->>'mechanics_locked','false')<>'true' AND encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')=${lit(before.rowHash)}; GET DIAGNOSTICS n=ROW_COUNT; IF n<>1 THEN RAISE EXCEPTION 'source-bound target changed before update'; END IF; END $owned$;`);}
 const rowTests=plan.changes.map(r=>`SELECT ${lit(r.id)} AS id, (to_jsonb(t)-ARRAY['mechanics','name','support','updated_at'])=(b.row-ARRAY['mechanics','name','support','updated_at']) AS other_fields_exact, t.mechanics=${lit(JSON.stringify(r.after))}::jsonb AS mechanics_exact, t.name=${lit(r.afterName)} AS name_exact, ${r.changeRequired?'t.support IS NULL':'to_jsonb(t)=b.row'} AS support_or_noop_exact, ${r.changeRequired?'t.updated_at=transaction_timestamp() AND (b.row->>\'updated_at\')::timestamptz<=t.updated_at':'t.updated_at=(b.row->>\'updated_at\')::timestamptz'} AS timestamp_exact FROM ${r.table} t JOIN schedule_${r.table}_before b USING(id) WHERE t.id=${lit(r.id)}::uuid`);
 statements.push(`CREATE TEMP TABLE schedule_proof AS SELECT jsonb_build_object('rows',count(*),'otherFieldsExact',bool_and(other_fields_exact),'mechanicsExact',bool_and(mechanics_exact),'namesExact',bool_and(name_exact),'supportOrNoopExact',bool_and(support_or_noop_exact),'timestampsExact',bool_and(timestamp_exact),'ledgerExact',NOT EXISTS ((SELECT row FROM schedule_ledger_before EXCEPT ALL SELECT to_jsonb(m) FROM schema_migrations m) UNION ALL (SELECT to_jsonb(m) FROM schema_migrations m EXCEPT ALL SELECT row FROM schedule_ledger_before))) AS value FROM (${rowTests.join(' UNION ALL ')}) t;`);
 statements.push(`DO $owned$ BEGIN IF (SELECT value->>'rows' FROM schedule_proof)<>${lit(plan.changes.length)} OR EXISTS (SELECT 1 FROM schedule_proof p CROSS JOIN LATERAL jsonb_each(p.value-'rows') e WHERE e.value<>'true'::jsonb) THEN RAISE EXCEPTION 'source-bound postcondition failed'; END IF; END $owned$; SELECT value FROM schedule_proof; COMMIT;`);
 const proof=JSON.parse(await query('fresh_chain',statements.join('\n'),{readOnly:false}));const nonTargetAfter=await fullDataSnapshot(exclusions);
 if(JSON.stringify(nonTargetBefore)!==JSON.stringify(nonTargetAfter)||proof.rows!==plan.changes.length||Object.entries(proof).some(([key,v])=>key!=='rows'&&v!==true))throw Error('Source hydration changed forbidden bytes');
 return {boundary,kind:'source-composed-public-data-hydration-v2',identityBridge:plan.identityBridge??null,recipeHash:plan.recipeHash,targets:inspected.map(r=>({table:r.table,id:r.id,cardNumber:r.cardNumber,rowHash:r.rowHash,supportHash:r.supportHash})),verifiedMembers:plan.changes.length,mechanicsOrNameChanges:changed.length,noOpMembers:plan.changes.length-changed.length,proof,nonTargetBefore,nonTargetAfter,sourceFiles:plan.sourceFiles,scope:{retiredWriterExecuted:false,originalProductionSnapshot:false,certificationCopied:false,ledgerWritten:false}};
}
