import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {decodeInlineImage,exportInlineImage,verifyInlineExport,restoreInlineExport} from './inline-image-export.mjs';
import {startTestStack} from '../testing/stack.mjs';

test('inline export decodes exact bytes and rejects ambiguous/nonimage/oversized formats',()=>{
  const image=decodeInlineImage('data:image/png;base64,AAECAw==');assert.deepEqual([...image.bytes],[0,1,2,3]);
  for(const value of ['data:text/html;base64,AAECAw==','data:image/png;base64,AAECAx==','data:image/png;base64,AAECAw','data:image/png,raw','x'.repeat(2*1024*1024+1)])assert.throws(()=>decodeInlineImage(value));
});
test('owned inline export verifies blob/access/reference bytes and restores without entity mutation',{timeout:90_000},async t=>{
  const stack=await startTestStack({dbOnly:true}),proof={schemaVersion:1,scope:'owned-local-inline-export',status:'running',runId:stack.registry.runId};try{
    const value='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    await stack.database.query(`CREATE TABLE cards(id integer PRIMARY KEY,owner_id integer,image_url text);INSERT INTO cards VALUES(1,7,'${value}');`);
    const input={dsn:stack.database.dsn,registry:stack.registry,reference:{table:'cards',column:'image_url',id:'1',jsonPath:[]},owner:{column:'owner_id',value:'7'}};
    const before=await stack.database.query('SELECT md5(json_agg(cards)::text) FROM cards;');
    await assert.rejects(()=>exportInlineImage({...input,owner:{column:'owner_id',value:'8'}}),/inaccessible/);
    const result=await exportInlineImage(input),verification={dsn:input.dsn,registry:input.registry,manifestPath:result.manifestPath};
    assert.equal((await exportInlineImage(input)).manifestPath,result.manifestPath);
    const restored=await restoreInlineExport(verification);assert.equal(await readFile(restored.output,'utf8'),value);
    const manifest=JSON.parse(await readFile(result.manifestPath)),blob=path.join(path.dirname(result.manifestPath),manifest.blob),bytes=await readFile(blob);
    assert.equal(bytes.subarray(0,6).toString('ascii'),'GIF89a');proof.bytes=bytes.length;proof.referenceHash=restored.referenceHash;proof.sourcePreserved=true;
    await writeFile(blob,'changed');await assert.rejects(()=>verifyInlineExport(verification),/corrupted/);await writeFile(blob,bytes);
    await stack.database.query("UPDATE cards SET owner_id=8;");await assert.rejects(()=>verifyInlineExport(verification),/inaccessible/);await stack.database.query('UPDATE cards SET owner_id=7;');
    await stack.database.query("UPDATE cards SET image_url='data:image/png;base64,AQIDBA==';");await assert.rejects(()=>verifyInlineExport(verification),/preimage changed/);await stack.database.query(`UPDATE cards SET image_url='${value}';`);
    assert.equal(await stack.database.query('SELECT md5(json_agg(cards)::text) FROM cards;'),before);
    assert.equal((await restoreInlineExport(verification)).referenceHash,restored.referenceHash);
    await stack.database.query('DELETE FROM test_run_ownership;');await assert.rejects(()=>verifyInlineExport(verification),/marker/);
    proof.status='passed';proof.checks=['repeat-export','repeat-restore','exact-reference-and-blob','changed-blob-rejected','changed-owner-rejected','changed-reference-rejected','foreign-owner-rejected','missing-marker-rejected'];
  }finally{await stack.cleanup();proof.cleanup=stack.registry.status;if(proof.status!=='passed')proof.status='failed';const file=path.join(stack.registry.directory,'db04-inline-export-proof.json');await writeFile(file,JSON.stringify(proof,null,2)+'\n');t.diagnostic(file);}
});
