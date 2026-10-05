import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {buildRetentionPlan,verifyRetentionPlan,applyOneDuplicate,restoreOneDuplicate} from './retention-plan.mjs';
import {collectDataURLInventory} from './data-url-inventory.mjs';
import {collectStorageReport} from './storage-report.mjs';
import {startTestStack} from '../testing/stack.mjs';

const index=(name,extra={})=>({relation:'cards',name,definition:`CREATE INDEX ${name} ON public.cards USING btree (owner_id)`,semantic_definition:'same',bytes:8192,is_valid:true,is_ready:true,is_unique:false,is_primary:false,is_replica_identity:false,dependants:0,is_simple_btree:true,...extra});
const inventory=indexes=>({scope:'local-disposable-database',run_id:'test_0123456789abcdef01234567',inventory:{indexes,collected_at:new Date().toISOString(),stats_reset:null}});
test('retention never treats unused tables or zero scans as removal authority',()=>{
  const plan=buildRetentionPlan(inventory([index('one',{idx_scan:0})]));
  assert.equal(plan.candidates.length,0);assert.ok(plan.protected.every(row=>row.decision==='retain'));assert.equal(plan.productionActionsSupported,false);
  assert.throws(()=>buildRetentionPlan({...inventory([]),scope:'production'}));
  assert.throws(()=>verifyRetentionPlan({...plan,runId:'different'}));
});
test('only exact duplicate ordinary nonunique indexes with a concrete rollback qualify',()=>{
  assert.equal(buildRetentionPlan(inventory([index('a'),index('b')])).candidates.length,1);
  for(const patch of [{is_unique:true},{is_primary:true},{is_valid:false},{is_ready:false},{dependants:1},{is_replica_identity:true},{is_simple_btree:false},{semantic_definition:'different'},{definition:'CREATE INDEX b ON public.cards USING btree (owner_id DESC)'}])assert.equal(buildRetentionPlan(inventory([index('a'),index('b',patch)])).candidates.length,0);
});
test('owned real DB plan exports, rechecks, removes one duplicate, restores exact DDL, and never exports data URL bodies',{timeout:90_000},async t=>{
  const stack=await startTestStack({dbOnly:true});
  const proof={schemaVersion:1,scope:'owned-local-index-fixture',status:'running',runId:stack.registry.runId};
  try {
    await stack.database.query(`CREATE TABLE cards(id integer PRIMARY KEY,owner_id integer,image_url text);CREATE INDEX cards_owner_a ON cards(owner_id);CREATE INDEX cards_owner_b ON cards(owner_id);CREATE UNIQUE INDEX cards_owner_unique ON cards(id,owner_id);
      CREATE TABLE paper_documents(id integer PRIMARY KEY,document jsonb);
      INSERT INTO cards VALUES(1,1,'data:image/png;base64,PRIVATE_BODY'),(2,2,'https://example.test/private');
      INSERT INTO paper_documents VALUES(1,'{"portrait":"data:image/svg+xml;base64,PRIVATE_NESTED"}');ANALYZE;`);
    const dataURLs=await collectDataURLInventory(stack.database,{limit:1});
    assert.equal(dataURLs.rows.find(row=>row.table==='cards').entries[0].mime,'image/png');
    assert.equal(dataURLs.rows.find(row=>row.table==='paper_documents').entries[0].mime,'image/svg+xml');
    assert.ok(!JSON.stringify(dataURLs).includes('PRIVATE'));assert.ok(!JSON.stringify(dataURLs).includes('example.test'));
    const report=await collectStorageReport({dsn:stack.database.dsn,registry:stack.registry,sampleLimit:1}),plan=buildRetentionPlan(report,dataURLs);
    assert.equal(plan.candidates.length,1);
    const before=await stack.database.query('SELECT md5(json_agg(cards ORDER BY id)::text) FROM cards;');
    await stack.database.query('DROP INDEX cards_owner_b;CREATE INDEX cards_owner_b ON cards(id);');
    await assert.rejects(()=>applyOneDuplicate({dsn:stack.database.dsn,registry:stack.registry,plan,candidateId:plan.candidates[0].id}),/preimage changed/);
    await stack.database.query('DROP INDEX cards_owner_b;CREATE INDEX cards_owner_b ON cards(owner_id);');
    const explain=async()=>JSON.parse(await stack.database.query(`SET enable_seqscan=off;EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) SELECT owner_id FROM cards WHERE owner_id=2;`))[0];
    const beforePlan=await explain();
    const result=await applyOneDuplicate({dsn:stack.database.dsn,registry:stack.registry,plan,candidateId:plan.candidates[0].id});
    assert.equal(result.status,'applied');assert.equal((await stack.database.query("SELECT to_regclass('public.cards_owner_b') IS NULL;")).trim(),'t');
    const afterPlan=await explain();
    assert.equal(afterPlan.Plan['Actual Rows'],beforePlan.Plan['Actual Rows']);
    assert.equal(afterPlan.Plan['Total Cost'],beforePlan.Plan['Total Cost']);
    assert.equal(afterPlan.Plan['Node Type'],beforePlan.Plan['Node Type']);
    assert.equal(afterPlan.Plan['Index Name'],'cards_owner_a');
    assert.ok(Number.isFinite(beforePlan['Execution Time'])&&Number.isFinite(afterPlan['Execution Time']));
    proof.explain={before:beforePlan,after:afterPlan,meaning:'Same rows/node/cost and surviving eligible index; tiny fixture timings are diagnostic, not production latency evidence'};
    // Fresh invocation reconciles a committed result even if the previous caller
    // lost its acknowledgement; no new drop and no new operation row.
    const repeat=await applyOneDuplicate({dsn:stack.database.dsn,registry:stack.registry,plan,candidateId:plan.candidates[0].id});
    assert.equal(repeat.status,'already_applied');assert.equal(repeat.exportPath,result.exportPath);
    proof.apply=[result.status,repeat.status];
    assert.equal((await stack.database.query('SELECT count(*) FROM test_retention_operations;')).trim(),'1');
    const exportBytes=await readFile(result.exportPath,'utf8');
    await writeFile(result.exportPath,exportBytes.replace('owned-index-recovery','changed-index-recovery'));
    await assert.rejects(()=>applyOneDuplicate({dsn:stack.database.dsn,registry:stack.registry,plan,candidateId:plan.candidates[0].id}),/export changed/);
    await writeFile(result.exportPath,exportBytes);
    await stack.database.query('DROP INDEX cards_owner_a;CREATE INDEX cards_owner_a ON cards(id);');
    await assert.rejects(()=>applyOneDuplicate({dsn:stack.database.dsn,registry:stack.registry,plan,candidateId:plan.candidates[0].id}),/preimage/);
    await stack.database.query('DROP INDEX cards_owner_a;CREATE INDEX cards_owner_a ON cards(owner_id);');
    assert.equal(await stack.database.query('SELECT md5(json_agg(cards ORDER BY id)::text) FROM cards;'),before);
    assert.equal((await restoreOneDuplicate({dsn:stack.database.dsn,registry:stack.registry,exportPath:result.exportPath})).status,'restored');
    assert.equal((await restoreOneDuplicate({dsn:stack.database.dsn,registry:stack.registry,exportPath:result.exportPath})).status,'already_restored');
    await assert.rejects(()=>applyOneDuplicate({dsn:stack.database.dsn,registry:stack.registry,plan,candidateId:plan.candidates[0].id}),/preimage/);
    const restored=buildRetentionPlan(await collectStorageReport({dsn:stack.database.dsn,registry:stack.registry,sampleLimit:1}));assert.deepEqual(restored.candidates[0].proof,plan.candidates[0].proof);
    proof.restore=['restored','already_restored'];proof.rowsUnchanged=true;proof.changedPreimagesRejected=true;
    await stack.database.query("UPDATE test_run_ownership SET run_id='foreign_owner';");await assert.rejects(()=>applyOneDuplicate({dsn:stack.database.dsn,registry:stack.registry,plan,candidateId:plan.candidates[0].id}),/marker/);proof.foreignOwnerRejected=true;
    await stack.database.query('DELETE FROM test_run_ownership;');await assert.rejects(()=>applyOneDuplicate({dsn:stack.database.dsn,registry:stack.registry,plan,candidateId:plan.candidates[0].id}),/marker/);
    proof.status='passed';
  }finally{await stack.cleanup();proof.cleanup=stack.registry.status;if(proof.status!=='passed')proof.status='failed';const file=path.join(stack.registry.directory,'db04-retention-proof.json');await writeFile(file,JSON.stringify(proof,null,2)+'\n');t.diagnostic(file);}
});
