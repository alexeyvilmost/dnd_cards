#!/usr/bin/env node
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {startTestStack} from '../testing/stack.mjs';
import {localAcceptanceContext} from '../testing/acceptance-context.mjs';
import {repositoryRoot} from '../testing/runtime.mjs';
import {collectStorageReport} from './storage-report.mjs';
import {createRunFixture, runCommandSeries, summarize} from '../performance/scenarios.mjs';

async function main() {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--count' || !['100', '1000'].includes(args[1]))) throw Error('Usage: storage-growth.mjs [--count 100|1000]');
  const counts = args.length ? [Number(args[1])] : [100, 1000];
  for (const count of counts) {
    const stack = await startTestStack({profile: 'integration', reuseBuild: true, performance: true});
    const output = path.join(repositoryRoot, 'outputs/testing/storage-growth', `${stack.registry.runId}-${count}`);
    await mkdir(output, {recursive: true});
    try {
      const samples = [], commandPlan = [];
      const context = await localAcceptanceContext(stack.env);
      const fixture = await createRunFixture(context, {partySize: 1, onSample: sample => samples.push(sample), onCommandPlan: body => commandPlan.push(body)});
      const inventory = () => collectStorageReport({dsn: stack.database.dsn, registry: stack.registry});
      const counterSQL = `SELECT json_build_object('receipts',(SELECT count(*) FROM roguelike_command_receipts), 'character_events',(SELECT count(*) FROM character_events));`;
      const readCounts = async () => JSON.parse((await stack.database.query(counterSQL)).trim());
      const countsBefore = await readCounts(), before = await inventory();
      await writeFile(path.join(output, 'before.json'), JSON.stringify(before, null, 2));
      const outcome = await runCommandSeries(context, {fixture, count, onProgress: completed => {
        if (completed % 100 === 0) process.stdout.write(`Storage workload: ${completed}/${count} committed commands checked.\n`);
      }});
      const countsAfter = await readCounts(), after = await inventory();
      assert.equal(countsAfter.receipts - countsBefore.receipts, count, 'Exact retries created extra receipts');
      assert.equal(samples.length, count, 'Expected one numeric sample per newly committed command');
      const relationDeltas = after.inventory.relations.map(row => {
        const previous = before.inventory.relations.find(candidate => candidate.name === row.name);
        return {relation: row.name, total_bytes: row.total_bytes - (previous?.total_bytes ?? 0),
          table_bytes: row.table_bytes - (previous?.table_bytes ?? 0), index_bytes: row.index_bytes - (previous?.index_bytes ?? 0),
          toast_with_index_bytes: row.toast_with_index_bytes - (previous?.toast_with_index_bytes ?? 0)};
      }).filter(row => row.total_bytes || row.table_bytes || row.index_bytes).sort((a,b) => b.total_bytes-a.total_bytes);
      const summary = {schema_version: 1, status: 'passed', run_id: stack.registry.runId, commands: count, replay_requests: count,
        fixture: after.fixture, artifact_hash: stack.registry.artifactHash, counts_before: countsBefore, counts_after: countsAfter,
        database_growth_bytes: after.inventory.database_bytes-before.inventory.database_bytes,
        wal_growth_bytes: after.cluster_wal_counters.bytes-before.cluster_wal_counters.bytes,
        wal_same_stats_window: after.cluster_wal_counters.stats_reset === before.cluster_wal_counters.stats_reset,
        relation_deltas: relationDeltas, timings: summarize(samples), outcome,
        limitations: ['Only a local synthetic line-fighter camp-turn workload; no production size or saving is inferred.',
          'Each paid-free gameplay command was retried exactly; persisted responses matched within this run.',
          'Backend allocates fresh RNG and wall-clock timestamps per camp turn. Full state equality across fresh runs is NOT established by this report.',
          'Other local agent builds may contend for CPU. Timings are diagnostic, not an uncontended performance baseline.',
          'PostgreSQL table/TOAST/index growth is allocated physical bytes, including page granularity; column samples are bounded and separate.']};
      for (const [name, value] of Object.entries({after, samples, 'command-plan': commandPlan, summary})) await writeFile(path.join(output, `${name}.json`), JSON.stringify(value, null, 2));
      process.stdout.write(JSON.stringify({status:'passed',count,receipt_delta:count,output,largest_growth:relationDeltas.slice(0,3)})+'\n');
    } finally {await stack.cleanup();}
  }
}
main().catch(error => {process.stderr.write(`Storage workload failed (${error.code ?? 'verification'}); inspect only this run's local diagnostics.\n`); process.exitCode=1;});
