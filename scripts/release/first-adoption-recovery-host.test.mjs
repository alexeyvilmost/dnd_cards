import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync,chmodSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {observeRecoveredFirstHost} from './first-adoption-recovery-host.mjs';
import {legacyRuntimeFingerprint} from './legacy-baseline.mjs';
import {evidenceHash,compositionFingerprint} from './validate-manifest.mjs';
import {rehearsalInput} from './candidate-rehearsal.mjs';
import {migrationScenarios} from './migration-transition.mjs';
import {reviewedRecoveryAttempts} from './first-adoption-recovery.mjs';
const hash=c=>'sha256:'+c.repeat(64),commit='a'.repeat(40);
function fixture(t) {
  const directory=mkdtempSync(path.join(tmpdir(),'first-recovery-'));t.after(()=>{assert.equal(path.dirname(directory),path.resolve(tmpdir()));assert.ok(path.basename(directory).startsWith('first-recovery-'));rmSync(directory,{recursive:true,force:true});});
  const root=path.join(directory,'protected'),attemptRoot=path.join(directory,'attempts'),old=path.join(attemptRoot,'deploy-5-1'),legacy=path.join(root,'legacy-observation-unit');
  for(const dir of [root,attemptRoot,old,legacy,path.join(old,'rehearsal')])mkdirSync(dir,{mode:0o700});
  const containers={},components={},publicComponents={};
  for(const [i,key] of ['backend','frontend','rulesWorker'].entries()) {
    const id=String(i+1).repeat(64),service=key==='rulesWorker'?'rules-worker':key,imageId=hash(String(i+4));
    const c={Id:id,Image:imageId,State:{Running:true,Health:{Status:'healthy'}},Config:{Env:['SOURCE_COMMIT='+commit,'PRIVATE_SENTINEL=not-public'],Labels:{'com.docker.compose.service':service}},HostConfig:{},Mounts:[],NetworkSettings:{Networks:{}}};
    containers[id]=c;components[key]={containerId:id,imageReference:'fixture/'+key,imageId,healthy:true,runtimeClaim:commit,configurationHash:legacyRuntimeFingerprint(c)};publicComponents[key]={containerId:id,imageId,health:'healthy'};
  }
  const rollback={services:{unit:{environment:{PRIVATE_SENTINEL:'not-public'}}}};
  const body={schemaVersion:1,kind:'observed-legacy-baseline',status:'observed',provenance:'runtime-observation-only',deployable:false,observedAt:'2026-10-05T06:00:00.000Z',claimedReleaseCommit:commit,components,rulesArtifactHash:hash('c'),rollbackConfigurationHash:evidenceHash(rollback),databaseIdentityHash:hash('d'),schemaFingerprint:hash('e'),migrationIds:['001_fixture'],artifactHashes:[hash('c')],historicalChecksums:'unavailable',bakedIdentity:'unavailable'};
  const active={...body,observationHash:evidenceHash(body)},request={attemptRoot,hostConfig:'/protected/config.json'},config={root,legacyBaselineDirectory:legacy};
  const proof={schemaVersion:1,kind:'manual-first-adoption-recovery',status:'reviewed-pre-cutover-refusal',id:'5-1',auditHash:hash('a'),activeHash:evidenceHash(active),claimedReleaseCommit:commit,failedDeployment:{runId:5,runAttempt:1,controlCommit:commit,conclusion:'failure'},repository:'fixture/project',components:publicComponents,observedAt:'2026-10-05T08:00:00.000Z',
    cleanup:{remainingOwnedResources:0,validatorStopped:true,dockerAuthRemoved:true,deploymentJournalCreated:false,deployLockPresent:false,operatorApplicationMutations:0}};
  const save=(file,data)=>writeFileSync(file,JSON.stringify(data),{mode:0o600});
  save(path.join(legacy,'baseline.json'),active);save(path.join(legacy,'rollback.compose.json'),rollback);
  save(path.join(old,'transfer.json'),{request:{...request,runId:'5',attempt:'1',controlCommit:commit,repository:proof.repository,eventName:'workflow_dispatch',mode:'adopt'}});
  save(path.join(old,'rehearsal','rehearsal.json'),{status:'failed',failureStage:'start',activeHash:proof.activeHash,completedAt:'2026-10-05T07:00:00.000Z',cleanup:{status:'stopped',errors:[]}});
  const calls=[];let owned=false,processLive=false;
  const command=async args=>{
    calls.push(args);if(args[0]==='context')return JSON.stringify('unix:///var/run/docker.sock');
    if(args[1]==='ls')return owned?'leftover':'';
    if(args[0]==='container'&&args[1]==='inspect')return JSON.stringify([containers[args[2]]]);
    if(args[0]==='exec')return JSON.stringify({status:'ok',sourceCommit:commit,artifactHash:active.rulesArtifactHash});
    throw Error('Forbidden non-read-only Docker call');
  };
  const invoke=(extra={})=>observeRecoveredFirstHost({proof,request,config,command,assertValidatorAbsent:()=>{if(processLive)throw Error('live');},...extra});
  return {root,old,legacy,active,proof,request,config,containers,calls,save,invoke,setOwned:v=>owned=v,setProcess:v=>processLive=v};
}
test('real protected files and live read-only identities permit only original pre-cutover state',async t=>{
  const f=fixture(t),before=readFileSync(path.join(f.legacy,'baseline.json'));
  assert.equal((await f.invoke()).status,'verified-pre-cutover-refusal');
  assert.deepEqual(readFileSync(path.join(f.legacy,'baseline.json')),before);
  assert.ok(!JSON.stringify(await f.invoke()).includes('PRIVATE_SENTINEL'));
  assert.ok(f.calls.every(args=>['context','container','network','volume','exec'].includes(args[0])));
  assert.deepEqual(readdirSync(f.root).sort(),['legacy-observation-unit']);
});
test('old journal, next phase, ready bundle, credentials or leftover resources fail before capture',async t=>{
  const f=fixture(t);
  for(const name of ['phase-06.json','deployment-operation.json','ready','docker-auth']) {
    const file=path.join(f.old,name);f.save(file,{});await assert.rejects(f.invoke());rmSync(file);
  }
  mkdirSync(path.join(f.root,'operations'));f.save(path.join(f.root,'operations','unexpected.json'),{});await assert.rejects(f.invoke());rmSync(path.join(f.root,'operations','unexpected.json'));
  f.setOwned(true);await assert.rejects(f.invoke(),/resources remain/);f.setOwned(false);
  f.setProcess(true);await assert.rejects(f.invoke(),/live/);
});
test('rehash of changed baseline cannot substitute original active; runtime env and health remain bound',async t=>{
  const f=fixture(t),file=path.join(f.legacy,'baseline.json'),forged=structuredClone(f.active);
  forged.databaseIdentityHash=hash('9');const {observationHash,...body}=forged;forged.observationHash=evidenceHash(body);f.save(file,forged);await assert.rejects(f.invoke(),/state changed/);f.save(file,f.active);
  const c=Object.values(f.containers)[0];c.Config.Env.push('CHANGED=1');await assert.rejects(f.invoke(),/component changed/);c.Config.Env.pop();
  c.State.Health.Status='unhealthy';await assert.rejects(f.invoke(),/component changed/);
});
test('under-lock check requires the current process owner and still refuses old operation evidence',async t=>{
  const f=fixture(t),lock=path.join(f.root,'deploy.lock');mkdirSync(lock,{mode:0o700});f.save(path.join(lock,'owner.json'),{pid:process.pid});
  await assert.rejects(f.invoke(),/Existing deployment lock/);await f.invoke({underLock:true});
  f.save(path.join(lock,'owner.json'),{pid:process.pid+1});await assert.rejects(f.invoke({underLock:true}),/ownership/);
});

