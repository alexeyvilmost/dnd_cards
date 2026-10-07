// Synthetic state/metadata boundaries. No production image acceptance here.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {retirementExecutionUnitFixture} from './retirement-state-unit-fixture.mjs';
import {createDeploymentStore} from './deploy-state.mjs';
import {databaseStateFromRetirementExecution,stateWithDatabase,retiredObservedMigrationIds,characterRetirementMigrationId} from './migration-transition.mjs';
import {retirementBuildConfig,prepareRetirementBuildBaseline,main} from './retirement-build-baseline.mjs';
import {evidenceHash} from './validate-manifest.mjs';

function fixture(){
 const f=retirementExecutionUnitFixture();f.config=JSON.parse(readFileSync(new URL('../../infra/release-build-config.json',import.meta.url)));f.config.migrationSet=structuredClone(f.active.database.migrationSet);
 f.retired=stateWithDatabase(f.active,databaseStateFromRetirementExecution(f,f.execution));
 f.backendMetadata={schemaVersion:1,versions:f.config.migrationSet.map(row=>row.id),retiredObservedMigrationIds:[...retiredObservedMigrationIds],supportedRetirementMigrations:[f.retired.database.migrationSet.at(-1)],retirementExecutionProtocolVersion:1,build:structuredClone(f.execution.build)};
 return f;
}
function storeFixture(t){
 const f=fixture(),root=mkdtempSync(path.join(tmpdir(),'retirement-build-baseline-'));t.after(()=>{assert.equal(path.dirname(root),path.resolve(tmpdir()));assert(path.basename(root).startsWith('retirement-build-baseline-'));rmSync(root,{recursive:true,force:true});});
 f.root=root;f.store=createDeploymentStore(root);f.store.writeActive(f.retired);
 const transition={previous:f.active,desired:f.retired};f.operation={schemaVersion:1,kind:'character-retirement-observation-302',releaseId:f.request.releaseId,status:'succeeded',...transition,transitionHash:evidenceHash(transition),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};f.store.writeOperation(f.operation);return f;
}
test('next configuration explicitly retains all installed identities without registering retirement as startup',()=>{
 const f=fixture(),before=structuredClone(f.config),result=retirementBuildConfig({...f,active:f.retired});assert.deepEqual(result.config.migrationSet,f.retired.database.migrationSet);assert.equal(result.receipt.changed,true);
 const {migrationSet,...old}=before,{migrationSet:next,...rest}=result.config;assert.deepEqual(rest,old);assert.deepEqual(f.config,before);assert(!f.backendMetadata.versions.includes(characterRetirementMigrationId));
 const repeat=retirementBuildConfig({...f,active:f.retired,config:result.config});assert.equal(repeat.receipt.changed,false);assert.deepEqual(repeat.config,result.config);
});
test('protected succeeded journal is required under the shared lock and source files remain unchanged',t=>{
 const f=storeFixture(t),before=readFileSync(path.join(f.root,'active.json')),result=prepareRetirementBuildBaseline({...f});assert.equal(result.receipt.changed,true);assert.deepEqual(readFileSync(path.join(f.root,'active.json')),before);
 const config=path.join(f.root,'config.json'),metadata=path.join(f.root,'metadata.json'),output=path.join(f.root,'proposal.json');writeFileSync(config,JSON.stringify(f.config));writeFileSync(metadata,JSON.stringify(f.backendMetadata));const input=readFileSync(config);
 main(['prepare',config,f.root,metadata,output]);assert.deepEqual(JSON.parse(readFileSync(output)).config,result.config);assert.deepEqual(readFileSync(config),input);assert.throws(()=>main(['prepare',config,f.root,metadata,output]),/EEXIST/);
 const unlock=f.store.lock();try{assert.throws(()=>prepareRetirementBuildBaseline(f),/lock exists/);}finally{unlock();}
});
for(const [name,change]of Object.entries({
 'unretired active state':f=>{f.retired=f.active;},
 'another baseline':f=>{f.config.migrationSet[0].checksum='sha256:'+'a'.repeat(64);},
 'unknown migration':f=>{f.config.migrationSet.push({id:'999_unknown',checksum:'sha256:'+'a'.repeat(64)});},
 'changed executor source':f=>{f.backendMetadata.build.sourceCommit='c'.repeat(40);},
 'changed executor fingerprint':f=>{f.backendMetadata.build.inputFingerprint='sha256:'+'a'.repeat(64);},
 'runtime metadata':f=>{f.backendMetadata.build.provenance='runtime';},
 'missing explicit retirement support':f=>{delete f.backendMetadata.supportedRetirementMigrations;},
 'retirement added to startup registry':f=>{f.backendMetadata.versions.push(characterRetirementMigrationId);},
 'unknown config field':f=>{f.config.databaseURL='PRIVATE_CANARY';},
}))test('build baseline refuses '+name,()=>{const f=fixture();change(f);assert.throws(()=>retirementBuildConfig({...f,active:f.retired}));});
test('pending, stale or changed journals cannot produce a follow-on proposal',t=>{
 for(const mutate of [f=>{f.store.writeOperation({releaseId:'other',status:'recovery_required'});},f=>{f.operation.status='recovery_required';f.store.writeOperation(f.operation);},f=>{f.operation.desired.database.approvalHash='sha256:'+'a'.repeat(64);f.store.writeOperation(f.operation);},f=>{const later=structuredClone(f.retired);later.manifest.releaseId='later';f.store.writeActive(later);}]){
  const f=storeFixture(t);mutate(f);const before=readFileSync(path.join(f.root,'active.json'));assert.throws(()=>prepareRetirementBuildBaseline(f));assert.deepEqual(readFileSync(path.join(f.root,'active.json')),before);
 }
});
