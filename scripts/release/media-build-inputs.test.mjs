import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {mediaBuildInputs,stageMediaBuildInputs} from './media-build-inputs.mjs';
import {assertOCIMediaDisabled,buildIdentity} from './write-build-identity.mjs';
import {componentInputFingerprint} from './validate-manifest.mjs';
import {assertOwnedPath} from '../testing/guards.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function fixture() {
  const root=mkdtempSync(path.join(tmpdir(),'media-inputs-')),repo=path.join(root,'repo'),bundleDirectory=path.join(root,'bundle'),browserReport=path.join(root,'browser.json');
  mkdirSync(path.join(repo,'frontend/public'),{recursive:true});mkdirSync(path.join(bundleDirectory,'files'),{recursive:true});
  const original=Buffer.alloc(256,3),variant=Buffer.from('synthetic-codec-independent-fixture'),digest=hash(variant);
  writeFileSync(path.join(repo,'frontend/public/a.png'),original);writeFileSync(path.join(bundleDirectory,'files',digest+'.webp'),variant);
  const row={sourcePath:'a.png',sourceURL:'/a.png',sourceSha256:hash(original),sourceBytes:original.length,status:'variant',variantURL:`/media/variants/${digest}.webp`,variantSha256:digest,variantBytes:variant.length,
    proof:{width:2,height:2,channels:4,depth:'uchar',rgbaBytes:16,rgbaSha256:'a'.repeat(64),iccBytes:0,iccSha256:null,transparentRGB:'exact_compared',alphaPolicy:'opaque_or_binary_alpha_only'}};
  const manifest={schemaVersion:1,kind:'pixel_verified_lossless_webp',encoder:{versions:{sharp:'0.35.4',webp:'1.6.0'},options:{lossless:true,exact:true}},entries:[row]};
  const report={schemaVersion:1,status:'passed',browser:'fixture-browser',checks:[{sourceURL:row.sourceURL,variantURL:row.variantURL,equal:true,differentBytes:0,maxDifference:0,opaqueDifferences:0,alphaDifferences:0,rgbaBytes:16}],summary:{browserRGBAEqual:true,failedPairs:0}};
  const save=()=>{writeFileSync(path.join(bundleDirectory,'manifest.json'),JSON.stringify(manifest));writeFileSync(browserReport,JSON.stringify(report));};save();
  return {root,repo,bundleDirectory,browserReport,manifest,report,save,clean(){assertOwnedPath(tmpdir(),root);rmSync(root,{recursive:true,force:true});}};
}
test('release schema v1 rejects enablement and ignored external media inputs before issuing baked identity',()=>{
  assert.deepEqual(assertOCIMediaDisabled({}),{VITE_MEDIA_VARIANTS:'0'});
  assertOCIMediaDisabled({VITE_MEDIA_VARIANTS:'0',MEDIA_VARIANTS_BUNDLE:''});
  for(const env of [{VITE_MEDIA_VARIANTS:'1'},{VITE_MEDIA_VARIANTS:'true'},{VITE_MEDIA_VARIANTS:''},{MEDIA_VARIANTS_BUNDLE:'unbound-directory'}]){
    assert.throws(()=>assertOCIMediaDisabled(env),/schema v1/);
    assert.throws(()=>buildIdentity({component:'frontend',sourceCommit:'a'.repeat(40),inputFingerprint:'sha256:'+'b'.repeat(64),mediaEnvironment:env}),/schema v1/);
  }
  const inputs={component:'frontend',sourceFingerprint:'sha256:'+'a'.repeat(64),platform:'linux/amd64',baseImages:{NODE_IMAGE:'node@sha256:'+'b'.repeat(64),NGINX_IMAGE:'nginx@sha256:'+'c'.repeat(64)}};
  assert.equal(componentInputFingerprint(inputs),componentInputFingerprint({...inputs,buildArguments:{VITE_MEDIA_VARIANTS:'0'}}));
  assert.throws(()=>componentInputFingerprint({...inputs,buildArguments:{VITE_MEDIA_VARIANTS:'1'}}),/schema v1/);
  assert.throws(()=>componentInputFingerprint({...inputs,buildArguments:{MEDIA_VARIANTS_BUNDLE:'/somewhere'}}),/Unknown build argument/);
});
test('build identity CLI refuses enabled environment and writes no misleading file',()=>{
  const f=fixture();try {
    const target=path.join(f.root,'identity.json');
    const result=spawnSync(process.execPath,[fileURLToPath(new URL('./write-build-identity.mjs',import.meta.url)),'frontend',target],{encoding:'utf8',env:{...process.env,VITE_MEDIA_VARIANTS:'1',COMPONENT_SOURCE_COMMIT:'a'.repeat(40),COMPONENT_INPUT_FINGERPRINT:'sha256:'+'b'.repeat(64)}});
    assert.notEqual(result.status,0);assert.match(result.stderr,/schema v1/);assert.equal(existsSync(target),false);
  } finally {f.clean();}
});
test('exact additive media input staging has digest closure, no deploy authority and no extra file copying',()=>{
  const f=fixture();try {
    const first=mediaBuildInputs(f),outputDirectory=path.join(f.root,'stage');
    writeFileSync(path.join(f.bundleDirectory,'unreferenced.tmp'),'not a build input');
    assert.deepEqual(mediaBuildInputs(f),first);assert.equal(first.deployable,false);assert.equal(first.files.length,2);
    const staged=stageMediaBuildInputs({...f,outputDirectory});assert.equal(staged.bundleFingerprint,first.bundleFingerprint);assert.equal(existsSync(path.join(outputDirectory,'bundle/unreferenced.tmp')),false);
    for(const row of staged.files)assert.equal('sha256:'+hash(readFileSync(path.join(outputDirectory,'bundle',row.path))),row.sha256);
    assert.throws(()=>stageMediaBuildInputs({...f,outputDirectory}),/must be new/);
    f.manifest.encodingRun='different provenance';f.save();assert.notEqual(mediaBuildInputs(f).bundleFingerprint,first.bundleFingerprint);
  } finally {f.clean();}
});
test('changed variant/original and mismatched or incomplete browser proof cannot become staged build input',()=>{
  const f=fixture();try {
    const initial=structuredClone(f.report);
    for(const change of [r=>r.status='failed',r=>r.checks.pop(),r=>r.checks.push({...r.checks[0]}),r=>r.checks[0].variantURL='/wrong.webp',r=>r.checks[0].differentBytes=1]) {
      Object.assign(f.report,structuredClone(initial));change(f.report);f.save();assert.throws(()=>mediaBuildInputs(f));
    }
    Object.assign(f.report,initial);f.save();
    const variant=path.join(f.bundleDirectory,'files',f.manifest.entries[0].variantSha256+'.webp'),bytes=readFileSync(variant);
    writeFileSync(variant,'changed');assert.throws(()=>mediaBuildInputs(f),/hash mismatch/);writeFileSync(variant,bytes);
    writeFileSync(path.join(f.repo,'frontend/public/a.png'),'changed');assert.throws(()=>mediaBuildInputs(f),/no longer matches/);
  } finally {f.clean();}
});
