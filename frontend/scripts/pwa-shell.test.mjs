import {test} from 'node:test';
import assert from 'node:assert/strict';
import {shellPrecache} from './pwa-shell.mjs';
import {createShellPrecacheTransform} from './pwa-shell.mjs';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

test('PWA keeps transitive static shell imports and excludes identically named lazy chunks',()=>{
 const bundle={'index.html':{isEntry:true,file:'assets/index-12345678.js',imports:['_shared.js'],dynamicImports:['src/page.tsx'],css:['assets/index-12345678.css']},
 '_shared.js':{file:'assets/shared-12345678.js',imports:['_shared.js']},'src/page.tsx':{file:'assets/index-87654321.js'}};
 const files=['index.html','assets/index-12345678.js','assets/index-12345678.css','assets/shared-12345678.js','assets/index-87654321.js',
 'assets/inter-cyrillic-400-normal-abc.woff2','assets/inter-cyrillic-ext-400-normal-abc.woff2','site_logo.png','assets/map.png'];
 const result=shellPrecache(files.map(url=>({url,revision:'local'})),bundle).manifest.map(entry=>entry.url);
 assert.deepEqual(result,files.filter(file=>!['assets/index-87654321.js','assets/inter-cyrillic-ext-400-normal-abc.woff2','assets/map.png'].includes(file)));
});

test('an incomplete manifest or missing transitive file fails the build',()=>{
 assert.throws(()=>shellPrecache([{url:'index.html'}],{}));
 assert.throws(()=>shellPrecache([{url:'index.html'}],{'index.html':{isEntry:true,file:'missing.js'}}),/omitted/);
 assert.throws(()=>shellPrecache([{url:'index.html'},{url:'main.js'}],{'index.html':{isEntry:true,file:'main.js',imports:['_missing']}}),/static import/);
});

test('the PWA closure reads the resolved private output, never a prior shared build',async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'pwa-private-output-'));
 try{
  for(const name of ['old','current']){mkdirSync(path.join(root,name,'.vite'),{recursive:true});writeFileSync(path.join(root,name,'.vite/manifest.json'),JSON.stringify({'index.html':{isEntry:true,file:`assets/${name}.js`}}));}
  let output=path.join(root,'old');const transform=createShellPrecacheTransform(()=>output);output=path.join(root,'current');
  const entries=['index.html','assets/current.js'].map(url=>({url,revision:'synthetic'}));
  assert.deepEqual((await transform(entries)).manifest,entries);
  output=path.join(root,'old');await assert.rejects(transform(entries),/omitted/);
 }finally{assert.equal(path.dirname(root),path.resolve(tmpdir()));assert.ok(path.basename(root).startsWith('pwa-private-output-'));rmSync(root,{recursive:true,force:true});}
});
