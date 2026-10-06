// Small hosted-runner collector. Fresh public synthetic content only: no host
// backup, production DSN, reference inventory or migration rehearsal is read.
import {execFileSync} from 'node:child_process';import {mkdirSync,writeFileSync,readFileSync,copyFileSync,cpSync,chmodSync,realpathSync} from 'node:fs';
import path from 'node:path';import {randomBytes,randomUUID,createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';
import {seedIntegrationCatalog} from '../testing/integration-baseline.mjs';import {seedCanonicalTemplates} from '../testing/fixtures.mjs';
import {createCanonicalPendingScenario,createRehearsalAccount,authorizeDockerRehearsal} from './rehearsal-scenarios.mjs';
import {createObservedFrontendBoundary} from './docker-ui-deployment.mjs';import {observeUIHost} from './ui-host-observation.mjs';
import {validateExecutionProfile} from './ui-execution-profile.mjs';import {evidenceHash,validateManifest} from './validate-manifest.mjs';
export const playwrightVersion='1.62.1';
export const playwrightImage='mcr.microsoft.com/playwright@sha256:c091b21d9fae78c76e85cd4356431e9b018402f172a214fc7d7a5e9a7e29d8ac';
export const gatewayImage='caddy@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d';
const repository=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),read=file=>JSON.parse(readFileSync(file,'utf8'));
const hash=bytes=>'sha256:'+createHash('sha256').update(bytes).digest('hex');
function docker(args,input){try{return execFileSync('docker',args,{input,encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:300000,maxBuffer:16*1024*1024}).trim();}
  catch(error){throw Object.assign(Error('Owned mixed OCI operation failed'),{code:error.code??'docker-step-failed',exitCode:error.status});}}
