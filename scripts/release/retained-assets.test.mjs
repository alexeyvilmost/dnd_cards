import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isRetainableAsset,retainImmutableAssets} from './retained-assets.mjs';
import {assertOwnedPath} from '../testing/guards.mjs';
function fixture(){const root=mkdtempSync(path.join(tmpdir(),'retained-assets-')),source=path.join(root,'source'),destination=path.join(root,'destination');mkdirSync(source);mkdirSync(destination);return {root,source,destination,put(base,name,value){const file=path.join(base,name);mkdirSync(path.dirname(file),{recursive:true});writeFileSync(file,value);},clean(){assertOwnedPath(tmpdir(),root);rmSync(root,{recursive:true,force:true});}};}
test('retention eligibility is limited to nginx immutable URLs',()=>{
  for(const name of ['assets/index-ABcd123_.js','assets/font-12345678.woff2','workbox-a2b34c.js','media/variants/'+'a'.repeat(64)+'.webp'])assert.equal(isRetainableAsset(name),true,name);
  for(const name of ['index.html','sw.js','registerSW.js','manifest.webmanifest','build-info.json','assets/atlas.png','assets/battle-maps/floor.png','assets/sub/index-12345678.js','assets/index-short.js','assets/index-12345678.map','assets/../index-12345678.js','assets\\index-12345678.js','/assets/index-12345678.js','assets/index-12345678.js?x','assets/%2e%2e-12345678.js','workbox-XYZ.js','media/variants/a.webp','media/variants/'+'A'.repeat(64)+'.webp'])assert.equal(isRetainableAsset(name),false,name);
});
test('retention preserves old tabs by copying hashed variants, reuses exact files, and leaves authored/old retained files untouched',async()=>{
  const f=fixture();try {
    const bytes=Buffer.from('verified variant'),hash=createHash('sha256').update(bytes).digest('hex'),variant=`media/variants/${hash}.webp`;
    f.put(f.source,variant,bytes);f.put(f.source,'assets/index-12345678.js','bundle');f.put(f.source,'workbox-abcdef.js','worker');f.put(f.source,'assets/battle-maps/floor.png','authored');f.put(f.source,'index.html','mutable');f.put(f.destination,'assets/old-unhashed.png','preserved');
    const first=await retainImmutableAssets(f.source,f.destination);assert.equal(first.copied,3);assert.equal((await retainImmutableAssets(f.source,f.destination)).reused,3);
    assert.deepEqual(readFileSync(path.join(f.destination,variant)),bytes);assert.equal(existsSync(path.join(f.destination,'index.html')),false);assert.equal(existsSync(path.join(f.destination,'assets/battle-maps/floor.png')),false);assert.equal(readFileSync(path.join(f.destination,'assets/old-unhashed.png'),'utf8'),'preserved');
  } finally {f.clean();}
});
test('content-addressed filename mismatches and immutable name collisions fail before overwriting bytes',async()=>{
  const f=fixture();try {
    f.put(f.source,'media/variants/'+'a'.repeat(64)+'.webp','wrong');await assert.rejects(retainImmutableAssets(f.source,f.destination),/filename hash mismatch/);rmSync(path.join(f.source,'media/variants/'+'a'.repeat(64)+'.webp'));
    f.put(f.source,'assets/index-12345678.js','new');f.put(f.destination,'assets/index-12345678.js','old');await assert.rejects(retainImmutableAssets(f.source,f.destination),/name collision/);assert.equal(readFileSync(path.join(f.destination,'assets/index-12345678.js'),'utf8'),'old');
  } finally {f.clean();}
});
test('source and target symlink paths plus overlapping roots are rejected',async()=>{
  const f=fixture();try {
    f.put(f.source,'assets/index-12345678.js','safe');await assert.rejects(retainImmutableAssets(f.source,f.source),/separate/);
    const target=path.join(f.root,'external');mkdirSync(target);symlinkSync(target,path.join(f.destination,'assets'),process.platform==='win32'?'junction':'dir');await assert.rejects(retainImmutableAssets(f.source,f.destination),/symlink/);rmSync(path.join(f.destination,'assets'));
    const alias=path.join(f.root,'alias');symlinkSync(f.source,alias,process.platform==='win32'?'junction':'dir');await assert.rejects(retainImmutableAssets(alias,f.destination),/symlink/);
  } finally {f.clean();}
});
