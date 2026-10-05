import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, readFileSync, rmSync,mkdirSync,unlinkSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {compositionFingerprint, evidenceHash} from './validate-manifest.mjs';
import {planDeployment, deploy, recover, createDeploymentStore, deploymentEnvironment, deploymentRetention} from './deploy-state.mjs';
import {databaseMigrationSet, migrationScenarios} from './migration-transition.mjs';
import {releaseApplicationState, assertExpansionWritersOff} from './docker-deployment.mjs';
import {attachUnitRehearsal} from './unit-rehearsal-fixture.mjs';
import {isLegacyBaseline,baselineDocument} from './legacy-baseline.mjs';
const hash = char => `sha256:${char.repeat(64)}`;
function scenario(t, changed = ['frontend']) {
  const directory = mkdtempSync(path.join(tmpdir(), 'deploy-state-'));
  t.after(() => {assert.equal(path.dirname(directory), path.resolve(tmpdir())); assert.ok(path.basename(directory).startsWith('deploy-state-')); rmSync(directory, {recursive: true, force: true});});
  const old = {schemaVersion: 1, releaseId: 'old', releaseCommit: 'a'.repeat(40), previousReleaseId: null, createdAt: '2026-10-04T10:00:00Z',
    components: Object.fromEntries(['frontend', 'backend', 'rulesWorker'].map((key, i) => [key, {sourceCommit: 'a'.repeat(40), inputFingerprint: hash(String(i + 1)), imageDigest: `example.test/${key.toLowerCase()}@${hash(String(i + 4))}`} ])),
    rulesArtifactHash: hash('a'), contentManifestHash: hash('b'), apiProtocolVersion: 1, workerProtocolVersion: 1, supportedWorldSchemaVersions: [5],
    workerRuntime: {name: 'node', version: '20.20.0'}, capabilities: ['pinned-artifact-routing', 'pending-decision-pass-through'], migrationSet: [{id: '001', checksum: hash('c')}],
    validationEvidence: [{gate: 'core', status: 'passed', reportHash: hash('d'), inputFingerprint: hash('e'), completedAt: '2026-10-04T10:00:00Z'}]};
  const active = {schemaVersion: 1, status: 'active', manifest: old, instances: Object.fromEntries(Object.keys(old.components).map(key => [key, {releaseId: old.releaseId, releaseCommit: old.releaseCommit}]))};
  const candidate = structuredClone(old); candidate.releaseId = 'next'; candidate.releaseCommit = 'b'.repeat(40); candidate.previousReleaseId = 'old';
  for (const key of changed) Object.assign(candidate.components[key], {sourceCommit: 'b'.repeat(40), inputFingerprint: hash('f'), imageDigest: `example.test/${key.toLowerCase()}@${hash('f')}`});
  const fingerprint = compositionFingerprint(candidate);
  const reports = Object.fromEntries(['core', 'image-contract', 'pinned-artifacts'].map(gate => [gate, {status: 'passed', compositionFingerprint: fingerprint,
    ...(gate === 'pinned-artifacts' ? {workerRuntime: old.workerRuntime, artifactHashes: [old.rulesArtifactHash], pendingDecisionChecked: true} : {})}]));
  candidate.validationEvidence = Object.entries(reports).map(([gate, report]) => ({gate, status: 'passed', reportHash: evidenceHash(report), inputFingerprint: fingerprint, completedAt: candidate.createdAt}));
  function observation(state) {
    const services = Object.fromEntries(Object.entries(state.manifest.components).map(([key, component]) => [key, {healthy: true, imageDigest: component.imageDigest, identity: {
      component: key, provenance: 'baked', sourceCommit: component.sourceCommit, inputFingerprint: component.inputFingerprint, apiProtocolVersion: 1, identitySchemaVersion: 1,
      ...state.instances[key], ...(key === 'rulesWorker' ? {artifactHash: state.manifest.rulesArtifactHash, workerRuntime: state.manifest.workerRuntime, workerProtocolVersion: 1, supportedWorldSchemaVersions: [5], capabilities: state.manifest.capabilities} : {})}}]));
    return {database: {schemaStatus: 'verified', migrationSet: databaseMigrationSet(state), ...(state.database?{schemaProofHash:state.database.schemaProofHash,oldReadersSafe:true}:{})}, services};
  }
  const isolated = {schemaVersion: 1, status: 'active', manifest: candidate, instances: Object.fromEntries(Object.keys(old.components).map(key => [key, {releaseId: candidate.releaseId, releaseCommit: candidate.releaseCommit}]))};
  const bundle = {reports, previousManifest: old, historicalInventoryComplete: true, historicalArtifactHashes: [old.rulesArtifactHash],
    images: Object.fromEntries(Object.entries(candidate.components).map(([key, value]) => [key, value.imageDigest])), identities: Object.fromEntries(Object.entries(observation(isolated).services).map(([key, value]) => [key, value.identity]))};
  attachUnitRehearsal(candidate, bundle);
  writeFileSync(path.join(directory, 'active.json'), JSON.stringify(active));
  const store = createDeploymentStore(directory), calls = [];
  let live = observation(active);
  const adapter = {
    async assertHistoricalInventory(){return {status:'verified',artifactHashes:[old.rulesArtifactHash]};},
    async observe() {return structuredClone(live);},
    async backup() {calls.push('backup'); return {status: 'verified', manifestHash: evidenceHash(old), restoreDrillPassed: true};},
    async prepare() {calls.push('prepare');},
    async assertDatabase() {calls.push('schema');return structuredClone(live.database);},
    async replace(key, state) {calls.push(`${state.manifest.releaseId}:${key}`); live.services[key] = observation(state).services[key];},
  };
  return {directory, store, candidate, bundle, active, adapter, calls, setLive: value => {live = value;}, getLive:()=>structuredClone(live), observation};
}

