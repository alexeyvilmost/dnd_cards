import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,stat,unlink,readdir,appendFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {packBackups,verifyBackupArchive,restoreBackupArchive} from './backup-archive.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fixture(t) {
  const root=await mkdtemp(path.join(tmpdir(),'backup-archive-test-'));
  t.after(()=>{
    assert.equal(path.dirname(path.resolve(root)),path.resolve(tmpdir()));
    assert.match(path.basename(root),/^backup-archive-test-/);
    return rm(root,{recursive:true,force:true});
  });
  const input=path.join(root,'one.dump');
  await writeFile(input,Buffer.from('PGDMP\0original backup bytes'));
  return {root,input,directory:path.join(root,'archive'),outputDirectory:path.join(root,'restore')};
}
async function changeManifest(directory,mutate) {
  const file=path.join(directory,'manifest.json'), manifest=JSON.parse(await readFile(file,'utf8'));
  mutate(manifest);delete manifest.manifestHash;manifest.manifestHash=hash(JSON.stringify(manifest));
  await writeFile(file,JSON.stringify(manifest));
}
function randomBytes(length) {
  const bytes=Buffer.allocUnsafe(length);let state=0x12345678;
  for(let i=0;i<length;i++) {state^=state<<13;state^=state>>>17;state^=state<<5;bytes[i]=state&255;}
  return bytes;
}

test('shifted backups share chunks and restore complete original bytes, including an empty file',async t=>{
  const f=await fixture(t), original=randomBytes(5*1024*1024);
  await writeFile(f.input,original);
  const shifted=path.join(f.root,'two.dump'),empty=path.join(f.root,'empty.dump');
  const shiftedBytes=Buffer.concat([Buffer.from('changed dump metadata header'),original]);
  await writeFile(shifted,shiftedBytes);await writeFile(empty,Buffer.alloc(0));
  const before=await stat(f.input);
  const packed=await packBackups({...f,inputs:[f.input,shifted,empty]});
  assert.equal(packed.files,3);assert.equal(packed.sourceFilesDeleted,0);
  assert.ok(packed.uniqueChunkBytes<packed.originalBytes*0.7,'content boundaries must recover dedup after header insertion');
  assert.equal(packed.productionDatabaseRestored,false);
  const restored=await restoreBackupArchive({...f,expectedManifestHash:packed.manifestHash});
  assert.equal(restored.status,'restored-files');
  assert.deepEqual(await readFile(path.join(f.outputDirectory,'one.dump')),original);
  assert.deepEqual(await readFile(path.join(f.outputDirectory,'two.dump')),shiftedBytes);
  assert.equal((await readFile(path.join(f.outputDirectory,'empty.dump'))).length,0);
  assert.equal((await stat(f.input)).mtimeMs,before.mtimeMs);
  assert.deepEqual(await readFile(f.input),original);
});

test('archive manifest is deterministic and callers can pin its identity',async t=>{
  const f=await fixture(t), first=await packBackups({...f,inputs:[f.input]});
  const second=await packBackups({inputs:[f.input],directory:path.join(f.root,'archive2')});
  assert.equal(first.manifestHash,second.manifestHash);
  await assert.rejects(verifyBackupArchive({...f,expectedManifestHash:'0'.repeat(64)}),/identity changed/);
});

test('pack and restore refuse existing destinations and never overwrite originals',async t=>{
  const f=await fixture(t);await packBackups({...f,inputs:[f.input]});
  await assert.rejects(packBackups({...f,inputs:[f.input]}),{code:'EEXIST'});
  await assert.rejects(restoreBackupArchive({...f,outputDirectory:f.root}),{code:'EEXIST'});
  assert.equal(hash(await readFile(f.input)),hash(Buffer.from('PGDMP\0original backup bytes')));
});

test('corrupt chunks are rejected by verification and restoration without a success receipt',async t=>{
  const f=await fixture(t);await packBackups({...f,inputs:[f.input]});
  const manifest=JSON.parse(await readFile(path.join(f.directory,'manifest.json'),'utf8'));
  const chunk=manifest.files[0].chunks[0];
  await writeFile(path.join(f.directory,'chunks',chunk.sha256),Buffer.alloc(chunk.bytes,23));
  await assert.rejects(verifyBackupArchive(f),/corrupted/);
  await assert.rejects(restoreBackupArchive(f),/corrupted/);
  await assert.rejects(readFile(path.join(f.outputDirectory,'restore-receipt.json')),{code:'ENOENT'});
  await assert.rejects(readFile(path.join(f.outputDirectory,'one.dump')),{code:'ENOENT'});
});

