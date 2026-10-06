import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {pair} from './writer-policy-unit-fixture.mjs';
import {evidenceHash} from './validate-manifest.mjs';
import {decodePublicWriterDump,decodePublicWriterRules,validatePublicWriterAccounts,validatePublicWriterFixture} from './writer-fixture-package.mjs';
function fixture(){
 const {candidate:manifest,active,check}=pair();
 const candidate={manifest,provenance:{schemaVersion:1,releaseRunId:1,controlCommit:'c'.repeat(40),sourceCommit:manifest.releaseCommit,planHash:'sha256:'+'d'.repeat(64),manifestHash:evidenceHash(manifest)}};
 const verifiedReleaseRun={id:1,workflow:'.github/workflows/release.yml',controlCommit:'c'.repeat(40),runAttempt:2,conclusion:'success'};
 const provenance={releaseRunId:1,runAttempt:2,controlCommit:candidate.provenance.controlCommit,sourceCommit:manifest.releaseCommit,manifestHash:evidenceHash(manifest)};
 const browserProof=structuredClone(check.traces.find(row=>row.outcomeId==='frontend-pending-job-reload').proof);browserProof.provenance=provenance;
 const bytes=Buffer.from('PGDMP unit fixture only; not a restorable SQL dump');
 const accounts=Object.fromEntries(['admin','peer','player'].map((role,i)=>[role,{id:`${String(i+1).padStart(8,'0')}-0000-4000-8000-000000000001`,username:`qa_${role}_${String(i+1).repeat(12)}`,password:String(i+1).repeat(48)}]));
 const imageRoles=Object.fromEntries(['candidate','previous'].map(role=>[role,Object.fromEntries(['backend','frontend','rulesWorker'].map(component=>[component,{image:browserProof.binding[role].images[component],identity:browserProof.binding[role].identities[component]}]))]));
 const value={schemaVersion:1,kind:'public-writer-fixture',scope:'checked-in-public-catalog-and-synthetic-accounts',baseline:{migrationBaseline:'297_retain_generic_spell_free_uses',historicalChainVerified:false,schemaHash:'sha256:'+'a'.repeat(64)},sourceFiles:['scripts/testing/fixtures/schema.sql','scripts/testing/fixtures/schema-manifest.json'].map(path=>({path,bytes:1,sha256:'sha256:'+'b'.repeat(64)})),dump:{runId:'test_'+'a'.repeat(24),base64:bytes.toString('base64'),bytes:bytes.length,sha256:'sha256:'+createHash('sha256').update(bytes).digest('hex')},accounts,imageRoles,provenance,browserProof};
 const ruleBytes=Buffer.from(JSON.stringify([{id:'arbitrary-public-rule',activation:{cost:[]}}]));value.ruleData={path:'frontend/src/engine/data/rollInfluences.json',sha256:'sha256:'+createHash('sha256').update(ruleBytes).digest('hex'),bytes:ruleBytes.length,base64:ruleBytes.toString('base64')};
 value.sourceFiles.push({path:value.ruleData.path,sha256:value.ruleData.sha256,bytes:value.ruleData.bytes});
 candidate.writerFixture=value;return {value,candidate,active,verifiedReleaseRun};
}
test('public fixture is bound to original hosted browser proof, current successful attempt and exact active roles',()=>{
 const f=fixture();const value=validatePublicWriterFixture(f.value,f);assert.deepEqual(value,f.value);f.value.accounts.admin.username='changed';assert.notEqual(value.accounts.admin.username,'changed');
});
test('publication/active/policy/browser and bounded public-data drift fail closed',()=>{
 const changes=[f=>f.verifiedReleaseRun.runAttempt++,f=>f.verifiedReleaseRun.conclusion='failure',f=>delete f.verifiedReleaseRun.runAttempt,
  f=>f.value.provenance.sourceCommit='f'.repeat(40),f=>f.active.instances.frontend.releaseId='new-ui',f=>f.value.imageRoles.previous.backend.image=f.value.imageRoles.candidate.frontend.image,
  f=>f.value.browserProof.binding.writerPolicy.compactReceipts=false,f=>f.value.browserProof.cleanup.status='failed',f=>f.value.baseline.historicalChainVerified=true,
  f=>f.value.imageRoles.candidate.rulesWorker.identity.artifactHash='sha256:'+'0'.repeat(64),f=>f.value.imageRoles.previous.rulesWorker.identity.workerRuntime.version='0.0.0',f=>f.value.imageRoles.previous.backend.identity.apiProtocolVersion++,
  f=>f.value.sourceFiles[0].path='scripts/testing/../../private.dump',f=>f.value.sourceFiles[0].path='outputs/private.dump',f=>f.value.sourceFiles.push(f.value.sourceFiles[0]),
  f=>f.value.accounts.admin.username='real-user',f=>f.value.accounts.admin.token='private',f=>f.value.dump.base64+='\n',f=>f.value.dump.bytes++,f=>f.value.dump.runId='production',f=>f.value.unknown='unexpected',f=>delete f.value.ruleData,f=>f.value.ruleData.base64+='\n',f=>f.value.ruleData.bytes++,f=>f.value.ruleData.sha256='sha256:'+'0'.repeat(64),f=>f.value.sourceFiles.pop()];
 for(const change of changes){const f=fixture();change(f);assert.throws(()=>validatePublicWriterFixture(f.value,f),change.toString());}
});
test('binary and synthetic-account guards are independently enforced before any Docker operation',()=>{
 const f=fixture();assert.equal(decodePublicWriterDump(f.value.dump).subarray(0,5).toString(),'PGDMP');validatePublicWriterAccounts(f.value.accounts);
 for(const patch of [{bytes:9*1024*1024},{sha256:'sha256:'+'0'.repeat(64)},{base64:'not-canonical'}])assert.throws(()=>decodePublicWriterDump({...f.value.dump,...patch}));
 f.value.accounts.peer.id=f.value.accounts.admin.id;assert.throws(()=>validatePublicWriterAccounts(f.value.accounts));
});

test('canonical rule data is byte-bound to the exact candidate source rather than controller cwd',()=>{const f=fixture();assert.deepEqual(decodePublicWriterRules(f.value.ruleData,f.value.sourceFiles),[{id:'arbitrary-public-rule',activation:{cost:[]}}]);assert.throws(()=>decodePublicWriterRules({...f.value.ruleData,path:'other.json'},f.value.sourceFiles));});
