// Bounded reread of original state. Reviewed terminal journals additionally
// require an owned read-only schema/ledger probe; no application writes or retry.
// The ordinary capture/rehearsal/adoption pipeline remains mandatory.
import {readFileSync,existsSync,realpathSync,lstatSync,readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {evidenceHash} from './validate-manifest.mjs';
import {loadControlRecovery,assertRecoveredInitialHistory,reviewedRecoveryAttempts} from './first-adoption-recovery.mjs';
import {deploymentStateFile,validateLegacyBaseline,legacyRuntimeFingerprint,legacyServices} from './legacy-baseline.mjs';
import {validateHostPacket} from './ssh-host-release.mjs';
import {validateReviewedReplayRefusal} from './reviewed-replay-refusal.mjs';
import {validateReviewedPreCutoverRefusal} from './reviewed-pre-cutover-refusal.mjs';
import {bindDeploymentDatabase} from './database-binding.mjs';
import {readDockerSchemaLedgerProof} from './read-snapshot.mjs';

const same=(a,b)=>evidenceHash(a)===evidenceHash(b);
function read(file,max=32*1024*1024) {
  if(realpathSync(file)!==path.resolve(file)||lstatSync(file).isSymbolicLink()||lstatSync(file).size>max)throw Error('Recovery protected file is invalid');
  return JSON.parse(readFileSync(file,'utf8'));
}
function docker(args,{input,env={}}={}) {
  try{return execFileSync('docker',args,{input,env:{...Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.toUpperCase().startsWith('PG'))),...env},encoding:'utf8',stdio:[input===undefined?'ignore':'pipe','pipe','pipe'],timeout:70000,maxBuffer:8*1024*1024,windowsHide:true}).trim();}
  catch{throw Error('Recovery live identity unavailable');}
}
function validatorAbsent(oldDirectory) {
  if(process.platform!=='linux')throw Error('Recovery process inspection requires the production Linux host');
  for(const id of readdirSync('/proc').filter(name=>/^[1-9]\d*$/.test(name))) {
    let bytes;try{bytes=readFileSync(`/proc/${id}/cmdline`);}catch(error){if(error.code==='ENOENT'||error.code==='ESRCH')continue;throw Error('Recovery process visibility is incomplete');}
    if(bytes.length>1024*1024)throw Error('Recovery process metadata exceeded bound');
    if(bytes.toString('utf8').split('\0').some(value=>value.includes(oldDirectory)))throw Error('Prior host attempt still has a live process');
  }
}
export async function observeRecoveredFirstHost({proof,request,config,underLock=false,command=docker,assertValidatorAbsent=validatorAbsent,readSchemaLedgerProof=readDockerSchemaLedgerProof}) {
  const root=path.resolve(config.root),attempts=reviewedRecoveryAttempts(proof);
  const privateDirectory=directory=>{if(realpathSync(directory)!==directory||!lstatSync(directory).isDirectory()||lstatSync(directory).isSymbolicLink()||process.platform!=='win32'&&(lstatSync(directory).mode&0o077)!==0)throw Error('Protected recovery directories required');};
  privateDirectory(root);
  const lock=path.join(root,'deploy.lock');
  if(underLock) {
    if(realpathSync(lock)!==lock||read(path.join(lock,'owner.json'),4096).pid!==process.pid)throw Error('Current deployment lock ownership differs');
  } else if(existsSync(lock))throw Error('Existing deployment lock requires explicit recovery');
  if(existsSync(path.join(root,'active.json'))||existsSync(path.join(root,'legacy-state.json')))throw Error('Prior attempt reached an unreviewed stage');
  const operations=path.join(root,'operations');
  const journals=attempts.filter(row=>row.stage==='deployment-pre-cutover-refusal');
  if(existsSync(operations)&&(realpathSync(operations)!==operations||!lstatSync(operations).isDirectory()
    ||!same(readdirSync(operations).sort(),journals.map(row=>row.releaseId+'.json').sort()))
    ||journals.length&&!existsSync(operations))throw Error('First adoption has an unreviewed or missing deployment journal');
  for(const row of attempts){
    const oldDirectory=path.join(request.attemptRoot,`deploy-${row.runId}-${row.runAttempt}`);privateDirectory(oldDirectory);
    const old=read(path.join(oldDirectory,'transfer.json')),previous=old.request;
    if(String(previous?.runId)!==String(row.runId)||Number(previous?.attempt)!==row.runAttempt
      ||previous.controlCommit!==row.controlCommit||previous.repository!==proof.repository||previous.eventName!=='workflow_dispatch'||previous.mode!==row.mode
      ||previous.attemptRoot!==request.attemptRoot||previous.hostConfig!==request.hostConfig)throw Error('Protected refused attempt does not match reviewed workflow');
    if(proof.schemaVersion!==1){
      validateHostPacket(old,oldDirectory);
      const candidate=JSON.parse(old.files['candidate.json'].text),ref=candidate.provenance?.firstAdoptionRecovery??null;
      if(previous.sourceCommit!==row.controlCommit||!same(ref,row.recoveryReference))throw Error('Prior transferred recovery authority changed');
      const scripts=['ci-release.mjs','deployment-handoff.mjs','automatic-release.mjs',...(row.stage==='rehearsal-start-refusal'?['prepare-host-release.mjs','candidate-rehearsal.mjs']:['first-adoption-recovery-host.mjs',...(['rehearsal-historical-replay-refusal','deployment-pre-cutover-refusal'].includes(row.stage)?['prepare-host-release.mjs','candidate-rehearsal.mjs']:[]),...(row.stage==='deployment-pre-cutover-refusal'?['assemble-bundle.mjs','deployment-handoff.mjs','automatic-release.mjs','deploy.mjs']:[])])];
      const phases=scripts.map((_,i)=>`phase-${String(i+1).padStart(2,'0')}.json`);
      if(!same(readdirSync(oldDirectory).filter(name=>name.startsWith('phase-')).sort(),phases))throw Error('Prior attempt phase prefix differs');
      for(const [i,file]of phases.entries())if(!same(read(path.join(oldDirectory,file),4096),{script:scripts[i],status:'started'}))throw Error('Prior attempt phase record differs');
    }
    if(['docker-auth','deployment-operation.json',...(row.stage==='deployment-pre-cutover-refusal'?['phase-11.json']:[row.stage==='rehearsal-historical-replay-refusal'?'phase-07.json':'phase-06.json','ready'])].some(name=>existsSync(path.join(oldDirectory,name))))throw Error('Prior attempt reached an unreviewed stage');
    if(row.stage==='pre-capture-recovery-refusal'){
      // Preparation writes outside the attempt. Absence of its local output is
      // insufficient: independently refuse the deterministic protected capture.
      if(['rehearsal','phase-05.json'].some(name=>existsSync(path.join(oldDirectory,name)))
        ||existsSync(path.join(root,'backups',`capture-${row.runId}-${row.runAttempt}`)))throw Error('Pre-capture refusal has later-stage evidence');
    }else if(row.stage==='deployment-pre-cutover-refusal'){
      const ready=path.join(oldDirectory,'ready');privateDirectory(ready);
      validateReviewedPreCutoverRefusal({candidate:JSON.parse(old.files['candidate.json'].text),input:read(path.join(oldDirectory,'rehearsal','input.json')),report:read(path.join(oldDirectory,'rehearsal','rehearsal.json')),
        manifest:read(path.join(ready,'manifest.json')),bundle:read(path.join(ready,'bundle.json')),operation:read(path.join(operations,row.releaseId+'.json')),row,proof});
    }else if(row.stage==='rehearsal-historical-replay-refusal'){
      validateReviewedReplayRefusal({candidate:JSON.parse(old.files['candidate.json'].text),input:read(path.join(oldDirectory,'rehearsal','input.json')),report:read(path.join(oldDirectory,'rehearsal','rehearsal.json')),row,proof});
    }else{
      const rehearsal=read(path.join(oldDirectory,'rehearsal','rehearsal.json'));
      if(rehearsal.status!=='failed'||rehearsal.failureStage!=='start'||rehearsal.activeHash!==proof.activeHash||rehearsal.cleanup?.status!=='stopped'||!Array.isArray(rehearsal.cleanup.errors)||rehearsal.cleanup.errors.length||!Number.isFinite(Date.parse(rehearsal.completedAt))||Date.parse(rehearsal.completedAt)>Date.parse(row.observedAt))throw Error('Prior rehearsal refusal or cleanup differs');
    }
    assertValidatorAbsent(oldDirectory);
  }
  const endpoint=JSON.parse(await command(['context','inspect','--format','{{json .Endpoints.docker.Host}}']));
  if(!/^(unix:\/\/|npipe:\/\/)/.test(endpoint)||process.env.DOCKER_HOST||process.env.DOCKER_CONTEXT)throw Error('Local Docker context required');
  // Refuse *any* outstanding rehearsal/inspection owner, not only names guessed
  // from an old report. This is intentionally conservative for first adoption.
  for(const label of ['bagofholding.rehearsal','bagofholding.legacy-inspection'])for(const kind of ['container','network','volume']) {
    const args=kind==='container'?['container','ls','-a']: [kind,'ls'];
    if((await command([...args,'--filter',`label=${label}`,'--format',kind==='volume'?'{{.Name}}':'{{.ID}}'])).trim())throw Error('Owned validation resources remain');
  }
  const active=validateLegacyBaseline(read(deploymentStateFile(config)));
  if(evidenceHash(active)!==proof.activeHash||active.claimedReleaseCommit!==proof.claimedReleaseCommit||!config.legacyBaselineDirectory)throw Error('Original protected active state changed');
  const rollback=read(path.join(config.legacyBaselineDirectory,'rollback.compose.json'));
  if(evidenceHash(rollback)!==active.rollbackConfigurationHash)throw Error('Original protected rollback bytes changed');
  let backend;
  for(const [key,service] of Object.entries(legacyServices)) {
    const expected=proof.components[key],baseline=active.components[key],actual=JSON.parse(await command(['container','inspect',expected.containerId]))[0];
    if(baseline.containerId!==expected.containerId||baseline.imageId!==expected.imageId||actual?.Id!==expected.containerId||actual.Image!==expected.imageId||actual.State?.Running!==true||actual.State?.Health?.Status!=='healthy'
      ||actual.Config?.Labels?.['com.docker.compose.service']!==service||legacyRuntimeFingerprint(actual)!==baseline.configurationHash)throw Error('Original live component changed');
    const url=key==='rulesWorker'?'http://127.0.0.1:8090/health':key==='backend'?'http://127.0.0.1:8080/api/health':'http://127.0.0.1:3000/build-info.json';
    const args=key==='rulesWorker'?['node','-e',`fetch('${url}').then(async r=>{if(!r.ok)process.exit(1);console.log(JSON.stringify(await r.json()))}).catch(()=>process.exit(1))`]:['wget','-qO-',url];
    const health=JSON.parse(await command(['exec',expected.containerId,...args]));
    if((health.source_commit??health.sourceCommit)!==proof.claimedReleaseCommit||key!=='frontend'&&health.status!=='ok'||key==='rulesWorker'&&health.artifactHash!==active.rulesArtifactHash)throw Error('Original application health identity changed');
    if(key==='backend')backend=actual;
  }
  if(journals.length){
    const image=JSON.parse(await command(['image','inspect',active.components.backend.imageId]))[0];
    const dsn=bindDeploymentDatabase(active,backend,image),databaseNetwork=`${config.project}_edge`,network=JSON.parse(await command(['network','inspect',databaseNetwork]));
    if(network.length!==1||network[0].Labels?.['com.docker.compose.project']!==config.project||network[0].Labels?.['com.docker.compose.network']!=='edge')throw Error('Recovered database network differs');
    const actual=await readSchemaLedgerProof({command,postgresImage:config.postgresImage,databaseNetwork,dsn});
    if(actual.schemaFingerprint!==active.schemaFingerprint||!same(actual.migrations,[...active.migrationIds].sort()))throw Error('Actual original database schema or ledger changed');
    for(const kind of ['container','network','volume']){
      const args=kind==='container'?['container','ls','-a']:[kind,'ls'];
      if((await command([...args,'--filter','label=bagofholding.legacy-inspection','--format',kind==='volume'?'{{.Name}}':'{{.ID}}'])).trim())throw Error('Recovery database observation resources remain');
    }
  }
  if(evidenceHash(read(deploymentStateFile(config)))!==proof.activeHash)throw Error('Original active state changed during recovery reread');
  return {status:'verified-pre-cutover-refusal',activeHash:proof.activeHash};
}
export async function verifyRecoveredHostAuthority({proof,request,get,observe}) {
  if((await get('commits/main')).sha!==request.controlCommit)throw Error('Manual first-adoption recovery has been superseded on main');
  await assertRecoveredInitialHistory(get,{proof,currentDeployment:{id:Number(request.runId),attempt:Number(request.attempt),controlCommit:request.controlCommit}});
  return observe();
}
export async function assertHostFirstAdoptionRecovery({directory,config,underLock=false,get,observe=observeRecoveredFirstHost}) {
  const packet=read(path.join(directory,'transfer.json')),request=validateHostPacket(packet,directory),candidate=JSON.parse(packet.files['candidate.json'].text),ref=candidate.provenance?.firstAdoptionRecovery;
  if(!ref)return {status:'not-requested'};
  if(request.eventName!=='workflow_dispatch'||request.mode!=='adopt'||request.controlCommit!==ref.controlCommit||request.sourceCommit!==request.controlCommit)throw Error('First recovery is explicit manual exact-control adoption only');
  const {proof}=loadControlRecovery({id:ref.id,reference:ref,controlRoot:path.join(directory,'control'),controlCommit:request.controlCommit,repository:request.repository});
  const query=get??(async route=>{
    if(!process.env.GITHUB_TOKEN)throw Error('Fresh read-only workflow authority required');
    const response=await fetch(`https://api.github.com/repos/${request.repository}/${route}`,{headers:{Authorization:`Bearer ${process.env.GITHUB_TOKEN}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error('Recovery workflow metadata unavailable');return response.json();
  });
  return verifyRecoveredHostAuthority({proof,request,get:query,observe:()=>observe({proof,request,config,underLock})});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try{const [directory,configFile,...extra]=process.argv.slice(2);if(!directory||!configFile||extra.length)throw Error('Exact current attempt and config required');
    process.stdout.write(JSON.stringify(await assertHostFirstAdoptionRecovery({directory,config:read(configFile)}))+'\n');
  }catch{process.stderr.write('Manual first-adoption recovery refused; inspect original attempt and protected live state.\n');process.exitCode=1;}
}