test('manual recovery reread is under the existing lock and refusal precedes journal or adapter mutation',async t=>{
  const s=scenario(t),before=readFileSync(path.join(s.directory,'active.json'));
  await assert.rejects(deploy({...s,beforePrepare:async active=>{
    assert.equal(existsSync(path.join(s.directory,'deploy.lock')),true);assert.equal(readFileSync(path.join(s.directory,'deploy.lock','owner.json'),'utf8').includes(String(process.pid)),true);
    assert.deepEqual(active,s.active);assert.equal(s.store.operation(s.candidate.releaseId),null);throw Error('reviewed original no longer live');
  }}),/no longer live/);
  assert.deepEqual(s.calls,[]);assert.deepEqual(readFileSync(path.join(s.directory,'active.json')),before);assert.equal(s.store.operation(s.candidate.releaseId),null);assert.equal(existsSync(path.join(s.directory,'deploy.lock')),false);
});

function refreshEvidence(s){
  const fingerprint=compositionFingerprint(s.candidate);
  for(const report of Object.values(s.bundle.reports))report.compositionFingerprint=fingerprint;
  s.candidate.validationEvidence=s.candidate.validationEvidence.map(row=>({...row,reportHash:evidenceHash(s.bundle.reports[row.gate]),inputFingerprint:fingerprint}));
  attachUnitRehearsal(s.candidate, s.bundle);
  if(s.bundle.reports.additiveMigrations&&s.bundle.migrationApproval){
    s.bundle.migrationApproval.reportHash=evidenceHash(s.bundle.reports.additiveMigrations);
    s.bundle.rehearsalReceipt.additiveMigrations={report:structuredClone(s.bundle.reports.additiveMigrations),approval:structuredClone(s.bundle.migrationApproval)};
    for(const gate of ['image-contract','pinned-artifacts'])s.bundle.reports[gate].rehearsalHash=evidenceHash(s.bundle.rehearsalReceipt);
    for(const row of s.candidate.validationEvidence)row.reportHash=evidenceHash(s.bundle.reports[row.gate]);
  }
}
function additiveScenario(t){
  const s=scenario(t,['backend','frontend']);
  s.candidate.migrationSet.push(...['298_compact_command_receipts','299_frozen_combat_catalogs','300_image_jobs'].map(id=>({id,checksum:hash('e')})));
  refreshEvidence(s);
  const report={status:'passed',candidateSourceCommit:s.candidate.components.backend.sourceCommit,candidateInputFingerprint:s.candidate.components.backend.inputFingerprint,
    baseline:s.active.manifest.migrationSet,target:s.candidate.migrationSet,backwardCompatible:true,rollbackWriters:'off',scenarios:migrationScenarios};
  s.bundle.reports.additiveMigrations=report;
  s.bundle.migrationApproval={schemaVersion:1,mode:'additive-298-300',baseline:report.baseline,target:report.target,compositionFingerprint:compositionFingerprint(s.candidate),reportHash:evidenceHash(report)};
  refreshEvidence(s);
  s.adapter.migrate=async plan=>{
    s.calls.push('migrate');const live=s.getLive();live.database={schemaStatus:'verified',migrationSet:plan.migration.target,schemaProofHash:hash('8'),oldReadersSafe:true};s.setLive(live);
    return {schemaVersion:1,status:'verified',result:{status:'verified',releaseId:plan.desired.manifest.releaseId,schemaProofHash:hash('8'),observedVersions:plan.migration.target.map(row=>row.id).sort(),rollbackReadersSafe:true},
      build:{provenance:'baked',sourceCommit:plan.migration.request.candidateSourceCommit,inputFingerprint:plan.migration.request.candidateInputFingerprint}};
  };
  return s;
}

