#!/usr/bin/env node
// Read-only media/Git inspection. No encoders, remote requests, deletions,
// staging, object pruning or history rewrite. Output paths must be new.
import {createHash} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {readFileSync,readdirSync,lstatSync,existsSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createGzip} from 'node:zlib';
import {repositoryRoot} from '../testing/runtime.mjs';
import {inventory,ignorePolicy,components,copyInputs} from '../release/measure-local.mjs';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const portable=value=>value.replaceAll('\\','/');
const mimeByExtension={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.avif':'image/avif','.gif':'image/gif','.mp3':'audio/mpeg','.ogg':'audio/ogg','.wav':'audio/wav','.woff':'font/woff','.woff2':'font/woff2','.glb':'model/gltf-binary','.gltf':'model/gltf+json','.wasm':'application/wasm','.js':'text/javascript','.css':'text/css','.json':'application/json'};
const git=(repo,args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8',windowsHide:true,maxBuffer:64*1024*1024});
export function localURL(relative) {
  if(!relative||relative.includes('\\')||relative.startsWith('/')||relative.split('/').some(part=>['','..','.'].includes(part)))throw Error('Invalid media path');
  return '/'+relative.split('/').map(encodeURIComponent).join('/');
}
export function imageMetadata(bytes,extension) {
  if(extension==='.png'&&bytes.length>=26&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.toString('ascii',12,16)==='IHDR')return {width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),alphaChannel:[4,6].includes(bytes[25])?'present':'unknown_palette_or_trns',source:'PNG IHDR only; not a pixel/transparency/visual validation'};
  if(extension==='.webp'&&bytes.length>=30&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'&&bytes.toString('ascii',12,16)==='VP8X')return {width:1+bytes.readUIntLE(24,3),height:1+bytes.readUIntLE(27,3),alphaChannel:bytes[20]&16?'present':'absent',source:'WebP VP8X only'};
  if(['.jpg','.jpeg'].includes(extension)&&bytes.length>4&&bytes[0]===255&&bytes[1]===216) {
    let offset=2;
    while(offset+4<bytes.length) {
      if(bytes[offset++]!==255)break;let marker=bytes[offset++];while(marker===255&&offset<bytes.length)marker=bytes[offset++];
      if(marker===217||marker===218)break;if(marker===1||marker>=208&&marker<=215)continue;
      const size=bytes.readUInt16BE(offset);if(size<2||offset+size>bytes.length)break;
      if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)&&size>=7)return {width:bytes.readUInt16BE(offset+5),height:bytes.readUInt16BE(offset+3),alphaChannel:'absent',source:'JPEG SOF; orientation not applied'};
      offset+=size;
    }
  }
  return null;
}
export function walkFiles(root,{excludeDirectories=[]}={}) {
  if(!existsSync(root))return [];
  const rows=[];
  function visit(directory,prefix='') {
    if(lstatSync(directory).isSymbolicLink())throw Error('Media inventory refuses symlink roots');
    for(const entry of readdirSync(directory,{withFileTypes:true})) {
      const absolute=path.join(directory,entry.name),relative=prefix+entry.name,info=lstatSync(absolute);
      if(info.isSymbolicLink())throw Error(`Media inventory refuses symlink: ${relative}`);
      if(info.isDirectory()){if(!excludeDirectories.includes(entry.name))visit(absolute,relative+'/');}
      else if(info.isFile()) {if(/^\.env(?:\.|$)/.test(entry.name))throw Error('Sensitive file is outside media inventory scope');rows.push({relative,absolute,bytes:info.size});}
    }
  }
  visit(root);return rows.sort((a,b)=>a.relative.localeCompare(b.relative,'en'));
}
export function duplicateGroups(rows) {
  const groups=new Map();for(const row of rows){const key=`${row.sha256}:${row.bytes}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
  return [...groups.values()].filter(group=>group.length>1).map(group=>({sha256:group[0].sha256,bytesEach:group[0].bytes,paths:group.map(row=>row.path),repeatedBytes:group[0].bytes*(group.length-1),action:'retain_all_URLs_and_originals; duplicate bytes do not prove duplicate ownership/use'})).sort((a,b)=>b.repeatedBytes-a.repeatedBytes);
}
export function literalReferences(source,knownURLs) {
  const found=[];
  for(const match of source.matchAll(/(["'`])((?:https?:\/\/[^\s"'`]+)?\/[^\s"'`]+)\1/g)) {
    if(match[2].includes('${'))continue;
    let candidate;try{candidate=new URL(match[2],'https://local.invalid').pathname;candidate=localURL(decodeURIComponent(candidate.slice(1)));}catch{continue;}
    if(knownURLs.has(candidate))found.push({url:candidate,line:source.slice(0,match.index).split('\n').length});
  }
  return found;
}
export function verifyMediaManifest(manifest,repo=repositoryRoot) {
  if(manifest.schemaVersion!==1||manifest.status!=='inventory_proposed_manifest_only'||!Array.isArray(manifest.entries))throw Error('Unsupported media manifest');
  const files=new Map();for(const root of ['frontend/public','references'])for(const file of walkFiles(path.join(repo,root)))files.set(`${root}/${file.relative}`,file);
  const seen=new Set();
  for(const row of manifest.entries) {
    const file=files.get(row.path);
    if(!file||seen.has(row.path)||!Number.isSafeInteger(row.bytes)||!(/^[a-f0-9]{64}$/).test(row.sha256))throw Error('Invalid or missing manifest source');
    const bytes=readFileSync(file.absolute);
    if(bytes.length!==row.bytes||digest(bytes)!==row.sha256)throw Error('Manifest source bytes changed');
    const expected=row.path.startsWith('frontend/public/')?localURL(row.path.slice('frontend/public/'.length)):null;
    if(row.currentURL!==expected)throw Error('Legacy URL mapping changed');
    if(expected&&row.proposedContentURL!==`/media/sha256/${row.sha256}${path.extname(row.path).toLowerCase()}`)throw Error('Content URL does not identify original bytes');
    seen.add(row.path);
  }
  if(seen.size!==files.size)throw Error('Manifest omits a current source file');
  return {status:'passed',files:seen.size,currentURLsPreserved:true,sourceBytesUnchanged:true,externalURLReachability:'not_checked'};
}
async function archiveBytes(repo) {
  return new Promise((resolve,reject)=>{
    const child=spawn('git',['-C',repo,'archive','--format=tar','HEAD'],{windowsHide:true,stdio:['ignore','pipe','pipe']}),gzip=createGzip({level:6});
    let tarBytes=0,gzipBytes=0,error='';child.stdout.on('data',chunk=>tarBytes+=chunk.length);child.stderr.on('data',chunk=>error+=chunk);
    child.stdout.pipe(gzip);gzip.on('data',chunk=>gzipBytes+=chunk.length);let ended=false,code;
    const finish=()=>{if(ended&&code!==undefined)code===0?resolve({tarBytes,gzipBytes,gzipLevel:6,basis:'actual streamed git archive HEAD, gzip in memory; no archive written'}):reject(Error('Read-only git archive failed'));};
    gzip.on('end',()=>{ended=true;finish();});gzip.on('error',reject);child.on('error',reject);child.on('close',value=>{code=value;finish();});
  });
}
async function integrity(repo) {
  return new Promise((resolve,reject)=>{
    const child=spawn('git',['-C',repo,'fsck','--full','--no-reflogs','--no-progress'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
    const categories={},examples=[];let partial='';const start=performance.now();
    const consume=chunk=>{partial+=chunk.toString();const lines=partial.split(/\r?\n/);partial=lines.pop();for(const line of lines){const category=/^(dangling|unreachable|missing|broken link|error|warning|notice)/.exec(line)?.[1]??'other';categories[category]=(categories[category]??0)+1;if(examples.length<12&&!['dangling','unreachable'].includes(category))examples.push(line.slice(0,350));}};
    child.stdout.on('data',consume);child.stderr.on('data',consume);child.on('error',reject);child.on('close',code=>{if(partial)consume('\n');resolve({command:'git fsck --full --no-reflogs --no-progress',exitCode:code,status:code===0?'passed':'needs_review',durationMs:Math.round(performance.now()-start),categories,examples,mutations:false});});
  });
}
export async function createMediaInventory(repo=repositoryRoot) {
  const startedAt=new Date().toISOString(),head=git(repo,['rev-parse','HEAD']).trim();
  const tracked=new Set(git(repo,['ls-files','-z']).split('\0').filter(Boolean));
  const rows=[],rootStats={};
  for(const [root,role] of [['frontend/public','runtime-distribution'],['references','reference-or-original-provenance-unverified']]) {
    const files=walkFiles(path.join(repo,root));rootStats[root]={files:files.length,bytes:files.reduce((s,f)=>s+f.bytes,0),trackedFiles:0,trackedBytes:0};
    for(const file of files) {
      const relative=`${root}/${file.relative}`,isTracked=tracked.has(relative),bytes=readFileSync(file.absolute),sha256=digest(bytes),extension=path.extname(file.relative).toLowerCase();
      if(isTracked){rootStats[root].trackedFiles++;rootStats[root].trackedBytes+=bytes.length;}
      const currentURL=role==='runtime-distribution'?localURL(file.relative):null;
      rows.push({path:relative,role,tracked:isTracked,bytes:bytes.length,sha256,mime:mimeByExtension[extension]??'application/octet-stream',dimensions:imageMetadata(bytes,extension),
        currentURL,proposedContentURL:currentURL?`/media/sha256/${sha256}${extension}`:null,proposedURLStatus:currentURL?'not_published':null,
        originalPolicy:'preserve_source_bytes_and_existing_URL',licenseStatus:'not_inferred',literalReferences:[],referenceStatus:currentURL?'dynamic_or_database_references_possible; retain':'reference_original; retain'});
    }
  }
  const runtime=rows.filter(row=>row.currentURL),knownURLs=new Set(runtime.map(row=>row.currentURL)),byURL=new Map(runtime.map(row=>[row.currentURL,row]));
  let scannedSourceFiles=0,skippedLargeSourceFiles=0;
  const sourcePaths=[...tracked].filter(file=>/^(frontend\/(?:src|worker|scripts)\/|backend\/(?:animationpresentation|audiopresentation)\/|frontend\/(?:index\.html|vite\.config\.ts)$)/.test(file)&&/\.(?:tsx?|jsx?|mjs|css|html|json)$/.test(file));
  // Authorized new source files are included through bounded known source roots.
  for(const root of ['frontend/src','frontend/scripts','frontend/worker'])for(const file of walkFiles(path.join(repo,root),{excludeDirectories:['node_modules','dist','tmp','output','outputs','.git']}))if(/\.(?:tsx?|jsx?|mjs|css|html|json)$/.test(file.relative))sourcePaths.push(`${root}/${file.relative}`);
  for(const file of new Set(sourcePaths)) {
    const absolute=path.join(repo,file);if(!existsSync(absolute))continue;const info=lstatSync(absolute);if(!info.isFile()||info.isSymbolicLink())throw Error('Source reference scan requires regular files');if(info.size>2*1024*1024){skippedLargeSourceFiles++;continue;}
    const source=readFileSync(absolute,'utf8');scannedSourceFiles++;
    for(const ref of literalReferences(source,knownURLs)){const row=byURL.get(ref.url);if(row.literalReferences.length<24)row.literalReferences.push({source:file,line:ref.line});row.referenceStatus='literal_reference_found; additional_dynamic_or_database_references_possible';}
  }
  const licenses=[...tracked].filter(file=>/^(?:frontend\/public|references)\//.test(file)&&/(?:^|\/)(?:LICENSE[^/]*|COPYING[^/]*|NOTICE[^/]*|OFL\.txt|README\.md)$/i.test(file)).map(file=>({path:file,sha256:digest(readFileSync(path.join(repo,file)))}));
  const dist=walkFiles(path.join(repo,'frontend/dist')),distMap=new Map(dist.map(file=>[file.relative,file]));
  const distReachability={basis:'local dist filesystem; not HTTP availability',sameBytes:0,missing:[],different:[]};
  for(const row of runtime){const relative=row.path.slice('frontend/public/'.length),file=distMap.get(relative);if(!file)distReachability.missing.push(row.currentURL);else if(digest(readFileSync(file.absolute))!==row.sha256)distReachability.different.push(row.currentURL);else distReachability.sameBytes++;}
  const spec=components.frontend,contextFiles=inventory(repo,ignorePolicy(readFileSync(path.join(repo,spec.ignore),'utf8'))),copies=copyInputs(readFileSync(path.join(repo,spec.dockerfile),'utf8'),contextFiles);
  const tree=git(repo,['ls-tree','-r','-l','-z','HEAD']).split('\0').filter(Boolean).map(line=>{const [metadata,file]=line.split('\t');return {path:file,bytes:Number(metadata.trim().split(/\s+/).at(-1))||0};});
  const objectStats=Object.fromEntries(git(repo,['count-objects','-v']).trim().split(/\r?\n/).map(line=>{const [key,value]=line.split(': ');return [key,Number(value)];}));
  const [archive,fsck]=await Promise.all([archiveBytes(repo),integrity(repo)]);
  const publicGroup=Object.entries(Object.groupBy(runtime,row=>row.path.slice('frontend/public/'.length).split('/')[0])).map(([group,files])=>({group,files:files.length,bytes:files.reduce((sum,row)=>sum+row.bytes,0)})).sort((a,b)=>b.bytes-a.bytes);
  const manifest={schemaVersion:1,status:'inventory_proposed_manifest_only',sourceHead:head,startedAt,completedAt:new Date().toISOString(),workingTreeDirty:git(repo,['status','--porcelain','--untracked-files=no']).trim()!=='',
    entries:rows,licenses,referenceScan:{scannedSourceFiles,skippedLargeSourceFiles,maxReferencesPerEntry:24,completeness:'literal evidence only; dynamic, database and historical documents not exhausted'},
    pipelineContract:{schemaVersion:1,immutableSourceHash:'sha256',derivativeIdentity:['sourceSha256','encoderName','encoderVersion','encoderBinaryDigest','canonicalOptions','outputSha256'],currentURLsRetained:true,automaticOriginalDeletion:false,externalPublication:false,requiredGates:['visual cards/icons/maps at CSS size and zoom','alpha/colour/profile review','print/export at source quality','PWA/offline shell and old cached tab','legacy document/battle URLs and unchanged originals','actual OCI layer/pull bytes after permitted build']}};
  const summary={schemaVersion:1,sourceHead:head,startedAt:manifest.startedAt,completedAt:manifest.completedAt,workingTreeDirty:manifest.workingTreeDirty,roots:rootStats,publicGroups:publicGroup,duplicateGroups:duplicateGroups(rows),
    largestRuntime:runtime.toSorted((a,b)=>b.bytes-a.bytes).slice(0,25).map(({path,bytes,mime,dimensions,referenceStatus})=>({path,bytes,mime,dimensions,referenceStatus})),
    archive:{...archive,headTrackedBlobBytes:tree.reduce((sum,row)=>sum+row.bytes,0),headPublicBlobBytes:tree.filter(row=>row.path.startsWith('frontend/public/')).reduce((sum,row)=>sum+row.bytes,0)},
    dist:{files:dist.length,bytes:dist.reduce((sum,row)=>sum+row.bytes,0),publicReachability:distReachability},
    frontendContext:{estimatedSourceBytes:contextFiles.reduce((sum,row)=>sum+row.bytes,0),files:contextFiles.length,copies:copies.map(({stage,sources,estimated_bytes})=>({stage,sources,estimated_bytes})),basis:'current allowed source bytes; not actual Docker transferred context'},
    git:{objectStats,sizeUnit:'KiB for size/size-pack/size-garbage',integrity:fsck,cloneTransferBytes:null,cloneTransferStatus:'not_measured; local pack/loose size is not clone transfer'},
    docker:{imageBytes:null,pullBytes:null,status:'awaiting_environment; daemon unavailable in REL02, not retried'},browser:{initialTransferBytes:null,status:'not inferred from public/archive/dist; use dedicated browser measurement'},
    transformedFiles:0,deletedFiles:0,rewrittenGitHistory:false};
  return {manifest,summary};
}
async function main(){const args=process.argv.slice(2);if(args.length===2&&args[0]==='--verify'){console.log(JSON.stringify(verifyMediaManifest(JSON.parse(readFileSync(args[1],'utf8')))));return;}if(args.length!==4||args[0]!=='--manifest'||args[2]!=='--summary')throw Error('Usage: media-inventory.mjs --manifest <new file> --summary <new file>, or --verify <manifest>');for(const file of [args[1],args[3]])if(existsSync(file))throw Error('Inventory output must be new');const result=await createMediaInventory();verifyMediaManifest(result.manifest);writeFileSync(args[1],JSON.stringify(result.manifest,null,2)+'\n',{flag:'wx'});writeFileSync(args[3],JSON.stringify(result.summary,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({publicBytes:result.summary.roots['frontend/public'].bytes,archive:result.summary.archive,gitIntegrity:result.summary.git.integrity.status,transformedFiles:0}));}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main().catch(error=>{process.stderr.write(`Media inventory failed (${error.code??'inspection'}); sources were not changed.\n`);process.exitCode=1;});
