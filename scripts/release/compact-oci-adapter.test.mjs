import{test}from'node:test';import assert from'node:assert/strict';import{mkdtemp,mkdir,writeFile,rm}from'node:fs/promises';import{tmpdir}from'node:os';import path from'node:path';import{createHash}from'node:crypto';import{validateOwnedDump,healthIdentity,imageProtocolEnvironment,browserOriginFromPorts,fixtureImageRoles,imageInputKind,fixtureLaunches}from'./compact-oci-adapter.mjs';
test('registry digest and archive config ID are distinct explicit image inputs',()=>{
 const image='ghcr.io/owner/project/backend@sha256:'+'a'.repeat(64);
 assert.equal(imageInputKind({image}),'registry');
 assert.equal(imageInputKind({imageId:'sha256:'+'b'.repeat(64),archiveHash:'sha256:'+'c'.repeat(64),archive:'/owned/backend.tar'}),'archive');
 for(const row of [{image:'ghcr.io/owner/backend:latest'},{image,imageId:'sha256:'+'b'.repeat(64)},{image,archive:'/tmp/file'},{image:'https://name:secret@ghcr.io/owner/backend@sha256:'+'a'.repeat(64)},{image:'ghcr.io/owner/backend@sha256:short'},{}])assert.throws(()=>imageInputKind(row));
});
test('previous role preserves independently launched component releases',()=>{
 const records={backend:{sourceCommit:'a'.repeat(40)},worker:{sourceCommit:'b'.repeat(40)},frontend:{sourceCommit:'c'.repeat(40)}};
 const previous={backend:{releaseId:'base-api',releaseCommit:'d'.repeat(40)},rulesWorker:{releaseId:'base-worker',releaseCommit:'e'.repeat(40)},frontend:{releaseId:'ui-followon',releaseCommit:'f'.repeat(40)}};
 const saved=fixtureLaunches('previous',records,{previous},'ignored-manifest');assert.deepEqual(saved,previous);previous.frontend.releaseId='mutated';assert.equal(saved.frontend.releaseId,'ui-followon');
 assert.throws(()=>fixtureLaunches('previous',records,{previous:{...previous,frontend:undefined}},'ignored'));
 assert.throws(()=>fixtureLaunches('previous',records,{previous:{...previous,frontend:{releaseId:'valid',releaseCommit:'bad'}}},'ignored'));
 assert.deepEqual(fixtureLaunches('candidate',records,undefined,'single-launch').rulesWorker,{releaseId:'single-launch',releaseCommit:'b'.repeat(40)});
});
test('role pair is complete, explicit and detached from later caller mutation',()=>{
 const pair={candidate:{backend:{imageId:'candidate-api'},worker:{imageId:'candidate-worker'},frontend:{imageId:'candidate-ui'}},previous:{backend:{imageId:'previous-api'},worker:{imageId:'previous-worker'},frontend:{imageId:'previous-ui'}}};
 const saved=fixtureImageRoles({imageRoles:pair});pair.previous.backend.imageId='mutated';assert.equal(saved.previous.backend.imageId,'previous-api');assert.equal(saved.candidate.worker.imageId,'candidate-worker');
 for(const input of [{imageRoles:null},{imageRoles:{candidate:pair.candidate}},{imageRoles:{...pair,unknown:pair.previous}},{imageRoles:pair,backend:pair.candidate.backend},{imageRoles:{...pair,previous:{backend:{},worker:{}}}}])assert.throws(()=>fixtureImageRoles(input));
 const legacy=fixtureImageRoles({backend:{imageId:'same-api'},worker:{imageId:'same-worker'}});assert.deepEqual(legacy.candidate,legacy.previous);legacy.previous.backend.imageId='mutated';assert.equal(legacy.candidate.backend.imageId,'same-api');
});
test('owned dump preflight binds exact native registry directory, profile and bytes before Docker',async t=>{
 const root=await mkdtemp(path.join(tmpdir(),'compact-owned-proof-'));t.after(async()=>{assert.equal(path.dirname(root),path.resolve(tmpdir()));assert.ok(path.basename(root).startsWith('compact-owned-proof-'));await rm(root,{recursive:true,force:true});});
 const runId='test_'+'a'.repeat(24),directory=path.join(root,runId);await mkdir(directory);const registryPath=path.join(directory,'registry.json'),dumpFile=path.join(directory,'database.dump'),bytes=Buffer.from('opaque local synthetic dump'),sha256='sha256:'+createHash('sha256').update(bytes).digest('hex');
 const registry={version:1,runId,directory,status:'stopped',fixture:{profile:'integration-baseline'}};await writeFile(registryPath,JSON.stringify(registry));await writeFile(dumpFile,bytes);
 const proof={schemaVersion:1,kind:'owned-integration-dump',runId,registryPath,dumpFile,sha256,bytes:bytes.length};assert.equal((await validateOwnedDump(proof)).runId,runId);
 for(const patch of [{runId:'test_'+'b'.repeat(24)},{kind:'production-dump'},{sha256:'sha256:'+'0'.repeat(64)},{bytes:bytes.length+1},{dumpFile:path.join(root,'database.dump')}])await assert.rejects(validateOwnedDump({...proof,...patch}));
 for(const patch of [{directory:root},{fixture:{profile:'production-snapshot'}},{status:'starting'}]){await writeFile(registryPath,JSON.stringify({...registry,...patch}));await assert.rejects(validateOwnedDump(proof));}
 await writeFile(registryPath,JSON.stringify(registry));await writeFile(dumpFile,Buffer.from('different bytes'));await assert.rejects(validateOwnedDump(proof));
});
test('owned image protocol is explicit and every configured destination stays on the internal peer',()=>{
 assert.deepEqual(imageProtocolEnvironment(false),{OPENAI_API_KEY:'',OPENAI_BASE_URL:'http://127.0.0.1:1/v1'});
 const env=imageProtocolEnvironment(true,'local-fixture-token');
 assert.equal(new URL(env.OPENAI_BASE_URL).hostname,'image-fixture');assert.equal(new URL(env.YANDEX_CLOUD_ENDPOINT).hostname,'image-fixture');
 assert.equal(env.OPENAI_API_KEY,env.YANDEX_CLOUD_SECRET_ACCESS_KEY);
 for(const values of [[true,''],[true,null],['true','local-fixture-token']])assert.throws(()=>imageProtocolEnvironment(...values));
});
test('browser bridge permits only one random loopback binding, retaining unexposed image declarations',()=>{
 const bindings=[{HostIp:'127.0.0.1',HostPort:'42345'}];
 assert.equal(browserOriginFromPorts({'8090/tcp':null,'8095/tcp':bindings}),'http://127.0.0.1:42345');
 for(const ports of [{'8095/tcp':[{HostIp:'0.0.0.0',HostPort:'42345'}]},{'8095/tcp':[...bindings,...bindings]},{'8095/tcp':bindings,'9000/tcp':bindings},{'8095/tcp':[{HostIp:'127.0.0.1',HostPort:'80'}]},{}])assert.throws(()=>browserOriginFromPorts(ports));
});
test('health identity excludes only the verified live envelope and retains immutable metadata',()=>{
 const identity={provenance:'baked',component:'backend',sourceCommit:'a'.repeat(40),inputFingerprint:'sha256:'+'b'.repeat(64),readerCapabilities:['receipt-v1','receipt-v2']};
 assert.deepEqual(healthIdentity({...identity,status:'ok',timestamp:100}),identity);
 assert.deepEqual(healthIdentity({...identity,status:'ok',timestamp:200}),identity);
 assert.deepEqual(healthIdentity({...identity,status:'ok'}),identity);
 assert.notDeepEqual(healthIdentity({...identity,status:'ok',sourceCommit:'c'.repeat(40)}),identity);
 for(const body of [{...identity,status:'failed'},{...identity,status:'ok',timestamp:'100'},identity,null])assert.throws(()=>healthIdentity(body));
});
