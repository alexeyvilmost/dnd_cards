import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync,rmSync,symlinkSync} from 'node:fs';
import path from 'node:path';import {tmpdir} from 'node:os';
import {createCompileLayer} from './compile-layer.mjs';
function fixture(t){const root=mkdtempSync(path.join(tmpdir(),'compile-layer-'));t.after(()=>{assert.equal(path.dirname(root),path.resolve(tmpdir()));assert(path.basename(root).startsWith('compile-layer-'));rmSync(root,{recursive:true,force:true});});const f={dist:path.join(root,'dist'),publicDirectory:path.join(root,'public'),output:path.join(root,'compile-layer')};mkdirSync(f.dist);mkdirSync(f.publicDirectory);return f;}
function put(root,file,bytes){const p=path.join(root,file);mkdirSync(path.dirname(p),{recursive:true});writeFileSync(p,bytes);}
test('media plus compile layer reconstruct every original dist byte without changing originals',t=>{
 const f=fixture(t),files={'index.html':'new html','assets/app-12345678.js':'generated','assets/dice-box/runtime.wasm':Buffer.from([0,1,2,255]),'Карта.png':Buffer.from([9,8,7])};
 for(const [file,bytes]of Object.entries(files))put(f.dist,file,bytes);
 for(const file of ['assets/dice-box/runtime.wasm','Карта.png'])put(f.publicDirectory,file,files[file]);
 put(f.publicDirectory,'unreferenced-original.png','keep original');const result=createCompileLayer(f);assert.equal(result.omittedBytes,7);assert.equal(result.omitted.length,2);
 for(const [file,bytes]of Object.entries(files)){const layer=path.join(f.output,file),actual=existsSync(layer)?layer:path.join(f.publicDirectory,file);assert.deepEqual(readFileSync(actual),Buffer.from(bytes));assert.deepEqual(readFileSync(path.join(f.dist,file)),Buffer.from(bytes));}
 assert.equal(readFileSync(path.join(f.publicDirectory,'unreferenced-original.png'),'utf8'),'keep original');assert.equal(result.originalFilesChanged,false);
});
test('a same-path same-size app override remains in the compile layer',t=>{const f=fixture(t);put(f.dist,'logo.png','new');put(f.publicDirectory,'logo.png','old');const r=createCompileLayer(f);assert.equal(r.omitted.length,0);assert.equal(readFileSync(path.join(f.output,'logo.png'),'utf8'),'new');});
test('only byte-identical public copies are omitted; generated hashes and service worker remain',t=>{const f=fixture(t);for(const [file,bytes]of [['sw.js','generated-sw'],['assets/abc-12345678.css','generated-css'],['pwa.png','same']])put(f.dist,file,bytes);put(f.publicDirectory,'pwa.png','same');put(f.publicDirectory,'sw.js','different-length');const r=createCompileLayer(f);assert.deepEqual(r.omitted.map(x=>x.path),['pwa.png']);assert.equal(r.copied.length,2);});
test('existing output and non-sibling destinations fail without overwriting input',t=>{const f=fixture(t);put(f.dist,'index.html','html');mkdirSync(f.output);assert.throws(()=>createCompileLayer(f));assert.throws(()=>createCompileLayer({...f,output:path.join(f.dist,'new')}));assert.equal(readFileSync(path.join(f.dist,'index.html'),'utf8'),'html');});
test('build symlinks cannot import outside data or mask public copies',t=>{const f=fixture(t);mkdirSync(path.join(f.dist,'external'));symlinkSync(f.publicDirectory,path.join(f.dist,'linked'),process.platform==='win32'?'junction':'dir');assert.throws(()=>createCompileLayer(f),/symlink/);assert.equal(existsSync(path.join(f.publicDirectory,'external')),false);});
