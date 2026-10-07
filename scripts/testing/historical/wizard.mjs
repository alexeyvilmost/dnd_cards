import {bridgeSource} from './identity-bridge.mjs';
// One public authored effect, applied only before ordinary 156/169. Never copies support.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const lit=v=>`'${String(v).replaceAll("'","''")}'`;
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const hash=v=>'sha256:'+sha(JSON.stringify(canonical(v)));
const card='EFF-wizard-spellcasting',publicId='bcb05701-70ac-4b48-8e60-4cf46f6ea544';
export function wizardRecipe(){
 const manifest=JSON.parse(fs.readFileSync(path.join(dir,'wizard-source-recipe.json')));
 function read(file,kind){const p=manifest.files.find(x=>x.path===file&&x.kind===kind);if(!p)throw Error('Wizard source pin absent');const data=execFileSync('git',['show',p.commit+':'+file],{maxBuffer:16*1024**2});if(sha(data)!==p.sha256||data.length!==p.bytes||execFileSync('git',['rev-parse',p.commit+':'+file]).toString().trim()!==p.blob)throw Error('Wizard source pin changed');if(kind==='actual'&&sha(fs.readFileSync(file))!==p.sha256){if(file!=='backend/migrations/migrations.go')throw Error('Wizard actual source changed');const reviewed=bridgeSource();const original=reviewed.sourceFiles.find(v=>v.path===file&&v.commit===p.commit);if(!original||original.blob!==p.blob||original.sha256!==p.sha256||original.bytes!==p.bytes)throw Error('Wizard original registry binding differs');}return data;}
 const registry=read('backend/migrations/migrations.go','actual').toString(),forge=read('backend/migrations/seed_forge_mvp.go','actual').toString();
 const start=registry.indexOf('func updateWizardSpellChoices('),end=registry.indexOf('\n}',start),functionText=registry.slice(start,end+2),literal=functionText.match(/spellcastingMech := `([^`]+)`/);
 const call=forge.match(/upsertEffect\(db, "EFF-wizard-spellcasting", "([^"]+)",\s*"([^"]+)", "([^"]+)", spellcastingMech\)/);
 if(start<0||end<start||!literal||!call||!functionText.includes("WHERE card_number = 'EFF-wizard-spellcasting' AND deleted_at IS NULL"))throw Error('Wizard migration declaration absent');
 const before=JSON.parse(literal[1]),publicRows=JSON.parse(read('officials/canon/prod-snapshot/effects.json','authored')).filter(r=>r.id===publicId&&r.card_number===card&&!r.deleted_at);
 const patch=JSON.parse(read('frontend/src/canon/data/micro-mvp-l1-content-patch.v1.json','authored')),found=[];
 function walk(v){if(!v||typeof v!=='object')return;if(v.cardNumber===card)found.push(v);for(const child of Object.values(v))walk(child);}walk(patch);
 if(publicRows.length!==1||found.length!==1||found[0].entityId!==publicId||hash(publicRows[0].mechanics)!==found[0].expectedBeforeMechanicsHash||hash(before)!==manifest.generatedBeforeHash||hash(found[0].mechanics)!==manifest.authoredAfterHash||found[0].mechanics.effects?.[3]?.kind!=='prepared_spell_choice')throw Error('Wizard authored domain or before hash differs');
 read('backend/migrations/repair_wizard_level_two_spellbook.go','actual');read('backend/migrations/harden_level_five_runtime.go','actual');
 return {card,publicId,name:call[1],description:call[2],effectType:call[3],before,after:found[0].mechanics,files:manifest.files,recipeHash:sha(fs.readFileSync(path.join(dir,'wizard-source-recipe.json'))),publicBeforeHash:found[0].expectedBeforeMechanicsHash,generatedBeforeHash:manifest.generatedBeforeHash};
}
export async function captureWizardIdentity(query){
 const recipe=wizardRecipe();if((await query('fresh_chain','SELECT max(version) FROM schema_migrations;')).trim()!=='082_character_system_metadata')throw Error('Wizard identity requires082');
 const state=JSON.parse(await query('fresh_chain',`SELECT jsonb_build_object('rows',count(*),'id',min(id::text),'exact',coalesce(bool_and(name=${lit(recipe.name)} AND description=${lit(recipe.description)} AND effect_type=${lit(recipe.effectType)} AND mechanics=${lit(JSON.stringify(recipe.before))}::jsonb AND support IS NULL AND deleted_at IS NULL),false),'rowHash',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY id),''),'UTF8')),'hex')) FROM effects t WHERE card_number=${lit(card)};`));
 if(state.rows!==1||!state.exact||!/^[a-f0-9-]{36}$/.test(state.id)||!/^[a-f0-9]{64}$/.test(state.rowHash))throw Error('Wizard generated preimage differs');
 return {boundary:'082_character_system_metadata',kind:'authored-bootstrap-wizard-identity',recipeHash:recipe.recipeHash,...state};
}
export async function hydrateAuthoredWizard({query,identity,fullDataSnapshot,observe=()=>{}}){
 const r=wizardRecipe();if(!identity||identity.kind!=='authored-bootstrap-wizard-identity'||identity.boundary!=='082_character_system_metadata'||identity.recipeHash!==r.recipeHash||identity.rows!==1||!identity.exact||!/^[a-f0-9-]{36}$/.test(identity.id)||!/^[a-f0-9]{64}$/.test(identity.rowHash))throw Error('Wizard captured identity absent');
 if((await query('fresh_chain','SELECT max(version) FROM schema_migrations;')).trim()!=='101_pin_tactical_basic_action_targets')throw Error('Wizard recipe requires101');
 const state=JSON.parse(await query('fresh_chain',`SELECT jsonb_build_object('rows',count(*),'identity',coalesce(bool_and(id=${lit(identity.id)}::uuid AND card_number=${lit(card)} AND deleted_at IS NULL),false),'mechanicsExact',coalesce(bool_and(mechanics=${lit(JSON.stringify(r.before))}::jsonb),false),'supportEmpty',coalesce(bool_and(support IS NULL),false),'rowHash',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY id),''),'UTF8')),'hex')) FROM effects t WHERE id=${lit(identity.id)}::uuid OR card_number=${lit(card)};`));observe({boundary:'101',state,recipeHash:r.recipeHash});
 if(state.rows!==1||!state.identity||!state.mechanicsExact||!state.supportEmpty||state.rowHash!==identity.rowHash)throw Error('Wizard observed row changed since082');
 const nonTargetBefore=await fullDataSnapshot({table:'effects',ids:[identity.id]});
 const proof=JSON.parse(await query('fresh_chain',`BEGIN; LOCK TABLE effects IN SHARE ROW EXCLUSIVE MODE; CREATE TEMP TABLE wizard_before AS SELECT to_jsonb(t) AS row FROM effects t WHERE id=${lit(identity.id)}::uuid; CREATE TEMP TABLE wizard_ledger AS SELECT to_jsonb(m) AS row FROM schema_migrations m;
 DO $owned$ DECLARE n integer; BEGIN UPDATE effects t SET mechanics=${lit(JSON.stringify(r.after))}::jsonb WHERE id=${lit(identity.id)}::uuid AND card_number=${lit(card)} AND deleted_at IS NULL AND support IS NULL AND mechanics=${lit(JSON.stringify(r.before))}::jsonb AND encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')=${lit(identity.rowHash)}; GET DIAGNOSTICS n=ROW_COUNT; IF n<>1 THEN RAISE EXCEPTION 'wizard preimage changed'; END IF; END $owned$;
 CREATE TEMP TABLE wizard_proof AS SELECT jsonb_build_object('rows',count(*),'otherFieldsExact',bool_and((to_jsonb(t)-ARRAY['mechanics','updated_at'])=(b.row-ARRAY['mechanics','updated_at'])),'mechanicsExact',bool_and(mechanics=${lit(JSON.stringify(r.after))}::jsonb),'supportEmpty',bool_and(support IS NULL),'timestampExact',bool_and(updated_at=transaction_timestamp() AND (b.row->>'updated_at')::timestamptz<=updated_at),'ledgerExact',NOT EXISTS((SELECT row FROM wizard_ledger EXCEPT ALL SELECT to_jsonb(m) FROM schema_migrations m) UNION ALL (SELECT to_jsonb(m) FROM schema_migrations m EXCEPT ALL SELECT row FROM wizard_ledger))) AS value FROM effects t CROSS JOIN wizard_before b WHERE t.id=${lit(identity.id)}::uuid;
 DO $owned$ BEGIN IF (SELECT value->>'rows' FROM wizard_proof)<>'1' OR EXISTS(SELECT 1 FROM wizard_proof p CROSS JOIN LATERAL jsonb_each(p.value-'rows') e WHERE e.value<>'true'::jsonb) THEN RAISE EXCEPTION 'wizard postcondition failed'; END IF; END $owned$; SELECT value FROM wizard_proof; COMMIT;`,{readOnly:false}));
 const nonTargetAfter=await fullDataSnapshot({table:'effects',ids:[identity.id]});if(JSON.stringify(nonTargetBefore)!==JSON.stringify(nonTargetAfter)||proof.rows!==1||Object.entries(proof).some(([k,v])=>k!=='rows'&&v!==true))throw Error('Wizard changed forbidden bytes');
 return {kind:'source-composed-authored-wizard-before156',boundary:'101_pin_tactical_basic_action_targets',sourceFiles:r.files,recipeHash:r.recipeHash,identity,state,publicSourceIdentity:r.publicId,publicBeforeHash:r.publicBeforeHash,generatedBeforeHash:r.generatedBeforeHash,afterHash:hash(r.after),proof,nonTargetBefore,nonTargetAfter,scope:{originalWriterReplay:false,UUIDRewritten:false,certificateCopied:false,ledgerWritten:false,ordinary156And169ToRun:true}};
}
