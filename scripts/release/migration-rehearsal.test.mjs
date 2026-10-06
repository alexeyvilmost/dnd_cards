import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runMigrationRehearsal,validateMigrationRehearsal,createMigrationDockerAdapter} from './migration-rehearsal.mjs';
import {evidenceHash} from './validate-manifest.mjs';
import {migrationScenarios,retiredObservedMigrationIds,assertExecutableMigrationRegistry} from './migration-transition.mjs';
const hash=c=>`sha256:${c.repeat(64)}`;
function fixture(fault,{retired=false}={}){
  const baseline=[{id:'001',checksum:hash('1')}],added=['298_compact_command_receipts','299_frozen_combat_catalogs','300_image_jobs','301_character_lifecycle'].map(id=>({id,checksum:hash('2')}));
  if(retired)baseline.push(...retiredObservedMigrationIds.map(id=>({id,kind:'observed-id-only',observationHash:hash('8')})));
  const manifest={schemaVersion:1,releaseId:'candidate',releaseCommit:'a'.repeat(40),previousReleaseId:'old',createdAt:'2026-10-04T10:00:00Z',
    components:Object.fromEntries(['backend','frontend','rulesWorker'].map(key=>[key,{sourceCommit:'a'.repeat(40),inputFingerprint:hash('3'),imageDigest:`example.test/${key.toLowerCase()}@${hash('4')}`} ])),
    rulesArtifactHash:hash('5'),contentManifestHash:hash('6'),apiProtocolVersion:1,workerProtocolVersion:1,supportedWorldSchemaVersions:[5],workerRuntime:{name:'node',version:'24.19.0'},capabilities:['pinned-artifact-routing','pending-decision-pass-through'],migrationSet:[...baseline,...added],
    validationEvidence:[{gate:'core',status:'passed',reportHash:hash('7'),inputFingerprint:hash('8'),completedAt:'2026-10-04T10:00:00Z'}]};
  const input={manifest,active:{manifest:{...manifest,migrationSet:baseline}},candidateHash:hash('9')};
  const fresh=()=>({versions:baseline.map(row=>row.id),historyHash:hash('a'),corrupt:false});
  const dbs=new Map([['main',fresh()]]),calls=[];let next=0;
  const metadata={schemaVersion:1,versions:manifest.migrationSet.map(row=>row.id).filter(id=>!retiredObservedMigrationIds.includes(id)),retiredObservedMigrationIds:[...retiredObservedMigrationIds],additiveMigrations:added,migrationLockId:'4921942476843869267',build:{provenance:'baked',sourceCommit:manifest.components.backend.sourceCommit,inputFingerprint:manifest.components.backend.inputFingerprint}};
  const adapter={execution:'docker',
    async preflight(){if(fault==='metadata')return {...metadata,migrationLockId:null};return metadata;},
    async createTrial(){const id=`trial${++next}`;dbs.set(id,fresh());calls.push(['create',id]);return id;},
    async snapshot(id){const s=dbs.get(id);return {versions:[...s.versions],historyHash:s.historyHash,schemaHash:evidenceHash({versions:s.versions,corrupt:s.corrupt})};},
    async execute(id,request,{inspectOnly=false}={}){
      calls.push(['execute',id,inspectOnly]);const s=dbs.get(id);
      if(s.versions.includes('999')&&fault!=='unknown')throw Error('unknown migration');
      if(s.corrupt&&fault!=='schema')throw Error('tampered trigger');
      const n=manifest.migrationSet.length-s.versions.length;
      if(inspectOnly&&n>0)throw Error('missing target');
      s.versions=manifest.migrationSet.map(row=>row.id);
      if(fault==='history'&&id==='trial1')s.historyHash=hash('b');
      const applied=Array.from({length:Math.max(fault==='repeat'&&n===0&&!inspectOnly?1:n,0)},(_,i)=>`migration${i}`);
      return {schemaVersion:1,status:'verified',build:{...metadata.build},result:{status:'verified',releaseId:request.releaseId,schemaProofHash:hash('c'),observedVersions:[...s.versions],applied,rollbackReadersSafe:true}};
    },
    async beginBlocked(db,request,kind){calls.push(['block',db,kind]);return {db,request,kind};},
    async observeBlocked(h){return {stage:h.kind==='ledger'?'ledger-insert':'migration-lock',candidateConnections:fault==='connections'?2:1,advisorySameSession:fault!=='same-session',ddlSameSession:true};},
    async kill(h){calls.push(['kill',h.db]);if(fault==='rollback')dbs.get(h.db).versions.push('298_compact_command_receipts');},
    async release(h){calls.push(['release',h.db]);},
    async finish(h){return adapter.execute(h.db,h.request);},
    async mutate(id,mode){calls.push(['mutate',id,mode]);if(mode==='unknown-ledger')dbs.get(id).versions.push('999');else dbs.get(id).corrupt=true;},
    async dropTrial(id){calls.push(['drop',id]);if(fault==='cleanup')throw Error('cleanup');dbs.delete(id);},
    async startPrevious(){calls.push(['old-start']);},async stopApplications(){calls.push(['old-stop']);},
    async oldReadProof(){if(fault==='old-history')dbs.get('main').historyHash=hash('b');return {status:'passed',checked:fault!=='old-proof',pendingHash:hash('d'),acceptedHash:hash('e'),invariantHash:hash('f')};},
  };
  return {input,adapter,dbs,calls,metadata};
}
test('all seven scenarios bind exact candidate, clean trial state and old-reader proof before approval',async()=>{
  const f=fixture(),result=await runMigrationRehearsal(f.input,f.adapter);validateMigrationRehearsal(f.input,result);
  assert.deepEqual(result.report.checks.map(row=>row.id),migrationScenarios);assert.equal(result.approval.reportHash,evidenceHash(result.report));
  assert.deepEqual([...f.dbs.keys()],['main']);assert.deepEqual(f.calls.filter(row=>row[0]==='kill').map(row=>row[1]),['trial2']);
  assert.ok(f.calls.findIndex(row=>row[0]==='old-start')>f.calls.findIndex(row=>row[0]==='mutate'&&row[2]==='trigger-when-false'));
  for(const mutate of [r=>{r.report.execution='fixture';},r=>{r.report.checks.pop();},r=>{r.report.candidateHash=hash('0');},r=>{r.report.checks[1].transactionRolledBack=false;},r=>{r.report.cleanup.remaining=1;}]){
    const bad=structuredClone(result);mutate(bad);bad.approval.reportHash=evidenceHash(bad.report);assert.throws(()=>validateMigrationRehearsal(f.input,bad));
  }
});
test('actual executable metadata excludes retained ledger IDs while the rehearsal preserves them',async()=>{
 const f=fixture(undefined,{retired:true});assert.equal(f.input.manifest.migrationSet.length-f.metadata.versions.length,4);
 const result=await runMigrationRehearsal(f.input,f.adapter);validateMigrationRehearsal(f.input,result);
 const target=f.input.manifest.migrationSet,before=f.input.active.manifest.migrationSet;
 for(const patch of [m=>{delete m.retiredObservedMigrationIds;},m=>{m.retiredObservedMigrationIds.push('unknown');},m=>{m.versions.push('unknown');}]){const bad=structuredClone(f.metadata);patch(bad);assert.throws(()=>assertExecutableMigrationRegistry(bad,target,before));}
 assert.throws(()=>assertExecutableMigrationRegistry(f.metadata,target,before.filter(row=>row.id!==retiredObservedMigrationIds[0])));
 assert.throws(()=>assertExecutableMigrationRegistry(f.metadata,[...target,{id:'012_unknown',kind:'observed-id-only',observationHash:hash('8')}],[...before,{id:'012_unknown'}]));
});
for(const fault of ['metadata','history','connections','same-session','rollback','repeat','unknown','schema','old-history','old-proof','cleanup'])test(`migration rehearsal fails closed on ${fault} and never returns an approval`,async()=>{
  const f=fixture(fault);await assert.rejects(runMigrationRehearsal(f.input,f.adapter));
  if(fault!=='cleanup')assert.deepEqual([...f.dbs.keys()],['main']);
});
test('prepared Docker boundary confines mutation to owned trials and keeps source DSN out of argv',async()=>{
  const f=fixture(),run='rehearsal_fixture',names={postgres:'owned_pg',network:'owned_net'},calls=[],envs=[];
  const command=async(args,options={})=>{
    calls.push({args,options});
    if(args[0]==='container'&&args[1]==='inspect')return JSON.stringify([{Config:{Labels:{'bagofholding.rehearsal':run}},State:{Running:true},NetworkSettings:{Networks:{owned_net:{}}}}]);
    if(args[0]==='network')return JSON.stringify([{Internal:true,Labels:{'bagofholding.rehearsal':run}}]);
    if(args[0]==='run')return JSON.stringify(f.metadata);
    if(args[0]==='exec'&&options.input?.includes('FROM pg_tables'))return '[]';
    if(args[0]==='start')return JSON.stringify(await f.adapter.execute('main',{releaseId:'candidate'}));
    return '';
  };
  const adapter=createMigrationDockerAdapter({command,resource:async(kind,name,args)=>command(args),envFile:async(name,values)=>{envs.push(values);return `/private/${name}.env`;},names,run,label:`bagofholding.rehearsal=${run}`,secrets:{database:'secret'},startPrevious:async()=>{},stopApplications:async()=>{},oldReadProof:async()=>{}});
  await adapter.preflight(f.input);
  await assert.rejects(adapter.mutate('main','unknown-ledger'),/forbidden/);await assert.rejects(adapter.dropTrial('foreign'),/owned/);
  const db=await adapter.createTrial();assert.match(db,/^migration_[a-f0-9]{24}$/);
  await adapter.execute(db,{releaseId:'candidate'});assert.match(envs[0].DATABASE_URL,new RegExp(`/${db}\\?sslmode=disable&application_name=migration_`));
  assert.ok(!JSON.stringify(calls.map(call=>call.args)).includes('secret'));assert.ok(calls.some(call=>call.args[0]==='create'&&call.args.includes('--read-only')));
  await adapter.mutate(db,'unknown-ledger');await adapter.dropTrial(db);
  const mutations=calls.filter(call=>call.args[0]==='exec'&&/INSERT|DROP DATABASE|CREATE DATABASE/.test(call.options.input??''));
  assert.ok(mutations.length===3);assert.ok(mutations.every(call=>['postgres',db].includes(call.args.at(-1))));
});

