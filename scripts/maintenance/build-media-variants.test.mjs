import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pngPolicy,sha256} from './build-media-variants.mjs';
import {prepareMediaVariants} from '../../frontend/scripts/media-variants.mjs';
import {assertOwnedPath} from '../testing/guards.mjs';

function png(chunks=[]) {
  const chunk=(name,data)=>{const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(name,4);data.copy(b,8);return b;};
  const header=Buffer.alloc(13);header.writeUInt32BE(2);header.writeUInt32BE(2,4);header[8]=8;header[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),...chunks.map(([name,data])=>chunk(name,data)),chunk('IEND',Buffer.alloc(0))]);
}
function fixture() {
  const directory=mkdtempSync(path.join(tmpdir(),'media-variants-')),publicDirectory=path.join(directory,'public'),bundleDirectory=path.join(directory,'bundle');
  mkdirSync(publicDirectory);mkdirSync(bundleDirectory);mkdirSync(path.join(bundleDirectory,'files'));
  const original=png(),variant=Buffer.from('small-verified-image-fixture'),hash=sha256(variant);
  writeFileSync(path.join(publicDirectory,'a.png'),original);writeFileSync(path.join(bundleDirectory,'files',hash+'.webp'),variant);
  const row={sourcePath:'a.png',sourceURL:'/a.png',sourceSha256:sha256(original),sourceBytes:original.length,status:'variant',variantURL:`/media/variants/${hash}.webp`,variantSha256:hash,variantBytes:variant.length,proof:{width:2,height:2,channels:4,depth:'uchar',rgbaBytes:16,rgbaSha256:'a'.repeat(64),iccBytes:0,iccSha256:null,transparentRGB:'exact_compared',alphaPolicy:'opaque_or_binary_alpha_only'}};
  const manifest={schemaVersion:1,kind:'pixel_verified_lossless_webp',encoder:{versions:{sharp:'0.35.4',webp:'1.6.0'},options:{lossless:true,exact:true}},entries:[row]};
  const save=()=>writeFileSync(path.join(bundleDirectory,'manifest.json'),JSON.stringify(manifest));save();
  return {directory,publicDirectory,bundleDirectory,manifest,row,save,clean(){assertOwnedPath(tmpdir(),directory);rmSync(directory,{recursive:true,force:true});}};
}
test('PNG preflight rejects animation, HDR/custom gamma/chromaticity/orientation and malformed chunks',()=>{
  assert.equal(pngPolicy(png()),null);
  assert.equal(pngPolicy(Buffer.from('bad')),'invalid_png');
  assert.equal(pngPolicy(png([['acTL',Buffer.alloc(8)]])),'animated_original_preserved');
  const gamma=Buffer.alloc(4);gamma.writeUInt32BE(45455);assert.equal(pngPolicy(png([['gAMA',gamma]])),null);
  gamma.writeUInt32BE(100000);assert.match(pngPolicy(png([['gAMA',gamma]])),/nonstandard_gamma/);
  for(const chunk of ['cICP','mDCV','cLLI','eXIf'])assert.match(pngPolicy(png([[chunk,Buffer.alloc(4)]])),/unsupported/);
  assert.match(pngPolicy(png([['cHRM',Buffer.alloc(32)]])),/nonstandard_chromaticity/);
  const depth=png();depth[24]=16;assert.equal(pngPolicy(depth),'only_8_bit_PNG_supported');
  const broken=png();broken.writeUInt32BE(999999,8);assert.equal(pngPolicy(broken),'invalid_png_chunk');
});
test('ordinary builds require neither a bundle nor a locally installed encoder',()=>{
  assert.deepEqual(prepareMediaVariants({enabled:false,bundleDirectory:'missing',publicDirectory:'missing'}),{runtimeManifest:null,plugin:null,summary:{enabled:false,originals:true}});
  assert.throws(()=>prepareMediaVariants({enabled:true}),/requires/);
});
test('legacy diagnostic inspection never yields a runtime mapping or build emitter',()=>{
  const f=fixture();try {
    delete f.row.proof.alphaPolicy;f.save();assert.throws(()=>prepareMediaVariants({enabled:true,...f}),/pixel proof/);
    const diagnostic=prepareMediaVariants({enabled:true,...f,inspectionOnly:true});assert.equal(diagnostic.runtimeManifest,null);assert.equal(diagnostic.plugin,null);assert.equal(diagnostic.summary.enabled,false);
  } finally {f.clean();}
});
test('build adapter validates and emits exact variant bytes without writing originals or public',()=>{
  const f=fixture();try {
    const before=readFileSync(path.join(f.publicDirectory,'a.png')),result=prepareMediaVariants({enabled:true,...f}),emitted=[];
    result.plugin.generateBundle.call({emitFile:asset=>emitted.push(asset)});
    assert.equal(result.runtimeManifest.entries['/a.png'].url,f.row.variantURL);assert.equal(emitted.length,1);assert.equal(sha256(emitted[0].source),f.row.variantSha256);
    assert.deepEqual(readFileSync(path.join(f.publicDirectory,'a.png')),before);
  } finally {f.clean();}
});
test('build adapter refuses changed originals/outputs, omitted sources and missing files',()=>{
  const f=fixture();try {
    const options={enabled:true,...f},source=path.join(f.publicDirectory,'a.png'),original=readFileSync(source);
    writeFileSync(source,'changed');assert.throws(()=>prepareMediaVariants(options),/no longer matches/);writeFileSync(source,original);
    writeFileSync(path.join(f.publicDirectory,'b.png'),original);assert.throws(()=>prepareMediaVariants(options),/omits/);rmSync(path.join(f.publicDirectory,'b.png'));
    const output=path.join(f.bundleDirectory,'files',f.row.variantSha256+'.webp');writeFileSync(output,'tampered');assert.throws(()=>prepareMediaVariants(options),/hash mismatch/);rmSync(output);assert.throws(()=>prepareMediaVariants(options),/ENOENT/);
  } finally {f.clean();}
});
test('build adapter fails closed on URL traversal, missing ICC proof, wrong dimensions and lossless disabled',()=>{
  const f=fixture();try {
    const original=structuredClone(f.manifest),attempt=mutate=>{Object.assign(f.manifest,structuredClone(original));mutate(f.manifest);f.save();assert.throws(()=>prepareMediaVariants({enabled:true,...f}));};
    attempt(m=>m.entries[0].sourcePath='../a.png');attempt(m=>m.entries[0].variantURL='/wrong.webp');attempt(m=>m.entries[0].proof.iccBytes=32);attempt(m=>m.entries[0].proof.width=3);attempt(m=>delete m.entries[0].proof.alphaPolicy);attempt(m=>m.encoder.options.lossless=false);attempt(m=>m.encoder.options.exact=false);attempt(m=>m.entries.push({...m.entries[0]}));
  } finally {f.clean();}
});
test('build adapter refuses symlink bundles and never follows external paths',()=>{
  const f=fixture();try {
    const alias=path.join(f.directory,'alias');symlinkSync(f.bundleDirectory,alias,process.platform==='win32'?'junction':'dir');
    assert.throws(()=>prepareMediaVariants({enabled:true,publicDirectory:f.publicDirectory,bundleDirectory:alias}),/symlink/);
  } finally {f.clean();}
});
