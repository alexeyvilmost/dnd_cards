#!/usr/bin/env node
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {readFile, writeFile, copyFile} from 'node:fs/promises';
import {createHash, randomBytes, randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {startTestStack, waitReady} from '../testing/stack.mjs';
import {cleanEnvironment, freePort, writeRegistry} from '../testing/runtime.mjs';
import {assertTestDsn, assertRealOwnedPath} from '../testing/guards.mjs';
import {localAcceptanceContext} from '../testing/acceptance-context.mjs';
import {captureNativeBackup, restoreOwnedSnapshot} from '../release/native-backup.mjs';
import {createRulesWorker, snapshotHash} from '../../frontend/worker/server.mjs';
import {createScenarioAPI, createRunFixture, attachRunFixture, assertSame, summarize} from '../performance/scenarios.mjs';
import {arrangeMovementEncounter, updateTrainingEntity, restoreTrainingEntities} from '../testing/movement-encounter-fixture.mjs';
import {collectStorageReport} from './storage-report.mjs';

const hash = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const uuid = /^[a-f0-9-]{36}$/i;

// Each arm restores exactly the same already-initialized combat. No RNG,
// world, accepted command, journal, or timestamp is edited after that capture.
async function restoreArm(source, backup, artifactFile, binaryHash) {
  const stack = await startTestStack({dbOnly: true}), servers = [];
  let backend, closed;
  const cleanup = async () => {
    const errors = [];
    if (backend?.exitCode === null && backend?.signalCode === null) {
      backend.kill();
      let timer;
      try {await Promise.race([closed, new Promise((_, reject) => {timer = setTimeout(() => reject(Error('Owned backend did not stop')), 5000);})]);}
      catch (e) {errors.push(e);} finally {clearTimeout(timer);}
    }
    for (const server of servers.reverse()) {
      try {server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve));} catch (e) {errors.push(e);}
    }
    try {await stack.cleanup();} catch (e) {errors.push(e);}
    if (errors.length) throw new AggregateError(errors, 'Seeded storage cleanup failed');
  };
  try {
    stack.registry.fixture = await restoreOwnedSnapshot(stack.database, stack.registry, backup.directory);
    const sourceBinary = path.join(source.registry.directory, process.platform === 'win32' ? 'backend.exe' : 'backend');
    await assertRealOwnedPath(source.registry.directory, sourceBinary);
    assert.equal(hash(await readFile(sourceBinary)), binaryHash);
    const binary = path.join(stack.registry.directory, path.basename(sourceBinary));
    await copyFile(sourceBinary, binary, 1); assert.equal(hash(await readFile(binary)), binaryHash);
    const token = randomBytes(32).toString('hex');
    const listen = async server => {servers.push(server); await new Promise((resolve, reject) => {server.once('error', reject);server.listen(0, '127.0.0.1', resolve);});return `http://127.0.0.1:${server.address().port}`;};
    const workerOrigin = await listen(await createRulesWorker({artifactFile, token, artifactsDirectory: path.join(stack.registry.directory, 'rules-artifacts')}));
    const deny = createServer((_req, res) => {res.writeHead(503);res.end();});
    deny.on('connect', (_req, socket) => socket.end('HTTP/1.1 503 Local egress disabled\r\n\r\n'));
    const denyOrigin = await listen(deny), apiOrigin = `http://127.0.0.1:${await freePort()}`;
    backend = spawn(binary, [], {cwd: stack.registry.directory, windowsHide: true, stdio: 'ignore', env: cleanEnvironment({
      DATABASE_URL: stack.database.dsn, PORT: new URL(apiOrigin).port, LISTEN_HOST: '127.0.0.1', JWT_SECRET: randomBytes(32).toString('hex'),
      RULES_WORKER_URL: workerOrigin, RULES_WORKER_TOKEN: token, CONTENT_ADMIN_USER_IDS: source.accounts.admin.id, CORS_ALLOWED_ORIGINS: apiOrigin,
      OPENAI_API_KEY: '', OPENAI_BASE_URL: `${denyOrigin}/v1`, HTTP_PROXY: denyOrigin, HTTPS_PROXY: denyOrigin, NO_PROXY: '127.0.0.1,localhost,::1',
      GIN_MODE: 'release', SOURCE_COMMIT: 'local-test', RULES_PERFORMANCE_ENABLED: '1', DB_COMPACT_RECEIPTS: '0', DB_FROZEN_CATALOGS: '0', IMAGE_JOBS_ENABLED: '0',
    })});
    closed = new Promise(resolve => backend.once('close', resolve));
    await new Promise((resolve, reject) => {backend.once('spawn', resolve);backend.once('error', reject);});
    await waitReady(apiOrigin, '/api/health', async r => (await r.json()).status === 'ok', 90000, () => backend.exitCode === null && backend.signalCode === null);
    Object.assign(stack.registry, {origins: {api: apiOrigin, ui: apiOrigin, worker: workerOrigin}, artifactHash: source.registry.artifactHash,
      accounts: source.registry.accounts, processes: [{name: 'owned-seeded-backend', pid: backend.pid}]});
    for (const key of ['TEST_USERNAME','TEST_PASSWORD','TEST_ADMIN_USERNAME','TEST_ADMIN_PASSWORD','TEST_PEER_USERNAME','TEST_PEER_PASSWORD']) stack.env[key] = source.env[key];
    Object.assign(stack.env, {TEST_API_ORIGIN: apiOrigin, TEST_UI_ORIGIN: apiOrigin, TEST_WORKER_ORIGIN: workerOrigin, TEST_WORKER_TOKEN: token});
    await writeRegistry(stack.registry);
    return {...stack, cleanup, binary};
  } catch (error) {await cleanup();throw error;}
}

