// Published synthetic format data is a separate capability from a deployment
// backup. This receiver never accepts an arbitrary existing database or DSN.
import assert from 'node:assert/strict';
import {mkdir,writeFile,realpath,lstat} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createCompactOciAdapter} from './compact-oci-adapter.mjs';
import {databaseMigrationSet} from './migration-transition.mjs';
import {retireEmptyWriterFixture} from './retire-empty-writer-fixture.mjs';
import {evidenceHash,compositionFingerprint,writerPolicy,validateManifest} from './validate-manifest.mjs';
import {verifyCandidateProvenance} from './deployment-handoff.mjs';
import {validateWriterTrace} from './writer-traces.mjs';
const hash=/^sha256:[a-f0-9]{64}$/,sha=/^[a-f0-9]{40}$/,uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const components=['backend','frontend','rulesWorker'];
const exact=(value,keys)=>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));assert.deepEqual(Object.keys(value).sort(),[...keys].sort());};
const same=(a,b)=>assert.equal(evidenceHash(a),evidenceHash(b),'Published fixture binding differs');
export function decodePublicWriterDump(dump){
 exact(dump,['runId','base64','sha256','bytes']);assert.match(dump.runId,/^test_[a-f0-9]{24}$/);assert.match(dump.sha256,hash);
 assert.ok(Number.isSafeInteger(dump.bytes)&&dump.bytes>0&&dump.bytes<=8*1024*1024);
 assert.equal(typeof dump.base64,'string');assert.ok(dump.base64.length<=12*1024*1024);
 const bytes=Buffer.from(dump.base64,'base64');assert.equal(bytes.length,dump.bytes);assert.equal(bytes.toString('base64'),dump.base64);
 assert.equal('sha256:'+createHash('sha256').update(bytes).digest('hex'),dump.sha256);assert.equal(bytes.subarray(0,5).toString(),'PGDMP');return bytes;
}
export function decodePublicWriterRules(value,sourceFiles){
 exact(value,['path','sha256','bytes','base64']);assert.equal(value.path,'frontend/src/engine/data/rollInfluences.json');assert.match(value.sha256,hash);
 assert.ok(Number.isSafeInteger(value.bytes)&&value.bytes>0&&value.bytes<=65536);assert.equal(typeof value.base64,'string');assert.ok(value.base64.length<=87384);
 const bytes=Buffer.from(value.base64,'base64');assert.equal(bytes.length,value.bytes);assert.equal(bytes.toString('base64'),value.base64);assert.equal('sha256:'+createHash('sha256').update(bytes).digest('hex'),value.sha256);
 assert.equal(Buffer.from(bytes.toString('utf8'),'utf8').equals(bytes),true);const rows=sourceFiles.filter(row=>row.path===value.path);assert.equal(rows.length,1);same(rows[0],{path:value.path,sha256:value.sha256,bytes:value.bytes});
 const rules=JSON.parse(bytes.toString('utf8'));assert.ok(Array.isArray(rules)&&rules.length>0);assert.ok(rules.every(row=>row&&typeof row.id==='string'));assert.equal(new Set(rules.map(row=>row.id)).size,rules.length);return rules;
}
export function validatePublicWriterAccounts(accounts){
 exact(accounts,['admin','peer','player']);const ids=new Set(),names=new Set();
 for(const role of ['admin','peer','player']){const row=accounts[role];exact(row,['id','username','password']);assert.match(row.id,uuid);assert.match(row.username,new RegExp('^qa_'+role+'_[a-f0-9]{12}$'));assert.match(row.password,/^[a-f0-9]{48}$/);ids.add(row.id);names.add(row.username);}
 assert.equal(ids.size,3);assert.equal(names.size,3);return accounts;
}
export function validatePublicWriterImageRoles(imageRoles,{candidate,active}){
 validateManifest(candidate.manifest);validateManifest(active?.manifest);assert.equal(active.status,'active');exact(imageRoles,['candidate','previous']);
 for(const role of ['candidate','previous']){
  exact(imageRoles[role],components);const manifest=role==='candidate'?candidate.manifest:active.manifest;
  for(const component of components){
   const record=imageRoles[role][component],expected=manifest.components[component];exact(record,['image','identity']);assert.equal(record.image,expected.imageDigest);
   const identity=record.identity;assert.equal(identity.identitySchemaVersion,1);assert.equal(identity.component,component);assert.equal(identity.provenance,'baked');assert.equal(identity.sourceCommit,expected.sourceCommit);assert.equal(identity.inputFingerprint,expected.inputFingerprint);assert.equal(identity.apiProtocolVersion,manifest.apiProtocolVersion);
   if(component==='rulesWorker')for(const [key,expectedValue]of Object.entries({artifactHash:manifest.rulesArtifactHash,workerRuntime:manifest.workerRuntime,workerProtocolVersion:manifest.workerProtocolVersion,supportedWorldSchemaVersions:manifest.supportedWorldSchemaVersions,capabilities:manifest.capabilities}))same(identity[key],expectedValue);
   const launch=role==='candidate'?{releaseId:manifest.releaseId,releaseCommit:manifest.releaseCommit}:active.instances?.[component];assert.ok(launch);assert.equal(identity.releaseId,launch.releaseId);assert.equal(identity.releaseCommit,launch.releaseCommit);
  }
 }return imageRoles;
}
export function validatePublicWriterFixture(value,{candidate,active,verifiedReleaseRun}){
 const provenance=verifyCandidateProvenance(candidate,verifiedReleaseRun);
 assert.equal(verifiedReleaseRun.conclusion,'success');assert.ok(Number.isSafeInteger(verifiedReleaseRun.runAttempt)&&verifiedReleaseRun.runAttempt>0);
 exact(value,['schemaVersion','kind','scope','baseline','sourceFiles','ruleData','dump','accounts','imageRoles','provenance','browserProof']);
 assert.equal(value.schemaVersion,1);assert.equal(value.kind,'public-writer-fixture');assert.equal(value.scope,'checked-in-public-catalog-and-synthetic-accounts');
 exact(value.baseline,['migrationBaseline','historicalChainVerified','schemaHash']);assert.equal(value.baseline.migrationBaseline,'297_retain_generic_spell_free_uses');assert.equal(value.baseline.historicalChainVerified,false);assert.match(value.baseline.schemaHash,hash);
 assert.ok(Array.isArray(value.sourceFiles)&&value.sourceFiles.length>0&&value.sourceFiles.length<=256);const paths=new Set();
 for(const row of value.sourceFiles){exact(row,['path','sha256','bytes']);assert.equal(typeof row.path,'string');assert.ok(/^(?:scripts\/testing\/|officials\/canon\/prod-snapshot\/|backend\/charactertemplates\/|backend\/migrations\/data\/|scripts\/content\/data\/)/.test(row.path)||['frontend/src/engine/data/rollInfluences.json','frontend/src/roguelike/pinnedFighter.fixture.json','frontend/src/canon/data/micro-mvp-l1-content-patch.v1.json','backend/migrations/generic_spell_freeuses_297_manifest.json'].includes(row.path));assert.ok(!row.path.split('/').some(part=>!part||part==='.'||part==='..')&&!row.path.includes('\\'));assert.match(row.sha256,hash);assert.ok(Number.isSafeInteger(row.bytes)&&row.bytes>0);assert.ok(!paths.has(row.path));paths.add(row.path);}
 assert.ok(paths.has('scripts/testing/fixtures/schema.sql')&&paths.has('scripts/testing/fixtures/schema-manifest.json'));
 decodePublicWriterDump(value.dump);decodePublicWriterRules(value.ruleData,value.sourceFiles);validatePublicWriterAccounts(value.accounts);
 exact(value.provenance,['releaseRunId','runAttempt','controlCommit','sourceCommit','manifestHash']);
 same(value.provenance,{releaseRunId:provenance.releaseRunId,runAttempt:verifiedReleaseRun.runAttempt,controlCommit:provenance.controlCommit,sourceCommit:provenance.sourceCommit,manifestHash:provenance.manifestHash});
 validatePublicWriterImageRoles(value.imageRoles,{candidate,active});
 const binding=value.browserProof?.binding;assert.ok(binding);assert.equal(binding.compositionFingerprint,compositionFingerprint(candidate.manifest));assert.equal(binding.activeHash,evidenceHash(active));same(binding.writerPolicy,writerPolicy(candidate.manifest));
 for(const role of ['candidate','previous']){
  same(binding[role].images,Object.fromEntries(components.map(component=>[component,value.imageRoles[role][component].image])));
  same(binding[role].identities,Object.fromEntries(components.map(component=>[component,value.imageRoles[role][component].identity])));
 }
 same(binding.previous.state,active);same(value.browserProof.provenance,value.provenance);
 const consumption={schemaVersion:1,kind:'verified-hosted-writer-trace',execution:'hosted-proof-consumption',outcomeId:'frontend-pending-job-reload',consumptionBindingHash:evidenceHash(binding),verifiedReleaseRunHash:evidenceHash(verifiedReleaseRun),proofHash:evidenceHash(value.browserProof),proof:value.browserProof};
 validateWriterTrace(consumption,'frontend-pending-job-reload',binding);return structuredClone(value);
}
export async function createHostedWriterFixture({candidate,active,verifiedReleaseRun,directory,postgresImage}){
 const value=validatePublicWriterFixture(candidate?.writerFixture,{candidate,active,verifiedReleaseRun});
 directory=path.resolve(directory);assert.equal(await realpath(path.dirname(directory)),path.dirname(directory));await mkdir(directory,{mode:0o700});assert.equal(await realpath(directory),directory);assert.equal((await lstat(directory)).isSymbolicLink(),false);
 const registryDirectory=path.join(directory,value.dump.runId);await mkdir(registryDirectory,{mode:0o700});
 const dumpFile=path.join(registryDirectory,'database.dump'),registryPath=path.join(registryDirectory,'registry.json');
 await writeFile(dumpFile,decodePublicWriterDump(value.dump),{flag:'wx',mode:0o600});
 const registry={version:1,runId:value.dump.runId,directory:registryDirectory,status:'ready',fixture:{profile:'integration-baseline',migrationBaseline:value.baseline.migrationBaseline,historicalChainVerified:false},provenance:{kind:'verified-hosted-public-fixture',packageHash:evidenceHash(value),releaseRunHash:evidenceHash(verifiedReleaseRun)}};
 await writeFile(registryPath,JSON.stringify(registry)+'\n',{flag:'wx',mode:0o600});
 const imageRoles={},roleLaunches={};
 for(const role of ['candidate','previous']){
  imageRoles[role]={};roleLaunches[role]={};
  for(const component of components){const row=value.imageRoles[role][component];imageRoles[role][component==='rulesWorker'?'worker':component]={image:row.image,identity:row.identity,sourceCommit:row.identity.sourceCommit,inputFingerprint:row.identity.inputFingerprint};roleLaunches[role][component]={releaseId:row.identity.releaseId,releaseCommit:row.identity.releaseCommit};}
 }
 const adapter=await createCompactOciAdapter({directory:path.join(directory,'runtime'),dump:{schemaVersion:1,kind:'owned-integration-dump',runId:value.dump.runId,registryPath,dumpFile,sha256:value.dump.sha256,bytes:value.dump.bytes},imageRoles,roleLaunches,postgresImage,imageProtocol:true});
 if(candidate.manifest.migrationSet.some(row=>row.id==='302_retire_legacy_characters')){
  try{
   assert(databaseMigrationSet(active).some(row=>row.id==='302_retire_legacy_characters'),'Fixture retirement requires an already recorded baseline');
   await adapter.start({role:'previous',...writerPolicy(active.manifest),releaseId:active.manifest.releaseId});
   await adapter.stopApplications();
   await retireEmptyWriterFixture(adapter,databaseMigrationSet(active),{candidate:candidate.manifest,active});
  }catch(error){try{await adapter.cleanup();}catch(cleanup){throw new AggregateError([error,cleanup],'Writer fixture preparation and cleanup failed');}throw error;}
 }
 return {adapter,accounts:structuredClone(value.accounts),rollInfluences:decodePublicWriterRules(value.ruleData,value.sourceFiles),cleanup:()=>adapter.cleanup(),browserTrace:async binding=>{
  const proof=structuredClone(value.browserProof),trace={schemaVersion:1,kind:'verified-hosted-writer-trace',execution:'hosted-proof-consumption',outcomeId:'frontend-pending-job-reload',consumptionBindingHash:evidenceHash(binding),verifiedReleaseRunHash:evidenceHash(verifiedReleaseRun),proofHash:evidenceHash(proof),proof};
  validateWriterTrace(trace,trace.outcomeId,binding);return trace;
 }};
}
