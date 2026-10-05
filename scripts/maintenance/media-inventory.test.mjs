import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {localURL,imageMetadata,walkFiles,duplicateGroups,literalReferences,verifyMediaManifest} from './media-inventory.mjs';
import {assertOwnedPath} from '../testing/guards.mjs';

test('media paths preserve old names while safely encoding hash-query characters',()=>{
  assert.equal(localURL('images/Карта #1.png'),'/images/%D0%9A%D0%B0%D1%80%D1%82%D0%B0%20%231.png');
  for(const file of ['/absolute.png','../parent.png','images/../x.png','images\\x.png','images//x.png'])assert.throws(()=>localURL(file));
});
test('image metadata reads headers without decoding or claiming pixel quality',()=>{
  const png=Buffer.alloc(26);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.write('IHDR',12);png.writeUInt32BE(1024,16);png.writeUInt32BE(1536,20);png[25]=6;
  assert.deepEqual(Object.fromEntries(Object.entries(imageMetadata(png,'.png')).filter(([k])=>k!=='source')),{width:1024,height:1536,alphaChannel:'present'});
  assert.equal(imageMetadata(Buffer.from('broken'),'.png'),null);
  assert.equal(imageMetadata(Buffer.from('<svg/>'),'.svg'),null);
});
test('literal evidence does not treat unresolved runtime or stored document URLs as unused',()=>{
  const refs=literalReferences('const a="/images/icon.png?v=2";\nconst b=`/icons/${name}.png`;const c="https://cdn.example/images/icon.png";',new Set(['/images/icon.png','/icons/x.png']));
  assert.deepEqual(refs,[{url:'/images/icon.png',line:1},{url:'/images/icon.png',line:2}]);
  const duplicates=duplicateGroups([{path:'public/a.png',sha256:'a',bytes:10},{path:'references/a.png',sha256:'a',bytes:10}]);
  assert.equal(duplicates[0].repeatedBytes,10);assert.match(duplicates[0].action,/retain/);
});
test('read-only tree inventory refuses symlinks and sensitive files; excludes generated source directories',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'media-inventory-'));
  try {
    await mkdir(path.join(root,'images'));await writeFile(path.join(root,'images','a.png'),'source');await mkdir(path.join(root,'node_modules'));await writeFile(path.join(root,'node_modules','secret.txt'),'ignored');
    assert.deepEqual(walkFiles(root,{excludeDirectories:['node_modules']}).map(row=>row.relative),['images/a.png']);
    await writeFile(path.join(root,'.env'),'do-not-read');assert.throws(()=>walkFiles(root),/Sensitive/);await rm(path.join(root,'.env'));
    await symlink(path.join(root,'images'),path.join(root,'alias'),process.platform==='win32'?'junction':'dir');assert.throws(()=>walkFiles(root),/symlink/);
  } finally {assertOwnedPath(tmpdir(),root);await rm(root,{recursive:true,force:true});}
});
test('manifest verifier rejects changed original bytes, old URL remapping and missing source entries',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'media-manifest-'));
  try {
    await mkdir(path.join(root,'frontend/public'),{recursive:true});const file=path.join(root,'frontend/public/a.png');await writeFile(file,'original');
    const sha256=createHash('sha256').update('original').digest('hex'),row={path:'frontend/public/a.png',bytes:8,sha256,currentURL:'/a.png',proposedContentURL:`/media/sha256/${sha256}.png`};
    const manifest={schemaVersion:1,status:'inventory_proposed_manifest_only',entries:[row]};
    assert.equal(verifyMediaManifest(manifest,root).status,'passed');
    assert.throws(()=>verifyMediaManifest({...manifest,entries:[{...row,currentURL:'/changed.png'}]},root),/mapping/);
    assert.throws(()=>verifyMediaManifest({...manifest,entries:[]},root),/omits/);
    await writeFile(file,'changed!');assert.throws(()=>verifyMediaManifest(manifest,root),/bytes changed/);
  } finally {assertOwnedPath(tmpdir(),root);await rm(root,{recursive:true,force:true});}
});
