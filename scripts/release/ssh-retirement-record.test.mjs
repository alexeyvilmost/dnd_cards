// Real local Git/credential cleanup with a synthetic SSH peer and workflow.
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,copyFile} from 'node:fs/promises';import {existsSync} from 'node:fs';import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {unpackControlArchive} from './ssh-archive.mjs';
import {retirementRecordUnitFixture} from './retirement-record-unit-fixture.mjs';
import {execute,validateSSHRequest} from './ssh-transport.mjs';
import {recordRetirementObservation} from './retirement-record-host.mjs';
import {retirementBaselineReceipt} from './retirement-projection.mjs';
import {validateRetirementSSHRequest,validateRetirementRecordPacket,validateRetirementRecordReceipt,createRetirementRecordTransfer,recordRetirementOverSSH,retirementRecordControlPaths} from './ssh-retirement-record.mjs';

async function fixture(t){
  const f=retirementRecordUnitFixture(t),controlDirectory=path.join(f.root,'control');await mkdir(controlDirectory);
  await execute('git',['init','--quiet'],{cwd:controlDirectory});
  for(const input of retirementRecordControlPaths){
    const file=path.join(controlDirectory,input.endsWith('.sql')||input.endsWith('.go')?input:input+'/source.txt');
    await mkdir(path.dirname(file),{recursive:true});await writeFile(file,'Synthetic exact record source');
  }
  await mkdir(path.join(controlDirectory,'frontend/public'),{recursive:true});await writeFile(path.join(controlDirectory,'frontend/public/media.txt'),'Unnecessary application media');
  await execute('git',['add','.'],{cwd:controlDirectory});await execute('git',['-c','user.name=Unit Fixture','-c','user.email=fixture@example.invalid','commit','--quiet','-m','record transport fixture'],{cwd:controlDirectory});
  f.request.controlCommit=(await execute('git',['rev-parse','HEAD'],{cwd:controlDirectory})).trim();f.run.head_sha=f.request.controlCommit;
  const request={schemaVersion:1,...f.request,mode:'record-retirement',attemptRoot:'/opt/app/deploy-attempts',hostConfig:'/opt/app/config.json',nodePath:'/usr/local/bin/node',productionEnabled:'true'};
  const projection=await recordRetirementObservation(f),response={status:'recorded-retirement-only',manifest:projection.active.manifest,deployment:retirementBaselineReceipt(projection),retirementObservation:projection};
  return {...f,request,controlDirectory,response,endpoint:{host:'server.example',user:'deploy',port:22},privateKey:'PRIVATE KEY UNIT-FIXTURE',knownHosts:'UNIT PINNED HOST',token:'fixture-job-token',outputDirectory:path.join(f.root,'public')};
}

test('record envelope rejects automatic/apply/adopt/extra fields and cannot authorize ordinary deployment',async t=>{
  const f=await fixture(t);validateRetirementSSHRequest(f.request);
  for(const change of [{eventName:'workflow_run'},{mode:'apply'},{mode:'adopt'},{productionEnabled:'false'},{nodePath:'/bin/node;bad'},{attemptRoot:'/opt/app/../other'},{private:'PRIVATE_CANARY'}])assert.throws(()=>validateRetirementSSHRequest({...f.request,...change}));
  assert.throws(()=>validateSSHRequest({...f.request,rehearsalConfig:'/opt/app/rehearsal.json'}));
});

test('exact real Git archive and receipt remain separate from candidates; corruption rejects publication',async t=>{
  const f=await fixture(t),directory=path.join(f.root,'transfer');await mkdir(directory);
  const transfer=await createRetirementRecordTransfer({...f,directory,run:execute});validateRetirementRecordPacket(transfer.packet);validateRetirementRecordReceipt(f.response,transfer.packet);
  assert.deepEqual(Object.keys(JSON.parse(await readFile(transfer.packetFile,'utf8'))).sort(),['schemaVersion','kind','request','operationId','expectedManifestHash','archiveHash'].sort());
  for(const change of [r=>r.status='succeeded',r=>r.deployment.retirementObservationHash='sha256:'+'f'.repeat(64),r=>r.retirementObservation.deployment.runAttempt++,r=>r.private='PRIVATE_CANARY']){const result=structuredClone(f.response);change(result);assert.throws(()=>validateRetirementRecordReceipt(result,transfer.packet));}
  await writeFile(path.join(f.controlDirectory,'tests/source.txt'),'dirty source');await assert.rejects(createRetirementRecordTransfer({...f,directory,run:execute}),error=>error.code==='ERR_ASSERTION');
});

