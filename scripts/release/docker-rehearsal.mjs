// Real disposable-container adapter. It never invokes compose or a live app.
import {readFile,writeFile,unlink} from 'node:fs/promises';
import {randomBytes,randomUUID,createHmac} from 'node:crypto';
import path from 'node:path';
import {backupFile,checksum} from './backup-manifest.mjs';
import {readDockerInventory} from './read-snapshot.mjs';
import {assertServiceIdentities} from './deploy-state.mjs';
import {evidenceHash} from './validate-manifest.mjs';
import {writerEnvironment,assertRuntimeWriterPolicy} from './writer-environment.mjs';
import {writerHealthIdentity,historyWriterPolicy} from './writer-health-identity.mjs';
import {collectHostWriterStage} from './writer-host-stage.mjs';
import {probeRetainedWriterHistory} from './writer-retained-history.mjs';
import {createWriterHistoryDocker} from './writer-history-docker.mjs';
import {normalizeMediaReferences} from './reference-values.mjs';
import {createCanonicalPendingScenario,acceptedReceiptReplay,authorizeDockerRehearsal} from './rehearsal-scenarios.mjs';
import {dockerCommand} from './rehearsal-command.mjs';
import {availableRestoreBytes,disposablePostgresOptions,restoreDiskReserve,restoreOwnedDatabase} from './owned-database-restore.mjs';
export {dockerCommand} from './rehearsal-command.mjs';
import {databaseMigrationSet,migrationBaselineMatches} from './migration-transition.mjs';
import {isLegacyBaseline,baselineDocument,baselineArtifact} from './legacy-baseline.mjs';
import {verifyBackupSourceReleases} from './source-release-references.mjs';
import {runMigrationRehearsal,createMigrationDockerAdapter} from './migration-rehearsal.mjs';

