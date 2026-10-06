#!/usr/bin/env node
// Bounded post-success evidence capture. No database connection, application
// mutation, Docker create/run/up, backup creation, restore or reference scanner.
import {readFileSync,writeFileSync,mkdirSync,existsSync,realpathSync,lstatSync} from 'node:fs';
import path from 'node:path';import {fileURLToPath} from 'node:url';
import {assertReleaseReady,evidenceHash} from './validate-manifest.mjs';
import {validateBuildPlan} from './ci-release.mjs';
import {verifyRecoverabilityBaseline,checksum} from './backup-manifest.mjs';
import {createDeploymentStore} from './deploy-state.mjs';
import {assertOutsideCheckout} from './capture-host-backup.mjs';
import {observeUIHost,assertProtectedPath} from './ui-host-observation.mjs';
import {assertImmutablePreservation,assertUnchangedRunningRuntime} from './ui-preservation.mjs';
import {verifyOriginalFullAnchor} from './ui-release-receipt.mjs';
const read=file=>JSON.parse(readFileSync(file,'utf8'));
const same=(a,b)=>evidenceHash(a)===evidenceHash(b);
export async function capturePostDeploymentAnchor({config,manifest,bundle,candidate,buildPlan,originalBackedUpManifest,restoreReportHash,
  store=createDeploymentStore(config.root),observe=observeUIHost,now=Date.now()}){
  await assertOutsideCheckout(config.root);
  assertReleaseReady(manifest,bundle);validateBuildPlan(buildPlan);
  if(candidate?.provenance?.schemaVersion!==1||candidate.provenance.manifestHash!==evidenceHash(candidate.manifest)
    ||candidate?.provenance?.planHash!==buildPlan.planHash||candidate.provenance.sourceCommit!==manifest.releaseCommit
    ||candidate.provenance.releaseRunId!==buildPlan.releaseRunId||candidate.provenance.controlCommit!==buildPlan.controlCommit)throw Error('Original immutable build plan differs from accepted candidate provenance');
  const application=value=>{const {validationEvidence,...rest}=value;return rest;};
  if(!same(application(candidate.manifest),application(manifest)))throw Error('Accepted manifest differs from published candidate');
  const row=buildPlan.matrix.find(row=>row.component==='frontend');
  if(row.inputFingerprint!==manifest.components.frontend.inputFingerprint||row.sourceCommit!==manifest.components.frontend.sourceCommit)throw Error('Original frontend build inputs differ');
  const unlock=store.lock();
  try{
    const active=store.active(),operation=store.operation(manifest.releaseId);
    if(store.pending().length||operation?.status!=='succeeded'||operation.plan.candidateHash!==evidenceHash(manifest)||!same(active.manifest,manifest)||!same(operation.plan.desired,active))throw Error('Current completed full deployment required before anchor capture');
    const full=bundle.rehearsalReceipt;
    if(full.kind!=='candidate-rehearsal'||operation.kind==='frontend-only'||operation.plan.kind==='frontend-only')throw Error('Original full deployment required');
    if(Date.parse(full.completedAt)>now)throw Error('Original full proof is later than post-success observation');
    const before=await observe(config,active,{now});
    const runtimeFile=assertProtectedPath(config.root,path.join(config.root,'releases',manifest.releaseId,'compose.runtime.json'));
    const runtimeDocument={file:runtimeFile,sha256:await checksum(runtimeFile)};
    const compose=read(runtimeFile);
    for(const [key,name] of [['frontend','frontend'],['backend','backend'],['rulesWorker','rules-worker']]){
      const service=compose.services?.[name];
      if(service?.image!==manifest.components[key].imageDigest||service.environment?.RELEASE_ID!==active.instances[key].releaseId
        ||service.environment.RELEASE_COMMIT!==active.instances[key].releaseCommit)throw Error('Protected original resolved composition differs from accepted release');
    }
    assertProtectedPath(config.root,config.backupDirectory,{directory:true});
    const recovery=await verifyRecoverabilityBaseline(config.backupDirectory,originalBackedUpManifest,{restoreReportHash,now});
    if(recovery.backupHash!==full.backupHash)throw Error('Recoverability baseline differs from original full rehearsal');
    const domain={schemaFingerprint:active.database?.schemaProofHash??full.checks.find(row=>row.id==='snapshot').schemaFingerprint,
      schemaProofHash:evidenceHash({fullRehearsalHash:evidenceHash(full),persistedDatabase:active.database??null}),
      databaseBindingHash:before.databaseBindingHash,backendConfigurationHash:before.protectedRuntime.backend.configurationHash,
      workerConfigurationHash:before.protectedRuntime.rulesWorker.configurationHash,routingSecurityHash:before.routingSecurityHash,
      backendMountsHash:before.protectedRuntime.backend.mountsHash,workerMountsHash:before.protectedRuntime.rulesWorker.mountsHash,immutableRootsHash:before.files.rootsHash,
      frontendBuildContractHash:evidenceHash({baseImages:row.baseImages,buildArguments:row.buildArguments,platform:row.platform}),
      frontendReadersHash:evidenceHash({apiProtocolVersion:before.services.frontend.identity.apiProtocolVersion,readerCapabilities:before.services.frontend.identity.readerCapabilities??[]})};
    const after=await observe(config,active,{now:Date.now()});
    if(!same(store.active(),active)||!same(store.operation(manifest.releaseId),operation))throw Error('Active full deployment changed during observation');
    assertUnchangedRunningRuntime(before.protectedRuntime,after.protectedRuntime);assertImmutablePreservation(before.files,after.files);
    if(before.routingSecurityHash!==after.routingSecurityHash||await checksum(runtimeFile)!==runtimeDocument.sha256)throw Error('Host configuration changed during observation');
    const anchor={manifest:structuredClone(manifest),bundle:structuredClone(bundle),domain,files:after.files};
    const binding=verifyOriginalFullAnchor(anchor,{domain,recovery});
    const document={schemaVersion:1,kind:'protected-full-ui-anchor',status:'captured-after-success',observedAt:after.observedAt,
      originalRehearsalCompletedAt:full.completedAt,activeHash:evidenceHash(active),operationHash:evidenceHash(operation),buildPlanHash:buildPlan.planHash,
      anchor,binding,recovery,recoveryDirectory:config.backupDirectory,observation:after,executionProfile:after.executionProfile,runtimeDocument,schemaScope:active.database?'persisted-verified-additive-proof':'original-full-rehearsal-snapshot',
      databaseReferenceInventory:'not_executed',currentDatabaseReferenceCoverage:'not_asserted',currentDatabaseSnapshot:false};
    const parent=path.join(config.root,'full-anchors');mkdirSync(parent,{recursive:true,mode:0o700});
    if(realpathSync(parent)!==parent||lstatSync(parent).isSymbolicLink())throw Error('Protected anchor directory redirected');
    const file=path.join(parent,evidenceHash(document).slice(7)+'.json');
    if(existsSync(file)){if(!same(read(file),document))throw Error('Immutable anchor collision');}
    else writeFileSync(file,JSON.stringify(document,null,2)+'\n',{flag:'wx',mode:0o600});
    return {status:'captured-after-success',anchorFile:file,anchorHash:evidenceHash(document),originalRehearsalCompletedAt:full.completedAt,observedAt:after.observedAt,currentDatabaseSnapshot:false};
  }finally{unlock();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const [configFile,readyDirectory,buildPlanFile,originalManifestFile,restoreFile,...extra]=process.argv.slice(2);
    if(!restoreFile||extra.length)throw Error('Expected host config, accepted ready directory, immutable build plan, original backed-up manifest and original restore report');
    const result=await capturePostDeploymentAnchor({config:read(configFile),manifest:read(path.join(readyDirectory,'manifest.json')),bundle:read(path.join(readyDirectory,'bundle.json')),
      candidate:read(path.join(readyDirectory,'candidate.json')),buildPlan:read(buildPlanFile),originalBackedUpManifest:read(originalManifestFile),restoreReportHash:evidenceHash(read(restoreFile))});
    process.stdout.write(JSON.stringify(result)+'\n');
  }catch{process.stderr.write('Post-success anchor refused; accepted release remains unchanged.\n');process.exitCode=1;}
}
