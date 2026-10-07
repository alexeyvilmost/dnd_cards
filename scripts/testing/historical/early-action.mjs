import {spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {sha256Canonical} from '../../../scripts/content/certification-hash.mjs';
const source={commit:'278258aa0e8b21d326040097b745540bcf369684',path:'officials/canon/prod-snapshot/actions.json',blob:'f8561f58a27d809d2e53b13f2b3325da38dd2e4b',sha256:'849242b025c392e2d9aa94bc3e5764a7553dc46cd7f6a9ec4675613445f34ec9',rowHash:'sha256:4658e8a3363414f514916ad493ee99eea1ba1d98c3b77f6833c4a298693e6f30',retainedRef:'origin/codex/micro-mvp-prod-data-migration',mainPre124Ancestor:false};
const allowed=['action_type','author','card_number','created_at','description','description_font_size','detailed_description','detailed_description_alignment','detailed_description_font_size','distance','id','image_url','is_extended','mechanics','name','name_en','price','properties','rarity','recharge','recharge_custom','related_actions','related_cards','resources','script','show_detailed_description','source','support','tags','text_alignment','text_font_size','type','updated_at','weight'].sort();
const literal=value=>`'${value.replaceAll("'","''")}'`;
const hash=value=>'sha256:'+crypto.createHash('sha256').update(value).digest('hex');
export async function seedEarlyPublicAction({query,root,fullDataSnapshot,observe=()=>{}}){
 const git=(args)=>{const r=spawnSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:4*1024**2});if(r.status!==0)throw Error('Pinned early public source unavailable');return r.stdout;};
 if(git(['rev-parse',`${source.commit}:${source.path}`]).trim()!==source.blob)throw Error('Early public Git blob mismatch');
 const bytes=Buffer.from(git(['show',`${source.commit}:${source.path}`]));if(hash(bytes)!=='sha256:'+source.sha256)throw Error('Early public source bytes mismatch');
 const rows=JSON.parse(bytes).filter(row=>row.card_number==='ACTION-0005');
 if(rows.length!==1||sha256Canonical(rows[0])!==source.rowHash||rows[0].id!=='d87af918-00b4-4b97-b52e-6cdc3e83d41b'||rows[0].mechanics!==null||rows[0].support!==null||JSON.stringify(Object.keys(rows[0]).sort())!==JSON.stringify(allowed))throw Error('Early public row is not exact closed source');
 const row=rows[0];
 const modelSource={path:'backend/models.go',blob:'f0e137f6213be8834023f0b7016bae2107fa4504',sha256:'766a526f3bb64b55678b686a9cb1fb4d771dd0a960df1e448f0c2d1afe799ffc'};
 if(git(['rev-parse',source.commit+':'+modelSource.path]).trim()!==modelSource.blob)throw Error('Original public model blob mismatch');
 const modelBytes=Buffer.from(git(['show',source.commit+':'+modelSource.path]));if(hash(modelBytes)!=='sha256:'+modelSource.sha256)throw Error('Original public model bytes mismatch');
 // Original Action.Resources is a JSON DTO backed by one comma-joined resource
 // SQL column; preserve that exact declared Value mapping, not an omitted field.
 if(!Array.isArray(row.resources)||row.resources.some(v=>typeof v!=='string'||v.includes(',')))throw Error('Unsupported original resources representation');
 const databaseRow={...row,resource:row.resources.join(',')};delete databaseRow.resources;
 const databaseKeys=Object.keys(databaseRow).sort();
 const boundary=(await query('fresh_chain','SELECT max(version) FROM schema_migrations;')).trim();observe({sourceResolved:true,boundary});if(boundary!=='124_repair_fire_bolt_upcast_description')throw Error('Early public seed requires exact124-fire predecessor');
 const metadata=JSON.parse(await query('fresh_chain',"SELECT json_agg(column_name ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema='public' AND table_name='actions';"));if(!Array.isArray(metadata)||!metadata.includes('id')||!metadata.includes('card_number')||metadata.some(k=>!/^[_a-z][_a-z0-9]*$/.test(k)))throw Error('Early public target schema unavailable');
 const omitted=databaseKeys.filter(k=>!metadata.includes(k));observe({sourceResolved:true,boundary,omittedPublicFields:omitted,omittedNonNullFields:omitted.filter(k=>databaseRow[k]!==null)});if(omitted.some(k=>databaseRow[k]!==null))throw Error('Historical non-null public field no longer fits schema');
 const columns=databaseKeys.filter(k=>metadata.includes(k));const projected=Object.fromEntries(columns.map(k=>[k,databaseRow[k]]));
 const absent=Number(await query('fresh_chain',`SELECT count(*) FROM actions WHERE id=${literal(row.id)}::uuid OR card_number=${literal(row.card_number)};`));
 observe({sourceResolved:true,boundary,matchingRows:absent,sourceFieldCount:allowed.length,insertedFieldCount:columns.length,omittedNullFields:omitted});
 if(absent!==0)throw Error('Early public identity already exists');
 const before=await fullDataSnapshot({table:'actions',ids:[row.id]});
 const fieldChecks=columns.map(k=>`to_jsonb(a)->${literal(k)} IS NOT DISTINCT FROM to_jsonb(expected_row)->${literal(k)}`).join(' AND ');
 const proof=JSON.parse(await query('fresh_chain',`BEGIN;
 CREATE TEMP TABLE early_public_before AS SELECT id,to_jsonb(a) AS row FROM actions a;
 CREATE TEMP TABLE early_public_ledger AS SELECT to_jsonb(m) AS row FROM schema_migrations m;
 INSERT INTO actions(${columns.map(k=>'"'+k+'"').join(',')}) SELECT ${columns.map(k=>'r."'+k+'"').join(',')} FROM jsonb_populate_record(NULL::actions,${literal(JSON.stringify(projected))}::jsonb) AS r WHERE NOT EXISTS(SELECT 1 FROM actions WHERE id=${literal(row.id)}::uuid OR card_number=${literal(row.card_number)});
 SELECT json_build_object('targetRows',(SELECT count(*) FROM actions WHERE id=${literal(row.id)}::uuid OR card_number=${literal(row.card_number)}),'rowAdded',(SELECT count(*) FROM actions)=(SELECT count(*)+1 FROM early_public_before),'originalRowsExact',NOT EXISTS(SELECT 1 FROM early_public_before b LEFT JOIN actions a USING(id) WHERE b.row IS DISTINCT FROM to_jsonb(a)),'sourceFieldsExact',(SELECT ${fieldChecks} FROM actions a CROSS JOIN jsonb_populate_record(NULL::actions,${literal(JSON.stringify(projected))}::jsonb) expected_row WHERE a.id=${literal(row.id)}::uuid AND a.card_number=${literal(row.card_number)}),'supportAndMechanicsRemainNull',(SELECT support IS NULL AND mechanics IS NULL FROM actions WHERE id=${literal(row.id)}::uuid),'ledgerExact',NOT EXISTS((SELECT row FROM early_public_ledger EXCEPT ALL SELECT to_jsonb(m) FROM schema_migrations m) UNION ALL(SELECT to_jsonb(m) FROM schema_migrations m EXCEPT ALL SELECT row FROM early_public_ledger)));
 COMMIT;`,{readOnly:false}));
 const after=await fullDataSnapshot({table:'actions',ids:[row.id]});
 if(JSON.stringify(before)!==JSON.stringify(after)||proof.targetRows!==1||Object.entries(proof).some(([key,value])=>key!=='targetRows'&&value!==true))throw Error('Early public seed changed forbidden data');
 const guardPath='backend/migrations/repair_mini_mvp_base_styles_origin_runtime.go';
 return {migration:'124',boundary,kind:'early-public-seed',source,serialization:{modelSource,mapping:'ActionResources.Value: JSON resources array to comma-joined SQL resource',timestampSemantics:'original timestamp instants via PostgreSQL typed record'},guard:{path:guardPath,sha256:hash(await fs.readFile(path.join(root,guardPath)))},sourceFieldCount:allowed.length,insertedFieldCount:columns.length,omittedNullFields:omitted,projectedRowHash:sha256Canonical(projected),proof,nonTargetBefore:before,nonTargetAfter:after,scope:'genuine-side-branch-public-row-not-immediate-main-or-live-preimage',certificateCopied:false};
}
