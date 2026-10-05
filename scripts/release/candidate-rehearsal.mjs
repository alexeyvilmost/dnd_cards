#!/usr/bin/env node
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {validateManifest,evidenceHash,compositionFingerprint,candidateRehearsalStages} from './validate-manifest.mjs';
import {validateActive} from './deploy-state.mjs';
import {databaseMigrationSet,migrationBaselineMatches,migrationScenarios} from './migration-transition.mjs';
import {isLegacyBaseline,baselineDocument,baselineArtifact} from './legacy-baseline.mjs';
import {migrationRehearsalRequest,validateMigrationRehearsal} from './migration-rehearsal.mjs';
import {verifyDeploymentBackup,verifyBackup,backupFile,checksum} from './backup-manifest.mjs';
export const rehearsalStages=candidateRehearsalStages;
const same=(a,b)=>evidenceHash(a)===evidenceHash(b);
export function rehearsalInput(candidate,active,backup) {
  validateManifest(candidate?.manifest);validateActive(active);
  const manifest=candidate.manifest,core=candidate.reports?.core;
  if(candidate.status!=='candidate-only'||candidate.deployable!==false||candidate.provenance?.manifestHash!==evidenceHash(manifest)
    ||candidate.provenance.sourceCommit!==manifest.releaseCommit||!Number.isSafeInteger(candidate.provenance.releaseRunId)
    ||!/^sha256:[a-f0-9]{64}$/.test(candidate.provenance.planHash??'')||!/^([a-f0-9]{40})$/.test(candidate.provenance.controlCommit??''))throw Error('Published candidate provenance required');
  const evidence=manifest.validationEvidence.find(row=>row.gate==='core');
  if(core?.status!=='passed'||core.compositionFingerprint!==compositionFingerprint(manifest)||evidence?.reportHash!==evidenceHash(core))throw Error('Exact candidate core report required');
  if(manifest.previousReleaseId!==(isLegacyBaseline(active)?null:active.manifest.releaseId)||backup.releaseManifestHash!==evidenceHash(baselineDocument(active)))throw Error('Candidate, active release and backup predecessor differ');
  const baseline=databaseMigrationSet(active);
  if(!migrationBaselineMatches(active,manifest.migrationSet))migrationRehearsalRequest({active,manifest});
  if(!same([...backup.migrations].sort(),baseline.map(row=>row.id).sort()))throw Error('Backup migration ledger differs from observed active database');
  const historicalArtifactHashes=[...new Set([...backup.referencedArtifactHashes,baselineArtifact(active)])].sort();
  for(const hash of historicalArtifactHashes)if(!backup.files.some(row=>row.category==='rules-artifact'&&row.sha256===hash))throw Error('Historical executable missing from verified backup');
  return {schemaVersion:1,manifest,previousManifest:isLegacyBaseline(active)?null:active.manifest,...(isLegacyBaseline(active)?{legacyBaseline:baselineDocument(active)}:{}),active,backup,historicalArtifactHashes,
    candidateHash:evidenceHash(candidate),activeHash:evidenceHash(active),backupHash:evidenceHash(backup),compositionFingerprint:compositionFingerprint(manifest)};
}
export async function collectRehearsal(input,adapter,{runId=randomUUID(),onReport=async()=>{}}={}) {
  const report={schemaVersion:1,kind:input.localOnly===true?'local-candidate-rehearsal':'candidate-rehearsal',...(input.localOnly===true?{deployable:false,ciProvenance:null}:{}),execution:adapter.execution,status:'running',runId,
    candidateHash:input.candidateHash,activeHash:input.activeHash,backupHash:input.backupHash,
    compositionFingerprint:input.compositionFingerprint,releaseId:input.manifest.releaseId,startedAt:new Date().toISOString(),checks:[]};
  let failure,stage='start';
  try {
    const started=await adapter.start(input,runId);
    if(!migrationBaselineMatches(input.active,input.manifest.migrationSet)){
      validateMigrationRehearsal(input,started?.additiveMigrations);
      report.additiveMigrations=started.additiveMigrations;
    }else if(started?.additiveMigrations)throw Error('Unexpected additive migration receipt');
    for(const id of rehearsalStages){stage=id;const result=await adapter.check(id,input);if(!result||result.status!=='passed')throw Error(`Candidate rehearsal stage failed: ${id}`);report.checks.push({id,...result});}
  } catch(error){failure=error;report.failure='candidate-rehearsal-failed';report.failureStage=stage;
    // Only our fixed scenario IDs enter persisted diagnostics. The original
    // exception stays in memory and may contain private process details.
    if(error?.migrationReport){const m=error.migrationReport;report.migrationFailure={stage:migrationScenarios.includes(m.failureStage)?m.failureStage:'unavailable',
      completedScenarios:Array.isArray(m.checks)?m.checks.map(row=>row.id).filter(id=>migrationScenarios.includes(id)):[],
      cleanup:m.cleanup?.status==='trials-cleared'&&m.cleanup.remaining===0?'trials-cleared':'incomplete'};}
  }
  finally {
    try{report.cleanup=await adapter.cleanup();if(report.cleanup?.status!=='stopped'||report.cleanup.errors?.length)throw Error('Cleanup not proven');}
    catch{report.cleanup={status:'failed',errors:['owned-resource-cleanup-incomplete']};failure??=Error('Candidate cleanup incomplete');}
    report.status=failure?'failed':'passed';report.completedAt=new Date().toISOString();await onReport(report);
  }
  if(failure)throw Object.assign(Error('Candidate rehearsal failed; inspect safe stage receipt',{cause:failure}),{report});
  return report;
}
export function validateRehearsal(input,report) {
  if(report?.schemaVersion!==1||report.kind!==(input.localOnly===true?'local-candidate-rehearsal':'candidate-rehearsal')||input.localOnly===true&&(report.deployable!==false||report.ciProvenance!==null)||report.execution!=='docker'||report.status!=='passed'
    ||report.candidateHash!==input.candidateHash||report.activeHash!==input.activeHash||report.backupHash!==input.backupHash
    ||report.compositionFingerprint!==input.compositionFingerprint||report.releaseId!==input.manifest.releaseId
    ||report.cleanup?.status!=='stopped'||report.cleanup.errors?.length||!Number.isFinite(Date.parse(report.completedAt))
    ||!Array.isArray(report.checks)||!same(report.checks.map(row=>row.id),rehearsalStages)||report.checks.some(row=>row.status!=='passed'))throw Error('Complete exact-candidate Docker rehearsal required');
  const checks=Object.fromEntries(report.checks.map(row=>[row.id,row]));
  if(checks.snapshot.backupHash!==input.backupHash||checks.snapshot.schemaFingerprint!==input.backup.schemaFingerprint
    ||!same(checks.migrations.versions,input.manifest.migrationSet.map(row=>row.id).sort())
    ||checks['historical-inventory'].complete!==true||!same(checks['historical-inventory'].artifactHashes,input.historicalArtifactHashes)
    ||!same(checks['historical-replay'].artifactHashes,input.historicalArtifactHashes)||checks['historical-replay'].commands<1
    ||checks['pending-decision'].checked!==true||checks['duplicate-command'].checked!==true)throw Error('Rehearsal omits snapshot, history or durable command proof');
  if(!migrationBaselineMatches(input.active,input.manifest.migrationSet))validateMigrationRehearsal(input,report.additiveMigrations);
  else if(report.additiveMigrations)throw Error('Unexpected additive migration receipt');
  return checks;
}
export async function main(args) {
  if(args.length!==4||args[0]!=='run')throw Error('Usage: candidate-rehearsal.mjs run CANDIDATE_DIRECTORY CONFIG_JSON NEW_OUTPUT_DIRECTORY');
  const [,candidateDirectory,configFile,outputDirectory]=args;
  const read=async file=>JSON.parse(await readFile(file,'utf8'));
  const candidate=await read(path.join(candidateDirectory,'candidate.json')),config=await read(configFile);
  if(config.schemaVersion!==1||Object.keys(config).some(key=>!['schemaVersion','postgresImage','activeStateFile','backupDirectory','captureDirectory'].includes(key))
    ||!path.isAbsolute(config.activeStateFile??'')||Boolean(config.backupDirectory)===Boolean(config.captureDirectory)||!path.isAbsolute(config.backupDirectory??config.captureDirectory??'')
    ||!/^([a-z0-9][a-z0-9._:/-]*)@sha256:[a-f0-9]{64}$/.test(config.postgresImage??''))throw Error('Reviewed rehearsal host config required');
  const active=validateActive(await read(config.activeStateFile)),backupDirectory=config.backupDirectory??config.captureDirectory;
  let backup,capture;
  if(config.backupDirectory){await verifyDeploymentBackup(backupDirectory,baselineDocument(active));backup=await verifyBackup(backupDirectory);}
  else{
    capture=await read(backupFile(backupDirectory,'capture.json'));
    if(capture.schemaVersion!==1||capture.kind!=='candidate-capture'||capture.status!=='captured'||capture.activeHash!==evidenceHash(active)
      ||capture.releaseManifestHash!==evidenceHash(baselineDocument(active))||!Number.isFinite(Date.parse(capture.createdAt))||Date.parse(capture.createdAt)>Date.now()
      ||Date.now()-Date.parse(capture.createdAt)>30*60000||!Array.isArray(capture.files)||new Set(capture.files.map(row=>row.path)).size!==capture.files.length)throw Error('Fresh matching captured generation required');
    for(const file of capture.files){const bytes=await readFile(backupFile(backupDirectory,file.path));if(bytes.length!==file.bytes||await checksum(backupFile(backupDirectory,file.path))!==file.sha256)throw Error('Captured file changed');}
    const releases=capture.files.filter(row=>row.category==='release-manifest');if(releases.length!==1||evidenceHash(await read(backupFile(backupDirectory,releases[0].path)))!==evidenceHash(baselineDocument(active)))throw Error('Captured release differs');
  }
  const output=path.resolve(outputDirectory);await mkdir(output,{mode:0o700});
  const {createDockerRehearsal}=await import('./docker-rehearsal.mjs');
  const adapter=createDockerRehearsal({postgresImage:config.postgresImage,backupDirectory,directory:output});
  try{
    if(capture)backup=await adapter.prepareCapture(capture,active);
    const input=rehearsalInput(candidate,active,backup);
    await writeFile(path.join(output,'input.json'),JSON.stringify(input,null,2)+'\n',{flag:'wx',mode:0o600});
    await collectRehearsal(input,adapter,{onReport:async report=>{
      if(report.status==='passed'&&capture){
        const restore={schemaVersion:1,status:'passed',scope:'accepted-deployment-recovery',backupHash:input.backupHash,schemaFingerprint:backup.schemaFingerprint,
          rehearsalHash:evidenceHash(report),checks:['snapshot','artifacts','migrations','pending-decision','duplicate-command','media-references'].map(id=>({id,status:'passed'})),
          limitations:['media reference recovery; remote object bytes are outside this snapshot','Docker copy only; no live database mutations'],cleanup:report.cleanup};
        await writeFile(path.join(backupDirectory,'restore-report.json'),JSON.stringify(restore,null,2)+'\n',{flag:'wx',mode:0o600});
        await verifyDeploymentBackup(backupDirectory,baselineDocument(active));
      }
      await writeFile(path.join(output,'rehearsal.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
    }});
    await writeFile(path.join(output,'verified-backup.json'),JSON.stringify({backupDirectory})+'\n',{flag:'wx',mode:0o600});
  }finally{await adapter.cleanup();}
  process.stdout.write('Candidate Docker rehearsal passed; immutable receipt saved.\n');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).catch(()=>{process.stderr.write('Candidate rehearsal refused or failed; no deployable bundle produced.\n');process.exitCode=1;});