function legacyAdoptionScenario(t){
 const s=additiveScenario(t),originalObservation=s.observation;
 s.candidate.previousReleaseId=null;s.candidate.migrationSet[0].id='001_existing';
 const body={schemaVersion:1,kind:'observed-legacy-baseline',status:'observed',provenance:'runtime-observation-only',deployable:false,observedAt:new Date().toISOString(),claimedReleaseCommit:'a'.repeat(40),
  components:Object.fromEntries(['frontend','backend','rulesWorker'].map((key,i)=>[key,{containerId:String(i+1).repeat(64),imageReference:`legacy/${key.toLowerCase()}:old`,imageId:hash(String(i+1)),healthy:true,runtimeClaim:'a'.repeat(40),configurationHash:hash('c')} ])),
  rollbackConfigurationHash:hash('1'),databaseIdentityHash:hash('2'),schemaFingerprint:hash('3'),rulesArtifactHash:s.active.manifest.rulesArtifactHash,migrationIds:['001_existing'],artifactHashes:[s.active.manifest.rulesArtifactHash],historicalChecksums:'unavailable',bakedIdentity:'unavailable'};
 s.active={...body,observationHash:evidenceHash(body)};s.bundle.previousManifest=null;s.bundle.legacyBaseline=s.active;
 s.candidate.migrationSet[0]={id:'001_existing',kind:'observed-id-only',observationHash:s.active.observationHash};
 const report=s.bundle.reports.additiveMigrations;report.baseline=[{id:'001_existing'}];report.baselineObservationHash=s.active.observationHash;
 Object.assign(s.bundle.migrationApproval,{baseline:report.baseline,baselineObservationHash:s.active.observationHash,compositionFingerprint:compositionFingerprint(s.candidate)});refreshEvidence(s);
 s.bundle.rehearsalReceipt.activeHash=evidenceHash(s.active);
 for(const gate of ['image-contract','pinned-artifacts'])s.bundle.reports[gate].rehearsalHash=evidenceHash(s.bundle.rehearsalReceipt);
 for(const row of s.candidate.validationEvidence)row.reportHash=evidenceHash(s.bundle.reports[row.gate]);
 const legacyDirectory=path.join(s.directory,'legacy-observation-test');mkdirSync(legacyDirectory);const file=path.join(legacyDirectory,'baseline.json');writeFileSync(file,JSON.stringify(s.active));unlinkSync(path.join(s.directory,'active.json'));
 s.store=createDeploymentStore(s.directory,{legacyBaselineFile:file});
 s.observation=state=>isLegacyBaseline(state)?{database:{schemaStatus:'verified',migrationSet:databaseMigrationSet(state),...(state.database?{schemaProofHash:state.database.schemaProofHash,oldReadersSafe:true}:{})},services:Object.fromEntries(Object.entries(state.components).map(([key,row])=>[key,{healthy:true,imageId:row.imageId,configurationHash:row.configurationHash,runtimeClaim:row.runtimeClaim,...(key==='rulesWorker'?{artifactHash:state.rulesArtifactHash}:{})}]))}:originalObservation(state);
 s.setLive(s.observation(s.active));s.adapter.backup=async()=>({status:'verified',manifestHash:evidenceHash(baselineDocument(s.active)),restoreDrillPassed:true});
 s.adapter.replace=async(key,state)=>{s.calls.push(`${isLegacyBaseline(state)?'legacy':state.manifest.releaseId}:${key}`);const live=s.getLive();live.services[key]=s.observation(state).services[key];s.setLive(live);};
 const migrate=s.adapter.migrate;s.adapter.migrate=async plan=>{assert.equal(plan.migration.request.schemaVersion,2);assert.equal(plan.migration.request.expectedCurrent,undefined);assert.deepEqual(plan.migration.request.expectedCurrentIds,['001_existing']);const result=await migrate(plan);result.result.baselineObservationHash=s.active.observationHash;return result;};return s;
}
test('observed legacy adoption replaces all three components and writes schema1 active only after health',async t=>{
 const s=legacyAdoptionScenario(t);assert.equal(existsSync(path.join(s.directory,'active.json')),false);
 const result=await deploy(s);assert.equal(result.status,'succeeded');assert.deepEqual(result.plan.changed,['rulesWorker','backend','frontend']);
 assert.equal(s.store.active().kind,undefined);assert.equal(s.store.active().status,'active');assert.equal(s.store.active().database.request.schemaVersion,2);
 assert.equal(result.plan.previous.historicalChecksums,'unavailable');assert.equal((await deploy(s)).repeated,true);
});
test('failed first cutover restores exact legacy application and retains truthful expanded DB without active manifest',async t=>{
 const s=legacyAdoptionScenario(t),replace=s.adapter.replace;s.adapter.replace=async(key,state)=>{await replace(key,state);if(!isLegacyBaseline(state)&&key==='backend')throw Error('failed new health');};
 await assert.rejects(deploy(s),/previous compatible/);assert.equal(existsSync(path.join(s.directory,'active.json')),false);
 const active=s.store.active();assert.equal(active.kind,'observed-legacy-baseline');assert.equal(active.database.migrationSet.length,4);assert.equal(active.observationHash,s.active.observationHash);
 assert.deepEqual(s.calls.filter(call=>call.startsWith('legacy:')),['legacy:backend','legacy:rulesWorker']);assert.deepEqual(deploymentRetention([active],[]).legacyImageIds,Object.values(active.components).map(row=>row.imageId).sort());
 assert.equal((await recover({...s,releaseId:s.candidate.releaseId})).repeated,true);
});
test('legacy adoption refuses substituted observation and never treats old runtime claims as baked identities',async t=>{
 const s=legacyAdoptionScenario(t);s.bundle.rehearsalReceipt.activeHash=hash('0');
 assert.throws(()=>planDeployment(s.candidate,s.bundle,s.active));assert.deepEqual(s.calls,[]);
});

