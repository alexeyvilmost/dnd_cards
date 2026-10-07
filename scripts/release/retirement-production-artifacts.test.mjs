// Synthetic binding metadata, not real archive/image execution or approval.
import {test} from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';import os from 'node:os';
import {retirementExecutionUnitFixture,retirementUnitHash as h} from './retirement-state-unit-fixture.mjs';
import {mkdtemp,writeFile,chmod,symlink,rm,realpath} from 'node:fs/promises';
import {evidenceHash} from './validate-manifest.mjs';
import {assertProductionRetirementBinding,verifyProductionRetirementArtifacts,assertPrivateRetirementDirectory,readPrivateRetirementJSON} from './retirement-production-artifacts.mjs';
import {assertRetirementHostPaths,main as hostMain} from './retirement-host.mjs';
const now=Date.parse('2026-10-07T14:00:00Z');
function fixture() {
  const f=retirementExecutionUnitFixture();f.request.releaseId='retirement302-synthetic';f.active.manifest=structuredClone(f.executorManifest);
  f.active.instances=Object.fromEntries(Object.keys(f.active.manifest.components).map(k=>[k,{releaseId:f.active.manifest.releaseId,releaseCommit:f.active.manifest.releaseCommit}]));
  const backend=f.active.manifest.components.backend;
  const imageExecution={status:'passed',sourceCommit:backend.sourceCommit,inputFingerprint:backend.inputFingerprint,localDiagnosticBinary:false,publishedExecutor:true,receiptHash:h('1'),repeatApplied:0};
  f.plan={productionReady:false,productionExecutionSupported:false,capturedActiveHash:evidenceHash(f.active),capturedSource:f.active.manifest.releaseCommit,candidateSource:f.active.manifest.releaseCommit,
    sqlSourceHash:f.request.sqlSourceHash,request:structuredClone(f.request.retirement),bundleHash:h('2'),expectedCurrentMigrations:f.request.expectedCurrent.map(row=>row.id).sort(),publishedExecutor:{...imageExecution,imageDigest:backend.imageDigest}};
  const dump={path:'database.dump',category:'database',sha256:f.request.retirement.backupHash,bytes:1024};
  f.bundle={schemaVersion:4,artifacts:{capture:{sha256:h('3')},dump}};
  f.capture={activeHash:evidenceHash(f.active),releaseManifestHash:evidenceHash(f.active.manifest),createdAt:new Date(now-60000).toISOString(),files:[dump]};
  f.backup={releaseManifestHash:f.capture.releaseManifestHash,createdAt:f.capture.createdAt,migrations:f.plan.expectedCurrentMigrations,files:[dump]};
  f.pair={actualLinuxExecutor302:imageExecution,additionalChecks:[['previous','actual-browser'],['previous','historical-replay'],['candidate','actual-browser'],['candidate','historical-replay'],['rollback','actual-browser']].map(([generation,id])=>({generation,id,status:'passed',...(id==='actual-browser'?{execution:'docker',browserVersion:'151.0.7922.34',checks:Object.fromEntries(['api-routing','character','equipment','paper','json-export','pdf-export','inventory','combat'].map(key=>[key,{status:'passed'}]))}:{commands:2,combats:1,artifactHashes:[h('4')]})}))};
  f.approval={schemaVersion:1,kind:'character-retirement-302-approval',activeHash:evidenceHash(f.active),bundleHash:f.plan.bundleHash,captureHash:f.bundle.artifacts.capture.sha256,executorManifestHash:evidenceHash(f.executorManifest),requestHash:evidenceHash(f.request),automaticMigration:false};
  f.approvalHash=evidenceHash(f.approval);f.now=now;return f;
}
test('installed state, original request and separate local-only evidence bind without manufacturing an executable capability',()=>{
  const f=fixture();assert.equal(assertProductionRetirementBinding(f),undefined);assert.equal(f.plan.productionReady,false);assert.equal(f.plan.productionExecutionSupported,false);
});
test('another archived row set uses the same protocol without name or ID branches',()=>{
  const f=fixture();f.request.retirement.preimages.characters.rows=19;f.request.retirement.preimages.characters.sha256=h('5');
  f.plan.request=structuredClone(f.request.retirement);f.approval.requestHash=evidenceHash(f.request);f.approvalHash=evidenceHash(f.approval);
  assert.equal(assertProductionRetirementBinding(f),undefined);
});
for(const [name,mutate] of [
  ['older bundle without actual installed capture',f=>{f.bundle.schemaVersion=3;}],
  ['changed live composition after local verification',f=>{f.active.instances.frontend.releaseCommit='c'.repeat(40);}],
  ['another current database proof',f=>{f.active.database.schemaProofHash=h('6');}],
  ['different published executor image',f=>{f.plan.publishedExecutor.imageDigest='example.test/backend@'+h('7');}],
  ['native overlay presented as published execution',f=>{f.plan.publishedExecutor.localDiagnosticBinary=true;}],
  ['a missing published executor',f=>{delete f.plan.publishedExecutor;}],
  ['different archive preimage with recomputed request approval',f=>{f.request.retirement.preimages.characters.rows++;f.approval.requestHash=evidenceHash(f.request);f.approvalHash=evidenceHash(f.approval);} ],
  ['another ordinary migration',f=>{f.request.expectedCurrent.push({id:'unreviewed',checksum:h('8')});}],
  ['automatic migration flag',f=>{f.approval.automaticMigration=true;f.approvalHash=evidenceHash(f.approval);} ],
  ['local readiness flag substituted for acceptance',f=>{f.plan.productionReady=true;}],
  ['changed approval bytes',f=>{f.approval.captureHash=h('9');}],
  ['another approved bundle',f=>{f.approval.bundleHash=h('9');f.approvalHash=evidenceHash(f.approval);} ],
  ['another backup version',f=>{f.backup.files=[{...f.backup.files[0],sha256:h('9')}];}],
  ['changed backup timestamp',f=>{f.backup.createdAt=new Date(now).toISOString();}],
  ['expired original capture',f=>{f.capture.createdAt=f.backup.createdAt=new Date(now-30*60000-1).toISOString();}],
  ['future capture date',f=>{f.capture.createdAt=f.backup.createdAt=new Date(now+1).toISOString();}],
  ['a missing rollback browser generation',f=>{f.pair.additionalChecks.pop();}],
  ['missing JSON export in the real browser proof',f=>{delete f.pair.additionalChecks[0].checks['json-export'];}],
  ['UI mock substituted for actual browser execution',f=>{f.pair.additionalChecks[0].execution='simulation';}],
  ['failed browser scenario',f=>{f.pair.additionalChecks[2].checks.equipment.status='failed';}],
  ['empty historical corpus',f=>{f.pair.additionalChecks[1].commands=0;}],
  ['unbounded historical artifact identifier',f=>{f.pair.additionalChecks[3].artifactHashes=['latest'];}],
])test('production binding refuses '+name,()=>{const f=fixture();mutate(f);assert.throws(()=>assertProductionRetirementBinding(f));});
test('bounded age applies to original capture rather than verification completion',()=>{
  const f=fixture();f.capture.createdAt=f.backup.createdAt=new Date(now-30*60000).toISOString();assert.doesNotThrow(()=>assertProductionRetirementBinding(f));f.now++;assert.throws(()=>assertProductionRetirementBinding(f));
});
test('host paths require one named retirement and one protected capture without traversal',()=>{
  const root=path.resolve(os.tmpdir(),'retirement-unit-host'),config={root},releaseId='retirement302-example';
  const directory=path.join(root,'retirements',releaseId),backup=path.join(root,'backups','capture-example');assert.doesNotThrow(()=>assertRetirementHostPaths(config,directory,backup,releaseId));
  for(const [d,b,id]of [[path.join(root,'elsewhere',releaseId),backup,releaseId],[directory,path.join(root,'backups'),releaseId],[directory,backup,'different'],[directory,'relative',releaseId]])assert.throws(()=>assertRetirementHostPaths(config,d,b,id));
});
test('host command has no default, startup, ordinary deploy or implicit execution mode',async()=>{
  for(const args of [[],['apply'],['inspect'],['apply','--production']])await assert.rejects(hostMain(args));
});
test('unsupported host or nonexistent private files cannot be replaced by serialized metadata',async()=>{
  await assert.rejects(verifyProductionRetirementArtifacts({directory:path.join(os.tmpdir(),'not-a-real-retirement-proof'),backupDirectory:path.join(os.tmpdir(),'not-a-real-capture')}),/artifacts refused/);
});
test('native private files are enforced on Linux and unsupported Windows ACL semantics are refused',async t=>{
  const prefix=path.join(os.tmpdir(),'retirement-private-files-'),directory=await mkdtemp(prefix);
  t.after(async()=>{assert.equal(await realpath(directory),directory);assert(directory.startsWith(prefix));await rm(directory,{recursive:true});});
  const file=path.join(directory,'owned.json');await writeFile(file,'{"owned":true}',{mode:0o600});
  if(process.platform!=='linux') {await assert.rejects(assertPrivateRetirementDirectory(directory));await assert.rejects(readPrivateRetirementJSON(file));return;}
  await assertPrivateRetirementDirectory(directory);assert.deepEqual(await readPrivateRetirementJSON(file),{owned:true});
  await chmod(file,0o640);await assert.rejects(readPrivateRetirementJSON(file));await chmod(file,0o600);
  await assert.rejects(readPrivateRetirementJSON(file,{maximumBytes:1}));await assert.rejects(readPrivateRetirementJSON(directory));
  const alias=path.join(directory,'alias.json');await symlink(file,alias);await assert.rejects(readPrivateRetirementJSON(alias));
  await chmod(directory,0o755);await assert.rejects(assertPrivateRetirementDirectory(directory));await chmod(directory,0o700);
});
