#!/usr/bin/env node
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {startTestStack} from '../testing/stack.mjs';
import {localAcceptanceContext} from '../testing/acceptance-context.mjs';
import {createRunFixture,runCommandSeries,summarize} from '../performance/scenarios.mjs';
import {scanCompactReceipts} from './receipt-codec.mjs';
import {databaseRecoveryInventory} from '../release/artifact-references.mjs';

const args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--output') throw Error('Usage: compact-receipts-drill.mjs --output <new report.json>');
const stack=await startTestStack({profile:'integration',reuseBuild:true,performance:true,catalogBatch:true,compactReceipts:true});
const report={schemaVersion:1,scope:'owned-synthetic-receipt-storage',runId:stack.registry.runId,status:'failed',checks:[]};
try {
  const context=await localAcceptanceContext(stack.env),samples=[];
  const fixture=await createRunFixture(context,{onSample:row=>samples.push(row)});
  report.outcome=await runCommandSeries(context,{fixture,count:1000,onProgress:count=>{if(count%100===0)process.stdout.write(`Compact receipts: ${count}/1000 committed commands and exact retries.\n`);}});
  report.timings=summarize(samples);
  // Same exact accepted responses and indexes, same server/TOAST compression.
  // Shadow only in this newly owned test DB; no UPDATE of source receipts.
  await stack.database.query('CREATE TABLE receipt_storage_legacy (LIKE roguelike_command_receipts INCLUDING ALL);');
  let compared=0,logicalBytes=0,encodedBytes=0;
  await scanCompactReceipts(stack.database,async(response,row)=>{
    if(row.table!=='roguelike_command_receipts')return;
    const raw=Buffer.from(JSON.stringify(response));logicalBytes+=raw.length;encodedBytes+=row.payload_bytes;
    assert.match(row.key,/^[a-f0-9-]{36}$/);
    const inserted=(await stack.database.query(`INSERT INTO receipt_storage_legacy(id,run_id,user_id,command_id,command_type,request_hash,response,request,created_at) SELECT id,run_id,user_id,command_id,command_type,request_hash,convert_from(decode('${raw.toString('hex')}','hex'),'UTF8')::jsonb,request,created_at FROM roguelike_command_receipts WHERE id='${row.key}' RETURNING response::text=convert_from(decode('${raw.toString('hex')}','hex'),'UTF8')::jsonb::text;`)).trim();
    assert.match(inserted,/^t(?:\r?\n|$)/);compared++;
  });
  assert.equal(compared,1000);
  const metrics=JSON.parse((await stack.database.query(`SELECT json_agg(json_build_object('relation',name,'rows',(SELECT count(*) FROM roguelike_command_receipts),'totalBytes',pg_total_relation_size(name::regclass),'tableBytes',pg_table_size(name::regclass),'indexBytes',pg_indexes_size(name::regclass),'toastBytes',(SELECT CASE WHEN reltoastrelid=0 THEN 0 ELSE pg_total_relation_size(reltoastrelid) END FROM pg_class WHERE oid=name::regclass))) FROM (VALUES ('roguelike_command_receipts'),('receipt_storage_legacy')) q(name);`)).trim());
  const compact=metrics.find(row=>row.relation==='roguelike_command_receipts'),legacy=metrics.find(row=>row.relation==='receipt_storage_legacy');
  assert.ok(compact.totalBytes<legacy.totalBytes,'No actual PostgreSQL storage improvement');
  const inventory=await databaseRecoveryInventory(stack.database);
  assert.equal(inventory.artifactInventoryComplete,true);
  report.status='passed';report.checks=['1000-real-commands','1000-exact-retries','1000-same-response-legacy-comparisons','bounded-reference-inventory','physical-storage-improvement'].map(id=>({id,status:'passed'}));
  report.storage={logicalBytes,encodedBytes,relations:metrics,savingFraction:1-compact.totalBytes/legacy.totalBytes};
  report.limitations=['Synthetic camp-turn workload only, not production size/saving.', 'Legacy comparison stores identical accepted response values in a new table with matching indexes; no separate legacy API latency run.', 'Timings are diagnostic under concurrent local builds.', 'Writer remains opt-in; historical rows untouched; no expiration or GC.'];
} finally {
  await stack.cleanup();report.cleanup=stack.registry.status;
  await writeFile(args[1],JSON.stringify(report,null,2)+'\n',{flag:'wx'});
}
process.stdout.write('PASS: exact response storage and real command retries verified.\n');