test('additive cutover stores the expanded DB separately and completed retry does not rerun migration',async t=>{
  const s=additiveScenario(t);const result=await deploy(s);
  assert.equal(result.status,'succeeded');assert.equal(s.store.active().database.migrationSet.length,4);
  assert.deepEqual(s.calls,['backup','prepare','migrate','backup','next:backend','next:frontend']);
  assert.equal((await deploy(s)).repeated,true);assert.equal(s.calls.filter(call=>call==='migrate').length,1);
  assert.deepEqual(releaseApplicationState(result.plan.previous),releaseApplicationState(result.plan.rollbackState));
});
test('additive rollback retains expanded DB proof, executor image and unchanged historical manifest',async t=>{
  const s=additiveScenario(t),original=s.adapter.replace;
  s.adapter.replace=async(key,state)=>{await original(key,state);if(state.manifest.releaseId==='next'&&key==='frontend')throw Error('candidate health failed');};
  await assert.rejects(deploy(s),/previous compatible/);
  const active=s.store.active();assert.equal(active.manifest.releaseId,'old');assert.deepEqual(active.manifest.migrationSet,s.active.manifest.migrationSet);
  assert.deepEqual(active.database.migrationSet,s.candidate.migrationSet);
  assert.ok(deploymentRetention([active],[]).images.includes(s.candidate.components.backend.imageDigest));
  assert.equal((await recover({...s,releaseId:'next'})).repeated,true);
});
test('lost migration acknowledgement reconciles same request without duplicate cutover or DB rollback',async t=>{
  const s=additiveScenario(t),original=s.adapter.migrate;let first=true;
  s.adapter.migrate=async plan=>{const result=await original(plan);if(first){first=false;throw Object.assign(Error('lost acknowledgement'),{uncertainOutcome:true});}return result;};
  await assert.rejects(deploy(s),/unknown/);assert.equal(s.store.active().database,undefined);
  const recovered=await recover({...s,releaseId:'next'});assert.equal(recovered.status,'rolled_back');
  assert.deepEqual(s.store.active().database.migrationSet,s.candidate.migrationSet);
  assert.deepEqual(s.calls,['backup','prepare','migrate','migrate']);
});
test('recovery before migration intent never starts a migration that preparation did not authorize',async t=>{
  const s=additiveScenario(t);
  s.adapter.prepare=async()=>{throw Object.assign(Error('prepare outcome unknown'),{uncertainOutcome:true});};
  await assert.rejects(deploy(s),/unknown/);assert.equal(s.store.operation('next').migrationStarted,undefined);
  assert.equal((await recover({...s,releaseId:'next'})).status,'rolled_back');
  assert.ok(!s.calls.includes('migrate'));assert.equal(s.store.active().database,undefined);
});
test('new-format writes block old app rollback and leave outcome for inspection',async t=>{
  const s=additiveScenario(t),original=s.adapter.replace;
  s.adapter.replace=async(key,state)=>{await original(key,state);if(state.manifest.releaseId==='next'){const live=s.getLive();live.database.oldReadersSafe=false;s.setLive(live);throw Error('failure after new writer');}};
  await assert.rejects(deploy(s),/Rollback not verified/);assert.equal(s.store.operation('next').status,'recovery_required');
  assert.ok(!s.calls.some(call=>call.startsWith('old:')));
  await assert.rejects(recover({...s,releaseId:'next',rollback:true}),/Old readers/);
});
test('unknown migration, missing rehearsal, changed source and incomplete scenarios fail before adapter calls',async t=>{
  for(const mutate of [s=>{s.bundle.migrationApproval=null;},s=>{s.bundle.reports.additiveMigrations.candidateSourceCommit='c'.repeat(40);},
    s=>{s.bundle.reports.additiveMigrations.scenarios=[];},s=>{s.candidate.migrationSet.push({id:'999_unknown',checksum:hash('e')});refreshEvidence(s);}]){
    const s=additiveScenario(t);mutate(s);await assert.rejects(deploy(s));assert.deepEqual(s.calls,[]);
  }
});
test('completed stale recovery cannot overwrite a later metadata-only release',async t=>{
  const s=scenario(t);await deploy(s);const first=s.store.active();
  s.adapter.backup=async active=>({status:'verified',manifestHash:evidenceHash(active.manifest),restoreDrillPassed:true});
  s.bundle.previousManifest=structuredClone(s.candidate);s.candidate=structuredClone(s.candidate);s.candidate.previousReleaseId='next';s.candidate.releaseId='later';s.candidate.releaseCommit='c'.repeat(40);
  for(const identity of Object.values(s.bundle.identities)){identity.releaseId='later';identity.releaseCommit=s.candidate.releaseCommit;}
  refreshEvidence(s);await deploy(s);assert.equal(s.store.active().manifest.releaseId,'later');
  assert.deepEqual(s.store.active().instances,first.instances);
  await assert.rejects(recover({...s,releaseId:'next'}),/stale recovery/);assert.equal(s.store.active().manifest.releaseId,'later');
});
test('actual backend expansion-writer environment must be disabled',()=>{
  assertExpansionWritersOff(['DB_COMPACT_RECEIPTS=0','IMAGE_JOBS_ENABLED=0']);
  for(const key of ['DB_COMPACT_RECEIPTS','DB_FROZEN_CATALOGS','IMAGE_JOBS_ENABLED'])assert.throws(()=>assertExpansionWritersOff([`${key}=1`]),/writers/);
});
test('an unrehearsed live history reference appearing after preparation blocks cutover',async t=>{
  const s=scenario(t);s.adapter.assertHistoricalInventory=async()=>({status:'verified',artifactHashes:[hash('7')]});
  await assert.rejects(deploy(s),/Fresh live artifact/);assert.equal(s.store.operation('next').status,'failed_before_cutover');
  assert.deepEqual(s.calls,['backup','prepare']);
});
test('backup aging during the full live scan blocks forward cutover and preserves expanded database truth',async t=>{
  for(const expanded of [false,true]){
    const s=expanded?additiveScenario(t):scenario(t),backup=s.adapter.backup;
    let now=0;const createdAt=0,maximumAgeMs=30*60_000;
    s.adapter.backup=async active=>{assert.deepEqual(active,s.active);if(now-createdAt>maximumAgeMs)throw Error('Fresh backup of active release required');return backup(active);};
    s.adapter.assertHistoricalInventory=async()=>{now=maximumAgeMs+1;return {status:'verified',artifactHashes:[s.active.manifest.rulesArtifactHash]};};
    await assert.rejects(deploy(s),/Fresh backup/);
    assert.equal(s.store.operation('next').status,'failed_before_cutover');
    assert.ok(!s.calls.some(call=>call.startsWith('next:')||call.startsWith('old:')));
    assert.equal(s.store.active().manifest.releaseId,'old');
    if(expanded)assert.deepEqual(s.store.active().database.migrationSet,s.candidate.migrationSet);
    else assert.equal(s.store.active().database,undefined);
  }
});
test('fresh backup is reverified after scanning, while later expiration cannot block compatible rollback',async t=>{
  const s=scenario(t,['frontend']),backup=s.adapter.backup,replace=s.adapter.replace;
  let expired=false,verified=0;
  s.adapter.backup=async active=>{if(expired)throw Error('Fresh backup required');verified++;return backup(active);};
  s.adapter.assertHistoricalInventory=async()=>{s.calls.push('history');return {status:'verified',artifactHashes:[s.active.manifest.rulesArtifactHash]};};
  s.adapter.replace=async(key,state)=>{await replace(key,state);if(state.manifest.releaseId==='next'){expired=true;throw Error('candidate health failed after backup expiration');}};
  await assert.rejects(deploy(s),/previous compatible/);
  assert.equal(verified,2);assert.equal(s.store.active().manifest.releaseId,'old');
  assert.deepEqual(s.calls,['backup','prepare','history','backup','next:frontend','schema','history','old:frontend']);
  assert.equal(s.store.operation('next').cutoverBackup.restoreDrillPassed,true);
});

