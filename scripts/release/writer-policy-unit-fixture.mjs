// Unit-only fabricated observations: these never authorize OCI or deployment.
import {validateManifest,writerPolicy,validateWriterTransition,compositionFingerprint,evidenceHash,assertReleaseReady,writerCompatibilityOutcomes} from './validate-manifest.mjs';
import {planDeployment} from './deploy-state.mjs';
import {attachUnitRehearsal} from './unit-rehearsal-fixture.mjs';
import {unitWriterTrace,unitHostedBrowserTrace,unitWriterPublication} from './unit-writer-trace-fixture.mjs';
import {writerTraceBinding} from './writer-traces.mjs';
import {safeExecutionEnvironment} from './ui-execution-profile.mjs';
import {writerEnvironment} from './writer-environment.mjs';
const hash=char=>`sha256:${char.repeat(64)}`;
const off={compactReceipts:false,imageJobs:false,frozenCatalogs:false};
const on={compactReceipts:true,imageJobs:true,frozenCatalogs:false};
const stamp='2026-10-04T10:00:00Z';
const components=['frontend','backend','rulesWorker'];
export function unitRetainedHistory(backupHash){return {schemaVersion:1,kind:'retained-writer-history-restore',status:'passed',scope:'full-captured-history',execution:'docker',writerEnvironment:{...off},
 closure:{schemaVersion:1,kind:'verified-captured-writer-history',backupHash,artifactClosureHash:hash('a'),sourceCertificationClosureHash:hash('b'),sourceReferenceHash:hash('c'),artifactCount:1,sourceReleaseCount:1},
 dump:{sha256:hash('d'),bytes:100,createdAt:stamp},beforeHash:hash('e'),restoredHash:hash('e'),sourceRetained:true,tables:1,migrationCount:3,formats:{rogue:0,character:0,jobs:0}};}