test('narrow exact Git archive retains the actual host import closure and omits application media',async t=>{
  const f=await fixture(t),repository=fileURLToPath(new URL('../../',import.meta.url));
  const tracked=(await execute('git',['ls-files','--',...retirementRecordControlPaths],{cwd:repository})).trim().split('\n').filter(Boolean);
  const ownedNew=['retirement-record-ci.mjs','retirement-record-ci.test.mjs','retirement-record-host.mjs','retirement-record-host.test.mjs','retirement-record-unit-fixture.mjs','retirement-record-workflow.test.mjs','ssh-host-retirement-record.mjs','ssh-retirement-record.mjs','ssh-retirement-record.test.mjs'].map(n=>'scripts/release/'+n);
  for(const relative of new Set([...tracked,...ownedNew])){
    const destination=path.join(f.controlDirectory,relative);await mkdir(path.dirname(destination),{recursive:true});await copyFile(path.join(repository,relative),destination);
  }
  await execute('git',['add','.'],{cwd:f.controlDirectory});await execute('git',['-c','user.name=Unit Fixture','-c','user.email=fixture@example.invalid','commit','--quiet','-m','Synthetic current host closure'],{cwd:f.controlDirectory});
  f.request.controlCommit=(await execute('git',['rev-parse','HEAD'],{cwd:f.controlDirectory})).trim();
  const directory=path.join(f.root,'closure-transfer');await mkdir(directory);
  const transfer=await createRetirementRecordTransfer({...f,directory,run:execute});
  const unpack=createRequire(import.meta.url)('node:vm').runInNewContext('('+unpackControlArchive.toString()+')',{require:createRequire(import.meta.url),Buffer});
  const receipt=unpack(directory,transfer.packet.archiveHash,f.request.controlCommit);assert.equal(receipt.commit,f.request.controlCommit);assert(receipt.files>100);
  assert.equal(existsSync(path.join(directory,'control/frontend/public/media.txt')),false);
  execFileSync(process.execPath,['--input-type=module','-e','await import('+JSON.stringify(pathToFileURL(path.join(directory,'control/scripts/release/ssh-host-retirement-record.mjs')).href)+');'],{cwd:directory,encoding:'utf8',stdio:['ignore','pipe','pipe']});
});

test('record transport emits only the bound three files and cleans temporary credentials',async t=>{
  const f=await fixture(t);let keyFile,hostCalls=0;
  const run=async(command,args,options)=>{
    if(command==='git')return execute(command,args,options);
    assert.equal(command,'ssh');keyFile=args[args.indexOf('-i')+1];assert(existsSync(keyFile));assert(!args.some(a=>a.includes(f.token)));
    if(args.at(-1).includes('ssh-host-retirement-record.mjs')){hostCalls++;assert.equal(options.input,f.token);return JSON.stringify(f.response);}return '';
  };
  const result=await recordRetirementOverSSH({...f,run});assert.equal(result.status,'recorded-retirement-only');assert.equal(hostCalls,1);assert.equal(existsSync(keyFile),false);
  for(const name of ['manifest.json','deployment.json','retirement-observation.json'])assert(existsSync(path.join(f.outputDirectory,name)));
  assert.equal(existsSync(path.join(f.outputDirectory,'candidate.json')),false);
});

test('an unknown peer result is not retried or published and still cleans credentials',async t=>{
  const f=await fixture(t);let keyFile,hostCalls=0;
  const run=async(command,args,options)=>{if(command==='git')return execute(command,args,options);assert.equal(command,'ssh');keyFile=args[args.indexOf('-i')+1];if(args.at(-1).includes('ssh-host-retirement-record.mjs')){hostCalls++;throw Error('response unavailable');}return '';};
  await assert.rejects(recordRetirementOverSSH({...f,run}),/inspect/);assert.equal(hostCalls,1);assert.equal(existsSync(keyFile),false);assert.equal(existsSync(f.outputDirectory),false);
});
