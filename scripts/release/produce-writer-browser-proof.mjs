import assert from 'node:assert/strict';
import {mkdir,writeFile,realpath} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {createCompactOciAdapter} from './compact-oci-adapter.mjs';
import {probeImageJobBrowser} from './image-job-browser-probe.mjs';
import {prepareWriterBrowser} from './writer-browser-runtime.mjs';
import {observeWriterImageRoles} from './writer-image-observation.mjs';
import {producePublicWriterDump} from './produce-public-writer-dump.mjs';
import {validatePublicWriterImageRoles,decodePublicWriterDump,decodePublicWriterRules,validatePublicWriterAccounts} from './writer-fixture-package.mjs';
import {validateWriterTrace} from './writer-traces.mjs';
import {expectedWriterBrowserProfiles} from './writer-runtime-profile.mjs';
import {evidenceHash,compositionFingerprint,writerPolicy,validateManifest,requiredWriterOutcomes} from './validate-manifest.mjs';
const same=(a,b)=>assert.equal(evidenceHash(a),evidenceHash(b),'Actual hosted writer input changed');
const components=['backend','frontend','rulesWorker'];
export function hostedWriterProvenance(candidate,environment=process.env){
 validateManifest(candidate.manifest);assert.equal(candidate.frontendVerification,undefined,'Full writer and frontend-only authorization paths are mutually exclusive');const p=candidate.provenance;
 assert.equal(environment.GITHUB_ACTIONS,'true');assert.equal(environment.GITHUB_REF,'refs/heads/main');
 assert.equal(environment.GITHUB_WORKFLOW_REF,environment.GITHUB_REPOSITORY+'/.github/workflows/release.yml@refs/heads/main');
 assert.match(environment.GITHUB_SHA??'',/^[a-f0-9]{40}$/);assert.equal(environment.GITHUB_SHA,p.controlCommit);assert.equal(Number(environment.GITHUB_RUN_ID),p.releaseRunId);
 assert.equal(p.schemaVersion,1);assert.equal(p.sourceCommit,candidate.manifest.releaseCommit);assert.equal(p.manifestHash,evidenceHash(candidate.manifest));assert.match(p.planHash,/^sha256:[a-f0-9]{64}$/);
 assert.ok(Number.isSafeInteger(p.releaseRunId)&&p.releaseRunId>0);const runAttempt=Number(environment.GITHUB_RUN_ATTEMPT);assert.ok(Number.isSafeInteger(runAttempt)&&runAttempt>0);
 // A currently executing workflow cannot attest its final conclusion. The
 // receiving host separately obtains the eventual successful run and attempt.
 return {releaseRunId:p.releaseRunId,runAttempt,controlCommit:p.controlCommit,sourceCommit:p.sourceCommit,manifestHash:p.manifestHash};
}
function records(imageRoles){return Object.fromEntries(['candidate','previous'].map(role=>[role,Object.fromEntries(components.map(component=>{const row=imageRoles[role][component];return [component==='rulesWorker'?'worker':component,{image:row.image,identity:row.identity,sourceCommit:row.identity.sourceCommit,inputFingerprint:row.identity.inputFingerprint}];}))]));}
function assertObserved(observed,imageRoles,backendRole,frontendRole){
 for(const component of components){const expected=imageRoles[component==='frontend'?frontendRole:backendRole][component];assert.equal(observed.images[component],expected.image);same(observed.identities[component],expected.identity);}
}
export async function cleanupWriterBrowserCase(browser,adapter){
 const errors=[];let result;
 if(browser){try{await browser.assertUnchanged();}catch(error){errors.push(error);}if(browser.cleanup)try{await browser.cleanup();}catch(error){errors.push(error);}}
 if(adapter)try{result=await adapter.cleanup();if(result.status!=='stopped'||result.errors?.length)throw Error('Actual hosted browser fixture cleanup failed');}catch(error){errors.push(error);}
 if(errors.length)throw new AggregateError(errors,'Writer browser verification or cleanup failed');return result;
}
// Low-level execution may be used for a local non-deployable rehearsal without
// inventing GitHub run IDs. Only the guarded publisher below adds provenance.
export async function executeWriterBrowserPair({candidate,active,publicDump,imageRoles,roleLaunches,repositoryRoot,directory,postgresImage,browserFactory}){
 validatePublicWriterImageRoles(imageRoles,{candidate,active});decodePublicWriterDump(publicDump.dump);decodePublicWriterRules(publicDump.ruleData,publicDump.sourceFiles);validatePublicWriterAccounts(publicDump.accounts);
 directory=path.resolve(directory);assert.equal(await realpath(path.dirname(directory)),path.dirname(directory));await mkdir(directory,{mode:0o700});
 const binding={compositionFingerprint:compositionFingerprint(candidate.manifest),activeHash:evidenceHash(active),runId:randomUUID(),writerPolicy:writerPolicy(candidate.manifest),
  candidate:{images:Object.fromEntries(components.map(c=>[c,imageRoles.candidate[c].image])),identities:Object.fromEntries(components.map(c=>[c,imageRoles.candidate[c].identity]))},
  previous:{state:active,images:Object.fromEntries(components.map(c=>[c,imageRoles.previous[c].image])),identities:Object.fromEntries(components.map(c=>[c,imageRoles.previous[c].identity]))},executionProfile:{}};
 const required=requiredWriterOutcomes(candidate.manifest,active.manifest,binding.previous.identities);
 assert.ok(required.includes('frontend-pending-job-reload'),'The browser probe requires a declared format obligation');
 const probePolicy={compactReceipts:required.includes('compact-receipt-cross-image-retry'),imageJobs:true,frozenCatalogs:false};
 const observations=[],executionProfile={},cleanups=[];let browserRuntime,failure;
 for(const [index,frontendRole]of ['candidate','previous'].entries()){
  let adapter,browser;
  try{
   adapter=await createCompactOciAdapter({directory:path.join(directory,'case-'+index),dump:{schemaVersion:1,kind:'owned-integration-dump',runId:publicDump.dump.runId,registryPath:publicDump.local.registryPath,dumpFile:publicDump.local.dumpFile,sha256:publicDump.dump.sha256,bytes:publicDump.dump.bytes},imageRoles:records(imageRoles),roleLaunches,postgresImage,imageProtocol:true});
   // Profile the actual manifest policies before the deliberate isolated format
   // probes. Only writer flags may differ in the later ON/OFF browser execution.
   for(const role of ['candidate','previous']){
    const manifest=role==='candidate'?candidate.manifest:active.manifest;
    const preview=await adapter.start({role,...writerPolicy(manifest),releaseId:manifest.releaseId});assertObserved(preview,imageRoles,role,role);
    const applied=JSON.parse(await adapter.query("SELECT coalesce(json_agg(version ORDER BY version),'[]'::json) FROM schema_migrations;"));assert.deepEqual(applied,[...manifest.migrationSet.map(row=>row.id)].sort(),'Public fixture did not reach the exact candidate migration ledger');
    if(binding.executionProfile[role])same(preview.executionProfile,binding.executionProfile[role]);else binding.executionProfile[role]=preview.executionProfile;
    await adapter.stopApplications();
   }
   const before=await adapter.start({role:'candidate',frontendRole,...probePolicy,releaseId:candidate.manifest.releaseId});assertObserved(before,imageRoles,'candidate',frontendRole);
   if(executionProfile.candidate)same(before.executionProfile,executionProfile.candidate);else executionProfile.candidate=before.executionProfile;
   let surface=await adapter.startBrowserSurface({role:frontendRole,releaseId:(frontendRole==='candidate'?candidate.manifest:active.manifest).releaseId});
   browser=await (browserFactory??prepareWriterBrowser)({repositoryRoot,directory:path.join(directory,'browser-'+index),adapter,surface});
   if(browser.origin)surface={...surface,origin:browser.origin};
   if(browserRuntime)same(browser.runtime,browserRuntime);else browserRuntime=browser.runtime;
   observations.push(await probeImageJobBrowser({adapter,accounts:publicDump.accounts,id:frontendRole+'-ui',surface,releaseIds:{candidate:candidate.manifest.releaseId,previous:active.manifest.releaseId},repositoryRoot,browserConfiguration:browser,frontendRole}));
   const after=await adapter.observe();assertObserved(after,imageRoles,'previous',frontendRole);
   if(executionProfile.previous)same(after.executionProfile,executionProfile.previous);else executionProfile.previous=after.executionProfile;
  }catch(error){failure=error;}finally{
   try{const result=await cleanupWriterBrowserCase(browser,adapter);if(result)cleanups.push(result);}catch(error){failure=failure?new AggregateError([failure,error],'Writer browser case failed with cleanup diagnostics'):error;}
  }
  if(failure)break;
 }
 if(failure)throw failure;
 same(executionProfile,expectedWriterBrowserProfiles(binding));
 const trace={schemaVersion:1,kind:'writer-compatibility-trace',execution:'docker',outcomeId:'frontend-pending-job-reload',bindingHash:evidenceHash(binding),observations};validateWriterTrace(trace,trace.outcomeId,binding);
 return {binding,trace,executionProfile,browserRuntime,cleanup:{status:'stopped',errors:[]},ownedExecutions:cleanups.length};
}
export async function produceHostedWriterFixture({candidate,active,repositoryRoot,directory,postgresImage,environment=process.env}){
 const provenance=hostedWriterProvenance(candidate,environment);directory=path.resolve(directory);await mkdir(directory,{mode:0o700});
 const inputHash=evidenceHash({candidate,active});const {imageRoles,roleLaunches}=observeWriterImageRoles({candidate:candidate.manifest,active});validatePublicWriterImageRoles(imageRoles,{candidate,active});
 const publicDump=await producePublicWriterDump({repositoryRoot,sourceCommit:provenance.sourceCommit});
 const actual=await executeWriterBrowserPair({candidate,active,publicDump,imageRoles,roleLaunches,repositoryRoot,directory:path.join(directory,'browser-proof'),postgresImage});
 assert.equal(evidenceHash({candidate,active}),inputHash);same(hostedWriterProvenance(candidate,environment),provenance);
 const browserProof={schemaVersion:1,kind:'writer-browser-oci-proof',status:'passed',execution:'docker',binding:actual.binding,trace:actual.trace,provenance,cleanup:actual.cleanup,executionProfile:actual.executionProfile,browserRuntime:actual.browserRuntime};
 const writerFixture={schemaVersion:1,kind:'public-writer-fixture',scope:'checked-in-public-catalog-and-synthetic-accounts',baseline:publicDump.baseline,sourceFiles:publicDump.sourceFiles,ruleData:publicDump.ruleData,dump:publicDump.dump,accounts:publicDump.accounts,imageRoles,provenance,browserProof};
 assert.ok(Buffer.byteLength(JSON.stringify({...candidate,writerFixture}))<32*1024*1024);await writeFile(path.join(directory,'writer-fixture.json'),JSON.stringify(writerFixture)+'\n',{flag:'wx',mode:0o600});
 return writerFixture;
}
