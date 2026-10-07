import {loadHistoricalCatalogSources} from '../historical-catalog-source.mjs';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {historicalCatalogConditions,inspectHistoricalCatalog} from '../historical-catalog-preconditions.mjs';
const inspectCatalog279Preconditions=query=>inspectHistoricalCatalog(sql=>query('fresh_chain',sql),279);
const hash=b=>'sha256:'+createHash('sha256').update(b).digest('hex');
const literal=s=>"'"+s.replaceAll("'","''")+"'";
const tables={card:'cards',feat:'feats',spell:'spells',action:'actions',effect:'effects',resource:'resources',monster:'monsters'};
export async function hydrateAuthenticPre279({query,fullDataSnapshot,observe=()=>{}}){
 const publicPackage=await loadHistoricalCatalogSources(),fixture={entities:publicPackage.pre279.rows},plan=await historicalCatalogConditions(279),entries=plan.entries.map(({entity:entry,file,guard})=>({entry,file,guard}));
 const before=await inspectCatalog279Preconditions(query),selected=new Map();observe({stage:'actual278-preconditions',targets:before.targets,passed:before.passed,failed:before.failed,identityRefusals:before.rows.filter(r=>r.status==='failed'&&r.matches>0&&!r.identityExact).map(r=>({kind:r.kind,id:r.id,reference:r.reference}))});
 assert.equal(before.boundary,'278_catalog_mechanics_audit');assert(before.counts.every(r=>r.actual===r.expected));if(before.failed===0)return {kind:'authentic-pre279-preconditions-already-exact',before:{targets:before.targets,passed:before.passed,failed:0},after:{targets:before.targets,passed:before.passed,failed:0},inserted:0,updated:0,allExistingHistoryAndOtherTableRowsExact:true,allOriginalLedgerRowsExact:true,manualStatusesAssignedByHydration:false,productionChanges:0};
 for(const target of before.rows.filter(r=>r.status==='failed')){
  const e=entries.find(({entry:e,file,guard})=>file===target.file&&guard===target.guard&&e.entity_type===target.kind&&e.id===target.id)?.entry;assert(e?.preimage,'Insertion guards must remain absent until original278 executes');
  const source=fixture.entities.find(r=>r.kind===target.kind&&r.id===target.id);assert(source);assert.equal(source.row.id,e.id);assert.equal(source.row[e.entity_type==='resource'?'resource_id':e.entity_type==='monster'?'slug':'card_number'],e.card_number);assert(Object.entries(e.preimage).every(([k,v])=>isDeepStrictEqual(source.row[k],v)));assert.equal(hash(JSON.stringify([source.row.description??null,source.row.detailed_description??null])),'sha256:'+e.description_sha256);
  assert(target.matches===0||target.matches===1&&target.identityExact,'No historical identity replacement is allowed at278');const key=e.entity_type+':'+e.id;
  if(selected.has(key)){const known=selected.get(key);assert.equal(known.target.actualRowHash,target.actualRowHash);for(const k of Object.keys(e.preimage))known.fields.add(k);}else selected.set(key,{entry:e,source,target,fields:new Set(Object.keys(e.preimage))});
 }
 const exclusions=Object.entries(tables).map(([kind,table])=>({table,ids:[...selected.values()].filter(v=>v.entry.entity_type===kind).map(v=>v.entry.id)})).filter(v=>v.ids.length);const nonTargetBefore=await fullDataSnapshot(exclusions),ledgerBefore=await query('fresh_chain',"SELECT encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY version),''),'UTF8')),'hex') FROM schema_migrations t;");
 const statements=["BEGIN;SET LOCAL TIME ZONE 'UTC';SET LOCAL statement_timeout='60s';LOCK TABLE "+exclusions.map(v=>v.table).join(',')+' IN SHARE ROW EXCLUSIVE MODE;'];
 for(const {entry:e,source,target,fields}of selected.values()){
  const table=tables[e.entity_type],forbidden=['id','support','author','user_id','group_id','created_at','updated_at'];let columns=[...fields];assert(columns.every(k=>/^[a-z][a-z0-9_]*$/.test(k)));assert(!columns.some(k=>forbidden.includes(k)));
  if(target.matches===0){
   const available=JSON.parse(await query('fresh_chain',"SELECT json_agg(column_name) FROM information_schema.columns WHERE table_schema='public' AND table_name="+literal(table)+';'));columns=Object.keys(source.row).filter(k=>available.includes(k)&&!['support','author','user_id','group_id','created_at','updated_at'].includes(k));assert(columns.every(k=>/^[a-z][a-z0-9_]*$/.test(k)));
   const value=Object.fromEntries(columns.map(k=>[k,source.row[k]]));statements.push('INSERT INTO '+table+'('+columns.join(',')+') SELECT '+columns.join(',')+' FROM jsonb_populate_record(NULL::'+table+','+literal(JSON.stringify(value))+'::jsonb);');
  }else{
   const value=Object.fromEntries(columns.map(k=>[k,source.row[k]]));statements.push('DO $source$ DECLARE n integer;BEGIN UPDATE '+table+' t SET('+columns.join(',')+')=(SELECT '+columns.join(',')+' FROM jsonb_populate_record(NULL::'+table+','+literal(JSON.stringify(value))+'::jsonb)) WHERE id='+literal(e.id)+'::uuid AND encode(sha256(convert_to(to_jsonb(t)::text,\'UTF8\')),\'hex\')='+literal(target.actualRowHash.slice(7))+';GET DIAGNOSTICS n=ROW_COUNT;IF n<>1 THEN RAISE EXCEPTION \'278 source target changed before hydration\';END IF;END $source$;');
  }
 }
 statements.push('COMMIT;');await query('fresh_chain',statements.join('\n'),{readOnly:false});
 const nonTargetAfter=await fullDataSnapshot(exclusions),ledgerAfter=await query('fresh_chain',"SELECT encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY version),''),'UTF8')),'hex') FROM schema_migrations t;");assert.deepEqual(nonTargetAfter,nonTargetBefore);assert.equal(ledgerAfter,ledgerBefore);
 const after=await inspectCatalog279Preconditions(query);assert.equal(after.failed,0);assert.equal(after.targets,2564);
 return {schemaVersion:1,kind:'authentic-public-source279-fields-at278',fixtureHash:publicPackage.manifest.datasets.pre279.jsonSha256,originalFullSnapshot:false,before:{targets:before.targets,passed:before.passed,failed:before.failed},after:{targets:after.targets,passed:after.passed,failed:after.failed},distinctEntities:selected.size,inserted:[...selected.values()].filter(v=>v.target.matches===0).length,updated:[...selected.values()].filter(v=>v.target.matches===1).length,nonTargetBefore,nonTargetAfter,allExistingHistoryAndOtherTableRowsExact:true,ledgerBefore,ledgerAfter,allOriginalLedgerRowsExact:true,manualStatusesAssignedByHydration:false,originalManifestsChanged:false,productionChanges:0};
}
