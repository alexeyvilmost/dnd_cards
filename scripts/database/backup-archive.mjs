#!/usr/bin/env node
// Lossless, local preparation only. Never deletes backups or restores a database.
import {createHash} from 'node:crypto';
import {lstat, realpath, mkdir, open, readFile, link, unlink} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = /^[a-f0-9]{64}$/;
const parameters = Object.freeze({minBytes:65536, maxBytes:1048576, mask:262143});
const format = 'backup-chunks-v1';
const maxChunks = 1000000;
const gear = new Uint32Array(256);
let seed = 0x6d2b79f5;
for(let i=0;i<gear.length;i++) {
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
  gear[i] = seed >>> 0;
}
const fail = message => {throw Error(message);};
const nameOK = name => typeof name==='string' && /^[a-zA-Z0-9][a-zA-Z0-9_. -]{0,199}$/.test(name)
  && !name.includes('..') && !/[. ]$/.test(name) && name.toLowerCase()!=='restore-receipt.json'
  && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name);

// Refuse linked ancestors as well as linked leaf files on both Windows and Linux.
async function plainPath(value, kind) {
  if(typeof value!=='string' || !path.isAbsolute(value)) fail('Absolute path required');
  const resolved=path.resolve(value), root=path.parse(resolved).root;
  let current=root;
  for(const part of path.relative(root,resolved).split(path.sep).filter(Boolean)) {
    current=path.join(current,part);
    const stat=await lstat(current);
    if(stat.isSymbolicLink()) fail('Linked paths are not supported');
    if(current!==resolved && !stat.isDirectory()) fail('Invalid path ancestor');
  }
  const stat=await lstat(resolved);
  if(kind==='file' && !stat.isFile() || kind==='directory' && !stat.isDirectory()) fail('Unexpected file kind');
  const actual=path.resolve(await realpath(resolved));
  if(process.platform==='win32' ? actual.toLowerCase()!==resolved.toLowerCase() : actual!==resolved) fail('Path resolution changed');
  return {resolved,stat};
}
async function newDirectory(value) {
  if(typeof value!=='string' || !path.isAbsolute(value)) fail('Absolute output directory required');
  const resolved=path.resolve(value);
  await plainPath(path.dirname(resolved),'directory');
  await mkdir(resolved,{mode:0o700}); // EEXIST is an error, including interrupted runs.
  await plainPath(resolved,'directory');
  return resolved;
}
async function writeNew(file, bytes) {
  const handle=await open(file,'wx',0o600);
  try {await handle.writeFile(bytes);await handle.sync();} finally {await handle.close();}
}
async function publishJSON(directory,name,body) {
  const temporary=path.join(directory,`.${name}.partial`);
  await writeNew(temporary,JSON.stringify(body,null,2)+'\n');
  // link is exclusive; rename would silently overwrite a raced destination.
  await link(temporary,path.join(directory,name));
  await unlink(temporary);
}
const sameFile = (a,b) => ['dev','ino','size','mtimeMs','ctimeMs'].every(key=>a[key]===b[key]);

export async function packBackups({inputs,directory}) {
  if(!Array.isArray(inputs) || !inputs.length || inputs.length>1024) fail('Explicit bounded input list required');
  const prepared=[];
  const names=new Set();
  for(const input of inputs) {
    const selected=await plainPath(input,'file'), name=path.basename(selected.resolved);
    if(!nameOK(name) || names.has(name.toLowerCase())) fail('Unsafe or duplicate archive filename');
    names.add(name.toLowerCase());prepared.push({...selected,name});
  }
  const output=await newDirectory(directory), chunksDirectory=path.join(output,'chunks');
  await mkdir(chunksDirectory,{mode:0o700});
  const unique=new Map(), files=[];
  let totalChunks=0;
  for(const input of prepared) {
    const handle=await open(input.resolved,'r');
    const whole=createHash('sha256'), chunks=[];
    let length=0,rolling=0,bytes=0;
    const pending=Buffer.allocUnsafe(parameters.maxBytes);
    async function flush() {
      if(!length) return;
      if(++totalChunks>maxChunks) fail('Archive chunk limit exceeded');
      const data=pending.subarray(0,length), hash=sha(data);
      if(!unique.has(hash)) {
        await writeNew(path.join(chunksDirectory,hash),data);
        unique.set(hash,length);
      } else if(unique.get(hash)!==length) fail('Chunk identity collision');
      chunks.push({sha256:hash,bytes:length});length=0;rolling=0;
    }
    try {
      if(!sameFile(input.stat,await handle.stat())) fail('Backup input changed before reading');
      const buffer=Buffer.allocUnsafe(parameters.maxBytes);
      while(true) {
        const read=await handle.read(buffer,0,buffer.length,null);
        if(!read.bytesRead) break;
        const data=buffer.subarray(0,read.bytesRead);whole.update(data);bytes+=data.length;
        for(const byte of data) {
          pending[length++]=byte;rolling=((rolling<<1)+gear[byte])>>>0;
          if(length>=parameters.minBytes && ((rolling & parameters.mask)===0 || length===parameters.maxBytes)) await flush();
        }
      }
      await flush();
      if(!sameFile(input.stat,await handle.stat()) || bytes!==input.stat.size) fail('Backup input changed while reading');
      const current=await plainPath(input.resolved,'file');
      if(!sameFile(input.stat,current.stat)) fail('Backup input path changed while reading');
    } finally {await handle.close();}
    files.push({name:input.name,bytes,sha256:whole.digest('hex'),chunks});
  }
  const body={schemaVersion:1,format,parameters,files};
  const manifest={...body,manifestHash:sha(JSON.stringify(body))};
  await publishJSON(output,'manifest.json',manifest);
  const result=await verifyBackupArchive({directory:output,expectedManifestHash:manifest.manifestHash});
  return {...result,status:'packed',sourceFilesDeleted:0,productionDatabaseRestored:false};
}

