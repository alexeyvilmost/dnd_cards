// Owned local format foundation only. This is not CI or production provenance.
import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {gunzipSync} from 'node:zlib';
import {evidenceHash} from './validate-manifest.mjs';import {databaseSchemaLedgerProof} from './database-schema-proof.mjs';import {assertRuntimeWriterPolicy} from './writer-environment.mjs';
const off={compactReceipts:false,imageJobs:false,frozenCatalogs:false};
const families=['roguelike_command_receipts','character_runtime_commands'];
const sha=bytes=>'sha256:'+createHash('sha256').update(bytes).digest('hex');
const same=(a,b)=>assert.equal(evidenceHash(a),evidenceHash(b),'Exact saved data differs');
const quote=name=>{assert.match(name,/^[a-z_][a-z0-9_]{0,62}$/);return '"'+name+'"';};
function response(f,value,retry){assert.equal(value?.status,200,`Canonical ${f.table} command was not accepted`);const body=structuredClone(value.body);if(f.table==='character_runtime_commands'){assert.equal(body.replayed,retry);body.replayed=false;}return body;}
function decoded(row){assert.equal(row.response_version,2);assert.ok(row.response_payload_base64);const encoded=Buffer.from(row.response_payload_base64,'base64'),raw=gunzipSync(encoded,{maxOutputLength:64*1024**2});assert.equal(raw.length,row.response_length);assert.equal(sha(raw),'sha256:'+row.response_sha256);assert.deepEqual(row.response,{});return JSON.parse(raw.toString('utf8'));}
export async function snapshotExpandedDatabase(adapter){
 await adapter.assertOwned();const schema=await databaseSchemaLedgerProof(adapter);
 const tables=JSON.parse(await adapter.query("SELECT coalesce(json_agg(table_name ORDER BY table_name),'[]'::json) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';"));assert.ok(tables.length>0);
 const projections=tables.map(name=>`SELECT '${name}' AS name,count(*)::int AS rows,encode(sha256(convert_to(coalesce(string_agg(h,'' ORDER BY h),''),'UTF8')),'hex') AS digest FROM (SELECT encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') AS h FROM public.${quote(name)} r) hashed`);
 const rows=JSON.parse(await adapter.query(`SELECT json_agg(x ORDER BY name) FROM (${projections.join(' UNION ALL ')}) x;`));assert.equal(rows.length,tables.length);
 const objects=JSON.parse(await adapter.query(`SELECT json_build_object(
  'tables',(SELECT json_agg(json_build_object('name',c.relname,'kind',c.relkind,'persistence',c.relpersistence,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity) ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p')),
  'functions',(SELECT json_agg(pg_get_functiondef(p.oid) ORDER BY p.proname,pg_get_function_identity_arguments(p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind IN ('f','p')),
  'triggers',(SELECT json_agg(json_build_object('table',c.relname,'definition',pg_get_triggerdef(t.oid,false),'enabled',t.tgenabled) ORDER BY c.relname,t.tgname) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal),
  'policies',(SELECT json_agg(to_jsonb(p) ORDER BY tablename,policyname) FROM pg_policies p WHERE schemaname='public'),
  'views',(SELECT json_agg(json_build_object('name',c.relname,'definition',pg_get_viewdef(c.oid,false)) ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('v','m')));`));
 const names=JSON.parse(await adapter.query("SELECT coalesce(json_agg(sequencename ORDER BY sequencename),'[]'::json) FROM pg_sequences WHERE schemaname='public';"));
 const sequences=names.length?JSON.parse(await adapter.query(`SELECT json_agg(x ORDER BY name) FROM (${names.map(name=>`SELECT '${name}' AS name,last_value::text,is_called FROM public.${quote(name)}`).join(' UNION ALL ')}) x;`)):[];
 const versions=JSON.parse(await adapter.query(`SELECT json_build_object('rogue',(SELECT count(*) FROM roguelike_command_receipts WHERE response_version=2),'character',(SELECT count(*) FROM character_runtime_commands WHERE response_version=2),'jobs',(SELECT count(*) FROM image_jobs));`));
 const artifacts=await adapter.artifactClosure();assert.ok(Array.isArray(artifacts)&&artifacts.length>0);for(const row of artifacts){assert.match(row.sha256,/^sha256:[a-f0-9]{64}$/);assert.ok(row.bytes>0);}
 return {schema,objectsHash:evidenceHash(objects),rows,sequences,versions,artifacts};
}
function formatSnapshot(value){
 const receiptRows=value.rows.filter(row=>families.includes(row.name)),jobs=value.rows.filter(row=>row.name==='image_jobs');assert.equal(receiptRows.length,2);assert.equal(jobs.length,1);
 return {receiptsHash:evidenceHash(receiptRows),jobsHash:evidenceHash(jobs),artifactClosureHash:evidenceHash(value.artifacts),sourceCertificationClosureHash:evidenceHash([]),v2Receipts:value.versions.rogue+value.versions.character,imageJobs:value.versions.jobs};
}
export async function probeExpandedWriterRestore({binding,adapter,compactIO,jobsIO,snapshot=snapshotExpandedDatabase}){
 assert.equal(adapter.execution,'docker');await adapter.assertOwned();const originalPolicy=off,compact=[],jobs=[];let failure;
 const result={schemaVersion:1,kind:'expanded-writer-restore-foundation',execution:'docker',localOnly:true,deployable:false,scope:'same exact historical image ON/OFF; owned synthetic data; no production backup or distinct-version claim',sourceCertificationScope:'empty local fixture filesystem closure; not production source-certificate recovery',initialEffects:compactIO.initialEffects};
 async function observed(role,policy){const state=await adapter.observe();same(state.images,binding[role].images);same(state.identities,binding[role].identities);assertRuntimeWriterPolicy(state.environment,{manifest:{writerPolicy:policy}});}
 async function counters(){const provider=await adapter.imageStats();assert.equal(provider.unexpected,0);return {worker:await adapter.workerCalls(),provider};}
 async function retryAll(phase){
  const before=await counters(),responses=[];
  for(const f of compact){const invariant=await compactIO.invariant(f),actual=response(f,await compactIO.request(f),true);same(actual,f.response);same(await compactIO.readReceipt(f),f.stored);same(await compactIO.invariant(f),invariant);responses.push({id:f.table,responseHash:evidenceHash(actual),storageHash:evidenceHash(f.stored)});}
  for(const row of jobs){const read=await jobsIO.read(row);assert.equal(read.status,200);same(read.body.job,row.saved);const retried=await jobsIO.retry(row);assert.equal(retried.status,202);same(retried.body.job,row.saved);assert.equal((await jobsIO.readOtherOwner(row)).status,404);responses.push({id:row.id,jobId:row.jobId,responseHash:evidenceHash(read.body.job)});}
  const after=await counters();same(before,after);return {phase,responsesHash:evidenceHash(responses),before,after};
 }
 try{
  await compactIO.start('candidate',{...off,compactReceipts:true});await observed('candidate',{...off,compactReceipts:true});
  const produced=await compactIO.fixtures();assert.deepEqual(produced.map(row=>row.table),families);
  for(const f of produced){const body=response(f,await compactIO.request(f),false),stored=await compactIO.readReceipt(f);same(decoded(stored),body);assert.equal(stored.command_id,f.commandId);compact.push({...f,response:body,stored});}
  assert.equal(compactIO.initialEffects.length,2);await compactIO.stop();
  await jobsIO.start('candidate',{...off,compactReceipts:true,imageJobs:true});await observed('candidate',{...off,compactReceipts:true,imageJobs:true});
  const created=await jobsIO.createCases();assert.deepEqual(created.map(row=>row.id),['queued','succeeded','unknown','expired-running']);
  const attempts=await adapter.imageStats();assert.equal(attempts.providerCalls,3);assert.equal(attempts.storageUploads,1);assert.equal(attempts.unexpected,0);
  await jobsIO.stop();result.leaseFixture=await jobsIO.expireHeldLease(created.find(row=>row.id==='expired-running'));
  await jobsIO.start('previous',originalPolicy);await observed('previous',originalPolicy);
  for(const row of created){const saved=await jobsIO.read(row);assert.equal(saved.status,200);assert.equal(saved.body.job.state,row.id==='expired-running'?'unknown':row.id);jobs.push({...row,saved:saved.body.job});}
  result.reads=[await retryAll('before-dump')];await jobsIO.stop();
  const before=await snapshot(adapter);assert.ok(before.versions.rogue>=1&&before.versions.character>=1&&before.versions.jobs===4);
  const dump=await adapter.dumpDatabase();assert.match(dump.sha256,/^sha256:[a-f0-9]{64}$/);assert.ok(dump.bytes>0);result.dump={sha256:dump.sha256,bytes:dump.bytes,createdAt:dump.createdAt};
  same(await snapshot(adapter),before);const restored=await adapter.restoreDatabase(dump);assert.equal(restored.sourceRetained,true);assert.equal(restored.markerVerified,true);assert.equal(restored.dumpHash,dump.sha256);assert.match(restored.sourceDatabase,/^test_[a-f0-9]{24}(?:_restored_\d+)?$/);assert.match(restored.restoredDatabase,/^test_[a-f0-9]{24}_restored_\d+$/);assert.notEqual(restored.sourceDatabase,restored.restoredDatabase);result.restore=restored;
  const after=await snapshot(adapter);same(after,before);
  result.snapshot={beforeHash:evidenceHash(before),afterHash:evidenceHash(after),schemaFingerprint:before.schema.schemaFingerprint,migrationCount:before.schema.migrations.length,objectsHash:before.objectsHash,tables:before.rows.length,sequences:before.sequences.length,formats:before.versions};
  await jobsIO.start('previous',originalPolicy);await observed('previous',originalPolicy);result.reads.push(await retryAll('restored-off'));
  await jobsIO.stop();await jobsIO.start('previous',originalPolicy);await observed('previous',originalPolicy);result.reads.push(await retryAll('restored-off-restart'));await jobsIO.stop();
  const final=await snapshot(adapter);same(final,before);result.snapshot.finalHash=evidenceHash(final);assert.ok(result.reads.every(row=>row.responsesHash===result.reads[0].responsesHash));
  result.trace={schemaVersion:1,kind:'writer-compatibility-trace',execution:'docker',outcomeId:'expanded-data-dump-restore',bindingHash:evidenceHash(binding),observations:[{id:'expanded-snapshot',dumpHash:dump.sha256,before:formatSnapshot(before),after:formatSnapshot(after),retryResponseHash:result.reads[0].responsesHash,restoredRetryResponseHash:result.reads[1].responsesHash}]};
  result.status='passed';
 }catch(error){failure=error;}
 finally{try{await adapter.stopApplications();}catch(error){failure??=error;}}
 if(failure)throw failure;return result;
}