export function nextStorageCombatIntent(state) {
  assert.equal(state.outcome, 'active', 'Seeded combat ended before the fixed command count');
  if (state.pendingAlertSwapActorIds?.length) return {type:'alert_swap', actorId:state.pendingAlertSwapActorIds[0], allyActorId:null};
  if (state.pendingD20Interrupt) return {type:'d20_interrupt', actorId:null};
  if (state.pendingTriggeredAction) return {type:'triggered_action', actionId:null};
  if (state.world.pendingResolution?.request.type === 'reaction') return {type:'reaction', response:{kind:'reaction', actionId:null}};
  if (state.world.pendingResolution?.request.type === 'saving_throw') return {type:'saving_throw'};
  assert.ok(!state.world.pendingResolution, 'No invented policy for an unsupported pending decision');
  if (state.world.scene.initiative[state.world.scene.activeIndex] !== state.characterId) return {type:'resume'};
  return {type:'end_turn', actorId:state.characterId};
}

async function checkpoint(stack, runId, count, samples) {
  assertTestDsn(stack.database.dsn, stack.registry);assert.match(runId, uuid);
  assert.equal((await stack.database.query('SELECT run_id FROM test_run_ownership;')).trim(), stack.registry.runId);
  // This complete canonical state includes RNG/pending/logs/processed IDs and
  // pinned catalog. Only its hash leaves memory. Operational DB row timestamps
  // and generated journal primary keys are measured separately, never used to
  // reconstruct or normalize game state.
  const state = JSON.parse(Buffer.from((await stack.database.query(`SELECT encode(convert_to(jsonb_build_object('envelope',combat_envelope,'catalog',combat_catalog,'catalog_ref',combat_catalog_ref)::text,'UTF8'),'base64') FROM roguelike_runs WHERE id='${runId}';`, undefined, {sensitive:true})).trim(), 'base64').toString('utf8'));
  const logical = JSON.parse((await stack.database.query(`SELECT jsonb_build_object('receipts',(SELECT count(*) FROM roguelike_command_receipts WHERE run_id='${runId}'),
    'receipt_json_bytes',(SELECT coalesce(sum(octet_length(response::text)),0) FROM roguelike_command_receipts WHERE run_id='${runId}'),
    'journal_rows',(SELECT count(*) FROM roguelike_combat_events WHERE run_id='${runId}'),
    'journal_json_bytes',(SELECT coalesce(sum(octet_length(record::text)),0) FROM roguelike_combat_events WHERE run_id='${runId}'),
    'envelope_json_bytes',octet_length(combat_envelope::text)) FROM roguelike_runs WHERE id='${runId}';`)).trim());
  const inventory = await collectStorageReport({dsn:stack.database.dsn, registry:stack.registry});
  return {count, canonicalStateHash:snapshotHash(state), logical, inventory, timings:summarize(samples)};
}

