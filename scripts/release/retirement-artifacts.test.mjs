// Synthetic artifact graph only. These fixtures do not certify image execution.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp,readFile,writeFile,rm,realpath,symlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {verifyLocalRetirementArtifacts,localRetirementProgram,retirementProfile,retirementReaderChecks} from './retirement-artifacts.mjs';
import {evidenceHash} from './validate-manifest.mjs';
import {applyNativeLocalRetirement} from './retirement-native-local.mjs';
const hash=b=>'sha256:'+createHash('sha256').update(b).digest('hex'),h=c=>'sha256:'+c.repeat(64);
async function fixture(t){
 const prefix=path.join(os.tmpdir(),'dnd-retirement-graph-'),directory=await mkdtemp(prefix);
 t.after(async()=>{assert.equal(await realpath(directory),directory);assert(directory.startsWith(prefix));await rm(directory,{recursive:true});});
 const previous={schemaVersion:1,releaseId:'previous',releaseCommit:'a'.repeat(40),previousReleaseId:null,createdAt:'2026-10-04T10:00:00Z',components:Object.fromEntries(['frontend','backend','rulesWorker'].map((key,i)=>[key,{sourceCommit:'a'.repeat(40),inputFingerprint:h(String(i+1)),imageDigest:`example.test/${key.toLowerCase()}@${h(String(i+4))}`} ])),rulesArtifactHash:h('a'),contentManifestHash:h('b'),apiProtocolVersion:1,workerProtocolVersion:1,supportedWorldSchemaVersions:[5],workerRuntime:{name:'node',version:'24.0.0'},capabilities:['pinned-artifact-routing','pending-decision-pass-through'],migrationSet:[{id:'001',checksum:h('c')}],validationEvidence:[{gate:'core',status:'passed',reportHash:h('d'),inputFingerprint:h('e'),completedAt:'2026-10-04T10:00:00Z'}]};
 const active={schemaVersion:1,status:'active',manifest:previous,instances:Object.fromEntries(Object.keys(previous.components).map(k=>[k,{releaseId:previous.releaseId,releaseCommit:previous.releaseCommit}]))};
 const manifest=structuredClone(previous);manifest.releaseId='candidate';manifest.releaseCommit='b'.repeat(40);manifest.previousReleaseId=previous.releaseId;
 const candidate={status:'candidate-only',deployable:false,manifest,provenance:{sourceCommit:manifest.releaseCommit,manifestHash:evidenceHash(manifest)}};
 const preimages=Object.fromEntries(['characters','characters_v2','retired_inventories','retired_items'].map(n=>[n,{rows:0,sha256:hash('')}])) ,retained={characters_v3:{rows:1,sha256:h('1')}};
 const archive={schemaVersion:1,kind:'retired-character-generations-row-archive',sourceDumpHash:hash('synthetic dump only'),sourceCapture:'unit-fixture-no-production',preimages,rows:Object.fromEntries(Object.keys(preimages).map(n=>[n,[]]))};
 const values={sql:await readFile(new URL('../../backend/migrations/data/retire-legacy-characters-301.sql',import.meta.url)),dump:Buffer.from('synthetic dump only'),archive,archiveRestore:{status:'passed',scope:'local-real-retired-row-archive-restore',sourceDumpHash:archive.sourceDumpHash,archiveHash:null,preimages,allRetainedTables:retained},retainedBefore:retained,retainedAfter:structuredClone(retained),candidate,active};
 const bundle={schemaVersion:1,kind:'local-retirement-artifact-bundle',profileId:retirementProfile.id,mode:retirementProfile.mode,fingerprintTimezone:'UTC',productionReady:false,artifacts:{}};
 const save=async kind=>{const bytes=Buffer.isBuffer(values[kind])?values[kind]:Buffer.from(JSON.stringify(values[kind])+'\n');const file=kind+'.fixture';await writeFile(path.join(directory,file),bytes);bundle.artifacts[kind]={path:file,bytes:bytes.length,sha256:hash(bytes)};};
 await save('archive');values.archiveRestore.archiveHash=bundle.artifacts.archive.sha256;await save('archiveRestore');
 values.retirementProof={status:'passed',scope:'local-complete-owned-snapshot-retired-archive-and-retirement-rehearsal',sourceCapture:archive.sourceCapture,cleanup:{status:'stopped',errors:[]},productionChanges:0,actualArchiveRestoreProven:true,retirementOnOwnedSnapshotProven:true,sourceDumpUnchanged:true,sqlSourceUnchanged:true,helperSourceUnchanged:true,sourceDumpHash:archive.sourceDumpHash,sqlSourceHash:retirementProfile.sqlSourceHash,archiveHash:bundle.artifacts.archive.sha256,archiveBytes:bundle.artifacts.archive.bytes,archiveRestoreReportHash:bundle.artifacts.archiveRestore.sha256,preimages,retainedTableCount:1,priorMigrationCount:1,checks:['complete-source-restored-on-owned-native-postgres','exact-retired-row-archive-created-under-private-acl','actual-private-archive-restored-with-identical-full-row-preimages','all-retained-table-row-fingerprints-preserved-during-archive-restore','all-existing-migration-ledger-rows-retained-exactly','real-owned-retirement-preserves-all-retained-table-full-row-fingerprints','same-request-retry-retains-identical-journal-receipt']};
 const imagesFor=m=>({images:Object.fromEntries(Object.entries(m.components).map(([k,c])=>[k,c.imageDigest])),identities:Object.fromEntries(Object.entries(m.components).map(([k,c])=>[k,{identitySchemaVersion:1,component:k,provenance:'baked',sourceCommit:c.sourceCommit,source_commit:c.sourceCommit,inputFingerprint:c.inputFingerprint,releaseId:m.releaseId,releaseCommit:m.releaseCommit,apiProtocolVersion:1,...k==='rulesWorker'?{artifactHash:m.rulesArtifactHash,workerRuntime:m.workerRuntime,workerProtocolVersion:1,supportedWorldSchemaVersions:[5],capabilities:m.capabilities}:{}}]))});
 values.readerPair={schemaVersion:1,kind:'local-actual-image-readers-after-retirement',status:'passed',cleanup:{status:'stopped',errors:[]},productionChanges:0,paidProviderRequests:0,localOnly:true,deployable:false,actualImageReadersProven:true,actualApplicationRollbackPairAccepted:false,releaseProtocolIntegrated:false,originalSourceUnchanged:true,sqlSourceUnchanged:true,helperSourceUnchanged:true,fingerprintTimezone:'UTC',sourceDumpHash:archive.sourceDumpHash,sqlSourceHash:retirementProfile.sqlSourceHash,archiveRestoreReportHash:bundle.artifacts.archiveRestore.sha256,checks:retirementReaderChecks.map(([generation,id])=>({generation:generation??undefined,id,status:'passed',...id==='image-contract'?imagesFor(generation==='candidate'?manifest:previous):{}}))};
 const saveBundle=()=>writeFile(path.join(directory,'retirement-bundle.json'),JSON.stringify(bundle)+'\n');
 for(const kind of Object.keys(values))await save(kind);await saveBundle();return {directory,values,bundle,save,saveBundle};
}
test('complete graph binds actual file bytes and produces a frozen local-only request',async t=>{const f=await fixture(t),plan=await verifyLocalRetirementArtifacts(f.directory);assert.equal(plan.productionReady,false);assert.equal(plan.productionExecutionSupported,false);assert.equal(plan.request.acceptedRollbackPairHash,f.bundle.artifacts.readerPair.sha256);assert(Object.isFrozen(plan.request.preimages.characters));assert((await localRetirementProgram(plan)).includes(plan.request.acceptedRollbackPairHash));await assert.rejects(localRetirementProgram(structuredClone(plan)),/Live verified/);});
const mutations=[
 ['production cannot be enabled by changing a bundle flag',f=>{f.bundle.productionReady=true;}],
 ['a production profile is never treated as local ownership',f=>{f.bundle.mode='production';}],
 ['unknown artifact category is refused',f=>{f.bundle.artifacts.unreviewed={...f.bundle.artifacts.sql,path:'extra'};}],
 ['missing dump cannot be replaced by a syntactically valid hash',f=>{delete f.bundle.artifacts.dump;}],
 ['path traversal is refused',f=>{f.bundle.artifacts.sql.path='../sql.fixture';}],
 ['absolute artifact paths are refused',f=>{f.bundle.artifacts.sql.path=path.join(f.directory,'sql.fixture');}],
 ['aliasing different artifacts onto one file is refused',f=>{f.bundle.artifacts.active={...f.bundle.artifacts.candidate};}],
 ['SQL byte edits cannot be legitimized by updating only the descriptor',async f=>{f.values.sql=Buffer.from('SELECT 1;');await f.save('sql');}],
 ['tampered archive rows remain bound to the real restore result',async f=>{f.values.archive.rows.characters.push({id:9});await f.save('archive');}],
 ['another backup source is refused even with a valid hash format',async f=>{f.values.archiveRestore.sourceDumpHash=h('f');await f.save('archiveRestore');}],
 ['retained row mutation is refused',async f=>{f.values.retainedAfter.characters_v3.sha256=h('2');await f.save('retainedAfter');}],
 ['failed native retirement cannot acquire passing status from the reader pair',async f=>{f.values.retirementProof.status='failed';await f.save('retirementProof');}],
 ['unproven archive restore blocks a reader-only proof',async f=>{f.values.retirementProof.actualArchiveRestoreProven=false;await f.save('retirementProof');}],
 ['missing retirement scenario is refused',async f=>{f.values.retirementProof.checks.pop();await f.save('retirementProof');}],
 ['missing cleanup prevents acceptance',async f=>{f.values.readerPair.cleanup.errors.push('not-stopped');await f.save('readerPair');}],
 ['a missing old-reader continuation cannot be substituted with health',async f=>{f.values.readerPair.checks.splice(9,1);await f.save('readerPair');}],
 ['baked image provenance is required on the rollback generation',async f=>{f.values.readerPair.checks.find(c=>c.generation==='rollback'&&c.id==='image-contract').identities.backend.provenance='runtime';await f.save('readerPair');}],
 ['a different digest in an otherwise passing image check is refused',async f=>{f.values.readerPair.checks[0].images.backend='example.test/backend@'+h('e');await f.save('readerPair');}],
 ['the writer report cannot claim paid provider activity',async f=>{f.values.readerPair.paidProviderRequests=1;await f.save('readerPair');}],
 ['unknown row preimage keys are refused',async f=>{f.values.retirementProof.preimages.unreviewed={rows:0,sha256:h('e')};await f.save('retirementProof');}],
];
for(const [name,mutate]of mutations)test(name,async t=>{const f=await fixture(t);await mutate(f);await f.saveBundle();await assert.rejects(verifyLocalRetirementArtifacts(f.directory),/verification refused/);});
test('a parent directory junction cannot redirect an artifact outside its declared regular path',async t=>{const f=await fixture(t);await symlink(f.directory,path.join(f.directory,'alias'),process.platform==='win32'?'junction':'dir');f.bundle.artifacts.sql.path='alias/sql.fixture';await f.saveBundle();await assert.rejects(verifyLocalRetirementArtifacts(f.directory),/verification refused/);});
test('changed bytes after verification refuse preparation of executable SQL',async t=>{const f=await fixture(t),plan=await verifyLocalRetirementArtifacts(f.directory);await writeFile(path.join(f.directory,f.bundle.artifacts.dump.path),'new dump');await assert.rejects(localRetirementProgram(plan));});
test('a serialized plan cannot reach any database adapter',async t=>{const f=await fixture(t),plan=await verifyLocalRetirementArtifacts(f.directory);let calls=0;await assert.rejects(applyNativeLocalRetirement(structuredClone(plan),{database:{query(){calls++;throw Error('Unexpected query');}}}),/Live verified/);assert.equal(calls,0);});
test('an artifact directory cannot become a database target by presenting a loopback-looking DSN',async t=>{const f=await fixture(t),plan=await verifyLocalRetirementArtifacts(f.directory);let calls=0;await assert.rejects(applyNativeLocalRetirement(plan,{registry:{directory:f.directory},database:{dsn:'postgres://test_runner@127.0.0.1:5432/test_fake?sslmode=disable',query(){calls++;throw Error('Unexpected query');}}}));assert.equal(calls,0);});
