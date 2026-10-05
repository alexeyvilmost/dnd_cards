#!/usr/bin/env node
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {aggregateShardReports} from './shards.mjs';
import {shardPlan} from './shards.mjs';
import {suiteWorkload} from './workload.mjs';
import {readSuites,selectGroups,catalogTests} from './suites.mjs';
import {captureSourceSnapshot,verifySourceSnapshot} from './source-snapshot.mjs';
import assert from 'node:assert/strict';
const [directory,...files]=process.argv.slice(2);
if(!directory||!files.length)throw Error('Usage: aggregate-shards.mjs OUTPUT_DIRECTORY REPORT_JSON...');
const reports=await Promise.all(files.map(async file=>JSON.parse(await readFile(file,'utf8'))));
const {manifest,hash}=readSuites(),catalog=catalogTests(manifest),first=reports[0];
assert.equal(first.manifest_sha256,hash,'Suite manifest differs from this checkout');
const selection=selectGroups(manifest,first.component_plan,{suite:first.suite});
assert.deepEqual(selection,first.selection);
const report=aggregateShardReports(reports,shardPlan(suiteWorkload({selection,catalog,manifest,suite:first.suite})));
const current=captureSourceSnapshot();
for(const file of files){
  const saved=JSON.parse(await readFile(path.join(path.dirname(file),'source-snapshot.json'),'utf8'));
  verifySourceSnapshot(saved,current);
  assert.equal(saved.sha256,report.source_snapshot.sha256);
  assert.deepEqual(JSON.parse(await readFile(path.join(path.dirname(file),'test-catalog.json'),'utf8')),catalog);
}
await mkdir(directory,{recursive:true});report.directory=path.resolve(directory);
await writeFile(path.join(directory,'source-snapshot.json'),JSON.stringify(current,null,2)+'\n');
await writeFile(path.join(directory,'test-catalog.json'),JSON.stringify(catalog,null,2)+'\n');
await writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,shards:report.aggregation.shards.length,workload:report.aggregation.workload,report:path.join(report.directory,'report.json')}));
