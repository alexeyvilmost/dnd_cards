import test from 'node:test';import assert from 'node:assert/strict';import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';import path from 'node:path';
import {anchorUnitFixture} from './ui-anchor-unit-fixture.mjs';import {capturePostDeploymentAnchor} from './capture-full-ui-anchor.mjs';
import {createDockerFrontendAdapter} from './docker-ui-deployment.mjs';import {readProtectedFullAnchor} from './ui-host-anchor.mjs';import {evidenceHash} from './validate-manifest.mjs';
async function setup(t){
  const f=await anchorUnitFixture(t),captured=await capturePostDeploymentAnchor(f);f.config.frontendAnchorFile=captured.anchorFile;f.config.frontendSelectiveEnabled=true;f.config.assetDirectory=path.join(f.config.root,'assets');mkdirSync(f.config.assetDirectory);
  const desired=structuredClone(f.active);desired.manifest={...desired.manifest,releaseId:'ui-b',releaseCommit:'b'.repeat(40),previousReleaseId:desired.manifest.releaseId};desired.manifest.components={...desired.manifest.components,frontend:{...desired.manifest.components.frontend,imageDigest:'example.test/frontend@sha256:'+'b'.repeat(64),sourceCommit:'b'.repeat(40)}};desired.instances.frontend={releaseId:'ui-b',releaseCommit:'b'.repeat(40)};
  const doc=JSON.parse(readFileSync(captured.anchorFile)),plan={kind:'frontend-only',changed:['frontend'],previous:f.active,desired,anchor:doc.binding};
  const calls=[],extracted=new Map();let sequence=0;
  const run=args=>{calls.push(args);if(args[0]==='pull')return '';if(args[0]==='create'){const id=(++sequence).toString(16).padStart(64,'0');extracted.set(id,{image:args.at(-1),name:args[args.indexOf('--name')+1],owner:args[args.indexOf('--label')+1].split('=').slice(1).join('=')});return id;}if(args[0]==='cp'){const id=args[1].split(':')[0],digest=extracted.get(id).image,directory=path.join(args[2],'assets');mkdirSync(directory,{recursive:true});writeFileSync(path.join(directory,digest===desired.manifest.components.frontend.imageDigest?'new-BBBBBBBB.js':'old-AAAAAAAA.js'),digest);return '';}if(args[0]==='ps')return [...extracted].filter(([id,row])=>args.at(-1)==='name=^/'+row.name+'$').map(([id])=>id).join('\n');if(args[0]==='inspect'){const row=extracted.get(args[1]);return JSON.stringify([{Name:'/'+row.name,Config:{Labels:{'bagofholding.ui-extract':row.owner}}}]);}if(args[0]==='rm'){extracted.delete(args[1]);return '';}if(args[0]==='compose')return '';throw Error('Unpermitted Docker operation');};
  const identityProbe=(digest,{candidate,releaseId})=>{const component=[f.active,desired].find(s=>s.manifest.components.frontend.imageDigest===digest).manifest.components.frontend;return {component:'frontend',provenance:'baked',sourceCommit:component.sourceCommit,inputFingerprint:component.inputFingerprint,apiProtocolVersion:1,releaseId,releaseCommit:candidate};};
  return {...f,doc,plan,calls,run,identityProbe};
}
test('real adapter command contract only pulls/extracts frontend and uses fixed no-deps up with both generations retained',async t=>{
  const f=await setup(t),adapter=await createDockerFrontendAdapter(f.config,{authorized:true,command:f.run,identityProbe:f.identityProbe});await adapter.prepare(f.plan);await adapter.replaceFrontend(f.plan.desired);await adapter.replaceFrontend(f.plan.previous);
  assert.deepEqual(f.calls.filter(a=>a[0]==='pull'),[['pull',f.plan.desired.manifest.components.frontend.imageDigest]]);
  const ups=f.calls.filter(a=>a[0]==='compose');assert.equal(ups.length,2);assert.ok(ups.every(a=>a.slice(5).join(' ')==='up -d --no-deps --no-build --pull never --wait frontend'));
  assert.equal(JSON.parse(readFileSync(ups[0][4])).services.frontend.image,f.plan.desired.manifest.components.frontend.imageDigest);assert.equal(JSON.parse(readFileSync(ups[1][4])).services.frontend.image,f.plan.previous.manifest.components.frontend.imageDigest);
  assert.equal(readFileSync(path.join(f.config.assetDirectory,'assets/old-AAAAAAAA.js'),'utf8'),f.plan.previous.manifest.components.frontend.imageDigest);assert.equal(readFileSync(path.join(f.config.assetDirectory,'assets/new-BBBBBBBB.js'),'utf8'),f.plan.desired.manifest.components.frontend.imageDigest);
  assert.ok(f.calls.every(a=>['pull','create','cp','rm','compose','ps','inspect'].includes(a[0])));assert.equal(f.calls.filter(a=>a[0]==='rm').length,2);
});
test('disabled adapter, corrupt protected anchor/compose and unprepared replacement fail before Docker mutation',async t=>{
  const f=await setup(t);await assert.rejects(createDockerFrontendAdapter(f.config,{command:f.run}),/not enabled/);
  const adapter=await createDockerFrontendAdapter(f.config,{authorized:true,command:f.run,identityProbe:f.identityProbe});await assert.rejects(adapter.replaceFrontend(f.plan.desired),/not prepared/);assert.equal(f.calls.length,0);
  writeFileSync(f.doc.runtimeDocument.file,'{}');await assert.rejects(readProtectedFullAnchor(f.config),/composition changed/);assert.equal(f.calls.length,0);
});
test('recovery uses immutable previously prepared B/C documents; replacement cannot accept modified protected runtime',async t=>{
  const f=await setup(t),adapter=await createDockerFrontendAdapter(f.config,{authorized:true,command:f.run,identityProbe:f.identityProbe});await adapter.prepare(f.plan);
  const restarted=await createDockerFrontendAdapter(f.config,{authorized:true,command:f.run,identityProbe:f.identityProbe});restarted.allowRecovery({kind:'frontend-only',plan:f.plan});await restarted.replaceFrontend(f.plan.previous);
  const file=path.join(f.config.root,'frontend-releases',f.plan.previous.manifest.releaseId,'compose.runtime.json'),bad=JSON.parse(readFileSync(file));bad.services.backend.image=f.plan.desired.manifest.components.frontend.imageDigest;writeFileSync(file,JSON.stringify(bad));await assert.rejects(restarted.replaceFrontend(f.plan.previous),/composition changed/);
});
test('lost create response and extraction directory failure clean the exact named owned container',async t=>{
  for(const fault of ['lost-create','directory']){
    const f=await setup(t);let injected=false;
    const run=args=>{const value=f.run(args);if(args[0]==='create'&&!injected){injected=true;
      if(fault==='lost-create')throw Object.assign(Error('lost create response'),{uncertainOutcome:true});
      const dir=path.join(f.config.root,'frontend-releases',f.plan.previous.manifest.releaseId,'extract-previous');writeFileSync(dir,'block directory');
    }return value;};
    const adapter=await createDockerFrontendAdapter(f.config,{authorized:true,command:run,identityProbe:f.identityProbe});
    await assert.rejects(adapter.prepare(f.plan));assert.equal(f.calls.filter(row=>row[0]==='rm').length,1);
    assert.equal(f.calls.some(row=>row[0]==='compose'),false);
  }
});
