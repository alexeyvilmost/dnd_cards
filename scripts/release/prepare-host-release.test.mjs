import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,access} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {prepareHostRelease} from './prepare-host-release.mjs';

async function fixture(t) {
  const root=await mkdtemp(path.join(tmpdir(),'host-release-config-'));
  t.after(async()=>{assert.equal(path.dirname(root),path.resolve(tmpdir()));assert.ok(path.basename(root).startsWith('host-release-config-'));await rm(root,{recursive:true,force:true});});
  const backupDirectory=path.join(root,'backups');await mkdir(backupDirectory);
  const config={root,backupDirectory,postgresImage:'postgres@sha256:'+'a'.repeat(64)};
  const rehearsalTemplate={schemaVersion:1,postgresImage:config.postgresImage,activeStateFile:path.join(root,'active.json'),backupDirectory:'/old/backup'};
  const calls=[];
  return {config,rehearsalTemplate,policy:{productionEnabled:true},captureId:'capture-45-2',enabled:'true',calls,
    capture:async args=>{calls.push(args);await mkdir(args.output,{mode:0o700});return {status:'captured',captureDirectory:args.output};}};
}
test('fresh capture is linked to both rehearsal and final deployment without changing saved host config',async t=>{
  const f=await fixture(t),before=structuredClone({config:f.config,rehearsalTemplate:f.rehearsalTemplate});
  const result=await prepareHostRelease(f),host=JSON.parse(await readFile(result.hostConfig)),rehearsal=JSON.parse(await readFile(result.rehearsalConfig));
  assert.equal(result.status,'captured-awaiting-rehearsal');assert.equal(host.backupDirectory,result.captureDirectory);
  assert.equal(rehearsal.captureDirectory,result.captureDirectory);assert.equal(rehearsal.backupDirectory,undefined);
  assert.deepEqual({config:f.config,rehearsalTemplate:f.rehearsalTemplate},before);assert.equal(f.calls[0].production,true);
});
test('disabled preparation, mismatched database source and unknown capture identities fail before capture',async t=>{
  const f=await fixture(t);
  for(const change of [{enabled:'false'},{captureId:'capture-../outside'},{captureId:'capture-0-1'},
    {rehearsalTemplate:{...f.rehearsalTemplate,postgresImage:'postgres:latest'}},
    {rehearsalTemplate:{...f.rehearsalTemplate,activeStateFile:'/different/active.json'}}])await assert.rejects(prepareHostRelease({...f,...change}));
  assert.equal(f.calls.length,0);
});
test('a mismatched or incomplete capture cannot produce runtime configuration',async t=>{
  const f=await fixture(t);await assert.rejects(prepareHostRelease({...f,capture:async()=>({status:'captured',captureDirectory:'/other'})}),/exact protected/);
});
test('one protected template follows observed legacy, adopted state and later active deployment',async t=>{
  const f=await fixture(t),legacy=path.join(f.config.root,'legacy-observation-first');
  await mkdir(legacy);await writeFile(path.join(legacy,'baseline.json'),'{}');
  f.config.legacyBaselineDirectory=legacy;
  f.rehearsalTemplate.activeStateFile=path.join(legacy,'baseline.json');
  const before=structuredClone({config:f.config,rehearsalTemplate:f.rehearsalTemplate});
  for(const [index,state] of [path.join(legacy,'baseline.json'),path.join(f.config.root,'legacy-state.json'),path.join(f.config.root,'active.json')].entries()) {
    await writeFile(state,'{}');
    const result=await prepareHostRelease({...f,captureId:`capture-46-${index+1}`});
    const rehearsal=JSON.parse(await readFile(result.rehearsalConfig));
    assert.equal(rehearsal.activeStateFile,state);
  }
  assert.equal(f.calls.length,3);
  assert.deepEqual({config:f.config,rehearsalTemplate:f.rehearsalTemplate},before);
});
test('obsolete template paths must still belong to the exact configured deployment root',async t=>{
  const f=await fixture(t);await writeFile(path.join(f.config.root,'active.json'),'{}');
  for(const activeStateFile of [path.join(f.config.root,'unknown.json'),path.join(f.config.root,'legacy-observation-unconfigured','baseline.json'),path.join(f.config.root,'..','active.json')]) {
    await assert.rejects(prepareHostRelease({...f,rehearsalTemplate:{...f.rehearsalTemplate,activeStateFile}}));
  }
  await assert.rejects(prepareHostRelease({...f,config:{...f.config,legacyBaselineDirectory:path.join(f.config.root,'..','legacy-observation-other')}}));
  assert.equal(f.calls.length,0);
});
test('a lifecycle pointer change during capture cannot publish a mismatched rehearsal config',async t=>{
  const f=await fixture(t),legacy=path.join(f.config.root,'legacy-observation-first');
  await mkdir(legacy);await writeFile(path.join(legacy,'baseline.json'),'{}');
  f.config.legacyBaselineDirectory=legacy;f.rehearsalTemplate.activeStateFile=path.join(legacy,'baseline.json');
  await assert.rejects(prepareHostRelease({...f,capture:async args=>{
    const result=await f.capture(args);await writeFile(path.join(f.config.root,'active.json'),'{}');return result;
  }}),/state.*changed/i);
  assert.equal(f.calls.length,1);
  await assert.rejects(access(path.join(f.config.backupDirectory,f.captureId,'rehearsal-config.json')));
});
