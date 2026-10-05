#!/usr/bin/env node
import {writeFile,mkdir,appendFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {startTestStack} from '../testing/stack.mjs';
import {localAcceptanceContext} from '../testing/acceptance-context.mjs';
import {runRequiredGo} from '../testing/required-go.mjs';
import {runCommandSeries,runCombatLatency,summarize} from './scenarios.mjs';
import {runEquipmentLatency} from './equipment.mjs';
import {runBrowserLatency} from './browser.mjs';
import {buildReport} from './build-report.mjs';
import assert from 'node:assert/strict';
import {execute,resolveTool} from '../testing/runtime.mjs';

const argument=(name,fallback)=>{const index=process.argv.indexOf(name);return index<0?fallback:Number(process.argv[index+1]);};
const smoke=process.argv.includes('--smoke'),repetitions=argument('--repetitions',smoke?1:30),count=argument('--commands',smoke?2:30);
const equipmentOnly=process.argv.includes('--equipment-only'),browserOnly=process.argv.includes('--browser-only'),withBrowser=!equipmentOnly&&!process.argv.includes('--skip-browser');
const stack=await startTestStack({profile:'integration',reuseBuild:process.argv.includes('--reuse-ui-build')||(!withBrowser&&!process.argv.includes('--build-ui')),performance:true,catalogBatch:process.argv.includes('--catalog-batch')});
try {
  const context=await localAcceptanceContext(stack.env),samples=[];
  context.readRunInvariant=async runId=>{
    assert.match(runId,/^[0-9a-f-]{36}$/i);
    return JSON.parse((await stack.database.query(`SELECT json_build_object('artifactHash',combat_envelope->>'artifactHash','entropySeedFingerprint',md5(combat_envelope#>>'{entropy,seed}'),'entropyCursor',combat_envelope#>>'{entropy,cursor}','envelopeFingerprint',md5(combat_envelope::text),'contentHash',combat_envelope#>>'{state,world,ruleset,contentHash}','revision',revision)::text FROM roguelike_runs WHERE id='${runId}';`)).trim());
  };
  const output=path.join(stack.registry.directory,'performance');await mkdir(output,{recursive:true});
  // Preserve numeric samples even if a later scenario fails. No response
  // bodies, tokens, full states or private seeds are written by this sink.
  const onSample=async sample=>{samples.push(sample);await appendFile(path.join(output,'samples.jsonl'),JSON.stringify(sample)+'\n');};
  await runRequiredGo(stack,{tests:['TestPerformanceSQLCountsPreloadOnceAndRecordsActualLockScope']});
  const combat=equipmentOnly||browserOnly?[]:await runCombatLatency(context,{repetitions,onSample,onProgress:row=>console.log(`Combat party ${row.partySize}: ${row.iteration}/${row.repetitions}`)});
  const commands=equipmentOnly||browserOnly?null:await runCommandSeries(context,{count,onSample,onProgress:(done,total)=>console.log(`Commands ${done}/${total}`)});
  const equipment=browserOnly?null:await runEquipmentLatency(context,{repetitions,onSample,output});
  await writeFile(path.join(output,'server-baseline.json'),JSON.stringify({schemaVersion:1,status:browserOnly?'not_selected':'passed',runId:stack.registry.runId,fixture:stack.registry.fixture,artifactHash:stack.registry.artifactHash,samples,summary:summarize(samples),combat,commands,equipment},null,2));
  const browser=withBrowser?await runBrowserLatency(context,{repetitions:smoke?1:3}):null;
  const report={schemaVersion:1,status:'passed',runId:stack.registry.runId,fixture:stack.registry.fixture,artifactHash:stack.registry.artifactHash,uiBuild:stack.registry.uiBuild,catalogBatch:process.argv.includes('--catalog-batch'),
    environment:{node:process.version,go:(await execute(resolveTool('go'),['version'])).trim(),postgres:(await stack.database.query('SHOW server_version;')).trim(),platform:process.platform,arch:process.arch,cpu:os.cpus()[0]?.model,logicalCPUs:os.cpus().length,memoryBytes:os.totalmem(),network:'loopback, no network/CPU throttle',externalEgress:'blocked'},
    cacheConditions:{server:'Fresh catalog for each initialization; persistent process. Worker cache hit is measured. OS/PG caches are not flushed.',seed:'Server-generated per encounter; exact receipt replay compares full results. Different encounters are not claimed to share a seed.'},
    samples,summary:summarize(samples),combat,commands,equipment,browser,build:withBrowser?await buildReport(stack.registry.uiBuild?.directory):null};
  await writeFile(path.join(output,'baseline.json'),JSON.stringify(report,null,2));
  console.log(`PASS performance baseline: ${output}`);
} finally {await stack.cleanup();}
