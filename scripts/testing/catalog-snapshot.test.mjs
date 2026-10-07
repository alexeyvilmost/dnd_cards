import test from 'node:test';
import assert from 'node:assert/strict';
import {assertEmptyNonCatalogSnapshotTables} from './catalog-snapshot.mjs';
function database(tables,count='0') {
 const queries=[];
 return {queries,query:async sql=>{queries.push(sql);return queries.length===1?JSON.stringify(tables):count;}};
}
test('older schemas check existing private storage without requiring newer private tables',async()=>{
 const db=database(['cards','users','characters','characters_v2','test_run_ownership']);
 assert.deepEqual(await assertEmptyNonCatalogSnapshotTables(db),{privateTablesChecked:3,privateRows:0});
 assert(db.queries[1].includes('public."characters_v2"'));assert(!db.queries[1].includes('paper_documents'));assert(!db.queries[1].includes('FROM public."cards"'));
});
test('new private storage outside the catalog allowlist cannot escape the emptiness check',async()=>{
 const db=database(['cards','new_player_journal','test_run_ownership'],'1');
 await assert.rejects(assertEmptyNonCatalogSnapshotTables(db),/Private gameplay rows/);
 assert(db.queries[1].includes('public."new_player_journal"'));
});
test('the owned marker and catalog rows are not mistaken for private gameplay rows',async()=>{
 const db=database(['cards','schema_migrations','test_run_ownership']);
 assert.deepEqual(await assertEmptyNonCatalogSnapshotTables(db),{privateTablesChecked:0,privateRows:0});assert.equal(db.queries.length,1);
});
for(const tables of [['cards','cards'],['cards','users; SELECT 1'],{},['cards',null]])test('invalid table inventory is refused '+JSON.stringify(tables),async()=>{
 const db=database(tables);await assert.rejects(assertEmptyNonCatalogSnapshotTables(db),/Unsupported snapshot/);assert.equal(db.queries.length,1);
});