for (const component of ['frontend', 'backend', 'rulesWorker']) test(`${component}-only cutover preserves unchanged instances and repeated command does not restart`, async t => {
  const s = scenario(t, [component]);
  const plan = planDeployment(s.candidate, s.bundle, s.active); assert.deepEqual(plan.changed, [component]);
  const result = await deploy(s); assert.equal(result.status, 'succeeded');
  assert.deepEqual(s.calls, ['backup', 'prepare', 'backup', `next:${component}`]);
  for (const key of Object.keys(s.active.instances)) assert.equal(s.store.active().instances[key].releaseId, key === component ? 'next' : 'old');
  assert.equal((await deploy(s)).repeated, true); assert.equal(s.calls.length, 4);
  const env = deploymentEnvironment(s.store.active());
  assert.equal(env.RELEASE_ID, 'next');assert.equal(env.RELEASE_COMMIT, s.candidate.releaseCommit);
  for(const [key,prefix] of [['backend','BACKEND'],['frontend','FRONTEND'],['rulesWorker','RULES_WORKER']]){
    assert.equal(env[`${prefix}_RELEASE_ID`],key===component?'next':'old');
    assert.equal(env[`${prefix}_RELEASE_COMMIT`],key===component?s.candidate.releaseCommit:s.active.manifest.releaseCommit);
    assert.equal(env[`${prefix}_IMAGE`],s.store.active().manifest.components[key].imageDigest);
  }
});

