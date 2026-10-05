import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {observeRecoveredFirstHost} from './first-adoption-recovery-host.mjs';
import {legacyRuntimeFingerprint} from './legacy-baseline.mjs';
import {evidenceHash} from './validate-manifest.mjs';
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
  const proof={activeHash:evidenceHash(active),claimedReleaseCommit:commit,failedDeployment:{runId:5,runAttempt:1,controlCommit:commit},repository:'fixture/project',components:publicComponents,observedAt:'2026-10-05T08:00:00.000Z'};
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
