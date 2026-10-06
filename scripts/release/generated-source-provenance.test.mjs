import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {selectGeneratedSourceProvenance} from './generated-source-provenance.mjs';
import {sourceContentManifest} from './source-content-manifest.mjs';
import {evidenceHash} from './validate-manifest.mjs';

const manifestPath = 'infra/release-content-manifest.json', configPath = 'infra/release-build-config.json';
const all = ['frontend', 'backend', 'worker', 'infrastructure'];
function fixture(t, source = 'backend/api.go') {
  const repo = mkdtempSync(path.join(tmpdir(), 'generated-provenance-'));
  t.after(() => {assert.equal(path.dirname(repo), path.resolve(tmpdir()));assert.ok(path.basename(repo).startsWith('generated-provenance-'));rmSync(repo, {recursive:true, force:true});});
  const put = (file, value) => {mkdirSync(path.dirname(path.join(repo,file)), {recursive:true});writeFileSync(path.join(repo,file),value);};
  put(source, 'before\n');
  const previousContent = sourceContentManifest(repo), previousConfig = {baseImages:{NODE_IMAGE:'pinned'},writerPolicy:{compactReceipts:true},contentManifestHash:evidenceHash(previousContent)};
  const previousManifest = {contentManifestHash:evidenceHash(previousContent)};
  put(source, 'after\n');
  const contentManifest = sourceContentManifest(repo), config = {...previousConfig,contentManifestHash:evidenceHash(contentManifest)};
  const changed_files = [source,manifestPath,configPath];
  const reasons = changed_files.map(file => ({path:file,rule:file===source?'backend':'release-tooling',components:file===source?['backend']:all,worker_graph_input:false}));
  const selection = {full_fallback:false,changed_files,reasons,components:Object.fromEntries(all.map(name=>[name,true]))};
  const save = () => {put(manifestPath,JSON.stringify(contentManifest));put(configPath,JSON.stringify(config));};save();
  const baselineFiles = {[manifestPath]:previousContent,[configPath]:previousConfig};
  const options = {repo,selection,config,contentManifest,previousManifest,readBaselineFile:file=>JSON.stringify(baselineFiles[file])};
  return {options,put,save,baselineFiles};
}
test('verified generated checksum updates leave runtime source selection authoritative',t=>{
  const f=fixture(t),result=selectGeneratedSourceProvenance(f.options);
  assert.deepEqual(result.components,{frontend:false,backend:true,worker:false,infrastructure:false});
  assert.deepEqual(result.changed_files,f.options.selection.changed_files);
  assert.equal(result.reasons[1].original_rule,'release-tooling');
  assert.deepEqual(result.reasons[1].derivation.sourceChanges,['backend/api.go']);
});
test('shared catalog consumers and the additive worker graph remain selected',t=>{
  const f=fixture(t,'backend/animationpresentation/catalog.json');
  f.options.selection.reasons[0].components=['frontend','backend','worker'];
  const result=selectGeneratedSourceProvenance(f.options);
  assert.deepEqual(result.components,{frontend:true,backend:true,worker:true,infrastructure:false});
  f.options.selection.reasons[0].components=['backend'];f.options.selection.reasons[1].worker_graph_input=true;
  assert.equal(selectGeneratedSourceProvenance(f.options).components.worker,true);
});
const mutations = {
  'full fallback':f=>{f.options.selection.full_fallback=true;},
  'missing baseline':f=>{f.options.previousManifest=null;},
  'unknown prior provenance':f=>{f.baselineFiles[manifestPath]={schemaVersion:2};},
  'prior manifest binding drift':f=>{f.options.previousManifest.contentManifestHash='sha256:'+'a'.repeat(64);},
  'prior config hash drift':f=>{f.baselineFiles[configPath].contentManifestHash='sha256:'+'a'.repeat(64);},
  'base image change':f=>{f.options.config.baseImages={NODE_IMAGE:'another'};f.save();},
  'writer policy change':f=>{f.options.config.writerPolicy={compactReceipts:false};f.save();},
  'unknown config field':f=>{f.options.config.extra=true;f.save();},
  'missing actual source change':f=>{f.options.selection.changed_files=f.options.selection.changed_files.filter(file=>file!=='backend/api.go');},
  'invented source provenance':f=>{f.put('backend/api.go','unaccounted actual bytes');},
  'provided config differs from checkout':f=>{f.options.config={...f.options.config,platform:'another'};},
  'duplicate original source row':f=>{f.baselineFiles[manifestPath].files.push(f.baselineFiles[manifestPath].files[0]);f.options.previousManifest.contentManifestHash=evidenceHash(f.baselineFiles[manifestPath]);f.baselineFiles[configPath].contentManifestHash=f.options.previousManifest.contentManifestHash;},
};
for (const [name,mutate] of Object.entries(mutations)) test(`conservative selection retained: ${name}`,t=>{
  const f=fixture(t);mutate(f);assert.equal(selectGeneratedSourceProvenance(f.options),f.options.selection);
});
test('unrelated infrastructure and unknown path reasons are never waived',t=>{
  const f=fixture(t);f.options.selection.reasons.push({path:'infra/new-service.yml',rule:'release-tooling',components:all,worker_graph_input:false});
  f.options.selection.changed_files.push('infra/new-service.yml');
  assert.ok(Object.values(selectGeneratedSourceProvenance(f.options).components).every(Boolean));
});
test('source additions and deletions retain their component dependencies',t=>{
  const f=fixture(t);
  rmSync(path.join(f.options.repo,'backend/api.go'));
  f.put('frontend/src/rules/items.json','{"items":[]}\n');
  f.options.contentManifest=sourceContentManifest(f.options.repo);
  f.options.config.contentManifestHash=evidenceHash(f.options.contentManifest);
  f.put(manifestPath,JSON.stringify(f.options.contentManifest));f.put(configPath,JSON.stringify(f.options.config));
  f.options.selection.changed_files.push('frontend/src/rules/items.json');
  f.options.selection.reasons.push({path:'frontend/src/rules/items.json',rule:'shared-runtime',components:['frontend','worker'],worker_graph_input:false});
  const result=selectGeneratedSourceProvenance(f.options);
  assert.deepEqual(result.components,{frontend:true,backend:true,worker:true,infrastructure:false});
  assert.deepEqual([...result.reasons[1].derivation.sourceChanges].sort(),['backend/api.go','frontend/src/rules/items.json']);
});
test('unavailable original Git provenance retains every conservative component',t=>{
  const f=fixture(t);f.options.readBaselineFile=()=>{throw Error('Missing original Git object');};
  assert.equal(selectGeneratedSourceProvenance(f.options),f.options.selection);
});