function manifest(id='old') {
 return {schemaVersion:1,releaseId:id,releaseCommit:'a'.repeat(40),previousReleaseId:null,createdAt:stamp,
  components:Object.fromEntries(components.map((key,i)=>[key,{sourceCommit:String(i+1).repeat(40),inputFingerprint:hash(String(i+4)),imageDigest:`example.test/${key.toLowerCase()}@${hash(String(i+7))}`} ])),
  rulesArtifactHash:hash('a'),contentManifestHash:hash('b'),apiProtocolVersion:1,workerProtocolVersion:1,supportedWorldSchemaVersions:[5],workerRuntime:{name:'node',version:'20.20.0'},
  capabilities:['pinned-artifact-routing','pending-decision-pass-through'],migrationSet:['298_compact_command_receipts','299_frozen_combat_catalogs','300_image_jobs'].map(id=>({id,checksum:hash('c')})),
  validationEvidence:[{gate:'core',status:'passed',inputFingerprint:hash('0'),reportHash:hash('0'),completedAt:stamp}]};
}
function identities(m,instances,readers=on) {
 return Object.fromEntries(components.map(component=>[component,{identitySchemaVersion:1,component,provenance:'baked',sourceCommit:m.components[component].sourceCommit,
  inputFingerprint:m.components[component].inputFingerprint,apiProtocolVersion:1,...instances[component],
  ...(component==='backend'?{readerCapabilities:['receipt-v1',...(readers.compactReceipts?['receipt-v2']:[]),...(readers.imageJobs?['image-job-v1']:[])]}:component==='frontend'?{readerCapabilities:readers.imageJobs?['image-job-v1']:[]}:{artifactHash:m.rulesArtifactHash,workerRuntime:m.workerRuntime,workerProtocolVersion:1,supportedWorldSchemaVersions:m.supportedWorldSchemaVersions,capabilities:m.capabilities})}]));
}
function images(m){return Object.fromEntries(components.map(key=>[key,m.components[key].imageDigest]));}
function launches(m){return Object.fromEntries(components.map(key=>[key,{releaseId:m.releaseId,releaseCommit:m.releaseCommit}]));}
function executionProfile(m,instances){return {schemaVersion:1,...Object.fromEntries(['backend','rulesWorker'].map(component=>[component,{instance:structuredClone(instances[component]),environment:safeExecutionEnvironment(component,component==='backend'?Object.entries(writerEnvironment(m)).map(([key,value])=>key+'='+value):[])}]))};}
function refresh(m,b){
 const fp=compositionFingerprint(m);for(const report of Object.values(b.reports))report.compositionFingerprint=fp;
 m.validationEvidence=Object.entries(b.reports).map(([gate,report])=>({gate,status:'passed',inputFingerprint:fp,reportHash:evidenceHash(report),completedAt:stamp}));
 if(b.rehearsalReceipt)for(const gate of ['image-contract','pinned-artifacts'])b.reports[gate].rehearsalHash=evidenceHash(b.rehearsalReceipt);
 for(const row of m.validationEvidence)row.reportHash=evidenceHash(b.reports[row.gate]);
}
function pair(policy=on,prior=undefined,readers=on,previousState=undefined) {
 const previous=previousState?structuredClone(previousState.manifest):manifest();if(prior!==undefined)previous.writerPolicy=prior;
 const active=previousState?{...structuredClone(previousState),manifest:previous}:{schemaVersion:1,status:'active',manifest:previous,instances:launches(previous)};
 // Reused previous frontend has an older launch ID, independent of release ID.
 if(!previousState)active.instances.frontend={releaseId:'older-ui',releaseCommit:'f'.repeat(40)};
 const candidate={...structuredClone(previous),releaseId:previous.releaseId==='old'?'next':`${previous.releaseId}-next`,releaseCommit:'b'.repeat(40),previousReleaseId:previous.releaseId,writerPolicy:policy};
 const fp=compositionFingerprint(candidate),reports=Object.fromEntries(['core','image-contract','pinned-artifacts'].map(gate=>[gate,{status:'passed',compositionFingerprint:fp,...(gate==='pinned-artifacts'?{workerRuntime:candidate.workerRuntime,artifactHashes:[candidate.rulesArtifactHash],pendingDecisionChecked:true}:{})}]));
 const bundle={previousManifest:previous,reports,identities:identities(candidate,launches(candidate),readers),images:images(candidate),historicalInventoryComplete:true,historicalArtifactHashes:[candidate.rulesArtifactHash]};
 refresh(candidate,bundle);attachUnitRehearsal(candidate,bundle);
 bundle.rehearsalReceipt.activeHash=evidenceHash(active);
  bundle.rehearsalReceipt.checks.find(row=>row.id==='full-candidate-health').historyWriterPolicy={...off};
 const required=writerCompatibilityOutcomes.filter((_,index)=>index===0?readers.compactReceipts:index<3?readers.imageJobs:readers.compactReceipts||readers.imageJobs);
 const check={id:'writer-compatibility',status:'passed',compositionFingerprint:fp,writerPolicy:{...policy},candidate:{images:structuredClone(bundle.images),identities:structuredClone(bundle.identities)},
  previous:{state:structuredClone(active),images:images(previous),identities:identities(previous,active.instances,readers)},outcomes:required.map(id=>({id,status:'passed',traceHash:hash('d')}))};
 check.executionProfile={candidate:executionProfile(candidate,launches(candidate)),previous:executionProfile(previous,active.instances)};
 if(required.includes('frontend-pending-job-reload'))check.writerPublication=unitWriterPublication(candidate);
 check.traces=required.map(id=>{const binding=writerTraceBinding(candidate,check,bundle.rehearsalReceipt);return id==='frontend-pending-job-reload'?unitHostedBrowserTrace(binding,check.writerPublication):unitWriterTrace(id,binding);});
 if(required.length)check.retainedHistory=unitRetainedHistory(bundle.rehearsalReceipt.backupHash);
  check.formatScope='separate-public-owned-fixture';check.formatFixtureCleanup={status:'stopped',executions:1+required.filter(id=>id!=='frontend-pending-job-reload').length};
 check.outcomes=check.traces.map(trace=>({id:trace.outcomeId,status:'passed',traceHash:evidenceHash(trace)}));
 bundle.rehearsalReceipt.checks.push(check);refresh(candidate,bundle);
 return {candidate,bundle,active,check};
}


export {pair,off,on,manifest,refresh,hash};
