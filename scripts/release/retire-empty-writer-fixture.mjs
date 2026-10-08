// Test fixture preparation only. No DSN, production plan or host capability.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {assertOwnedCompactAdapter} from './compact-oci-adapter.mjs';
import {characterRetirementMigrationId as id} from './migration-transition.mjs';
import {evidenceHash} from './validate-manifest.mjs';
const sourceUrl=new URL('../../backend/migrations/data/retire-legacy-characters-302.sql',import.meta.url);
const hash=value=>'sha256:'+createHash('sha256').update(value).digest('hex');
const literal=value=>"'"+value.replaceAll("'","''")+"'";
const names=['characters','characters_v2','retired_inventories','retired_items'];
const completed=new WeakMap();
export function fixtureRetirementIdentity(target,sourceHash){
 const rows=target.filter(row=>row.id===id);
 if(!rows.length)return null;
 assert.equal(rows.length,1);assert.deepEqual(rows[0],{id,checksum:sourceHash});
 return rows[0];
}
export function assertEmptyRetirementPreimages(preimages){
 assert.deepEqual(Object.keys(preimages).sort(),[...names].sort());
 for(const row of Object.values(preimages))assert.deepEqual(row,{rows:0,sha256:hash('')},'Public fixture contains legacy user data');
}
const preimagesSql=`SELECT jsonb_object_agg(name,preimage) FROM (
 SELECT 'characters' name,jsonb_build_object('rows',count(*),'sha256','sha256:'||encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY t.id),''),'UTF8')),'hex')) preimage FROM public.characters t
 UNION ALL SELECT 'characters_v2',jsonb_build_object('rows',count(*),'sha256','sha256:'||encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY t.id),''),'UTF8')),'hex')) FROM public.characters_v2 t
 UNION ALL SELECT 'retired_inventories',jsonb_build_object('rows',count(*),'sha256','sha256:'||encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY t.id),''),'UTF8')),'hex')) FROM public.inventories t WHERE t.type='character'
 UNION ALL SELECT 'retired_items',jsonb_build_object('rows',count(*),'sha256','sha256:'||encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY t.id),''),'UTF8')),'hex')) FROM public.inventory_items t JOIN public.inventories p ON p.id=t.inventory_id WHERE p.type='character'
 ) records;`;
const ledgerSql="SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY version),'[]'::jsonb) FROM public.schema_migrations m WHERE version <> '302_retire_legacy_characters';";
const receiptSql="SELECT description FROM public.schema_migrations WHERE version='302_retire_legacy_characters';";
async function retained(query){
 const tables=JSON.parse(await query("SELECT json_agg(tablename ORDER BY tablename) FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('characters','characters_v2','schema_migrations');"));
 assert(tables.length>0);assert(tables.every(name=>/^[a-z][a-z0-9_]*$/.test(name)));
 const parts=tables.map(name=>`SELECT ${literal(name)} name,jsonb_build_object('rows',count(*),'sha256','sha256:'||encode(sha256(convert_to(coalesce(string_agg(digest,E'\\n' ORDER BY digest),''),'UTF8')),'hex')) fingerprint FROM (SELECT encode(sha256(convert_to(${name==='inventories'?"(to_jsonb(t)-'character_id')":"to_jsonb(t)"}::text,'UTF8')),'hex') digest FROM public.${name} t) rows`);
 return JSON.parse(await query('SELECT jsonb_object_agg(name,fingerprint) FROM ('+parts.join(' UNION ALL ')+') records;'));
}
export async function retireEmptyWriterFixture(adapter,target,binding){
 const source=await readFile(sourceUrl),identity=fixtureRetirementIdentity(target,hash(source));
 if(!identity)return {applied:false,required:false};
 await assertOwnedCompactAdapter(adapter);
 const query=sql=>adapter.query("SET TIME ZONE 'UTC';SET log_min_error_statement='PANIC';"+sql);
 const existing=(await query(receiptSql)).trim();
 if(existing){
  const prior=completed.get(adapter);assert(prior,'Unknown fixture retirement receipt');
  assert.equal(hash(existing),prior.receiptHash);await physical(query);return {...prior,applied:false};
 }
 // The adapter itself enforces stopped applications before snapshot/restore.
 const preimages=JSON.parse(await query(preimagesSql));assertEmptyRetirementPreimages(preimages);
 const ledger=(await query(ledgerSql)).trim();
 assert.deepEqual(JSON.parse(ledger).map(row=>row.version).sort(),target.filter(row=>row.id!==id).map(row=>row.id).sort());
 const before=await retained(query),snapshot=await adapter.dumpDatabase();
 const archive={schemaVersion:1,scope:'empty-owned-public-fixture',preimages,rows:Object.fromEntries(names.map(name=>[name,[]]))};
 const archiveBytes=Buffer.from(JSON.stringify(archive)+'\n'),archiveFile=path.join(adapter.directory,'empty-retirement-archive.json');
 await writeFile(archiveFile,archiveBytes,{flag:'wx',mode:0o600});
 const restore=await adapter.restoreDatabase(snapshot);
 assert.deepEqual(JSON.parse(await readFile(archiveFile)),archive);
 assert.deepEqual(JSON.parse(await query(preimagesSql)),preimages);
 assert.equal((await query(ledgerSql)).trim(),ledger);assert.deepEqual(await retained(query),before);
 const restoreReport={schemaVersion:1,status:'passed',scope:'owned-empty-fixture-archive-and-full-snapshot-roundtrip',archiveHash:hash(archiveBytes),snapshot,restore,preimages,retained:before};
 const restoreBytes=Buffer.from(JSON.stringify(restoreReport)+'\n');
 await writeFile(path.join(adapter.directory,'empty-retirement-restore.json'),restoreBytes,{flag:'wx',mode:0o600});
 // This synthetic binding describes fixture setup, never accepted production
 // rollback readers. Production retirement continues to require its V4 bundle.
 const fixtureBinding={scope:'synthetic-owned-fixture-preparation-not-production-approval',owner:adapter.owner,binding};
 const request={schemaVersion:1,kind:'retire-character-generations-302',backupHash:snapshot.sha256,archiveRestoreReportHash:hash(restoreBytes),acceptedRollbackPairHash:evidenceHash(fixtureBinding),preimages};
 await assertOwnedCompactAdapter(adapter);assert.deepEqual(await readFile(sourceUrl),source);
 await query(source.toString('utf8').replace(":'retirement_request'",literal(JSON.stringify(request))));
 const receipt=(await query(receiptSql)).trim();assert.deepEqual(JSON.parse(receipt).request,request);
 await physical(query);assert.equal((await query(ledgerSql)).trim(),ledger);assert.deepEqual(await retained(query),before);
 const report={schemaVersion:1,status:'passed',scope:'owned-empty-public-writer-fixture',productionReady:false,productionChanges:0,syntheticApprovalBinding:true,owner:adapter.owner,identity,request,fixtureBinding,receiptHash:hash(receipt),priorMigrationRowsPreserved:JSON.parse(ledger).length,retainedTablesChecked:Object.keys(before).length};
 await writeFile(path.join(adapter.directory,'empty-retirement-preparation.json'),JSON.stringify(report)+'\n',{flag:'wx',mode:0o600});
 completed.set(adapter,report);return {...report,applied:true};
}
async function physical(query){
 assert.equal((await query("SELECT to_regclass('public.characters') IS NULL AND to_regclass('public.characters_v2') IS NULL AND NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='inventories' AND column_name='character_id');")).trim(),'t');
}
