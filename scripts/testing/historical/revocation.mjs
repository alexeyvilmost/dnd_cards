import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {sha256Canonical} from '../../../scripts/content/certification-hash.mjs';

const definitions={
 '119_repair_sleep_spell_class_list_contract':{prefix:'sleepSpell',table:'spells',entityType:'spell',file:'backend/migrations/repair_sleep_spell_class_list_contract.go',id:'sleepSpellEntityID',card:'sleepSpellCardNumber',reason:'sleepSpellClassListRevocationReason',before:'118_'},
};
const supportKeys=new Set(['status','reviewed_at','reviewed_by','content_hash','dependency_hash','certification_version','certified_at','limitations','note','evidence_id','evidence_hash','evidence_completed_at','gate_source_hash','source_content_hash','rules_hash','release_content_hash','release_hash','patch_hash','catalog_hash','test_coverage','mechanics_locked']);
const lit=v=>`'${v.replaceAll("'","''")}'`;
const digest=v=>crypto.createHash('sha256').update(v).digest('hex');
const constant=(text,name)=>{const m=text.match(new RegExp(`\\b${name}\\s*=\\s*"([^"\\r\\n]+)"`));if(!m)throw Error('Historical constant missing');return m[1];};
const mechanics=(text,name)=>{const m=text.match(new RegExp(`\\b${name}\\s*=\\s*\x60([\\s\\S]*?)\x60`));if(!m)throw Error('Historical mechanics missing');return JSON.parse(m[1]);};
export function supportsPreservedHydration(version){return Object.hasOwn(definitions,version);}
export async function hydratePreservedRevocation({version,query,root,directory,fullDataSnapshot}){
 const config=definitions[version];if(!config)throw Error('No proven historical source recipe');
 const bytes=await fs.readFile(path.join(root,config.file)),text=bytes.toString('utf8');
 const expected={id:constant(text,config.id),card:constant(text,config.card),reason:constant(text,config.reason),mechanics:mechanics(text,`${config.prefix}LegacyMechanics`)};
 const rows=JSON.parse(await query('source_preimages',`SELECT coalesce(jsonb_agg(jsonb_build_object('entity_type',entity_type,'entity_id',entity_id,'card_number',card_number,'prior_support',prior_support,'prior_mechanics',prior_mechanics,'reason',reason,'migration_version',migration_version,'preimage_hash',encode(sha256(convert_to(jsonb_build_object('prior_support',prior_support,'prior_mechanics',prior_mechanics)::text,'UTF8')),'hex'))),'[]'::jsonb) FROM content_certification_revocations WHERE migration_version=${lit(version)};`));
 if(rows.length!==1)throw Error('Authentic historical preimage absent or ambiguous');
 const row=rows[0];
 if(Object.keys(row).sort().join(',')!=='card_number,entity_id,entity_type,migration_version,preimage_hash,prior_mechanics,prior_support,reason'||row.entity_type!==config.entityType||row.entity_id!==expected.id||row.card_number!==expected.card||row.reason!==expected.reason||row.migration_version!==version||!isDeepStrictEqual(row.prior_mechanics,expected.mechanics)||!row.prior_support||Array.isArray(row.prior_support)||typeof row.prior_support!=='object'||Object.keys(row.prior_support).some(k=>!supportKeys.has(k))||!/^[a-f0-9]{64}$/.test(row.preimage_hash))throw Error('Historical source does not match unchanged guard');
 await fs.writeFile(path.join(directory,`authentic-${version.slice(0,3)}.private.json`),JSON.stringify(row)+'\n',{mode:0o600});
 const boundary=(await query('fresh_chain','SELECT max(version) FROM schema_migrations;')).trim();if(!boundary.startsWith(config.before))throw Error('Historical hydration boundary mismatch');
 // Independently derive the exact owned fresh-row mechanics from the public seed
 // and unchanged 088/107 projections; a matching identity alone is insufficient.
 const publicSpellBytes=await fs.readFile(path.join(root,'officials/canon/prod-snapshot/spells.json'));
 const publicClassBytes=await fs.readFile(path.join(root,'officials/canon/prod-snapshot/classes.json'));
 const seeds=JSON.parse(publicSpellBytes).filter(s=>s.id===expected.id&&s.card_number===expected.card);
 if(seeds.length!==1)throw Error('Public target source absent or ambiguous');
 const labels=[...new Set(seeds[0].classes.map(s=>s.trim().toLowerCase()))];
 const classes=JSON.parse(publicClassBytes).filter(c=>!c.is_subclass&&!c.deleted_at);
 const matches=labels.map(label=>classes.filter(c=>c.name?.trim().toLowerCase()===label||c.name_en?.trim().toLowerCase()===label));
 if(matches.some(rows=>rows.length!==1))throw Error('Public target class projection ambiguous');
 const classIDs=[...new Set(matches.map(rows=>rows[0].card_number))].sort();
 const currentMechanics={...seeds[0].mechanics,targeting:{...seeds[0].mechanics.targeting,range:'60 футов'},spell_class_list_ids:classIDs};
 const projection={sourceMechanicsHash:sha256Canonical(seeds[0].mechanics),expectedMechanicsHash:sha256Canonical(currentMechanics),expectedSupport:null,classCount:classIDs.length,publicSpellsHash:'sha256:'+digest(publicSpellBytes),publicClassesHash:'sha256:'+digest(publicClassBytes),migrations:[]};
 for(const file of ['backend/migrations/normalize_spell_targeting_ranges.go','backend/migrations/normalize_live_happy_path_content.go'])projection.migrations.push({path:file,sha256:'sha256:'+digest(await fs.readFile(path.join(root,file)))});
 const before=JSON.parse(await query('fresh_chain',`SELECT json_build_object('rows',count(*),'exactIdentity',coalesce(bool_and(id=${lit(expected.id)}::uuid AND card_number=${lit(expected.card)}),false),'unlocked',coalesce(bool_and(coalesce(support->>'mechanics_locked','false')<>'true'),false),'notDeleted',coalesce(bool_and(deleted_at IS NULL),false),'mechanicsExact',coalesce(bool_and(mechanics=${lit(JSON.stringify(currentMechanics))}::jsonb),false),'supportExact',coalesce(bool_and(support IS NULL),false),'rowHash',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY id),''),'UTF8')),'hex')) FROM ${config.table} t WHERE id=${lit(expected.id)}::uuid OR card_number=${lit(expected.card)};`));
 if(before.rows!==1||!before.exactIdentity||!before.unlocked||!before.notDeleted||!before.mechanicsExact||!before.supportExact)throw Error('Fresh target is not a single unlocked public entity');
 // Preserve normal invalidation, lock and updated_at triggers. Restoring the
 // recorded mechanics may invalidate support; restore exact recorded support
 // in a second update in the same owned transaction. No trigger is disabled.
 const nonTargetBefore=await fullDataSnapshot({table:config.table,ids:[expected.id]}); const proof=JSON.parse(await query('fresh_chain',`BEGIN;
 CREATE TEMP TABLE historical_hydration_before AS SELECT id,to_jsonb(t) AS row FROM ${config.table} t;
 CREATE TEMP TABLE historical_ledger_before AS SELECT to_jsonb(m) AS row FROM schema_migrations m;
 UPDATE ${config.table} SET mechanics=${lit(JSON.stringify(row.prior_mechanics))}::jsonb WHERE id=${lit(expected.id)}::uuid AND card_number=${lit(expected.card)} AND deleted_at IS NULL AND encode(sha256(convert_to(to_jsonb(${config.table})::text,'UTF8')),'hex')=${lit(before.rowHash)};
 UPDATE ${config.table} SET support=${lit(JSON.stringify(row.prior_support))}::jsonb WHERE id=${lit(expected.id)}::uuid AND card_number=${lit(expected.card)} AND mechanics=${lit(JSON.stringify(row.prior_mechanics))}::jsonb;
 SELECT json_build_object('changedRows',count(*),'onlyTargetRow',coalesce(bool_and(t.id=${lit(expected.id)}::uuid),false),'onlyRecordedFieldsAndTimestamp',coalesce(bool_and((b.row-ARRAY['mechanics','support','updated_at'])=(to_jsonb(t)-ARRAY['mechanics','support','updated_at'])),false),'timestampFromTransaction',coalesce(bool_and(t.updated_at=transaction_timestamp() AND (b.row->>'updated_at')::timestamptz<=t.updated_at),false),'mechanicsExact',coalesce(bool_and(t.mechanics=${lit(JSON.stringify(row.prior_mechanics))}::jsonb),false),'supportExact',coalesce(bool_and(t.support=${lit(JSON.stringify(row.prior_support))}::jsonb),false),'ledgerExact',NOT EXISTS ((SELECT row FROM historical_ledger_before EXCEPT ALL SELECT to_jsonb(m) FROM schema_migrations m) UNION ALL (SELECT to_jsonb(m) FROM schema_migrations m EXCEPT ALL SELECT row FROM historical_ledger_before)),'rowCountExact',(SELECT count(*) FROM ${config.table})=(SELECT count(*) FROM historical_hydration_before)) FROM ${config.table} t JOIN historical_hydration_before b USING(id) WHERE b.row IS DISTINCT FROM to_jsonb(t);
 COMMIT;`,{readOnly:false}));
 const nonTargetAfter=await fullDataSnapshot({table:config.table,ids:[expected.id]}); if(JSON.stringify(nonTargetBefore)!==JSON.stringify(nonTargetAfter)||proof.changedRows!==1||Object.entries(proof).some(([key,value])=>key!=='changedRows'&&value!==true))throw Error('Historical hydration changed forbidden bytes');
 return {migration:version.slice(0,3),boundary,table:config.table,sourceGuard:{path:config.file,sha256:`sha256:${digest(bytes)}`},authenticPreimageHash:`sha256:${row.preimage_hash}`,before,projection,proof,nonTargetBefore,nonTargetAfter,scope:'exact-preserved-historical-data-not-new-certification'};
}