function chainFixture(t){
 const f=fixture(t),second=path.join(f.request.attemptRoot,'deploy-6-1'),later='b'.repeat(40);mkdirSync(second,{mode:0o700});
 const row={runId:6,runAttempt:1,controlCommit:later,conclusion:'failure',mode:'adopt',stage:'pre-capture-recovery-refusal',observedAt:'2026-10-05T09:00:00.000Z',auditHash:hash('b'),recoveryReference:{id:f.proof.id,proofHash:evidenceHash(f.proof),controlCommit:later}};
 const {failedDeployment,...base}=f.proof,proof={...base,schemaVersion:2,id:'6-1',observedAt:row.observedAt,auditHash:row.auditHash,failedDeployments:[...reviewedRecoveryAttempts(f.proof),row]};
 const digest=text=>'sha256:'+createHash('sha256').update(text).digest('hex');
 function packet(item){
  const req={schemaVersion:1,...f.request,runId:String(item.runId),attempt:'1',controlCommit:item.controlCommit,sourceCommit:item.controlCommit,repository:proof.repository,actor:'fixture',eventName:'workflow_dispatch',mode:'adopt',rehearsalConfig:'/protected/rehearsal.json',nodePath:'/usr/local/bin/node',productionEnabled:'true'};
  const manifest={schemaVersion:1,releaseId:'attempt-'+item.runId,releaseCommit:req.sourceCommit,previousReleaseId:null,createdAt:'2026-10-05T00:00:00Z',
   components:Object.fromEntries(['frontend','backend','rulesWorker'].map((key,i)=>[key,{sourceCommit:req.sourceCommit,inputFingerprint:hash(String(i+1)),imageDigest:`example.test/${key.toLowerCase()}@${hash(String(i+4))}`} ])),
   rulesArtifactHash:hash('a'),contentManifestHash:hash('b'),apiProtocolVersion:1,workerProtocolVersion:1,supportedWorldSchemaVersions:[5],workerRuntime:{name:'node',version:'24.19.0'},capabilities:['pinned-artifact-routing','pending-decision-pass-through'],migrationSet:[{id:'001',checksum:hash('c')}],validationEvidence:[{gate:'core',status:'passed',reportHash:hash('d'),inputFingerprint:hash('e'),completedAt:'2026-10-05T00:00:00Z'}]};
  const provenance={schemaVersion:1,releaseRunId:9,controlCommit:req.controlCommit,sourceCommit:req.sourceCommit,planHash:hash('f'),manifestHash:evidenceHash(manifest),...(item.recoveryReference?{firstAdoptionRecovery:item.recoveryReference}:{})};
  const files={'candidate.json':{manifest,provenance},'manifest.json':manifest,'core-report.json':{status:'passed'},'verified-release-run.json':{id:9,workflow:'.github/workflows/release.yml',controlCommit:req.controlCommit}};
  return {request:req,archiveHash:hash('0'),files:Object.fromEntries(Object.entries(files).map(([file,value])=>{const text=JSON.stringify(value);return [file,{text,sha256:digest(text)}];}))};
 }
 const oldPacket=packet(proof.failedDeployments[0]),newPacket=packet(row);
 f.save(path.join(f.old,'transfer.json'),oldPacket);f.save(path.join(second,'transfer.json'),newPacket);
 for(const [directory,scripts] of [[f.old,['ci-release.mjs','deployment-handoff.mjs','automatic-release.mjs','prepare-host-release.mjs','candidate-rehearsal.mjs']],[second,['ci-release.mjs','deployment-handoff.mjs','automatic-release.mjs','first-adoption-recovery-host.mjs']]])scripts.forEach((script,i)=>f.save(path.join(directory,`phase-${String(i+1).padStart(2,'0')}.json`),{script,status:'started'}));
 return {...f,proof,second,newPacket,digest,packet,invoke:(extra={})=>f.invoke({proof,...extra})};
}
test('Linux schema2 validates real transferred packets and exact typed phase prefixes without inventing a rehearsal', {skip:process.platform!=='linux'},async t=>{
 const f=chainFixture(t),before=readFileSync(path.join(f.second,'transfer.json')),seen=[];
 assert.equal((await f.invoke({assertValidatorAbsent:directory=>seen.push(directory)})).status,'verified-pre-cutover-refusal');
 assert.deepEqual(seen,[f.old,f.second]);assert.equal(existsSync(path.join(f.second,'rehearsal')),false);assert.deepEqual(readFileSync(path.join(f.second,'transfer.json')),before);
 const lock=path.join(f.root,'deploy.lock');mkdirSync(lock,{mode:0o700});f.save(path.join(lock,'owner.json'),{pid:process.pid});await f.invoke({underLock:true});
 f.save(path.join(lock,'owner.json'),{pid:process.pid+1});await assert.rejects(f.invoke({underLock:true}),/ownership/);
});
test('Linux recovery keeps actual0700 requirement;0755root or old attempt is refused', {skip:process.platform!=='linux'},async t=>{
 const f=chainFixture(t);await f.invoke();
 for(const directory of [f.root,f.old,f.second]){chmodSync(directory,0o755);await assert.rejects(f.invoke(),/Protected recovery directories/);chmodSync(directory,0o700);await f.invoke();}
});
test('Linux pre-capture chain rejects later phases/capture, altered packet authority and changed phase records', {skip:process.platform!=='linux'},async t=>{
 const f=chainFixture(t),backupRoot=path.join(f.root,'backups');mkdirSync(backupRoot,{mode:0o700});
 for(const target of [path.join(f.second,'phase-05.json'),path.join(f.second,'ready'),path.join(f.second,'deployment-operation.json'),path.join(f.second,'docker-auth'),path.join(f.second,'rehearsal'),path.join(backupRoot,'capture-6-1')]){
  f.save(target,{});await assert.rejects(f.invoke());rmSync(target);await f.invoke();
 }
 const phase=path.join(f.second,'phase-04.json');for(const value of [{script:'prepare-host-release.mjs',status:'started'},{script:'first-adoption-recovery-host.mjs',status:'passed'},{script:'first-adoption-recovery-host.mjs',status:'started',private:'PRIVATE_CANARY'}]){f.save(phase,value);await assert.rejects(f.invoke(),/phase record differs/);}
 f.save(phase,{script:'first-adoption-recovery-host.mjs',status:'started'});
 const transferred=structuredClone(f.newPacket),candidate=JSON.parse(transferred.files['candidate.json'].text);candidate.provenance.firstAdoptionRecovery.proofHash=hash('0');const text=JSON.stringify(candidate);transferred.files['candidate.json']={text,sha256:f.digest(text)};f.save(path.join(f.second,'transfer.json'),transferred);
 await assert.rejects(f.invoke(),/authority changed/);f.save(path.join(f.second,'transfer.json'),f.newPacket);
 const oldRehearsal=path.join(f.old,'rehearsal','rehearsal.json'),saved=readFileSync(oldRehearsal);f.save(oldRehearsal,{status:'failed',failureStage:'start',activeHash:f.proof.activeHash,completedAt:'2026-10-05T07:00:00Z',cleanup:{status:'incomplete',errors:[]}});await assert.rejects(f.invoke(),/cleanup differs/);writeFileSync(oldRehearsal,saved);await f.invoke();
 const wrong=structuredClone(f.proof);wrong.failedDeployments[0].stage='pre-capture-recovery-refusal';await assert.rejects(f.invoke({proof:wrong}));
});

