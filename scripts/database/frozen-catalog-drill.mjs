#!/usr/bin/env node
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {startTestStack} from '../testing/stack.mjs';
import {localAcceptanceContext} from '../testing/acceptance-context.mjs';
import {runCombatLatency,summarize} from '../performance/scenarios.mjs';

const args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--output')throw Error('Usage: frozen-catalog-drill.mjs --output <new report.json>');
const report={schemaVersion:1,status:'running',scope:'owned-synthetic-catalog-storage',runs:[],limitations:['Different fresh RNG/timestamps/UUIDs across modes; no full-state equivalence claim.','Thirty samples per scenario; p95 preliminary. Concurrent local builds may affect timings.','Immutable initialization input only; dynamic catalogActions/envelope/journal format unchanged.','No production sizes or savings inferred; writer remains disabled by default.']};
try {
  for(const enabled of [false,true]) {
    const stack=await startTestStack({profile:'integration',reuseBuild:true,performance:true,catalogBatch:true,compactReceipts:true,frozenCatalogs:enabled});
    const run={enabled,runId:stack.registry.runId,artifactHash:stack.registry.artifactHash};report.runs.push(run);
    try {
      const samples=[],context=await localAcceptanceContext(stack.env);
      const walBefore=Number((await stack.database.query('SELECT wal_bytes FROM pg_stat_wal;')).trim());
      const outcomes=await runCombatLatency(context,{repetitions:30,partySizes:[1],onSample:row=>samples.push(row),onProgress:({iteration})=>{if(iteration%10===0)process.stdout.write(`Frozen catalog ${enabled?'on':'off'}: ${iteration}/30 battles.\n`);}});
      assert.equal(outcomes.length,60);
      run.timings=summarize(samples);run.samples=samples.length;run.allRetriesExact=true;run.sourceSheetsUnchanged=true;
      run.storage=JSON.parse((await stack.database.query(`SELECT json_build_object(
        'runs',(SELECT count(*) FROM roguelike_runs),'references',(SELECT count(*) FROM roguelike_runs WHERE combat_catalog_ref IS NOT NULL),
        'inlineLogicalBytes',(SELECT sum(octet_length(combat_catalog::text)) FROM roguelike_runs),'inlineStoredBytes',(SELECT sum(pg_column_size(combat_catalog)) FROM roguelike_runs),
        'distinctInlinePayloads',(SELECT count(DISTINCT combat_catalog::text) FROM roguelike_runs),
        'immutableRows',(SELECT count(*) FROM frozen_combat_catalogs),'immutableLogicalBytes',(SELECT coalesce(sum(octet_length(payload::text)),0) FROM frozen_combat_catalogs),
        'relations',(SELECT json_agg(json_build_object('name',name,'bytes',pg_total_relation_size(name::regclass),'tableBytes',pg_table_size(name::regclass),'indexBytes',pg_indexes_size(name::regclass))) FROM (VALUES('roguelike_runs'),('frozen_combat_catalogs'),('roguelike_command_receipts'),('roguelike_combat_events'),('characters_v3'))q(name)));`)).trim());
      run.walBytes=Number((await stack.database.query('SELECT wal_bytes FROM pg_stat_wal;')).trim())-walBefore;
      assert.equal(run.storage.references,enabled?30:0);assert.ok(enabled?run.storage.immutableRows>0:run.storage.immutableRows===0);
      if(enabled)assert.equal(run.storage.inlineLogicalBytes,60);
    } finally {await stack.cleanup();run.cleanup=stack.registry.status;}
  }
  assert.equal(report.runs[0].artifactHash,report.runs[1].artifactHash,'Worker source changed during comparison');
  report.status='passed';
} finally {await writeFile(args[1],JSON.stringify(report,null,2)+'\n',{flag:'wx'});}
process.stdout.write('PASS: new catalogs, unchanged public behavior and exact retries verified.\n');
