import {authoredBootstrapIdentitySource} from './identity-source.mjs';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const hash=b=>'sha256:'+createHash('sha256').update(b).digest('hex');
const literal=s=>"'"+s.replaceAll("'","''")+"'";
const tables={card:'cards',feat:'feats',spell:'spells',action:'actions',effect:'effects',resource:'resources',monster:'monsters'};
const publicTables=['test_run_ownership','schema_migrations','actions','backgrounds','cards','classes','concepts','effects','feats','monsters','races','resources','spells','variables','content_choice_recommendations','audio_cues','entity_audio_bindings','entity_tag_assignments','entity_tag_definitions','passive_presentations','roguelike_item_rules','roguelike_shop_settings','ruleset_releases'];
export async function bindAuthoredBootstrapIdentities({query,fullDataSnapshot}){
 assert.equal((await query('fresh_chain','SELECT max(version) FROM schema_migrations;')).trim(),'082_character_system_metadata');
 const fixture=await authoredBootstrapIdentitySource(),proof={fixtureHash:fixture.fixtureHash};
 const present=JSON.parse(await query('fresh_chain',"SELECT json_agg(c.relname ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN('r','p');"));assert(present.every(n=>/^[a-z][a-z0-9_]*$/.test(n)));
 const otherTables=present.filter(n=>!publicTables.includes(n));for(const table of otherTables)assert.equal((await query('fresh_chain','SELECT count(*) FROM public.'+table+';')).trim(),'0','Identity binding requires empty gameplay and historical storage');
 const ledgerSQL="SELECT encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY version),''),'UTF8')),'hex') FROM schema_migrations t;",ledgerBefore=await query('fresh_chain',ledgerSQL);
 const bindings=[],sourceResources=[];
 for(const[kind,table]of Object.entries(tables)){
  const sources=fixture.entities.filter(e=>e.kind===kind),ref=kind==='resource'?'resource_id':kind==='monster'?'slug':'card_number';if(!sources.length||!present.includes(table))continue;
  const rows=JSON.parse(await query('fresh_chain',"SELECT coalesce(json_agg(json_build_object('id',t.id::text,'reference',"+ref+",'rowHash',encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')) ORDER BY "+ref+",id),'[]'::json) FROM public."+table+" t WHERE "+ref+" IN("+sources.map(e=>literal(e.row[ref])).join(',')+");"));
  for(const source of sources){
   const matches=rows.filter(r=>r.reference===source.row[ref]);assert(matches.length<=1,'Existing public reference is ambiguous');
   if(matches.length===0){if(kind==='resource')sourceResources.push(source);continue;}
   if(matches[0].id===source.id)continue;
   assert(/^[a-f0-9-]{36}$/.test(source.id));assert.equal((await query('fresh_chain','SELECT count(*) FROM '+table+' WHERE id='+literal(source.id)+'::uuid;')).trim(),'0');bindings.push({kind,table,reference:source.row[ref],previousId:matches[0].id,sourceId:source.id,rowHash:matches[0].rowHash});
  }
 }
 assert(bindings.length>0);assert.equal(new Set(bindings.map(b=>b.previousId)).size,bindings.length);assert.equal(new Set(bindings.map(b=>b.sourceId)).size,bindings.length);
 const columns=JSON.parse(await query('fresh_chain',"SELECT coalesce(json_agg(json_build_object('table',table_name,'column',column_name)),'[]'::json) FROM information_schema.columns WHERE table_schema='public' AND data_type IN('json','jsonb') AND table_name IN("+publicTables.map(literal).join(',')+");"));
 for(const c of columns){assert(/^[a-z][a-z0-9_]*$/.test(c.table)&&/^[a-z][a-z0-9_]*$/.test(c.column));const count=(await query('fresh_chain','SELECT count(*) FROM '+c.table+' WHERE '+c.column+'::text ~ '+literal(bindings.map(b=>b.previousId).join('|'))+';')).trim();assert.equal(count,'0','Existing catalog UUID references require a separate proven source bridge');}
 const exclusions=[...new Set(bindings.map(b=>b.table).concat(sourceResources.length?['resources']:[]))].map(table=>({table,ids:[...new Set(bindings.filter(b=>b.table===table).flatMap(b=>[b.previousId,b.sourceId]).concat(table==='resources'?sourceResources.map(e=>e.id):[]))]}));const nonTargetBefore=await fullDataSnapshot(exclusions);const before=await fullDataSnapshot();
 const statements=["BEGIN;SET LOCAL TIME ZONE 'UTC';SET LOCAL statement_timeout='30s';LOCK TABLE "+[...new Set(bindings.map(b=>b.table).concat(sourceResources.length?['resources']:[]))].join(',')+' IN SHARE ROW EXCLUSIVE MODE;'];
 statements.push('CREATE TEMP TABLE bootstrap_identity_preimages(table_name text,source_id uuid,row_before jsonb);');for(const b of bindings)statements.push('INSERT INTO bootstrap_identity_preimages SELECT '+literal(b.table)+','+literal(b.sourceId)+'::uuid,to_jsonb(t) FROM '+b.table+' t WHERE id='+literal(b.previousId)+'::uuid;');
 for(const b of bindings)statements.push('DO $source$ DECLARE n integer;BEGIN UPDATE '+b.table+' t SET id='+literal(b.sourceId)+'::uuid WHERE id='+literal(b.previousId)+'::uuid AND encode(sha256(convert_to(to_jsonb(t)::text,\'UTF8\')),\'hex\')='+literal(b.rowHash)+';GET DIAGNOSTICS n=ROW_COUNT;IF n<>1 THEN RAISE EXCEPTION \'Bootstrap identity changed before binding\';END IF;END $source$;');
 const schema=JSON.parse(await query('fresh_chain',"SELECT json_agg(column_name) FROM information_schema.columns WHERE table_schema='public' AND table_name='resources';"));
 for(const source of sourceResources){const fields=Object.keys(source.row).filter(k=>schema.includes(k)&&!['support','user_id','group_id','author','created_at','updated_at'].includes(k));assert(fields.every(k=>/^[a-z][a-z0-9_]*$/.test(k)));const row=Object.fromEntries(fields.map(k=>[k,source.row[k]]));statements.push('INSERT INTO resources('+fields.join(',')+') SELECT '+fields.join(',')+' FROM jsonb_populate_record(NULL::resources,'+literal(JSON.stringify(row))+'::jsonb);');}
 for(const b of bindings)statements.push('DO $source$ BEGIN IF NOT EXISTS(SELECT 1 FROM '+b.table+' t JOIN bootstrap_identity_preimages p ON p.source_id=t.id AND p.table_name='+literal(b.table)+' WHERE t.id='+literal(b.sourceId)+'::uuid AND (to_jsonb(t)-ARRAY[\'id\',\'updated_at\'])=(p.row_before-ARRAY[\'id\',\'updated_at\'])) THEN RAISE EXCEPTION \'Bootstrap identity binding changed another original field\';END IF;END $source$;');
 statements.push('COMMIT;');await query('fresh_chain',statements.join('\n'),{readOnly:false});
 assert.equal(await query('fresh_chain',ledgerSQL),ledgerBefore);for(const table of otherTables)assert.equal((await query('fresh_chain','SELECT count(*) FROM public.'+table+';')).trim(),'0');
 for(const b of bindings){const ref=b.kind==='resource'?'resource_id':b.kind==='monster'?'slug':'card_number';assert.equal((await query('fresh_chain','SELECT count(*) FROM '+b.table+' WHERE id='+literal(b.sourceId)+'::uuid AND '+ref+'='+literal(b.reference)+';')).trim(),'1');}
 const nonTargetAfter=await fullDataSnapshot(exclusions);assert.deepEqual(nonTargetAfter,nonTargetBefore);
 return {schemaVersion:1,nonTargetBefore,nonTargetAfter,allNonTargetPublicRowsExact:true,targetFieldsExceptIdAndTimestampExact:true,kind:'authentic-authored-catalog-identities-bound-before-historical-artifacts',boundary:'082_character_system_metadata',fixtureHash:fixture.fixtureHash,bindings,insertedSourceResources:sourceResources.map(e=>({id:e.id,reference:e.row.resource_id,provenance:e.provenance})),before,after:await fullDataSnapshot(),originalMigrationLedgerExact:true,allGameplayAndHistoricalTablesEmpty:true,existingCatalogUuidReferencesAbsent:true,originalFullSnapshot:false,productionChanges:0,freshInstallAcceptance:false};
}