test('backup, missing evidence, corrupt digest or schema change blocks all replacements', async t => {
  const s = scenario(t);
  for (const change of [c => {c.components.frontend.imageDigest = 'bad:latest';}, c => {c.migrationSet[0].checksum = hash('a');}, c => {c.validationEvidence.pop();}]) {
    const candidate = structuredClone(s.candidate); change(candidate); await assert.rejects(deploy({...s, candidate}));
  }
  assert.deepEqual(s.calls, []);
  s.adapter.backup = async () => ({status: 'verified', restoreDrillPassed: false});
  await assert.rejects(deploy(s), /backup/); assert.equal(s.store.operation('next').status, 'failed_before_cutover');
  await assert.rejects(deploy(s), /inspection/); assert.deepEqual(s.calls, []);
});

test('failed pull keeps baseline; failed final health restores only touched images without DB restore', async t => {
  const s = scenario(t, ['frontend', 'backend']);
  const original = s.adapter.replace;
  s.adapter.replace = async (key, state) => {await original(key, state); if (state.manifest.releaseId === 'next' && key === 'frontend') throw Error('health');};
  await assert.rejects(deploy(s), /previous compatible/);
  assert.equal(s.store.operation('next').status, 'rolled_back'); assert.equal(s.store.active().manifest.releaseId, 'old');
  assert.deepEqual(s.calls, ['backup', 'prepare', 'backup', 'next:backend', 'next:frontend', 'schema', 'old:frontend', 'old:backend']);
  const p = scenario(t); p.adapter.prepare = async () => {throw Error('pull unavailable');};
  await assert.rejects(deploy(p), /pull/); assert.equal(p.store.active().manifest.releaseId, 'old'); assert.deepEqual(p.calls, ['backup']);
});

