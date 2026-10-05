import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {sourceContentManifest,assertSourceContentManifest} from './source-content-manifest.mjs';
import {evidenceHash} from './validate-manifest.mjs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('source data provenance includes shipped seeds/migration data, excludes test artifacts and detects drift',t=>{
 const root=mkdtempSync(path.join(tmpdir(),'boh-content-manifest-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const put=(file,value)=>{mkdirSync(path.dirname(path.join(root,file)),{recursive:true});writeFileSync(path.join(root,file),value);};
 for(const file of ['backend/migrations/300.go','backend/itemsource/items.json','frontend/src/rules/data.json','officials/canon/spells.json'])put(file,'{}\r\n');
 for(const file of ['backend/migrations/300_test.go','backend/.env','backend/tmp/out.json','frontend/src/page.tsx'])put(file,'excluded');
 const manifest=sourceContentManifest(root);assert.equal(manifest.files.length,4);assert.equal(manifest.liveDatabase,false);assert.equal(manifest.scope,'source-catalog-data');
 put('infra/release-content-manifest.json',JSON.stringify(manifest));const config={contentManifestHash:evidenceHash(manifest)};assertSourceContentManifest(root,config);
 put('backend/migrations/300.go','{}\n');assertSourceContentManifest(root,config);
 put('backend/migrations/300.go','changed');assert.throws(()=>assertSourceContentManifest(root,config),/drift/);
 put('backend/migrations/300.go','{}\n');put('backend/new-seed.json','{}');assert.throws(()=>assertSourceContentManifest(root,config),/drift/);
});

test('the release CLI refuses stale runtime Go provenance and accepts only a regenerated source binding',t=>{
 const root=mkdtempSync(path.join(tmpdir(),'boh-content-cli-'));t.after(()=>{assert.equal(path.dirname(root),path.resolve(tmpdir()));assert.ok(path.basename(root).startsWith('boh-content-cli-'));rmSync(root,{recursive:true,force:true});});
 const put=(file,value)=>{mkdirSync(path.dirname(path.join(root,file)),{recursive:true});writeFileSync(path.join(root,file),value);};
 put('backend/runtime.go','package main\n');put('infra/release-build-config.json',JSON.stringify({schemaVersion:1,enabled:true,productionMarker:'preserved'}));
 const cli=mode=>spawnSync(process.execPath,[fileURLToPath(new URL('./source-content-manifest.mjs',import.meta.url)),mode,root],{encoding:'utf8'});
 assert.equal(cli('write').status,0);assert.equal(cli('check').status,0);
 put('backend/preparation.go','package main\nvar preparation = 1\n');assert.notEqual(cli('check').status,0);
 assert.equal(cli('write').status,0);assert.equal(cli('check').status,0);
 put('backend/runtime.go','package main\nvar runtime = 2\n');assert.notEqual(cli('check').status,0);
 assert.equal(cli('write').status,0);assert.equal(cli('check').status,0);
 assert.equal(JSON.parse(readFileSync(path.join(root,'infra/release-build-config.json'),'utf8')).productionMarker,'preserved');
});
