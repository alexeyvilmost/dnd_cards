import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {validateSSHRequest,validatePublicReceipt,sshArguments,createTransfer,deployOverSSH,execute,transferFiles} from './ssh-transport.mjs';
import {unpackControlArchive} from './ssh-archive.mjs';
import {validateTransferredCandidate,executeHostGates} from './ssh-host-release.mjs';
import {evidenceHash} from './validate-manifest.mjs';
const hash=char=>'sha256:'+char.repeat(64),digest=value=>'sha256:'+createHash('sha256').update(value).digest('hex');
const request=()=>({schemaVersion:1,controlCommit:'a'.repeat(40),sourceCommit:'b'.repeat(40),repository:'example/project',actor:'github-actions[bot]',eventName:'workflow_dispatch',mode:'adopt',runId:'42',attempt:'1',attemptRoot:'/opt/app/automation',hostConfig:'/opt/app/config/deployment.json',rehearsalConfig:'/opt/app/config/rehearsal.json',nodePath:'/usr/local/bin/node',productionEnabled:'true'});
function fixture(req=request()){
 const manifest={schemaVersion:1,releaseId:'candidate',releaseCommit:req.sourceCommit,previousReleaseId:null,createdAt:'2026-10-05T00:00:00Z',
  components:Object.fromEntries(['frontend','backend','rulesWorker'].map((key,i)=>[key,{sourceCommit:req.sourceCommit,inputFingerprint:hash(String(i+1)),imageDigest:`example.test/${key.toLowerCase()}@${hash(String(i+4))}`} ])),
  rulesArtifactHash:hash('a'),contentManifestHash:hash('b'),apiProtocolVersion:1,workerProtocolVersion:1,supportedWorldSchemaVersions:[5],workerRuntime:{name:'node',version:'24.19.0'},capabilities:['pinned-artifact-routing','pending-decision-pass-through'],migrationSet:[{id:'001',checksum:hash('c')}],
  validationEvidence:[{gate:'core',status:'passed',reportHash:hash('d'),inputFingerprint:hash('e'),completedAt:'2026-10-05T00:00:00Z'}]};
 const provenance={schemaVersion:1,releaseRunId:9,controlCommit:'c'.repeat(40),sourceCommit:req.sourceCommit,planHash:hash('f'),manifestHash:evidenceHash(manifest)};
 const data={'candidate.json':{manifest,provenance,reports:{core:{status:'passed'}}},'manifest.json':manifest,'core-report.json':{status:'passed'},'verified-release-run.json':{id:9,workflow:'.github/workflows/release.yml',controlCommit:provenance.controlCommit}};
 return {request:req,archiveHash:hash('0'),files:Object.fromEntries(Object.entries(data).map(([file,value])=>{const text=JSON.stringify(value);return [file,{text,sha256:digest(text)}];})),manifest};
}
async function temp(t){const root=await mkdtemp(path.join(tmpdir(),'ssh-release-test-'));t.after(async()=>{assert.equal(path.dirname(root),path.resolve(tmpdir()));assert.ok(path.basename(root).startsWith('ssh-release-test-'));await rm(root,{recursive:true,force:true});});return root;}
async function sourceFixture(t){const root=await temp(t),control=path.join(root,'repo'),candidate=path.join(root,'candidate'),output=path.join(root,'transfer');await mkdir(control);await mkdir(candidate);await mkdir(output);
 await execute('git',['init','--quiet'],{cwd:control});await writeFile(path.join(control,'source.txt'),'exact source');await writeFile(path.join(control,'материал-'.repeat(8)+'.txt'),'Юникод 🎲');await execute('git',['add','.'],{cwd:control});await execute('git',['-c','user.name=Unit Fixture','-c','user.email=fixture@example.invalid','commit','--quiet','-m','synthetic transfer fixture'],{cwd:control});
 const req={...request(),controlCommit:(await execute('git',['rev-parse','HEAD'],{cwd:control})).trim()},packet=fixture(req);
 for(const file of transferFiles)await writeFile(path.join(candidate,file),packet.files[file].text);
 return {root,control,candidate,output,request:req,packet};}