export async function runSeededStorageGrowth({count=1000}={}) {
  assert.ok([100,1000].includes(count));
  const source = await startTestStack({profile:'integration', reuseBuild:true, performance:true});
  const report = {schemaVersion:1, kind:'two-independent-seeded-storage-series', status:'running', sourceRun:source.registry.runId,
    commandsPerArm:count, checkpoints:count===1000?[100,1000]:[100], arms:[]};
  try {
    const context=await localAcceptanceContext(source.env), api=await createScenarioAPI(context), admin=await createScenarioAPI(context,{role:'admin'});
    const fixture=await createRunFixture(context,{api}), changes=[];
    const monsters=(await admin.request('GET','/monsters?limit=100')).monsters;
    assert.equal(monsters.length,2);assert.ok(monsters.every(row=>row.source==='Local tests'));
    try {
      for (const id of new Set(monsters.flatMap(row=>row.action_ids))) {
        const action=await admin.request('GET',`/actions/${id}`), mechanics=structuredClone(action.mechanics);
        for(const effect of mechanics.effects)for(const payload of effect.on_hit??[])if(payload.kind==='damage')payload.amount=0;
        await updateTrainingEntity(admin,changes,'actions',action,{mechanics});
      }
      await fixture.command('start_encounter');await arrangeMovementEncounter(fixture.run,api.user.id,source.env);await fixture.command('initialize_combat');
    } finally {await restoreTrainingEntities(admin,changes);}
    const backup=await captureNativeBackup(source);
    const artifactFile=path.join(backup.directory,'artifacts',`${source.registry.artifactHash.slice(7)}.cjs`);
    assert.equal(hash(await readFile(artifactFile)),source.registry.artifactHash);
    const binaryFile=path.join(source.registry.directory,process.platform==='win32'?'backend.exe':'backend');
    const binaryHash=hash(await readFile(binaryFile)), workerServerHash=hash(await readFile(new URL('../../frontend/worker/server.mjs',import.meta.url)));
    Object.assign(report,{artifactHash:source.registry.artifactHash,binaryHash,workerServerHash,backupHash:snapshotHash(backup.manifest),fixture:{partySize:1,preset:'line',zeroDamageDeclaredBeforeInitialize:true,initializedStateNeverEdited:true}});
    const plan=[];
    for(let arm=0;arm<2;arm++) {
      const stack=await restoreArm(source,backup,artifactFile,binaryHash), samples=[];
      const result={runId:stack.registry.runId,checkpoints:[]};report.arms.push(result);
      try {
        const armContext=await localAcceptanceContext(stack.env), attached=await attachRunFixture(armContext,{runId:fixture.run.id,onSample:s=>samples.push(s)});
        result.before=await checkpoint(stack,fixture.run.id,0,samples);
        for(let index=0;index<count;index++) {
          const intent=nextStorageCombatIntent(attached.run.combat_state);
          if(arm===0)plan.push({command_id:randomUUID(),expected_revision:attached.run.revision,type:'combat_intent',payload:{intent}});
          assertSame(plan[index].payload,{intent},'The second independent arm offered a different next command');
          await attached.command('combat_intent',{intent},{scenario:'seeded_combat_turn',commandRequest:plan[index]});
          if(report.checkpoints.includes(index+1))result.checkpoints.push(await checkpoint(stack,fixture.run.id,index+1,samples));
          if((index+1)%100===0)console.log(JSON.stringify({phase:'seeded_storage',arm:arm+1,commands:index+1,total:count}));
        }
        result.verification=await attached.verify();result.exactRetries=count;
        assert.equal(hash(await readFile(stack.binary)),binaryHash);assert.equal(hash(await readFile(artifactFile)),report.artifactHash);
      } finally {await stack.cleanup();result.cleanup={status:stack.registry.status,errors:stack.registry.cleanupErrors};}
    }
    assert.equal(report.arms[0].before.canonicalStateHash,report.arms[1].before.canonicalStateHash);
    report.comparisons=report.checkpoints.map((commands,index)=>{
      const a=report.arms[0].checkpoints[index],b=report.arms[1].checkpoints[index];
      assert.equal(a.canonicalStateHash,b.canonicalStateHash,'Full saved canonical state differs across independent seeded series');
      for(const [arm,row]of [[0,a],[1,b]])assert.equal(row.logical.receipts-report.arms[arm].before.logical.receipts,commands);
      assert.equal(a.logical.envelope_json_bytes,b.logical.envelope_json_bytes);
      const delta=(row,base,key)=>row.logical[key]-base.logical[key];
      const logicalComparisons=['receipt_json_bytes','journal_json_bytes'].map(key=>{
        const first=delta(a,report.arms[0].before,key),second=delta(b,report.arms[1].before,key),relativeDifference=Math.abs(first-second)/Math.max(first,second,1);
        assert.ok(relativeDifference<.001,'Logical storage drift exceeds 0.1% operational timestamp allowance');
        return {key,first,second,relativeDifference};
      });
      return {commands,canonicalStateHash:a.canonicalStateHash,identicalCanonicalState:true,logicalComparisons};
    });
    assert.equal(hash(await readFile(binaryFile)),binaryHash);assert.equal(hash(await readFile(new URL('../../frontend/worker/server.mjs',import.meta.url))),workerServerHash);
    report.commandPlanHash=snapshotHash(plan);report.status='passed';
    report.boundary='Two independently restored 1000-command series include paired 100-command prefixes. Full canonical state/RNG equality is exact; receipt/journal row timestamps are real and may vary in encoded length. Allocated table/TOAST/index/WAL growth is measured separately from logical JSON. No production savings inferred.';
  } catch (error) {report.status='failed';report.failure=error.message;throw error;}
  finally {await source.cleanup();report.sourceCleanup={status:source.registry.status,errors:source.registry.cleanupErrors};await writeFile(path.join(source.registry.directory,'seeded-storage-growth.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});}
  return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  runSeededStorageGrowth({count:process.argv.includes('--100')?100:1000}).then(report=>console.log(JSON.stringify({status:report.status,sourceRun:report.sourceRun,comparisons:report.comparisons}))).catch(error=>{console.error(`Seeded storage failed: ${error.message}`);process.exitCode=1;});
}
