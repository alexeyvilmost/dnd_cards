import {spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {sha256Canonical} from '../../../scripts/content/certification-hash.mjs';
const source={commit:'278258aa0e8b21d326040097b745540bcf369684',path:'officials/canon/prod-snapshot/actions.json',blob:'f8561f58a27d809d2e53b13f2b3325da38dd2e4b',sha256:'849242b025c392e2d9aa94bc3e5764a7553dc46cd7f6a9ec4675613445f34ec9',mechanicsHash:'sha256:9b0650d972e1cdc21d1c141454216068f5a9d157c5a4aea40757c5fefcf69c9a',sourceKind:'early-public-side-branch'};
const id='c1586eb6-a618-4a8a-8568-26dd5595887b',card='aasimar_healing_hands';
const hash=x=>'sha256:'+crypto.createHash('sha256').update(x).digest('hex'),lit=x=>`'${x.replaceAll("'","''")}'`;
export async function hydrateHealingHandsPublicField({query,root,fullDataSnapshot,observe=()=>{}}){
 const git=args=>{const p=spawnSync('git',args,{cwd:root,windowsHide:true,maxBuffer:4e6,encoding:'utf8'});if(p.status!==0)throw Error('Pinned public source unavailable');return p.stdout;};
 if(git(['rev-parse',source.commit+':'+source.path]).trim()!==source.blob)throw Error('128 source blob mismatch');
 const bytes=Buffer.from(git(['show',source.commit+':'+source.path]));if(hash(bytes)!=='sha256:'+source.sha256)throw Error('128 source bytes mismatch');
 const original=JSON.parse(bytes).filter(r=>r.id===id&&r.card_number===card);if(original.length!==1||sha256Canonical(original[0].mechanics)!==source.mechanicsHash||original[0].mechanics.effects?.[0]?.result?.[0]?.amount!=='prof d4')throw Error('128 source mechanics mismatch');
 const seedPath='officials/canon/prod-snapshot/actions.json',seedBytes=await fs.readFile(path.join(root,seedPath));const seeds=JSON.parse(seedBytes).filter(r=>r.id===id&&r.card_number===card);
 if(seeds.length!==1||sha256Canonical(seeds[0].mechanics)!=='sha256:388a6434aea0d8e2f47d0096f4b7b43ca87c3b3d8d6a77b7939aaa9eeafba2c2')throw Error('128 public baseline drift');
 const sourceDifference=structuredClone(original[0].mechanics);sourceDifference.effects[0].result[0].amount='self_level d4';if(!isDeepStrictEqual(sourceDifference,seeds[0].mechanics))throw Error('128 historical difference is broader than one field');
 // The unchanged 097 and 105 transformations already executed on this owned DB.
 // Preserve their complete cost and targeting declarations; restore only the
 // original recorded scalar, not the older whole pre-097/pre-105 mechanics.
 const expected=structuredClone(seeds[0].mechanics);expected.activation.cost.push({resource:'self_uses'});expected.targeting={domain:'actor',actor_targets:true,shape:'single',min_targets:1,max_targets:1,range_ft:5,requires_line_of_sight:true,allowed_relations:['self','ally','enemy','neutral'],requires_touch:true};expected.effects[0].who='target';
 const after=structuredClone(expected);after.effects[0].result[0].amount=original[0].mechanics.effects[0].result[0].amount;
 const priorSources=[];for(const p of ['backend/migrations/repair_live_mvp_content_contracts.go','backend/migrations/repair_active_action_targeting.go'])priorSources.push({path:p,sha256:hash(await fs.readFile(path.join(root,p)))});
 const boundary=(await query('fresh_chain','SELECT max(version) FROM schema_migrations;')).trim();observe({boundary,sourceResolved:true});if(boundary!=='127_repair_missing_weapon_mastery_profiles')throw Error('128 requires exact127 predecessor');
 const state=JSON.parse(await query('fresh_chain',`SELECT json_build_object('rows',count(*),'identity',coalesce(bool_and(id=${lit(id)}::uuid AND card_number=${lit(card)} AND deleted_at IS NULL),false),'mechanicsExact',coalesce(bool_and(mechanics=${lit(JSON.stringify(expected))}::jsonb),false),'supportEmpty',coalesce(bool_and(support IS NULL),false),'rowHash',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(a)::text,E'\\n' ORDER BY id),''),'UTF8')),'hex')) FROM actions a WHERE id=${lit(id)}::uuid OR card_number=${lit(card)};`));observe({boundary,sourceResolved:true,state});
 if(state.rows!==1||!state.identity||!state.mechanicsExact||!state.supportEmpty)throw Error('128 fresh target differs from independently derived prior migrations');
 const before=await fullDataSnapshot({table:'actions',ids:[id]});
 const proof=JSON.parse(await query('fresh_chain',`BEGIN; CREATE TEMP TABLE public128_before AS SELECT id,to_jsonb(a) AS row FROM actions a; CREATE TEMP TABLE public128_ledger AS SELECT to_jsonb(m) AS row FROM schema_migrations m;
 UPDATE actions SET mechanics=jsonb_set(mechanics,'{effects,0,result,0,amount}',${lit(JSON.stringify(original[0].mechanics.effects[0].result[0].amount))}::jsonb,false) WHERE id=${lit(id)}::uuid AND card_number=${lit(card)} AND support IS NULL AND encode(sha256(convert_to(to_jsonb(actions)::text,'UTF8')),'hex')=${lit(state.rowHash)};
 SELECT json_build_object('changedRows',count(*),'onlyTarget',coalesce(bool_and(a.id=${lit(id)}::uuid),false),'onlyMechanicsAndTimestamp',coalesce(bool_and((b.row-ARRAY['mechanics','updated_at'])=(to_jsonb(a)-ARRAY['mechanics','updated_at'])),false),'timestampFromTransaction',coalesce(bool_and(a.updated_at=transaction_timestamp() AND (b.row->>'updated_at')::timestamptz<=a.updated_at),false),'mechanicsExact',coalesce(bool_and(a.mechanics=${lit(JSON.stringify(after))}::jsonb),false),'supportEmpty',coalesce(bool_and(a.support IS NULL),false),'ledgerExact',NOT EXISTS((SELECT row FROM public128_ledger EXCEPT ALL SELECT to_jsonb(m) FROM schema_migrations m) UNION ALL(SELECT to_jsonb(m) FROM schema_migrations m EXCEPT ALL SELECT row FROM public128_ledger)),'rowCountExact',(SELECT count(*) FROM actions)=(SELECT count(*) FROM public128_before)) FROM actions a JOIN public128_before b USING(id) WHERE b.row IS DISTINCT FROM to_jsonb(a); COMMIT;`,{readOnly:false}));
 const afterSnapshot=await fullDataSnapshot({table:'actions',ids:[id]});if(JSON.stringify(before)!==JSON.stringify(afterSnapshot)||proof.changedRows!==1||Object.entries(proof).some(([k,v])=>k!=='changedRows'&&v!==true))throw Error('128 source field hydration changed forbidden data');
 return {migration:'128',boundary,kind:'early-public-field-hydration',source,priorSources,projection:{beforeMechanicsHash:sha256Canonical(expected),afterMechanicsHash:sha256Canonical(after),path:'effects[0].result[0].amount',earlier097And105Preserved:true,onlyOriginalScalarRestored:true},state,proof,nonTargetBefore:before,nonTargetAfter:afterSnapshot,supportCopied:false,scope:'original-side-branch-public-scalar-preserving-executed-prior-migrations-not-live-preimage'};
}