function replayFailureFixture(t){
 const f=chainFixture(t),third=path.join(f.request.attemptRoot,'deploy-7-1');mkdirSync(third,{mode:0o700});mkdirSync(path.join(third,'rehearsal'),{mode:0o700});
 const row={runId:7,runAttempt:1,controlCommit:'c'.repeat(40),conclusion:'failure',mode:'adopt',stage:'rehearsal-historical-replay-refusal',observedAt:'2026-10-05T10:30:00.000Z',auditHash:hash('3'),rehearsalHash:hash('4'),recoveryReference:{id:f.proof.id,proofHash:evidenceHash(f.proof),controlCommit:'c'.repeat(40)}};
 const packet=f.packet(row),candidate=JSON.parse(packet.files['candidate.json'].text),manifest=candidate.manifest;
 const baseline=f.active.migrationIds.map(id=>({id,kind:'observed-id-only',observationHash:f.active.observationHash}));
 manifest.migrationSet=[...baseline,...['298_compact_command_receipts','299_frozen_combat_catalogs','300_image_jobs'].map(id=>({id,checksum:hash('e')}))];
 const core={status:'passed',compositionFingerprint:compositionFingerprint(manifest)};manifest.validationEvidence[0]={...manifest.validationEvidence[0],inputFingerprint:core.compositionFingerprint,reportHash:evidenceHash(core)};
 candidate.status='candidate-only';candidate.deployable=false;candidate.reports={core};candidate.provenance.manifestHash=evidenceHash(manifest);
 for(const [file,value]of Object.entries({'candidate.json':candidate,'manifest.json':manifest,'core-report.json':core})){const text=JSON.stringify(value);packet.files[file]={text,sha256:f.digest(text)};}
 const backup={migrations:f.active.migrationIds,releaseManifestHash:evidenceHash(f.active),schemaFingerprint:f.active.schemaFingerprint,referencedArtifactHashes:[f.active.rulesArtifactHash],files:[{category:'rules-artifact',sha256:f.active.rulesArtifactHash}]};
 const input=rehearsalInput(candidate,f.active,backup);
 const cases={
  'atomic-ddl-ledger':{historyHash:hash('1'),schemaProofHash:hash('2'),versions:manifest.migrationSet.map(entry=>entry.id).sort()},
  'crash-before-ledger':{transactionRolledBack:true,restartPassed:true,committedBaselineHash:hash('3')},
  'repeat-after-commit':{reapplied:0,schemaProofHash:hash('2'),historyHash:hash('1')},
  'same-connection-lock':{startupLockShared:true,ddlAndLedgerSessionVerified:true},'unknown-migration-rejected':{rejected:true,committedStateHash:hash('4')},
  'schema-proof':{tamperedTriggerRejected:true,noSilentRepair:true},'old-readers-after-expansion':{checked:true,writerFlagsOff:true,pendingHash:hash('5'),acceptedHash:hash('6'),invariantHash:hash('7')},
 };
 const migration={schemaVersion:1,kind:'additive-migration-rehearsal',execution:'docker',status:'passed',candidateHash:input.candidateHash,candidateSourceCommit:manifest.components.backend.sourceCommit,candidateInputFingerprint:manifest.components.backend.inputFingerprint,baseline:f.active.migrationIds.map(id=>({id})),target:manifest.migrationSet,baselineObservationHash:f.active.observationHash,compositionFingerprint:input.compositionFingerprint,backwardCompatible:true,rollbackWriters:'off',scenarios:[...migrationScenarios],checks:migrationScenarios.map(id=>({id,status:'passed',...cases[id]})),cleanup:{status:'trials-cleared',remaining:0}};
 const report={schemaVersion:1,kind:'candidate-rehearsal',execution:'docker',status:'failed',failure:'candidate-rehearsal-failed',failureStage:'historical-replay',activeHash:input.activeHash,candidateHash:input.candidateHash,backupHash:input.backupHash,compositionFingerprint:input.compositionFingerprint,releaseId:manifest.releaseId,startedAt:'2026-10-05T10:00:00.000Z',completedAt:'2026-10-05T10:20:00.000Z',cleanup:{status:'stopped',errors:[],resourceCount:26},checks:[
  {id:'snapshot',status:'passed',backupHash:input.backupHash,schemaFingerprint:backup.schemaFingerprint},{id:'migrations',status:'passed',versions:manifest.migrationSet.map(entry=>entry.id).sort()},
  {id:'full-candidate-health',status:'passed'},{id:'image-contract',status:'passed'},{id:'historical-inventory',status:'passed',complete:true,artifactHashes:input.historicalArtifactHashes}],
  additiveMigrations:{report:migration,approval:{schemaVersion:1,mode:'additive-298-300',baseline:migration.baseline,target:migration.target,baselineObservationHash:f.active.observationHash,compositionFingerprint:input.compositionFingerprint,reportHash:evidenceHash(migration)}}};
 row.rehearsalHash=evidenceHash(report);
 const proof={...f.proof,id:'7-1',observedAt:row.observedAt,auditHash:row.auditHash,failedDeployments:[...f.proof.failedDeployments,row]};
 f.save(path.join(third,'transfer.json'),packet);f.save(path.join(third,'rehearsal','input.json'),input);f.save(path.join(third,'rehearsal','rehearsal.json'),report);
 ['ci-release.mjs','deployment-handoff.mjs','automatic-release.mjs','first-adoption-recovery-host.mjs','prepare-host-release.mjs','candidate-rehearsal.mjs'].forEach((script,i)=>f.save(path.join(third,`phase-${String(i+1).padStart(2,'0')}.json`),{script,status:'started'}));
 return {...f,third,row,proof,report,input,invoke:extra=>f.invoke({proof,...extra})};
}
test('Linux third refusal binds exact six started phases, complete failed replay receipt and earlier attempts', {skip:process.platform!=='linux'},async t=>{
 const f=replayFailureFixture(t),reportFile=path.join(f.third,'rehearsal','rehearsal.json'),original=readFileSync(reportFile),seen=[];
 await f.invoke({assertValidatorAbsent:directory=>seen.push(directory)});assert.deepEqual(seen,[f.old,f.second,f.third]);assert.deepEqual(readFileSync(reportFile),original);
 for(const name of ['phase-07.json','ready','deployment-operation.json','docker-auth']){const file=path.join(f.third,name);f.save(file,{});await assert.rejects(f.invoke());rmSync(file);}
 const phase=path.join(f.third,'phase-06.json');rmSync(phase);await assert.rejects(f.invoke(),/phase prefix/);f.save(phase,{script:'candidate-rehearsal.mjs',status:'passed'});await assert.rejects(f.invoke(),/phase record/);f.save(phase,{script:'candidate-rehearsal.mjs',status:'started'});
 for(const mutate of [r=>r.failureStage='pending-decision',r=>r.cleanup.errors.push('private-canary'),r=>r.checks.pop(),r=>r.additiveMigrations.report.checks[3].ddlAndLedgerSessionVerified=false]){
  const changed=structuredClone(f.report);mutate(changed);changed.additiveMigrations.approval.reportHash=evidenceHash(changed.additiveMigrations.report);const forged=structuredClone(f.proof);forged.failedDeployments[2].rehearsalHash=evidenceHash(changed);f.save(reportFile,changed);await assert.rejects(f.invoke({proof:forged}));
 }writeFileSync(reportFile,original);await f.invoke();
 const changed=structuredClone(f.report);changed.completedAt='2026-10-05T10:21:00.000Z';f.save(reportFile,changed);await assert.rejects(f.invoke(),/refusal differs/);
});
