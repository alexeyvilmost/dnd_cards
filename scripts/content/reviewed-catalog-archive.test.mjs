import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {archiveReviewedCatalog} from './reviewed-catalog-archive.mjs';
test('preserves reviewed preimages, source and backup identity without overwriting a retry',t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'reviewed-catalog-'));fs.chmodSync(directory,0o700);t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const options={archivePath:path.join(directory,'archive.json'),sourceCommit:'a'.repeat(40),backupId:'protected-capture-123',operation:'catalog-repair',payload:{before:{mechanics:{kind:'heal'}},after:{mechanics:{kind:'heal',who:'target'}}}};
  const first=archiveReviewedCatalog(options);const bytes=fs.readFileSync(options.archivePath,'utf8');
  assert.deepEqual(archiveReviewedCatalog(options),first);assert.equal(fs.readFileSync(options.archivePath,'utf8'),bytes);
  assert.deepEqual(JSON.parse(bytes).payload,options.payload);
  assert.throws(()=>archiveReviewedCatalog({...options,sourceCommit:'b'.repeat(40)}),/identity changed/);
  assert.throws(()=>archiveReviewedCatalog({...options,backupId:undefined}),/requires/);
  if(process.platform!=='win32')assert.equal(fs.statSync(options.archivePath).mode&0o077,0);
});