export function createDockerUIRehearsal({directory,postgresImage,executionProfile,browserRuntimeDirectory=path.join(repository,'frontend/node_modules'),command=docker}){
  if(process.platform!=='linux'||!path.isAbsolute(directory)||!/^.+@sha256:[a-f0-9]{64}$/.test(postgresImage??''))throw Error('Linux hosted collector and pinned PostgreSQL required');
  validateExecutionProfile(executionProfile);const root=path.resolve(directory);mkdirSync(root,{mode:0o700});
  if(realpathSync(root)!==root)throw Error('Owned collector path redirected');
  const suffix=randomBytes(12).toString('hex'),owner='rehearsal_'+suffix,runMarker='test_'+suffix;
  const names={postgres:owner+'_db',backend:owner+'_api',rulesWorker:owner+'_worker',frontend:owner+'_ui',network:owner+'_net'},labels={'bagofholding.rehearsal':owner};
  const config={schemaVersion:1,root,project:owner,artifactDirectory:path.join(root,'artifacts'),assetDirectory:path.join(root,'assets'),composeFile:path.join(root,'compose.json'),caddyFile:path.join(root,'Caddyfile'),appEnvFile:path.join(root,'app.env'),workerEnvFile:path.join(root,'worker.env'),deployEnvFile:path.join(root,'deploy.env')};
  for(const dir of [config.artifactDirectory,config.assetDirectory])mkdirSync(dir);
  for(const key of ['appEnvFile','workerEnvFile','deployEnvFile'])writeFileSync(config[key],'# Owned public fixture\n',{mode:0o600});
  // The browser needs a secure context for the canonical request UUID path.
  // Own CA only; routing body is the exact checked-in production Caddyfile.
  writeFileSync(config.caddyFile,'{\n local_certs\n}\n'+readFileSync(path.join(repository,'infra/Caddyfile'),'utf8'),{mode:0o600});config.caddyHash=hash(readFileSync(config.caddyFile));
  const save=(file,data)=>writeFileSync(file,JSON.stringify(data,null,2)+'\n',{mode:0o600,flag:'wx'});
  const compose=(...args)=>command(['compose','--project-name',owner,'-f',config.composeFile,...args]);
  const query=async sql=>command(['exec','-i',names.postgres,'psql','-h','127.0.0.1','-X','-qAt','-v','ON_ERROR_STOP=1','-U','rehearsal','-d','rehearsal'],sql);
  let before,desired,boundary,runId,pending,accepted,continued,continuedBody,ui,oldChunks,fixtureProof,cleanupPromise;
  const browserNames=[];
  async function browserChecks(){
    const runtime=path.join(root,'browser');mkdirSync(runtime);mkdirSync(path.join(runtime,'node_modules'));
    for(const name of ['playwright','playwright-core']){
      const source=path.join(browserRuntimeDirectory,name);if(!path.isAbsolute(source)||read(path.join(source,'package.json')).version!==playwrightVersion)throw Error('Playwright runtime differs from pinned browser image');
      cpSync(source,path.join(runtime,'node_modules',name),{recursive:true,dereference:true,errorOnExist:true,force:false});
    }
    copyFileSync(path.join(repository,'scripts/release/ui-browser-checks.mjs'),path.join(runtime,'ui-browser-checks.mjs'));
    const account=await createRehearsalAccount(await authorizeDockerRehearsal({names,owner}),{label:'Owned UI verification'});
    save(path.join(runtime,'input.json'),{owner,origin:'https://gateway:8443',account:{username:account.username,password:account.password}});const name=owner+'_browser';browserNames.push(name);
    command(['pull',playwrightImage]);
    let failure;try{command(['run','--name',name,'--label','bagofholding.rehearsal='+owner,'--network',names.network,'--ipc','private','--shm-size','256m','--mount',`type=bind,source=${runtime},target=/runtime`,'--workdir','/runtime',playwrightImage,'node','ui-browser-checks.mjs','input.json','result.json']);}catch(error){failure=error;}
    const result=read(path.join(runtime,'result.json'));if(failure||result.status!=='passed'||result.owner!==owner)throw Error('Actual pinned browser checks failed');return result;
  }
  const request=resource=>JSON.parse(command(['exec',names.rulesWorker,'node','--input-type=module','-e',"const r=await fetch('http://frontend:3000'+process.argv[1]);const b=Buffer.from(await r.arrayBuffer());const{createHash}=await import('node:crypto');console.log(JSON.stringify({status:r.status,hash:createHash('sha256').update(b).digest('hex'),html:process.argv[1]==='/'?b.toString():undefined}));",resource]));
  return {execution:command===docker?'docker':'simulation',scope:'owned-synthetic',
    async start(input){
      let rehearsalStage='postgres-start';try{
      runId=input.runId;validateManifest(input.manifest);validateManifest(input.previousManifest);
      const profile=executionProfile,previous=input.previousManifest,candidate=input.manifest;
      for(const key of ['backend','rulesWorker'])if(evidenceHash(previous.components[key])!==evidenceHash(candidate.components[key]))throw Error('Mixed fixture requires exact reused backend/worker');
      const endpoint=JSON.parse(command(['context','inspect','--format','{{json .Endpoints.docker.Host}}']));if(!endpoint.startsWith('unix://')||process.env.DOCKER_HOST||process.env.DOCKER_CONTEXT)throw Error('Default local Linux Docker required');
      const secrets={database:randomBytes(24).toString('hex'),worker:randomBytes(24).toString('hex'),jwt:randomBytes(24).toString('hex')},health=test=>({test,interval:'1s',timeout:'3s',retries:90}),common={labels,networks:{owned:{}}};
      const databaseURL=new URL('postgres://postgres:5432/rehearsal?sslmode=disable');databaseURL.username='rehearsal';databaseURL.password=secrets.database;
      const launch=key=>({RELEASE_ID:profile[key].instance.releaseId,RELEASE_COMMIT:profile[key].instance.releaseCommit});
      const document={name:owner,services:{postgres:{...common,image:postgresImage,container_name:names.postgres,environment:{POSTGRES_USER:'rehearsal',POSTGRES_DB:'rehearsal',POSTGRES_PASSWORD:secrets.database},volumes:['pgdata:/var/lib/postgresql/data'],healthcheck:health(['CMD','pg_isready','-h','127.0.0.1','-U','rehearsal','-d','rehearsal'])},
        'rules-worker':{...common,image:previous.components.rulesWorker.imageDigest,container_name:names.rulesWorker,environment:{...profile.rulesWorker.environment,...launch('rulesWorker'),RULES_WORKER_TOKEN:secrets.worker,RULES_ARTIFACTS_DIR:'/artifacts',PORT:'8090'},volumes:[`${config.artifactDirectory}:/artifacts`],healthcheck:health(['CMD','node','-e',"fetch('http://127.0.0.1:8090/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"])},
        backend:{...common,image:previous.components.backend.imageDigest,container_name:names.backend,environment:{...profile.backend.environment,...launch('backend'),DATABASE_URL:databaseURL.href,JWT_SECRET:secrets.jwt,RULES_WORKER_TOKEN:secrets.worker,RULES_WORKER_URL:'http://rules-worker:8090',OPENAI_API_KEY:'',OPENAI_BASE_URL:'http://127.0.0.1:1/v1',CONTENT_ADMIN_USER_IDS:'',PORT:'8080'},healthcheck:health(['CMD','wget','-q','--spider','http://127.0.0.1:8080/api/health'])},
        frontend:{...common,image:previous.components.frontend.imageDigest,container_name:names.frontend,environment:{RELEASE_ID:previous.releaseId,RELEASE_COMMIT:previous.releaseCommit,PORT:'3000'},volumes:[`${config.assetDirectory}:/var/lib/bagofholding/frontend:ro`],healthcheck:health(['CMD','wget','-q','--spider','http://127.0.0.1:3000/health'])},
        gateway:{...common,image:gatewayImage,container_name:owner+'_gateway',environment:{APP_DOMAIN:'https://gateway:8443'},volumes:[`${config.caddyFile}:/etc/caddy/Caddyfile:ro`],healthcheck:health(['CMD','wget','--no-check-certificate','-q','--spider','https://gateway:8443/_edge-health'])}},networks:{owned:{name:names.network,internal:true,labels}},volumes:{pgdata:{labels}}};
      save(config.composeFile,document);config.composeHash=hash(readFileSync(config.composeFile));compose('up','-d','--wait','postgres');
      const actual=JSON.parse(command(['inspect',names.postgres]))[0];if(actual.Config.Labels['bagofholding.rehearsal']!==owner||Object.keys(actual.NetworkSettings.Networks).join()!==names.network)throw Error('Fixture database ownership differs');
      await query(`CREATE TABLE test_run_ownership(run_id text PRIMARY KEY);INSERT INTO test_run_ownership VALUES ('${runMarker}');`);
      if((await query('SELECT current_database()||\':\'||run_id FROM test_run_ownership;')).trim()!=='rehearsal:'+runMarker)throw Error('Fixture database marker differs');
      rehearsalStage='catalog-seed';fixtureProof=await seedIntegrationCatalog({query});fixtureProof.templates=await seedCanonicalTemplates({query});await query('ANALYZE;');
      rehearsalStage='application-start';chmodSync(config.artifactDirectory,0o777);compose('up','-d','--wait','rules-worker','backend','frontend','gateway');
      const instances={backend:profile.backend.instance,rulesWorker:profile.rulesWorker.instance,frontend:{releaseId:previous.releaseId,releaseCommit:previous.releaseCommit}};
      before={schemaVersion:1,status:'active',manifest:previous,instances};desired={...structuredClone(before),manifest:candidate,instances:{...structuredClone(instances),frontend:{releaseId:candidate.releaseId,releaseCommit:candidate.releaseCommit}}};
      rehearsalStage='initial-observation';const observation=await observeUIHost(config,before,{run:command}),anchor={kind:'owned-observation',runtimeCompatibilityHash:evidenceHash(observation.protectedRuntime)};
      boundary=createObservedFrontendBoundary(config,{document:{binding:anchor},runtime:JSON.parse(compose('config','--format','json'))},{command});
      rehearsalStage='original-ui';const html=request('/');oldChunks=Object.fromEntries([...html.html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map(match=>[match[1],request(match[1])]));if(!Object.keys(oldChunks).length)throw Error('Original frontend chunks absent');
      rehearsalStage='frontend-prepare';await boundary.prepare({kind:'frontend-only',changed:['frontend'],anchor,previous:before,desired});rehearsalStage='frontend-replace';await boundary.replaceFrontend(desired);
      return {status:'ready',runId,execution:'docker',scope:'owned-synthetic'};
      }catch(error){throw Object.assign(Error('Owned mixed OCI startup failed'),{code:error.code??'mixed-startup-failed',exitCode:error.exitCode,rehearsalStage});}
    },
    async observeProtected(){return (await boundary.observeProtected(before)).protectedRuntime;},
    async check(id){
      const result={id,runId,status:'passed',execution:'docker'};
      if(id==='image-contract'){const observed=await boundary.observe(desired);return {...result,images:Object.fromEntries(Object.entries(desired.manifest.components).map(([key,row])=>[key,row.imageDigest])),identities:Object.fromEntries(Object.entries(observed.services).map(([key,row])=>[key,row.identity])),fixtureProofHash:evidenceHash(fixtureProof),executionProfile};}
      if(['api-routing','character','equipment','paper','json-export','pdf-export'].includes(id)){ui??=await browserChecks();if(ui.checks[id]?.status!=='passed')throw Error('Missing actual browser stage');return {...result,...ui.checks[id],browserImage:playwrightImage};}
      if(id==='combat-pending'){pending=await createCanonicalPendingScenario(await authorizeDockerRehearsal({names,owner}),{label:'Mixed OCI durable paid choice'});accepted=await pending.request('');return {...result,pendingHash:evidenceHash(accepted),artifactHash:accepted.run.combat_envelope?.artifactHash??desired.manifest.rulesArtifactHash};}
      if(id==='reload'){if(evidenceHash(await pending.request(''))!==evidenceHash(accepted))throw Error('Persisted pending changed during reload');return {...result,pendingHash:evidenceHash(accepted)};}
      if(id==='exact-retry'){continuedBody={command_id:randomUUID(),expected_revision:accepted.run.revision,type:'combat_intent',payload:{intent:{type:'d20_interrupt',actorId:null}}};continued=await pending.request('/commands',continuedBody);if(evidenceHash(await pending.request('/commands',continuedBody))!==evidenceHash(continued))throw Error('Exact retry differs');return {...result,continuedHash:evidenceHash(continued)};}
      if(id==='frontend-rollback'){command(['stop','-t','2',names.frontend]);await boundary.replaceFrontend(before);await boundary.observe(before);if(evidenceHash(await pending.request('/commands',continuedBody))!==evidenceHash(continued))throw Error('Frontend rollback changed accepted command');return {...result,previousDigest:before.manifest.components.frontend.imageDigest,changedComponents:['frontend'],failedCandidate:true};}
      if(id==='old-chunk-fetch'){for(const [url,original] of Object.entries(oldChunks)){const actual=request(url);if(actual.status!==200||actual.hash!==original.hash)throw Error('Retained previous frontend chunks differ');}return {...result,count:Object.keys(oldChunks).length};}
      throw Error('Unknown mixed OCI check');
    },
    cleanup(){return cleanupPromise??=(async()=>{const errors=[];
      for(const name of browserNames)try{const found=JSON.parse(command(['inspect',name]))[0];if(found.Config.Labels['bagofholding.rehearsal']!==owner)throw Error('Browser owner differs');command(['rm','-f',name]);}catch{errors.push('browser-cleanup-failed');}
      try{const ids=command(['ps','-aq','--filter','label=com.docker.compose.project='+owner]).split(/\s+/).filter(Boolean);for(const id of ids)if(JSON.parse(command(['inspect',id]))[0].Config.Labels['bagofholding.rehearsal']!==owner)throw Error('Compose ownership changed');compose('down','--volumes','--remove-orphans');if(command(['ps','-aq','--filter','label=com.docker.compose.project='+owner]))throw Error('Owned resources remain');}catch{errors.push('owned-compose-cleanup-failed');}
      return {status:errors.length?'failed':'stopped',errors,retainedImages:true};})();},
  };
}
