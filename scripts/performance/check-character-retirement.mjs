import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {assertTestDsn,assertRealOwnedPath} from '../testing/guards.mjs';
import {execute,cleanEnvironment,repositoryRoot} from '../testing/runtime.mjs';

// The SQL tests own a second native cluster. They cannot delete tables in the
// enclosing expanded fixture or accept a production database URL.
export async function checkCharacterRetirement(stack,_options={},tools={}){
 assertTestDsn(stack.database.dsn,stack.registry);
 assert.equal((await stack.database.query('SELECT run_id FROM test_run_ownership;')).trim(),stack.registry.runId);
 const script='scripts/database/retired-character-retirement-local.mjs';
 const extra={...(tools.go?{TEST_GO:tools.go}:{}),...(tools.pgBin?{TEST_PG_BIN:tools.pgBin}:{})};
 const output=await execute(process.execPath,[script],{env:cleanEnvironment(extra),timeout:300000,log:path.join(stack.registry.directory,'required-character-retirement.log')});
 const final=JSON.parse(output.trim().split(/\r?\n/).at(-1));assert.equal(final.status,'passed');assert.equal(final.checks,22);
 const directory=await assertRealOwnedPath(path.join(repositoryRoot,'outputs/testing'),final.directory);
 assert(path.basename(directory).startsWith('retired-character-301-'));
 const bytes=await readFile(path.join(directory,'receipt.json')),receipt=JSON.parse(bytes);
 assert.equal(receipt.scope,'owned-synthetic-postgres-retirement-301-transaction');assert.equal(receipt.status,'passed');assert.equal(receipt.productionChanges,0);assert.equal(receipt.actualArchiveRestoreProven,false);assert.equal(receipt.syntheticExternalProofHashes,true);
 assert.equal(receipt.sourceUnchanged,true);assert.equal(receipt.cleanup.status,'stopped');assert.deepEqual(receipt.cleanup.errors,[]);assert.equal(receipt.tests.length,22);assert(receipt.tests.every(test=>test.status==='passed'));
 const hash=b=>'sha256:'+createHash('sha256').update(b).digest('hex');
 assert.equal(receipt.testSourceHash,hash(await readFile(path.join(repositoryRoot,script))));
 assert.equal(receipt.sqlSourceHash,hash(await readFile(path.join(repositoryRoot,'backend/migrations/data/retire-legacy-characters-301.sql'))));
 assert.equal((await stack.database.query('SELECT run_id FROM test_run_ownership;')).trim(),stack.registry.runId);
 return {status:'passed',scope:'separate-owned-synthetic-retirement-301',tests:22,skipped:0,receiptHash:hash(bytes),sqlSourceHash:receipt.sqlSourceHash,cleanup:receipt.cleanup,productionChanges:0,actualArchiveRestoreProven:false};
}
