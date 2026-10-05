import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {sourceContentManifest,assertSourceContentManifest} from './source-content-manifest.mjs';
import {evidenceHash} from './validate-manifest.mjs';
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