async function loadManifest(directory,expectedManifestHash) {
  const {resolved}=await plainPath(directory,'directory');
  const selected=await plainPath(path.join(resolved,'manifest.json'),'file');
  if(selected.stat.size>64*1024*1024) fail('Manifest size limit exceeded');
  const manifest=JSON.parse(await readFile(selected.resolved,'utf8'));
  const {manifestHash,...body}=manifest;
  if(!digest.test(manifestHash) || sha(JSON.stringify(body))!==manifestHash
    || expectedManifestHash!==undefined && expectedManifestHash!==manifestHash) fail('Archive manifest identity changed');
  if(body.schemaVersion!==1 || body.format!==format || JSON.stringify(body.parameters)!==JSON.stringify(parameters)
    || !Array.isArray(body.files) || !body.files.length || body.files.length>1024) fail('Unsupported archive format');
  const names=new Set();let count=0;
  for(const file of body.files) {
    if(!nameOK(file.name) || names.has(file.name.toLowerCase()) || !Number.isSafeInteger(file.bytes) || file.bytes<0
      || !digest.test(file.sha256) || !Array.isArray(file.chunks)) fail('Invalid archived file');
    names.add(file.name.toLowerCase());let bytes=0;
    for(const chunk of file.chunks) {
      if(++count>maxChunks || !digest.test(chunk.sha256) || !Number.isSafeInteger(chunk.bytes)
        || chunk.bytes<1 || chunk.bytes>parameters.maxBytes) fail('Invalid archived chunk');
      bytes+=chunk.bytes;
    }
    if(bytes!==file.bytes) fail('Archived file length changed');
  }
  await plainPath(path.join(resolved,'chunks'),'directory');
  return {directory:resolved,manifest};
}
async function readChunk(directory,chunk) {
  const selected=await plainPath(path.join(directory,'chunks',chunk.sha256),'file');
  if(selected.stat.size!==chunk.bytes) fail('Archive chunk length changed');
  const bytes=await readFile(selected.resolved);
  if(bytes.length!==chunk.bytes || sha(bytes)!==chunk.sha256) fail('Archive chunk corrupted');
  return bytes;
}

export async function verifyBackupArchive({directory,expectedManifestHash}) {
  const loaded=await loadManifest(directory,expectedManifestHash), unique=new Map();
  let originalBytes=0;
  for(const file of loaded.manifest.files) {
    const whole=createHash('sha256');
    for(const chunk of file.chunks) {
      const bytes=await readChunk(loaded.directory,chunk);whole.update(bytes);
      if(unique.has(chunk.sha256) && unique.get(chunk.sha256)!==bytes.length) fail('Chunk identity collision');
      unique.set(chunk.sha256,bytes.length);
    }
    if(whole.digest('hex')!==file.sha256) fail('Archived file checksum changed');
    originalBytes+=file.bytes;
  }
  return {status:'verified',manifestHash:loaded.manifest.manifestHash,files:loaded.manifest.files.length,
    originalBytes,uniqueChunkBytes:[...unique.values()].reduce((a,b)=>a+b,0),uniqueChunks:unique.size};
}

export async function restoreBackupArchive({directory,outputDirectory,expectedManifestHash}) {
  const loaded=await loadManifest(directory,expectedManifestHash);
  const output=await newDirectory(outputDirectory), restored=[];
  for(const file of loaded.manifest.files) {
    const handle=await open(path.join(output,`.${file.name}.partial`),'wx',0o600), whole=createHash('sha256');
    try {
      for(const chunk of file.chunks) {
        const bytes=await readChunk(loaded.directory,chunk);whole.update(bytes);await handle.writeFile(bytes);
      }
      if(whole.digest('hex')!==file.sha256) fail('Restored file checksum changed');
      await handle.sync();
    } finally {await handle.close();}
    await link(path.join(output,`.${file.name}.partial`),path.join(output,file.name));
    await unlink(path.join(output,`.${file.name}.partial`));
    restored.push({name:file.name,bytes:file.bytes,sha256:file.sha256});
  }
  const result={status:'restored-files',manifestHash:loaded.manifest.manifestHash,files:restored,productionDatabaseRestored:false};
  await publishJSON(output,'restore-receipt.json',result);
  return result;
}

async function cli() {
  const [command,directory,...arguments_]=process.argv.slice(2);
  let result;
  if(command==='pack') result=await packBackups({directory,inputs:arguments_});
  else if(command==='verify' && arguments_.length<=1) result=await verifyBackupArchive({directory,expectedManifestHash:arguments_[0]});
  else if(command==='restore' && arguments_.length>=1 && arguments_.length<=2)
    result=await restoreBackupArchive({directory,outputDirectory:arguments_[0],expectedManifestHash:arguments_[1]});
  else fail('Usage: backup-archive.mjs pack NEW_DIRECTORY FILE... | verify DIRECTORY [MANIFEST_HASH] | restore DIRECTORY NEW_DIRECTORY [MANIFEST_HASH]');
  process.stdout.write(JSON.stringify(result)+'\n');
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) cli().catch(error=>{
  process.stderr.write(`Backup archive failed: ${error.code ?? error.message}\n`);process.exitCode=1;
});