test('unknown outcome is observed first and repeated deploy never replays cutover', async t => {
  const s = scenario(t), original = s.adapter.replace;
  s.adapter.replace = async (...args) => {await original(...args); throw Object.assign(Error('lost connection'), {uncertainOutcome: true});};
  await assert.rejects(deploy(s), /unknown/); await assert.rejects(deploy(s), /inspection/);
  await assert.rejects(deploy({...s, candidate: {...s.candidate, releaseId: 'other'}}), /Another release/);
  assert.equal(s.store.operation('next').status, 'recovery_required');
  const before = [...s.calls]; assert.equal((await recover({...s, releaseId: 'next'})).status, 'succeeded'); assert.deepEqual(s.calls, before);
});

test('mixed interrupted delivery requires explicit rollback and another candidate cannot lose baseline changes', async t => {
  const s = scenario(t, ['backend', 'frontend']), original = s.adapter.replace;
  s.adapter.replace = async (...args) => {await original(...args); throw Object.assign(Error('interrupted'), {uncertainOutcome: true});};
  await assert.rejects(deploy(s)); await assert.rejects(recover({...s, releaseId: 'next'}), /Mixed/);
  s.adapter.replace = original;
  assert.equal((await recover({...s, releaseId: 'next', rollback: true})).status, 'rolled_back');
  const second = structuredClone(s.candidate); second.releaseId = 'next-2';
  // Binding a new candidate to a failed predecessor must not treat it as active.
  second.previousReleaseId = 'next'; await assert.rejects(deploy({...s, candidate: second}), /Predecessor|actually active/);
  assert.equal(s.store.active().manifest.releaseId, 'old');
});

test('one owner lock serializes requests; retention protects old shared images and artifacts without deletion', t => {
  const s = scenario(t), release = s.store.lock();
  try {assert.throws(() => s.store.lock(), /lock exists/);} finally {release();}
  const plan = planDeployment(s.candidate, s.bundle, s.active);
  const retained = deploymentRetention([s.active, plan.desired], [hash('9')]);
  assert.equal(retained.images.length, 4); assert.ok(retained.artifacts.includes(hash('9'))); assert.equal(retained.authorizesDeletion, false);
});