test('missing and truncated chunks fail closed',async t=>{
  const f=await fixture(t);await packBackups({...f,inputs:[f.input]});
  const manifest=JSON.parse(await readFile(path.join(f.directory,'manifest.json'),'utf8'));
  const file=path.join(f.directory,'chunks',manifest.files[0].chunks[0].sha256);
  await writeFile(file,'short');await assert.rejects(verifyBackupArchive(f),/length changed/);
  await unlink(file);await assert.rejects(verifyBackupArchive(f),{code:'ENOENT'});
});

test('manifest tampering, unsupported reader version and oversized chunks are refused',async t=>{
  const f=await fixture(t);await packBackups({...f,inputs:[f.input]});
  const file=path.join(f.directory,'manifest.json'),original=await readFile(file);
  await writeFile(file,original.toString().replace('one.dump','two.dump'));
  await assert.rejects(verifyBackupArchive(f),/identity changed/);
  await writeFile(file,original);await changeManifest(f.directory,m=>{m.schemaVersion=2;});
  await assert.rejects(verifyBackupArchive(f),/Unsupported archive/);
  await writeFile(file,original);await changeManifest(f.directory,m=>{m.files[0].chunks[0].bytes=1048577;});
  await assert.rejects(verifyBackupArchive(f),/Invalid archived chunk/);
});

test('whole-file hashes detect reordered or substituted valid chunks',async t=>{
  const f=await fixture(t);await writeFile(f.input,randomBytes(3*1024*1024));
  await packBackups({...f,inputs:[f.input]});
  await changeManifest(f.directory,m=>{assert.ok(m.files[0].chunks.length>2);m.files[0].chunks.reverse();});
  await assert.rejects(verifyBackupArchive(f),/file checksum changed/);
  await assert.rejects(restoreBackupArchive(f),/file checksum changed/);
});

test('path traversal and cross-platform name collisions cannot select output files',async t=>{
  const f=await fixture(t);await packBackups({...f,inputs:[f.input]});
  await changeManifest(f.directory,m=>{m.files[0].name='../escape.dump';});
  await assert.rejects(restoreBackupArchive(f),/Invalid archived file/);
  const other=path.join(f.root,'other');await mkdir(other);
  const duplicate=path.join(other,'one.dump');await writeFile(duplicate,'second');
  await assert.rejects(packBackups({directory:path.join(f.root,'new'),inputs:[f.input,duplicate]}),/duplicate archive filename/);
  const reserved=path.join(f.root,'restore-receipt.json');await writeFile(reserved,'source');
  await assert.rejects(packBackups({directory:path.join(f.root,'reserved'),inputs:[reserved]}),/Unsafe/);
});

test('linked ancestors cannot redirect packing or restoration',async t=>{
  const f=await fixture(t),linked=path.join(f.root,'linked');
  await symlink(f.root,linked,'junction');
  await assert.rejects(packBackups({directory:path.join(f.root,'new'),inputs:[path.join(linked,'one.dump')]}),/Linked paths/);
  await assert.rejects(packBackups({directory:path.join(linked,'new'),inputs:[f.input]}),/Linked paths/);
  await packBackups({...f,inputs:[f.input]});
  await assert.rejects(restoreBackupArchive({...f,outputDirectory:path.join(linked,'new')}),/Linked paths/);
});

test('an incomplete archive has no readable manifest',async t=>{
  const f=await fixture(t);await mkdir(f.directory);await mkdir(path.join(f.directory,'chunks'));
  await writeFile(path.join(f.directory,'.manifest.json.partial'),'unfinished');
  await assert.rejects(verifyBackupArchive(f),{code:'ENOENT'});
});

test('a backup changed while being read cannot publish a complete archive',async t=>{
  const f=await fixture(t);await writeFile(f.input,randomBytes(32*1024*1024));
  const packing=packBackups({...f,inputs:[f.input]});
  // Attach rejection handling before the deliberate concurrent modification.
  const rejected=assert.rejects(packing,/Backup input changed/);
  const chunks=path.join(f.directory,'chunks');
  const deadline=Date.now()+10000;
  while(true) {
    const files=await readdir(chunks).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
    if(files.length)break;
    assert.ok(Date.now()<deadline,'packing must start within the fixture deadline');
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  await appendFile(f.input,'new source bytes');await rejected;
  await assert.rejects(readFile(path.join(f.directory,'manifest.json')),{code:'ENOENT'});
});
