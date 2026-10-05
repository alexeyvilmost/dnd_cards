#!/usr/bin/env node
// The production collector runs unchanged. Only its authorization envelope is
// local-only: no invented CI run/core receipt, and no deployable bundle output.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateLocalRegistryPlan,assertLocalRecord,createLocalRegistryDockerAdapter,localRegistryStages} from './local-registry-rehearsal.mjs';
import {evidenceHash,compositionFingerprint,validateManifest} from './validate-manifest.mjs';
import {validateActive} from './deploy-state.mjs';
import {isLegacyBaseline,baselineDocument,baselineArtifact} from './legacy-baseline.mjs';
import {databaseMigrationSet,migrationBaselineMatches} from './migration-transition.mjs';
import {migrationRehearsalRequest} from './migration-rehearsal.mjs';
import {collectRehearsal,validateRehearsal} from './candidate-rehearsal.mjs';
import {createDockerRehearsal} from './docker-rehearsal.mjs';
import {verifyBackup,checksum,backupFile} from './backup-manifest.mjs';
const read=async file=>JSON.parse(await readFile(file,'utf8'));
export async function ownedLocalSession({registry,adapter,output},execute){
 const summary={schemaVersion:1,kind:'local-candidate-session',deployable:false,ciProvenance:null,execution:adapter.execution,status:'running',startedAt:new Date().toISOString()};
 let receipt,failure;
 try{receipt=await execute();summary.rehearsalHash=evidenceHash(receipt);}
 catch(error){failure=error;summary.failure='owned-local-candidate-session-failed';}
 finally{
  const results=await Promise.allSettled([adapter.cleanup(),registry.cleanup()]);
  const candidateStopped=results[0].status==='fulfilled'&&results[0].value?.status==='stopped',registryStopped=results[1].status==='fulfilled';
  summary.cleanup={candidate:candidateStopped?'stopped':'failed',registry:registryStopped?'stopped':'failed',status:candidateStopped&&registryStopped?'stopped':'failed'};
  if(summary.cleanup.status!=='stopped')failure??=Error('Owned local candidate cleanup incomplete');
  summary.status=failure?'failed':'passed';summary.completedAt=new Date().toISOString();
  await writeFile(path.join(output,'local-session.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx',mode:0o600});
 }
 if(failure)throw Object.assign(Error('Owned local candidate session failed; inspect local-session.json'),{cause:failure,report:summary});
 return {...summary,receipt};
}
export function localRehearsalInput({plan,registryReport,images,active,backup,contentManifestHash,migrationSet}){
 validateLocalRegistryPlan(plan);validateActive(active);
 if(registryReport?.kind!=='local-registry-rehearsal-result'||registryReport.execution!=='docker'||registryReport.status!=='passed'||registryReport.deployable!==false||registryReport.ciProvenance!==null||registryReport.planHash!==plan.planHash||registryReport.sourceCommit!==plan.sourceCommit||!Array.isArray(registryReport.checks)||evidenceHash(registryReport.checks.map(row=>row.id))!==evidenceHash(localRegistryStages)||registryReport.checks.some(row=>row.status!=='passed')||registryReport.cleanup?.status!=='stopped')throw Error('Completed actual local registry proof required');
 const components={},identities={};
 for(const row of plan.rows){const record=registryReport.records[row.name];assertLocalRecord(plan,row,record,record.archiveHash);if(!/^127\.0\.0\.1:\d+\/[a-z]+@sha256:[a-f0-9]{64}$/.test(images[row.name]??''))throw Error('Only owned loopback candidate image references permitted');components[row.component]={sourceCommit:plan.sourceCommit,inputFingerprint:row.inputFingerprint,imageDigest:images[row.name]};identities[row.component]=record.identity;}
 const worker=identities.rulesWorker,completedAt=new Date().toISOString(),imageProof={kind:'actual-local-image-contract',status:'passed',planHash:plan.planHash,images,identities};
 const manifest={schemaVersion:1,releaseId:'local-'+plan.runId,releaseCommit:plan.sourceCommit,previousReleaseId:isLegacyBaseline(active)?null:active.manifest.releaseId,createdAt:completedAt,components,
  rulesArtifactHash:worker.artifactHash,contentManifestHash,apiProtocolVersion:1,workerProtocolVersion:worker.workerProtocolVersion,supportedWorldSchemaVersions:worker.supportedWorldSchemaVersions,workerRuntime:worker.workerRuntime,capabilities:worker.capabilities,migrationSet,
  validationEvidence:[{gate:'image-contract',status:'passed',reportHash:evidenceHash(imageProof),inputFingerprint:plan.planHash,completedAt}]};
 validateManifest(manifest);manifest.validationEvidence[0].inputFingerprint=compositionFingerprint(manifest);
 if(backup.releaseManifestHash!==evidenceHash(baselineDocument(active))||evidenceHash([...backup.migrations].sort())!==evidenceHash(databaseMigrationSet(active).map(row=>row.id).sort())||isLegacyBaseline(active)&&backup.schemaFingerprint!==active.schemaFingerprint)throw Error('Owned backup does not match observed predecessor');
 const historicalArtifactHashes=[...new Set([...backup.referencedArtifactHashes,baselineArtifact(active)])].sort();
 for(const hash of historicalArtifactHashes)if(!backup.files.some(row=>row.category==='rules-artifact'&&row.sha256===hash))throw Error('Owned backup omits executable history');
 const input={schemaVersion:1,localOnly:true,deployable:false,ciProvenance:null,manifest,previousManifest:isLegacyBaseline(active)?null:active.manifest,...(isLegacyBaseline(active)?{legacyBaseline:baselineDocument(active)}:{}),active,backup,historicalArtifactHashes,
  candidateHash:evidenceHash({kind:'local-only-oci-composition',planHash:plan.planHash,manifest,imageProof}),activeHash:evidenceHash(active),backupHash:evidenceHash(backup),compositionFingerprint:compositionFingerprint(manifest)};
 if(!migrationBaselineMatches(active,migrationSet))migrationRehearsalRequest(input);return input;
}
export async function runLocalCandidateRehearsal({plan,registryReport,active,backupDirectory,postgresImage,contentManifestHash,migrationSet,output,docker='docker',builder='default',afterVerified=async()=>{}}){
 if(!path.isAbsolute(output)||!path.isAbsolute(backupDirectory))throw Error('Explicit owned local paths required');await mkdir(output,{mode:0o700});
 const registry=createLocalRegistryDockerAdapter(plan,{docker,builder}),adapter=createDockerRehearsal({postgresImage,backupDirectory,directory:output});
 return ownedLocalSession({registry,adapter,output},async()=>{
  let receipt,input;
  await registry.preflight();await registry.start();const images={};
  for(const row of plan.rows){const record=registryReport.records[row.name];await registry.restoreArchive(row,record);images[row.name]=await registry.publish(row,record);await registry.pull(images[row.name]);}
  let backup;
  try{backup=await verifyBackup(backupDirectory);}catch(error){if(error.code!=='ENOENT')throw error;const capture=await read(path.join(backupDirectory,'capture.json'));
   if(capture.schemaVersion!==1||capture.kind!=='candidate-capture'||capture.status!=='captured'||capture.activeHash!==evidenceHash(active)||capture.releaseManifestHash!==evidenceHash(baselineDocument(active))||!Number.isFinite(Date.parse(capture.createdAt))||Date.parse(capture.createdAt)>Date.now()||!Array.isArray(capture.files)||new Set(capture.files.map(row=>row.path)).size!==capture.files.length)throw Error('Owned capture identity differs');
   for(const file of capture.files){const p=backupFile(backupDirectory,file.path);if(await checksum(p)!==file.sha256||(await readFile(p)).length!==file.bytes)throw Error('Owned capture bytes changed');}
   backup=await adapter.prepareCapture(capture,active);
  }
  input=localRehearsalInput({plan,registryReport,images,active,backup,contentManifestHash,migrationSet});await writeFile(path.join(output,'input.json'),JSON.stringify(input,null,2)+'\n',{flag:'wx',mode:0o600});
  receipt=await collectRehearsal(input,adapter,{onReport:report=>writeFile(path.join(output,'rehearsal.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600})});validateRehearsal(input,receipt);
  assert.equal(receipt.kind,'local-candidate-rehearsal');
  // An owned integration driver may exercise the same actual deployment adapter
  // while these loopback digests remain available. It cannot issue a CI bundle.
  await afterVerified({input,receipt,backupDirectory});return receipt;
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const [file]=process.argv.slice(2),args=await read(file);const result=await runLocalCandidateRehearsal({...args,plan:await read(args.plan),registryReport:await read(args.registryReport),active:await read(args.active)});console.log(JSON.stringify({status:result.status,deployable:false,kind:result.kind}));}
 catch{console.error('Owned local candidate rehearsal failed; no deployment bundle produced.');process.exitCode=1;}
}
