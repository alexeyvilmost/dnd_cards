#!/usr/bin/env node
// Source catalog provenance, deliberately separate from mutable live DB content.
import {createHash} from 'node:crypto';
import {existsSync,readdirSync,readFileSync,lstatSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {evidenceHash} from './validate-manifest.mjs';
export const contentManifestRules=Object.freeze([
  'backend: non-test .go, .json and .sql (conservative superset of all embedded seeds/migration data)',
  'frontend/src and frontend/charges: .json data and .md raw rule documents',
  'engine/data and officials/canon: .json, .sql, .yaml, .yml, .md and .txt catalog source',
  'exclude hidden directories, node_modules, outputs, output, tmp, backups, dist, testdata, fixtures and test files; reject symlinks',
  'hash UTF-8 text with CRLF normalized to LF, matching Git/Docker source checkout semantics; paths use forward slashes'
]);
const excluded=new Set(['node_modules','outputs','output','tmp','backups','dist','testdata','fixtures']);
export function sourceContentManifest(repo){
  const files=[];
  const walk=(relative,extensions)=>{
    const absolute=path.join(repo,relative);if(!existsSync(absolute))return;
    for(const entry of readdirSync(absolute,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
      if(entry.name.startsWith('.')||excluded.has(entry.name))continue;
      const file=relative+'/'+entry.name;if(entry.isSymbolicLink())throw Error('Catalog provenance rejects symlink input');
      if(entry.isDirectory()){walk(file,extensions);continue;}
      if(!entry.isFile()||!extensions.includes(path.extname(file))||/(?:_test\.go|\.(?:test|spec)\.[^.]+)$/.test(file))continue;
      const bytes=Buffer.from(readFileSync(path.join(repo,file),'utf8').replaceAll('\r\n','\n'));
      files.push({path:file,sha256:'sha256:'+createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length});
    }
  };
  for(const [directory,extensions] of [['backend',['.go','.json','.sql']],['frontend/src',['.json','.md']],['frontend/charges',['.json','.md']],['engine/data',['.json','.sql','.yaml','.yml','.md','.txt']],['officials/canon',['.json','.sql','.yaml','.yml','.md','.txt']]])walk(directory,extensions);
  files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  if(!files.length)throw Error('Empty source catalog provenance');
  return {schemaVersion:1,scope:'source-catalog-data',liveDatabase:false,rules:[...contentManifestRules],files};
}
export function assertSourceContentManifest(repo,config){
  const file=path.join(repo,'infra/release-content-manifest.json');if(lstatSync(file).isSymbolicLink())throw Error('Catalog manifest must be a regular checked-in file');
  const declared=JSON.parse(readFileSync(file,'utf8')),actual=sourceContentManifest(repo);
  if(evidenceHash(declared)!==evidenceHash(actual)||config.contentManifestHash!==evidenceHash(actual))throw Error('Source catalog manifest/config drift; regenerate exact source provenance');
  return actual;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const mode=process.argv[2],repo=path.resolve(process.argv[3]??'.'),file=path.join(repo,'infra/release-content-manifest.json'),configFile=path.join(repo,'infra/release-build-config.json');
  if(mode==='write'){const manifest=sourceContentManifest(repo),config=JSON.parse(readFileSync(configFile,'utf8'));config.contentManifestHash=evidenceHash(manifest);writeFileSync(file,JSON.stringify(manifest,null,2)+'\n');writeFileSync(configFile,JSON.stringify(config,null,2)+'\n');console.log(JSON.stringify({scope:manifest.scope,files:manifest.files.length,hash:config.contentManifestHash}));}
  else if(mode==='check'){const manifest=assertSourceContentManifest(repo,JSON.parse(readFileSync(configFile,'utf8')));console.log(JSON.stringify({status:'passed',scope:manifest.scope,files:manifest.files.length}));}
  else throw Error('Use write or check [repository]');
}
