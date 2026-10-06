import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import path from 'node:path';
import {readRetainedRuntime} from './retained-runtime.mjs';
const digest='example.test/image@sha256:'+'a'.repeat(64),commit='b'.repeat(40),configHash='c'.repeat(64);
const unitDatabaseURL=new URL('postgresql://db/owned?sslmode=require');unitDatabaseURL.username='fixture';unitDatabaseURL.password='fixture';
function fixture(t,{explicit=false}={}){
 const root=mkdtempSync(path.join(tmpdir(),'retained-runtime-'));
 t.after(()=>{assert.equal(path.dirname(root),path.resolve(tmpdir()));assert.match(path.basename(root),/^retained-runtime-/);rmSync(root,{recursive:true,force:true});});
 const manifest={releaseId:'old-cfe-style',releaseCommit:commit,components:Object.fromEntries(['backend','frontend','rulesWorker'].map(key=>[key,{imageDigest:digest}]))};
 if(explicit)manifest.writerPolicy={compactReceipts:true,imageJobs:true,frozenCatalogs:false};
 const state={schemaVersion:1,status:'active',manifest,instances:Object.fromEntries(Object.keys(manifest.components).map(key=>[key,{releaseId:manifest.releaseId,releaseCommit:commit}]))};
 const directory=path.join(root,'releases',manifest.releaseId);mkdirSync(directory,{recursive:true});
 const config={root,project:'owned',artifactDirectory:path.join(root,'artifacts'),assetDirectory:path.join(root,'assets')};
 const expectedEnvironment={DB_COMPACT_RECEIPTS:explicit?'1':'0',DB_FROZEN_CATALOGS:'0',IMAGE_JOBS_ENABLED:explicit?'1':'0'};
 for(const prefix of ['BACKEND','FRONTEND','RULES_WORKER'])Object.assign(expectedEnvironment,{[prefix+'_IMAGE']:digest,[prefix+'_RELEASE_ID']:manifest.releaseId,[prefix+'_RELEASE_COMMIT']:commit});
 const env={...expectedEnvironment,APP_ENV_FILE:path.join(root,'old-app.env'),WORKER_ENV_FILE:path.join(root,'old-worker.env'),RULES_ARTIFACTS_DIRECTORY:config.artifactDirectory,FRONTEND_ASSETS_DIRECTORY:config.assetDirectory};
 if(!explicit)for(const key of ['DB_COMPACT_RECEIPTS','DB_FROZEN_CATALOGS','IMAGE_JOBS_ENABLED'])delete env[key];
 const document={services:Object.fromEntries(['backend','frontend','rules-worker'].map(name=>[name,{image:digest,environment:{RELEASE_ID:manifest.releaseId,RELEASE_COMMIT:commit}}]))};
 Object.assign(document.services.backend.environment,{DATABASE_URL:unitDatabaseURL.href,DB_COMPACT_RECEIPTS:explicit?'1':'0',DB_FROZEN_CATALOGS:'0',IMAGE_JOBS_ENABLED:explicit?'1':'0'});
 const files={'state.json':JSON.stringify(state),'compose.env':Object.entries(env).map(([k,v])=>k+'='+v).join('\n')+'\n','compose.prod.yml':'original fixed-OFF compose bytes','Caddyfile':'original caddy bytes','compose.runtime.json':JSON.stringify(document,null,2)+'\n'};
 for(const [name,bytes]of Object.entries(files))writeFileSync(path.join(directory,name),bytes);
 let lastService='';const changes={};const calls=[];
 const command=args=>{calls.push(args);if(args[0]==='ps'){lastService=args.find(a=>a.startsWith('label=com.docker.compose.service=')).split('=').at(-1);return 'a'.repeat(64);}
  if(args[0]==='inspect')return JSON.stringify([{Config:{Image:changes.image??digest,Labels:{'com.docker.compose.project':'owned','com.docker.compose.service':lastService,'com.docker.compose.config-hash':changes.hash??configHash}}}]);
  if(args[0]==='compose'&&args.includes('--hash'))return args.at(-1)+' '+configHash;
  throw Error('Unexpected read command');};
 return {root,directory,config,state,document,expectedEnvironment,files,calls,changes,command,read:()=>readRetainedRuntime(config,state,{command,expectedEnvironment})};
}
test('retained cfe-style OFF launch keeps exact bytes and ignores new mutable render inputs',t=>{
 const f=fixture(t),reader=f.read();reader.assertLive();
 f.config.composeFile=path.join(f.root,'new-compose');writeFileSync(f.config.composeFile,'new dynamic writer policy');
 f.config.appEnvFile=path.join(f.root,'new-app.env');writeFileSync(f.config.appEnvFile,'DATABASE_URL=must-not-be-read');
 assert.deepEqual(reader.document(),f.document);
 for(const [name,bytes]of Object.entries(f.files))assert.equal(readFileSync(path.join(f.directory,name),'utf8'),bytes);
 assert.equal(f.calls.filter(a=>a.includes('--hash')).length,3);assert.ok(f.calls.every(a=>!a.includes('--env-file')&&!a.includes('up')));
 const copy=reader.document();copy.services.backend.environment.DATABASE_URL='mutated';assert.deepEqual(reader.document(),f.document);
});
test('retained file whitespace changes are rejected as byte drift, including original Compose inputs',t=>{
 for(const name of ['state.json','compose.env','compose.prod.yml','Caddyfile','compose.runtime.json']){
  const f=fixture(t),reader=f.read();writeFileSync(path.join(f.directory,name),f.files[name]+' ');
  assert.throws(()=>reader.document(),/bytes changed/);
 }
});
test('retained manifest, generated environment and runtime image/launch/flags reject substitution',t=>{
 for(const change of [
  f=>{const s=structuredClone(f.state);s.manifest.releaseCommit='d'.repeat(40);writeFileSync(path.join(f.directory,'state.json'),JSON.stringify(s));},
  f=>writeFileSync(path.join(f.directory,'compose.env'),f.files['compose.env'].replace('BACKEND_RELEASE_ID=old-cfe-style','BACKEND_RELEASE_ID=other')),
  f=>{f.document.services.frontend.image='other@sha256:'+'d'.repeat(64);},
  f=>{f.document.services['rules-worker'].environment.RELEASE_ID='other';},
  f=>{f.document.services.backend.environment.IMAGE_JOBS_ENABLED='1';},
  f=>{f.document.services.backend.environment.DB_FROZEN_CATALOGS='1';},
 ]){const f=fixture(t);change(f);writeFileSync(path.join(f.directory,'compose.runtime.json'),JSON.stringify(f.document));assert.throws(()=>f.read(),/differs|policy/);}
});
test('retained launch must match live Compose profile and image before reuse',t=>{
 const f=fixture(t),reader=f.read();f.changes.hash='d'.repeat(64);assert.throws(()=>reader.assertLive(),/profile differs/);
 delete f.changes.hash;f.changes.image='other@sha256:'+'d'.repeat(64);assert.throws(()=>reader.assertLive(),/identity differs/);
});
test('explicit writer lineage requires all exact saved policy flags',t=>{
 const f=fixture(t,{explicit:true});assert.equal(f.read().document().services.backend.environment.IMAGE_JOBS_ENABLED,'1');
 writeFileSync(path.join(f.directory,'compose.env'),f.files['compose.env'].replace('IMAGE_JOBS_ENABLED=1\n',''));
 assert.throws(()=>f.read(),/environment differs/);
});
test('retained runtime cannot redirect the configured artifact/asset stores',t=>{
 const f=fixture(t);f.config.artifactDirectory=path.join(f.root,'unrelated-valid-artifacts');
 assert.throws(()=>f.read(),/store paths differ/);
});