test('migration failure preserves private cause but exposes only the fixed failing scenario',async()=>{
 const f=fixture(),secret='PRIVATE_MIGRATION_CANARY',cause=Error(secret);f.adapter.execute=async()=>{throw cause;};
 await assert.rejects(runMigrationRehearsal(f.input,f.adapter),error=>{assert.equal(error.cause,cause);assert.equal(error.migrationReport.failureStage,'atomic-ddl-ledger');assert.ok(!JSON.stringify(error.migrationReport).includes(secret));return true;});
 assert.deepEqual([...f.dbs.keys()],['main']);
});

test('holder readiness parses PostgreSQL JSON booleans before starting the blocked candidate',async()=>{
 const f=fixture(),run='rehearsal_scalar',names={postgres:'owned_pg',network:'owned_net'},sql=[];let releaseHolder,created=0;
 const holder=new Promise(resolve=>{releaseHolder=resolve;});
 const command=async(args,options={})=>{
  if(args[0]==='container'&&args[1]==='inspect')return JSON.stringify([{Config:{Labels:{'bagofholding.rehearsal':run}},State:{Running:true},NetworkSettings:{Networks:{owned_net:{}}}}]);
  if(args[0]==='network')return JSON.stringify([{Internal:true,Labels:{'bagofholding.rehearsal':run}}]);
  if(args[0]==='run')return JSON.stringify(f.metadata);
  if(args[0]==='exec'){
   const text=options.input??'';sql.push(text);
   if(text.includes('FROM pg_tables'))return '[]';
   if(text.includes('SELECT pg_sleep'))return holder;
   if(text.startsWith('SELECT EXISTS'))return 't'; // actual psql scalar encoding is not JSON
   if(text.startsWith('SELECT to_json(EXISTS'))return 'true';
   if(text.includes('pg_terminate_backend')){releaseHolder('');return 't';}
  }
  if(args[0]==='create')created++;
  if(args[0]==='start')return JSON.stringify(await f.adapter.execute('main',{releaseId:'candidate'}));
  return '';
 };
 const adapter=createMigrationDockerAdapter({command,resource:async(kind,name,args)=>command(args),envFile:async()=>'/private/env',names,run,label:`bagofholding.rehearsal=${run}`,secrets:{database:'placeholder'},startPrevious:async()=>{},stopApplications:async()=>{},oldReadProof:async()=>{}});
 await adapter.preflight(f.input);const db=await adapter.createTrial();const handle=await adapter.beginBlocked(db,{releaseId:'candidate'},'ledger',f.metadata.migrationLockId);
 assert.equal(created,1);assert.equal(sql.filter(s=>s.startsWith('SELECT to_json(EXISTS')).length,1);await adapter.release(handle);await adapter.finish(handle);await adapter.dropTrial(db);
});
