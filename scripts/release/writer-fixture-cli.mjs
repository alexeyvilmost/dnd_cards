#!/usr/bin/env node
// Called only by the trusted main release workflow. Downloaded predecessor files
// must be fetched by artifact-id from discovery, never a caller-selected branch.
import assert from 'node:assert/strict';
import{readFile,writeFile,lstat,realpath,rename,unlink}from'node:fs/promises';
import{fileURLToPath}from'node:url';import path from'node:path';import{randomBytes}from'node:crypto';
import{hostedWriterProvenance,produceHostedWriterFixture}from'./produce-writer-browser-proof.mjs';
import{validateActiveProjection}from'./active-projection.mjs';
import{selectLatestDeployedRun}from'./deployed-baseline.mjs';
import{verifyBaseline}from'./ci-release.mjs';
import{evidenceHash,validateManifest}from'./validate-manifest.mjs';
const same=(a,b)=>assert.equal(evidenceHash(a),evidenceHash(b),'Writer publication input changed');
export async function discoverWriterFixture(candidate,{get,environment=process.env}){
 const provenance=hostedWriterProvenance(candidate,environment);
 if(!Object.hasOwn(candidate.manifest,'writerPolicy'))return {schemaVersion:1,required:false,candidateHash:evidenceHash(candidate),provenance};
 const predecessor=await selectLatestDeployedRun(get,{repository:environment.GITHUB_REPOSITORY});assert.ok(predecessor,'Explicit writer policy requires a genuinely succeeded manifest predecessor');
 return {schemaVersion:1,required:true,candidateHash:evidenceHash(candidate),provenance,predecessor};
}
export function activeForWriterFixture({candidate,discovery,manifest,deployment,projection}){
 assert.equal(discovery.schemaVersion,1);assert.equal(discovery.required,true);assert.equal(discovery.candidateHash,evidenceHash(candidate));
 validateManifest(manifest);verifyBaseline(manifest,deployment,discovery.predecessor);assert.equal(candidate.manifest.previousReleaseId,manifest.releaseId);
 const p=discovery.predecessor;assert.ok(Number.isSafeInteger(p.runAttempt)&&p.runAttempt>0);
 validateActiveProjection(projection,{manifest,request:{repository:p.repository,runId:p.id,attempt:p.runAttempt,controlCommit:p.controlCommit,sourceCommit:manifest.releaseCommit}});
 return structuredClone(projection.active);
}
async function read(file,max=32*1024*1024){const absolute=path.resolve(file),stat=await lstat(absolute);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>0&&stat.size<=max);assert.equal(await realpath(absolute),absolute);return {text:await readFile(absolute,'utf8'),file:absolute};}
class WriterMetadataFailure extends Error{
 constructor(diagnostic){super('GitHub writer metadata request failed');this.diagnostic=Object.freeze(diagnostic);}
}
export function writerMetadataDiagnostic(error){return error instanceof WriterMetadataFailure?error.diagnostic:null;}
export function createWriterGithubReader(environment,{request=fetch,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),onDiagnostic=()=>{}}={}){
 assert.ok(environment.GITHUB_TOKEN,'Read-only metadata token required');assert.match(environment.GITHUB_REPOSITORY??'',/^[\w.-]+\/[\w.-]+$/);
 const number=value=>typeof value==='string'&&/^\d+$/.test(value)&&Number.isSafeInteger(Number(value))?Number(value):null;
 return async route=>{
  assert.ok(/^actions\//.test(route)&&!route.includes('..'));
  for(let attempt=1;attempt<=3;attempt++){
   let response,reason='transport';
   try{response=await request('https://api.github.com/repos/'+environment.GITHUB_REPOSITORY+'/'+route,{method:'GET',headers:{Authorization:'Bearer '+environment.GITHUB_TOKEN,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},redirect:'error',signal:AbortSignal.timeout(15000)});reason='http';}
   catch(error){if(['TimeoutError','AbortError'].includes(error?.name))reason='timeout';}
   if(response?.ok){try{return await response.json();}catch(error){reason=['TimeoutError','AbortError'].includes(error?.name)?'timeout':error instanceof SyntaxError?'invalid-json':'transport';}}
   const diagnostic={operation:'writer-github-metadata',attempt,reason,status:Number.isInteger(response?.status)?response.status:null,rateLimitRemaining:number(response?.headers?.get('x-ratelimit-remaining')),rateLimitReset:number(response?.headers?.get('x-ratelimit-reset')),retryAfterSeconds:number(response?.headers?.get('retry-after'))};
   onDiagnostic(diagnostic);
   const throttled=response?.status===429||response?.status===403&&(diagnostic.rateLimitRemaining===0||diagnostic.retryAfterSeconds!==null);
   const resetDelay=diagnostic.rateLimitReset===null?null:Math.max(0,diagnostic.rateLimitReset-Math.floor(Date.now()/1000));
   const delaySeconds=throttled?(diagnostic.retryAfterSeconds??resetDelay):1;
   const retry=reason==='transport'||reason==='timeout'||[500,502,503,504].includes(response?.status)||throttled&&delaySeconds!==null&&delaySeconds<=10;
   if(attempt===3||!retry)throw new WriterMetadataFailure(diagnostic);
   await wait(Math.max(1,delaySeconds??1)*1000);
  }
 };
}
export async function writerFixtureCLI(args,environment=process.env,{onPhase=()=>{},onMetadataDiagnostic=()=>{}}={}){
 const [mode,candidateFile,discoveryFile,...rest]=args;assert.ok(['discover','produce'].includes(mode)&&candidateFile&&discoveryFile);
 const input=await read(candidateFile),candidate=JSON.parse(input.text);hostedWriterProvenance(candidate,environment);
 const get=Object.hasOwn(candidate.manifest,'writerPolicy')?createWriterGithubReader(environment,{onDiagnostic:onMetadataDiagnostic}):()=>{throw Error('Unexpected predecessor lookup');};
 if(mode==='discover'){
  assert.equal(rest.length,0);const result=await discoverWriterFixture(candidate,{get,environment});await writeFile(discoveryFile,JSON.stringify(result)+'\n',{flag:'wx',mode:0o600});
  return {required:String(result.required),source_commit:result.provenance.sourceCommit,...result.required?{baseline_run_id:String(result.predecessor.id),baseline_artifact_id:String(result.predecessor.artifactId)}:{}};
 }
 assert.equal(rest.length,3);const [previousDirectory,repositoryRoot,directory]=rest,discovery=JSON.parse((await read(discoveryFile)).text);
 onPhase('predecessor-refresh');
 same(await discoverWriterFixture(candidate,{get,environment}),discovery);if(!discovery.required)return{status:'not-required',candidateUnchanged:true};
 const previous={};for(const [key,file]of [['manifest','manifest.json'],['deployment','deployment.json'],['projection','active-projection.json']])previous[key]=JSON.parse((await read(path.join(previousDirectory,file))).text);
 const active=activeForWriterFixture({candidate,discovery,...previous});assert.equal(candidate.writerFixture,undefined,'A published writer package cannot be silently replaced');
 const writerFixture=await produceHostedWriterFixture({candidate,active,repositoryRoot:path.resolve(repositoryRoot),directory:path.resolve(directory),postgresImage:'postgres@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73',environment,onPhase});
 // A deployment or workflow rerun during a long browser probe invalidates it.
 onPhase('final-predecessor-refresh');same(await discoverWriterFixture(candidate,{get,environment}),discovery);assert.equal((await read(candidateFile)).text,input.text);
 const output=JSON.stringify({...candidate,writerFixture})+'\n';assert.ok(Buffer.byteLength(output)<32*1024*1024);
 onPhase('candidate-write');const temporary=input.file+'.writer-'+randomBytes(12).toString('hex');let wrote=false;
 try{await writeFile(temporary,output,{flag:'wx',mode:0o600});wrote=true;assert.equal((await read(candidateFile)).text,input.text);await rename(temporary,input.file);wrote=false;}finally{if(wrote)await unlink(temporary);}
 return {status:'passed',writerFixtureHash:evidenceHash(writerFixture),browserProofHash:evidenceHash(writerFixture.browserProof),originalManifestHash:evidenceHash(candidate.manifest),previousActiveHash:evidenceHash(active)};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 let phase='input-validation';
 writerFixtureCLI(process.argv.slice(2),process.env,{onPhase:value=>{phase=value;console.log('Writer fixture phase: '+phase);},onMetadataDiagnostic:value=>console.error('Writer metadata diagnostic: '+JSON.stringify(value))}).then(result=>{if(process.argv[2]==='discover')for(const[k,v]of Object.entries(result))console.log(k+'='+v);else console.log(JSON.stringify(result));}).catch(()=>{console.error('Hosted writer fixture refused at '+phase+'; candidate was not authorized for publication. Inspect the private workflow attempt; do not fabricate a predecessor or successful run.');process.exitCode=1;});
}