test('SSH request rejects source/paths/mode injection and enforces host-key and no forwarding options',()=>{
 validateSSHRequest(request());for(const change of [{eventName:'pull_request'},{eventName:'workflow_run'}, {productionEnabled:'false'},{nodePath:'/bin/node;bad'},{attemptRoot:'/opt/app/../other'},{sourceCommit:'main'},{attempt:'0'}])assert.throws(()=>validateSSHRequest({...request(),...change}));
 const args=sshArguments({host:'server.example',user:'deploy',port:2222},'/private/key','/private/known','command');
 for(const value of ['StrictHostKeyChecking=yes','BatchMode=yes','ForwardAgent=no','ClearAllForwardings=yes','IdentitiesOnly=yes','PermitLocalCommand=no'])assert.ok(args.includes(value));assert.ok(args.includes('/dev/null'));
 assert.throws(()=>sshArguments({host:'server;bad',user:'deploy',port:22},'k','h','cmd'));
});
test('candidate transfer rejects corruption, extra files and changed source before production gates',()=>{
 const original=fixture();assert.equal(validateTransferredCandidate(original).sourceCommit,request().sourceCommit);
 for(const mutate of [p=>p.files['candidate.json'].text+=' ',p=>p.files['../database.dump']={text:'private'},p=>p.request.sourceCommit='f'.repeat(40),p=>{const m=JSON.parse(p.files['manifest.json'].text);m.releaseId='other';const text=JSON.stringify(m);p.files['manifest.json']={text,sha256:digest(text)};}]){const copy=structuredClone(original);mutate(copy);assert.throws(()=>validateTransferredCandidate(copy));}
});
test('public receipt is bound to the exact successful manifest, release and control identities',()=>{
 const req=request(),{manifest}=fixture(req),receipt={status:'succeeded',sourceCommit:req.sourceCommit,controlCommit:req.controlCommit,manifest,
  deployment:{schemaVersion:1,status:'succeeded',releaseId:manifest.releaseId,releaseCommit:req.sourceCommit,controlCommit:req.controlCommit,manifestHash:evidenceHash(manifest)}};
 assert.equal(validatePublicReceipt(receipt,req),receipt);
 for(const mutate of [r=>r.deployment.status='failed',r=>r.deployment.schemaVersion=2,r=>r.deployment.releaseId='other',r=>r.deployment.manifestHash=hash('0'),r=>r.deployment.controlCommit='d'.repeat(40),r=>r.manifest.releaseCommit='e'.repeat(40),r=>delete r.manifest.components]){
  const copy=structuredClone(receipt);mutate(copy);assert.throws(()=>validatePublicReceipt(copy,req));
 }
});
test('real git archive is checksum/commit-bound and transferred control is clean',async t=>{
 const f=await sourceFixture(t),transfer=await createTransfer({controlDirectory:f.control,candidateDirectory:f.candidate,request:f.request,directory:f.output});
 assert.equal(transfer.packet.archiveHash,digest(await readFile(transfer.archive)));const dir=path.join(f.root,'unpack');await mkdir(dir);await writeFile(path.join(dir,'control.tar'),await readFile(transfer.archive));
 const result=spawnSync(process.execPath,['-e',`(${unpackControlArchive.toString()})(...process.argv.slice(1))`,dir,transfer.packet.archiveHash,f.request.controlCommit],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.equal(await readFile(path.join(dir,'control','source.txt'),'utf8'),'exact source');
 assert.equal(await readFile(path.join(dir,'control','материал-'.repeat(8)+'.txt'),'utf8'),'Юникод 🎲');
 const linked=path.join(f.root,'linked-attempt');await symlink(dir,linked,process.platform==='win32'?'junction':'dir');
 const linkedResult=spawnSync(process.execPath,['-e',`(${unpackControlArchive.toString()})(...process.argv.slice(1))`,linked,transfer.packet.archiveHash,f.request.controlCommit],{encoding:'utf8'});assert.notEqual(linkedResult.status,0);assert.match(linkedResult.stderr,/Unsafe attempt root/);
 await writeFile(path.join(f.control,'source.txt'),'changed');await assert.rejects(createTransfer({controlDirectory:f.control,candidateDirectory:f.candidate,request:f.request,directory:f.output}),/clean/);
});
function tarHeader(name,type='0',body=Buffer.alloc(0)){
 const header=Buffer.alloc(512);header.write(name,0,100);header.write('0000600\0',100);header.write('0000000\0',108);header.write('0000000\0',116);header.write(body.length.toString(8).padStart(11,'0')+'\0',124);header.write('00000000000\0',136);header.fill(32,148,156);header.write(type,156);header.write('ustar\0',257);header.write('00',263);
 const sum=header.reduce((a,b)=>a+b,0);header.write(sum.toString(8).padStart(6,'0')+'\0 ',148);return Buffer.concat([header,body,Buffer.alloc((512-body.length%512)%512)]);
}
function paxRecord(key,value){const data=` ${key}=${value}\n`;let length=Buffer.byteLength(data)+1;while(String(length).length+Buffer.byteLength(data)!==length)length=String(length).length+Buffer.byteLength(data);return Buffer.from(`${length}${data}`);}
test('archive bootstrap rejects traversal, links, duplicate paths and PAX path attacks before extraction',async t=>{
 const root=await temp(t),global=tarHeader('pax_global_header','g',paxRecord('comment',request().controlCommit));
 const cases=[tarHeader('../outside'),tarHeader('/outside'),tarHeader('safe','2'),tarHeader('hard','1'),Buffer.concat([tarHeader('same'),tarHeader('same')]),
  Buffer.concat([tarHeader('long','x',paxRecord('path','../outside')),tarHeader('safe')]),Buffer.concat([tarHeader('same'),tarHeader('long','x',paxRecord('path','same')),tarHeader('other')]),
  Buffer.concat([tarHeader('long','x',Buffer.concat([paxRecord('path','a'),paxRecord('path','b')])),tarHeader('safe')])];
 for(let i=0;i<cases.length;i++){const directory=path.join(root,String(i));await mkdir(directory);const bytes=Buffer.concat([global,cases[i],Buffer.alloc(1024)]);await writeFile(path.join(directory,'control.tar'),bytes);const result=spawnSync(process.execPath,['-e',`(${unpackControlArchive.toString()})(...process.argv.slice(1))`,directory,digest(bytes),request().controlCommit],{encoding:'utf8'});assert.notEqual(result.status,0,`attack ${i} accepted`);assert.equal(existsSync(path.join(directory,'control')),false);}
});
test('host gates re-fetch workflow metadata, preserve every proof and return only public receipt',async t=>{
 const directory=await temp(t),packet=fixture(),calls=[];const token='unit-read-token';
 const run=async(bin,args,options)=>{calls.push({bin,args,options});assert.equal(options.env.DOCKER_CONFIG,path.join(directory,'docker-auth'));assert.ok(!args.includes(token));
  if(bin==='docker'){assert.deepEqual(args,['login','ghcr.io','--username',request().actor,'--password-stdin']);assert.equal(options.input,token);return '';}
  const script=path.basename(args[0]);if(script==='prepare-host-release.mjs')return 'capture_directory=/private/capture\nhost_config=/private/capture/host.json\nrehearsal_config=/private/capture/rehearsal.json\n';
  if(script==='deploy.mjs'){assert.equal(args[1],'adopt');return JSON.stringify({status:'succeeded',plan:{candidateHash:evidenceHash(packet.manifest)}});}
  if(script==='deployment-handoff.mjs'&&args[1]==='receipt'){await mkdir(path.join(directory,'deployed-release'));await writeFile(path.join(directory,'deployed-release','manifest.json'),JSON.stringify(packet.manifest));await writeFile(path.join(directory,'deployed-release','deployment.json'),JSON.stringify({schemaVersion:1,status:'succeeded',releaseId:packet.manifest.releaseId,releaseCommit:request().sourceCommit,controlCommit:request().controlCommit,manifestHash:evidenceHash(packet.manifest)}));}
  return '';
 };
 const result=await executeHostGates({directory,packet,request:request(),token,run});assert.deepEqual(Object.keys(result).sort(),['controlCommit','deployment','manifest','sourceCommit','status']);assert.equal(existsSync(path.join(directory,'docker-auth')),false);assert.ok(!JSON.stringify(result).includes(token));
 assert.deepEqual(calls.filter(row=>row.bin!=='docker').map(row=>[path.basename(row.args[0]),row.args[1]]),[
  ['ci-release.mjs','verify-run'],['deployment-handoff.mjs','candidate'],['automatic-release.mjs','check-current'],['prepare-host-release.mjs','/opt/app/config/deployment.json'],
  ['candidate-rehearsal.mjs','run'],['assemble-bundle.mjs',path.join(directory,'candidate')],['deployment-handoff.mjs','verify'],['automatic-release.mjs','check-current'],['deploy.mjs','adopt'],['deployment-handoff.mjs','receipt']]);
 assert.ok(calls.find(row=>path.basename(row.args[0])==='deployment-handoff.mjs'&&row.args[1]==='verify').args.includes(path.join(directory,'verified-release-run.json')));
});
test('every host gate failure cleans attempt credentials and never retries cutover',async t=>{
 for(let failure=0;failure<11;failure++){const directory=await temp(t),packet=fixture();let calls=0,applies=0;
  await assert.rejects(executeHostGates({directory,packet,request:request(),token:'unit-read-token',run:async(bin,args)=>{if(path.basename(args[0])==='deploy.mjs')applies++;if(calls++===failure)throw Error('injected gate failure');if(path.basename(args[0])==='prepare-host-release.mjs')return 'capture_directory=/private/capture\nhost_config=/private/capture/host.json\nrehearsal_config=/private/capture/rehearsal.json\n';if(path.basename(args[0])==='deploy.mjs')return '{}';return '';}}));
  assert.equal(existsSync(path.join(directory,'docker-auth')),false);assert.ok(applies<=1);assert.equal(existsSync(path.join(directory,'deployed-release')),false);
 }
});
test('interruption waits for in-flight credential writer before cleanup and never starts the next gate',async t=>{
 const directory=await temp(t),packet=fixture(),previousExitCode=process.exitCode;let login=false,prepared=false;
 try{await assert.rejects(executeHostGates({directory,packet,request:request(),token:'unit-read-token',run:async(bin,args)=>{
  if(bin==='docker'){
   login=true;process.emit('SIGTERM');
   // Model Docker completing its config write after the interruption arrived.
   const config=path.join(directory,'docker-auth');await mkdir(config,{recursive:true});await writeFile(path.join(config,'config.json'),'synthetic auth');return '';
  }
  if(path.basename(args[0])==='prepare-host-release.mjs')prepared=true;return '';
 }}),/interrupted/);
 }finally{process.exitCode=previousExitCode;}
 assert.equal(login,true);assert.equal(prepared,false);assert.equal(existsSync(path.join(directory,'docker-auth')),false);
});
test('transport timeout and output bound terminate their local children before returning',async()=>{
 await assert.rejects(execute(process.execPath,['-e','setInterval(()=>{},1000)'],{timeout:50}),/timed out/);
 await assert.rejects(execute(process.execPath,['-e','process.stdout.write("x".repeat(8192));setInterval(()=>{},1000)'],{maxOutput:1024,timeout:5000}),/output exceeded/);
});
test('uncertain SSH result is not retried or uploaded; hosted credentials are cleaned',async t=>{
 const f=await sourceFixture(t);let sshCalls=0,keyFile;
 await assert.rejects(deployOverSSH({controlDirectory:f.control,candidateDirectory:f.candidate,outputDirectory:path.join(f.root,'public'),request:f.request,
  endpoint:{host:'host.example',user:'deploy',port:22},privateKey:'UNIT PRIVATE KEY',knownHosts:'host.example ssh-ed25519 unit',token:'unit-read-token',
  run:async(bin,args,options)=>{if(bin!=='ssh')return execute(bin,args,options);sshCalls++;keyFile=args[args.indexOf('-i')+1];if(args.at(-1).includes('ssh-host-release.mjs'))return JSON.stringify({status:'succeeded'});return '';}}),/Do not repeat apply blindly/);
 assert.equal(sshCalls,5);assert.equal(existsSync(keyFile),false);assert.equal(existsSync(path.join(f.root,'public')),false);
});
test('public repository deployment uses hosted runner and environment-only SSH secrets',async()=>{
 const yaml=createRequire(new URL('../../frontend/package.json',import.meta.url))('js-yaml'),workflow=yaml.load(await readFile(new URL('../../.github/workflows/deploy.yml',import.meta.url),'utf8'));
 assert.equal(workflow.jobs.deploy['runs-on'],'ubuntu-24.04');assert.equal(workflow.jobs.deploy.environment,'production');assert.equal(workflow.jobs.deploy.permissions.packages,'read');assert.equal(workflow.concurrency['cancel-in-progress'],false);
 const step=workflow.jobs.deploy.steps.find(row=>row.run?.includes('ssh-deploy.mjs'));assert.match(step.env.DEPLOY_MODE,/needs.prepare.outputs.deployment_mode/);assert.match(step.env.DEPLOY_SSH_PRIVATE_KEY,/secrets\./);assert.match(step.env.DEPLOY_SSH_KNOWN_HOSTS,/secrets\./);
 const uploads=workflow.jobs.deploy.steps.filter(row=>row.uses?.startsWith('actions/upload-artifact'));assert.deepEqual(uploads.map(row=>row.with.path),['deployed-release/']);
});