const uuid=value=>{if(!/^[a-f0-9-]{36}$/.test(value))throw Error('Invalid snapshot entity identity');return value;};
const equal=(a,b)=>evidenceHash(a)===evidenceHash(b);
const readJSON=async file=>JSON.parse(await readFile(file,'utf8'));
export function createDockerRehearsal({postgresImage,backupDirectory,directory,executeDocker=dockerCommand}) {
  const run=`rehearsal_${randomBytes(12).toString('hex')}`,label=`bagofholding.rehearsal=${run}`;
  const names={postgres:`${run}_db`,rulesWorker:`${run}_worker`,backend:`${run}_api`,frontend:`${run}_ui`,network:`${run}_net`,volume:`${run}_artifacts`,pgVolume:`${run}_pgdata`};
  const secrets={database:randomBytes(32).toString('hex'),worker:randomBytes(32).toString('hex'),jwt:randomBytes(32).toString('hex')};
  const secretFiles=[],resources=[],identities={},images={};let executionRunId;let inventory,pending,receipt,pgReady=false,artifactsReady=false,aborted=false,generation=0,cleanupPromise;
  const interrupt=()=>{aborted=true;};
  const command=(args,options)=>{if(aborted)throw Error('Rehearsal interrupted');return executeDocker(args,options);};
  const query=sql=>command(['exec','-i',names.postgres,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','rehearsal','-d','rehearsal'],{input:sql});
  const queryJSON=async sql=>JSON.parse(await query(sql));
  async function envFile(name,values){const file=path.join(directory,`${name}.env`);await writeFile(file,Object.entries(values).map(([key,value])=>`${key}=${value}`).join('\n')+'\n',{flag:'wx',mode:0o600});secretFiles.push(file);return file;}
  async function resource(kind,name,args){resources.push({kind,name});return command(args);}
  async function wait(probe){const until=Date.now()+120000;while(Date.now()<until){if(aborted)throw Error('Rehearsal interrupted');try{const value=await probe();if(value)return value;}catch{}await new Promise(resolve=>setTimeout(resolve,250));}throw Error('Candidate readiness deadline exceeded');}
  async function startDatabase(files) {
    if(pgReady)return;
    process.once('SIGINT',interrupt);process.once('SIGTERM',interrupt);
    const endpoint=JSON.parse(await command(['context','inspect','--format','{{json .Endpoints.docker.Host}}']));
    if(!/^(unix:\/\/|npipe:\/\/)/.test(endpoint)||process.env.DOCKER_HOST||process.env.DOCKER_CONTEXT)throw Error('Only the default local Docker daemon is permitted');
    await command(['pull',postgresImage]);
    await resource('network',names.network,['network','create','--internal','--label',label,names.network]);
    const network=JSON.parse(await command(['network','inspect',names.network]))[0];
    if(network.Internal!==true||network.Labels?.['bagofholding.rehearsal']!==run)throw Error('Owned network must deny external egress');
    const pgEnv=await envFile('postgres',{POSTGRES_USER:'rehearsal',POSTGRES_DB:'rehearsal',POSTGRES_PASSWORD:secrets.database});
    await resource('volume',names.pgVolume,['volume','create','--label',label,names.pgVolume]);
    const spaceName=`${run}_storage_probe`;
    const space=await resource('container',spaceName,['run','--name',spaceName,'--label',label,'--network','none','--read-only','--mount',`type=volume,source=${names.pgVolume},target=/data`,'--entrypoint','df',postgresImage,'-Pk','/data']);
    const available=availableRestoreBytes(space);
    const dumpBytes=files.filter(row=>row.category==='database').reduce((sum,row)=>sum+row.bytes,0);
    if(available<dumpBytes*4+restoreDiskReserve)throw Error('Insufficient disposable Docker storage for database restore');
    await resource('container',names.postgres,['run','-d','--name',names.postgres,'--label',label,'--network',names.network,'--network-alias','postgres',
      '--env-file',pgEnv,'--mount',`type=volume,source=${names.pgVolume},target=/var/lib/postgresql/data`,postgresImage,...disposablePostgresOptions]);
    // The image's temporary initialization server accepts Unix sockets before
    // it shuts down. Only TCP readiness proves the final server is available.
    await wait(async()=>{await command(['exec',names.postgres,'pg_isready','-h','127.0.0.1','-U','rehearsal','-d','rehearsal']);return true;});
    const dumps=files.filter(row=>row.category==='database');if(dumps.length!==1)throw Error('Exactly one captured dump required');
    await restoreOwnedDatabase({command,names,owner:run,database:'rehearsal',inputFile:backupFile(backupDirectory,dumps[0].path),dumpBytes:dumps[0].bytes});
    pgReady=true;
    const inventoryURL=new URL('postgres://postgres:5432/rehearsal?sslmode=disable');inventoryURL.username='rehearsal';inventoryURL.password=secrets.database;
    inventory=await readDockerInventory({command,cleanupCommand:executeDocker,postgresImage,databaseNetwork:names.network,dsn:inventoryURL.href});
  }
  const apiProgram=`process.stdin.setEncoding('utf8');let raw='';for await(const chunk of process.stdin)raw+=chunk;const request=JSON.parse(raw);const response=await fetch(request.url,{method:request.method??'GET',headers:request.headers,body:request.body===undefined?undefined:JSON.stringify(request.body),signal:AbortSignal.timeout(60000)});const text=await response.text();let body;try{body=JSON.parse(text)}catch{body=null};process.stdout.write(JSON.stringify({status:response.status,body}));`;
  async function request(url,options={}){const result=JSON.parse(await command(['exec','-i',names.rulesWorker,'node','--input-type=module','-e',apiProgram],{input:JSON.stringify({url,...options})}));if(!(options.acceptedStatuses??[200]).includes(result.status))throw Error('Candidate HTTP contract failed');return result.body;}
  const canonicalScenario=async label=>createCanonicalPendingScenario(await authorizeDockerRehearsal({names,owner:run}),{label});
  function token(user){const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');const now=Math.floor(Date.now()/1000);const body=`${encode({alg:'HS256',typ:'JWT'})}.${encode({user_id:user.user_id,username:user.username,sub:user.user_id,iss:'dnd-cards-backend',iat:now,exp:now+3600})}`;return `${body}.${createHmac('sha256',secrets.jwt).update(body).digest('base64url')}`;}
  const authenticated=(route,body)=>request(`http://backend:8080/api/roguelike/runs/${uuid(pending.id)}${route}`,{method:body?'POST':'GET',headers:{authorization:`Bearer ${token(pending)}`,'content-type':'application/json'},...(body?{body}:{})});
  async function invariant(){return queryJSON(`SELECT json_build_object('run',md5(to_jsonb(r)::text),'characters',(SELECT md5(coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id)::text,'')) FROM characters_v3 c WHERE c.user_id=r.user_id),'receipts',(SELECT md5(coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id)::text,'')) FROM roguelike_command_receipts c WHERE c.run_id=r.id),'events',(SELECT md5(coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.revision)::text,'')) FROM roguelike_combat_events e WHERE e.run_id=r.id)) FROM roguelike_runs r WHERE r.id='${uuid(pending.id)}';`);}
  async function startApplications(original,manifest=original.manifest) {
    const input={...original,manifest};generation++;
    const legacy=isLegacyBaseline(manifest),image=key=>legacy?manifest.components[key].imageId:manifest.components[key].imageDigest;
    for(const key of Object.keys(input.manifest.components))await command(legacy?['image','inspect',image(key)]:['pull',image(key)]);
    if(!artifactsReady){
    await resource('volume',names.volume,['volume','create','--label',label,names.volume]);
    const artifactFiles=input.backup.files.filter(row=>row.category==='rules-artifact');
    const copyProgram=`import{readFile,writeFile,chmod}from'node:fs/promises';import{createHash}from'node:crypto';process.stdin.setEncoding('utf8');let raw='';for await(const c of process.stdin)raw+=c;for(const row of JSON.parse(raw)){const bytes=await readFile('/input/'+row.path);if('sha256:'+createHash('sha256').update(bytes).digest('hex')!==row.sha256)throw Error('artifact mismatch');await writeFile('/artifacts/'+row.sha256.slice(7)+'.cjs',bytes,{flag:'wx',mode:0o444})}await chmod('/artifacts',0o777);`;
    const copyName=`${run}_artifact_copy`;
    resources.push({kind:'container',name:copyName});
    await command(['run','-i','--name',copyName,'--label',label,'--network','none','--read-only','--user','0','--mount',`type=bind,source=${backupDirectory},target=/input,readonly`,'--mount',`type=volume,source=${names.volume},target=/artifacts`,'--entrypoint','node',image('rulesWorker'),'--input-type=module','-e',copyProgram],{input:JSON.stringify(artifactFiles)});
    artifactsReady=true;
    }
    const common=key=>{const launch=manifest===original.previousManifest?original.active.instances[key]:{releaseId:manifest.releaseId,releaseCommit:manifest.releaseCommit};return legacy?{SOURCE_COMMIT:manifest.claimedReleaseCommit}:{RELEASE_ID:launch.releaseId,RELEASE_COMMIT:launch.releaseCommit};};
    const workerEnv=await envFile(`worker-${generation}`,{...common('rulesWorker'),PORT:'8090',RULES_WORKER_TOKEN:secrets.worker,RULES_ARTIFACTS_DIR:'/artifacts',RULES_ARTIFACT_FILE:'/app/artifact.cjs'});
    await resource('container',names.rulesWorker,['run','-d','--name',names.rulesWorker,'--label',label,'--network',names.network,'--network-alias','rules-worker','--read-only','--env-file',workerEnv,'--mount',`type=volume,source=${names.volume},target=/artifacts`,image('rulesWorker')]);
    await wait(()=>request('http://127.0.0.1:8090/health'));
    const databaseUrl=new URL('postgres://postgres:5432/rehearsal?sslmode=disable');databaseUrl.username='rehearsal';databaseUrl.password=secrets.database;
    const backendEnv=await envFile(`backend-${generation}`,{...common('backend'),PORT:'8080',DATABASE_URL:databaseUrl.href,JWT_SECRET:secrets.jwt,
      // User jobs copied in a full backup must never be dispatched by rehearsal.
      // Exact deployment ON policy is exercised only in the separate public
      // format fixture. This full-history profile remains explicitly OFF.
      RULES_WORKER_URL:'http://rules-worker:8090',RULES_WORKER_TOKEN:secrets.worker,...writerEnvironment({writerPolicy:historyWriterPolicy}),OPENAI_API_KEY:'',OPENAI_BASE_URL:'http://127.0.0.1:1/v1',CONTENT_ADMIN_USER_IDS:''});
    await resource('container',names.backend,['run','-d','--name',names.backend,'--label',label,'--network',names.network,'--network-alias','backend','--read-only','--tmpfs','/tmp:rw,nosuid,nodev,size=64m','--env-file',backendEnv,image('backend')]);
    await wait(()=>request('http://backend:8080/api/health'));
    const uiEnv=await envFile(`frontend-${generation}`,{...common('frontend'),PORT:'3000'});
    await resource('container',names.frontend,['run','-d','--name',names.frontend,'--label',label,'--network',names.network,'--network-alias','frontend','--env-file',uiEnv,image('frontend')]);
    await wait(()=>request('http://frontend:3000/build-info.json'));
  }
  async function observeApplications(input,manifest=input.manifest) {
    const observedImages={},observedIdentities={},services={};let environment;
    for(const [key,url]of Object.entries({rulesWorker:'http://127.0.0.1:8090/health',backend:'http://backend:8080/api/health',frontend:'http://frontend:3000/build-info.json'})){
      const actual=JSON.parse(await command(['inspect',names[key]]))[0],expected=manifest.components[key].imageDigest;
      const inspected=JSON.parse(await command(['image','inspect',expected]))[0];
      if(actual.Config.Labels?.['bagofholding.rehearsal']!==run||actual.Config.Image!==expected||actual.Image!==inspected.Id||!inspected.RepoDigests?.includes(expected)||actual.State.Running!==true||Object.values(actual.NetworkSettings.Ports??{}).some(value=>value?.length))throw Error('Writer probe image ownership differs');
      const identity=writerHealthIdentity(await request(url),key);observedImages[key]=expected;observedIdentities[key]=identity;services[key]={healthy:true,imageDigest:expected,identity};if(key==='backend')environment=actual.Config.Env;
    }
    const state=manifest===input.previousManifest?input.active:{schemaVersion:1,status:'active',manifest,instances:Object.fromEntries(Object.keys(services).map(key=>[key,{releaseId:manifest.releaseId,releaseCommit:manifest.releaseCommit}]))};
    assertServiceIdentities(state,services);assertRuntimeWriterPolicy(environment,{manifest:{writerPolicy:historyWriterPolicy}});
    return {images:observedImages,identities:observedIdentities,environment};
  }
  async function stopApplications(){
    for(const name of [names.frontend,names.backend,names.rulesWorker]){
      const actual=JSON.parse(await command(['container','inspect',name]))[0];if(actual.Config.Labels?.['bagofholding.rehearsal']!==run)throw Error('Rehearsal container ownership changed');
      await command(['container','rm','--force',name]);
    }
  }
  async function loadPending(){
    if(!pending){
      const rows=await queryJSON("SELECT coalesce(json_agg(q),'[]'::json) FROM (SELECT r.id,r.user_id,u.username,r.combat_envelope#>'{state,pendingD20Interrupt}' held FROM roguelike_runs r JOIN users u ON u.id=r.user_id WHERE r.phase='combat' AND r.combat_envelope#>'{state,pendingD20Interrupt}'->>'operation'='roll_influence' ORDER BY r.id LIMIT 1) q;");
      if(rows.length!==1)throw Error('Snapshot has no durable pending roll-influence scenario');pending={...rows[0],origin:'restored-snapshot'};
    }
    const before=await invariant(),loaded=await authenticated('');if(!equal(loaded.run.combat_state.pendingD20Interrupt,pending.held)||!equal(before,await invariant()))throw Error('Pending choice changed during new-reader load');
    return {status:'passed',checked:true,pendingHash:evidenceHash(pending.held),origin:pending.origin};
  }
  async function acceptedDuplicate(){
    const rows=await queryJSON(`SELECT coalesce(json_agg(q),'[]'::json) FROM (SELECT to_jsonb(c) AS receipt FROM roguelike_command_receipts c WHERE c.run_id='${uuid(pending.id)}' ORDER BY created_at DESC LIMIT 1) q;`);
    if(rows.length!==1)throw Error('No accepted command for restored pending run');receipt=rows[0].receipt;
    const {response,body}=acceptedReceiptReplay(receipt),before=await invariant();
    for(let retry=0;retry<2;retry++)if(!equal(await authenticated('/commands',body),response)||!equal(before,await invariant()))throw Error('Duplicate accepted command changed response or state');
    return {acceptedHash:evidenceHash(response),invariantHash:evidenceHash(before)};
  }
  return {
    execution:executeDocker===dockerCommand?'docker':'simulation',
    async prepareCapture(capture,active) {
      await startDatabase(capture.files);
      const artifacts=capture.files.filter(row=>row.category==='rules-artifact');
      for(const hash of inventory.artifactHashes)if(!artifacts.some(row=>row.sha256===hash))throw Error('Captured history executable is missing');
      await verifyBackupSourceReleases(backupDirectory,inventory.sourceReleaseReferences,capture.sourceReleases??[],capture.files);
      const mediaFile=path.join(backupDirectory,'media-references.json');
      await writeFile(mediaFile,JSON.stringify({scope:'references-only',remoteObjectAvailability:'not_checked',references:inventory.mediaReferences})+'\n',{flag:'wx',mode:0o600});
      const bytes=await readFile(mediaFile);
      const backup={schemaVersion:1,kind:'release-backup',status:'captured',createdAt:capture.createdAt,releaseManifestHash:evidenceHash(baselineDocument(active)),schemaFingerprint:inventory.schemaFingerprint,
        migrations:inventory.migrations,referencedArtifactHashes:inventory.artifactHashes,artifactInventoryComplete:true,sourceReleaseReferences:inventory.sourceReleaseReferences,sourceReleases:capture.sourceReleases??[],
        files:[...capture.files,{path:'media-references.json',category:'media-manifest',sha256:await checksum(mediaFile),bytes:bytes.length}]};
      await writeFile(path.join(backupDirectory,'backup.json'),JSON.stringify(backup,null,2)+'\n',{flag:'wx',mode:0o600});return backup;
    },
    async start(input,runId){
      executionRunId=runId;
      await startDatabase(input.backup.files);
      const oldCounts=await queryJSON("SELECT json_build_object('pending',(SELECT count(*) FROM roguelike_runs WHERE combat_envelope#>'{state,pendingD20Interrupt}'->>'operation'='roll_influence'),'artifacts',(SELECT coalesce(json_agg(DISTINCT record->>'artifactHash'),'[]'::json) FROM roguelike_combat_events));");
      const previous=input.legacyBaseline??input.previousManifest;
      const needsPriorScenario=!oldCounts.pending||!oldCounts.artifacts.includes(baselineArtifact(input.active));
      if(needsPriorScenario){
        await startApplications(input,previous);
        if(needsPriorScenario){pending=await canonicalScenario('Rehearsal prior application');pending.origin='owned-clone-canonical-api-before-candidate';}
        await stopApplications();
      }
      let additiveMigrations;
      if(!migrationBaselineMatches(input.active,input.manifest.migrationSet)){
        const migrationAdapter=createMigrationDockerAdapter({command,resource,envFile,names,run,label,secrets,
          startPrevious:()=>startApplications(input,previous),stopApplications,
          oldReadProof:async()=>({...await loadPending(),...await acceptedDuplicate()})});
        additiveMigrations=await runMigrationRehearsal(input,migrationAdapter);
      }
      await startApplications(input);
      return additiveMigrations?{additiveMigrations}:{};
    },
    async check(id,input){
      if(id==='snapshot'){
        if(inventory.schemaFingerprint!==input.backup.schemaFingerprint||!equal(inventory.artifactHashes,input.backup.referencedArtifactHashes))throw Error('Restored snapshot differs');
        if(!equal(inventory.sourceReleaseReferences,input.backup.sourceReleaseReferences??[]))throw Error('Restored canonical source release identity differs');
        await verifyBackupSourceReleases(backupDirectory,inventory.sourceReleaseReferences,input.backup.sourceReleases??[],input.backup.files);
        const media=await readJSON(backupFile(backupDirectory,input.backup.files.find(row=>row.category==='media-manifest').path));if(!equal(normalizeMediaReferences(media.references),normalizeMediaReferences(inventory.mediaReferences)))throw Error('Restored media inventory differs');
        return {status:'passed',backupHash:input.backupHash,schemaFingerprint:inventory.schemaFingerprint};
      }
      if(id==='migrations'){
        const versions=await queryJSON("SELECT coalesce(json_agg(version ORDER BY version),'[]'::json) FROM schema_migrations;");if(!equal(versions,input.manifest.migrationSet.map(row=>row.id).sort()))throw Error('Application changed migration ledger');return {status:'passed',versions};
      }
      if(id==='full-candidate-health'||id==='image-contract'){
        const services={};
        for(const [key,url] of Object.entries({rulesWorker:'http://127.0.0.1:8090/health',backend:'http://backend:8080/api/health',frontend:'http://frontend:3000/build-info.json'})){
          identities[key]=writerHealthIdentity(await request(url),key);const actual=JSON.parse(await command(['inspect',names[key]]))[0],expected=input.manifest.components[key].imageDigest;
          const inspected=JSON.parse(await command(['image','inspect',expected]))[0];
          if(actual.Config.Image!==expected||actual.Image!==inspected.Id||!inspected.RepoDigests?.includes(expected)||actual.State.Running!==true||Object.keys(actual.NetworkSettings.Ports??{}).some(port=>actual.NetworkSettings.Ports[port]?.length))throw Error('Candidate running image differs or publishes a port');
          images[key]=expected;services[key]={healthy:true,imageDigest:expected,identity:identities[key]};
        }
        assertServiceIdentities({schemaVersion:1,status:'active',manifest:input.manifest,instances:Object.fromEntries(Object.keys(services).map(key=>[key,{releaseId:input.manifest.releaseId,releaseCommit:input.manifest.releaseCommit}]))},services);
        if(id==='full-candidate-health'){
          const current=await canonicalScenario('Rehearsal current application');
          const actual=await query(`SELECT combat_envelope->>'artifactHash' FROM roguelike_runs WHERE id='${uuid(current.id)}';`);
          if(actual.trim()!==input.manifest.rulesArtifactHash)throw Error('New canonical encounter pinned the wrong executable');
          return {status:'passed',components:Object.keys(services).sort(),publishedPorts:0,canonicalCurrentArtifact:true,currentArtifactHash:actual.trim(),historyWriterPolicy};
        }
        return {status:'passed',images:{...images},identities:{...identities}};
      }
      if(id==='historical-inventory')return {status:'passed',complete:true,artifactHashes:input.historicalArtifactHashes};
      if(id==='historical-replay'){
        const groups=await queryJSON("SELECT coalesce(json_agg(records),'[]'::json) FROM (SELECT jsonb_agg(record ORDER BY revision) records FROM roguelike_combat_events GROUP BY run_id,combat_key) q;");
        const replay=`import{replayCombatRecords,GO_JSON_MAP_ENCODING}from'./replay.mjs';import{createRequire}from'node:module';import{readFile}from'node:fs/promises';import{createHash}from'node:crypto';const require=createRequire(import.meta.url);process.stdin.setEncoding('utf8');let raw='';for await(const c of process.stdin)raw+=c;const input=JSON.parse(raw),counts={};for(const records of input.groups){const hash=records[0]?.artifactHash;if(!/^sha256:[a-f0-9]{64}$/.test(hash)||!records.every(r=>r.artifactHash===hash))throw Error('mixed artifact');const file='/artifacts/'+hash.slice(7)+'.cjs';if('sha256:'+createHash('sha256').update(await readFile(file)).digest('hex')!==hash)throw Error('artifact bytes');const result=replayCombatRecords(records,require(file),{sourceEncoding:GO_JSON_MAP_ENCODING});counts[hash]=(counts[hash]??0)+result.commands}for(const hash of input.expected)if(!(counts[hash]>0))throw Error('missing historical transitions');console.log(JSON.stringify({status:'passed',artifactHashes:input.expected,commands:Object.values(counts).reduce((a,b)=>a+b,0),combats:input.groups.length}));`;
        return JSON.parse(await command(['exec','-i',names.rulesWorker,'node','--input-type=module','-e',replay],{input:JSON.stringify({groups,expected:input.historicalArtifactHashes}),timeout:300000}));
      }
      if(id==='pending-decision'){
        return loadPending();
      }
      if(id==='duplicate-command'){
        const accepted=await acceptedDuplicate();
        const current=(await authenticated('')).run;
        const continuation={command_id:randomUUID(),expected_revision:current.revision,type:'combat_intent',payload:{intent:{type:'d20_interrupt',actorId:null}}};
        const continued=await authenticated('/commands',continuation),after=await invariant();
        if(!equal(await authenticated('/commands',continuation),continued)||!equal(after,await invariant()))throw Error('Restored pending continuation is not idempotent');
        return {status:'passed',checked:true,acceptedHash:accepted.acceptedHash,continuedHash:evidenceHash(continued),invariantHash:evidenceHash(after)};
      }
      if(id==='writer-compatibility')return collectHostWriterStage(input,{
        directory,postgresImage,runId:executionRunId,
        retainedHistory:async()=>{
          await stopApplications();let result,failure;
          try{
            const adapter=createWriterHistoryDocker({command,resource,names,owner:run,label,directory,image:input.manifest.components.rulesWorker.imageDigest,execution:executeDocker===dockerCommand?'docker':'simulation'});
            result=await probeRetainedWriterHistory(input,adapter,{backupDirectory});
          }catch(error){failure=error;}finally{try{await startApplications(input);await observeApplications(input);}catch(error){failure??=error;}}
          if(failure)throw failure;return result;
        },
      });
      throw Error('Unknown rehearsal stage');
    },
    cleanup(){return cleanupPromise??=(async()=>{
      process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',interrupt);const errors=[];
      for(const {kind,name} of [...resources].reverse()){
        try{
          const listed=await executeDocker(kind==='container'?['container','ls','-a','--filter',`label=${label}`,'--format','{{.Names}}']:[kind,'ls','--filter',`label=${label}`,'--format','{{.Name}}']);
          if(!listed.split(/\r?\n/).includes(name))continue;
          const value=JSON.parse(await executeDocker([kind,'inspect',name]))[0];if((value.Config?.Labels??value.Labels)?.['bagofholding.rehearsal']!==run)throw Error('Resource ownership changed');
          await executeDocker(kind==='container'?['container','rm','--force','--volumes',name]:[kind,'rm',name]);
        }catch{errors.push(`owned-${kind}-cleanup-failed`);}
      }
      for(const file of secretFiles)try{await unlink(file);}catch{errors.push('temporary-env-cleanup-failed');}
      return {status:errors.length?'failed':'stopped',errors,resourceCount:resources.length};
    })();},
  };
}
